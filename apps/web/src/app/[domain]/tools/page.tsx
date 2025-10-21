"use client";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Search, FileSpreadsheet, TrendingUp, Users, Shield, Leaf, ArrowRight, BarChart3, Database, Zap, Brain } from "lucide-react";
import Link from "next/link";
import EsgSearch from "./search";
import EsgExcel from "./excel";

export default function ToolsPage({ params }: { params: { domain: "esg" | "credit" } }) {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"main" | "search" | "excel">("main");

  // Set initial tab based on URL parameter
  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam === "excel" || tabParam === "search") {
      setTab(tabParam);
    }
  }, [searchParams]);

  // Only show ESG tools for ESG domain for the specific ESG tools
  const showESGTools = params.domain === "esg";

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-green-50">
      <div className="mx-auto max-w-7xl px-4 py-8">
        {/* Hero Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-green-500 to-blue-600 rounded-2xl mb-6">
            <BarChart3 className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            {params.domain === "esg" ? "ESG Tools" : "Credit Tools"}
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
            {params.domain === "esg" 
              ? "Access comprehensive ESG data from multiple providers including S&P, ISS, and LSEG. Get instant insights into environmental, social, and governance performance."
              : "Powerful tools for credit analysis, risk assessment, and intelligent insights powered by AI."
            }
          </p>
        </div>

        {/* Navigation Tabs - Only show for ESG */}
        {showESGTools && (
          <div className="flex justify-center mb-12">
            <div className="inline-flex items-center bg-white rounded-xl p-1 shadow-lg border">
              <button
                onClick={() => setTab("main")}
                className={`flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                  tab === "main"
                    ? "bg-gradient-to-r from-green-500 to-blue-600 text-white shadow-md"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                }`}
              >
                <TrendingUp className="w-4 h-4" />
                Overview
              </button>
              <button
                onClick={() => setTab("search")}
                className={`flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                  tab === "search"
                    ? "bg-gradient-to-r from-green-500 to-blue-600 text-white shadow-md"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                }`}
              >
                <Search className="w-4 h-4" />
                ESG Search
              </button>
              <button
                onClick={() => setTab("excel")}
                className={`flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                  tab === "excel"
                    ? "bg-gradient-to-r from-green-500 to-blue-600 text-white shadow-md"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                }`}
              >
                <FileSpreadsheet className="w-4 h-4" />
                Excel Updater
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="space-y-8">
          {tab === "main" && showESGTools && (
            <div className="space-y-12">
              {/* Key Features */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                <div className="bg-white rounded-2xl p-8 shadow-lg border border-gray-100 hover:shadow-xl transition-all duration-300 group">
                  <div className="flex items-center justify-center w-12 h-12 bg-green-100 rounded-xl mb-6 group-hover:bg-green-200 transition-colors">
                    <Leaf className="w-6 h-6 text-green-600" />
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-3">Environmental</h3>
                  <p className="text-gray-600 leading-relaxed">
                    Track carbon footprint, resource usage, and environmental impact scores across your portfolio.
                  </p>
                </div>

                <div className="bg-white rounded-2xl p-8 shadow-lg border border-gray-100 hover:shadow-xl transition-all duration-300 group">
                  <div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-xl mb-6 group-hover:bg-blue-200 transition-colors">
                    <Users className="w-6 h-6 text-blue-600" />
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-3">Social</h3>
                  <p className="text-gray-600 leading-relaxed">
                    Evaluate employee relations, community impact, and social responsibility metrics.
                  </p>
                </div>

                <div className="bg-white rounded-2xl p-8 shadow-lg border border-gray-100 hover:shadow-xl transition-all duration-300 group">
                  <div className="flex items-center justify-center w-12 h-12 bg-purple-100 rounded-xl mb-6 group-hover:bg-purple-200 transition-colors">
                    <Shield className="w-6 h-6 text-purple-600" />
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-3">Governance</h3>
                  <p className="text-gray-600 leading-relaxed">
                    Assess board composition, executive compensation, and corporate governance practices.
                  </p>
                </div>
              </div>

              {/* Main Tools */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-gradient-to-br from-blue-50 to-indigo-100 rounded-2xl p-8 border border-blue-200 hover:shadow-xl transition-all duration-300 group">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="flex items-center justify-center w-14 h-14 bg-blue-600 rounded-xl group-hover:bg-blue-700 transition-colors">
                      <Search className="w-7 h-7 text-white" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-gray-900">ESG Search</h3>
                      <p className="text-blue-700">Individual company lookup</p>
                    </div>
                  </div>
                  <p className="text-gray-700 mb-6 leading-relaxed">
                    Search for individual companies and view their comprehensive ESG ratings from S&P Global, 
                    ISS (oekom), and LSEG sources. Get detailed insights with real-time data.
                  </p>
                  <div className="flex items-center gap-4 mb-6">
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Database className="w-4 h-4" />
                      <span>3 Data Sources</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Zap className="w-4 h-4" />
                      <span>Real-time Results</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setTab("search")}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-semibold transition-all duration-200 group-hover:translate-x-1"
                  >
                    Start Searching
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>

                <div className="bg-gradient-to-br from-green-50 to-emerald-100 rounded-2xl p-8 border border-green-200 hover:shadow-xl transition-all duration-300 group">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="flex items-center justify-center w-14 h-14 bg-green-600 rounded-xl group-hover:bg-green-700 transition-colors">
                      <FileSpreadsheet className="w-7 h-7 text-white" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-gray-900">Excel Updater</h3>
                      <p className="text-green-700">Bulk file processing</p>
                    </div>
                  </div>
                  <p className="text-gray-700 mb-6 leading-relaxed">
                    Upload Excel files with company names and automatically populate ESG ratings from all three sources. 
                    Perfect for portfolio analysis and bulk processing.
                  </p>
                  <div className="flex items-center gap-4 mb-6">
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <FileSpreadsheet className="w-4 h-4" />
                      <span>Bulk Processing</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <TrendingUp className="w-4 h-4" />
                      <span>Progress Tracking</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setTab("excel")}
                    className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-xl font-semibold transition-all duration-200 group-hover:translate-x-1"
                  >
                    Upload Excel
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Data Sources */}
              <div className="bg-white rounded-2xl p-8 shadow-lg border border-gray-100">
                <h3 className="text-2xl font-bold text-gray-900 mb-6 text-center">Trusted Data Sources</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  <div className="text-center">
                    <div className="w-16 h-16 bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl mx-auto mb-4 flex items-center justify-center">
                      <span className="text-white font-bold text-lg">S&P</span>
                    </div>
                    <h4 className="font-semibold text-gray-900 mb-2">S&P Global</h4>
                    <p className="text-gray-600 text-sm">Comprehensive ESG scores and sustainability ratings</p>
                  </div>
                  <div className="text-center">
                    <div className="w-16 h-16 bg-gradient-to-r from-green-500 to-green-600 rounded-xl mx-auto mb-4 flex items-center justify-center">
                      <span className="text-white font-bold text-lg">ISS</span>
                    </div>
                    <h4 className="font-semibold text-gray-900 mb-2">ISS (oekom)</h4>
                    <p className="text-gray-600 text-sm">Environmental and social impact assessments</p>
                  </div>
                  <div className="text-center">
                    <div className="w-16 h-16 bg-gradient-to-r from-purple-500 to-purple-600 rounded-xl mx-auto mb-4 flex items-center justify-center">
                      <span className="text-white font-bold text-xs">LSEG</span>
                    </div>
                    <h4 className="font-semibold text-gray-900 mb-2">LSEG (Refinitiv)</h4>
                    <p className="text-gray-600 text-sm">Global ESG data and transparency scores</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === "search" && (
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
              <EsgSearch />
            </div>
          )}
          
          {tab === "excel" && (
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
              <EsgExcel />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}