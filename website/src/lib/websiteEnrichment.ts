/**
 * Bounded, best-effort website signals for CSV export.
 * Failures must never throw to callers — use enrichStatus partial/skipped.
 */

export type EnrichStatus = "ok" | "partial" | "skipped";

export type PageCountSource = "sitemap" | "html_links" | "unknown";

export type WebsiteEnrichment = {
  enrichStatus: EnrichStatus;
  copyrightYear: string;
  copyrightOldFlag: "yes" | "no" | "";
  builderDetected: string;
  agencyCredit: string;
  hasAgencyCredit: boolean;
  pageCountSource: PageCountSource;
  pageCountEstimate: string;
  lastModified: string;
  techSignals: string;
  hasCaptcha: boolean;
  captchaSignals: string;
  /** Internal paths from homepage hrefs (same host), for one-page fallback */
  internalPathCount: number;
  /** Same-host paths from header / top-nav slice only (polished sites tend to have more). */
  headerNavPathCount: number;
  /** True if sitemap says 1 URL or internalPathCount <= 1 when no sitemap */
  onePageHint: boolean;
};

const MAX_HTML_BYTES = 768 * 1024;
const MAX_ROBOTS_BYTES = 256 * 1024;
const MAX_SITEMAP_BYTES = 512 * 1024;
const MAX_URLS_COUNTED = 500;
const FETCH_TIMEOUT_MS = 8000;
const ENRICH_TOTAL_MS = 14000;

const OLD_COPYRIGHT_YEAR = 2018;

