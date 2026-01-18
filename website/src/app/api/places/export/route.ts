import { NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";

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
    const lat = runData?.lat || "";
    const lng = runData?.lng || "";

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

    const headers = ["name", "rating", "userRatingCount", "formattedAddress", "types", "googleSearchUrl"];
    const rows = places.map((place) => {
      const name = place.name || "";
      const types = Array.isArray(place.types) ? place.types.join("; ") : "";
      const googleSearchUrl = createGoogleSearchUrl(name);
      return [
        escapeCsv(name),
        escapeCsv(place.rating || ""),
        escapeCsv(place.userRatingCount || ""),
        escapeCsv(place.formattedAddress || ""),
        escapeCsv(types),
        escapeCsv(googleSearchUrl),
      ];
    });

    // Create filename from search context
    const locationStr = lat && lng ? `${lat}_${lng}` : "location";
    const sanitizeFilename = (str: string): string => {
      return str
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9\-]/g, "")
        .substring(0, 50);
    };
    const filename = `${sanitizeFilename(query)}_${sanitizeFilename(locationStr)}_${radiusMeters}m_${runId}.csv`;

    const csv = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");

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

