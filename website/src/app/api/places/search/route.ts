import { NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

export async function POST(req: Request) {
  try {
    const { query, lat, lng, radiusMeters } = await req.json();

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing GOOGLE_PLACES_API_KEY" }, { status: 500 });
    }

    const resp = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.rating,places.userRatingCount",
      },
      body: JSON.stringify({
        textQuery: query,
        locationBias: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: radiusMeters,
          },
        },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return new NextResponse(text, {
        status: resp.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const places = data.places || [];

    // Generate random runId
    const runId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    // Create search run document
    await db.doc(`searchRuns/${runId}`).set({
      query,
      lat,
      lng,
      radiusMeters,
      createdAt: FieldValue.serverTimestamp(),
    });

    // Process each place
    for (let i = 0; i < places.length; i++) {
      const place = places[i];
      const placeId = place.id;

      // Upsert place document
      await db.doc(`places/${placeId}`).set(
        {
          id: placeId,
          displayName: place.displayName?.text || "",
          formattedAddress: place.formattedAddress || "",
          location: place.location || null,
          types: place.types || [],
          rating: place.rating || null,
          userRatingCount: place.userRatingCount || null,
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
      runId,
      count: places.length,
      places,
    });
  } catch (e: any) {
    console.error("places search error:", e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

