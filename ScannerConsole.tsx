import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Loader2, RotateCcw, TriangleAlert } from 'lucide-react'
import HudCorners from '@/components/HudCorners'
import { trpc } from '@/providers/trpc'
import { cn } from '@/lib/utils'
import type { SeoSignals } from '../../../api/seo'

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number]
const TOTAL_STEPS = 5

interface ScanLine {
  text: string
  state: 'typing' | 'done' | 'error'
}

interface ScannerConsoleProps {
  onComplete: (signals: SeoSignals) => void
}

function normalizeUrl(raw: string): string | null {
  const cleaned = raw.trim()
  if (!cleaned) return null
  const candidate = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`
  try {
    const u = new URL(candidate)
    if (!u.hostname.includes('.') || u.hostname.length < 4) return null
    return cleaned
  } catch {
    return null
  }
}

export default function ScannerConsole({ onComplete }: ScannerConsoleProps) {
  const utils = trpc.useUtils()
  const [url, setUrl] = useState('')
  const [inputError, setInputError] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'error'>('idle')
  const [lines, setLines] = useState<ScanLine[]>([])
  const [progress, setProgress] = useState(0)
  const runId = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => {
    runId.current += 1
  }, [])

  const setLine = (idx: number, patch: Partial<ScanLine>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  }

  const startScan = async (raw: string) => {
    const normalized = normalizeUrl(raw)
    if (!normalized) {
      setInputError(true)
      inputRef.current?.focus()
      return
    }
    setInputError(false)

    const id = ++runId.current
    const alive = () => runId.current === id
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms))

    setPhase('scanning')
    setProgress(0)
    setLines([])

    let signals: SeoSignals | null = null
    let uplinkFailed = false
    const fetchPromise = (import.meta.env.PROD
      ? fetch('/.netlify/functions/seo-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: normalized }),
        }).then((res) => res.json())
      : utils.seo.check.fetch({ url: normalized })
    )
      .then((res) => {
        signals = res
        if (res.error || res.contentLengthBytes === 0) uplinkFailed = true
      })
      .catch(() => {
        uplinkFailed = true
      })

    const pushLine = (text: string) => {
      setLines((prev) => [...prev, { text, state: 'typing' }])
    }

    const typeLine = async (idx: number, text: string) => {
      pushLine('')
      if (reduced) {
        setLine(idx, { text, state: 'done' })
        setProgress(((idx + 1) / TOTAL_STEPS) * 100)
        return
      }
      for (let c = 1; c <= text.length; c++) {
        if (!alive()) return
        setLine(idx, { text: text.slice(0, c) })
        setProgress(((idx + c / text.length) / TOTAL_STEPS) * 100)
        await sleep(14)
      }
      if (!alive()) return
      setLine(idx, { state: 'done' })
      await sleep(160)
    }

    await typeLine(0, '> ESTABLISHING UPLINK...')
    if (!alive()) return

    const fetchBase = '> FETCHING HTML'
    pushLine('')
    if (reduced) setLine(1, { text: fetchBase })
    else {
      for (let c = 1; c <= fetchBase.length; c++) {
        if (!alive()) return
        setLine(1, { text: fetchBase.slice(0, c) })
        await sleep(14)
      }
    }
    await fetchPromise
    if (!alive()) return
    if (uplinkFailed || !signals) {
      setLine(1, { text: '> UPLINK FAILED -- SITE UNREACHABLE OR BLOCKED', state: 'error' })
      setProgress(100)
      setPhase('error')
      return
    }
    const sig: SeoSignals = signals
    const statusTag = sig.ok ? `[${sig.status} OK]` : `[${sig.status} ERR]`
    setLine(1, { text: `${fetchBase} ${statusTag} * ${sig.responseTimeMs}MS`, state: 'done' })
    setProgress((2 / TOTAL_STEPS) * 100)
    if (!reduced) await sleep(200)

    await typeLine(2, '> PARSING DOCUMENT STRUCTURE...')
    if (!alive()) return
    await typeLine(3, '> AUDITING 8 SIGNAL GROUPS...')
    if (!alive()) return
    await typeLine(4, '> COMPILING REPORT *')
    if (!alive()) return

    setProgress(100)
    if (!reduced) await sleep(250)
    if (!alive()) return
    onComplete(sig)
    setPhase('idle')
  }

  const scanning = phase === 'scanning'

  return (
    <motion.div
      className="hud-frame relative mx-auto w-full max-w-2xl rounded-[6px] border border-line bg-bg-elev"
      initial={{ clipPath: 'inset(0 0 100% 0)', opacity: 0.4 }}
      animate={{ clipPath: 'inset(0 0 0% 0)', opacity: 1 }}
      transition={{ duration: 0.8, delay: 0.45, ease: EASE }}
    >
      <HudCorners />
      {scanning && <span className="scanline" aria-hidden />}

      <div className="h-[2px] w-full overflow-hidden rounded-t-[6px] bg-line">
        <div
          className="h-full bg-gradient-to-r from-cyan to-teal transition-[width] duration-150 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex items-center gap-2 border-b border-line px-5 py-3">
        <span className={cn('led', phase === 'error' ? 'led-cyan' : scanning ? 'led-cyan' : 'led-green')} />
        <span className="hud-micro text-text-dim">ALR / SEO-SCANNER v1.0</span>
        <span className="hud-micro ml-auto text-cyan">
          {scanning ? 'SCANNING' : phase === 'error' ? 'UPLINK FAILED' : 'READY'}
          <span className="cursor-blink">_</span>
        </span>
      </div>

      <div className="p-5 md:p-6">
        <motion.div
          initial={false}
          animate={scanning ? { height: 0, opacity: 0 } : { height: 'auto', opacity: 1 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="overflow-hidden"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!scanning) void startScan(url)
            }}
            className="flex flex-col gap-3 sm:flex-row"
          >
            <div
              className={cn(
                'flex flex-1 items-center rounded-[4px] border bg-bg-panel transition-colors',
                inputError ? 'border-red' : 'border-line focus-within:border-cyan',
              )}
            >
              <span className="select-none pl-4 font-mono text-[15px] text-text-dim">https://</span>
              <input
                ref={inputRef}
                type="text"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value)
                  if (inputError) setInputError(false)
                }}
                placeholder="yourwebsite.com"
                aria-label="URL to scan"
                spellCheck={false}
                autoComplete="off"
                className="w-full bg-transparent px-2 py-3 font-mono text-[15px] text-text placeholder:text-text-dim focus:outline-none"
              />
            </div>
            <button type="submit" className="btn-primary flex-none" disabled={scanning}>
              {scanning ? <Loader2 className="relative z-[1] h-4 w-4 animate-spin" /> : null}
              <span>{scanning ? 'SCANNING' : 'SCAN *'}</span>
            </button>
          </form>
          <AnimatePresence>
            {inputError && (
              <motion.p
                className="mt-2 font-mono text-xs tracking-[0.08em] text-red"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                // INVALID URL -- CHECK THE FORMAT
              </motion.p>
            )}
          </AnimatePresence>
          <p className="hud-micro mt-3 text-text-dim">
            SERVER-SIDE FETCH * RESULTS IN ~5 SECONDS * WE DON'T STORE YOUR URL
          </p>
        </motion.div>

        {lines.length > 0 && (
          <div className={cn('font-mono text-[13px] leading-[2]', !scanning && 'pt-1', scanning && 'pt-1')}>
            {lines.map((line, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <span className="flex h-4 w-4 flex-none items-center justify-center">
                  {line.state === 'done' ? (
                    <Check className="h-3.5 w-3.5 text-green" />
                  ) : line.state === 'error' ? (
                    <TriangleAlert className="h-3.5 w-3.5 text-red" />
                  ) : (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan" />
                  )}
                </span>
                <span className={cn(line.state === 'error' ? 'text-red' : 'text-text-2')}>
                  {line.text}
                  {line.state === 'typing' && <span className="cursor-blink text-cyan">*</span>}
                </span>
              </div>
            ))}
            {phase === 'error' && (
              <motion.button
                type="button"
                className="btn-ghost mt-4"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => void startScan(url)}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>RETRY SCAN</span>
              </motion.button>
            )}
          </div>
        )}
      </div>
    </motion.div>
  )
}
