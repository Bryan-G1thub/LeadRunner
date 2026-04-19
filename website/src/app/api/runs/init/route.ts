import { NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

/**
 * POST /api/runs/init
 *
 * Initialize a batch run with multiple coordinates.
 * Input: { query, coords: [{lat, lng, locationName?}], radiusMeters, minRating?, minReviews?, maxReviews? }
 * Returns: { runId }
 */
export async function POST(req: Request) {
  try {
    const { query, coords, radiusMeters, minRating, minReviews, maxReviews } = await req.json();

    if (!query || !coords || !Array.isArray(coords) || coords.length === 0) {
      return NextResponse.json({ error: "Missing query or coords array" }, { status: 400 });
    }

    // Generate runId
    const runId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    // Extract arrays from coords
    const lats = coords.map((c: any) => c.lat);
    const lngs = coords.map((c: any) => c.lng);
    const locationNames = coords.map((c: any) => c.locationName || null);

    const minRev = minReviews != null && Number.isFinite(Number(minReviews)) ? Number(minReviews) : null;
    const maxRev = maxReviews != null && Number.isFinite(Number(maxReviews)) ? Number(maxReviews) : null;

    // Create run document with arrays for coords
    await db.doc(`searchRuns/${runId}`).set({
      query,
      lats,
      lngs,
      locationNames,
      radiusMeters,
      minRating: minRating != null ? minRating : null,
      minReviews: minRev,
      maxReviews: maxRev,
      resultCount: 0,
      totalFetched: 0,
      coordCount: coords.length,
      coordsProcessed: 0,
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true, runId });
  } catch (e: any) {
    console.error("init run error:", e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
