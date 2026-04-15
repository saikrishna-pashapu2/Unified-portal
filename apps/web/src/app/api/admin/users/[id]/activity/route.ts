import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import { esgPrisma } from "@esgcredit/db-esg";
import { creditPrisma } from "@esgcredit/db-credit";
import { extractActivityPath, inferActivityDomain } from "@/lib/user-activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!(session as any)?.is_admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const userId = parseInt(params.id);
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") || "50");

    type ActivityRow = {
      id: number;
      action: string;
      resource_type: string | null;
      resource_id: number | null;
      details: string | null;
      ip_address: string | null;
      created_at: Date;
    };

    let activity: ActivityRow[] = [];
    let totalActivity = 0;

    try {
      // Use raw SQL queries since Prisma model may not be generated
      const [activityResult, countResult] = await Promise.all([
        esgPrisma.$queryRaw<ActivityRow[]>`
          SELECT id, action, resource_type, resource_id, details, ip_address, created_at
          FROM user_activity
          WHERE user_id = ${userId}
          ORDER BY created_at DESC
          LIMIT ${limit}
        `,
        esgPrisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*)::bigint as count FROM user_activity WHERE user_id = ${userId}
        `,
      ]);
      activity = activityResult;
      totalActivity = Number(countResult[0]?.count ?? 0);
    } catch (dbError: any) {
      // Handle missing user_activity table gracefully
      console.warn('Error fetching user_activity:', dbError?.message);
      return NextResponse.json({
        activity: [],
        stats: {
          totalActivity: 0,
          activityByType: [],
        },
      });
    }

    const articleIds = activity
      .filter((act: ActivityRow) => act.resource_type === "article" && act.resource_id)
      .map((act: ActivityRow) => act.resource_id as number);
    const eventIds = activity
      .filter((act: ActivityRow) => act.resource_type === "event" && act.resource_id)
      .map((act: ActivityRow) => act.resource_id as number);
    const publicationIds = activity
      .filter((act: ActivityRow) => act.resource_type === "publication" && act.resource_id)
      .map((act: ActivityRow) => act.resource_id as number);

    const [esgArticles, creditArticles, esgEvents, creditEvents, creditEventsLegacy, esgPublications] =
      await Promise.all([
        articleIds.length
          ? esgPrisma.esg_articles.findMany({
              where: { id: { in: articleIds } },
              select: { id: true, title: true, link: true },
            })
          : Promise.resolve([]),
        articleIds.length
          ? creditPrisma.credit_articles.findMany({
              where: { id: { in: articleIds } },
              select: { id: true, title: true, link: true },
            })
          : Promise.resolve([]),
        eventIds.length
          ? esgPrisma.events.findMany({
              where: { id: { in: eventIds } },
              select: { id: true, event_name: true, event_url: true },
            })
          : Promise.resolve([]),
        eventIds.length
          ? creditPrisma.event.findMany({
              where: { id: { in: eventIds } },
              select: { id: true, title: true, source_url: true },
            })
          : Promise.resolve([]),
        eventIds.length
          ? creditPrisma.events.findMany({
              where: { id: { in: eventIds } },
              select: { id: true, title: true, link: true },
            })
          : Promise.resolve([]),
        publicationIds.length
          ? esgPrisma.publications.findMany({
              where: { id: { in: publicationIds } },
              select: { id: true, title: true, link: true },
            })
          : Promise.resolve([]),
      ]);

    const esgArticleMap = new Map<number, { title: string; url: string | null; domain: "esg" }>();
    esgArticles.forEach((article) => {
      esgArticleMap.set(article.id, {
        title: article.title,
        url: article.link || null,
        domain: "esg",
      });
    });

    const creditArticleMap = new Map<number, { title: string; url: string | null; domain: "credit" }>();
    creditArticles.forEach((article) => {
      creditArticleMap.set(article.id, {
        title: article.title || "Untitled",
        url: article.link || null,
        domain: "credit",
      });
    });

    const esgEventMap = new Map<number, { title: string; url: string | null; domain: "esg" }>();
    esgEvents.forEach((event) => {
      esgEventMap.set(event.id, {
        title: event.event_name || "Untitled",
        url: event.event_url || null,
        domain: "esg",
      });
    });

    const creditEventMap = new Map<number, { title: string; url: string | null; domain: "credit" }>();
    creditEvents.forEach((event) => {
      creditEventMap.set(event.id, {
        title: event.title || "Untitled",
        url: event.source_url || null,
        domain: "credit",
      });
    });
    creditEventsLegacy.forEach((event) => {
      if (!creditEventMap.has(event.id)) {
        creditEventMap.set(event.id, {
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

    const getResourceMeta = (
      type: string,
      resourceId: number,
      preferredDomain: "esg" | "credit" | null
    ) => {
      if (type === "article") {
        if (preferredDomain === "credit") {
          return creditArticleMap.get(resourceId) ?? esgArticleMap.get(resourceId) ?? null;
        }

        if (preferredDomain === "esg") {
          return esgArticleMap.get(resourceId) ?? creditArticleMap.get(resourceId) ?? null;
        }

        return esgArticleMap.get(resourceId) ?? creditArticleMap.get(resourceId) ?? null;
      }

      if (type === "event") {
        if (preferredDomain === "credit") {
          return creditEventMap.get(resourceId) ?? esgEventMap.get(resourceId) ?? null;
        }

        if (preferredDomain === "esg") {
          return esgEventMap.get(resourceId) ?? creditEventMap.get(resourceId) ?? null;
        }

        return esgEventMap.get(resourceId) ?? creditEventMap.get(resourceId) ?? null;
      }

      if (type === "publication") {
        return publicationMap.get(resourceId) ?? null;
      }

      return null;
    };

    const enrichedActivity = activity.map((act: ActivityRow) => {
      const type = act.resource_type || "page";
      const resourceId = act.resource_id || 0;
      const activityDomain = inferActivityDomain(act.details);
      const activityPath = extractActivityPath(act.details);
      const meta = getResourceMeta(type, resourceId, activityDomain);

      return {
        ...act,
        resource_type: type,
        resource_title: meta?.title || null,
        resource_url: activityPath || meta?.url || null,
        domain: meta?.domain || activityDomain || null,
      };
    });

    const activityByType = new Map<string, number>();
    enrichedActivity.forEach((act: ActivityRow) => {
      activityByType.set(act.action, (activityByType.get(act.action) || 0) + 1);
    });

    return NextResponse.json({
      activity: enrichedActivity,
      stats: {
        totalActivity,
        activityByType: Array.from(activityByType.entries()).map(([action, count]) => ({
          action,
          count,
        })),
      },
    });
  } catch (error: any) {
    console.error("Error fetching user activity:", {
      message: error?.message,
      code: error?.code,
      meta: error?.meta,
      stack: error?.stack,
    });
    return NextResponse.json(
      { 
        error: "Failed to fetch user activity",
        details: process.env.NODE_ENV === 'development' ? error?.message : undefined
      },
      { status: 500 }
    );
  }
}
