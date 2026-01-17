import { NextResponse } from "next/server";

/**
 * POST /api/geocode
 * 
 * Input: { "zipOrCity": string }
 * 
 * Returns: { lat: number, lng: number, formattedAddress: string }
 */
export async function POST(req: Request) {
  try {
    const { zipOrCity } = await req.json();

    if (!zipOrCity || typeof zipOrCity !== "string" || zipOrCity.trim().length === 0) {
      return NextResponse.json({ error: "Missing or invalid zipOrCity" }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing GOOGLE_PLACES_API_KEY" }, { status: 500 });
    }

    // Call Google Geocoding API
    const encodedQuery = encodeURIComponent(zipOrCity.trim());
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedQuery}&key=${apiKey}`;

    const resp = await fetch(url);

    if (!resp.ok) {
      return NextResponse.json({ error: "Geocoding API request failed" }, { status: resp.status });
    }

    const data = await resp.json();

    if (data.status !== "OK" || !data.results || data.results.length === 0) {
      return NextResponse.json(
        { error: `Geocoding failed: ${data.status || "No results found"}` },
        { status: 400 }
      );
    }

    const result = data.results[0];
    const location = result.geometry.location;

    return NextResponse.json({
      lat: location.lat,
      lng: location.lng,
      formattedAddress: result.formatted_address,
    });
  } catch (e: any) {
    console.error("geocode error:", e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

