import { NextResponse } from "next/server";

/**
 * POST /api/places/export
 * 
 * Input: { "placeIds": string[] }
 * 
 * Example curl:
 * curl -X POST http://localhost:3000/api/places/export \
 *   -H "Content-Type: application/json" \
 *   -d '{"placeIds": ["ChIJN1t_tDeuEmsRUsoyG83frY4", "ChIJ..."]}' \
 *   --output leads.csv
 */
export async function POST(req: Request) {
  try {
    const { placeIds } = await req.json();

    if (!placeIds || !Array.isArray(placeIds) || placeIds.length === 0) {
      return NextResponse.json({ error: "Missing or invalid placeIds array" }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing GOOGLE_PLACES_API_KEY" }, { status: 500 });
    }

    // Fetch details for each place
    const places: any[] = [];
    for (const placeId of placeIds) {
      try {
        const resp = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
          method: "GET",
          headers: {
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask":
              "id,displayName,websiteUri,nationalPhoneNumber,rating,userRatingCount,formattedAddress,location,types",
          },
        });

        if (resp.ok) {
          const data = await resp.json();
          places.push(data);
        }
      } catch (e) {
        console.error(`Error fetching place ${placeId}:`, e);
      }
    }

    // Build CSV
    const escapeCsv = (value: any): string => {
      if (value === null || value === undefined) return "";
      const str = String(value);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const headers = ["name", "phone", "website", "rating", "userRatingCount", "formattedAddress", "types"];
    const rows = places.map((place) => {
      const types = Array.isArray(place.types) ? place.types.join("; ") : "";
      return [
        escapeCsv(place.displayName?.text || ""),
        escapeCsv(place.nationalPhoneNumber || ""),
        escapeCsv(place.websiteUri || ""),
        escapeCsv(place.rating || ""),
        escapeCsv(place.userRatingCount || ""),
        escapeCsv(place.formattedAddress || ""),
        escapeCsv(types),
      ];
    });

    const csv = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="leads.csv"',
      },
    });
  } catch (e: any) {
    console.error("places export error:", e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

