/**
 * Admin Tender Scraper Dashboard
 * /admin/tenders
 */

'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Play, RefreshCw, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

interface ScrapeLog {
  id: number;
  source_id: number;
  started_at: string;
  completed_at: string | null;
  status: string;
  tenders_found: number;
  tenders_new: number;
  tenders_updated: number;
  tenders_failed: number;
  duration_seconds: number | null;
  error_message: string | null;
  trigger_type: string;
}

interface SourceStats {
  id: number;
  name: string;
  short_name: string;
  is_active: boolean;
  last_scrape_date: string | null;
  last_scrape_status: string | null;
  total_scrapes: number;
  successful_scrapes: number;
  failed_scrapes: number;
  success_rate: number | null;
  scrape_frequency_hours: number;
}

export default function AdminTendersPage() {
  const [sources, setSources] = useState<SourceStats[]>([]);
  const [logs, setLogs] = useState<ScrapeLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [sourcesRes, logsRes] = await Promise.all([
        fetch('/api/admin/tenders/sources'),
        fetch('/api/admin/tenders/logs'),
      ]);

      if (sourcesRes.ok) {
        const data = await sourcesRes.json();
        setSources(data.data || []);
      }

      if (logsRes.ok) {
        const data = await logsRes.json();
        setLogs(data.data || []);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    }
    setLoading(false);
  };

  const triggerScrape = async (sourceShortName: string) => {
    setScraping(true);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/tenders/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: sourceShortName }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setMessage({
          type: 'success',
          text: `Scrape completed: ${data.data.tendersNew} new tenders found!`,
        });
        // Reload data after scraping
        await loadData();
      } else {
        setMessage({
          type: 'error',
          text: data.message || 'Scraping failed',
        });
      }
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    setScraping(false);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'partial':
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      default:
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'outline' | 'secondary'> = {
      success: 'default',
      error: 'secondary',
      partial: 'outline',
      running: 'secondary',
    };
    return <Badge variant={variants[status] || 'outline'}>{status}</Badge>;
  };

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Tender Scraper</h1>
          <p className="text-muted-foreground">Manage tender data sources and scraping operations</p>
        </div>
        <Button onClick={loadData} variant="outline" disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Message Alert */}
      {message && (
        <div
          className={`p-4 rounded-lg border ${
            message.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Sources */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {sources.map((source) => (
          <Card key={source.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-lg">{source.name}</CardTitle>
                  <CardDescription>{source.short_name}</CardDescription>
                </div>
                {source.is_active ? (
                  <Badge variant="default">Active</Badge>
                ) : (
                  <Badge variant="secondary">Inactive</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-muted-foreground">Total Scrapes</p>
                  <p className="font-semibold">{source.total_scrapes}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Success Rate</p>
                  <p className="font-semibold">
                    {source.success_rate ? `${Number(source.success_rate).toFixed(1)}%` : 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Frequency</p>
                  <p className="font-semibold">Every {source.scrape_frequency_hours}h</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Last Status</p>
                  <div className="flex items-center gap-2">
                    {source.last_scrape_status && getStatusIcon(source.last_scrape_status)}
                    <p className="font-semibold text-xs">
                      {source.last_scrape_status || 'Never'}
                    </p>
                  </div>
                </div>
              </div>

              {source.last_scrape_date && (
                <p className="text-xs text-muted-foreground">
                  Last scraped: {new Date(source.last_scrape_date).toLocaleString()}
                </p>
              )}

              <Button
                onClick={() => triggerScrape(source.short_name)}
                disabled={!source.is_active || scraping}
                className="w-full"
              >
                {scraping ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Scraping...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Run Scraper
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent Scrape Logs */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Scrape Logs</CardTitle>
          <CardDescription>Latest scraping operations and their results</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {logs.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No scrape logs yet</p>
            ) : (
              logs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-3">
                      {getStatusIcon(log.status)}
                      <div>
                        <p className="font-medium">
                          {log.trigger_type === 'manual' ? 'Manual Scrape' : 'Scheduled Scrape'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {new Date(log.started_at).toLocaleString()}
                        </p>
                      </div>
                      {getStatusBadge(log.status)}
                    </div>

                    <div className="grid grid-cols-4 gap-4 text-sm pl-7">
                      <div>
                        <p className="text-muted-foreground">Found</p>
                        <p className="font-semibold">{log.tenders_found}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">New</p>
                        <p className="font-semibold text-green-600">{log.tenders_new}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Failed</p>
                        <p className="font-semibold text-red-600">{log.tenders_failed}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Duration</p>
                        <p className="font-semibold">
                          {log.duration_seconds ? `${log.duration_seconds}s` : 'N/A'}
                        </p>
                      </div>
                    </div>

                    {log.error_message && (
                      <div className="pl-7">
                        <p className="text-xs text-red-600 bg-red-50 p-2 rounded border border-red-200">
                          {log.error_message}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
