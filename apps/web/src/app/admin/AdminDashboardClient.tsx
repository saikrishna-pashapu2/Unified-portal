"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Stats {
  totalUsers: number;
  activeUsers: number;
  newUsersThisWeek: number;
  totalAlerts: number;
  activeAlerts: number;
  recentUsers: Array<{
    id: number;
    email: string;
    first_name: string | null;
    last_name: string | null;
    created_at: Date;
  }>;
  emailStats: {
    queued: number;
    sent: number;
    failed: number;
  };
  aiAssistant?: {
    totalSessions: number;
    activeSessions: number;
    uniqueUsers: number;
    totalCost: number;
  };
  pdfTranslator?: {
    totalJobs: number;
    jobsLast30Days: number;
    totalPages: number;
    uniqueUsers: number;
  };
}

export default function AdminDashboardClient() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const res = await fetch("/api/admin/stats");
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (error) {
      console.error("Error fetching stats:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">Failed to load dashboard statistics</p>
      </div>
    );
  }

  const statCards = [
    {
      title: "Total Users",
      value: stats.totalUsers,
      icon: "👥",
      color: "blue",
      change: `+${stats.newUsersThisWeek} this week`,
      link: "/admin/users",
    },
    {
      title: "Active Users",
      value: stats.activeUsers,
      icon: "✅",
      color: "green",
      subtitle: "Last 30 days",
      link: "/admin/users",
    },
    {
      title: "Total Alerts",
      value: stats.totalAlerts,
      icon: "🔔",
      color: "purple",
      subtitle: `${stats.activeAlerts} active`,
      link: "/admin/alerts",
    },
    {
      title: "Email Queue",
      value: stats.emailStats.queued,
      icon: "📧",
      color: "orange",
      subtitle: `${stats.emailStats.sent} sent, ${stats.emailStats.failed} failed`,
      link: "/admin/email-queue",
    },
    {
      title: "AI Assistant",
      value: stats.aiAssistant?.totalSessions || 0,
      icon: "🤖",
      color: "indigo",
      subtitle: stats.aiAssistant
        ? `${stats.aiAssistant.uniqueUsers} users • $${stats.aiAssistant.totalCost.toFixed(2)}`
        : "No data yet",
      link: "/admin/ai-assistant",
      highlight: true,
    },
    {
      title: "PDF Translator",
      value: stats.pdfTranslator?.jobsLast30Days || 0,
      icon: "📄",
      color: "cyan",
      subtitle: stats.pdfTranslator
        ? `${stats.pdfTranslator.totalPages} pages • ${stats.pdfTranslator.uniqueUsers} users`
        : "No data yet",
      link: "/admin/pdf-translator",
      highlight: true,
    },
    {
      title: "Daily AI Picks",
      value: "Open",
      icon: "✨",
      color: "emerald",
      subtitle: "ESG + Credit",
      link: "/admin/daily-ai",
      highlight: true,
    },
  ];

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-2 text-gray-600">
          Welcome to the admin dashboard. Here&apos;s an overview of your system.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-6 mb-8 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {statCards.map((card) => {
          const cardContent = (
            <div
              className={`bg-white rounded-lg shadow-sm border p-6 hover:shadow-md transition-all ${
                card.link ? "cursor-pointer" : ""
              } ${
                card.highlight
                  ? "border-indigo-300 ring-2 ring-indigo-100"
                  : "border-gray-200"
              }`}
            >
              <div className="flex items-center justify-between mb-4">
                <span className="text-3xl">{card.icon}</span>
                <div
                  className={`px-3 py-1 rounded-full text-xs font-medium bg-${card.color}-100 text-${card.color}-700`}
                >
                  {card.subtitle || card.change}
                </div>
              </div>
              <h3 className="text-gray-600 text-sm font-medium mb-1">
                {card.title}
              </h3>
              <p className="text-3xl font-bold text-gray-900">{card.value}</p>
              {card.link && (
                <div className="mt-3 text-xs text-gray-500 flex items-center">
                  View details →
                </div>
              )}
            </div>
          );

          return card.link ? (
            <Link key={card.title} href={card.link}>
              {cardContent}
            </Link>
          ) : (
            <div key={card.title}>{cardContent}</div>
          );
        })}
      </div>

      {/* Recent Users */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">
          Recent Users
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">
                  Name
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">
                  Email
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">
                  Joined
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.recentUsers.map((user) => (
                <tr key={user.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-3 px-4 text-sm text-gray-900">
                    {user.first_name || user.last_name
                      ? `${user.first_name || ""} ${user.last_name || ""}`.trim()
                      : "—"}
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-600">
                    {user.email}
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-600">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
