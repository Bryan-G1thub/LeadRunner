import { NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";

/**
 * DELETE /api/runs/[runId]
 *
 * Deletes the search run and all its results from Firestore.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;

    if (!runId) {
      return NextResponse.json({ error: "Missing runId" }, { status: 400 });
    }

    const runRef = db.doc(`searchRuns/${runId}`);
    const runDoc = await runRef.get();

    if (!runDoc.exists) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    // Delete all documents in the results subcollection (Firestore has no cascade delete)
    const resultsSnapshot = await db
      .collection(`searchRuns/${runId}/results`)
      .get();

    const batch = db.batch();
    resultsSnapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    // Delete the run document
    batch.delete(runRef);

    await batch.commit();

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("runs delete error:", e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