const USER_AGENT = "Mozilla/5.0 (compatible; LeadRunner/1.1)";

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}_timeout`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

async function fetchBoundedText(
  url: string,
  maxBytes: number,
  signal: AbortSignal
): Promise<{ text: string; finalUrl: string; lastModified: string; ok: boolean }> {
  const controller = new AbortController();
  const linked = () => {
    if (signal.aborted) controller.abort();
  };
  signal.addEventListener("abort", linked);
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain,application/xml,*/*" },
    });

    const lastModified = response.headers.get("last-modified") || "";
    if (!response.ok || !response.body) {
      return { text: "", finalUrl: response.url || url, lastModified, ok: false };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    let out = "";

    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.length > maxBytes - received ? value.subarray(0, maxBytes - received) : value;
      received += chunk.length;
      out += decoder.decode(chunk, { stream: true });
      if (received >= maxBytes) break;
    }

    reader.releaseLock?.();
    return { text: out, finalUrl: response.url || url, lastModified, ok: true };
  } catch {
    return { text: "", finalUrl: url, lastModified: "", ok: false };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", linked);
  }
}

function parseLastModifiedToIso(header: string): string {
  if (!header.trim()) return "";
  const t = Date.parse(header);
  if (Number.isNaN(t)) return header.trim().slice(0, 80);
  try {
    return new Date(t).toISOString();
  } catch {
    return header.trim().slice(0, 80);
  }
}

function countInternalPaths(html: string, baseUrl: string): number {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return 0;
  }

  const hrefRegex = /href\s*=\s*["']([^"'#]+)["']/gi;
  const paths = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = hrefRegex.exec(html)) !== null) {
    const href = (match[1] || "").trim();
    if (!href || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) {
      continue;
    }
    try {
      const resolved = new URL(href, base);
      if (resolved.hostname.toLowerCase() !== base.hostname.toLowerCase()) continue;
      if (!["http:", "https:"].includes(resolved.protocol)) continue;
      const normalizedPath = resolved.pathname.replace(/\/+$/, "") || "/";
      if (/\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|pdf|xml|txt|woff2?|ttf|eot)$/i.test(normalizedPath)) continue;
      paths.add(normalizedPath);
    } catch {
      continue;
    }
  }
  return paths.size;
}

/** Best-effort slice where primary nav / header links usually live (not whole page). */
function sliceHeaderNavigationHtml(html: string): string {
  const lower = html.toLowerCase();
  let start = lower.indexOf("<header");
  if (start !== -1) {
    const end = lower.indexOf("</header>", start);
    return end === -1 ? html.slice(start, start + 90_000) : html.slice(start, end + 9);
  }
  const branded = lower.search(
    /<[^>]{1,500}(?:class|id)\s*=\s*["'][^"']*(?:site-header|main-header|top-header|page-header|navbar|masthead|primary-nav|desktop-nav)/i
  );
  if (branded >= 0) {
    return html.slice(branded, Math.min(html.length, branded + 55_000));
  }
  const bannerRole = lower.search(/role\s*=\s*["']banner["']/i);
  if (bannerRole >= 0) {
    const back = Math.max(0, bannerRole - 3_000);
    return html.slice(back, Math.min(html.length, bannerRole + 45_000));
  }
  start = lower.indexOf("<nav");
  if (start !== -1) {
    const end = lower.indexOf("</nav>", start);
    return end === -1 ? html.slice(start, start + 42_000) : html.slice(start, end + 6);
  }
  const body = lower.indexOf("<body");
  const from = body === -1 ? 0 : body;
  return html.slice(from, Math.min(html.length, from + 36_000));
}

function copyrightYearPlausible(y: number): boolean {
  const hi = new Date().getFullYear() + 1;
  return y >= 1996 && y <= hi;
}

/** Turn HTML entities into a real © so regex sees the same text browsers show. */
function normalizeHtmlForCopyrightScan(html: string): string {
  return html
    .replace(/&#0*169;/gi, "©")
    .replace(/&#x0*a9;/gi, "©")
    .replace(/&copy;/gi, "©");
}

/** Drop script/style/JSON-LD so we don't pick `copyrightYear` from schema or random JS strings. */
function stripCopyrightNoise(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");
}

/** Last semantic footer chunk (many themes omit `<footer>`). */
function sliceLikelyFooterBlock(lower: string): string | null {
  const idxFooter = lower.lastIndexOf("<footer");
  if (idxFooter !== -1) {
    const close = lower.indexOf("</footer>", idxFooter);
    const end = close === -1 ? Math.min(lower.length, idxFooter + 120_000) : close + 9;
    return lower.slice(idxFooter, end);
  }
  const markers = [
    'class="site-footer',
    "class='site-footer",
    'class="footer"',
    "class='footer",
    'id="footer"',
    "id='footer",
    "elementor-location-footer",
    'id="colophon"',
    "id='colophon'",
    "site-info",
    "footer-widget",
  ];
  let bestStart = -1;
  for (const mk of markers) {
    const i = lower.lastIndexOf(mk);
    if (i > bestStart) bestStart = i;
  }
  if (bestStart === -1) return null;
  return lower.slice(bestStart, Math.min(lower.length, bestStart + 80_000));
}

/**
 * Pick the copyright line that best matches the visible footer: older code used
 * String.match() → first "copyright 2015" in body/schema wins over "© 2026" in the footer.
 * We scan (tail first on long pages) and keep the match whose span ends in the latest year.
 */
function extractCopyrightBestFromLower(lower: string): { display: string; oldFlag: "yes" | "no" | "" } {
  let bestHi = -1;
  let bestLo = 0;
  let bestDisplay = "";

  const sym = /(?:©|\(c\)|copyright)\s*(\d{4})(?:\s*[-–]\s*(\d{4}))?/gi;
  let m: RegExpExecArray | null;
  while ((m = sym.exec(lower)) !== null) {
    const y1 = parseInt(m[1], 10);
    const y2 = m[2] ? parseInt(m[2], 10) : NaN;
    if (!copyrightYearPlausible(y1)) continue;
    const lo = Number.isNaN(y2) ? y1 : Math.min(y1, y2);
    const hi = Number.isNaN(y2) ? y1 : Math.max(y1, y2);
    if (!copyrightYearPlausible(hi)) continue;
    if (hi > bestHi) {
      bestHi = hi;
      bestLo = lo;
      bestDisplay = Number.isNaN(y2) ? String(y1) : `${lo}-${hi}`;
    }
  }

  const bare = /\bcopyright\s+(\d{4})\b/gi;
  while ((m = bare.exec(lower)) !== null) {
    const y = parseInt(m[1], 10);
    if (!copyrightYearPlausible(y)) continue;
    if (y > bestHi) {
      bestHi = y;
      bestLo = y;
      bestDisplay = String(y);
    }
  }

  if (bestHi < 0) return { display: "", oldFlag: "" };
  const oldFlag = bestLo <= OLD_COPYRIGHT_YEAR && bestHi <= OLD_COPYRIGHT_YEAR ? "yes" : "no";
  return { display: bestDisplay, oldFlag };
}

function extractCopyrightDisplay(html: string): { display: string; oldFlag: "yes" | "no" | "" } {
  const stripped = stripCopyrightNoise(html);
  const normalized = normalizeHtmlForCopyrightScan(stripped);
  const lower = normalized.toLowerCase();

  const foot = sliceLikelyFooterBlock(lower);
  if (foot) {
    const fromFoot = extractCopyrightBestFromLower(foot);
    if (fromFoot.display) return fromFoot;
  }

  // Avoid scanning the whole document (body copy, old blog lines, etc. → fake "© 2015").
  const MICRO_TAIL = 22_000;
  const WIDE_TAIL = 70_000;

  if (lower.length <= MICRO_TAIL) {
    return extractCopyrightBestFromLower(lower);
  }

  const micro = lower.slice(-MICRO_TAIL);
  const fromMicro = extractCopyrightBestFromLower(micro);
  if (fromMicro.display) return fromMicro;

  const wide = lower.slice(-WIDE_TAIL);
  return extractCopyrightBestFromLower(wide);
}

function detectBuilder(html: string): string {
  const h = html.toLowerCase();
  if (h.includes("powered by wix") || h.includes("wix.com/static")) return "wix";
  if (h.includes("powered by squarespace") || h.includes("squarespace.com")) return "squarespace";
  if (h.includes("godaddy website builder") || h.includes("websites.godaddy.com")) return "godaddy_builder";
  if (h.includes("powered by weebly") || h.includes("weeblycloud.com")) return "weebly";
  return "";
}

function detectTechSignals(html: string): string[] {
  const h = html.toLowerCase();
  const signals: string[] = [];
  if (h.includes("static.wixstatic.com") || h.includes("wix.com")) signals.push("wix_script");
  if (h.includes("squarespace-cdn") || h.includes("squarespace.com")) signals.push("squarespace_static");
  if (h.includes("weebly.com") || h.includes("weeblycloud.com")) signals.push("weebly");
  if (h.includes("godaddy.com") && h.includes("wsimg")) signals.push("godaddy_assets");
  if (h.includes("shopify.com") || h.includes("cdn.shopify.com")) signals.push("shopify");
  if (h.includes("wp-content") || h.includes("wp-includes")) signals.push("wordpress");
  return signals;
}

function detectCaptchaSignals(html: string): string[] {
  const h = html.toLowerCase();
  const signals: string[] = [];
  if (h.includes("recaptcha") || h.includes("g-recaptcha") || h.includes("google.com/recaptcha")) {
    signals.push("recaptcha");
  }
  if (h.includes("hcaptcha")) {
    signals.push("hcaptcha");
  }
  if (h.includes("challenges.cloudflare.com/turnstile") || h.includes("cf-turnstile")) {
    signals.push("turnstile");
  }
  return signals;
}

/** Avoid obvious non-agency phrases */
const NEGATIVE_AGENCY_CONTEXT = /designed by\s+(nature|us|you|hand|god|evolution)\b/i;

function detectAgencyCredit(html: string): { match: boolean; snippet: string } {
  if (NEGATIVE_AGENCY_CONTEXT.test(html)) {
    // Still allow if a stronger pattern matches later
  }

  const patterns: RegExp[] = [
    /\b(?:website|web\s*site|site)\s+by\s+([A-Za-z0-9][A-Za-z0-9\s&'.-]{2,60})/i,
    /\bweb\s*design(?:ed)?\s+by\s+([A-Za-z0-9][A-Za-z0-9\s&'.-]{2,60})/i,
    /\b(?:designed|built|developed)\s+by\s+([A-Za-z0-9][A-Za-z0-9\s&'.-]{2,60})/i,
    /\b(?:digital\s+agency|marketing\s+agency)\s*[:\-]\s*([A-Za-z0-9][A-Za-z0-9\s&'.-]{2,60})/i,
  ];

  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[0] && m[1]) {
      const full = m[0].replace(/\s+/g, " ").trim();
      const snippet = full.length > 90 ? `${full.slice(0, 87)}...` : full;
      if (NEGATIVE_AGENCY_CONTEXT.test(snippet)) continue;
      if (!/[a-z]{2,}/i.test(m[1])) continue;
      return { match: true, snippet };
    }
  }

  return { match: false, snippet: "" };
}

function extractSitemapUrlsFromRobots(robotsText: string): string[] {
  const urls: string[] = [];
  for (const line of robotsText.split(/\r?\n/)) {
    const m = line.match(/^\s*Sitemap:\s*(.+)\s*$/i);
    if (m?.[1]) urls.push(m[1].trim());
  }
  return urls;
}

function countLocInSitemap(xml: string): number {
  let n = 0;
  const re = /<loc>\s*([^<]+)\s*<\/loc>/gi;
  while (re.exec(xml) !== null) {
    n++;
    if (n >= MAX_URLS_COUNTED) break;
  }
  return n;
}

function extractSitemapIndexHrefs(xml: string): string[] {
  const hrefs: string[] = [];
  const re = /<loc>\s*([^<]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const u = (m[1] || "").trim();
    if (u && /\.xml(\?|$)/i.test(u)) hrefs.push(u);
    if (hrefs.length >= 8) break;
  }
  return hrefs;
}

function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

async function tryCountUrlsFromSitemap(
  sitemapUrl: string,
  signal: AbortSignal,
  depth: 0 | 1
): Promise<number> {
  const { text, ok } = await fetchBoundedText(sitemapUrl, MAX_SITEMAP_BYTES, signal);
  if (!ok || !text) return -1;

  if (isSitemapIndex(text)) {
    if (depth >= 1) return -1;
    const childUrls = extractSitemapIndexHrefs(text);
    let total = 0;
    for (const child of childUrls) {
      const c = await tryCountUrlsFromSitemap(child, signal, 1);
      if (c < 0) continue;
      total += c;
      if (total >= MAX_URLS_COUNTED) return MAX_URLS_COUNTED;
    }
    return total > 0 ? total : -1;
  }

  return countLocInSitemap(text);
}

/** Google returns 200 + login HTML for Sites/Docs links that are not public — do not treat as a real homepage. */
function htmlLooksLikeGoogleAccountWall(html: string): boolean {
  const h = html.slice(0, 220_000).toLowerCase();
  if (h.includes("accounts.google.com")) return true;
  if (h.includes("consent.google.com")) return true;
  if (h.includes("use your google account")) return true;
  if (h.includes("sign in") && h.includes("google accounts")) return true;
  if (h.includes("sign in") && h.includes("google account") && h.includes("forgot email")) return true;
  return false;
}

export async function enrichWebsite(startUrl: string): Promise<WebsiteEnrichment> {
  const empty = (): WebsiteEnrichment => ({
    enrichStatus: "skipped",
    copyrightYear: "",
    copyrightOldFlag: "",
    builderDetected: "",
    agencyCredit: "no",
    hasAgencyCredit: false,
    pageCountSource: "unknown",
    pageCountEstimate: "",
    lastModified: "",
    techSignals: "",
    hasCaptcha: false,
    captchaSignals: "",
    internalPathCount: 0,
    headerNavPathCount: 0,
    onePageHint: false,
  });

  let origin: URL;
  try {
    origin = new URL(startUrl);
  } catch {
    return empty();
  }

  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), ENRICH_TOTAL_MS);
  const signal = controller.signal;

  try {
    const homepageUrl = origin.toString();
    const home = await withTimeout(
      fetchBoundedText(homepageUrl, MAX_HTML_BYTES, signal),
      FETCH_TIMEOUT_MS + 1000,
      "home"
    );

    if (!home.ok || !home.text) {
      clearTimeout(deadline);
      return { ...empty(), enrichStatus: "partial" };
    }

    const html = home.text;
    if (htmlLooksLikeGoogleAccountWall(html)) {
      clearTimeout(deadline);
      return {
        enrichStatus: "skipped",
        copyrightYear: "",
        copyrightOldFlag: "",
        builderDetected: "",
        agencyCredit: "no",
        hasAgencyCredit: false,
        pageCountSource: "unknown",
        pageCountEstimate: "",
        lastModified: parseLastModifiedToIso(home.lastModified),
        techSignals: "google_sign_in_wall",
        hasCaptcha: false,
        captchaSignals: "",
        internalPathCount: 0,
        headerNavPathCount: 0,
        onePageHint: false,
      };
    }

    const finalBase = home.finalUrl || homepageUrl;
    const copyright = extractCopyrightDisplay(html);
    const builder = detectBuilder(html);
    const tech = detectTechSignals(html);
    const captchaSignals = detectCaptchaSignals(html);
    const agency = detectAgencyCredit(html);
    const internalPathCount = countInternalPaths(html, finalBase);
    const headerNavPathCount = countInternalPaths(sliceHeaderNavigationHtml(html), finalBase);

    let pageCountSource: PageCountSource = "unknown";
    let pageCountEstimate = "";
    let sitemapCount = -1;
    let distrustedSitemap = false;

    try {
      const robotsUrl = new URL("/robots.txt", origin).toString();
      const robots = await withTimeout(
        fetchBoundedText(robotsUrl, MAX_ROBOTS_BYTES, signal),
        FETCH_TIMEOUT_MS,
        "robots"
      );
      if (robots.ok && robots.text) {
        const sitemapList = extractSitemapUrlsFromRobots(robots.text);
        const candidates = [
          ...sitemapList,
          new URL("/sitemap.xml", origin).toString(),
          new URL("/sitemap_index.xml", origin).toString(),
        ];
        const seen = new Set<string>();
        for (const sm of candidates) {
          if (!sm || seen.has(sm)) continue;
          seen.add(sm);
          const n = await tryCountUrlsFromSitemap(sm, signal, 0);
          if (n >= 0) {
            sitemapCount = n;
            pageCountSource = "sitemap";
            pageCountEstimate = n >= MAX_URLS_COUNTED ? `${MAX_URLS_COUNTED}+` : String(n);
            break;
          }
        }
      }
    } catch {
      // ignore sitemap phase
    }

    if (sitemapCount < 0 && (html.includes("wp-content") || html.includes("wp-includes"))) {
      try {
        const wpMap = new URL("/wp-sitemap.xml", origin).toString();
        const n = await tryCountUrlsFromSitemap(wpMap, signal, 0);
        if (n >= 0) {
          sitemapCount = n;
          pageCountSource = "sitemap";
          pageCountEstimate = n >= MAX_URLS_COUNTED ? `${MAX_URLS_COUNTED}+` : String(n);
        }
      } catch {
        // ignore
      }
    }

    // `<loc>` counts every URL the CMS lists (tags, dates, junk). Nav links on the homepage are a better “how big is this site” guess.
    if (sitemapCount >= 0) {
      const hitCap = sitemapCount >= MAX_URLS_COUNTED;
      const hugeSitemapSmallNav =
        sitemapCount >= 50 &&
        internalPathCount <= 30 &&
        (internalPathCount === 0 || sitemapCount > internalPathCount * 4);
      if (hitCap || hugeSitemapSmallNav) {
        distrustedSitemap = true;
        pageCountSource = "html_links";
        pageCountEstimate =
          internalPathCount > 0 ? String(Math.max(internalPathCount, 1)) : "8";
      }
    }

    if (sitemapCount < 0) {
      pageCountSource = "html_links";
      pageCountEstimate = String(internalPathCount);
    }

    const onePageFromSitemap = !distrustedSitemap && sitemapCount === 1;
    const onePageFromLinks = (sitemapCount < 0 || distrustedSitemap) && internalPathCount <= 1;
    const onePageHint = onePageFromSitemap || onePageFromLinks;

    const agencyCredit = agency.match ? `yes | ${agency.snippet}` : "no";

    return {
      enrichStatus: "ok",
      copyrightYear: copyright.display,
      copyrightOldFlag: copyright.oldFlag,
      builderDetected: builder,
      agencyCredit,
      hasAgencyCredit: agency.match,
      pageCountSource,
      pageCountEstimate,
      lastModified: parseLastModifiedToIso(home.lastModified),
      techSignals: tech.join("|"),
      hasCaptcha: captchaSignals.length > 0,
      captchaSignals: captchaSignals.join("|"),
      internalPathCount,
      headerNavPathCount,
      onePageHint,
    };
  } catch {
    return { ...empty(), enrichStatus: "partial" };
  } finally {
    clearTimeout(deadline);
  }
}
