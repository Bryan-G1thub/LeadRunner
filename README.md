# Stonebrook Lead Runner

A lead-generation tool that searches for local businesses (Google Places), optionally filters by rating and review count, and exports results to CSV. Built with Next.js, Firebase Firestore, and the Google Places API (New).

## What it does

- **Search** – Enter a query (e.g. "landscaper"), a location (zip or city), and a radius. The app geocodes the location, runs a Google Places text search in that area, and fetches all result pages (pagination).
- **Filters** – Optionally require a minimum star rating and/or min/max number of reviews so you only keep places that meet your criteria (e.g. 2+ reviews to skip likely-closed or low-presence businesses).
- **Export** – Export the current run’s results as a CSV (name, rating, review count, address, types, and a Google search link). The file is also stored in Firestore so you can re-download it from the history table.
- **History** – Recent searches are listed in a table with date, query, location, radius, result count, and actions: download CSV or delete the run (and its Firestore data).

## Tech stack

- **Next.js** (App Router) – UI and API routes
- **Firebase / Firestore** – Stores search runs, result place IDs, place details, and optional CSV blobs
- **Google APIs** – Geocoding and Places (New) for search

## Getting started

### Prerequisites

- Node.js 18+
- A Google Cloud project with the Places API (New) and Geocoding API enabled
- A Firebase project with Firestore

### 1. Clone and install

```bash
cd website
npm install
```

### 2. Environment variables

Create `website/.env.local` (or `.env`) and **do not commit it**. The app expects:

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_PLACES_API_KEY` | Yes | API key for Places (New) and Geocoding |
| `APP_ACCESS_PASSWORD` | Yes | Password required to access the app (single shared password) |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Yes* | JSON string of the Firebase service account private key for server-side Firestore |

\* Alternatively, place a `serviceAccountKey.json` (or `firebase-service-account.json`) in the project; the key file must be in `.gitignore` and never committed.

### 3. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Enter the app password, then use the form to run a search and export CSV.

## Making the repo public (safety)

- `.env`, `.env.local`, and `.env*` are in `.gitignore` (root and `website/`).
- Firebase service account JSON files are ignored.
- Before publishing, you can verify no secrets are tracked:
  - `git log -p --all -- .env .env.local website/.env website/.env.local` → should show no commits.
  - `git ls-files | grep -E '\.env|serviceAccount|service-account'` → should print nothing.

If both checks pass, the repo is safe to make public as long as you never commit env or key files.

## Main API usage (for reference)

- **Create a run (search + store):** `POST /api/runs/create` with body `{ query, lat, lng, radiusMeters, locationName?, minRating?, minReviews?, maxReviews? }`. Returns `{ runId, searchedCount, totalFetched }`.
- **Export CSV:** `POST /api/places/export` with body `{ runId }`. Returns CSV and stores it in the run document.
- **List runs:** `GET /api/runs/list`. Returns all runs (newest first).
- **Download stored CSV:** `GET /api/runs/csv?runId=...`.
- **Delete a run:** `DELETE /api/runs/{runId}`.

## Deploy

Set the same environment variables in your host (e.g. Vercel). Do not commit `.env` or any file containing API keys or the Firebase service account.
