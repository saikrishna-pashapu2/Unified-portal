import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import { esgPrisma } from "@esgcredit/db-esg";
import { creditPrisma } from "@esgcredit/db-credit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/analytics/user-engagement
 * Get user engagement analytics
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!(session as any)?.is_admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const days = parseInt(searchParams.get("days") || "30");

    // Total users
    const totalUsers = await esgPrisma.users.count();

    // New users in the last N days
    const newUsersRaw = await esgPrisma.$queryRaw<any[]>`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count
      FROM users
      WHERE created_at > NOW() - INTERVAL '${days} days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `;
    const newUsers = newUsersRaw.map((item) => ({
      date: item.date,
      count: Number(item.count),
    }));

    // Users by team
    const usersByTeamRaw = await esgPrisma.$queryRaw<any[]>`
      SELECT 
        COALESCE(team, 'No Team') as team,
        COUNT(*) as count
      FROM users
      GROUP BY team
      ORDER BY count DESC
    `;
    const usersByTeam = usersByTeamRaw.map((item) => ({
      team: item.team,
      count: Number(item.count),
    }));

    // Activity over time (ESG activity tracking)
    const activityOverTimeRaw = await esgPrisma.$queryRaw<any[]>`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count
      FROM user_activity
      WHERE created_at > NOW() - INTERVAL '${days} days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `;
    const activityOverTime = activityOverTimeRaw.map((item) => ({
      date: item.date,
      count: Number(item.count),
    }));

    const totalActivityRaw = await esgPrisma.$queryRaw<any[]>`
      SELECT COUNT(*) as count FROM user_activity
    `;
    const totalActivity = Number(totalActivityRaw[0]?.count || 0);

    // Likes over time (ESG + Credit)
    const [esgLikesOverTimeRaw, creditLikesOverTimeRaw] = await Promise.all([
      esgPrisma.$queryRaw<any[]>`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as count
        FROM likes
        WHERE created_at > NOW() - INTERVAL '${days} days'
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `,
      creditPrisma.$queryRaw<any[]>`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as count
        FROM likes
        WHERE created_at > NOW() - INTERVAL '${days} days'
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `,
    ]);

    const likesOverTimeMap = new Map<string, number>();
    esgLikesOverTimeRaw.forEach((item) => {
      likesOverTimeMap.set(item.date, (likesOverTimeMap.get(item.date) || 0) + Number(item.count));
    });
    creditLikesOverTimeRaw.forEach((item) => {
      likesOverTimeMap.set(item.date, (likesOverTimeMap.get(item.date) || 0) + Number(item.count));
    });
    const likesOverTime = Array.from(likesOverTimeMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => (a.date > b.date ? -1 : 1));

    const [totalEsgLikesRaw, totalCreditLikesRaw] = await Promise.all([
      esgPrisma.$queryRaw<any[]>`SELECT COUNT(*) as count FROM likes`,
      creditPrisma.$queryRaw<any[]>`SELECT COUNT(*) as count FROM likes`,
    ]);
    const totalLikes = Number(totalEsgLikesRaw[0]?.count || 0) + Number(totalCreditLikesRaw[0]?.count || 0);

    // Likes by content type (ESG + Credit)
    const [esgLikesByTypeRaw, creditLikesByTypeRaw] = await Promise.all([
      esgPrisma.$queryRaw<any[]>`
        SELECT COALESCE(content_type, 'article') as content_type, COUNT(*) as count
        FROM likes
        GROUP BY COALESCE(content_type, 'article')
      `,
      creditPrisma.$queryRaw<any[]>`
        SELECT COALESCE(content_type, 'article') as content_type, COUNT(*) as count
        FROM likes
        GROUP BY COALESCE(content_type, 'article')
      `,
    ]);
    const likesByTypeMap = new Map<string, number>();
    esgLikesByTypeRaw.forEach((row) => {
      likesByTypeMap.set(row.content_type, (likesByTypeMap.get(row.content_type) || 0) + Number(row.count));
    });
    creditLikesByTypeRaw.forEach((row) => {
      likesByTypeMap.set(row.content_type, (likesByTypeMap.get(row.content_type) || 0) + Number(row.count));
    });
    const likesByType = Array.from(likesByTypeMap.entries()).map(([content_type, count]) => ({
      content_type,
      count,
    }));

    // Top likers (merge ESG + Credit likes by user)
    const [esgLikersRaw, creditLikersRaw] = await Promise.all([
      esgPrisma.$queryRaw<any[]>`
        SELECT user_id, COUNT(*) as like_count
        FROM likes
        GROUP BY user_id
      `,
      creditPrisma.$queryRaw<any[]>`
        SELECT user_id, COUNT(*) as like_count
        FROM likes
        GROUP BY user_id
      `,
    ]);

    const likeCountsByUser = new Map<number, number>();
    esgLikersRaw.forEach((row) => {
      likeCountsByUser.set(Number(row.user_id), Number(row.like_count));
    });
    creditLikersRaw.forEach((row) => {
      const userId = Number(row.user_id);
      likeCountsByUser.set(userId, (likeCountsByUser.get(userId) || 0) + Number(row.like_count));
    });

    const userIds = Array.from(likeCountsByUser.keys());
    const users = userIds.length
      ? await esgPrisma.users.findMany({
          where: { id: { in: userIds } },
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
            team: true,
          },
        })
      : [];

    const usersById = new Map(users.map((u) => [u.id, u]));
    const topLikers = Array.from(likeCountsByUser.entries())
      .map(([id, like_count]) => {
        const user = usersById.get(id);
        const name =
          user?.first_name || user?.last_name
            ? `${user?.first_name || ""} ${user?.last_name || ""}`.trim()
            : user?.email || "Unknown";
        return {
          id,
          name,
          email: user?.email || "Unknown",
          team: user?.team || null,
          like_count,
        };
      })
      .sort((a, b) => b.like_count - a.like_count)
      .slice(0, 10);

    // Top active users (by activity)
    const topActiveUsersRaw = await esgPrisma.$queryRaw<any[]>`
      SELECT user_id, COUNT(*) as activity_count
      FROM user_activity
      WHERE created_at > NOW() - INTERVAL '${days} days'
      GROUP BY user_id
      ORDER BY activity_count DESC
      LIMIT 10
    `;
    const topActiveUserIds = topActiveUsersRaw.map((row) => Number(row.user_id));
    const topActiveUsersMeta = topActiveUserIds.length
      ? await esgPrisma.users.findMany({
          where: { id: { in: topActiveUserIds } },
          select: { id: true, first_name: true, last_name: true, email: true, team: true },
        })
      : [];
    const topActiveUsersById = new Map(topActiveUsersMeta.map((u) => [u.id, u]));
    const topActiveUsers = topActiveUsersRaw.map((row) => {
      const user = topActiveUsersById.get(Number(row.user_id));
      const name =
        user?.first_name || user?.last_name
          ? `${user?.first_name || ""} ${user?.last_name || ""}`.trim()
          : user?.email || "Unknown";
      return {
        id: Number(row.user_id),
        name,
        email: user?.email || "Unknown",
        team: user?.team || null,
        activity_count: Number(row.activity_count),
      };
    });

    // Top visited pages (from activity details)
    const topPagesRaw = await esgPrisma.$queryRaw<any[]>`
      SELECT COALESCE(details, 'Unknown') as page,
             COUNT(*) as count
      FROM user_activity
      WHERE created_at > NOW() - INTERVAL '${days} days'
      GROUP BY COALESCE(details, 'Unknown')
      ORDER BY count DESC
      LIMIT 10
    `;
    const topPages = topPagesRaw.map((row) => ({
      page: row.page,
      count: Number(row.count),
    }));

    // Top liked sources (ESG + Credit)
    const [esgTopSourcesRaw, creditTopSourcesRaw] = await Promise.all([
      esgPrisma.$queryRaw<any[]>`
        SELECT COALESCE(a.source, 'Unknown') as source, COUNT(l.id) as like_count
        FROM esg_articles a
        JOIN likes l ON a.id = l.content_id AND COALESCE(l.content_type, 'article') = 'article'
        WHERE l.created_at > NOW() - INTERVAL '${days} days'
        GROUP BY COALESCE(a.source, 'Unknown')
        ORDER BY like_count DESC
        LIMIT 10
      `,
      creditPrisma.$queryRaw<any[]>`
        SELECT COALESCE(a.source, 'Unknown') as source, COUNT(l.id) as like_count
        FROM credit_articles a
        JOIN likes l ON a.id = l.content_id AND COALESCE(l.content_type, 'article') = 'article'
        WHERE l.created_at > NOW() - INTERVAL '${days} days'
        GROUP BY COALESCE(a.source, 'Unknown')
        ORDER BY like_count DESC
        LIMIT 10
      `,
    ]);
    const topSources = [
      ...esgTopSourcesRaw.map((row) => ({
        source: row.source,
        like_count: Number(row.like_count),
        domain: "esg" as const,
      })),
      ...creditTopSourcesRaw.map((row) => ({
        source: row.source,
        like_count: Number(row.like_count),
        domain: "credit" as const,
      })),
    ]
      .sort((a, b) => b.like_count - a.like_count)
      .slice(0, 10);

    // Active users (activity or likes in last N days across both DBs)
    const [esgActiveLikesRaw, creditActiveLikesRaw, activeActivityRaw] = await Promise.all([
      esgPrisma.$queryRaw<any[]>`
        SELECT DISTINCT user_id
        FROM likes
        WHERE created_at > NOW() - INTERVAL '${days} days'
      `,
      creditPrisma.$queryRaw<any[]>`
        SELECT DISTINCT user_id
        FROM likes
        WHERE created_at > NOW() - INTERVAL '${days} days'
      `,
      esgPrisma.$queryRaw<any[]>`
        SELECT DISTINCT user_id
        FROM user_activity
        WHERE created_at > NOW() - INTERVAL '${days} days'
      `,
    ]);

    const activeUsersSet = new Set<number>();
    esgActiveLikesRaw.forEach((row) => activeUsersSet.add(Number(row.user_id)));
    creditActiveLikesRaw.forEach((row) => activeUsersSet.add(Number(row.user_id)));
    activeActivityRaw.forEach((row) => activeUsersSet.add(Number(row.user_id)));
    const activeUsers = activeUsersSet.size;
    const inactiveUsers = Math.max(totalUsers - activeUsers, 0);

    return NextResponse.json({
      overview: {
        totalUsers,
        activeUsers,
        totalLikes,
        totalActivity,
        inactiveUsers,
      },
      newUsers,
      usersByTeam,
      likesOverTime,
      activityOverTime,
      likesByType,
      topPages,
      topSources,
      topLikers,
      topActiveUsers,
    });
  } catch (error: any) {
    console.error("Error fetching user engagement analytics:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch user engagement analytics" },
      { status: 500 }
    );
  }
}
