import { NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

/**
 * POST /api/places/details
 * 
 * Input: { "placeId": string }
 * 
 * Example curl:
 * curl -X POST http://localhost:3000/api/places/details \
 *   -H "Content-Type: application/json" \
 *   -d '{"placeId": "ChIJN1t_tDeuEmsRUsoyG83frY4"}'
 */
export async function POST(req: Request) {
  try {
    const { placeId } = await req.json();

    if (!placeId) {
      return NextResponse.json({ error: "Missing placeId" }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing GOOGLE_PLACES_API_KEY" }, { status: 500 });
    }

    const resp = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "id,displayName,websiteUri,nationalPhoneNumber,rating,userRatingCount,formattedAddress,location,types,businessStatus",
      },
    });

    const text = await resp.text();

    // Update Firestore if the request was successful
    if (resp.ok) {
      try {
        const data = JSON.parse(text);
        await db.doc(`places/${placeId}`).set(
          {
            websiteUri: data.websiteUri || null,
            nationalPhoneNumber: data.nationalPhoneNumber || null,
            businessStatus: data.businessStatus || null,
            detailsUpdatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      } catch (e) {
        console.error("Error updating Firestore:", e);
        // Continue to return the response even if Firestore update fails
      }
    }

    return new NextResponse(text, {
      status: resp.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("places details error:", e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

