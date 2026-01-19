import "server-only";

import fs from "fs";
import path from "path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!getApps().length) {
  // Try to get service account from environment variable first (for Vercel/production)
  // If not found, fall back to reading from file (for local development)
  let serviceAccount: Record<string, string>;
  
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    // Parse the JSON string from environment variable
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  } else {
    // Fallback to file for local development
    const p = path.join(process.cwd(), "serviceAccountKey.json");
    if (fs.existsSync(p)) {
      serviceAccount = JSON.parse(fs.readFileSync(p, "utf8"));
    } else {
      throw new Error(
        "Firebase service account not found. Set FIREBASE_SERVICE_ACCOUNT_KEY environment variable or provide serviceAccountKey.json file."
      );
    }
  }
  
  initializeApp({ credential: cert(serviceAccount) });
}

export const db = getFirestore();

