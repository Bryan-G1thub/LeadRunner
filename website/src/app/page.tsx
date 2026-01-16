"use client";

import { useState } from "react";

export default function Home() {
  const [query, setQuery] = useState("landscaper");
  const [lat, setLat] = useState("40.6782");
  const [lng, setLng] = useState("-73.9442");
  const [radiusMeters, setRadiusMeters] = useState("3000");
  const [runId, setRunId] = useState<string | null>(null);
  const [searchedCount, setSearchedCount] = useState<number | null>(null);
  const [updatedCount, setUpdatedCount] = useState<number | null>(null);
  const [failedCount, setFailedCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRunSearch = async () => {
    setError(null);
    setLoading(true);
    setRunId(null);
    setSearchedCount(null);
    setUpdatedCount(null);
    setFailedCount(null);

    try {
      const response = await fetch("/api/runs/create-and-enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          lat: parseFloat(lat),
          lng: parseFloat(lng),
          radiusMeters: parseInt(radiusMeters),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Search failed");
      }

      const data = await response.json();
      setRunId(data.runId);
      setSearchedCount(data.searchedCount);
      setUpdatedCount(data.updatedCount);
      setFailedCount(data.failedCount);
    } catch (e: any) {
      setError(e.message || "Search failed");
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    if (!runId) return;

    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/places/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Export failed");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "leads.csv";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (e: any) {
      setError(e.message || "Export failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-md p-8 w-full max-w-2xl">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Stonebrook Lead Runner</h1>
        <p className="text-sm text-gray-600 mb-6">Search → Enrich → Export in one click</p>

        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Query</label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="landscaper"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Latitude</label>
              <input
                type="number"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="40.6782"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Longitude</label>
              <input
                type="number"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="-73.9442"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Radius (meters)</label>
            <input
              type="number"
              value={radiusMeters}
              onChange={(e) => setRadiusMeters(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="3000"
            />
          </div>
        </div>

        {error && (
          <div className="mb-4 text-red-600 text-sm">{error}</div>
        )}

        {runId && (
          <div className="mb-4 p-4 bg-gray-50 rounded-md space-y-2">
            <div className="text-sm">
              <span className="font-medium">Run ID:</span> {runId}
            </div>
            {searchedCount !== null && (
              <div className="text-sm">
                <span className="font-medium">Searched:</span> {searchedCount}
              </div>
            )}
            {updatedCount !== null && (
              <div className="text-sm">
                <span className="font-medium">Updated:</span> {updatedCount}
              </div>
            )}
            {failedCount !== null && (
              <div className="text-sm">
                <span className="font-medium">Failed:</span> {failedCount}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-4">
          <button
            onClick={handleRunSearch}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
          >
            {loading ? "Running…" : "Run Search + Enrich"}
          </button>
          <button
            onClick={handleExport}
            disabled={loading || !runId}
            className="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
          >
            Export CSV
          </button>
        </div>
      </div>
    </div>
  );
}
