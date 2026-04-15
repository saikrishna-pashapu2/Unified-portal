import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import { esgPrisma } from "@esgcredit/db-esg";
import { creditPrisma } from "@esgcredit/db-credit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/stats - Get dashboard statistics
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    // Check if user is admin
    if (!(session as any)?.is_admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Get stats in parallel
    const [
      totalUsers,
      loginUsersRaw,
      activityUsersRaw,
      esgLikeUsersRaw,
      creditLikeUsersRaw,
      assistantUsersRaw,
      newUsersThisWeek,
      totalAlerts,
      activeAlerts,
      recentUsers,
      emailStats,
      aiAssistantStatsRaw,
    ] = await Promise.all([
      // Total users
      esgPrisma.users.count(),
      
      esgPrisma.$queryRaw<Array<{ id: number }>>`
        SELECT id
        FROM users
        WHERE last_login >= ${thirtyDaysAgo}
      `,

      esgPrisma.$queryRaw<Array<{ user_id: number }>>`
        SELECT DISTINCT user_id
        FROM user_activity
        WHERE created_at >= ${thirtyDaysAgo}
      `,

      esgPrisma.$queryRaw<Array<{ user_id: number }>>`
        SELECT DISTINCT user_id
        FROM likes
        WHERE created_at >= ${thirtyDaysAgo}
      `,

      creditPrisma.$queryRaw<Array<{ user_id: number }>>`
        SELECT DISTINCT user_id
        FROM likes
        WHERE created_at >= ${thirtyDaysAgo}
      `,

      esgPrisma.$queryRaw<Array<{ user_id: number }>>`
        SELECT DISTINCT user_id
        FROM article_conversations
        WHERE created_at >= ${thirtyDaysAgo}
          AND user_id IS NOT NULL
      `,
      
      // New users this week
      esgPrisma.users.count({
        where: {
          created_at: {
            gte: sevenDaysAgo,
          },
        },
      }),
      
      // Total alerts
      esgPrisma.alert_preferences.count(),
      
      // Active alerts
      esgPrisma.alert_preferences.count({
        where: {
          is_active: true,
          email_enabled: true,
        },
      }),
      
      // Recent users (last 10)
      esgPrisma.users.findMany({
        select: {
          id: true,
          email: true,
          first_name: true,
          last_name: true,
          created_at: true,
        },
        orderBy: { created_at: "desc" },
        take: 10,
      }),
      
      // Email queue stats
      esgPrisma.email_queue.groupBy({
        by: ['status'],
        _count: true,
      }),

      esgPrisma.$queryRaw<Array<{
        total_sessions: bigint;
        active_sessions: bigint;
        unique_users: bigint;
        total_cost: number;
      }>>`
        SELECT
          COUNT(*)::bigint as total_sessions,
          COUNT(*) FILTER (WHERE last_message_at >= ${last24Hours})::bigint as active_sessions,
          COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL)::bigint as unique_users,
          COALESCE(SUM(total_cost_usd), 0) as total_cost
        FROM article_conversations
        WHERE created_at >= ${thirtyDaysAgo}
      `,
    ]);

    const activeUserIds = new Set<number>();
    loginUsersRaw.forEach((row) => activeUserIds.add(Number(row.id)));
    activityUsersRaw.forEach((row) => row.user_id && activeUserIds.add(Number(row.user_id)));
    esgLikeUsersRaw.forEach((row) => row.user_id && activeUserIds.add(Number(row.user_id)));
    creditLikeUsersRaw.forEach((row) => row.user_id && activeUserIds.add(Number(row.user_id)));
    assistantUsersRaw.forEach((row) => row.user_id && activeUserIds.add(Number(row.user_id)));

    const aiAssistantStatsResult = aiAssistantStatsRaw[0];
    const aiAssistantStats = {
      totalSessions: Number(aiAssistantStatsResult?.total_sessions || 0),
      activeSessions: Number(aiAssistantStatsResult?.active_sessions || 0),
      uniqueUsers: Number(aiAssistantStatsResult?.unique_users || 0),
      totalCost: Number(aiAssistantStatsResult?.total_cost || 0),
    };

    // Process email stats
    const emailStatsMap = emailStats.reduce((acc: any, stat) => {
      acc[stat.status || 'unknown'] = stat._count;
      return acc;
    }, {});

    return NextResponse.json({
      totalUsers,
      activeUsers: activeUserIds.size,
      newUsersThisWeek,
      totalAlerts,
      activeAlerts,
      recentUsers,
      emailStats: {
        queued: emailStatsMap['queued'] || 0,
        sent: emailStatsMap['sent'] || 0,
        failed: emailStatsMap['failed'] || 0,
      },
      aiAssistant: aiAssistantStats,
    });
  } catch (error: any) {
    console.error("Error fetching stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch statistics" },
      { status: 500 }
    );
  }
}
