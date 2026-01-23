import { NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";

/**
 * GET /api/runs/csv?runId=xxx
 * 
 * Returns stored CSV file for a given runId
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const runId = searchParams.get("runId");

    if (!runId) {
      return NextResponse.json({ error: "Missing runId" }, { status: 400 });
    }

    const runDoc = await db.doc(`searchRuns/${runId}`).get();
    if (!runDoc.exists) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const runData = runDoc.data();
    const csvContent = runData?.csvContent;
    const csvFilename = runData?.csvFilename || "export.csv";

    if (!csvContent) {
      return NextResponse.json({ error: "CSV not found for this run. Please export it first." }, { status: 404 });
    }

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${csvFilename}"`,
      },
    });
  } catch (e: any) {
    console.error("runs csv error:", e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
