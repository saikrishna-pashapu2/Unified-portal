"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import * as XLSX from "xlsx";

export default function ViewUpdated() {
  const searchParams = useSearchParams();
  const jobId = searchParams.get("jobId") || "";
  
  const [rows, setRows] = useState<any[][] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!jobId) {
      setError("No job ID provided");
      setLoading(false);
      return;
    }

    (async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/esg/download?jobId=${jobId}`);
        
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(errorData.error || "Failed to load results");
        }

        const buf = await res.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data: any[][] = XLSX.utils.sheet_to_json(ws, { 
          header: 1, 
          defval: "" 
        }) as any[][];
        
        setRows(data);
      } catch (e: any) {
        console.error("View error:", e);
        setError(e?.message || "Failed to load Excel data");
      } finally {
        setLoading(false);
      }
    })();
  }, [jobId]);

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex items-center justify-center min-h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mr-3"></div>
          <span className="text-gray-600">Loading Excel data...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
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
              <h3 className="text-sm font-medium text-red-800">Error Loading Results</h3>
              <div className="mt-2 text-sm text-red-700">{error}</div>
            </div>
          </div>
          <div className="mt-4">
            <a
              href={`/esg/tools?tab=excel`}
              className="text-red-800 hover:text-red-900 font-medium text-sm underline"
            >
              ← Back to Excel Updater
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="text-center py-12">
          <p className="text-gray-600">No data found in the Excel file.</p>
          <div className="mt-4">
            <a
              href={`/esg/tools?tab=excel`}
              className="text-blue-600 hover:text-blue-700 font-medium underline"
            >
              ← Back to Excel Updater
            </a>
          </div>
        </div>
      </div>
    );
  }

  const headers = rows[0] || [];
  const dataRows = rows.slice(1);

  // Find ESG-related columns for highlighting
  const esgColumns = headers
    .map((header, index) => ({ header: String(header).toLowerCase(), index }))
    .filter(({ header }) => 
      header.includes("esg") || 
      header.includes("s&p") || 
      header.includes("iss") || 
      header.includes("lseg") || 
      header.includes("oekom") ||
      header.includes("tr.tresg")
    )
    .map(({ index }) => index);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">ESG Data Results</h1>
            <p className="text-sm text-gray-600 mt-1">
              Processed Excel file with {dataRows.length} companies • Job ID: {jobId}
            </p>
          </div>
          <div className="flex gap-3">
            <a
              href={`/api/esg/download?jobId=${jobId}`}
              download
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
            >
              Download Excel
            </a>
            <a
              href={`/esg/tools?tab=excel`}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium"
            >
              ← Back to Excel Updater
            </a>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-600">Total Companies</div>
            <div className="text-2xl font-bold text-gray-900">{dataRows.length}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-600">Total Columns</div>
            <div className="text-2xl font-bold text-gray-900">{headers.length}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-600">ESG Columns</div>
            <div className="text-2xl font-bold text-blue-600">{esgColumns.length}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-600">Processing Status</div>
            <div className="text-lg font-semibold text-green-600">Completed</div>
          </div>
        </div>
        {/* Data Table */}
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {headers.map((header, index) => (
                    <th
                      key={index}
                      className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider ${
                        esgColumns.includes(index)
                          ? "text-blue-700 bg-blue-50"
                          : "text-gray-500"
                      }`}
                    >
                      <div className="flex items-center space-x-1">
                        <span>{String(header)}</span>
                        {esgColumns.includes(index) && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                            ESG
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {dataRows.map((row, rowIndex) => (
                  <tr
                    key={rowIndex}
                    className={rowIndex % 2 === 0 ? "bg-white" : "bg-gray-50"}
                  >
                    {headers.map((_, colIndex) => (
                      <td
                        key={colIndex}
                        className={`px-4 py-3 text-sm ${
                          esgColumns.includes(colIndex)
                            ? "font-medium text-gray-900 bg-blue-25"
                            : "text-gray-700"
                        }`}
                      >
                        <div className="max-w-xs truncate" title={String(row[colIndex] || "")}>
                          {String(row[colIndex] || "")}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-sm text-gray-500">
          <p>
            ESG data sourced from S&P Global, ISS (oekom), and LSEG (Refinitiv).
          </p>
          <p className="mt-1">
            Data is updated in real-time and reflects the latest available ratings.
          </p>
        </div>
      </div>
    </div>
  );
}
