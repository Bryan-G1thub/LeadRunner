import { NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";

/**
 * GET /api/runs/list
 * 
 * Returns all search runs ordered by creation date (newest first)
 */
export async function GET() {
  try {
    const runsSnapshot = await db
      .collection("searchRuns")
      .orderBy("createdAt", "desc")
      .get();

    const runs = runsSnapshot.docs.map((doc) => {
      const data = doc.data();
      
      // Handle both single location (old) and batch coords (new) schemas
      let locationName = data.locationName || "";
      let lat = data.lat || null;
      let lng = data.lng || null;
      let coordCount = 1;
      
      // Check for batch coords (arrays)
      if (Array.isArray(data.lats) && data.lats.length > 0) {
        coordCount = data.lats.length;
        // For display, show first location or count
        if (Array.isArray(data.locationNames) && data.locationNames[0]) {
          locationName = coordCount > 1 
            ? `${data.locationNames[0]} (+${coordCount - 1} more)`
            : data.locationNames[0];
        } else {
          locationName = `${coordCount} locations`;
        }
        lat = data.lats[0];
        lng = data.lngs?.[0] || null;
      }
      
      return {
        runId: doc.id,
        query: data.query || "",
        locationName,
        lat,
        lng,
        radiusMeters: data.radiusMeters || 0,
        resultCount: data.resultCount || 0,
        coordCount,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
        status: data.status || null,
        errorMessage: data.errorMessage || null,
        hasCsv: data.csvContent ? true : false,
        csvFilename: data.csvFilename || null,
      };
    });

    return NextResponse.json({ runs });
  } catch (e: any) {
    console.error("runs list error:", e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
