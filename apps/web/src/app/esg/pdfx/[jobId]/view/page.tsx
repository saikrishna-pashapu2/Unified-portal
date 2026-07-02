'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { 
  ChevronLeft, 
  ChevronRight, 
  SkipBack, 
  SkipForward, 
  Book, 
  BookOpen, 
  Download, 
  ArrowLeft, 
  Copy, 
  Check,
  Search,
  ZoomIn,
  ZoomOut,
  RotateCcw
} from 'lucide-react';

type PagePayload = {
  pageNumber: number;
  originalText: string;
  translatedText: string;
};

export default function PdfView() {
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId;
  const [pages, setPages] = useState<PagePayload[]>([]);
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<'single' | 'continuous'>('single');
  const [loading, setLoading] = useState(true);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(14);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/pdfx/pages?jobId=${jobId}`);
        const json = await res.json();
        if (json.success) {
          const sorted = (json.pages as PagePayload[]).sort((a, b) => a.pageNumber - b.pageNumber);
          setPages(sorted);
        }
      } catch (error) {
        console.error('Failed to load pages:', error);
      } finally {
        setLoading(false);
      }
    })();
  }, [jobId]);

  const total = pages.length;
  const current = pages.find(p => p.pageNumber === page);

  const copyToClipboard = async (text: string, type: 'original' | 'translated') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(type);
      setTimeout(() => setCopiedText(null), 2000);
    } catch (error) {
      console.error('Failed to copy text:', error);
    }
  };

  const goToPage = (pageNum: number) => {
    setPage(Math.max(1, Math.min(total, pageNum)));
  };

  const filteredPages = pages.filter(p => 
    searchTerm === '' || 
    p.originalText.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.translatedText.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-purple-50/20">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <span className="ml-3 text-gray-600">Loading PDF pages...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-purple-50/20">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-white/50 sticky top-16 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link 
                href={`/esg/pdfx`}
                className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to PDF Translator
              </Link>
              <div className="h-6 w-px bg-gray-300"></div>
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-blue-600" />
                PDF Translation Viewer
              </h1>
            </div>
            
            <div className="flex items-center gap-2">
              <a
                href={`/api/pdfx/download?jobId=${jobId}`}
                className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
              >
                <Download className="h-4 w-4" />
                Download PDF
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Controls */}
        <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg border border-white/50 p-6 mb-8">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            {/* View Mode Toggle */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">View Mode:</span>
              <div className="inline-flex bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setMode('single')}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                    mode === 'single'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Book className="h-4 w-4" />
                  Single Page
                </button>
                <button
                  onClick={() => setMode('continuous')}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                    mode === 'continuous'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <BookOpen className="h-4 w-4" />
                  Continuous
                </button>
              </div>
            </div>

            {/* Search */}
            <div className="flex items-center gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search in pages..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 bg-white/80 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm w-64"
                />
              </div>

              {/* Font Size Controls */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setFontSize(f => Math.max(10, f - 2))}
                  className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
                  title="Decrease font size"
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
                <span className="text-sm font-medium text-gray-700 min-w-[3rem] text-center">
                  {fontSize}px
                </span>
                <button
                  onClick={() => setFontSize(f => Math.min(24, f + 2))}
                  className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
                  title="Increase font size"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setFontSize(14)}
                  className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
                  title="Reset font size"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Single Page Navigation */}
          {mode === 'single' && (
            <div className="flex items-center justify-center gap-4 mt-6 pt-6 border-t border-gray-200">
              <button
                onClick={() => goToPage(1)}
                disabled={page === 1}
                className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="First page"
              >
                <SkipBack className="h-4 w-4" />
              </button>
              <button
                onClick={() => goToPage(page - 1)}
                disabled={page === 1}
                className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-600">Page</span>
                <input
                  type="number"
                  min={1}
                  max={total}
                  value={page}
                  onChange={(e) => goToPage(parseInt(e.target.value) || 1)}
                  className="w-16 px-2 py-1 text-center bg-white border border-gray-200 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                />
                <span className="text-sm text-gray-600">of {total}</span>
              </div>

              <button
                onClick={() => goToPage(page + 1)}
                disabled={page === total}
                className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                onClick={() => goToPage(total)}
                disabled={page === total}
                className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Last page"
              >
                <SkipForward className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {/* Content */}
        {mode === 'single' && current && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            {/* Original Text */}
            <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg border border-white/50 overflow-hidden">
              <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-gray-400 rounded-full"></div>
                    <span className="font-medium text-gray-900">Original Text</span>
                  </div>
                  <button
                    onClick={() => copyToClipboard(current.originalText, 'original')}
                    className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded-md transition-colors"
                  >
                    {copiedText === 'original' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copiedText === 'original' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
              <div className="p-6 overflow-auto max-h-[70vh]">
                <pre 
                  className="whitespace-pre-wrap text-gray-800 leading-relaxed"
                  style={{ fontSize: `${fontSize}px` }}
                >
                  {current.originalText || (
                    <span className="text-gray-400 italic">No original text available for this page</span>
                  )}
                </pre>
              </div>
            </div>

            {/* Translated Text */}
            <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg border border-white/50 overflow-hidden">
              <div className="bg-gradient-to-r from-blue-50 to-blue-100 px-6 py-4 border-b border-blue-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                    <span className="font-medium text-gray-900">Translated Text</span>
                  </div>
                  <button
                    onClick={() => copyToClipboard(current.translatedText, 'translated')}
                    className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium text-blue-600 hover:text-blue-900 hover:bg-blue-200 rounded-md transition-colors"
                  >
                    {copiedText === 'translated' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copiedText === 'translated' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
              <div className="p-6 overflow-auto max-h-[70vh]">
                <pre 
                  className="whitespace-pre-wrap text-gray-800 leading-relaxed"
                  style={{ fontSize: `${fontSize}px` }}
                >
                  {current.translatedText || (
                    <span className="text-gray-400 italic">No translation available for this page</span>
                  )}
                </pre>
              </div>
            </div>
          </div>
        )}

        {mode === 'continuous' && (
          <div className="space-y-8">
            {(searchTerm ? filteredPages : pages).map((p, index) => (
              <div key={p.pageNumber} className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                {/* Original Text */}
                <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg border border-white/50 overflow-hidden">
                  <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-4 border-b border-gray-200">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-gray-400 rounded-full"></div>
                        <span className="font-medium text-gray-900">Original - Page {p.pageNumber}</span>
                      </div>
                      <button
                        onClick={() => copyToClipboard(p.originalText, 'original')}
                        className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded-md transition-colors"
                      >
                        <Copy className="h-3 w-3" />
                        Copy
                      </button>
                    </div>
                  </div>
                  <div className="p-6 overflow-auto">
                    <pre 
                      className="whitespace-pre-wrap text-gray-800 leading-relaxed"
                      style={{ fontSize: `${fontSize}px` }}
                    >
                      {p.originalText || (
                        <span className="text-gray-400 italic">No original text available for this page</span>
                      )}
                    </pre>
                  </div>
                </div>

                {/* Translated Text */}
                <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg border border-white/50 overflow-hidden">
                  <div className="bg-gradient-to-r from-blue-50 to-blue-100 px-6 py-4 border-b border-blue-200">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                        <span className="font-medium text-gray-900">Translated - Page {p.pageNumber}</span>
                      </div>
                      <button
                        onClick={() => copyToClipboard(p.translatedText, 'translated')}
                        className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium text-blue-600 hover:text-blue-900 hover:bg-blue-200 rounded-md transition-colors"
                      >
                        <Copy className="h-3 w-3" />
                        Copy
                      </button>
                    </div>
                  </div>
                  <div className="p-6 overflow-auto">
                    <pre 
                      className="whitespace-pre-wrap text-gray-800 leading-relaxed"
                      style={{ fontSize: `${fontSize}px` }}
                    >
                      {p.translatedText || (
                        <span className="text-gray-400 italic">No translation available for this page</span>
                      )}
                    </pre>
                  </div>
                </div>
              </div>
            ))}
            
            {searchTerm && filteredPages.length === 0 && (
              <div className="text-center py-12">
                <Search className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No matches found</h3>
                <p className="text-gray-500">Try adjusting your search terms</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
