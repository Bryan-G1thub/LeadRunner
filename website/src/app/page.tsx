"use client";

import { useState, useEffect } from "react";

export default function Home() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [query, setQuery] = useState("");
  const [zipOrCity, setZipOrCity] = useState("");
  const [formattedAddress, setFormattedAddress] = useState<string | null>(null);
  const [radiusMeters, setRadiusMeters] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [searchedCount, setSearchedCount] = useState<number | null>(null);
  const [totalFetched, setTotalFetched] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [runCompleted, setRunCompleted] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [zipOrCityError, setZipOrCityError] = useState<string | null>(null);
  const [radiusError, setRadiusError] = useState<string | null>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [openMenuRunId, setOpenMenuRunId] = useState<string | null>(null);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [minRating, setMinRating] = useState("");
  const [minReviews, setMinReviews] = useState("");
  const [maxReviews, setMaxReviews] = useState("");
  const [filterError, setFilterError] = useState<string | null>(null);

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
    if (num < 100 || num > 9999) {
      return "Radius must be between 100 and 9999 meters";
    }
    return null;
  };

  const validateFilters = (): string | null => {
    if (minRating.trim()) {
      const r = parseFloat(minRating);
      if (isNaN(r) || r < 0 || r > 5) return "Minimum rating must be 0–5";
    }
    if (minReviews.trim()) {
      const n = parseInt(minReviews);
      if (isNaN(n) || n < 0) return "Minimum reviews must be 0 or more";
    }
    if (maxReviews.trim()) {
      const n = parseInt(maxReviews);
      if (isNaN(n) || n < 0) return "Maximum reviews must be 0 or more";
    }
    if (minReviews.trim() && maxReviews.trim()) {
      const a = parseInt(minReviews);
      const b = parseInt(maxReviews);
      if (!isNaN(a) && !isNaN(b) && a > b) return "Minimum reviews cannot exceed maximum";
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

  // Check authentication on mount
  useEffect(() => {
    const isAuthenticated = localStorage.getItem("app_authenticated") === "true";
    setAuthenticated(isAuthenticated);
    setCheckingAuth(false);
  }, []);

  // Fetch history when authenticated
  useEffect(() => {
    if (authenticated) {
      fetchRuns();
    }
  }, [authenticated]);

  const fetchRuns = async () => {
    setLoadingHistory(true);
    try {
      const response = await fetch("/api/runs/list");
      if (response.ok) {
        const data = await response.json();
        setRuns(data.runs || []);
      }
    } catch (e) {
      console.error("Failed to fetch runs:", e);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleDownloadCsv = async (runId: string, fallbackFilename: string) => {
    try {
      const response = await fetch("/api/places/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to download CSV");
      }

      const contentDisposition = response.headers.get("Content-Disposition");
      let filename = fallbackFilename;
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1].replace(/['"]/g, "");
        }
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      fetchRuns();
    } catch (e: any) {
      alert(e.message || "Failed to download CSV");
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "Unknown";
    try {
      const date = new Date(dateString);
      return date.toLocaleString();
    } catch {
      return dateString;
    }
  };

  const handleDeleteRun = async (runId: string) => {
    setDeletingRunId(runId);
    setOpenMenuRunId(null);
    try {
      const response = await fetch(`/api/runs/${runId}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to delete");
      }
      fetchRuns();
    } catch (e: any) {
      alert(e.message || "Failed to delete run");
    } finally {
      setDeletingRunId(null);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);

    if (!password.trim()) {
      setPasswordError("Please enter a password");
      return;
    }

    try {
      const response = await fetch("/api/auth/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password.trim() }),
      });

      const data = await response.json();

      if (response.ok && data.authenticated) {
        localStorage.setItem("app_authenticated", "true");
        setAuthenticated(true);
        setPassword("");
      } else {
        // Check for server error (e.g., missing env var)
        if (data.error) {
          setPasswordError(data.error);
        } else {
          setPasswordError("Incorrect password");
        }
        setPassword("");
      }
    } catch (e: any) {
      setPasswordError("Authentication failed");
    }
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
    const filterErr = validateFilters();

    setQueryError(queryErr);
    setZipOrCityError(zipErr);
    setRadiusError(radiusErr);
    setFilterError(filterErr);

    if (queryErr || zipErr || radiusErr || filterErr) {
      setError("Please fix the errors above");
      return;
    }

    setError(null);
    setLoading(true);
    // Keep previous runId until we have a new one, so main Export stays clickable if this run fails
    try {
      // First geocode the location
      const location = await geocodeLocation();
      if (!location) {
        setLoading(false);
        setStatusMessage(null);
        return;
      }

      setStatusMessage("Running search…");

      // Run search
      const response = await fetch("/api/runs/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: query.trim(),
          lat: location.lat,
          lng: location.lng,
          radiusMeters: parseInt(radiusMeters),
          locationName: formattedAddress || zipOrCity.trim(),
          minRating: minRating.trim() ? parseFloat(minRating) : undefined,
          minReviews: minReviews.trim() ? parseInt(minReviews) : undefined,
          maxReviews: maxReviews.trim() ? parseInt(maxReviews) : undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Search failed");
      }

      const data = await response.json();
      setRunId(data.runId);
      setSearchedCount(data.searchedCount);
      setTotalFetched(data.totalFetched ?? null);
      setRunCompleted(true);
      setStatusMessage("Done. You can export CSV.");
      // Refresh history after new search
      fetchRuns();
    } catch (e: any) {
      setError(e.message || "Search failed");
      setStatusMessage(null);
      // Don't clear runId on failure so main Export stays clickable (previous run if any)
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

      // Extract filename from Content-Disposition header
      const contentDisposition = response.headers.get("Content-Disposition");
      let filename = "leads.csv"; // fallback
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1].replace(/['"]/g, "");
        }
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      setStatusMessage("CSV exported successfully.");
      // Refresh history after export
      fetchRuns();
    } catch (e: any) {
      setError(e.message || "Export failed");
    } finally {
      setLoading(false);
    }
  };

  // Show password screen if not authenticated
  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: "#0A1628" }}>
        <div className="text-[#14a5aa] font-medium">Loading...</div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: "#0A1628" }}>
        <div className="bg-white rounded-xl shadow-xl p-8 w-full max-w-md border border-[#2a6f8f]/20">
          <h1 className="text-2xl font-bold mb-6 text-center" style={{ color: "#0A1628" }}>Enter Password</h1>
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 bg-white text-[#0A1628] placeholder:text-[#64748b] border border-[#2a6f8f]/30 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#14a5aa] focus:border-transparent"
                placeholder="Password"
                autoFocus
              />
              {passwordError && (
                <p className="text-xs text-red-500 mt-1">{passwordError}</p>
              )}
            </div>
            <button
              type="submit"
              className="w-full px-4 py-2.5 text-white rounded-lg font-medium transition-colors hover:opacity-90"
              style={{ backgroundColor: "#2a6f8f" }}
            >
              Enter
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-6" style={{ backgroundColor: "#0A1628" }}>
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-xl shadow-xl p-8 mb-6 border border-[#2a6f8f]/10">
          <h1 className="text-3xl font-bold mb-2 tracking-tight" style={{ color: "#0A1628" }}>Stonebrook Lead Runner</h1>
          <p className="text-sm mb-6" style={{ color: "#64748b" }}>Search → Export in one click</p>

        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "#0A1628" }}>Query</label>
            <input
              type="text"
              value={query}
              onChange={handleQueryChange}
              className={`w-full px-3 py-2.5 bg-white text-[#0A1628] placeholder:text-[#64748b] border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#14a5aa] focus:border-transparent ${
                queryError ? "border-red-500" : "border-[#2a6f8f]/30"
              }`}
              placeholder="e.g., landscaper"
              maxLength={100}
            />
            {queryError && (
              <p className="text-xs text-red-500 mt-1">{queryError}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "#0A1628" }}>Location (zip, city, or lat,lng)</label>
            <input
              type="text"
              value={zipOrCity}
              onChange={handleZipOrCityChange}
              className={`w-full px-3 py-2.5 bg-white text-[#0A1628] placeholder:text-[#64748b] border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#14a5aa] focus:border-transparent ${
                zipOrCityError ? "border-red-500" : "border-[#2a6f8f]/30"
              }`}
              placeholder="e.g. 11201, Brooklyn NY, or 40.81,-73.69"
              maxLength={100}
            />
            {zipOrCityError && (
              <p className="text-xs text-red-500 mt-1">{zipOrCityError}</p>
            )}
            {formattedAddress && !zipOrCityError && (
              <p className="text-xs mt-1 italic" style={{ color: "#64748b" }}>{formattedAddress}</p>
            )}
            {geocoding && !zipOrCityError && (
              <p className="text-xs mt-1" style={{ color: "#14a5aa" }}>Geocoding...</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "#0A1628" }}>Radius (meters)</label>
            <input
              type="number"
              value={radiusMeters}
              onChange={handleRadiusChange}
              className={`w-full px-3 py-2.5 bg-white text-[#0A1628] placeholder:text-[#64748b] border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#14a5aa] focus:border-transparent ${
                radiusError ? "border-red-500" : "border-[#2a6f8f]/30"
              }`}
              placeholder="e.g., 3000"
              min={100}
              max={9999}
            />
            {radiusError && (
              <p className="text-xs text-red-500 mt-1">{radiusError}</p>
            )}
          </div>

          {/* Filters: rating and review count */}
          <div className="pt-4 mt-4 border-t border-[#e2e8f0]">
            <div className="flex items-center gap-2 mb-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <svg key={i} xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="#14a5aa" stroke="#14a5aa" strokeWidth="1">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              ))}
              <span className="text-sm font-medium" style={{ color: "#0A1628" }}>Filters (optional)</span>
            </div>
            <p className="text-xs mb-3" style={{ color: "#64748b" }}>Only include places that meet these criteria</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: "#0A1628" }}>Min rating (stars)</label>
                <input
                  type="number"
                  value={minRating}
                  onChange={(e) => { setMinRating(e.target.value); setFilterError(null); }}
                  className={`w-full px-3 py-2.5 bg-white text-[#0A1628] placeholder:text-[#64748b] border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#14a5aa] focus:border-transparent ${
                    filterError ? "border-red-500" : "border-[#2a6f8f]/30"
                  }`}
                  placeholder="e.g. 3.5"
                  min={0}
                  max={5}
                  step={0.5}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: "#0A1628" }}>Min reviews</label>
                <input
                  type="number"
                  value={minReviews}
                  onChange={(e) => { setMinReviews(e.target.value); setFilterError(null); }}
                  className={`w-full px-3 py-2.5 bg-white text-[#0A1628] placeholder:text-[#64748b] border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#14a5aa] focus:border-transparent ${
                    filterError ? "border-red-500" : "border-[#2a6f8f]/30"
                  }`}
                  placeholder="e.g. 2"
                  min={0}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: "#0A1628" }}>Max reviews</label>
                <input
                  type="number"
                  value={maxReviews}
                  onChange={(e) => { setMaxReviews(e.target.value); setFilterError(null); }}
                  className={`w-full px-3 py-2.5 bg-white text-[#0A1628] placeholder:text-[#64748b] border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#14a5aa] focus:border-transparent ${
                    filterError ? "border-red-500" : "border-[#2a6f8f]/30"
                  }`}
                  placeholder="e.g. 50"
                  min={0}
                />
              </div>
            </div>
            {filterError && (
              <p className="text-xs text-red-500 mt-1">{filterError}</p>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 text-red-500 text-sm">{error}</div>
        )}

        {runId && (
          <div className="mb-4 p-4 rounded-lg space-y-2 border border-[#e2e8f0]" style={{ backgroundColor: "#f1f5f9" }}>
            <div className="text-sm" style={{ color: "#0A1628" }}>
              <span className="font-bold">Run ID:</span> {runId}
            </div>
            {searchedCount !== null && (
              <div className="text-sm" style={{ color: "#0A1628" }}>
                <span className="font-bold">Results:</span> {searchedCount}
                {totalFetched != null && totalFetched !== searchedCount && (
                  <span className="ml-1" style={{ color: "#64748b" }}>(from {totalFetched} fetched)</span>
                )}
                {totalFetched != null && totalFetched === searchedCount && totalFetched > 0 && (
                  <span className="ml-1" style={{ color: "#64748b" }}>({totalFetched} fetched)</span>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-4">
          <button
            onClick={handleRunSearch}
            disabled={loading || geocoding || runCompleted}
            className="flex-1 px-4 py-2.5 text-white rounded-lg disabled:bg-[#64748b] disabled:cursor-not-allowed font-medium flex items-center justify-center gap-2 transition-colors hover:opacity-90"
            style={{ backgroundColor: "#2a6f8f" }}
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
              "Run Search"
            )}
          </button>
          <button
            onClick={handleExport}
            disabled={loading || !runId}
            className="flex-1 px-4 py-2.5 text-white rounded-lg disabled:bg-[#64748b] disabled:cursor-not-allowed font-medium transition-colors hover:opacity-90"
            style={{ backgroundColor: runCompleted ? "#0A1628" : "#14a5aa" }}
          >
            Export CSV
          </button>
        </div>

        {statusMessage && (
          <div className="mt-3 text-sm text-center" style={{ color: "#64748b" }}>{statusMessage}</div>
        )}
      </div>

      {/* History Section */}
      <div className="bg-white rounded-xl shadow-xl p-8 border border-[#2a6f8f]/10">
        <h2 className="text-2xl font-bold mb-4 tracking-tight" style={{ color: "#0A1628" }}>Recent Searches</h2>
        
        {loadingHistory ? (
          <div className="text-center py-8" style={{ color: "#64748b" }}>Loading history...</div>
        ) : runs.length === 0 ? (
          <div className="text-center py-8" style={{ color: "#64748b" }}>No search history yet. Run a search above to get started.</div>
        ) : (
          <div
            className="overflow-x-auto rounded-lg border border-[#e2e8f0]"
          >
            <table className="w-full">
              <thead>
                <tr style={{ backgroundColor: "#f8fafc" }}>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: "#64748b" }}>
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: "#64748b" }}>
                    Query
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: "#64748b" }}>
                    Location
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: "#64748b" }}>
                    Radius
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: "#64748b" }}>
                    Results
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: "#64748b" }}>
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: "#64748b" }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "#e2e8f0" }}>
                {runs.map((run, runIndex) => (
                  <tr key={run.runId} className="hover:bg-[#f8fafc] transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap text-sm" style={{ color: "#0A1628" }}>
                      {formatDate(run.createdAt)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium" style={{ color: "#0A1628" }}>
                      {run.query || "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm" style={{ color: "#64748b" }}>
                      {run.locationName || (run.lat && run.lng ? `${run.lat}, ${run.lng}` : "—")}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm" style={{ color: "#64748b" }}>
                      {run.radiusMeters ? `${run.radiusMeters}m` : "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm" style={{ color: "#64748b" }}>
                      {run.resultCount || 0}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {run.status === "ERROR" ? (
                        <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-700 rounded">
                          Error
                        </span>
                      ) : (
                        <span className="px-2 py-1 text-xs font-medium rounded" style={{ backgroundColor: "#ccfbf1", color: "#14a5aa" }}>
                          Success
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                      <div className="flex items-center gap-2">
                        {run.status !== "ERROR" && (run.resultCount ?? 0) > 0 ? (
                          <button
                            onClick={() => handleDownloadCsv(run.runId, run.csvFilename || `${run.query || "export"}_${run.radiusMeters}m.csv`)}
                            className="px-3 py-1.5 rounded-lg font-medium border bg-white transition-colors hover:bg-[#14a5aa] hover:text-white hover:border-[#14a5aa]"
                            style={{ borderColor: "#14a5aa", color: "#14a5aa" }}
                          >
                            Download CSV
                          </button>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                        <div
                          className="relative"
                          onMouseLeave={() => setOpenMenuRunId(null)}
                        >
                          <button
                            type="button"
                            onClick={() => setOpenMenuRunId(openMenuRunId === run.runId ? null : run.runId)}
                            className="p-1.5 rounded hover:bg-[#e2e8f0] transition-colors disabled:opacity-50"
                            style={{ color: "#64748b" }}
                            disabled={deletingRunId === run.runId}
                            aria-label="More actions"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="6" r="1.5" />
                              <circle cx="12" cy="12" r="1.5" />
                              <circle cx="12" cy="18" r="1.5" />
                            </svg>
                          </button>
                          {openMenuRunId === run.runId && (
                            <div
                              className={`absolute right-0 z-20 min-w-[120px] rounded-lg border border-[#e2e8f0] bg-white shadow-lg py-1 ${
                                runIndex >= runs.length - 2 ? "bottom-full mb-1" : "top-full mt-1"
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => handleDeleteRun(run.runId)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 rounded-lg mx-0.5"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="3 6 5 6 21 6" />
                                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                  <line x1="10" y1="11" x2="10" y2="17" />
                                  <line x1="14" y1="11" x2="14" y2="17" />
                                </svg>
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
