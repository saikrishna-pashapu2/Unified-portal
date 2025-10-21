"use client";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Brain, TrendingUp, FileText, BarChart3, Sparkles, Send, Loader2, AlertCircle, CheckCircle, Lock } from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface AnalysisResult {
  summary: string;
  keyInsights: string[];
  recommendations: string[];
  riskFactors?: string[];
}

export default function AIAnalystPage({ params }: { params: { domain: "esg" | "credit" } }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [analysisMode, setAnalysisMode] = useState<"chat" | "document" | "trends">("chat");
  const [isAdmin, setIsAdmin] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const checkAdminAccess = async () => {
      if (status === "loading") return;
      
      if (!session?.user) {
        router.push(`/${params.domain}/signin?callbackUrl=/${params.domain}/tools/ai-analyst`);
        return;
      }

      try {
        const res = await fetch("/api/admin/check-access");
        if (res.ok) {
          const data = await res.json();
          if (data.isAdmin) {
            setIsAdmin(true);
          } else {
            router.push(`/${params.domain}`);
          }
        } else {
          router.push(`/${params.domain}`);
        }
      } catch (error) {
        console.error("Error checking admin access:", error);
        router.push(`/${params.domain}`);
      } finally {
        setChecking(false);
      }
    };

    checkAdminAccess();
  }, [session, status, router, params.domain]);

  if (status === "loading" || checking) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-purple-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-purple-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Checking access...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-purple-50 to-blue-50 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-8">
          <Lock className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h2>
          <p className="text-gray-600 mb-6">This page is only accessible to administrators.</p>
          <button
            onClick={() => router.push(`/${params.domain}`)}
            className="px-6 py-3 bg-gradient-to-r from-purple-500 to-blue-600 text-white rounded-xl font-semibold hover:opacity-90 transition-opacity"
          >
            Return to Home
          </button>
        </div>
      </div>
    );
  }

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    // Simulate AI response (replace with actual API call)
    setTimeout(() => {
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: generateMockResponse(input, params.domain),
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, aiMessage]);
      setIsLoading(false);
    }, 2000);
  };

  const generateMockResponse = (query: string, domain: string): string => {
    return `Based on your query about "${query}", here's my analysis:\n\n**Key Findings:**\n1. Recent market trends show increased focus on key performance metrics\n2. Regulatory changes are impacting reporting requirements\n3. Investment flows indicate growing institutional interest\n\n**Recommendations:**\n- Monitor upcoming policy changes\n- Review portfolio alignment with industry standards\n- Consider diversification strategies\n\nWould you like me to dive deeper into any specific aspect?`;
  };

  const quickActions = [
    { label: "Analyze Market Trends", icon: TrendingUp, prompt: "What are the current market trends in this sector?" },
    { label: "Risk Assessment", icon: AlertCircle, prompt: "Provide a risk assessment for current portfolio holdings" },
    { label: "Generate Report", icon: FileText, prompt: "Generate a comprehensive analysis report" },
    { label: "Compare Metrics", icon: BarChart3, prompt: "Compare key performance metrics across sectors" },
  ];

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-purple-50 to-blue-50">
      <div className="mx-auto max-w-7xl px-4 py-8">
        {/* Hero Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-purple-500 to-blue-600 rounded-2xl mb-6">
            <Brain className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            AI Analyst
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
            Your intelligent assistant for financial analysis, insights, and recommendations.
            Powered by advanced AI to help you make data-driven decisions.
          </p>
        </div>

        {/* Mode Selection */}
        <div className="flex justify-center mb-8">
          <div className="inline-flex items-center bg-white rounded-xl p-1 shadow-lg border">
            <button
              onClick={() => setAnalysisMode("chat")}
              className={`flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                analysisMode === "chat"
                  ? "bg-gradient-to-r from-purple-500 to-blue-600 text-white shadow-md"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
              }`}
            >
              <Brain className="w-4 h-4" />
              Chat Analysis
            </button>
            <button
              onClick={() => setAnalysisMode("document")}
              className={`flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                analysisMode === "document"
                  ? "bg-gradient-to-r from-purple-500 to-blue-600 text-white shadow-md"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
              }`}
            >
              <FileText className="w-4 h-4" />
              Document Analysis
            </button>
            <button
              onClick={() => setAnalysisMode("trends")}
              className={`flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                analysisMode === "trends"
                  ? "bg-gradient-to-r from-purple-500 to-blue-600 text-white shadow-md"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
              }`}
            >
              <TrendingUp className="w-4 h-4" />
              Trend Analysis
            </button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Chat Interface */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
              {/* Chat Header */}
              <div className="bg-gradient-to-r from-purple-500 to-blue-600 p-6">
                <div className="flex items-center gap-3">
                  <Sparkles className="w-6 h-6 text-white" />
                  <div>
                    <h2 className="text-xl font-semibold text-white">AI Analysis Assistant</h2>
                    <p className="text-purple-100 text-sm">Ask questions, get insights, make decisions</p>
                  </div>
                </div>
              </div>

              {/* Messages Area */}
              <div className="h-[500px] overflow-y-auto p-6 space-y-4">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <Brain className="w-16 h-16 text-gray-300 mb-4" />
                    <h3 className="text-xl font-semibold text-gray-700 mb-2">Start Your Analysis</h3>
                    <p className="text-gray-500 mb-6 max-w-md">
                      Ask me anything about market data, trends, or get recommendations
                      for your investment decisions.
                    </p>
                    <div className="grid grid-cols-2 gap-3 w-full max-w-2xl">
                      {quickActions.map((action, idx) => (
                        <button
                          key={idx}
                          onClick={() => setInput(action.prompt)}
                          className="flex items-center gap-2 p-3 bg-gray-50 hover:bg-gray-100 rounded-lg text-left transition-colors border border-gray-200"
                        >
                          <action.icon className="w-4 h-4 text-purple-600 flex-shrink-0" />
                          <span className="text-sm text-gray-700">{action.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    {messages.map((message) => (
                      <div
                        key={message.id}
                        className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[80%] rounded-2xl p-4 ${
                            message.role === "user"
                              ? "bg-gradient-to-r from-purple-500 to-blue-600 text-white"
                              : "bg-gray-100 text-gray-900"
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            {message.role === "assistant" && (
                              <Brain className="w-5 h-5 text-purple-600 flex-shrink-0 mt-1" />
                            )}
                            <div className="flex-1">
                              <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
                              <span className="text-xs opacity-70 mt-2 block">
                                {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {isLoading && (
                      <div className="flex justify-start">
                        <div className="bg-gray-100 rounded-2xl p-4">
                          <div className="flex items-center gap-2">
                            <Loader2 className="w-5 h-5 text-purple-600 animate-spin" />
                            <span className="text-sm text-gray-600">Analyzing...</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Input Area */}
              <div className="border-t border-gray-200 p-4">
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
                    placeholder="Ask me anything about your data..."
                    className="flex-1 px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    disabled={isLoading}
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={!input.trim() || isLoading}
                    className="px-6 py-3 bg-gradient-to-r from-purple-500 to-blue-600 text-white rounded-xl font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {isLoading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Send className="w-5 h-5" />
                    )}
                    Send
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar - Features & Info */}
          <div className="space-y-6">
            {/* Capabilities Card */}
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-600" />
                AI Capabilities
              </h3>
              <ul className="space-y-3">
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-gray-900 text-sm">Market Analysis</p>
                    <p className="text-gray-600 text-xs">Real-time insights on market trends</p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-gray-900 text-sm">Risk Assessment</p>
                    <p className="text-gray-600 text-xs">Identify and evaluate risks</p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-gray-900 text-sm">Data Visualization</p>
                    <p className="text-gray-600 text-xs">Generate charts and reports</p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-gray-900 text-sm">Recommendations</p>
                    <p className="text-gray-600 text-xs">Strategic action suggestions</p>
                  </div>
                </li>
              </ul>
            </div>

            {/* Quick Stats */}
            <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-2xl border border-purple-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Stats</h3>
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-600">Analysis Accuracy</span>
                    <span className="text-sm font-semibold text-gray-900">98%</span>
                  </div>
                  <div className="w-full bg-white rounded-full h-2">
                    <div className="bg-gradient-to-r from-purple-500 to-blue-600 h-2 rounded-full" style={{ width: '98%' }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-600">Response Time</span>
                    <span className="text-sm font-semibold text-gray-900">&lt; 2s</span>
                  </div>
                  <div className="w-full bg-white rounded-full h-2">
                    <div className="bg-gradient-to-r from-green-500 to-emerald-600 h-2 rounded-full" style={{ width: '95%' }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-600">Data Coverage</span>
                    <span className="text-sm font-semibold text-gray-900">10K+ Sources</span>
                  </div>
                  <div className="w-full bg-white rounded-full h-2">
                    <div className="bg-gradient-to-r from-blue-500 to-indigo-600 h-2 rounded-full" style={{ width: '100%' }}></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Tips Card */}
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-blue-600" />
                Pro Tips
              </h3>
              <ul className="space-y-2 text-sm text-gray-700">
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold">•</span>
                  <span>Be specific with your questions for better insights</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold">•</span>
                  <span>Use follow-up questions to dive deeper</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold">•</span>
                  <span>Request data visualization for complex analysis</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
