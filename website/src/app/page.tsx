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

  const handleDownloadCsv = async (runId: string, filename: string) => {
    try {
      const response = await fetch(`/api/runs/csv?runId=${runId}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to download CSV");
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
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Search failed");
      }

      const data = await response.json();
      setRunId(data.runId);
      setSearchedCount(data.searchedCount);
      setRunCompleted(true);
      setStatusMessage("Done. You can export CSV.");
      // Refresh history after new search
      fetchRuns();
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-md p-8 w-full max-w-md">
          <h1 className="text-2xl font-bold text-gray-900 mb-6 text-center">Enter Password</h1>
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 bg-white text-black placeholder:text-gray-400 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Password"
                autoFocus
              />
              {passwordError && (
                <p className="text-xs text-red-600 mt-1">{passwordError}</p>
              )}
            </div>
            <button
              type="submit"
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
            >
              Enter
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-md p-8 mb-6">
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
              "Run Search"
            )}
          </button>
          <button
            onClick={handleExport}
            disabled={loading || !runId}
            className="flex-1 px-4 py-2 text-white rounded-md disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
            style={{
              backgroundColor: runCompleted ? "#1e3a8a" : "#1e40af",
            }}
            onMouseEnter={(e) => {
              if (!loading && runId) {
                e.currentTarget.style.backgroundColor = "#1e3a8a";
              }
            }}
            onMouseLeave={(e) => {
              if (!loading && runId) {
                e.currentTarget.style.backgroundColor = runCompleted ? "#1e3a8a" : "#1e40af";
              }
            }}
          >
            Export CSV
          </button>
        </div>

        {statusMessage && (
          <div className="mt-3 text-sm text-gray-600 text-center">{statusMessage}</div>
        )}
      </div>

      {/* History Section */}
      <div className="bg-white rounded-lg shadow-md p-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Recent Searches</h2>
        
        {loadingHistory ? (
          <div className="text-center text-gray-600 py-8">Loading history...</div>
        ) : runs.length === 0 ? (
          <div className="text-center text-gray-600 py-8">No search history yet. Run a search above to get started.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Query
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Location
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Radius
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Results
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {runs.map((run) => (
                  <tr key={run.runId} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {formatDate(run.createdAt)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                      {run.query || "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {run.locationName || (run.lat && run.lng ? `${run.lat}, ${run.lng}` : "—")}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {run.radiusMeters ? `${run.radiusMeters}m` : "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      {run.resultCount || 0}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {run.status === "ERROR" ? (
                        <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded">
                          Error
                        </span>
                      ) : (
                        <span className="px-2 py-1 text-xs font-medium rounded" style={{ backgroundColor: "#dbeafe", color: "#1e40af" }}>
                          Success
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                      {run.hasCsv ? (
                        <button
                          onClick={() => handleDownloadCsv(run.runId, run.csvFilename || `${run.query || "export"}_${run.radiusMeters}m.csv`)}
                          className="text-blue-600 hover:text-blue-800 font-medium"
                        >
                          Download CSV
                        </button>
                      ) : (
                        <span className="text-gray-400">No CSV</span>
                      )}
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
