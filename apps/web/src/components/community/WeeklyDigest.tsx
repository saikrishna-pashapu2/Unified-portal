"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Sparkles, Calendar, ArrowLeft, ChevronRight, TrendingUp, BookOpen, AlertCircle, ExternalLink } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface Digest {
  id: number;
  week_start: Date;
  week_end: Date;
  content: string;
  created_at: Date;
}

interface DigestJSON {
  // Old format support
  title?: string;
  key_developments?: Array<{ title: string; description: string; impact: string }>;
  market_signals?: Array<{ signal: string; implication: string }>;
  
  // New format
  headline?: string;
  executive_summary: string;
  this_week_at_a_glance?: {
    key_stats: Array<{ label: string; value: string | number; note?: string }>;
    overall_tone: string;
  };
  thematic_deep_dives?: Array<{
    theme: string;
    summary: string;
    supporting_articles: Array<{ title: string; url: string; role: string }>;
    implications_for_team: string;
    time_horizon: string;
  }>;
  risk_opportunity_radar?: {
    risks: Array<{ title: string; description: string; severity: string; likelihood: string }>;
    opportunities: Array<{ title: string; description: string; time_horizon: string }>;
  };
  strategic_insights?: Array<{
    insight: string;
    rationale: string;
    recommended_actions: string[];
  }>;
  watchlist?: Array<{
    item: string;
    reason: string;
    articles: Array<{ title: string; url: string }>;
  }>;
  curated_reading_list: Array<{ title: string; url: string; context: string; priority?: string }>;
}

interface WeeklyDigestProps {
  digests: Digest[];
}

