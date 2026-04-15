// AI Assistant Stats Dashboard - Admin Panel
// Shows comprehensive analytics for AI assistant usage

'use client';

import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  TrendingUp,
  Users,
  DollarSign,
  MessageSquare,
  Activity,
  Calendar,
  BarChart3,
  Clock,
  Zap,
  Wrench,
  AlertCircle,
  Loader2,
  Download,
  RefreshCw,
} from 'lucide-react';

interface Stats {
  period: {
    days: number;
    startDate: string;
    endDate: string;
  };
  overview: {
    totalSessions: number;
    activeSessions: number;
    totalMessages: number;
    uniqueUsers: number;
    totalTokens: number;
    totalCost: number;
    totalToolCalls: number;
    successfulToolCalls: number;
    uniqueTools: number;
    avgTokensPerSession: number;
    avgCostPerSession: number;
    avgSessionsPerUser: number;
    avgToolCallsPerSession: number;
  };
  domainBreakdown: Array<{
    domain: string;
    sessions: number;
    tokens: number;
    cost: number;
  }>;
  dailyTrend: Array<{
    date: string;
    sessions: number;
    tokens: number;
    cost: number;
  }>;
  topUsers: Array<{
    userId: number;
    name: string;
    email: string;
    sessions: number;
    tokens: number;
    cost: number;
  }>;
  topArticles: Array<{
    articleId: number;
    domain: string;
    sessions: number;
    tokens: number;
  }>;
  topTools: Array<{
    toolName: string;
    calls: number;
    successCount: number;
    errorCount: number;
    avgExecutionMs: number | null;
  }>;
  recentActivity: Array<{
    sessionId: string;
    articleId: number;
    domain: string;
    userId: number;
    userName: string;
    userEmail: string;
    createdAt: string;
    messageCount: number;
    tokens: number;
    cost: number;
  }>;
  recentToolCalls: Array<{
    toolName: string;
    status: string;
    executionTimeMs: number | null;
    createdAt: string;
    articleId: number;
    domain: string;
    userId: number;
    userName: string;
    userEmail: string;
  }>;
}

