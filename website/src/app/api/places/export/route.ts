import { NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

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

    const hasWebsiteUri = (place: any): boolean =>
      !!(place?.websiteUri && String(place.websiteUri).trim() !== "");

    // Fetch place documents from Firestore, keep search rank for stable ordering
    const placesWithRank: { place: any; rank: number }[] = [];
    for (let i = 0; i < placeIds.length; i++) {
      const placeId = placeIds[i];
      const rank = resultsSnapshot.docs[i]?.data()?.rank ?? i + 1;
      try {
        const placeDoc = await db.doc(`places/${placeId}`).get();
        if (placeDoc.exists) {
          placesWithRank.push({ place: placeDoc.data(), rank });
        }
      } catch (e) {
        console.error(`Error fetching place ${placeId}:`, e);
      }
    }

    // Rows with a website first (for manual site QA); no-site rows at the bottom
    placesWithRank.sort((a, b) => {
      const wa = hasWebsiteUri(a.place) ? 0 : 1;
      const wb = hasWebsiteUri(b.place) ? 0 : 1;
      if (wa !== wb) return wa - wb;
      return (a.rank ?? 0) - (b.rank ?? 0);
    });

    const places = placesWithRank.map((x) => x.place);

    // Build CSV
    const escapeCsv = (value: any): string => {
      if (value === null || value === undefined) return "";
      const str = String(value);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    // Helper to create Google Search URL from business name
    const createGoogleSearchUrl = (name: string): string => {
      if (!name || !name.trim()) return "";
      // Normalize: trim, remove non-alphanumeric except spaces, then replace spaces with +
      const normalized = name
        .trim()
        .replace(/[^a-zA-Z0-9\s]/g, "")
        .replace(/\s+/g, "+");
      return `https://www.google.com/search?q=${normalized}`;
    };

    const headers = ["name", "rating", "userRatingCount", "formattedAddress", "types", "has_website", "googleSearchUrl"];
    const rows = places.map((place) => {
      const name = place.name || "";
      const types = Array.isArray(place.types) ? place.types.join("; ") : "";
      const googleSearchUrl = createGoogleSearchUrl(name);
      const hasWebsite = place.websiteUri && place.websiteUri.trim() !== "" ? "true" : "false";
      return [
        escapeCsv(name),
        escapeCsv(place.rating || ""),
        escapeCsv(place.userRatingCount || ""),
        escapeCsv(place.formattedAddress || ""),
        escapeCsv(types),
        escapeCsv(hasWebsite),
        escapeCsv(googleSearchUrl),
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
  } catch (e: any) {
    console.error("places export error:", e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

