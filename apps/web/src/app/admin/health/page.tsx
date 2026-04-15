"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Activity, Database, Mail, Clock, Server, AlertTriangle, CheckCircle, XCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HealthStatus {
  status: string;
  timestamp: string;
  checks: {
    database: { status: string; message: string; responseTime: number };
    esgDatabase: { status: string; message: string; responseTime: number };
    creditDatabase: { status: string; message: string; responseTime: number };
    emailService: { status: string; message: string; responseTime: number };
    cronJobs: { status: string; message: string; responseTime: number };
  };
}

interface DatabaseHealth {
  esg: {
    status: string;
    tables: Array<{ name: string; size: number; sizeFormatted: string }>;
    totalRecords: number;
    avgQueryTime: number;
  };
  credit: {
    status: string;
    tables: Array<{ name: string; size: number; sizeFormatted: string }>;
    totalRecords: number;
    avgQueryTime: number;
  };
  overall: {
    status: string;
    totalRecords: number;
    avgQueryTime: number;
  };
}

interface EmailHealth {
  status: string;
  metrics: {
    totalLast24h: number;
    sentLast24h: number;
    failedLast24h: number;
    pendingCount: number;
    successRate: number;
  };
  failedEmails: Array<{
    id: number;
    to: string;
    subject: string;
    error: string;
    createdAt: string;
    retryCount: number;
  }>;
}

interface CronHealth {
  status: string;
  metrics: {
    activeAlerts: number;
    overdueAlerts: number;
    neverSentAlerts: number;
    contentSentLast24h: number;
    contentSentLast7d: number;
  };
  stuckAlerts: Array<{
    id: number;
    name: string;
    type: string;
    lastSent: string;
    nextSend: string;
    userName: string;
  }>;
}

interface PerformanceMetrics {
  performance: {
    database: {
      esg: { queryTime: number; status: string };
      credit: { queryTime: number; status: string };
    };
    memory: {
      used: number;
      total: number;
      percentage: number;
    };
    uptime: number;
  };
  system: {
    nodeVersion: string;
    platform: string;
    arch: string;
    pid: number;
    uptime: number;
    uptimeFormatted: string;
  };
  activity: {
    activeUsersLast24h: number;
    totalActivityLast24h: number;
    totalLikesLast24h: number;
  };
}

