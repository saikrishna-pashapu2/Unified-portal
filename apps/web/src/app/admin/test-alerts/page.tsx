"use client";

import { useState } from "react";

interface TestResult {
  ok: boolean;
  message: string;
  results: {
    timestamp: string;
    lookbackMinutes: number;
    since: string;
    alerts: Array<{
      alertId: number;
      userId: number;
      userEmail: string;
      userName: string;
      domains: string[];
      keywords: string[];
      sources: string[];
      lastSentAt: string | null;
      alreadySentCount: number;
      newContentCount: number;
      emailSent: boolean;
      newContent: Array<{
        domain: string;
        type: string;
        id: number;
        title: string;
        source: string;
        publishedDate: string;
        saveTime: string;
        link: string;
      }>;
    }>;
    totalNewContent: number;
    emailsSent: number;
    errors: string[];
  };
}

export default function TestAlertsPage() {
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState("");
  const [alertId, setAlertId] = useState("");
  const [lookbackMinutes, setLookbackMinutes] = useState("30");
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState("");

  // Daily Digest Test State
  const [digestLoading, setDigestLoading] = useState(false);
  const [digestResult, setDigestResult] = useState<any>(null);
  const [digestError, setDigestError] = useState("");

  const handleTest = async () => {
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const body: any = {
        lookbackMinutes: parseInt(lookbackMinutes) || 30,
      };

      if (alertId) {
        body.alertId = parseInt(alertId);
      } else if (userId) {
        body.userId = parseInt(userId);
      }

      const res = await fetch("/api/admin/test-alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (res.ok) {
        setResult(data);
      } else {
        setError(data.error || "Failed to test alerts");
      }
    } catch (err: any) {
      setError(err.message || "Failed to test alerts");
    } finally {
      setLoading(false);
    }
  };

  const handleTestDailyDigest = async () => {
    setDigestLoading(true);
    setDigestError("");
    setDigestResult(null);

    try {
      const res = await fetch("/api/admin/test-daily-digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const data = await res.json();

      if (res.ok) {
        setDigestResult(data);
      } else {
        setDigestError(data.error || "Failed to test daily digest");
      }
    } catch (err: any) {
      setDigestError(err.message || "Failed to test daily digest");
    } finally {
      setDigestLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Test Alerts System</h1>
        <p className="mt-2 text-gray-600">
          Test immediate alerts and daily digests
        </p>
      </div>

      {/* Daily Digest Test Form */}
      <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg shadow-sm border border-green-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">📆 Test Daily Digest</h2>
        <p className="text-sm text-gray-600 mb-4">
          Test the daily digest email for YOUR team. This will send all articles liked by your team TODAY.
        </p>
        
        <div className="flex items-center gap-3">
          <button
            onClick={handleTestDailyDigest}
            disabled={digestLoading}
            className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {digestLoading ? "Sending..." : "Send Test Email"}
          </button>
          <span className="text-sm text-gray-500">
            Will send to your email address
          </span>
        </div>

        {/* Daily Digest Error */}
        {digestError && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-red-800 text-sm font-medium">Error</p>
            <p className="text-red-600 text-sm mt-1">{digestError}</p>
          </div>
        )}

        {/* Daily Digest Results */}
        {digestResult && (
          <div className="mt-4 bg-white border border-green-200 rounded-lg p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-semibold text-gray-900">✅ Test Email Queued!</h3>
                <p className="text-sm text-gray-600 mt-1">{digestResult.message}</p>
              </div>
              <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">
                {digestResult.results.likedArticles} articles
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3 text-sm">
              <div>
                <span className="text-gray-600">User:</span>
                <p className="font-medium">{digestResult.results.userName} ({digestResult.results.userEmail})</p>
              </div>
              <div>
                <span className="text-gray-600">Team:</span>
                <p className="font-medium">{digestResult.results.team}</p>
              </div>
            </div>

            {digestResult.results.articles.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-200">
                <h4 className="font-semibold text-gray-900 mb-2 text-sm">Today&apos;s Liked Articles:</h4>
                <div className="space-y-2">
                  {digestResult.results.articles.map((article: any, i: number) => (
                    <div key={i} className="p-2 bg-gray-50 rounded border border-gray-200 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                              article.domain === 'esg' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                            }`}>
                              {article.domain.toUpperCase()}
                            </span>
                            <span className="text-xs text-gray-500">{article.source}</span>
                          </div>
                          <p className="font-medium text-gray-900">{article.title}</p>
                        </div>
                        <a
                          href={article.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded shrink-0"
                        >
                          View
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {digestResult.results.likedArticles === 0 && (
              <p className="text-sm text-gray-500 italic mt-3 pt-3 border-t border-gray-200">
                No articles were liked by this team today.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Immediate Alerts Test Form */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">⚡ Test Immediate Alerts</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              User ID (optional)
            </label>
            <input
              type="number"
              value={userId}
              onChange={(e) => {
                setUserId(e.target.value);
                if (e.target.value) setAlertId(""); // Clear alertId if userId is set
              }}
              placeholder="Test all alerts for user"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Alert ID (optional)
            </label>
            <input
              type="number"
              value={alertId}
              onChange={(e) => {
                setAlertId(e.target.value);
                if (e.target.value) setUserId(""); // Clear userId if alertId is set
              }}
              placeholder="Test specific alert"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Lookback (minutes)
            </label>
            <input
              type="number"
              value={lookbackMinutes}
              onChange={(e) => setLookbackMinutes(e.target.value)}
              placeholder="30"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleTest}
            disabled={loading}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Testing..." : "Run Test"}
          </button>
          
          <span className="text-sm text-gray-500">
            {!userId && !alertId && "Will test all immediate alerts"}
          </span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-red-800 font-medium">Error</p>
          <p className="text-red-600 text-sm mt-1">{error}</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-6">
          {/* Summary */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Summary</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-gray-600">Alerts Tested</p>
                <p className="text-2xl font-bold text-blue-600">
                  {result.results.alerts.length}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Total New Content</p>
                <p className="text-2xl font-bold text-green-600">
                  {result.results.totalNewContent}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Lookback Period</p>
                <p className="text-2xl font-bold text-purple-600">
                  {result.results.lookbackMinutes}m
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Emails Sent</p>
                <p className="text-2xl font-bold text-orange-600">
                  {result.results.emailsSent}
                </p>
              </div>
            </div>
            
            <div className="mt-4 pt-4 border-t border-gray-200 grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-gray-600">
              <p>
                <strong>Test Time:</strong>{" "}
                {new Date(result.results.timestamp).toLocaleString()}
              </p>
              <p>
                <strong>Checking Since:</strong>{" "}
                {new Date(result.results.since).toLocaleString()}
              </p>
              <p className="text-blue-600">
                <strong>Only sending articles published TODAY</strong>
              </p>
              {result.results.errors.length > 0 && (
                <p className="text-red-600">
                  <strong>{result.results.errors.length} Errors</strong>
                </p>
              )}
            </div>
          </div>

          {/* Errors */}
          {result.results.errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-red-800 mb-2">
                Errors ({result.results.errors.length})
              </h3>
              <ul className="list-disc list-inside space-y-1">
                {result.results.errors.map((err, i) => (
                  <li key={i} className="text-sm text-red-700">{err}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Alert Details */}
          {result.results.alerts.map((alert) => (
            <div
              key={alert.alertId}
              className="bg-white rounded-lg shadow-sm border border-gray-200 p-6"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    Alert #{alert.alertId} - {alert.userName}
                  </h3>
                  <p className="text-sm text-gray-600">{alert.userEmail}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-3 py-1 rounded-full text-sm font-medium ${
                      alert.newContentCount > 0
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {alert.newContentCount} new items
                  </span>
                  {alert.emailSent && (
                    <span className="px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-700">
                      ✉️ Email Sent
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 text-sm">
                <div>
                  <span className="text-gray-600">Domains:</span>
                  <div className="font-medium">
                    {alert.domains.map((d) => (
                      <span
                        key={d}
                        className="inline-block px-2 py-0.5 bg-purple-100 text-purple-700 rounded mr-1 mt-1"
                      >
                        {d.toUpperCase()}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="text-gray-600">Keywords:</span>
                  <p className="font-medium">
                    {alert.keywords.length || "None"}
                  </p>
                </div>
                <div>
                  <span className="text-gray-600">Sources:</span>
                  <p className="font-medium">
                    {alert.sources.length || "All"}
                  </p>
                </div>
                <div>
                  <span className="text-gray-600">Already Sent:</span>
                  <p className="font-medium">{alert.alreadySentCount}</p>
                </div>
              </div>

              {alert.lastSentAt && (
                <p className="text-sm text-gray-600 mb-4">
                  Last sent: {new Date(alert.lastSentAt).toLocaleString()}
                </p>
              )}

              {/* New Content */}
              {alert.newContent.length > 0 ? (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <h4 className="font-semibold text-gray-900 mb-3">
                    New Content ({alert.newContent.length})
                  </h4>
                  <div className="space-y-3">
                    {alert.newContent.map((content, i) => (
                      <div
                        key={i}
                        className="p-3 bg-gray-50 rounded-lg border border-gray-200"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span
                                className={`px-2 py-0.5 text-xs font-medium rounded ${
                                  content.domain === "esg"
                                    ? "bg-green-100 text-green-700"
                                    : "bg-red-100 text-red-700"
                                }`}
                              >
                                {content.domain.toUpperCase()}
                              </span>
                              <span className="text-xs text-gray-500">
                                {content.source}
                              </span>
                            </div>
                            <h5 className="font-medium text-gray-900 mb-1">
                              {content.title}
                            </h5>
                            <div className="text-xs text-gray-600 space-y-0.5">
                              <p>
                                Published:{" "}
                                {new Date(content.publishedDate).toLocaleString()}
                              </p>
                              <p>
                                Scraped:{" "}
                                {new Date(content.saveTime).toLocaleString()}
                              </p>
                            </div>
                          </div>
                          <a
                            href={content.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded"
                          >
                            View
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-500 italic mt-4 pt-4 border-t border-gray-200">
                  No new content found for this alert
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
