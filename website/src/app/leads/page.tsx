"use client";

import { useState } from "react";

export default function LeadsPage() {
  const [query, setQuery] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [radiusMeters, setRadiusMeters] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [enrichStatus, setEnrichStatus] = useState<string | null>(null);
  const [enrichUpdatedCount, setEnrichUpdatedCount] = useState<number | null>(null);
  const [enrichFailedCount, setEnrichFailedCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/places/search", {
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
      setCount(data.count);
      setEnrichStatus(null);
      setEnrichUpdatedCount(null);
      setEnrichFailedCount(null);
    } catch (e: any) {
      setError(e.message || "Search failed");
    } finally {
      setLoading(false);
    }
  };

  const handleEnrich = async () => {
    if (!runId) {
      setError("No runId available. Please search first.");
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/places/details-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Enrich failed");
      }

      const data = await response.json();
      setEnrichStatus("ENRICHED");
      setEnrichUpdatedCount(data.updatedCount);
      setEnrichFailedCount(data.failedCount);
    } catch (e: any) {
      setError(e.message || "Enrich failed");
      setEnrichStatus("ERROR");
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    if (!runId) {
      setError("No runId available. Please search first.");
      return;
    }

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
    <div style={{ padding: "2rem", maxWidth: "600px", margin: "0 auto" }}>
      <h1>Leads Tool</h1>

      <div style={{ marginBottom: "1rem" }}>
        <label style={{ display: "block", marginBottom: "0.5rem" }}>Query:</label>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ width: "100%", padding: "0.5rem" }}
          placeholder="e.g., restaurants"
        />
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <label style={{ display: "block", marginBottom: "0.5rem" }}>Latitude:</label>
        <input
          type="number"
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          style={{ width: "100%", padding: "0.5rem" }}
          placeholder="e.g., 37.7749"
        />
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <label style={{ display: "block", marginBottom: "0.5rem" }}>Longitude:</label>
        <input
          type="number"
          value={lng}
          onChange={(e) => setLng(e.target.value)}
          style={{ width: "100%", padding: "0.5rem" }}
          placeholder="e.g., -122.4194"
        />
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <label style={{ display: "block", marginBottom: "0.5rem" }}>Radius (meters):</label>
        <input
          type="number"
          value={radiusMeters}
          onChange={(e) => setRadiusMeters(e.target.value)}
          style={{ width: "100%", padding: "0.5rem" }}
          placeholder="e.g., 5000"
        />
      </div>

      {runId && (
        <div style={{ marginBottom: "1rem", padding: "0.5rem", backgroundColor: "#f0f0f0" }}>
          <strong>Run ID:</strong> {runId}
        </div>
      )}

      {count !== null && (
        <div style={{ marginBottom: "1rem" }}>
          <strong>Places found:</strong> {count}
        </div>
      )}

      {enrichStatus && (
        <div style={{ marginBottom: "1rem" }}>
          <strong>Enrich Status:</strong> {enrichStatus}
          {enrichUpdatedCount !== null && (
            <div>Updated: {enrichUpdatedCount}</div>
          )}
          {enrichFailedCount !== null && (
            <div>Failed: {enrichFailedCount}</div>
          )}
        </div>
      )}

      {error && (
        <div style={{ marginBottom: "1rem", color: "red" }}>Error: {error}</div>
      )}

      <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
        <button
          onClick={handleSearch}
          disabled={loading}
          style={{ padding: "0.5rem 1rem", cursor: loading ? "not-allowed" : "pointer" }}
        >
          Search
        </button>
        <button
          onClick={handleEnrich}
          disabled={loading || !runId}
          style={{ padding: "0.5rem 1rem", cursor: loading || !runId ? "not-allowed" : "pointer" }}
        >
          Enrich
        </button>
        <button
          onClick={handleExport}
          disabled={loading || !runId}
          style={{ padding: "0.5rem 1rem", cursor: loading || !runId ? "not-allowed" : "pointer" }}
        >
          Export CSV
        </button>
      </div>
    </div>
  );
}

