"use client";
import { useEffect, useRef, useState } from "react";
import { Trash2, Upload, FileSpreadsheet, Play, Square, Download, Eye, Clock, CheckCircle, XCircle, AlertCircle } from "lucide-react";

type Row = { 
  id: number; 
  task_id: string; 
  original_filename: string; 
  status: string; 
  output_filename?: string | null; 
  created_at: string; 
  error_message?: string | null;
};

export default function EsgExcel() {
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string>("");
  const [status, setStatus] = useState<{
    status: string;
    progress: number;
    rowsDone: number;
    rowsTotal: number;
    error?: string | null;
  } | null>(null);
  const [history, setHistory] = useState<Row[]>([]);
  const [uploading, setUploading] = useState(false);
  const pollRef = useRef<any>(null);
  const userId = null; // Wire to your auth session when ready

  // Load history from database and localStorage
  useEffect(() => {
    const loadHistory = async () => {
      try {
        // Load from database
        const response = await fetch("/api/esg/history");
        if (response.ok) {
          const dbHistory = await response.json();
          setHistory(dbHistory);
        } else {
          // Fallback to localStorage if API fails
          const raw = localStorage.getItem("esg_upload_history");
          if (raw) {
            try {
              setHistory(JSON.parse(raw));
            } catch (e) {
              console.error("Failed to parse localStorage history:", e);
            }
          }
        }
      } catch (error) {
        console.error("Failed to load history:", error);
        // Fallback to localStorage
        const raw = localStorage.getItem("esg_upload_history");
        if (raw) {
          try {
            setHistory(JSON.parse(raw));
          } catch (e) {
            console.error("Failed to parse localStorage history:", e);
          }
        }
      }
    };
    
    loadHistory();
  }, []);

  useEffect(() => {
    localStorage.setItem("esg_upload_history", JSON.stringify(history));
  }, [history]);

  const start = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (userId) {
        fd.append("userId", userId);
      }
      
      const res = await fetch("/api/esg/upload", { method: "POST", body: fd });
      const json = await res.json();
      
      if (!res.ok) {
        throw new Error(json.error || "Upload failed");
      }
      
      setJobId(json.jobId);
      setStatus({ status: "queued", progress: 0, rowsDone: 0, rowsTotal: 0 });
      
      // Add to local history quickly
      setHistory((h) => [
        {
          id: Date.now(),
          task_id: json.jobId,
          original_filename: file.name,
          status: "queued",
          created_at: new Date().toISOString(),
        },
        ...h,
      ]);
    } catch (error: any) {
      console.error("Upload error:", error);
      alert(error.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const stop = async () => {
    if (!jobId) return;
    try {
      await fetch("/api/esg/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
    } catch (error) {
      console.error("Stop error:", error);
    }
  };

  const deleteHistoryItem = async (taskId: string) => {
    try {
      // Remove from database
      const response = await fetch(`/api/esg/history?taskId=${taskId}`, {
        method: "DELETE",
      });
      
      if (response.ok) {
        // Remove from local history
        setHistory((h) => h.filter((item) => item.task_id !== taskId));
      } else {
        console.error("Failed to delete from database");
        // Still remove from local storage even if DB delete fails
        setHistory((h) => h.filter((item) => item.task_id !== taskId));
      }
    } catch (error) {
      console.error("Delete error:", error);
      // Remove from local storage even if API fails
      setHistory((h) => h.filter((item) => item.task_id !== taskId));
    }
  };

  // Poll for status updates
  useEffect(() => {
    if (!jobId) return;
    
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/esg/status?jobId=${jobId}`);
        if (r.ok) {
          const s = await r.json();
          setStatus(s);
          
          // Update local history item
          setHistory((h) =>
            h.map((it) => (it.task_id === jobId ? { ...it, status: s.status } : it))
          );
          
          if (s.status === "done" || s.status === "error" || s.status === "cancelled") {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      } catch (error) {
        console.error("Status polling error:", error);
      }
    }, 1200);
    
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [jobId]);

  const canDownload = status?.status === "done";
  const isProcessing = Boolean(status && ["queued", "processing"].includes(status.status));

  const formatFileSize = (file: File) => {
    const bytes = file.size;
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "done": return <CheckCircle className="w-4 h-4 text-green-600" />;
      case "error": return <XCircle className="w-4 h-4 text-red-600" />;
      case "cancelled": return <AlertCircle className="w-4 h-4 text-gray-600" />;
      default: return <Clock className="w-4 h-4 text-blue-600" />;
    }
  };

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-green-500 to-blue-600 rounded-2xl mb-4">
          <FileSpreadsheet className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-3xl font-bold text-gray-900 mb-2">Excel Updater</h2>
        <p className="text-gray-600 max-w-2xl mx-auto">
          Upload Excel files with company names and automatically populate ESG ratings from S&P, ISS, and LSEG sources.
        </p>
      </div>

      {/* Upload Section */}
      <div className="bg-gradient-to-br from-blue-50 to-indigo-100 rounded-2xl p-8 border border-blue-200">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Upload Your Excel File</h3>
            <p className="text-gray-600">
              Choose an Excel file (.xlsx or .xls) with a <span className="font-medium text-blue-700">Company</span> or 
              <span className="font-medium text-blue-700"> Company Name</span> column.
            </p>
          </div>

          {/* File Drop Zone */}
          <div className="relative">
            <input
              id="excel-file"
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              disabled={isProcessing}
            />
            <div className={`border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200 ${
              file 
                ? "border-green-300 bg-green-50" 
                : "border-blue-300 bg-white hover:border-blue-400 hover:bg-blue-50"
            }`}>
              {file ? (
                <div className="space-y-3">
                  <div className="inline-flex items-center justify-center w-12 h-12 bg-green-100 rounded-xl">
                    <FileSpreadsheet className="w-6 h-6 text-green-600" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{file.name}</p>
                    <p className="text-sm text-gray-500">{formatFileSize(file)}</p>
                  </div>
                  <button
                    onClick={() => setFile(null)}
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                    disabled={isProcessing}
                  >
                    Choose Different File
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-100 rounded-xl">
                    <Upload className="w-6 h-6 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-lg font-medium text-gray-900">Drop your file here</p>
                    <p className="text-gray-500">or <span className="text-blue-600 font-medium">browse</span> to choose a file</p>
                  </div>
                  <p className="text-xs text-gray-400">Supports .xlsx and .xls files up to 10MB</p>
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-center gap-4 mt-8">
            <button
              onClick={start}
              disabled={!file || uploading || isProcessing}
              className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-green-600 to-blue-600 text-white rounded-xl hover:from-green-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold transition-all duration-200 shadow-lg hover:shadow-xl"
            >
              <Play className="w-4 h-4" />
              {uploading ? "Uploading..." : "Start Processing"}
            </button>
            
            <button
              onClick={stop}
              disabled={!jobId || !isProcessing}
              className="flex items-center gap-2 px-6 py-3 bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold transition-all duration-200"
            >
              <Square className="w-4 h-4" />
              Stop Processing
            </button>
          </div>

          {/* Quick Actions */}
          {status?.status === "done" && (
            <div className="flex justify-center gap-4 mt-6">
              <a
                className="flex items-center gap-2 px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 font-medium transition-colors"
                href={`/api/esg/download?jobId=${jobId}`}
                download
              >
                <Download className="w-4 h-4" />
                Download Result
              </a>
              <a
                className="flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 font-medium transition-colors"
                href={`/esg/tools/view?jobId=${jobId}`}
              >
                <Eye className="w-4 h-4" />
                View Data
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Progress Section */}
      {status && (
        <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                {getStatusIcon(status.status)}
                <div>
                  <h4 className="font-semibold text-gray-900">Processing Status</h4>
                  <p className="text-sm text-gray-600 capitalize">{status.status}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium text-gray-900">{status.progress}% Complete</p>
                <p className="text-xs text-gray-500">{status.rowsDone} / {status.rowsTotal} companies</p>
              </div>
            </div>
            
            <div className="w-full bg-gray-200 rounded-full h-3 mb-4">
              <div
                className={`h-3 rounded-full transition-all duration-500 ${
                  status.status === "done" ? "bg-green-500" :
                  status.status === "error" ? "bg-red-500" :
                  "bg-gradient-to-r from-blue-500 to-indigo-500"
                }`}
                style={{ width: `${status.progress || 0}%` }}
              />
            </div>
            
            {status.error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <XCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <h5 className="font-medium text-red-800">Processing Error</h5>
                    <p className="text-sm text-red-700 mt-1">{status.error}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* History Section */}
      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
        <div className="p-6 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-blue-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <Clock className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h3 className="text-xl font-semibold text-gray-900">Processing History</h3>
              <p className="text-gray-600">Your recent Excel processing jobs</p>
            </div>
          </div>
        </div>
        
        <div className="max-h-96 overflow-y-auto">
          {history.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-2xl mx-auto mb-4 flex items-center justify-center">
                <FileSpreadsheet className="w-8 h-8 text-gray-400" />
              </div>
              <h4 className="text-lg font-medium text-gray-900 mb-2">No processing history yet</h4>
              <p className="text-gray-500">Upload your first Excel file to get started with ESG data processing.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {history.map((h) => (
                <div key={h.task_id} className="p-6 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
                        <FileSpreadsheet className="w-5 h-5 text-blue-600" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-3 mb-1">
                          <p className="font-medium text-gray-900 truncate">{h.original_filename}</p>
                          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                            h.status === "done" ? "bg-green-100 text-green-800" :
                            h.status === "error" ? "bg-red-100 text-red-800" :
                            h.status === "cancelled" ? "bg-gray-100 text-gray-800" :
                            "bg-blue-100 text-blue-800"
                          }`}>
                            {getStatusIcon(h.status)}
                            {h.status}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-gray-500">
                          <span>ID: {h.task_id.slice(0, 8)}...</span>
                          <span>{new Date(h.created_at).toLocaleDateString()}</span>
                        </div>
                        {h.error_message && (
                          <p className="text-sm text-red-600 mt-2 bg-red-50 rounded-lg px-3 py-2">{h.error_message}</p>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 ml-4">
                      <a
                        className="flex items-center gap-1 px-3 py-2 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
                        href={`/esg/tools/view?jobId=${h.task_id}`}
                      >
                        <Eye className="w-4 h-4" />
                        View
                      </a>
                      <a
                        className="flex items-center gap-1 px-3 py-2 text-sm text-green-600 border border-green-200 rounded-lg hover:bg-green-50 transition-colors"
                        href={`/api/esg/download?jobId=${h.task_id}`}
                        download
                      >
                        <Download className="w-4 h-4" />
                        Download
                      </a>
                      <button
                        onClick={() => deleteHistoryItem(h.task_id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete this record"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
