"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

interface UserDetails {
    user: {
        id: number;
        username: string | null;
        email: string | null;
        name: string;
        first_name: string | null;
        last_name: string | null;
        team: string | null;
        is_admin: boolean | null;
        created_at: string;
        last_login: string | null;
        is_active_db: boolean;
    };
    stats: {
        totalLikes: number;
        totalActivity: number;
        totalAlerts: number;
        likesByType: { content_type: string; esg_count: number; credit_count: number; total: number }[];
        activityByType: { action: string; count: number }[];
    };
    likes: Array<{
        id: number;
        content_id: number;
        content_type: string;
        created_at: string;
        content_title: string;
        content_url: string | null;
        domain: string;
    }>;
    activity: Array<{
        id: number;
        action: string;
        resource_type: string;
        resource_id: number | null;
        details: string | null;
        ip_address: string | null;
        created_at: string;
        resource_title: string | null;
        resource_url: string | null;
        domain: string | null;
    }>;
    alerts: Array<{
        id: number;
        alert_name: string | null;
        alert_type: string | null;
        domain: string | null;
        keywords: string[] | null;
        is_active: boolean | null;
        last_sent_at: string | null;
    }>;
}

export default function UserDetailPage() {
    const params = useParams();
    const router = useRouter();
    const [data, setData] = useState<UserDetails | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<"overview" | "likes" | "activity" | "alerts">("overview");
    const [activityUpdatedAt, setActivityUpdatedAt] = useState<Date | null>(null);

    useEffect(() => {
        const fetchUserDetails = async () => {
            try {
                const res = await fetch(`/api/admin/users/${params.id}`);
                if (!res.ok) {
                    const errorData = await res.json();
                    throw new Error(errorData.error || "Failed to fetch user details");
                }
                const userData = await res.json();
                setData(userData);
            } catch (err: any) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        if (params.id) {
            fetchUserDetails();
        }
    }, [params.id]);

    useEffect(() => {
        if (!params.id) return;

        const refreshActivity = async () => {
            try {
                const res = await fetch(`/api/admin/users/${params.id}/activity?limit=50`);
                if (!res.ok) return;
                const liveData = await res.json();
                setData((prev) =>
                    prev
                        ? {
                              ...prev,
                              activity: liveData.activity || prev.activity,
                              stats: {
                                  ...prev.stats,
                                  totalActivity: liveData.stats?.totalActivity ?? prev.stats.totalActivity,
                                  activityByType: liveData.stats?.activityByType ?? prev.stats.activityByType,
                              },
                          }
                        : prev
                );
                setActivityUpdatedAt(new Date());
            } catch (err) {
                console.error("Failed to refresh activity", err);
            }
        };

        refreshActivity();
        const intervalId = setInterval(refreshActivity, 10000);
        return () => clearInterval(intervalId);
    }, [params.id]);

    if (loading) {
        return (
            <div className="p-6 flex justify-center items-center min-h-[400px]">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="p-6">
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <h3 className="text-red-800 font-medium">Error</h3>
                    <p className="text-red-600">{error || "Failed to load user details"}</p>
                </div>
                <button
                    onClick={() => router.back()}
                    className="mt-4 px-4 py-2 bg-gray-100 rounded hover:bg-gray-200"
                >
                    Go Back
                </button>
            </div>
        );
    }

    const { user, stats, likes, activity, alerts } = data;

    return (
        <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link
                        href="/admin/users"
                        className="text-blue-600 hover:text-blue-800"
                    >
                        ← Back to Users
                    </Link>
                    <div className="h-6 w-px bg-gray-300"></div>
                    <div>
                        <h1 className="text-2xl font-bold">{user.name}</h1>
                        <p className="text-sm text-gray-500">{user.email}</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    {user.is_admin && (
                        <span className="px-2 py-1 text-xs font-medium bg-purple-100 text-purple-800 rounded">
                            Admin
                        </span>
                    )}
                    <span className={`px-2 py-1 text-xs font-medium rounded ${user.is_active_db ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>
                        {user.is_active_db ? 'Active' : 'Inactive'}
                    </span>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <div className="bg-white p-4 rounded-lg border shadow-sm">
                    <div className="text-sm text-gray-600">Team</div>
                    <div className="text-lg font-bold mt-1">{user.team || 'N/A'}</div>
                </div>
                <div className="bg-white p-4 rounded-lg border shadow-sm">
                    <div className="text-sm text-gray-600">Total Likes</div>
                    <div className="text-2xl font-bold mt-1 text-purple-600">{stats.totalLikes}</div>
                </div>
                <div className="bg-white p-4 rounded-lg border shadow-sm">
                    <div className="text-sm text-gray-600">Activities</div>
                    <div className="text-2xl font-bold mt-1 text-blue-600">{stats.totalActivity}</div>
                </div>
                <div className="bg-white p-4 rounded-lg border shadow-sm">
                    <div className="text-sm text-gray-600">Alerts</div>
                    <div className="text-2xl font-bold mt-1 text-green-600">{stats.totalAlerts}</div>
                </div>
                <div className="bg-white p-4 rounded-lg border shadow-sm">
                    <div className="text-sm text-gray-600">Joined</div>
                    <div className="text-sm font-medium mt-1">
                        {user.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                        Last Login: {user.last_login ? new Date(user.last_login).toLocaleDateString() : 'Never'}
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="bg-white rounded-lg border shadow-sm">
                <div className="flex border-b overflow-x-auto">
                    {[
                        { id: "overview", label: "Overview" },
                        { id: "likes", label: `Likes (${stats.totalLikes})` },
                        { id: "activity", label: `Activity (${stats.totalActivity})` },
                        { id: "alerts", label: `Alerts (${stats.totalAlerts})` },
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={`px-6 py-3 font-medium whitespace-nowrap ${activeTab === tab.id
                                    ? "border-b-2 border-blue-600 text-blue-600"
                                    : "text-gray-600 hover:text-gray-900"
                                }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Tab Content */}
            {activeTab === "overview" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Likes by Type */}
                    <div className="bg-white p-6 rounded-lg border shadow-sm">
                        <h3 className="text-lg font-bold mb-4">Likes by Content Type</h3>
                        <div className="space-y-3">
                            {stats.likesByType.length > 0 ? (
                                stats.likesByType.map((stat) => (
                                    <div key={stat.content_type} className="flex justify-between items-center">
                                        <span className="text-sm capitalize">{stat.content_type}</span>
                                        <div className="flex gap-2">
                                            <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-800 rounded">
                                                ESG: {stat.esg_count}
                                            </span>
                                            <span className="px-2 py-0.5 text-xs bg-orange-100 text-orange-800 rounded">
                                                Credit: {stat.credit_count}
                                            </span>
                                            <span className="font-semibold text-sm">{stat.total}</span>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <p className="text-gray-500 text-sm">No likes yet</p>
                            )}
                        </div>
                    </div>

                    {/* Activity by Type */}
                    <div className="bg-white p-6 rounded-lg border shadow-sm">
                        <h3 className="text-lg font-bold mb-4">Activity by Type</h3>
                        <div className="space-y-3">
                            {stats.activityByType.length > 0 ? (
                                stats.activityByType.map((stat) => (
                                    <div key={stat.action} className="flex justify-between items-center">
                                        <span className="text-sm">{stat.action}</span>
                                        <span className="font-semibold text-sm">{stat.count}</span>
                                    </div>
                                ))
                            ) : (
                                <p className="text-gray-500 text-sm">No activity yet</p>
                            )}
                        </div>
                    </div>

                    {/* Recent Likes */}
                    <div className="bg-white p-6 rounded-lg border shadow-sm">
                        <h3 className="text-lg font-bold mb-4">Recent Likes</h3>
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                            {likes.slice(0, 10).map((like, idx) => (
                                <div key={idx} className="flex justify-between items-center text-sm border-b pb-2">
                                    <div className="truncate max-w-[70%]" title={like.content_title}>
                                        {like.content_title}
                                    </div>
                                    <div className="flex gap-2 items-center">
                                        <span className={`px-1.5 py-0.5 text-xs rounded ${like.domain === 'esg' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'
                                            }`}>
                                            {like.domain}
                                        </span>
                                        <span className="text-gray-500 text-xs">
                                            {new Date(like.created_at).toLocaleDateString()}
                                        </span>
                                    </div>
                                </div>
                            ))}
                            {likes.length === 0 && <p className="text-gray-500 text-sm">No likes yet</p>}
                        </div>
                    </div>

                    {/* Recent Activity */}
                    <div className="bg-white p-6 rounded-lg border shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold">Live Activity</h3>
                            <div className="flex items-center gap-2 text-xs text-gray-500">
                                <span className="inline-flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-green-500"></span>
                                    Live
                                </span>
                                {activityUpdatedAt && (
                                    <span>Updated {activityUpdatedAt.toLocaleTimeString()}</span>
                                )}
                            </div>
                        </div>
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                            {activity.slice(0, 10).map((act, idx) => (
                                <div key={idx} className="flex justify-between items-start text-sm border-b pb-2">
                                    <div className="min-w-0">
                                        <div className="font-medium text-gray-900">{act.action}</div>
                                        <div className="text-xs text-gray-500 truncate">
                                            {act.resource_title || act.details || "Activity"}
                                        </div>
                                        {act.resource_type && (
                                            <div className="mt-1">
                                                <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded capitalize">
                                                    {act.resource_type}
                                                </span>
                                                {act.domain && (
                                                    <span className={`ml-2 px-2 py-0.5 text-xs rounded uppercase ${
                                                        act.domain === "credit"
                                                            ? "bg-orange-100 text-orange-800"
                                                            : "bg-blue-100 text-blue-800"
                                                    }`}>
                                                        {act.domain}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    <span className="text-gray-500 text-xs whitespace-nowrap">
                                        {new Date(act.created_at).toLocaleString()}
                                    </span>
                                </div>
                            ))}
                            {activity.length === 0 && <p className="text-gray-500 text-sm">No activity yet</p>}
                        </div>
                    </div>
                </div>
            )}

            {activeTab === "likes" && (
                <div className="bg-white rounded-lg border shadow-sm">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Content</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Domain</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Liked At</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {likes.map((like, idx) => (
                                    <tr key={idx} className="hover:bg-gray-50">
                                        <td className="px-6 py-4">
                                            {like.content_url ? (
                                                <a
                                                    href={like.content_url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-sm font-medium text-blue-700 hover:underline max-w-md truncate block"
                                                    title={like.content_title}
                                                >
                                                    {like.content_title}
                                                </a>
                                            ) : (
                                                <div className="text-sm font-medium max-w-md truncate" title={like.content_title}>
                                                    {like.content_title}
                                                </div>
                                            )}
                                            <div className="text-xs text-gray-500">ID: {like.content_id}</div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="px-2 py-1 text-xs font-medium rounded capitalize bg-gray-100">
                                                {like.content_type}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2 py-1 text-xs font-medium rounded uppercase ${like.domain === 'esg' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'
                                                }`}>
                                                {like.domain}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-500">
                                            {new Date(like.created_at).toLocaleString()}
                                        </td>
                                    </tr>
                                ))}
                                {likes.length === 0 && (
                                    <tr>
                                        <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                                            No likes yet
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {activeTab === "activity" && (
                <div className="bg-white rounded-lg border shadow-sm">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Resource</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Details</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">IP Address</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {activity.map((act, idx) => (
                                    <tr key={idx} className="hover:bg-gray-50">
                                        <td className="px-6 py-4">
                                            <span className="px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-800">
                                                {act.action}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-700">
                                            <div className="font-medium">
                                                {act.resource_title || act.details || "-"}
                                            </div>
                                            <div className="mt-1 flex flex-wrap gap-2">
                                                <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded capitalize">
                                                    {act.resource_type || "page"}
                                                </span>
                                                {act.domain && (
                                                    <span className={`px-2 py-0.5 text-xs rounded uppercase ${
                                                        act.domain === "credit"
                                                            ? "bg-orange-100 text-orange-800"
                                                            : "bg-blue-100 text-blue-800"
                                                    }`}>
                                                        {act.domain}
                                                    </span>
                                                )}
                                            </div>
                                            {act.resource_url && (
                                                <a
                                                    href={act.resource_url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-xs text-blue-600 hover:underline"
                                                >
                                                    Open
                                                </a>
                                            )}
                                        </td>
                                                                                <td className="px-6 py-4 text-sm text-gray-600 max-w-md truncate" title={act.details || undefined}>
                                            {act.details || '-'}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-500">
                                            {act.ip_address || '-'}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-500">
                                            {new Date(act.created_at).toLocaleString()}
                                        </td>
                                    </tr>
                                ))}
                                {activity.length === 0 && (
                                    <tr>
                                        <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                                            No activity yet
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {activeTab === "alerts" && (
                <div className="bg-white rounded-lg border shadow-sm">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Alert Name</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Domain</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Keywords</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Sent</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {alerts.map((alert, idx) => (
                                    <tr key={idx} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 text-sm font-medium">
                                            {alert.alert_name || 'Unnamed Alert'}
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="px-2 py-1 text-xs font-medium rounded bg-blue-100 text-blue-800 capitalize">
                                                {alert.alert_type?.replace('_', ' ')}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-sm uppercase">{alert.domain}</td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-wrap gap-1 max-w-xs">
                                                {alert.keywords?.slice(0, 3).map((kw: string, i: number) => (
                                                    <span key={i} className="px-1.5 py-0.5 text-xs bg-gray-100 rounded">
                                                        {kw}
                                                    </span>
                                                ))}
                                                {(alert.keywords?.length ?? 0) > 3 && (
                                                    <span className="text-xs text-gray-500">+{(alert.keywords?.length ?? 0) - 3} more</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2 py-1 text-xs font-medium rounded ${alert.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                                                }`}>
                                                {alert.is_active ? 'Active' : 'Inactive'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-500">
                                            {alert.last_sent_at ? new Date(alert.last_sent_at).toLocaleDateString() : 'Never'}
                                        </td>
                                    </tr>
                                ))}
                                {alerts.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                                            No alerts configured
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
