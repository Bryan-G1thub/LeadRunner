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
      return {
        runId: doc.id,
        query: data.query || "",
        locationName: data.locationName || "",
        lat: data.lat || null,
        lng: data.lng || null,
        radiusMeters: data.radiusMeters || 0,
        resultCount: data.resultCount || 0,
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
