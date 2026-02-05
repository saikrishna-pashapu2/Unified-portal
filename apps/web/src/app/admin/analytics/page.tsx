"use client";

import { useEffect, useMemo, useState } from "react";

type TabId = "overview" | "teams";

interface UserEngagementData {
  overview: {
    totalUsers: number;
    activeUsers: number;
    totalLikes: number;
    totalActivity: number;
    inactiveUsers: number;
  };
  usersByTeam: Array<{ team: string; count: number }>
  newUsers: Array<{ date: string; count: number }>;
  likesOverTime: Array<{ date: string; count: number }>;
  activityOverTime: Array<{ date: string; count: number }>;
  likesByType: Array<{ content_type: string; count: number }>;
  topPages: Array<{ page: string; count: number }>;
  topSources: Array<{ source: string; like_count: number; domain: "esg" | "credit" }>;
  topLikers: Array<{ id: number; name: string; email: string; team: string | null; like_count: number }>;
  topActiveUsers: Array<{ id: number; name: string; email: string; team: string | null; activity_count: number }>;
}

interface TeamsAnalyticsData {
  teamEngagement: Array<{
    team: string;
    user_count: number;
    like_count: number;
    likes_per_user: number;
    activity_count: number;
    activity_per_user: number;
    engagement_score: number;
  }>;
  usersByTeam: Array<{ team: string; user_count: number }>;
  likesByTeam: Array<{ team: string; like_count: number }>;
  activityByTeam: Array<{ team: string; activity_count: number }>;
}

interface AnalyticsData {
  userEngagement?: UserEngagementData;
  teams?: TeamsAnalyticsData;
}

const formatNumber = (value?: number) =>
  Number.isFinite(value) ? Number(value).toLocaleString() : "0";

const formatDate = (value: string) => new Date(value).toLocaleDateString();

function StatCard({
  title,
  value,
  subtitle,
  valueClassName,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  valueClassName?: string;
}) {
  return (
    <div className="bg-white p-4 rounded-lg border shadow-sm">
      <div className="text-sm text-gray-600">{title}</div>
      <div className={`text-2xl font-bold mt-1 ${valueClassName || ""}`}>{value}</div>
      {subtitle && <div className="text-xs text-gray-500 mt-1">{subtitle}</div>}
    </div>
  );
}

