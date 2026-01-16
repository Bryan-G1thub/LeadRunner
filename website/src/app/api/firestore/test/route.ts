import { NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

export async function POST() {
  await db.doc("test/ping").set({
    ok: true,
    at: FieldValue.serverTimestamp(),
  });
  return NextResponse.json({ ok: true });
}

