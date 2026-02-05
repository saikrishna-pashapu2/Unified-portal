import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import { esgPrisma } from "@esgcredit/db-esg";
import { creditPrisma } from "@esgcredit/db-credit";
import bcrypt from "bcryptjs";

// GET /api/admin/users/[id] - Get user details
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    
    // Check if user is admin
    if (!(session as any)?.is_admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const userId = parseInt(params.id);

    const user = await esgPrisma.users.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        first_name: true,
        last_name: true,
        team: true,
        is_admin: true,
        is_active_db: true,
        created_at: true,
        last_login: true,
        email_notifications: true,
        preferred_categories: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    type ActivityRow = {
      id: number;
      action: string;
      resource_type: string | null;
      resource_id: number | null;
      details: string | null;
      ip_address: string | null;
      created_at: Date;
    };

    const [esgLikes, creditLikesRaw, activity, alerts, totalEsgLikes, totalCreditLikesRaw, totalActivity] = await Promise.all([
      esgPrisma.likes.findMany({
        where: { user_id: userId },
        orderBy: { created_at: "desc" },
        take: 200,
        select: {
          id: true,
          content_id: true,
          content_type: true,
          created_at: true,
        },
      }),
      creditPrisma.$queryRaw<
        { id: bigint | number; content_id: bigint | number; content_type: string | null; created_at: Date | null }[]
      >`
        SELECT id, content_id, content_type, created_at
        FROM likes
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT 200;
      `,
      (esgPrisma as any).user_activity.findMany({
        where: { user_id: userId },
        orderBy: { created_at: "desc" },
        take: 200,
        select: {
          id: true,
          action: true,
          resource_type: true,
          resource_id: true,
          details: true,
          ip_address: true,
          created_at: true,
        },
      }) as Promise<ActivityRow[]>,
      esgPrisma.alert_preferences.findMany({
        where: { user_id: userId },
        orderBy: { created_at: "desc" },
        take: 100,
        select: {
          id: true,
          alert_name: true,
          alert_type: true,
          domain: true,
          keywords: true,
          is_active: true,
          last_sent_at: true,
        },
      }),
      esgPrisma.likes.count({ where: { user_id: userId } }),
      creditPrisma.$queryRaw<{ count: bigint | number }[]>`
        SELECT COUNT(*)::int AS count
        FROM likes
        WHERE user_id = ${userId};
      `,
      (esgPrisma as any).user_activity.count({ where: { user_id: userId } }),
    ]);

    const creditLikes = creditLikesRaw.map((like) => ({
      ...like,
      id: Number(like.id),
      content_id: Number(like.content_id),
    }));

    const totalCreditLikes = totalCreditLikesRaw?.[0]?.count
      ? Number(totalCreditLikesRaw[0].count)
      : 0;

    const likes = [
      ...esgLikes.map((like) => ({
        ...like,
        source: "esg" as const,
      })),
      ...creditLikes.map((like) => ({
        ...like,
        source: "credit" as const,
      })),
    ].sort((a, b) => {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bTime - aTime;
    });

    const totalLikes = totalEsgLikes + totalCreditLikes;

    const articleLikeIds = likes
      .filter((like) => !like.content_type || like.content_type === "article")
      .map((like) => like.content_id);
    const eventLikeIds = likes
      .filter((like) => like.content_type === "event")
      .map((like) => like.content_id);
    const publicationLikeIds = likes
      .filter((like) => like.content_type === "publication")
      .map((like) => like.content_id);

    const [esgArticles, creditArticles, esgEvents, creditEvents, creditEventsLegacy, esgPublications] =
      await Promise.all([
        articleLikeIds.length
          ? esgPrisma.esg_articles.findMany({
              where: { id: { in: articleLikeIds } },
              select: { id: true, title: true, link: true },
            })
          : Promise.resolve([]),
        articleLikeIds.length
          ? creditPrisma.credit_articles.findMany({
              where: { id: { in: articleLikeIds } },
              select: { id: true, title: true, link: true },
            })
          : Promise.resolve([]),
        eventLikeIds.length
          ? esgPrisma.events.findMany({
              where: { id: { in: eventLikeIds } },
              select: { id: true, event_name: true, event_url: true },
            })
          : Promise.resolve([]),
        eventLikeIds.length
          ? creditPrisma.event.findMany({
              where: { id: { in: eventLikeIds } },
              select: { id: true, title: true, source_url: true },
            })
          : Promise.resolve([]),
        eventLikeIds.length
          ? creditPrisma.events.findMany({
              where: { id: { in: eventLikeIds } },
              select: { id: true, title: true, link: true },
            })
          : Promise.resolve([]),
        publicationLikeIds.length
          ? esgPrisma.publications.findMany({
              where: { id: { in: publicationLikeIds } },
              select: { id: true, title: true, link: true },
            })
          : Promise.resolve([]),
      ]);

    const articleMap = new Map<number, { title: string; url: string | null; domain: "esg" | "credit" }>();
    esgArticles.forEach((article) => {
      articleMap.set(article.id, {
        title: article.title,
        url: article.link || null,
        domain: "esg",
      });
    });
    creditArticles.forEach((article) => {
      if (!articleMap.has(article.id)) {
        articleMap.set(article.id, {
          title: article.title || "Untitled",
          url: article.link || null,
          domain: "credit",
        });
      }
    });

    const eventMap = new Map<number, { title: string; url: string | null; domain: "esg" | "credit" }>();
    esgEvents.forEach((event) => {
      eventMap.set(event.id, {
        title: event.event_name || "Untitled",
        url: event.event_url || null,
        domain: "esg",
      });
    });
    creditEvents.forEach((event) => {
      if (!eventMap.has(event.id)) {
        eventMap.set(event.id, {
          title: event.title || "Untitled",
          url: event.source_url || null,
          domain: "credit",
        });
      }
    });
    creditEventsLegacy.forEach((event) => {
      if (!eventMap.has(event.id)) {
        eventMap.set(event.id, {
          title: event.title || "Untitled",
          url: event.link || null,
          domain: "credit",
        });
      }
    });

    const publicationMap = new Map<number, { title: string; url: string | null; domain: "esg" }>();
    esgPublications.forEach((pub) => {
      publicationMap.set(pub.id, {
        title: pub.title,
        url: pub.link || null,
        domain: "esg",
      });
    });

    const enrichedLikes = likes.map((like) => {
      const contentType = like.content_type || "article";
      const map =
        contentType === "article"
          ? articleMap
          : contentType === "event"
          ? eventMap
          : publicationMap;
      const meta = map.get(like.content_id);

      return {
        ...like,
        content_type: contentType,
        content_title: meta?.title || `Content #${like.content_id}`,
        content_url: meta?.url || null,
        domain: meta?.domain || like.source,
      };
    });

    const likesByTypeMap = new Map<
      string,
      { content_type: string; esg_count: number; credit_count: number; total: number }
    >();
    enrichedLikes.forEach((like) => {
      const key = like.content_type;
      const current = likesByTypeMap.get(key) || {
        content_type: key,
        esg_count: 0,
        credit_count: 0,
        total: 0,
      };
      if (like.domain === "credit") {
        current.credit_count += 1;
      } else {
        current.esg_count += 1;
      }
      current.total += 1;
      likesByTypeMap.set(key, current);
    });

    const activityByTypeMap = new Map<string, number>();
    activity.forEach((act: ActivityRow) => {
      activityByTypeMap.set(act.action, (activityByTypeMap.get(act.action) || 0) + 1);
    });

    const enrichedActivity = activity.map((act: ActivityRow) => {
      const type = act.resource_type || "page";
      const resourceId = act.resource_id || 0;
      const resourceMap =
        type === "article"
          ? articleMap
          : type === "event"
          ? eventMap
          : type === "publication"
          ? publicationMap
          : null;
      const meta = resourceMap?.get(resourceId);

      return {
        ...act,
        resource_type: type,
        resource_title: meta?.title || null,
        resource_url: meta?.url || null,
        domain: meta?.domain || null,
      };
    });

    const fullName =
      `${user.first_name || ""} ${user.last_name || ""}`.trim() ||
      user.username ||
      user.email ||
      "User";

    return NextResponse.json({
      user: {
        ...user,
        name: fullName,
      },
      stats: {
        totalLikes,
        totalActivity,
        totalAlerts: alerts.length,
        likesByType: Array.from(likesByTypeMap.values()),
        activityByType: Array.from(activityByTypeMap.entries()).map(([action, count]) => ({
          action,
          count,
        })),
      },
      likes: enrichedLikes,
      activity: enrichedActivity,
      alerts,
    });
  } catch (error: any) {
    console.error("Error fetching user:", error);
    return NextResponse.json(
      { error: "Failed to fetch user" },
      { status: 500 }
    );
  }
}

