import "server-only";

import fs from "fs";
import path from "path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!getApps().length) {
  const p = path.join(process.cwd(), "serviceAccountKey.json");
  const json = JSON.parse(fs.readFileSync(p, "utf8"));
  initializeApp({ credential: cert(json) });
}

export const db = getFirestore();

