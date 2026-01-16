import { NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

/**
 * POST /api/places/details-batch
 * 
 * Input: { "runId": string }
 * 
 * Fetches details for all places in a search run and updates Firestore.
 */
export async function POST(req: Request) {
  let runId: string | undefined;
  try {
    const body = await req.json();
    runId = body.runId;

    if (!runId) {
      return NextResponse.json({ error: "Missing runId" }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing GOOGLE_PLACES_API_KEY" }, { status: 500 });
    }

    // Set status to ENRICHING at start
    await db.doc(`searchRuns/${runId}`).update({
      status: "ENRICHING",
    });

    // Read results from searchRuns/{runId}/results ordered by rank
    const resultsSnapshot = await db
      .collection(`searchRuns/${runId}/results`)
      .orderBy("rank")
      .get();

    if (resultsSnapshot.empty) {
      await db.doc(`searchRuns/${runId}`).update({
        status: "ERROR",
        errorMessage: "No results found for this runId",
      });
      return NextResponse.json({ error: "No results found for this runId" }, { status: 404 });
    }

    const placeIds = resultsSnapshot.docs.map((doc) => doc.data().placeId);

    let updatedCount = 0;
    let failedCount = 0;
    const failures: Array<{ placeId: string; status: number }> = [];

    // Process with concurrency limit of 3
    const concurrencyLimit = 3;
    for (let i = 0; i < placeIds.length; i += concurrencyLimit) {
      const batch = placeIds.slice(i, i + concurrencyLimit);
      
      await Promise.all(
        batch.map(async (placeId) => {
          try {
            const resp = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
              method: "GET",
              headers: {
                "X-Goog-Api-Key": apiKey,
                "X-Goog-FieldMask":
                  "id,displayName,websiteUri,nationalPhoneNumber,businessStatus,rating,userRatingCount,formattedAddress,location,types",
              },
            });

            if (resp.ok) {
              const data = await resp.json();
              
              // Update Firestore with merge
              await db.doc(`places/${placeId}`).set(
                {
                  websiteUri: data.websiteUri || null,
                  nationalPhoneNumber: data.nationalPhoneNumber || null,
                  businessStatus: data.businessStatus || null,
                  detailsUpdatedAt: FieldValue.serverTimestamp(),
                },
                { merge: true }
              );
              
              updatedCount++;
            } else {
              failedCount++;
              failures.push({ placeId, status: resp.status });
            }
          } catch (e: any) {
            failedCount++;
            failures.push({ placeId, status: 500 });
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
      updatedCount,
      failedCount,
      failures,
    });
  } catch (e: any) {
    console.error("places details-batch error:", e);
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

