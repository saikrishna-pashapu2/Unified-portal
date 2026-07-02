"use client";
import { useEffect, useState, useRef } from "react";
import dynamic from "next/dynamic";

// Extend Window interface for global pdfjsLib
declare global {
  interface Window {
    pdfjsLib: any;
  }
}

type ViewMode = "text" | "image";
const PDFJS_CDN_VERSION = "4.2.67";

interface PdfSideBySideProps {
  jobId: string;
  brand?: "credit" | "esg";
}

// Create a client-only PDF viewer component
const PdfViewerContent = dynamic(() => Promise.resolve(PdfViewerContentComponent), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-center py-12">
          <div className="text-gray-500">Loading PDF viewer...</div>
        </div>
      </div>
    </div>
  ),
});

function PdfViewerContentComponent({ jobId, brand = "credit" }: PdfSideBySideProps) {
  const [mode, setMode] = useState<ViewMode>("text");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [originalText, setOriginalText] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(1.0);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pdfjsLib, setPdfjsLib] = useState<any>(null);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Load PDF.js dynamically on client side only.
  useEffect(() => {
    let cancelled = false;

    const loadPdfJs = async () => {
      try {
        const pdfjs = await import(
          /* webpackIgnore: true */
          `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_CDN_VERSION}/pdf.min.mjs`
        );

        if (!cancelled) {
          (pdfjs as any).GlobalWorkerOptions.workerSrc =
            `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_CDN_VERSION}/pdf.worker.min.mjs`;
          setPdfjsLib(pdfjs);
        }
      } catch (error) {
        console.error('Failed to load pdfjs-dist:', error);
      }
    };
    
    loadPdfJs();

    return () => {
      cancelled = true;
    };
  }, []);

  // Load PDF document once pdfjs is available
  useEffect(() => {
    if (!pdfjsLib) return;
    
    const loadPdf = async () => {
      try {
        const url = `/api/pdfx/file?jobId=${jobId}`;
        const doc = await pdfjsLib.getDocument(url).promise;
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
      } catch (err) {
        console.error("Failed to load PDF:", err);
      }
    };
    loadPdf();
  }, [jobId, pdfjsLib]);

  // Load page text content
  const loadPageContent = async (page: number) => {
    setLoading(true);
    try {
      const url = new URL("/api/pdfx/page", window.location.origin);
      url.searchParams.set("jobId", jobId);
      url.searchParams.set("page", String(page));
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setOriginalText(data.originalText || "");
          setTranslatedText(data.translatedText || "");
        }
      }
    } catch (err) {
      console.error("Failed to load page content:", err);
    } finally {
      setLoading(false);
    }
  };

  // Render PDF page to canvas
  const renderPage = async (page: number) => {
    if (!pdfDoc || !canvasRef.current) return;
    
    try {
      const pdfPage = await pdfDoc.getPage(page);
      const viewport = pdfPage.getViewport({ scale: zoom });
      
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const renderContext = {
        canvasContext: context,
        viewport: viewport,
      };
      
      await pdfPage.render(renderContext).promise;
    } catch (err) {
      console.error("Failed to render page:", err);
    }
  };

  // Load content when page changes
  useEffect(() => {
    if (currentPage > 0) {
      loadPageContent(currentPage);
      if (mode === "image") {
        renderPage(currentPage);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, mode, zoom, pdfDoc]);

  // Show loading state until pdfjs is loaded
  if (!pdfjsLib) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center py-12">
            <div className="text-gray-500">Loading PDF.js library...</div>
          </div>
        </div>
      </div>
    );
  }

  const nextPage = () => {
    if (currentPage < totalPages) setCurrentPage(currentPage + 1);
  };

  const prevPage = () => {
    if (currentPage > 1) setCurrentPage(currentPage - 1);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm border p-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <h1 className="text-xl font-semibold">PDF Translation Viewer</h1>
            
            <div className="flex items-center gap-4">
              {/* View Mode Toggle */}
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium">View:</label>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as ViewMode)}
                  className="border rounded px-2 py-1 text-sm"
                >
                  <option value="text">Text Only</option>
                  <option value="image">Original PDF</option>
                </select>
              </div>

              {/* Zoom Control (for image mode) */}
              {mode === "image" && (
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium">Zoom:</label>
                  <select
                    value={zoom}
                    onChange={(e) => setZoom(Number(e.target.value))}
                    className="border rounded px-2 py-1 text-sm"
                  >
                    <option value={0.5}>50%</option>
                    <option value={0.75}>75%</option>
                    <option value={1.0}>100%</option>
                    <option value={1.25}>125%</option>
                    <option value={1.5}>150%</option>
                    <option value={2.0}>200%</option>
                  </select>
                </div>
              )}

              {/* Page Navigation */}
              <div className="flex items-center gap-2">
                <button
                  onClick={prevPage}
                  disabled={currentPage <= 1}
                  className="px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50 text-sm"
                >
                  ← Prev
                </button>
                <span className="text-sm font-medium">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={nextPage}
                  disabled={currentPage >= totalPages}
                  className="px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50 text-sm"
                >
                  Next →
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Content Area */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-gray-500">Loading page content...</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Left Panel: Original */}
            <div className="bg-white rounded-lg shadow-sm border">
              <div className="border-b px-4 py-3">
                <h2 className="font-medium text-gray-900">
                  Original {mode === "text" ? "Text" : "PDF Page"}
                </h2>
              </div>
              <div className="p-4">
                {mode === "text" ? (
                  <div className="prose prose-sm max-w-none">
                    <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans leading-relaxed">
                      {originalText || "No text found on this page."}
                    </pre>
                  </div>
                ) : (
                  <div className="overflow-auto max-h-[800px]">
                    <canvas ref={canvasRef} className="border rounded" />
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel: Translated */}
            <div className="bg-white rounded-lg shadow-sm border">
              <div className="border-b px-4 py-3">
                <h2 className="font-medium text-gray-900">Translated Text</h2>
              </div>
              <div className="p-4">
                <div className="prose prose-sm max-w-none">
                  <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans leading-relaxed">
                    {translatedText || "No translation available for this page."}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Navigation Footer */}
        <div className="bg-white rounded-lg shadow-sm border p-4">
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={currentPage <= 1}
              className="px-3 py-1 border rounded disabled:opacity-50 text-sm"
            >
              First
            </button>
            <button
              onClick={prevPage}
              disabled={currentPage <= 1}
              className="px-3 py-1 border rounded disabled:opacity-50 text-sm"
            >
              Previous
            </button>
            <input
              type="number"
              min={1}
              max={totalPages}
              value={currentPage}
              onChange={(e) => {
                const page = Number(e.target.value);
                if (page >= 1 && page <= totalPages) {
                  setCurrentPage(page);
                }
              }}
              className="w-16 px-2 py-1 border rounded text-center text-sm"
            />
            <span className="text-sm text-gray-600">of {totalPages}</span>
            <button
              onClick={nextPage}
              disabled={currentPage >= totalPages}
              className="px-3 py-1 border rounded disabled:opacity-50 text-sm"
            >
              Next
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage >= totalPages}
              className="px-3 py-1 border rounded disabled:opacity-50 text-sm"
            >
              Last
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PdfSideBySide(props: PdfSideBySideProps) {
  return <PdfViewerContent {...props} />;
}