export default function SystemHealthPage() {
  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null);
  const [databaseHealth, setDatabaseHealth] = useState<DatabaseHealth | null>(null);
  const [emailHealth, setEmailHealth] = useState<EmailHealth | null>(null);
  const [cronHealth, setCronHealth] = useState<CronHealth | null>(null);
  const [performance, setPerformance] = useState<PerformanceMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchHealthData = async () => {
    try {
      const [healthRes, dbRes, emailRes, cronRes, perfRes] = await Promise.all([
        fetch("/api/admin/health"),
        fetch("/api/admin/health/database"),
        fetch("/api/admin/health/email"),
        fetch("/api/admin/health/cron"),
        fetch("/api/admin/health/performance"),
      ]);

      if (healthRes.ok) setHealthStatus(await healthRes.json());
      if (dbRes.ok) setDatabaseHealth(await dbRes.json());
      if (emailRes.ok) setEmailHealth(await emailRes.json());
      if (cronRes.ok) setCronHealth(await cronRes.json());
      if (perfRes.ok) setPerformance(await perfRes.json());
    } catch (error) {
      console.error("Error fetching health data:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchHealthData();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchHealthData, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchHealthData();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "healthy":
        return "text-green-600 bg-green-100";
      case "degraded":
        return "text-yellow-600 bg-yellow-100";
      case "unhealthy":
        return "text-red-600 bg-red-100";
      default:
        return "text-gray-600 bg-gray-100";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "healthy":
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case "degraded":
        return <AlertTriangle className="h-5 w-5 text-yellow-600" />;
      case "unhealthy":
        return <XCircle className="h-5 w-5 text-red-600" />;
      default:
        return <Activity className="h-5 w-5 text-gray-600" />;
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">System Health Monitor</h1>
          <p className="text-gray-500 mt-1">Real-time system status and performance metrics</p>
        </div>
        <Button onClick={handleRefresh} disabled={refreshing} variant="outline">
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Overall Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Overall Status</p>
                <Badge className={`mt-2 ${getStatusColor(healthStatus?.status || "unknown")}`}>
                  {healthStatus?.status?.toUpperCase() || "UNKNOWN"}
                </Badge>
              </div>
              {getStatusIcon(healthStatus?.status || "unknown")}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Database</p>
                <p className="text-2xl font-bold mt-1">
                  {healthStatus?.checks.database.responseTime}ms
                </p>
              </div>
              <Database className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Email Service</p>
                <Badge className={`mt-2 ${getStatusColor(emailHealth?.status || "unknown")}`}>
                  {emailHealth?.metrics.successRate.toFixed(0)}% Success
                </Badge>
              </div>
              <Mail className="h-8 w-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Cron Jobs</p>
                <p className="text-2xl font-bold mt-1">
                  {cronHealth?.metrics.activeAlerts || 0}
                </p>
                <p className="text-xs text-gray-500">Active Alerts</p>
              </div>
              <Clock className="h-8 w-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Uptime</p>
                <p className="text-xl font-bold mt-1">
                  {performance?.system.uptimeFormatted || "N/A"}
                </p>
              </div>
              <Server className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Tabs */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="database">Database</TabsTrigger>
          <TabsTrigger value="email">Email</TabsTrigger>
          <TabsTrigger value="cron">Cron Jobs</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>System Components</CardTitle>
                <CardDescription>Current status of all system components</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {healthStatus?.checks && Object.entries(healthStatus.checks).map(([key, check]) => (
                  <div key={key} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      {getStatusIcon(check.status)}
                      <div>
                        <p className="font-medium capitalize">{key.replace(/([A-Z])/g, " $1").trim()}</p>
                        <p className="text-sm text-gray-500">{check.message}</p>
                      </div>
                    </div>
                    <Badge className={getStatusColor(check.status)}>
                      {check.status}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>System Information</CardTitle>
                <CardDescription>Runtime environment details</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-500">Node Version:</span>
                  <span className="font-medium">{performance?.system.nodeVersion}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Platform:</span>
                  <span className="font-medium">{performance?.system.platform}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Architecture:</span>
                  <span className="font-medium">{performance?.system.arch}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Process ID:</span>
                  <span className="font-medium">{performance?.system.pid}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Memory Usage:</span>
                  <span className="font-medium">
                    {performance?.performance.memory.used}MB / {performance?.performance.memory.total}MB 
                    ({performance?.performance.memory.percentage}%)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Active Users (24h):</span>
                  <span className="font-medium">{performance?.activity.activeUsersLast24h}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="database" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>ESG Database</CardTitle>
                <CardDescription>
                  Status: <Badge className={getStatusColor(databaseHealth?.esg.status || "unknown")}>
                    {databaseHealth?.esg.status}
                  </Badge>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 mb-4">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Total Records:</span>
                    <span className="font-medium">{databaseHealth?.esg.totalRecords.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Avg Query Time:</span>
                    <span className="font-medium">{databaseHealth?.esg.avgQueryTime}ms</span>
                  </div>
                </div>
                <div className="border-t pt-4">
                  <p className="text-sm font-medium mb-2">Top Tables by Size</p>
                  <div className="space-y-1">
                    {databaseHealth?.esg.tables.slice(0, 5).map((table) => (
                      <div key={table.name} className="flex justify-between text-sm">
                        <span className="text-gray-600">{table.name}</span>
                        <span className="font-mono">{table.sizeFormatted}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Credit Database</CardTitle>
                <CardDescription>
                  Status: <Badge className={getStatusColor(databaseHealth?.credit.status || "unknown")}>
                    {databaseHealth?.credit.status}
                  </Badge>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 mb-4">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Total Records:</span>
                    <span className="font-medium">{databaseHealth?.credit.totalRecords.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Avg Query Time:</span>
                    <span className="font-medium">{databaseHealth?.credit.avgQueryTime}ms</span>
                  </div>
                </div>
                <div className="border-t pt-4">
                  <p className="text-sm font-medium mb-2">Top Tables by Size</p>
                  <div className="space-y-1">
                    {databaseHealth?.credit.tables.slice(0, 5).map((table) => (
                      <div key={table.name} className="flex justify-between text-sm">
                        <span className="text-gray-600">{table.name}</span>
                        <span className="font-mono">{table.sizeFormatted}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="email" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-gray-500">Total (24h)</p>
                <p className="text-3xl font-bold mt-1">{emailHealth?.metrics.totalLast24h}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-gray-500">Sent (24h)</p>
                <p className="text-3xl font-bold mt-1 text-green-600">{emailHealth?.metrics.sentLast24h}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-gray-500">Failed (24h)</p>
                <p className="text-3xl font-bold mt-1 text-red-600">{emailHealth?.metrics.failedLast24h}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-gray-500">Pending</p>
                <p className="text-3xl font-bold mt-1 text-orange-600">{emailHealth?.metrics.pendingCount}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Failed Emails (Last 24h)</CardTitle>
              <CardDescription>Recent email delivery failures</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">To</th>
                      <th className="text-left p-2">Subject</th>
                      <th className="text-left p-2">Error</th>
                      <th className="text-left p-2">Retries</th>
                      <th className="text-left p-2">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emailHealth?.failedEmails.slice(0, 10).map((email) => (
                      <tr key={email.id} className="border-b hover:bg-gray-50">
                        <td className="p-2 text-sm">{email.to}</td>
                        <td className="p-2 text-sm">{email.subject}</td>
                        <td className="p-2 text-sm text-red-600">{email.error}</td>
                        <td className="p-2 text-sm">{email.retryCount}</td>
                        <td className="p-2 text-sm">{new Date(email.createdAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(!emailHealth?.failedEmails || emailHealth.failedEmails.length === 0) && (
                  <p className="text-center py-8 text-gray-500">No failed emails in the last 24 hours</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cron" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-4">
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-gray-500">Active Alerts</p>
                <p className="text-3xl font-bold mt-1">{cronHealth?.metrics.activeAlerts}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-gray-500">Overdue</p>
                <p className="text-3xl font-bold mt-1 text-red-600">{cronHealth?.metrics.overdueAlerts}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-gray-500">Never Sent</p>
                <p className="text-3xl font-bold mt-1 text-yellow-600">{cronHealth?.metrics.neverSentAlerts}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-gray-500">Sent (24h)</p>
                <p className="text-3xl font-bold mt-1 text-green-600">{cronHealth?.metrics.contentSentLast24h}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-gray-500">Sent (7d)</p>
                <p className="text-3xl font-bold mt-1">{cronHealth?.metrics.contentSentLast7d}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Stuck/Overdue Alerts</CardTitle>
              <CardDescription>Alerts that haven&apos;t sent when scheduled</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Alert Name</th>
                      <th className="text-left p-2">Type</th>
                      <th className="text-left p-2">User</th>
                      <th className="text-left p-2">Last Sent</th>
                      <th className="text-left p-2">Next Send</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cronHealth?.stuckAlerts.map((alert) => (
                      <tr key={alert.id} className="border-b hover:bg-gray-50">
                        <td className="p-2 text-sm">{alert.name}</td>
                        <td className="p-2 text-sm">
                          <Badge variant="outline">{alert.type}</Badge>
                        </td>
                        <td className="p-2 text-sm">{alert.userName}</td>
                        <td className="p-2 text-sm">
                          {alert.lastSent ? new Date(alert.lastSent).toLocaleString() : "Never"}
                        </td>
                        <td className="p-2 text-sm text-red-600">
                          {new Date(alert.nextSend).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(!cronHealth?.stuckAlerts || cronHealth.stuckAlerts.length === 0) && (
                  <p className="text-center py-8 text-gray-500">No stuck or overdue alerts</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="performance" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Database Performance</CardTitle>
                <CardDescription>Average query response times</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">ESG Database</span>
                  <div className="flex items-center gap-2">
                    <span className="font-bold">{performance?.performance.database.esg.queryTime}ms</span>
                    <Badge className={getStatusColor(
                      performance?.performance.database.esg.status === "fast" ? "healthy" :
                      performance?.performance.database.esg.status === "normal" ? "degraded" : "unhealthy"
                    )}>
                      {performance?.performance.database.esg.status}
                    </Badge>
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">Credit Database</span>
                  <div className="flex items-center gap-2">
                    <span className="font-bold">{performance?.performance.database.credit.queryTime}ms</span>
                    <Badge className={getStatusColor(
                      performance?.performance.database.credit.status === "fast" ? "healthy" :
                      performance?.performance.database.credit.status === "normal" ? "degraded" : "unhealthy"
                    )}>
                      {performance?.performance.database.credit.status}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Memory Usage</CardTitle>
                <CardDescription>Node.js heap memory</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Used:</span>
                    <span className="font-bold">{performance?.performance.memory.used} MB</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Total:</span>
                    <span className="font-bold">{performance?.performance.memory.total} MB</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full"
                      style={{ width: `${performance?.performance.memory.percentage}%` }}
                    ></div>
                  </div>
                  <p className="text-center text-sm text-gray-500">
                    {performance?.performance.memory.percentage}% utilized
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>User Activity</CardTitle>
                <CardDescription>Last 24 hours</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-500">Active Users:</span>
                  <span className="font-bold">{performance?.activity.activeUsersLast24h}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Total Activity:</span>
                  <span className="font-bold">{performance?.activity.totalActivityLast24h}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Total Likes:</span>
                  <span className="font-bold">{performance?.activity.totalLikesLast24h}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
