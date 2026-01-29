import { NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

/**
 * POST /api/runs/create
 * 
 * Input: { query: string, lat: number, lng: number, radiusMeters: number, locationName?: string }
 * 
 * Performs search and stores results in Firestore.
 */
export async function POST(req: Request) {
  let runId: string | undefined;
  try {
    const { query, lat, lng, radiusMeters, locationName } = await req.json();

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing GOOGLE_PLACES_API_KEY" }, { status: 500 });
    }

    const fieldMask =
      "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.rating,places.userRatingCount";

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

    // Generate random runId
    runId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    const searchedCount = places.length;

    // Create search run document
    await db.doc(`searchRuns/${runId}`).set({
      query,
      lat,
      lng,
      radiusMeters,
      locationName: locationName || null,
      resultCount: searchedCount,
      createdAt: FieldValue.serverTimestamp(),
    });

    // Process each place and save to Firestore (search fields only)
    for (let i = 0; i < places.length; i++) {
      const place = places[i];
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

