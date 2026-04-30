import { NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { enrichWebsite, type WebsiteEnrichment } from "@/lib/websiteEnrichment";

type WebsiteClass = "agency_site" | "functional" | "one_page" | "facebook" | "broken_domain" | "no_website";

type TriageResult = {
  websiteClass: WebsiteClass;
  triageNote: string;
  normalizedWebsiteUri: string;
  enrichment: WebsiteEnrichment | null;
};

type PlaceRecord = {
  name?: string;
  rating?: number | null;
  userRatingCount?: number | null;
  formattedAddress?: string;
  websiteUri?: string | null;
  nationalPhoneNumber?: string | null;
  internationalPhoneNumber?: string | null;
};

/** Lower tier number = earlier rows in CSV (more “logical” outreach order). */
const TRIAGE_SORT_PRIORITY: Record<WebsiteClass, number> = {
  no_website: 0,
  broken_domain: 1,
  facebook: 2,
  functional: 3,
  one_page: 4,
  agency_site: 5,
};

/** Wix / DIY builders only — not Squarepress/WordPress (many legit nice sites use those). */
const BAD_BUILDER_SET = new Set(["wix", "godaddy_builder", "weebly"]);

function maxCopyrightYear(display: string): number {
  if (!display) return 0;
  let maxY = 0;
  for (const m of display.matchAll(/\b(19|20)\d{2}\b/g)) {
    const y = parseInt(m[0], 10);
    if (!Number.isNaN(y)) maxY = Math.max(maxY, y);
  }
  return maxY;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

const REQUEST_TIMEOUT_MS = 10000;
const EXPORT_ENRICH_CONCURRENCY = 6;

function parsePageCountEstimate(value: string): number {
  const trimmed = (value || "").trim();
  if (!trimmed) return 0;
  const plusMatch = trimmed.match(/^(\d+)\+$/);
  if (plusMatch) return parseInt(plusMatch[1], 10) || 0;
  const direct = parseInt(trimmed, 10);
  return Number.isNaN(direct) ? 0 : direct;
}

function isRecentIsoDate(value: string, daysWindow: number): boolean {
  if (!value) return false;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return false;
  const msWindow = daysWindow * 24 * 60 * 60 * 1000;
  return Date.now() - ts <= msWindow;
}

function getWebsiteClassForExport(triage: TriageResult): string {
  const enrichment = triage.enrichment;
  if (!enrichment) return triage.websiteClass;

  const builder = (enrichment.builderDetected || "").toLowerCase();
  if (builder === "wix") return "wix";
  if (builder === "wordpress") return "wordpress";
  if (builder) return builder;

  const techSignals = (enrichment.techSignals || "").toLowerCase();
  if (techSignals.split("|").includes("wordpress")) return "wordpress";

  return triage.websiteClass;
}

/** Sub-score added within tier; lower = earlier. */
function functionalHeuristicSubscore(e: WebsiteEnrichment): number {
  let h = 0;
  const b = (e.builderDetected || "").toLowerCase();
  const maxY = maxCopyrightYear(e.copyrightYear);
  const currentYear = new Date().getFullYear();
  const pages = parsePageCountEstimate(e.pageCountEstimate);
  const navPaths = e.internalPathCount ?? 0;
  const headerLinks = e.headerNavPathCount ?? 0;
  const noParsedCopyright = !e.copyrightYear?.trim();

  if (BAD_BUILDER_SET.has(b)) {
    // DIY/bad builders are prime upgrade leads: move them UP.
    h -= 220;
    if (e.copyrightOldFlag === "yes") h -= 140;
    if (maxY > 0 && maxY < currentYear - 3) h -= 120;
  } else {
    if (e.copyrightOldFlag === "yes") h -= 90;
    if (maxY > 0 && maxY <= 2018) h -= 50;
    // Current (or future) year in footer ≈ actively maintained — deprioritize hard vs dusty sites.
    if (maxY >= currentYear) {
      h += 480;
      if (pages >= 50) h += 140;
    } else if (maxY === currentYear - 1) {
      h += 240;
      if (pages >= 50) h += 80;
    } else if (maxY === currentYear - 2) {
      h += 110;
    }
  }

  // Tiny brochure sites (real 3–6 pages) → better leads; rise vs mega-menus / huge sitemaps.
  if (pages >= 1 && pages <= 6) h -= 105;
  if (pages >= 30 || navPaths >= 24) h += 100;
  if (noParsedCopyright && (pages >= 18 || navPaths >= 20)) h += 95;
  // “Established” brochure: enough URLs + enough homepage nav paths (town lists, mega-menus) → sink vs dusty micro-sites.
  if (pages >= 7 && pages <= 55 && navPaths >= 12) h += 60;
  if (navPaths >= 20 && pages >= 5) h += 50;
  // More distinct links in header / primary nav → more “built-out” site → sink vs crusty micro-sites.
  if (headerLinks >= 9) h += 95;
  else if (headerLinks >= 7) h += 72;
  else if (headerLinks >= 5) h += 48;
  else if (headerLinks >= 4) h += 26;

  if (e.hasCaptcha) h += 40;
  if (pages === 0) h += 30;

  return clamp(h, -420, 2600);
}

function onePageHeuristicSubscore(e: WebsiteEnrichment): number {
  let h = 50;
  const b = (e.builderDetected || "").toLowerCase();
  const maxY = maxCopyrightYear(e.copyrightYear);
  const currentYear = new Date().getFullYear();
  if (BAD_BUILDER_SET.has(b)) {
    // One-page + DIY/bad builder is also a strong lead signal.
    h -= 180;
    if (e.copyrightOldFlag === "yes") h -= 100;
    if (maxY > 0 && maxY < currentYear - 3) h -= 80;
  } else if (maxY >= currentYear) {
    h += 320;
  } else if (maxY === currentYear - 1) {
    h += 160;
  }
  if (e.hasCaptcha) h += 25;
  return clamp(h, 0, 1200);
}

/** Agency credit + “built” + fresh signals → sink to bottom of agency band (old © sites stay mostly unscathed). */
function agencyPolishedSink(e: WebsiteEnrichment): number {
  if (!e.hasAgencyCredit) return 0;
  const pages = parsePageCountEstimate(e.pageCountEstimate || "");
  const hdr = e.headerNavPathCount ?? 0;
  const nav = e.internalPathCount ?? 0;
  const maxY = maxCopyrightYear(e.copyrightYear || "");
  const cy = new Date().getFullYear();
  const recentHome = isRecentIsoDate(e.lastModified, 150);
  const staleFooter = maxY > 0 && maxY <= cy - 7;

  const builtOut =
    pages >= 16 || (hdr >= 5 && pages >= 8) || (nav >= 22 && pages >= 9) || (hdr >= 7 && pages >= 6);
  const footerVeryFresh = maxY >= cy;
  const footerRecent = maxY >= cy - 1;

  if (staleFooter) {
    let t = 0;
    if (builtOut && pages >= 22 && (hdr >= 6 || nav >= 24)) t += 140;
    return Math.min(t, 500);
  }

  let s = 0;
  if (footerVeryFresh && recentHome) s += 720;
  if (footerRecent && recentHome && builtOut) s += 520;
  if (builtOut && hdr >= 6) s += 480;
  if (builtOut && pages >= 14) s += 420;
  if (e.hasCaptcha && pages >= 10 && hdr >= 4) s += 260;
  if (!e.copyrightYear?.trim() && recentHome && builtOut && hdr >= 5) s += 360;

  return Math.min(s, 8200);
}

function agencyHeuristicSubscore(_triage: TriageResult, e: WebsiteEnrichment): number {
  let h = 0;
  const currentYear = new Date().getFullYear();
  const maxY = maxCopyrightYear(e.copyrightYear);

  const hasCurrentYearCopyright = e.copyrightYear
    .split("-")
    .some((part) => parseInt(part.trim(), 10) === currentYear);
  if (hasCurrentYearCopyright && isRecentIsoDate(e.lastModified, 180)) {
    h += 120;
  }

  // Aging footer (e.g. ©2020) = better lead among agency rows; rises within the agency band.
  if (maxY > 0 && maxY <= currentYear - 6) {
    h -= 520;
  } else if (maxY > 0 && maxY <= currentYear - 4) {
    h -= 380;
  } else if (maxY > 0 && maxY <= currentYear - 2) {
    h -= 220;
  }

  h += agencyPolishedSink(e);

  return h;
}

const TIER_SORT_SPAN = 10_000;

/** Almost no static nav + recent homepage Last-Modified + no parsed © often means JS footer (e.g. current year). */
function footerFreshHeuristic(e: WebsiteEnrichment | null): boolean {
  if (!e || e.copyrightYear?.trim()) return false;
  if (e.enrichStatus !== "ok") return false;
  if (!isRecentIsoDate(e.lastModified, 100)) return false;
  const pc = parsePageCountEstimate(e.pageCountEstimate || "");
  return e.internalPathCount <= 4 && pc <= 15;
}

/** Parsed © / copyright text includes this calendar year or later. */
function footerCurrentYearParsed(e: WebsiteEnrichment | null): boolean {
  if (!e?.copyrightYear?.trim()) return false;
  const maxY = maxCopyrightYear(e.copyrightYear);
  if (maxY <= 0) return false;
  return maxY >= new Date().getFullYear();
}

/** Footer shows this year or later → always last rows in CSV (after everyone else). */
function hasFooterCurrentOrFutureYear(e: WebsiteEnrichment | null): boolean {
  return footerCurrentYearParsed(e) || footerFreshHeuristic(e);
}

/** Google login / Google Sites host — useless as a “real” website; always after normal rows and after footer-current-year rows. */
function isGoogleJunkTriage(triage: TriageResult): boolean {
  const n = triage.triageNote || "";
  return n === "GOOGLE_AUTH" || n === "GOOGLE_SITES";
}

/** 0 = normal sort; 1 = footer current-year bucket; 2 = Google junk (dead bottom). */
function csvAbsoluteTailBucket(row: { triage: TriageResult; rank: number }): number {
  if (isGoogleJunkTriage(row.triage)) return 2;
  if (hasFooterCurrentOrFutureYear(row.triage.enrichment)) return 1;
  return 0;
}

function computeLeadSortScore(row: { triage: TriageResult; rank: number }): number {
  const { triage } = row;
  const enrichment = triage.enrichment;
  const tier = TRIAGE_SORT_PRIORITY[triage.websiteClass] ?? 99;
  let score = tier * TIER_SORT_SPAN;

  if (!enrichment) {
    return score + (row.rank ?? 0) * 1e-6;
  }

  let within = 500;
  if (triage.websiteClass === "functional") {
    within = 1000 + functionalHeuristicSubscore(enrichment);
  } else if (triage.websiteClass === "one_page") {
    within = 1000 + onePageHeuristicSubscore(enrichment);
  } else if (triage.websiteClass === "agency_site") {
    within = 1000 + agencyHeuristicSubscore(triage, enrichment);
  }

  score += clamp(within, 0, TIER_SORT_SPAN - 1);
  return score + (row.rank ?? 0) * 1e-6;
}

function buildNoteByComputer(triage: TriageResult): string {
  const notes: string[] = [];
  const displayClass = getWebsiteClassForExport(triage);
  notes.push(`class=${displayClass}`);

  if (triage.triageNote) {
    notes.push(`triage=${triage.triageNote}`);
  }

  const e = triage.enrichment;
  if (!e) return notes.join(" | ");

  if (e.copyrightYear) notes.push(`copyright=${e.copyrightYear}`);
  if (e.copyrightOldFlag) notes.push(`copyrightOld=${e.copyrightOldFlag}`);
  if (e.builderDetected) notes.push(`builder=${e.builderDetected}`);
  if (e.agencyCredit && e.agencyCredit !== "no") notes.push(`agencyCredit=${e.agencyCredit}`);
  if (e.pageCountEstimate) notes.push(`pageCount=${e.pageCountEstimate}`);
  if (e.headerNavPathCount > 0) notes.push(`headerLinks=${e.headerNavPathCount}`);
  notes.push(`captcha=${e.hasCaptcha ? "yes" : "no"}`);
  if (e.enrichStatus) notes.push(`enrich=${e.enrichStatus}`);
  if (hasFooterCurrentOrFutureYear(e)) {
    notes.push("sortBucket=footer_current_year_last");
    if (footerFreshHeuristic(e)) {
      notes.push("footerYear=guess_recent_home");
    }
  }

  return notes.join(" | ");
}

function normalizeWebsiteUri(input: unknown): string {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function hostnameEndsWithDomain(hostname: string, domain: string): boolean {
  const h = hostname.toLowerCase();
  const d = domain.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

/** Same export tier as Facebook: directory / social profile, not the business’s own site. */
function listingProfileTriageNote(normalizedUri: string): string | null {
  let host: string;
  let pathname = "/";
  try {
    const u = new URL(normalizedUri);
    host = u.hostname.toLowerCase();
    pathname = u.pathname || "/";
  } catch {
    return null;
  }

  if (host === "sites.google.com" || hostnameEndsWithDomain(host, "sites.google.com")) {
    return "GOOGLE_SITES";
  }
  if (
    hostnameEndsWithDomain(host, "facebook.com") ||
    host === "fb.me" ||
    hostnameEndsWithDomain(host, "fb.com")
  ) {
    return "FB";
  }
  if (hostnameEndsWithDomain(host, "instagram.com")) return "IG";
  if (hostnameEndsWithDomain(host, "mapquest.com")) return "MAPQUEST";
  if (hostnameEndsWithDomain(host, "yelp.com")) return "YELP";
  if (hostnameEndsWithDomain(host, "yellowpages.com")) return "YELLOWPAGES";
  if (hostnameEndsWithDomain(host, "superpages.com")) return "SUPERPAGES";
  if (hostnameEndsWithDomain(host, "dexknows.com")) return "DEXKNOWS";
  if (hostnameEndsWithDomain(host, "bbb.org")) return "BBB";
  if (hostnameEndsWithDomain(host, "manta.com")) return "MANTA";
  if (hostnameEndsWithDomain(host, "angi.com")) return "ANGI";
  if (hostnameEndsWithDomain(host, "homeadvisor.com")) return "HOMEADVISOR";
  if (hostnameEndsWithDomain(host, "thumbtack.com")) return "THUMBTACK";
  if (hostnameEndsWithDomain(host, "houzz.com")) return "HOUZZ";
  if (hostnameEndsWithDomain(host, "nextdoor.com")) return "NEXTDOOR";
  if (hostnameEndsWithDomain(host, "foursquare.com")) return "FOURSQUARE";
  if (hostnameEndsWithDomain(host, "tripadvisor.com")) return "TRIPADVISOR";
  if (hostnameEndsWithDomain(host, "linkedin.com")) return "LINKEDIN";
  if (hostnameEndsWithDomain(host, "apple.com") && pathname.includes("/maps/")) return "APPLE_MAPS";
  if (host === "maps.google.com") return "GMAPS";
  if ((host === "www.google.com" || host === "google.com") && pathname.startsWith("/maps")) return "GMAPS";
  if (hostnameEndsWithDomain(host, "g.page")) return "GBUSINESS";
  if (hostnameEndsWithDomain(host, "business.site")) return "GBUSINESS";
  if (hostnameEndsWithDomain(host, "dot-services.org")) return "DOT_SERVICES";

  return null;
}

async function fetchWithTimeout(url: string, method: "HEAD" | "GET"): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LeadRunner/1.0)",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

function swapProtocol(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") {
      parsed.protocol = "http:";
      return parsed.toString();
    }
    if (parsed.protocol === "http:") {
      parsed.protocol = "https:";
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

type HealthStatusResult =
  | { kind: "healthy"; note: "" }
  | { kind: "broken"; note: "HTTP_404" | "HTTP_5XX" }
  | { kind: "error"; note: "DOMAIN_ERR"; errorCode: string };

function extractErrorCode(err: unknown): string {
  const fromErr =
    typeof err === "object" && err && "code" in err ? String((err as { code?: unknown }).code || "") : "";
  if (fromErr) return fromErr.toUpperCase();

  const fromCause =
    typeof err === "object" &&
    err &&
    "cause" in err &&
    typeof (err as { cause?: unknown }).cause === "object" &&
    (err as { cause?: unknown }).cause &&
    "code" in ((err as { cause?: { code?: unknown } }).cause as { code?: unknown })
      ? String(((err as { cause?: { code?: unknown } }).cause as { code?: unknown }).code || "")
      : "";
  if (fromCause) return fromCause.toUpperCase();

  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (message.includes("enotfound") || message.includes("name not resolved")) return "ENOTFOUND";
  if (message.includes("eai_again")) return "EAI_AGAIN";
  return "UNKNOWN";
}

async function fetchHealthStatus(url: string): Promise<HealthStatusResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      let response = await fetchWithTimeout(url, "HEAD");
      if (response.status === 405 || response.status === 501) {
        response = await fetchWithTimeout(url, "GET");
      }

      if (response.status === 404 || response.status === 410) {
        return { kind: "broken", note: "HTTP_404" };
      }

      if (response.status >= 500) {
        return { kind: "broken", note: "HTTP_5XX" };
      }

      return { kind: "healthy", note: "" };
    } catch (err: unknown) {
      if (attempt === 1) {
        return {
          kind: "error",
          note: "DOMAIN_ERR",
          errorCode: extractErrorCode(err),
        };
      }
      // Retry once on transient network/TLS issues before classifying.
    }
  }

  return { kind: "error", note: "DOMAIN_ERR", errorCode: "UNKNOWN" };
}

async function checkDomainHealth(url: string): Promise<{ isBroken: boolean; note: string }> {
  const candidateUrls = [url];
  const alternateProtocol = swapProtocol(url);
  if (alternateProtocol && alternateProtocol !== url) {
    candidateUrls.push(alternateProtocol);
  }

  const errorCodes: string[] = [];
  for (const candidate of candidateUrls) {
    const result = await fetchHealthStatus(candidate);
    if (result.kind === "healthy") {
      return { isBroken: false, note: "" };
    }
    if (result.kind === "broken") {
      return { isBroken: true, note: result.note };
    }
    if (result.kind === "error") {
      errorCodes.push(result.errorCode);
    }
  }

  // DOMAIN_ERR auto-flagging is intentionally disabled due to high false-positive risk.
  // We only mark broken_domain on explicit HTTP evidence (404/410/5xx).

  // Inconclusive network/protection failures should not be auto-marked broken.
  return { isBroken: false, note: "" };
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  }

  const n = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

async function classifyWebsite(
  websiteUri: unknown,
  hostHealthCache: Map<string, Promise<{ isBroken: boolean; note: string }>>,
  enrichCache: Map<string, Promise<WebsiteEnrichment>>
): Promise<TriageResult> {
  const normalizedWebsiteUri = normalizeWebsiteUri(websiteUri);
  if (!normalizedWebsiteUri) {
    return {
      websiteClass: "no_website",
      triageNote: "NO_SITE",
      normalizedWebsiteUri,
      enrichment: null,
    };
  }

  const hostname = getHostname(normalizedWebsiteUri);
  const listingNote = listingProfileTriageNote(normalizedWebsiteUri);
  if (listingNote) {
    return {
      websiteClass: "facebook",
      triageNote: listingNote,
      normalizedWebsiteUri,
      enrichment: null,
    };
  }

  const cacheKey = hostname || normalizedWebsiteUri;
  if (!hostHealthCache.has(cacheKey)) {
    hostHealthCache.set(cacheKey, checkDomainHealth(normalizedWebsiteUri));
  }

  const health = await hostHealthCache.get(cacheKey)!;
  if (health.isBroken) {
    return {
      websiteClass: "broken_domain",
      triageNote: health.note || "DOMAIN_ERR",
      normalizedWebsiteUri,
      enrichment: null,
    };
  }

  // Full URL: same host can serve different sites (e.g. sites.google.com/… paths).
  const enrichKey = normalizedWebsiteUri.toLowerCase();
  if (!enrichCache.has(enrichKey)) {
    enrichCache.set(enrichKey, enrichWebsite(normalizedWebsiteUri));
  }
  const enrichment = await enrichCache.get(enrichKey)!;

  const techBits = (enrichment.techSignals || "")
    .toLowerCase()
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  if (techBits.includes("google_sign_in_wall")) {
    return {
      websiteClass: "facebook",
      triageNote: "GOOGLE_AUTH",
      normalizedWebsiteUri,
      enrichment: null,
    };
  }

  if (enrichment.hasAgencyCredit) {
    return {
      websiteClass: "agency_site",
      triageNote: "AGENCY",
      normalizedWebsiteUri,
      enrichment,
    };
  }

  if (enrichment.onePageHint) {
    return {
      websiteClass: "one_page",
      triageNote: "ONE_PAGE",
      normalizedWebsiteUri,
      enrichment,
    };
  }

  return {
    websiteClass: "functional",
    triageNote: "",
    normalizedWebsiteUri,
    enrichment,
  };
}

/**
 * POST /api/places/export
 * 
 * Input: { "runId": string }
 * 
 * Example curl:
 * curl -X POST http://localhost:3000/api/places/export \
 *   -H "Content-Type: application/json" \
 *   -d '{"runId": "abc123"}' \
 *   --output leads.csv
 */
export async function POST(req: Request) {
  try {
    const { runId } = await req.json();

    if (!runId) {
      return NextResponse.json({ error: "Missing runId" }, { status: 400 });
    }

    // Get run document to access query, location, radius for filename
    const runDoc = await db.doc(`searchRuns/${runId}`).get();
    if (!runDoc.exists) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const runData = runDoc.data();
    const query = runData?.query || "";
    const radiusMeters = runData?.radiusMeters || 0;
    
    // Handle both single location and batch coords schemas
    let locationName = runData?.locationName || "";
    let lat = runData?.lat || "";
    let lng = runData?.lng || "";
    let coordCount = 1;
    
    if (Array.isArray(runData?.lats) && runData.lats.length > 0) {
      coordCount = runData.lats.length;
      lat = runData.lats[0];
      lng = runData.lngs?.[0] || "";
      if (Array.isArray(runData?.locationNames) && runData.locationNames[0]) {
        locationName = runData.locationNames[0];
      }
    }

    // Get results from searchRuns/{runId}/results in rank order
    const resultsSnapshot = await db
      .collection(`searchRuns/${runId}/results`)
      .orderBy("rank")
      .get();

    if (resultsSnapshot.empty) {
      return NextResponse.json({ error: "No results found for this runId" }, { status: 404 });
    }

    // Get placeIds from results (same order as rank)
    const placeIds = resultsSnapshot.docs.map((doc) => doc.data().placeId);

    // Fetch place documents from Firestore, keep search rank for stable ordering
    const placesWithRank: { place: PlaceRecord; rank: number }[] = [];
    for (let i = 0; i < placeIds.length; i++) {
      const placeId = placeIds[i];
      const rank = resultsSnapshot.docs[i]?.data()?.rank ?? i + 1;
      try {
        const placeDoc = await db.doc(`places/${placeId}`).get();
        if (placeDoc.exists) {
          placesWithRank.push({ place: placeDoc.data() as PlaceRecord, rank });
        }
      } catch (e) {
        console.error(`Error fetching place ${placeId}:`, e);
      }
    }

    const hostHealthCache = new Map<string, Promise<{ isBroken: boolean; note: string }>>();
    const enrichCache = new Map<string, Promise<WebsiteEnrichment>>();

    const triagedRows = await mapPool(placesWithRank, EXPORT_ENRICH_CONCURRENCY, async ({ place, rank }) => {
      const triage = await classifyWebsite(place.websiteUri, hostHealthCache, enrichCache);
      return { place, rank, triage };
    });

    triagedRows.sort((a, b) => {
      const aTail = csvAbsoluteTailBucket(a);
      const bTail = csvAbsoluteTailBucket(b);
      if (aTail !== bTail) return aTail - bTail;

      const aScore = computeLeadSortScore(a);
      const bScore = computeLeadSortScore(b);
      if (aScore !== bScore) return aScore - bScore;

      const aPageCount = parsePageCountEstimate(a.triage.enrichment?.pageCountEstimate || "");
      const bPageCount = parsePageCountEstimate(b.triage.enrichment?.pageCountEstimate || "");
      if (aPageCount === 0 && bPageCount !== 0) return 1;
      if (bPageCount === 0 && aPageCount !== 0) return -1;

      return (a.rank ?? 0) - (b.rank ?? 0);
    });

    // Build CSV
    const escapeCsv = (value: unknown): string => {
      if (value === null || value === undefined) return "";
      const str = String(value);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const headers = [
      "name",
      "rating",
      "userRatingCount",
      "formattedAddress",
      "phoneNumber",
      "websiteUri",
      "noteByComputer",
    ];

    const rows = triagedRows.map(({ place, triage }) => {
      const name = place.name || "";
      const phoneNumber = place.internationalPhoneNumber ?? place.nationalPhoneNumber ?? "";
      return [
        escapeCsv(name),
        escapeCsv(place.rating || ""),
        escapeCsv(place.userRatingCount || ""),
        escapeCsv(place.formattedAddress || ""),
        escapeCsv(phoneNumber),
        escapeCsv(triage.normalizedWebsiteUri),
        escapeCsv(buildNoteByComputer(triage)),
      ];
    });

    // Create filename from search context
    const sanitizeFilename = (str: string): string => {
      if (!str) return "";
      return str
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9\-]/g, "")
        .substring(0, 50);
    };
    
    // Use locationName if available, otherwise fall back to lat_lng
    let locationStr = "location";
    if (locationName) {
      locationStr = sanitizeFilename(locationName);
    } else if (lat && lng) {
      locationStr = `${lat}_${lng}`;
    }
    
    const queryStr = sanitizeFilename(query) || "query";
    const batchSuffix = coordCount > 1 ? `_${coordCount}locs` : "";
    const filename = `${queryStr}_${locationStr}_${radiusMeters}m${batchSuffix}.csv`;

    const csv = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");

    // Store CSV content in Firestore for later retrieval
    try {
      await db.doc(`searchRuns/${runId}`).update({
        csvContent: csv,
        csvFilename: filename,
        csvExportedAt: FieldValue.serverTimestamp(),
      });
    } catch (e) {
      console.error("Error storing CSV in Firestore:", e);
      // Don't fail the export if storage fails
    }

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e: unknown) {
    console.error("places export error:", e);
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

