import { NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

/**
 * POST /api/runs/create
 *
 * Input: { query, lat, lng, radiusMeters, locationName?, minRating?, minReviews?, maxReviews?, runId?, seenPlaceIds? }
 * - minRating: 0–5 (0.5 step), sent to Places API to filter by rating
 * - minReviews / maxReviews: applied after fetch; keep only places with userRatingCount in range
 * - runId: optional - if provided, appends results to existing run instead of creating new one
 * - seenPlaceIds: optional - array of placeIds already seen in batch; these will be skipped to save Firestore writes
 */
export async function POST(req: Request) {
  let runId: string | undefined;
  let isAppendMode = false;
  try {
    const { query, lat, lng, radiusMeters, locationName, minRating, minReviews, maxReviews, runId: providedRunId, seenPlaceIds } = await req.json();
    
    // Convert seenPlaceIds to a Set for O(1) lookups
    const seenSet = new Set<string>(Array.isArray(seenPlaceIds) ? seenPlaceIds : []);
    
    // If runId provided, we're appending to an existing run
    if (providedRunId) {
      runId = providedRunId;
      isAppendMode = true;
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing GOOGLE_PLACES_API_KEY" }, { status: 500 });
    }

    const fieldMask =
      "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.rating,places.userRatingCount,places.websiteUri,places.nationalPhoneNumber,places.internationalPhoneNumber";

    // Perform Places Text Search with pagination (collect all pages)
    const places: any[] = [];
    let pageToken: string | undefined;

    do {
      const body: Record<string, unknown> = pageToken
        ? { pageToken }
        : {
            textQuery: query,
            locationBias: {
              circle: {
                center: { latitude: lat, longitude: lng },
                radius: radiusMeters,
              },
            },
            ...(minRating != null && Number.isFinite(minRating) && { minRating: Number(minRating) }),
          };

      const resp = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": fieldMask,
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const text = await resp.text();
        return new NextResponse(text, {
          status: resp.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      const data = await resp.json();
      const pagePlaces = data.places || [];
      places.push(...pagePlaces);
      pageToken = data.nextPageToken || undefined;
    } while (pageToken);

    // Apply min/max review count filters (API does not support these; we filter after fetch)
    const minRev = minReviews != null && Number.isFinite(Number(minReviews)) ? Number(minReviews) : null;
    const maxRev = maxReviews != null && Number.isFinite(Number(maxReviews)) ? Number(maxReviews) : null;
    const filteredByReviews = places.filter((p: any) => {
      const count = p.userRatingCount ?? 0;
      if (minRev != null && count < minRev) return false;
      if (maxRev != null && count > maxRev) return false;
      return true;
    });

    // Filter out already-seen places (for batch dedup optimization)
    const filtered = filteredByReviews.filter((p: any) => !seenSet.has(p.id));
    const skippedDupes = filteredByReviews.length - filtered.length;
    
    // Track new placeIds to return to caller
    const newPlaceIds = filtered.map((p: any) => p.id);

    // Generate random runId if not in append mode
    if (!isAppendMode) {
      runId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }

    const searchedCount = filtered.length;
    const totalFetched = places.length;

    // Create or update search run document
    if (isAppendMode) {
      // Append mode: update counts by incrementing
      await db.doc(`searchRuns/${runId}`).update({
        resultCount: FieldValue.increment(searchedCount),
        totalFetched: FieldValue.increment(totalFetched),
        coordsProcessed: FieldValue.increment(1),
      });
    } else {
      // New run: create the document
      await db.doc(`searchRuns/${runId}`).set({
        query,
        lat,
        lng,
        radiusMeters,
        locationName: locationName || null,
        minRating: minRating != null ? minRating : null,
        minReviews: minRev ?? null,
        maxReviews: maxRev ?? null,
        resultCount: searchedCount,
        totalFetched,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    // Process each place and save to Firestore (search fields only)
    for (let i = 0; i < filtered.length; i++) {
      const place = filtered[i];
      const placeId = place.id;

      // Upsert place document with search fields only
      await db.doc(`places/${placeId}`).set(
        {
          placeId,
          name: place.displayName?.text || "",
          formattedAddress: place.formattedAddress || "",
          rating: place.rating || null,
          userRatingCount: place.userRatingCount || null,
          types: place.types || [],
          websiteUri: place.websiteUri || null,
          nationalPhoneNumber: place.nationalPhoneNumber ?? null,
          internationalPhoneNumber: place.internationalPhoneNumber ?? null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      // Create result document
      await db.doc(`searchRuns/${runId}/results/${placeId}`).set({
        placeId,
        rank: i + 1,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    return NextResponse.json({
      ok: true,
      runId,
      searchedCount,
      totalFetched,
      newPlaceIds,
      skippedDupes,
    });
  } catch (e: any) {
    console.error("create run error:", e);
    const errorMessage = String(e?.message || e);

    // Set status to ERROR on fatal error
    if (runId) {
      try {
        await db.doc(`searchRuns/${runId}`).update({
          status: "ERROR",
          errorMessage,
        });
      } catch (updateError) {
        console.error("Error updating Firestore with error status:", updateError);
      }
    }

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

