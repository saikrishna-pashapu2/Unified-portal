"use client";
import { useState } from "react";

type SourceKey = "ALL" | "S&P" | "ISS" | "LSEG";

export default function EsgSearch() {
  const [name, setName] = useState("");
  const [active, setActive] = useState<SourceKey>("ALL");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);

  const run = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setData(null);
    try {
      if (active === "ALL") {
        const res = await fetch(`/api/esg/search?name=${encodeURIComponent(name)}`);
        setData(await res.json());
      } else {
        const path = active === "S&P" ? "snp" : active.toLowerCase();
        const res = await fetch(`/api/esg/source/${path}?name=${encodeURIComponent(name)}`);
        setData(await res.json());
      }
    } catch (error) {
      console.error("Search error:", error);
      setData({ error: "Search failed" });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      run();
    }
  };

  return (
    <div className="space-y-6">
      {/* Search Input */}
      <div className="rounded-lg border bg-white p-6">
        <div className="space-y-4">
          <div>
            <label htmlFor="company-search" className="block text-sm font-medium text-gray-700 mb-2">
              Company Name
            </label>
            <div className="flex gap-3">
              <input
                id="company-search"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Enter company name (e.g., Apple Inc, Microsoft Corporation)"
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                disabled={loading}
              />
              <button
                onClick={run}
                disabled={!name.trim() || loading}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {loading ? "Searching..." : "Search"}
              </button>
            </div>
          </div>

          {/* Source Tabs */}
          <div className="flex gap-2">
            {(["ALL", "S&P", "ISS", "LSEG"] as SourceKey[]).map((t) => (
              <button
                key={t}
                onClick={() => {setActive(t); setData(null);}}
                className={`px-4 py-2 rounded-md border font-medium transition-colors ${
                  active === t
                    ? "bg-gray-100 border-gray-300 text-gray-900"
                    : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="rounded-lg border bg-white p-8">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-3"></div>
            <span className="text-gray-600">Searching ESG data...</span>
          </div>
        </div>
      )}

      {/* Results */}
      {!loading && data && active === "ALL" && !data.error && (
        <div className="rounded-lg border bg-white p-6">
          <h3 className="font-semibold text-lg mb-4">ESG Summary for &quot;{data.name}&quot;</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-lg border p-4 bg-gray-50">
              <div className="text-sm text-gray-600 mb-1">S&P Global ESG</div>
              <div className="text-2xl font-bold text-gray-900">{data?.summary?.["S&P"] ?? "-"}</div>
              <div className="text-xs text-gray-500 mt-1">Score (0-100)</div>
            </div>
            <div className="rounded-lg border p-4 bg-gray-50">
              <div className="text-sm text-gray-600 mb-1">ISS (oekom)</div>
              <div className="text-2xl font-bold text-gray-900">{data?.summary?.["ISS"] ?? "-"}</div>
              <div className="text-xs text-gray-500 mt-1">Rating</div>
            </div>
            <div className="rounded-lg border p-4 bg-gray-50">
              <div className="text-sm text-gray-600 mb-1">LSEG (Refinitiv)</div>
              <div className="text-2xl font-bold text-gray-900">{data?.summary?.["LSEG"] ?? "-"}</div>
              <div className="text-xs text-gray-500 mt-1">TR.TRESG Score</div>
            </div>
          </div>
        </div>
      )}

      {!loading && data && active !== "ALL" && !data.error && (
        <div className="rounded-lg border bg-white p-6">
          <h3 className="font-semibold text-lg mb-4">{active} Data for &quot;{data.company}&quot;</h3>
          <div className="bg-gray-50 rounded-lg p-4">
            <pre className="text-sm overflow-auto whitespace-pre-wrap">
              {JSON.stringify(data, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {!loading && data?.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6">
          <div className="flex items-center">
            <div className="text-red-600">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">Search Error</h3>
              <div className="mt-2 text-sm text-red-700">
                {data.error || "An error occurred while searching for ESG data."}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
