import { NextRequest, NextResponse } from "next/server";
import { esgPrisma } from "@esgcredit/db-esg";
import { requireSession } from "@/lib/api-auth";
import { tenderLikeViewerFromSession } from "@/lib/monitored-tenders/likes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function tenderExists(id: string): Promise<boolean> {
  const tender = await esgPrisma.monitored_tenders.findUnique({
    where: { id },
    select: { id: true },
  });
  return Boolean(tender);
}

function likesForTender(tx: typeof esgPrisma, tenderId: string) {
  return tx.monitored_tender_likes.findMany({
    where: { tender_id: tenderId },
    include: { team_member: true },
    orderBy: { created_at: "desc" },
  });
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireSession();
    if (auth.response) return auth.response;

    const viewer = tenderLikeViewerFromSession(auth.session);
    if (!viewer) {
      return NextResponse.json({ ok: false, error: "Authenticated user identity is missing" }, { status: 401 });
    }

    const { id } = await params;

    if (!(await tenderExists(id))) {
      return NextResponse.json({ ok: false, error: "Tender not found" }, { status: 404 });
    }

    const likes = await esgPrisma.$transaction(async (tx) => {
      const now = new Date();
      const member = await tx.monitored_team_members.upsert({
        where: { member_key: viewer.memberKey },
        create: {
          display_name: viewer.displayName,
          member_key: viewer.memberKey,
          last_used_at: now,
        },
        update: {
          display_name: viewer.displayName,
          updated_at: now,
          last_used_at: now,
          use_count: { increment: 1 },
        },
      });

      await tx.monitored_tender_likes.upsert({
        where: {
          tender_id_team_member_id: {
            tender_id: id,
            team_member_id: member.id,
          },
        },
        create: {
          tender_id: id,
          team_member_id: member.id,
        },
        update: {},
      });

      return likesForTender(tx as typeof esgPrisma, id);
    });

    return NextResponse.json({ ok: true, likes });
  } catch (error) {
    console.error("[monitored-tenders] Like failed:", error);
    return NextResponse.json({ ok: false, error: "Failed to like tender" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireSession();
    if (auth.response) return auth.response;

    const viewer = tenderLikeViewerFromSession(auth.session);
    if (!viewer) {
      return NextResponse.json({ ok: false, error: "Authenticated user identity is missing" }, { status: 401 });
    }

    const { id } = await params;

    const likes = await esgPrisma.$transaction(async (tx) => {
      const member = await tx.monitored_team_members.findUnique({
        where: { member_key: viewer.memberKey },
        select: { id: true },
      });
      if (member) {
        await tx.monitored_tender_likes.deleteMany({
          where: { tender_id: id, team_member_id: member.id },
        });
      }
      return likesForTender(tx as typeof esgPrisma, id);
    });

    return NextResponse.json({ ok: true, likes });
  } catch (error) {
    console.error("[monitored-tenders] Unlike failed:", error);
    return NextResponse.json({ ok: false, error: "Failed to unlike tender" }, { status: 500 });
  }
}