export default function WeeklyDigest({ digests }: WeeklyDigestProps) {
  const [selectedDigest, setSelectedDigest] = useState<Digest | null>(null);

  if (digests.length === 0) {
    return (
      <Card className="mb-8 border-2 border-dashed border-muted">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-muted-foreground">
            <Sparkles className="h-5 w-5" />
            Weekly Digest
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No digests available yet. Check back on Monday for the latest community highlights!
          </p>
        </CardContent>
      </Card>
    );
  }

  // Helper to parse content
  const parseContent = (content: string): DigestJSON | null => {
    try {
      return JSON.parse(content);
    } catch (e) {
      return null;
    }
  };

  // Detail View
  if (selectedDigest) {
    const weekStart = new Date(selectedDigest.week_start);
    const weekEnd = new Date(selectedDigest.week_end);
    const data = parseContent(selectedDigest.content);

    // Fallback for old markdown digests
    if (!data) {
      return (
        <div className="space-y-6">
          <Button 
            variant="ghost" 
            onClick={() => setSelectedDigest(null)}
            className="pl-0 hover:pl-2 transition-all"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Digests
          </Button>

          <Card className="border-2 border-primary/10 bg-white shadow-lg">
            <CardHeader className="border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-2xl">
                  <Sparkles className="h-6 w-6 text-primary" />
                  Weekly Digest
                </CardTitle>
                <div className="flex items-center gap-2 text-sm font-medium text-slate-500 bg-white px-3 py-1 rounded-full border border-slate-200 shadow-sm">
                  <Calendar className="h-4 w-4" />
                  {weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-8">
              <div className="prose prose-slate max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {selectedDigest.content}
                </ReactMarkdown>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    // New JSON Render
    const isNewFormat = !!data.headline;
    const title = data.headline || data.title || "Weekly Digest";

    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <Button 
          variant="ghost" 
          onClick={() => setSelectedDigest(null)}
          className="pl-0 hover:pl-2 transition-all"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Digests
        </Button>

        {/* Header Card */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 p-8 text-white shadow-xl">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 h-32 w-32 rounded-full bg-primary/20 blur-3xl" />
          <div className="relative z-10">
            <div className="flex items-center gap-2 text-primary-foreground/80 mb-4">
              <Calendar className="h-4 w-4" />
              <span className="text-sm font-medium">
                {weekStart.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} - {weekEnd.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
            <h1 className="text-3xl font-bold mb-4">{title}</h1>
            <p className="text-lg text-slate-300 leading-relaxed max-w-3xl">
              {data.executive_summary}
            </p>
            
            {/* At a Glance (New Format) */}
            {data.this_week_at_a_glance && (
              <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4 border-t border-white/10 pt-6">
                {data.this_week_at_a_glance.key_stats.map((stat, i) => (
                  <div key={i}>
                    <div className="text-2xl font-bold text-primary-foreground">{stat.value}</div>
                    <div className="text-xs text-slate-400 uppercase tracking-wider">{stat.label}</div>
                  </div>
                ))}
                <div className="col-span-2 md:col-span-1">
                  <div className="text-sm font-medium text-primary-foreground mb-1">Overall Tone</div>
                  <Badge variant="outline" className="text-white border-white/20 bg-white/5">
                    {data.this_week_at_a_glance.overall_tone}
                  </Badge>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content - Left Column */}
          <div className="lg:col-span-2 space-y-8">
            
            {/* Thematic Deep Dives (New Format) */}
            {data.thematic_deep_dives && (
              <section>
                <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  Thematic Deep Dives
                </h2>
                <div className="space-y-6">
                  {data.thematic_deep_dives.map((theme, i) => (
                    <Card key={i} className="border-l-4 border-l-primary shadow-sm">
                      <CardHeader>
                        <CardTitle className="text-lg">{theme.theme}</CardTitle>
                        <div className="flex items-center gap-2 mt-2">
                          <Badge variant="secondary" className="text-xs">
                            {theme.time_horizon}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <p className="text-slate-600">{theme.summary}</p>
                        
                        <div className="bg-slate-50 p-4 rounded-lg border border-slate-100">
                          <h4 className="text-sm font-semibold text-slate-900 mb-2">Implications for Team</h4>
                          <p className="text-sm text-slate-700">{theme.implications_for_team}</p>
                        </div>

                        <div className="space-y-2">
                          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Supporting Articles</h4>
                          <ul className="space-y-2">
                            {theme.supporting_articles.map((article, j) => (
                              <li key={j} className="text-sm flex items-start gap-2">
                                <span className="text-primary mt-1">•</span>
                                <a href={article.url} target="_blank" rel="noopener noreferrer" className="text-slate-600 hover:text-primary hover:underline">
                                  {article.title}
                                </a>
                                <span className="text-slate-400 text-xs">({article.role})</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {/* Strategic Insights (New Format) */}
            {data.strategic_insights && (
              <section>
                <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  Strategic Insights
                </h2>
                <div className="grid gap-4">
                  {data.strategic_insights.map((insight, i) => (
                    <Card key={i} className="bg-gradient-to-br from-white to-slate-50">
                      <CardContent className="p-6">
                        <h3 className="font-semibold text-lg text-slate-900 mb-2">{insight.insight}</h3>
                        <p className="text-slate-600 text-sm mb-4">{insight.rationale}</p>
                        <div className="space-y-2">
                          {insight.recommended_actions.map((action, j) => (
                            <div key={j} className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 px-3 py-2 rounded-md border border-emerald-100">
                              <span className="font-bold">Action:</span> {action}
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {/* Key Developments (Old Format Fallback) */}
            {data.key_developments && (
              <section>
                <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  Key Developments
                </h2>
                <div className="grid gap-4">
                  {data.key_developments.map((item, i) => (
                    <Card key={i} className="border-l-4 border-l-primary shadow-sm hover:shadow-md transition-shadow">
                      <CardHeader>
                        <CardTitle className="text-lg">{item.title}</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <p className="text-slate-600">{item.description}</p>
                        <div className="bg-slate-50 p-3 rounded-lg text-sm text-slate-700 border border-slate-100">
                          <span className="font-semibold text-slate-900">Impact: </span>
                          {item.impact}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {/* Reading List */}
            <section>
              <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-primary" />
                Curated Reading List
              </h2>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
                {data.curated_reading_list.map((item, i) => (
                  <div key={i} className="p-4 hover:bg-slate-50 transition-colors group">
                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="block">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="font-semibold text-slate-900 group-hover:text-primary transition-colors flex items-center gap-2">
                            {item.title}
                            <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </h3>
                          <p className="text-sm text-slate-500 mt-1">{item.context}</p>
                        </div>
                        {item.priority && (
                          <Badge variant={item.priority === 'must-read' ? 'default' : 'secondary'} className="shrink-0">
                            {item.priority}
                          </Badge>
                        )}
                      </div>
                    </a>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Sidebar - Right Column */}
          <div className="space-y-6">
            
            {/* Risk & Opportunity Radar (New Format) */}
            {data.risk_opportunity_radar && (
              <>
                <Card className="bg-red-50/50 border-red-100">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2 text-red-700">
                      <AlertCircle className="h-5 w-5" />
                      Risk Radar
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {data.risk_opportunity_radar.risks.map((risk, i) => (
                      <div key={i} className="bg-white p-4 rounded-lg border border-red-100 shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-medium text-slate-900">{risk.title}</div>
                          <Badge variant="outline" className="text-red-600 border-red-200 bg-red-50">
                            {risk.severity}
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-600">{risk.description}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card className="bg-emerald-50/50 border-emerald-100">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2 text-emerald-700">
                      <TrendingUp className="h-5 w-5" />
                      Opportunities
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {data.risk_opportunity_radar.opportunities.map((opp, i) => (
                      <div key={i} className="bg-white p-4 rounded-lg border border-emerald-100 shadow-sm">
                        <div className="font-medium text-slate-900 mb-1">{opp.title}</div>
                        <p className="text-sm text-slate-600 mb-2">{opp.description}</p>
                        <div className="text-xs text-emerald-600 font-medium uppercase tracking-wider">
                          {opp.time_horizon}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </>
            )}

            {/* Watchlist (New Format) */}
            {data.watchlist && (
              <Card className="bg-slate-50 border-slate-200">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-slate-600" />
                    Watchlist
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {data.watchlist.map((item, i) => (
                    <div key={i} className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
                      <div className="font-medium text-slate-900 mb-1">{item.item}</div>
                      <p className="text-sm text-slate-500 mb-2">{item.reason}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Market Signals (Old Format Fallback) */}
            {data.market_signals && (
              <Card className="bg-slate-50 border-slate-200">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-emerald-600" />
                    Market Signals
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {data.market_signals.map((signal, i) => (
                    <div key={i} className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
                      <div className="font-medium text-slate-900 mb-1">{signal.signal}</div>
                      <div className="text-sm text-slate-500">{signal.implication}</div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    );
  }

  // List View
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {digests.map((digest) => {
        const weekStart = new Date(digest.week_start);
        const weekEnd = new Date(digest.week_end);
        const data = parseContent(digest.content);
        
        // Extract preview
        const title = data ? (data.headline || data.title) : `Week of ${weekStart.toLocaleDateString()}`;
        const preview = data 
          ? data.executive_summary 
          : digest.content.replace(/[#*`]/g, '').substring(0, 150) + "...";

        return (
          <Card 
            key={digest.id} 
            className="group cursor-pointer hover:shadow-md transition-all duration-200 border-slate-200 hover:border-primary/50 flex flex-col h-full"
            onClick={() => setSelectedDigest(digest)}
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between mb-2">
                <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/20">
                  Weekly Digest
                </Badge>
                <span className="text-xs text-slate-400 font-medium">
                  {new Date(digest.created_at).toLocaleDateString()}
                </span>
              </div>
              <CardTitle className="text-lg line-clamp-2 leading-tight">
                {title}
              </CardTitle>
              <div className="text-xs text-slate-500 font-medium mt-2">
                {weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
            </CardHeader>
            <CardContent className="flex-1">
              <p className="text-sm text-slate-500 line-clamp-3">
                {preview}
              </p>
            </CardContent>
            <CardFooter className="pt-0 mt-auto">
              <div className="text-sm font-medium text-primary flex items-center gap-1 group-hover:gap-2 transition-all">
                Read Full Report <ChevronRight className="h-4 w-4" />
              </div>
            </CardFooter>
          </Card>
        );
      })}
    </div>
  );
}

