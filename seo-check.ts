export const handler = async (event: any) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  const MAX_BYTES = 1_500_000;
  const FETCH_TIMEOUT_MS = 12_000;

  function extractTag(html: string, tag: string): string[] {
    const re = new RegExp(`<${tag}\b[^>]*>([\s\S]*?)<\/${tag}>`, "gi");
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) out.push(m[1].replace(/<[^>]+>/g, "").trim());
    return out;
  }

  function attr(tag: string, name: string): string | null {
    const re = new RegExp(`${name}\s*=\s*["']([^"']*)["']`, "i");
    const m = re.exec(tag);
    return m ? m[1] : null;
  }

  function metaContent(html: string, key: "name" | "property", value: string): string | null {
    const re = /<meta\b[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const tag = m[0];
      const k = attr(tag, key);
      if (k && k.toLowerCase() === value.toLowerCase()) return attr(tag, "content");
    }
    return null;
  }

  const body = JSON.parse(event.body || "{}");
  let url = (body.url || "").trim();
  if (!url) {
    return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: "URL required" }) };
  }
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ALR-SEO-Checker/1.0; +https://aleyoelroi.com/seo-checker)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    const reader = res.body?.getReader();
    let bytes = new Uint8Array(0);
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          const next = new Uint8Array(bytes.length + value.length);
          next.set(bytes);
          next.set(value, bytes.length);
          bytes = next;
        }
        if (bytes.length >= MAX_BYTES) {
          await reader.cancel();
          break;
        }
      }
    }
    const html = new TextDecoder("utf-8").decode(bytes);
    const responseTimeMs = Date.now() - started;

    const title = extractTag(html, "title")[0] ?? null;
    const metaDescription = metaContent(html, "name", "description");
    const canonicalMatch = /<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i.exec(html);
    const htmlTagMatch = /<html\b[^>]*>/i.exec(html);
    const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
    const imgMissingAlt = imgs.filter((t) => {
      const a = attr(t, "alt");
      return a === null || a.trim() === "";
    }).length;

    const links = html.match(/<a\b[^>]*href\s*=\s*["'][^"']*["'][^>]*>/gi) ?? [];
    let internalLinks = 0;
    let externalLinks = 0;
    const host = new URL(res.url || url).hostname.replace(/^www\./, "");
    for (const l of links) {
      const href = attr(l, "href") ?? "";
      if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
      try {
        const abs = new URL(href, res.url || url);
        if (abs.hostname.replace(/^www\./, "") === host) internalLinks++;
        else externalLinks++;
      } catch {
        internalLinks++;
      }
    }

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        ok: res.ok,
        url: body.url,
        finalUrl: res.url || url,
        status: res.status,
        responseTimeMs,
        title,
        titleLength: title?.length ?? 0,
        metaDescription,
        metaDescriptionLength: metaDescription?.length ?? 0,
        metaRobots: metaContent(html, "name", "robots"),
        canonical: canonicalMatch ? attr(canonicalMatch[0], "href") : null,
        htmlLang: htmlTagMatch ? attr(htmlTagMatch[0], "lang") : null,
        viewport: metaContent(html, "name", "viewport"),
        h1: extractTag(html, "h1").slice(0, 5),
        h2Count: (html.match(/<h2\b/gi) ?? []).length,
        h3Count: (html.match(/<h3\b/gi) ?? []).length,
        imgTotal: imgs.length,
        imgMissingAlt,
        ogTitle: metaContent(html, "property", "og:title"),
        ogDescription: metaContent(html, "property", "og:description"),
        ogImage: metaContent(html, "property", "og:image"),
        twitterCard: metaContent(html, "name", "twitter:card"),
        internalLinks,
        externalLinks,
        hasHttps: (res.url || url).startsWith("https://"),
        contentLengthBytes: bytes.length,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        ok: false,
        url: body.url,
        finalUrl: url,
        status: 0,
        responseTimeMs: Date.now() - started,
        error: err instanceof Error ? err.message : "Fetch failed",
      }),
    };
  } finally {
    clearTimeout(timer);
  }
};