export default function AnalyticsDashboardPage() {
  const [data, setData] = useState<AnalyticsData>({});
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState("30");
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  const tabs = useMemo(
    () => [
      { id: "overview", label: "Overview" },
      { id: "teams", label: "Teams" },
    ],
    []
  );

  useEffect(() => {
    fetchAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const [userEngagement, teams] = await Promise.all([
        fetch(`/api/admin/analytics/user-engagement?days=${days}`).then((r) => r.json()),
        fetch(`/api/admin/analytics/teams?days=${days}`).then((r) => r.json()),
      ]);

      setData({ userEngagement, teams });
    } catch (error) {
      console.error("Error fetching analytics:", error);
    } finally {
      setLoading(false);
    }
  };

  const renderOverview = () => {
    if (!data.userEngagement) return null;

    return (
      <div className="space-y-6">
        {/* Overview Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatCard
            title="Total Users"
            value={formatNumber(data.userEngagement.overview.totalUsers)}
            subtitle={`${data.userEngagement.overview.activeUsers} active in last ${days} days`}
          />
          <StatCard
            title="Total Likes"
            value={formatNumber(data.userEngagement.overview.totalLikes)}
            subtitle="ESG + Credit"
          />
          <StatCard
            title="Total Activity"
            value={formatNumber(data.userEngagement.overview.totalActivity)}
            subtitle={`Last ${days} days`}
          />
          <StatCard
            title="Inactive Users"
            value={formatNumber(data.userEngagement.overview.inactiveUsers)}
            subtitle={`No likes/activity in ${days} days`}
          />
        </div>

        {/* Engagement Over Time */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-lg border shadow-sm">
            <h3 className="text-lg font-bold mb-4">Likes Over Time</h3>
            <div className="space-y-2">
              {data.userEngagement.likesOverTime.slice(0, 10).map((item) => (
                <div key={item.date} className="flex justify-between items-center text-sm">
                  <span className="text-gray-600">{formatDate(item.date)}</span>
                  <span className="font-semibold">{item.count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg border shadow-sm">
            <h3 className="text-lg font-bold mb-4">Activity Over Time</h3>
            <div className="space-y-2">
              {data.userEngagement.activityOverTime.slice(0, 10).map((item) => (
                <div key={item.date} className="flex justify-between items-center text-sm">
                  <span className="text-gray-600">{formatDate(item.date)}</span>
                  <span className="font-semibold">{item.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Top Likers & Top Active Users */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-lg border shadow-sm">
            <h3 className="text-lg font-bold mb-4">Top Likers</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Team</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Likes</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {data.userEngagement.topLikers.map((user) => (
                    <tr key={user.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium">{user.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{user.email}</td>
                      <td className="px-4 py-3 text-sm">{user.team || "N/A"}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-purple-600">{user.like_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg border shadow-sm">
            <h3 className="text-lg font-bold mb-4">Top Active Users</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Team</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Activity</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {data.userEngagement.topActiveUsers.map((user) => (
                    <tr key={user.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium">{user.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{user.email}</td>
                      <td className="px-4 py-3 text-sm">{user.team || "N/A"}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-blue-600">{user.activity_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Likes by Type & Top Pages */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-lg border shadow-sm">
            <h3 className="text-lg font-bold mb-4">Likes by Content Type</h3>
            <div className="space-y-2">
              {data.userEngagement.likesByType.map((item) => (
                <div key={item.content_type} className="flex justify-between items-center">
                  <span className="text-sm capitalize">{item.content_type}</span>
                  <span className="text-sm font-semibold text-purple-600">{item.count}</span>
                </div>
              ))}
              {data.userEngagement.likesByType.length === 0 && (
                <p className="text-sm text-gray-500">No likes yet</p>
              )}
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg border shadow-sm">
            <h3 className="text-lg font-bold mb-4">Top Visited Pages</h3>
            <div className="space-y-2">
              {data.userEngagement.topPages.map((item) => (
                <div key={item.page} className="flex justify-between items-center">
                  <span className="text-sm truncate max-w-[70%]" title={item.page}>{item.page}</span>
                  <span className="text-sm font-semibold text-blue-600">{item.count}</span>
                </div>
              ))}
              {data.userEngagement.topPages.length === 0 && (
                <p className="text-sm text-gray-500">No activity yet</p>
              )}
            </div>
          </div>
        </div>

        {/* Top Sources & Users by Team */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-lg border shadow-sm">
            <h3 className="text-lg font-bold mb-4">Top Liked Sources</h3>
            <div className="space-y-2">
              {data.userEngagement.topSources.map((item, idx) => (
                <div key={`${item.source}-${idx}`} className="flex justify-between items-center">
                  <span className="text-sm">{item.source}</span>
                  <span className="text-sm">
                    <span className={`px-2 py-0.5 text-xs rounded uppercase ${
                      item.domain === "credit" ? "bg-orange-100 text-orange-800" : "bg-blue-100 text-blue-800"
                    }`}>
                      {item.domain}
                    </span>
                    <span className="ml-2 font-semibold text-purple-600">{item.like_count}</span>
                  </span>
                </div>
              ))}
              {data.userEngagement.topSources.length === 0 && (
                <p className="text-sm text-gray-500">No likes yet</p>
              )}
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg border shadow-sm">
            <h3 className="text-lg font-bold mb-4">Users by Team</h3>
            <div className="space-y-2">
              {data.userEngagement.usersByTeam.slice(0, 10).map((item) => (
                <div key={item.team} className="flex justify-between items-center">
                  <span className="text-sm">{item.team}</span>
                  <span className="text-sm font-semibold">{item.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderTeams = () => {
    if (!data.teams) return null;

    return (
      <div className="space-y-6">
        {/* Team Engagement Scores */}
        <div className="bg-white rounded-lg border shadow-sm">
          <div className="p-6">
            <h3 className="text-lg font-bold mb-4">Team Engagement Scores</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Team</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Users</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Likes</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Likes/User</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Activity</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Activity/User</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Score</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {data.teams.teamEngagement
                    .sort((a, b) => b.engagement_score - a.engagement_score)
                    .map((team) => (
                      <tr key={team.team} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium">{team.team}</td>
                        <td className="px-4 py-3 text-sm">{team.user_count}</td>
                        <td className="px-4 py-3 text-sm">{team.like_count}</td>
                        <td className="px-4 py-3 text-sm">{team.likes_per_user}</td>
                        <td className="px-4 py-3 text-sm">{team.activity_count}</td>
                        <td className="px-4 py-3 text-sm">{team.activity_per_user}</td>
                        <td className="px-4 py-3 text-sm">
                          <span className={`px-2 py-1 text-xs font-semibold rounded ${
                            team.engagement_score > 50 ? "bg-green-100 text-green-800" :
                            team.engagement_score > 20 ? "bg-yellow-100 text-yellow-800" :
                            "bg-red-100 text-red-800"
                          }`}>
                            {team.engagement_score}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Team Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-lg border shadow-sm">
            <h3 className="text-lg font-bold mb-4">Users by Team</h3>
            <div className="space-y-2">
              {data.teams.usersByTeam.map((item) => (
                <div key={item.team} className="flex justify-between items-center">
                  <span className="text-sm">{item.team}</span>
                  <span className="text-sm font-semibold">{item.user_count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg border shadow-sm">
            <h3 className="text-lg font-bold mb-4">Activity by Team</h3>
            <div className="space-y-2">
              {data.teams.activityByTeam.map((item) => (
                <div key={item.team} className="flex justify-between items-center">
                  <span className="text-sm">{item.team}</span>
                  <span className="text-sm font-semibold text-blue-600">{item.activity_count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg border shadow-sm">
            <h3 className="text-lg font-bold mb-4">Likes by Team</h3>
            <div className="space-y-2">
              {data.teams.likesByTeam.map((item) => (
                <div key={item.team} className="flex justify-between items-center">
                  <span className="text-sm">{item.team}</span>
                  <span className="text-sm font-semibold text-purple-600">{item.like_count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Analytics Dashboard</h1>
          <p className="text-gray-600 mt-1">Comprehensive analytics and insights</p>
        </div>
        <div className="flex gap-2 items-center">
          <label className="text-sm font-medium">Time Range:</label>
          <select
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="px-3 py-2 border rounded-lg"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last year</option>
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-lg border shadow-sm">
        <div className="flex border-b">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabId)}
              className={`px-6 py-3 font-medium ${
                activeTab === tab.id
                  ? "border-b-2 border-blue-600 text-blue-600"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      ) : (
        <div>
          {activeTab === "overview" && renderOverview()}
          {activeTab === "teams" && renderTeams()}
        </div>
      )}
    </div>
  );
}