// PATCH /api/admin/users/[id] - Update user
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    
    // Check if user is admin
    if (!(session as any)?.is_admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const userId = parseInt(params.id);
    const body = await req.json();
    const { email, password, first_name, last_name, team, is_admin, is_active } = body;

    // Build update data
    const updateData: any = {};
    
    if (email !== undefined) updateData.email = email;
    if (first_name !== undefined) updateData.first_name = first_name;
    if (last_name !== undefined) updateData.last_name = last_name;
    if (team !== undefined) updateData.team = team;
    if (is_admin !== undefined) updateData.is_admin = is_admin;
    if (is_active !== undefined) updateData.is_active_db = is_active;
    
    // Hash password if provided
    if (password) {
      updateData.password_hash = await bcrypt.hash(password, 10);
    }

    // Update user
    const updatedUser = await esgPrisma.users.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        team: true,
        is_admin: true,
        is_active_db: true,
        created_at: true,
        last_login: true,
      },
    });

    return NextResponse.json(updatedUser);
  } catch (error: any) {
    console.error("Error updating user:", error);
    return NextResponse.json(
      { error: "Failed to update user" },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/users/[id] - Delete user
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    
    // Check if user is admin
    if (!(session as any)?.is_admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const userId = parseInt(params.id);
    const sessionUserId = session?.user ? parseInt((session.user as any).id) : null;

    // Prevent self-deletion
    if (sessionUserId && userId === sessionUserId) {
      return NextResponse.json(
        { error: "Cannot delete your own account" },
        { status: 400 }
      );
    }

    // Manually delete related records first (in case cascade is not set up in DB)
    // Delete email_queue records
    await esgPrisma.email_queue.deleteMany({
      where: { user_id: userId },
    });

    // Delete alert_preferences (this will cascade to alert_content_sent)
    await esgPrisma.alert_preferences.deleteMany({
      where: { user_id: userId },
    });

    // Delete likes (should have cascade, but doing it explicitly)
    await esgPrisma.likes.deleteMany({
      where: { user_id: userId },
    });

    // Delete PDF translation jobs (user_id is nullable)
    await esgPrisma.pdf_translation_jobs.deleteMany({
      where: { user_id: userId },
    });

    // Delete translation_history
    await esgPrisma.translation_history.deleteMany({
      where: { user_id: userId },
    });

    // Delete user_preferences
    await esgPrisma.user_preferences.deleteMany({
      where: { user_id: userId },
    });

    // Delete file_uploads (user_id is nullable)
    await esgPrisma.file_uploads.deleteMany({
      where: { user_id: userId },
    });

    // Finally delete the user
    await esgPrisma.users.delete({
      where: { id: userId },
    });

    return NextResponse.json({ message: "User deleted successfully" });
  } catch (error: any) {
    console.error("Error deleting user:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete user" },
      { status: 500 }
    );
  }
}
