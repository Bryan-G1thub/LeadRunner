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

    const headers = ["name", "phone", "website", "rating", "userRatingCount", "formattedAddress", "hasWebsite", "hasPhone", "types"];
    const rows = places.map((place) => {
      const types = Array.isArray(place.types) ? place.types.join("; ") : "";
      const hasWebsite = !!(place.websiteUri && place.websiteUri.trim());
      const hasPhone = !!(place.nationalPhoneNumber && place.nationalPhoneNumber.trim());
      return [
        escapeCsv(place.displayName || ""),
        escapeCsv(place.nationalPhoneNumber || ""),
        escapeCsv(place.websiteUri || ""),
        escapeCsv(place.rating || ""),
        escapeCsv(place.userRatingCount || ""),
        escapeCsv(place.formattedAddress || ""),
        escapeCsv(hasWebsite ? "Yes" : "No"),
        escapeCsv(hasPhone ? "Yes" : "No"),
        escapeCsv(types),
      ];
    });

    const csv = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="leads.csv"',
      },
    });
  } catch (e: any) {
    console.error("places export error:", e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

