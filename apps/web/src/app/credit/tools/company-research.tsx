"use client";

import { useState, useEffect } from "react";
import { 
  Search, Building2, Sparkles, Globe, Users, TrendingUp, Leaf, Loader2, AlertCircle,
  Clock, DollarSign, FileText, Shield, Briefcase, BarChart3, History, ChevronDown, ExternalLink
} from "lucide-react";
import SafeHTMLContent from "@/components/SafeHTMLContent";

interface ResearchResult {
  company_profile: {
    name: string;
    ticker?: string;
    origin_country?: string;
    listed_country?: string;
    is_publicly_listed?: boolean;
    website?: string;
    industry?: string;
    sector?: string;
  };
  executive_summary: string;
  findings: any[];
  contacts: any[];
  html_content: string;
  research_metadata: {
    total_sources_consulted: number;
    research_duration_seconds: number;
    tokens_used: number;
    model_used: string;
  };
}

interface ResearchHistoryItem {
  sessionId: string;
  companyName: string;
  status: string;
  createdAt: string;
  findingsCount: number;
  contactsCount: number;
}

export default function CreditCompanyResearchTool() {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");
  const [history, setHistory] = useState<ResearchHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Fetch research history on mount
  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const response = await fetch("/api/research/company?limit=5");
      if (response.ok) {
        const data = await response.json();
        setHistory(data.history || []);
      }
    } catch (err) {
      console.error("Failed to fetch history:", err);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    
    setIsSearching(true);
    setError(null);
    setResult(null);
    setProgress("Initiating deep research...");

    // Simulate progress updates
    const progressSteps = [
      "Searching company overview...",
      "Analyzing financial data...",
      "Gathering credit ratings...",
      "Finding key contacts...",
      "Researching competitive landscape...",
      "Compiling final report..."
    ];

    let stepIndex = 0;
    const progressInterval = setInterval(() => {
      if (stepIndex < progressSteps.length) {
        setProgress(progressSteps[stepIndex]);
        stepIndex++;
      }
    }, 8000);

    try {
      const response = await fetch("/api/research/company", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ companyName: query }),
      });

      clearInterval(progressInterval);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to conduct research");
      }

      const data = await response.json();
      setResult(data);
      setProgress("");
      fetchHistory(); // Refresh history
    } catch (err: any) {
      console.error("Research error:", err);
      setError(err.message || "An unexpected error occurred");
      setProgress("");
    } finally {
      setIsSearching(false);
    }
  };

  const loadFromHistory = async (sessionId: string) => {
    try {
      const response = await fetch(`/api/research/company?sessionId=${sessionId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.finalReport) {
          setResult(data.finalReport);
          setQuery(data.companyName);
        }
      }
    } catch (err) {
      console.error("Failed to load from history:", err);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center space-y-4">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-700 to-slate-600 text-white shadow-lg">
          <Sparkles size={28} />
        </div>
        <h1 className="text-3xl font-bold text-[var(--text)]">
          AI Deep Company Research
        </h1>
        <p className="text-[var(--text-muted)] max-w-2xl mx-auto">
          Comprehensive AI-powered company intelligence for credit analysis. 
          Get detailed insights on financials, credit ratings, risk assessment, 
          key contacts, and strategic intelligence.
        </p>
      </div>

      {/* Search Form */}
      <form onSubmit={handleSearch} className="relative">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={20} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter company name (e.g., Apple, Microsoft, JP Morgan...)"
            className="w-full pl-12 pr-36 py-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-slate-500/50 focus:border-slate-500 transition-all text-lg"
          />
          <button
            type="submit"
            disabled={isSearching || !query.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-6 py-2.5 rounded-lg bg-slate-700 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-600 transition-colors flex items-center gap-2"
          >
            {isSearching ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Researching...
              </>
            ) : (
              <>
                <Sparkles size={18} />
                Deep Research
              </>
            )}
          </button>
        </div>
      </form>

      {/* Research History Toggle */}
      {history.length > 0 && !isSearching && !result && (
        <div className="border border-[var(--border)] rounded-xl overflow-hidden">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="w-full px-4 py-3 flex items-center justify-between bg-[var(--surface)] hover:bg-[var(--surface-highlight)] transition-colors"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-[var(--text)]">
              <History size={16} />
              Recent Research ({history.length})
            </span>
            <ChevronDown size={16} className={`transform transition-transform ${showHistory ? 'rotate-180' : ''}`} />
          </button>
          {showHistory && (
            <div className="divide-y divide-[var(--border)]">
              {history.map((item) => (
                <button
                  key={item.sessionId}
                  onClick={() => loadFromHistory(item.sessionId)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-[var(--surface-highlight)] transition-colors text-left"
                >
                  <div>
                    <p className="font-medium text-[var(--text)]">{item.companyName}</p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {new Date(item.createdAt).toLocaleDateString()} • {item.findingsCount} findings • {item.contactsCount} contacts
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded ${
                    item.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {item.status}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Progress Indicator */}
      {isSearching && (
        <div className="p-6 rounded-xl bg-[var(--surface)] border border-[var(--border)] animate-pulse">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-slate-500/20 flex items-center justify-center">
              <Loader2 className="animate-spin text-slate-600" size={24} />
            </div>
            <div className="flex-1">
              <p className="font-medium text-[var(--text)]">{progress}</p>
              <p className="text-sm text-[var(--text-muted)]">
                This may take 1-2 minutes for comprehensive research...
              </p>
            </div>
          </div>
          <div className="mt-4 w-full bg-[var(--border)] rounded-full h-2 overflow-hidden">
            <div className="h-full bg-slate-600 rounded-full" 
                 style={{ width: '60%', animation: 'pulse 2s ease-in-out infinite' }} />
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 flex items-center gap-3">
          <AlertCircle size={20} />
          <p>{error}</p>
        </div>
      )}

      {/* Results */}
      {result ? (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {/* Research Metadata */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetadataCard icon={FileText} label="Sources" value={result.research_metadata.total_sources_consulted.toString()} />
            <MetadataCard icon={Clock} label="Duration" value={`${result.research_metadata.research_duration_seconds.toFixed(1)}s`} />
            <MetadataCard icon={Users} label="Contacts" value={result.contacts.length.toString()} />
            <MetadataCard icon={BarChart3} label="Findings" value={result.findings.length.toString()} />
          </div>

          {/* Main Report */}
          <div className="bg-[var(--surface)] rounded-2xl shadow-sm border border-[var(--border)] overflow-hidden">
            <div className="p-6 border-b border-[var(--border)] bg-gradient-to-r from-slate-500/5 to-transparent">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-2xl font-bold text-[var(--text)]">{result.company_profile.name}</h2>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {result.company_profile.ticker && (
                      <span className="text-xs px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">{result.company_profile.ticker}</span>
                    )}
                    {result.company_profile.origin_country && (
                      <span className="text-xs px-2 py-1 rounded-full bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300">{result.company_profile.origin_country}</span>
                    )}
                    {result.company_profile.industry && (
                      <span className="text-xs px-2 py-1 rounded-full bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300">{result.company_profile.industry}</span>
                    )}
                    {result.company_profile.is_publicly_listed && (
                      <span className="text-xs px-2 py-1 rounded-full bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300">Publicly Listed</span>
                    )}
                  </div>
                </div>
                {result.company_profile.website && (
                  <a href={result.company_profile.website} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)] text-sm font-medium hover:bg-[var(--surface-highlight)] transition-colors">
                    <ExternalLink size={14} />Website
                  </a>
                )}
              </div>
            </div>
            <div className="p-8">
              <SafeHTMLContent htmlContent={result.html_content} />
            </div>
          </div>

          {/* Clear Results Button */}
          <div className="text-center">
            <button onClick={() => { setResult(null); setQuery(""); }}
              className="text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
              ← Start New Research
            </button>
          </div>
        </div>
      ) : !isSearching && (
        <div>
          <h3 className="text-lg font-semibold text-[var(--text)] mb-4">What You&apos;ll Get</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <FeatureCard icon={Building2} title="Company Profile" description="Overview, history, headquarters, founding year, and global presence" color="slate" />
            <FeatureCard icon={TrendingUp} title="Financial Health" description="Revenue, margins, market cap, funding history, and key ratios" color="blue" />
            <FeatureCard icon={Shield} title="Credit Ratings" description="Moody's, S&P, Fitch ratings and credit risk assessment" color="amber" />
            <FeatureCard icon={DollarSign} title="Debt Profile" description="Debt structure, leverage ratios, and funding sources" color="green" />
            <FeatureCard icon={Users} title="Key Contacts" description="C-suite, investor relations, and treasury contacts with LinkedIn" color="purple" />
            <FeatureCard icon={BarChart3} title="Competitive Intel" description="Market position, competitors, M&A activity, and strategic partnerships" color="cyan" />
            <FeatureCard icon={Briefcase} title="BD Intelligence" description="Decision makers, budget cycles, pain points, and entry strategies" color="orange" />
            <FeatureCard icon={Leaf} title="ESG Performance" description="ESG ratings impact on credit and sustainability initiatives" color="emerald" />
            <FeatureCard icon={FileText} title="Reports & Filings" description="Annual reports, SEC filings, credit reports with direct links" color="pink" />
          </div>
        </div>
      )}
    </div>
  );
}

function MetadataCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string; }) {
  return (
    <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] flex items-center gap-3">
      <div className="w-8 h-8 rounded-full bg-slate-500/10 flex items-center justify-center">
        <Icon size={14} className="text-slate-600" />
      </div>
      <div>
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <p className="font-semibold text-[var(--text)]">{value}</p>
      </div>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, description, color }: { icon: React.ElementType; title: string; description: string; color: string; }) {
  const colorMap: Record<string, string> = {
    emerald: "from-emerald-500/10 to-emerald-500/5 text-emerald-600 dark:text-emerald-400",
    blue: "from-blue-500/10 to-blue-500/5 text-blue-600 dark:text-blue-400",
    purple: "from-purple-500/10 to-purple-500/5 text-purple-600 dark:text-purple-400",
    orange: "from-orange-500/10 to-orange-500/5 text-orange-600 dark:text-orange-400",
    cyan: "from-cyan-500/10 to-cyan-500/5 text-cyan-600 dark:text-cyan-400",
    pink: "from-pink-500/10 to-pink-500/5 text-pink-600 dark:text-pink-400",
    slate: "from-slate-500/10 to-slate-500/5 text-slate-600 dark:text-slate-400",
    amber: "from-amber-500/10 to-amber-500/5 text-amber-600 dark:text-amber-400",
    green: "from-green-500/10 to-green-500/5 text-green-600 dark:text-green-400",
  };
  return (
    <div className={`p-5 rounded-xl bg-gradient-to-br ${colorMap[color] || colorMap.slate} border border-[var(--border)]`}>
      <Icon size={24} className="mb-3" />
      <h3 className="font-semibold text-[var(--text)] mb-1">{title}</h3>
      <p className="text-sm text-[var(--text-muted)]">{description}</p>
    </div>
  );
}
