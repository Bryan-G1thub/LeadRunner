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

    // Get placeIds from results
    const placeIds = resultsSnapshot.docs.map((doc) => doc.data().placeId);

    // Fetch place documents from Firestore
    const places: any[] = [];
    for (const placeId of placeIds) {
      try {
        const placeDoc = await db.doc(`places/${placeId}`).get();
        if (placeDoc.exists) {
          places.push(placeDoc.data());
        }
      } catch (e) {
        console.error(`Error fetching place ${placeId}:`, e);
      }
    }

    // Sort places alphabetically by name (case-insensitive)
    places.sort((a, b) => {
      const nameA = (a.name || "").toLowerCase();
      const nameB = (b.name || "").toLowerCase();
      return nameA.localeCompare(nameB);
    });

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

