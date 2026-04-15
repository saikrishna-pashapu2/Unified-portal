import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import { esgPrisma } from "@esgcredit/db-esg";
import { creditPrisma } from "@esgcredit/db-credit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/health/performance
 * Get system performance metrics
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!(session as any)?.is_admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const performanceMetrics = {
      database: {
        esg: { queryTime: 0, status: "unknown" },
        credit: { queryTime: 0, status: "unknown" },
      },
      memory: {
        used: 0,
        total: 0,
        percentage: 0,
      },
      uptime: process.uptime(),
    };

    // ESG Database Performance
    try {
      const queries = [
        { name: "simple", query: esgPrisma.$queryRaw`SELECT 1` },
        { name: "users", query: esgPrisma.$queryRaw`SELECT COUNT(*) FROM users` },
        { name: "articles", query: esgPrisma.$queryRaw`SELECT COUNT(*) FROM esg_articles` },
      ];

      const start = Date.now();
      await Promise.all(queries.map((q) => q.query));
      const totalTime = Date.now() - start;

      performanceMetrics.database.esg = {
        queryTime: Math.round(totalTime / queries.length),
        status: totalTime / queries.length < 100 ? "fast" : totalTime / queries.length < 500 ? "normal" : "slow",
      };
    } catch (error: any) {
      performanceMetrics.database.esg = {
        queryTime: 0,
        status: "error",
      };
    }

    // Credit Database Performance
    try {
      const queries = [
        { name: "simple", query: creditPrisma.$queryRaw`SELECT 1` },
        { name: "articles", query: creditPrisma.$queryRaw`SELECT COUNT(*) FROM credit_articles` },
      ];

      const start = Date.now();
      await Promise.all(queries.map((q) => q.query));
      const totalTime = Date.now() - start;

      performanceMetrics.database.credit = {
        queryTime: Math.round(totalTime / queries.length),
        status: totalTime / queries.length < 100 ? "fast" : totalTime / queries.length < 500 ? "normal" : "slow",
      };
    } catch (error: any) {
      performanceMetrics.database.credit = {
        queryTime: 0,
        status: "error",
      };
    }

    // Memory Usage
    const memUsage = process.memoryUsage();
    performanceMetrics.memory = {
      used: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
      total: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
      percentage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
    };

    // System info
    const systemInfo = {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      uptime: Math.round(process.uptime()),
      uptimeFormatted: formatUptime(process.uptime()),
    };

    // Recent activity metrics
    const [userActivityRaw, likesRaw] = await Promise.all([
      esgPrisma.$queryRaw<any[]>`
        SELECT 
          COUNT(DISTINCT user_id) as active_users,
          COUNT(id) as total_activity
        FROM user_activity
        WHERE created_at > NOW() - INTERVAL '24 hours'
      `,
      esgPrisma.$queryRaw<any[]>`
        SELECT COUNT(id) as total_likes
        FROM likes
        WHERE created_at > NOW() - INTERVAL '24 hours'
      `,
    ]);

    const activityMetrics = {
      activeUsersLast24h: Number(userActivityRaw[0]?.active_users || 0),
      totalActivityLast24h: Number(userActivityRaw[0]?.total_activity || 0),
      totalLikesLast24h: Number(likesRaw[0]?.total_likes || 0),
    };

    return NextResponse.json({
      performance: performanceMetrics,
      system: systemInfo,
      activity: activityMetrics,
    });
  } catch (error: any) {
    console.error("Error fetching performance metrics:", error);
    return NextResponse.json(
      { error: "Failed to fetch performance metrics", details: error.message },
      { status: 500 }
    );
  }
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / (24 * 60 * 60));
  const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((seconds % (60 * 60)) / 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  
  return parts.length > 0 ? parts.join(" ") : "< 1m";
}
