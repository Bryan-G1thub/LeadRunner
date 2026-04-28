import { NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { lookup } from "node:dns/promises";

type WebsiteClass = "functional" | "one_page" | "facebook" | "broken_domain" | "no_website";

type TriageResult = {
  websiteClass: WebsiteClass;
  triageNote: string;
  normalizedWebsiteUri: string;
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

const TRIAGE_SORT_PRIORITY: Record<WebsiteClass, number> = {
  functional: 0,
  one_page: 1,
  facebook: 2,
  broken_domain: 3,
  no_website: 4,
};

const REQUEST_TIMEOUT_MS = 10000;
const ONE_PAGE_INTERNAL_LINK_THRESHOLD = 1;

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

function isFacebookHostname(hostname: string): boolean {
  return (
    hostname === "facebook.com" ||
    hostname === "www.facebook.com" ||
    hostname === "m.facebook.com" ||
    hostname.endsWith(".facebook.com") ||
    hostname === "fb.me"
  );
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

async function fetchHealthStatus(url: string): Promise<{ kind: "healthy" | "broken" | "error"; note: string }> {
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
    } catch {
      // Retry once on transient network/TLS issues before classifying.
    }
  }

  return { kind: "error", note: "DOMAIN_ERR" };
}

async function checkDomainHealth(url: string): Promise<{ isBroken: boolean; note: string }> {
  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { isBroken: true, note: "DOMAIN_ERR" };
  }

  // Treat hard DNS failures as a definitive broken domain.
  try {
    await lookup(hostname);
  } catch (err: unknown) {
    const code = typeof err === "object" && err && "code" in err ? String((err as { code?: unknown }).code) : "";
    if (code === "ENOTFOUND") {
      return { isBroken: true, note: "DOMAIN_ERR" };
    }
    // Other resolver errors can be transient; don't auto-mark as broken.
  }

  const candidateUrls = [url];
  const alternateProtocol = swapProtocol(url);
  if (alternateProtocol && alternateProtocol !== url) {
    candidateUrls.push(alternateProtocol);
  }

  for (const candidate of candidateUrls) {
    const result = await fetchHealthStatus(candidate);
    if (result.kind === "healthy") {
      return { isBroken: false, note: "" };
    }
    if (result.kind === "broken") {
      return { isBroken: true, note: result.note };
    }
  }

  // Network-level failures without hard DNS/HTTP evidence are inconclusive;
  // prefer avoiding false positives over over-flagging.
  return { isBroken: false, note: "" };
}

function countInternalNavigationLinks(html: string, baseUrl: string): number {
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
      const looksLikeAsset = /\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|pdf|xml|txt|woff2?|ttf|eot)$/i.test(
        normalizedPath
      );
      if (looksLikeAsset) continue;

      paths.add(normalizedPath);
    } catch {
      continue;
    }
  }

  return paths.size;
}

async function detectOnePageSite(url: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(url, "GET");
    if (!response.ok) return false;

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("text/html")) return false;

    const html = await response.text();
    const internalLinkCount = countInternalNavigationLinks(html, response.url || url);
    return internalLinkCount <= ONE_PAGE_INTERNAL_LINK_THRESHOLD;
  } catch {
    return false;
  }
}

async function classifyWebsite(
  websiteUri: unknown,
  hostHealthCache: Map<string, Promise<{ isBroken: boolean; note: string }>>
): Promise<TriageResult> {
  const normalizedWebsiteUri = normalizeWebsiteUri(websiteUri);
  if (!normalizedWebsiteUri) {
    return {
      websiteClass: "no_website",
      triageNote: "NO_SITE",
      normalizedWebsiteUri,
    };
  }

  const hostname = getHostname(normalizedWebsiteUri);
  if (hostname && isFacebookHostname(hostname)) {
    return {
      websiteClass: "facebook",
      triageNote: "FB",
      normalizedWebsiteUri,
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
    };
  }

  const isOnePage = await detectOnePageSite(normalizedWebsiteUri);
  if (isOnePage) {
    return {
      websiteClass: "one_page",
      triageNote: "ONE_PAGE",
      normalizedWebsiteUri,
    };
  }

  return {
    websiteClass: "functional",
    triageNote: "",
    normalizedWebsiteUri,
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
    const triagedRows = await Promise.all(
      placesWithRank.map(async ({ place, rank }) => {
        const triage = await classifyWebsite(place.websiteUri, hostHealthCache);
        return { place, rank, triage };
      })
    );

    triagedRows.sort((a, b) => {
      const aPriority = TRIAGE_SORT_PRIORITY[a.triage.websiteClass];
      const bPriority = TRIAGE_SORT_PRIORITY[b.triage.websiteClass];
      if (aPriority !== bPriority) return aPriority - bPriority;
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
      "websiteClass",
      "triageNote",
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
        escapeCsv(triage.websiteClass),
        escapeCsv(triage.triageNote),
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

