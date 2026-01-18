"use client";

import { useState } from "react";

export default function Home() {
  const [query, setQuery] = useState("");
  const [zipOrCity, setZipOrCity] = useState("");
  const [formattedAddress, setFormattedAddress] = useState<string | null>(null);
  const [radiusMeters, setRadiusMeters] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [searchedCount, setSearchedCount] = useState<number | null>(null);
  const [updatedCount, setUpdatedCount] = useState<number | null>(null);
  const [failedCount, setFailedCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [runCompleted, setRunCompleted] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [zipOrCityError, setZipOrCityError] = useState<string | null>(null);
  const [radiusError, setRadiusError] = useState<string | null>(null);

  // Validation helpers
  const validateQuery = (value: string): string | null => {
    if (!value.trim()) {
      return "Query is required";
    }
    if (!/^[a-zA-Z0-9\s\-']+$/.test(value)) {
      return "Only alphanumeric characters, spaces, hyphens, and apostrophes allowed";
    }
    if (value.trim().length < 2) {
      return "Query must be at least 2 characters";
    }
    if (value.trim().length > 100) {
      return "Query must be 100 characters or less";
    }
    return null;
  };

  const validateZipOrCity = (value: string): string | null => {
    if (!value.trim()) {
      return "Zip code or city is required";
    }
    if (!/^[a-zA-Z0-9\s,\-\.]+$/.test(value)) {
      return "Only alphanumeric characters, spaces, commas, hyphens, and periods allowed";
    }
    if (value.trim().length < 2) {
      return "Must be at least 2 characters";
    }
    if (value.trim().length > 100) {
      return "Must be 100 characters or less";
    }
    return null;
  };

  const validateRadius = (value: string): string | null => {
    if (!value.trim()) {
      return "Radius is required";
    }
    const num = parseInt(value);
    if (isNaN(num)) {
      return "Must be a valid number";
    }
    if (num < 100 || num > 50000) {
      return "Radius must be between 100 and 50000 meters";
    }
    return null;
  };

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setError(null);
    setRunCompleted(false);
  };

  const handleZipOrCityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setZipOrCity(e.target.value);
    setFormattedAddress(null);
    setError(null);
    setRunCompleted(false);
  };

  const handleRadiusChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRadiusMeters(e.target.value);
    setError(null);
    setRunCompleted(false);
  };

  const geocodeLocation = async (): Promise<{ lat: number; lng: number } | null> => {
    const zipErr = validateZipOrCity(zipOrCity);
    if (zipErr) {
      setZipOrCityError(zipErr);
      setError("Please enter a valid zip code or city name");
      return null;
    }

    setGeocoding(true);
    setError(null);
    setStatusMessage("Geocoding…");

    try {
      const response = await fetch("/api/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zipOrCity: zipOrCity.trim() }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Geocoding failed");
      }

      const data = await response.json();
      setFormattedAddress(data.formattedAddress);
      return { lat: data.lat, lng: data.lng };
    } catch (e: any) {
      setError(e.message || "Geocoding failed");
      setStatusMessage(null);
      return null;
    } finally {
      setGeocoding(false);
    }
  };

  const handleRunSearch = async () => {
    const queryErr = validateQuery(query);
    const zipErr = validateZipOrCity(zipOrCity);
    const radiusErr = validateRadius(radiusMeters);

    setQueryError(queryErr);
    setZipOrCityError(zipErr);
    setRadiusError(radiusErr);

    if (queryErr || zipErr || radiusErr) {
      setError("Please fix the errors above");
      return;
    }

    setError(null);
    setLoading(true);
    setRunCompleted(false);
    setRunId(null);
    setSearchedCount(null);
    setUpdatedCount(null);
    setFailedCount(null);

    try {
      // First geocode the location
      const location = await geocodeLocation();
      if (!location) {
        setLoading(false);
        setStatusMessage(null);
        return;
      }

      setStatusMessage("Running search + enrich…");

      // Then run search and enrich
      const response = await fetch("/api/runs/create-and-enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: query.trim(),
          lat: location.lat,
          lng: location.lng,
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
      setRunCompleted(true);
      setStatusMessage("Done. You can export CSV.");
    } catch (e: any) {
      setError(e.message || "Search failed");
      setStatusMessage(null);
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
              onChange={handleQueryChange}
              className={`w-full px-3 py-2 bg-white text-black placeholder:text-gray-400 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                queryError ? "border-red-500" : "border-gray-300"
              }`}
              placeholder="e.g., landscaper"
              maxLength={100}
            />
            {queryError && (
              <p className="text-xs text-red-600 mt-1">{queryError}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Zip Code or City</label>
            <input
              type="text"
              value={zipOrCity}
              onChange={handleZipOrCityChange}
              className={`w-full px-3 py-2 bg-white text-black placeholder:text-gray-400 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                zipOrCityError ? "border-red-500" : "border-gray-300"
              }`}
              placeholder="e.g., 11201 or Brooklyn, NY"
              maxLength={100}
            />
            {zipOrCityError && (
              <p className="text-xs text-red-600 mt-1">{zipOrCityError}</p>
            )}
            {formattedAddress && !zipOrCityError && (
              <p className="text-xs text-gray-600 mt-1 italic">{formattedAddress}</p>
            )}
            {geocoding && !zipOrCityError && (
              <p className="text-xs text-blue-600 mt-1">Geocoding...</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Radius (meters)</label>
            <input
              type="number"
              value={radiusMeters}
              onChange={handleRadiusChange}
              className={`w-full px-3 py-2 bg-white text-black placeholder:text-gray-400 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                radiusError ? "border-red-500" : "border-gray-300"
              }`}
              placeholder="e.g., 3000"
              min={100}
              max={50000}
            />
            {radiusError && (
              <p className="text-xs text-red-600 mt-1">{radiusError}</p>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 text-red-600 text-sm">{error}</div>
        )}

        {runId && (
          <div className="mb-4 p-4 bg-gray-50 border border-gray-200 rounded-md space-y-2">
            <div className="text-sm text-gray-900">
              <span className="font-bold">Run ID:</span> {runId}
            </div>
            {searchedCount !== null && (
              <div className="text-sm text-gray-900">
                <span className="font-bold">Searched:</span> {searchedCount}
              </div>
            )}
            {updatedCount !== null && (
              <div className="text-sm text-gray-900">
                <span className="font-bold">Updated:</span> {updatedCount}
              </div>
            )}
            {failedCount !== null && (
              <div className="text-sm text-gray-900">
                <span className="font-bold">Failed:</span> {failedCount}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-4">
          <button
            onClick={handleRunSearch}
            disabled={loading || geocoding || runCompleted}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium flex items-center justify-center gap-2"
          >
            {loading || geocoding ? (
              <>
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Running…
              </>
            ) : runCompleted ? (
              "Completed ✓"
            ) : (
              "Run Search + Enrich"
            )}
          </button>
          <button
            onClick={handleExport}
            disabled={loading || !runId}
            className={`flex-1 px-4 py-2 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium ${
              runCompleted ? "bg-green-700 shadow-md" : "bg-green-600"
            }`}
          >
            Export CSV
          </button>
        </div>

        {statusMessage && (
          <div className="mt-3 text-sm text-gray-600 text-center">{statusMessage}</div>
        )}
      </div>
    </div>
  );
}