export default function AIAssistantStatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [domain, setDomain] = useState('all');
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = async () => {
    try {
      setRefreshing(true);
      const response = await fetch(`/api/admin/ai-assistant/stats?days=${days}&domain=${domain}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch statistics');
      }

      const data = await response.json();
      
      if (data.success) {
        setStats(data);
        setError(null);
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (err: any) {
      console.error('Error fetching stats:', err);
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, [days, domain]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading AI Assistant statistics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center max-w-md">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Error Loading Stats</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={fetchStats}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const formatCurrency = (amount: number | undefined) => `$${(amount || 0).toFixed(4)}`;
  const formatNumber = (num: number | undefined) => (num || 0).toLocaleString();
  const formatDate = (date: string) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-purple-50">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-12 h-12 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
                  <Sparkles className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-gray-900">AI Assistant Analytics</h1>
                  <p className="text-gray-600">Comprehensive usage statistics and insights</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Period Selector */}
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
                <option value={365}>Last year</option>
              </select>

              {/* Domain Filter */}
              <select
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="all">All Domains</option>
                <option value="credit">Credit Only</option>
                <option value="esg">ESG Only</option>
              </select>

              {/* Refresh Button */}
              <button
                onClick={fetchStats}
                disabled={refreshing}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>
        </div>

        {/* Overview Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
          <StatCard
            icon={<MessageSquare className="w-6 h-6" />}
            title="Total Sessions"
            value={formatNumber(stats.overview.totalSessions)}
            subtitle={`${stats.overview.activeSessions} active`}
            color="blue"
          />
          <StatCard
            icon={<Wrench className="w-6 h-6" />}
            title="Tool Calls"
            value={formatNumber(stats.overview.totalToolCalls)}
            subtitle={`${stats.overview.uniqueTools} tools • ${stats.overview.avgToolCallsPerSession.toFixed(1)} per session`}
            color="indigo"
          />
          <StatCard
            icon={<Users className="w-6 h-6" />}
            title="Unique Users"
            value={formatNumber(stats.overview.uniqueUsers)}
            subtitle={`${stats.overview.avgSessionsPerUser.toFixed(1)} sessions/user`}
            color="green"
          />
          <StatCard
            icon={<Zap className="w-6 h-6" />}
            title="Total Tokens"
            value={formatNumber(stats.overview.totalTokens)}
            subtitle={`${formatNumber(stats.overview.avgTokensPerSession)} avg/session`}
            color="purple"
          />
          <StatCard
            icon={<DollarSign className="w-6 h-6" />}
            title="Total Cost"
            value={formatCurrency(stats.overview.totalCost)}
            subtitle={`${formatCurrency(stats.overview.avgCostPerSession)} avg/session`}
            color="orange"
          />
        </div>

        {/* Domain Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-100">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-600" />
              Domain Breakdown
            </h3>
            <div className="space-y-4">
              {stats.domainBreakdown.map((item) => (
                <div key={item.domain} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      item.domain === 'credit' ? 'bg-blue-100' : 'bg-green-100'
                    }`}>
                      <span className={`font-bold ${
                        item.domain === 'credit' ? 'text-blue-600' : 'text-green-600'
                      }`}>
                        {item.domain.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900 capitalize">{item.domain}</p>
                      <p className="text-sm text-gray-500">{formatNumber(item.sessions)} sessions</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900">{formatCurrency(item.cost)}</p>
                    <p className="text-sm text-gray-500">{formatNumber(item.tokens)} tokens</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Daily Trend Chart */}
          <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-100">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-green-600" />
              Daily Trend (Last 7 Days)
            </h3>
            <div className="space-y-2">
              {stats.dailyTrend.slice(-7).map((day) => (
                <div key={day.date} className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">{formatDate(day.date)}</span>
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-medium text-gray-900">{day.sessions} sessions</span>
                    <span className="text-sm text-gray-500">{formatCurrency(day.cost)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Top Users */}
        <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-100 mb-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            Top Users
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">User</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-gray-600">Sessions</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-gray-600">Tokens</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-gray-600">Cost</th>
                </tr>
              </thead>
              <tbody>
                {stats.topUsers.map((user) => (
                  <tr key={user.userId} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4">
                      <div>
                        <p className="font-medium text-gray-900">{user.name}</p>
                        <p className="text-sm text-gray-500">{user.email}</p>
                      </div>
                    </td>
                    <td className="text-right py-3 px-4 font-medium text-gray-900">{user.sessions}</td>
                    <td className="text-right py-3 px-4 text-gray-600">{formatNumber(user.tokens)}</td>
                    <td className="text-right py-3 px-4 font-medium text-gray-900">{formatCurrency(user.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top Articles */}
        <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-100 mb-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-purple-600" />
            Most Queried Articles
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Article ID</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Domain</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-gray-600">Sessions</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-gray-600">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {stats.topArticles.map((article) => (
                  <tr key={`${article.articleId}-${article.domain}`} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4">
                      <a
                        href={`/${article.domain}/articles/${article.articleId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline font-medium"
                      >
                        #{article.articleId}
                      </a>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        article.domain === 'credit' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                      }`}>
                        {article.domain.toUpperCase()}
                      </span>
                    </td>
                    <td className="text-right py-3 px-4 font-medium text-gray-900">{article.sessions}</td>
                    <td className="text-right py-3 px-4 text-gray-600">{formatNumber(article.tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-100 mb-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Wrench className="w-5 h-5 text-indigo-600" />
            Top Tools
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Tool</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-gray-600">Calls</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-gray-600">Success</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-gray-600">Errors</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-gray-600">Avg Time</th>
                </tr>
              </thead>
              <tbody>
                {stats.topTools.map((tool) => (
                  <tr key={tool.toolName} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4 font-medium text-gray-900">{tool.toolName}</td>
                    <td className="text-right py-3 px-4 text-gray-700">{formatNumber(tool.calls)}</td>
                    <td className="text-right py-3 px-4 text-green-700">{formatNumber(tool.successCount)}</td>
                    <td className="text-right py-3 px-4 text-red-600">{formatNumber(tool.errorCount)}</td>
                    <td className="text-right py-3 px-4 text-gray-600">
                      {tool.avgExecutionMs !== null ? `${formatNumber(tool.avgExecutionMs)} ms` : '—'}
                    </td>
                  </tr>
                ))}
                {stats.topTools.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 px-4 text-center text-sm text-gray-500">
                      No tool usage recorded for this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-gray-600" />
            Recent Activity
          </h3>
          <div className="space-y-3">
            {stats.recentActivity.slice(0, 10).map((activity) => (
              <div key={activity.sessionId} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    activity.domain === 'credit' ? 'bg-blue-100' : 'bg-green-100'
                  }`}>
                    <MessageSquare className={`w-5 h-5 ${
                      activity.domain === 'credit' ? 'text-blue-600' : 'text-green-600'
                    }`} />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{activity.userName}</p>
                    <p className="text-sm text-gray-500">
                      Article #{activity.articleId} • {activity.messageCount} messages • {new Date(activity.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-medium text-gray-900">{formatCurrency(activity.cost)}</p>
                  <p className="text-sm text-gray-500">{formatNumber(activity.tokens)} tokens</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-100 mt-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Wrench className="w-5 h-5 text-indigo-600" />
            Recent Tool Calls
          </h3>
          <div className="space-y-3">
            {stats.recentToolCalls.slice(0, 10).map((toolCall, index) => (
              <div key={`${toolCall.toolName}-${toolCall.createdAt}-${index}`} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    toolCall.status === 'success' ? 'bg-green-100' : 'bg-red-100'
                  }`}>
                    <Wrench className={`w-5 h-5 ${
                      toolCall.status === 'success' ? 'text-green-600' : 'text-red-600'
                    }`} />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{toolCall.userName}</p>
                    <p className="text-sm text-gray-500">
                      {toolCall.toolName} • Article #{toolCall.articleId} • {toolCall.domain.toUpperCase()} • {new Date(toolCall.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`font-medium ${toolCall.status === 'success' ? 'text-green-700' : 'text-red-600'}`}>
                    {toolCall.status}
                  </p>
                  <p className="text-sm text-gray-500">
                    {toolCall.executionTimeMs !== null ? `${formatNumber(toolCall.executionTimeMs)} ms` : 'No timing'}
                  </p>
                </div>
              </div>
            ))}
            {stats.recentToolCalls.length === 0 && (
              <p className="text-sm text-gray-500">No tool calls yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Stat Card Component
function StatCard({ icon, title, value, subtitle, color }: {
  icon: React.ReactNode;
  title: string;
  value: string;
  subtitle: string;
  color: 'blue' | 'green' | 'purple' | 'orange' | 'indigo';
}) {
  const colorClasses = {
    blue: 'from-blue-500 to-blue-600',
    green: 'from-green-500 to-green-600',
    purple: 'from-purple-500 to-purple-600',
    orange: 'from-orange-500 to-orange-600',
    indigo: 'from-indigo-500 to-indigo-600',
  };

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-100">
      <div className="flex items-center gap-4">
        <div className={`w-12 h-12 bg-gradient-to-r ${colorClasses[color]} rounded-xl flex items-center justify-center text-white`}>
          {icon}
        </div>
        <div className="flex-1">
          <p className="text-sm text-gray-600 mb-1">{title}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          <p className="text-xs text-gray-500 mt-1">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}
