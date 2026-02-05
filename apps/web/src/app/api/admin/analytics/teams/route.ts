import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import { esgPrisma } from "@esgcredit/db-esg";
import { creditPrisma } from "@esgcredit/db-credit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/analytics/teams
 * Get team comparison analytics
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!(session as any)?.is_admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const days = parseInt(searchParams.get("days") || "30");

    // Users by team
    const usersByTeamRaw = await esgPrisma.$queryRaw<any[]>`
      SELECT 
        COALESCE(team, 'No Team') as team,
        COUNT(*) as user_count
      FROM users
      GROUP BY team
      ORDER BY user_count DESC
    `;
    const usersByTeam = usersByTeamRaw.map((item) => ({
      team: item.team,
      user_count: Number(item.user_count),
    }));

    const [
      esgLikesByUserRaw,
      creditLikesByUserRaw,
      activityByUserRaw,
    ] = await Promise.all([
      esgPrisma.$queryRaw<any[]>`
        SELECT user_id, COUNT(*) as like_count
        FROM likes
        WHERE created_at > NOW() - INTERVAL '${days} days'
        GROUP BY user_id
      `,
      creditPrisma.$queryRaw<any[]>`
        SELECT user_id, COUNT(*) as like_count
        FROM likes
        WHERE created_at > NOW() - INTERVAL '${days} days'
        GROUP BY user_id
      `,
      esgPrisma.$queryRaw<any[]>`
        SELECT user_id, COUNT(*) as activity_count
        FROM user_activity
        WHERE created_at > NOW() - INTERVAL '${days} days'
        GROUP BY user_id
      `,
    ]);

    const likesByUser = new Map<number, number>();
    esgLikesByUserRaw.forEach((row) => likesByUser.set(Number(row.user_id), Number(row.like_count)));
    creditLikesByUserRaw.forEach((row) => {
      const userId = Number(row.user_id);
      likesByUser.set(userId, (likesByUser.get(userId) || 0) + Number(row.like_count));
    });

    const activityByUser = new Map<number, number>();
    activityByUserRaw.forEach((row) => activityByUser.set(Number(row.user_id), Number(row.activity_count)));

    const users = await esgPrisma.users.findMany({
      select: { id: true, team: true },
    });

    const likesByTeamMap = new Map<string, number>();
    const activityByTeamMap = new Map<string, number>();

    users.forEach((user) => {
      const team = user.team || "No Team";
      likesByTeamMap.set(team, (likesByTeamMap.get(team) || 0) + (likesByUser.get(user.id) || 0));
      activityByTeamMap.set(team, (activityByTeamMap.get(team) || 0) + (activityByUser.get(user.id) || 0));
    });

    const likesByTeam = Array.from(likesByTeamMap.entries())
      .map(([team, like_count]) => ({ team, like_count }))
      .sort((a, b) => b.like_count - a.like_count);

    const activityByTeam = Array.from(activityByTeamMap.entries())
      .map(([team, activity_count]) => ({ team, activity_count }))
      .sort((a, b) => b.activity_count - a.activity_count);

    const teamEngagement = usersByTeam.map((teamItem) => {
      const team = teamItem.team;
      const userCount = teamItem.user_count;
      const likeCount = likesByTeamMap.get(team) || 0;
      const activityCount = activityByTeamMap.get(team) || 0;
      const likesPerUser = userCount > 0 ? likeCount / userCount : 0;
      const activityPerUser = userCount > 0 ? activityCount / userCount : 0;
      const engagementScore = (likesPerUser * 0.6 + activityPerUser * 0.4) * 100;

      return {
        team,
        user_count: userCount,
        like_count: likeCount,
        likes_per_user: parseFloat(likesPerUser.toFixed(2)),
        activity_count: activityCount,
        activity_per_user: parseFloat(activityPerUser.toFixed(2)),
        engagement_score: parseFloat(engagementScore.toFixed(2)),
      };
    });

    return NextResponse.json({
      usersByTeam,
      likesByTeam,
      teamEngagement,
      activityByTeam,
    });
  } catch (error: any) {
    console.error("Error fetching team analytics:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch team analytics" },
      { status: 500 }
    );
  }
}
