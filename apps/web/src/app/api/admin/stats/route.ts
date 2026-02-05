import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import { esgPrisma } from "@esgcredit/db-esg";

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
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Get stats in parallel
    const [
      totalUsers,
      activeUsers,
      newUsersThisWeek,
      totalAlerts,
      activeAlerts,
      recentUsers,
      emailStats,
      aiAssistantStats,
    ] = await Promise.all([
      // Total users
      esgPrisma.users.count(),
      
      // Active users (logged in last 30 days)
      esgPrisma.users.count({
        where: {
          last_login: {
            gte: thirtyDaysAgo,
          },
        },
      }),
      
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

      // AI Assistant stats (last 30 days)
      // Note: article_ai_sessions table doesn't exist in schema yet
      // Returning default values until tables are added to Prisma schema
      Promise.resolve({
        totalSessions: 0,
        activeSessions: 0,
        uniqueUsers: 0,
        totalCost: 0,
      }),
    ]);

    // Process email stats
    const emailStatsMap = emailStats.reduce((acc: any, stat) => {
      acc[stat.status || 'unknown'] = stat._count;
      return acc;
    }, {});

    return NextResponse.json({
      totalUsers,
      activeUsers,
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
