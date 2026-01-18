import { NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

/**
 * POST /api/runs/create-and-enrich
 * 
 * Input: { query: string, lat: number, lng: number, radiusMeters: number, maxEnrich?: number }
 * 
 * Performs search and enrichment in one call.
 * maxEnrich defaults to 25 to cap enrichment costs.
 */
export async function POST(req: Request) {
  let runId: string | undefined;
  try {
    const { query, lat, lng, radiusMeters, maxEnrich = 25 } = await req.json();

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing GOOGLE_PLACES_API_KEY" }, { status: 500 });
    }

    // Perform Places Text Search
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
    runId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    // Create search run document with status ENRICHING
    await db.doc(`searchRuns/${runId}`).set({
      query,
      lat,
      lng,
      radiusMeters,
      createdAt: FieldValue.serverTimestamp(),
      status: "ENRICHING",
    });

    // Process each place and save to Firestore
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

    const searchedCount = places.length;
    const placeIds = places.map((p: any) => p.id);

    // Only enrich top N results (cost guardrail)
    const placeIdsToEnrich = placeIds.slice(0, maxEnrich);

    // Immediately perform enrichment
    let updatedCount = 0;
    let failedCount = 0;
    const failures: Array<{ placeId: string; status: number }> = [];

    // Process with concurrency limit of 3
    const concurrencyLimit = 3;
    for (let i = 0; i < placeIdsToEnrich.length; i += concurrencyLimit) {
      const batch = placeIdsToEnrich.slice(i, i + concurrencyLimit);

      await Promise.all(
        batch.map(async (placeId: string) => {
          try {
            const detailsResp = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
              method: "GET",
              headers: {
                "X-Goog-Api-Key": apiKey,
                "X-Goog-FieldMask":
                  "id,displayName,websiteUri,nationalPhoneNumber,businessStatus,rating,userRatingCount,formattedAddress,location,types",
              },
            });

            if (detailsResp.ok) {
              const detailsData = await detailsResp.json();

              // Update Firestore with merge
              await db.doc(`places/${placeId}`).set(
                {
                  websiteUri: detailsData.websiteUri || null,
                  nationalPhoneNumber: detailsData.nationalPhoneNumber || null,
                  businessStatus: detailsData.businessStatus || null,
                  detailsUpdatedAt: FieldValue.serverTimestamp(),
                },
                { merge: true }
              );

              updatedCount++;
            } else {
              failedCount++;
              if (failures.length < 10) {
                failures.push({ placeId, status: detailsResp.status });
              }
            }
          } catch (e: any) {
            failedCount++;
            if (failures.length < 10) {
              failures.push({ placeId, status: 500 });
            }
            console.error(`Error fetching details for ${placeId}:`, e);
          }
        })
      );
    }

    // Update status to ENRICHED after processing
    await db.doc(`searchRuns/${runId}`).update({
      status: "ENRICHED",
      enrichUpdatedCount: updatedCount,
      enrichFailedCount: failedCount,
      enrichFinishedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      ok: true,
      runId,
      searchedCount,
      updatedCount,
      failedCount,
      failures,
    });
  } catch (e: any) {
    console.error("create-and-enrich error:", e);
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

