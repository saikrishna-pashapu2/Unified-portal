import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import { creditPrisma } from "@esgcredit/db-credit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userEmail = session.user.email;

    const history = await creditPrisma.fitch_upload_history.findMany({
      where: { user_email: userEmail },
      orderBy: { created_at: "desc" },
      take: 50, // Limit to last 50 uploads
      select: {
        id: true,
        original_filename: true,
        updated_filename: true,
        companies_count: true,
        success_count: true,
        error_count: true,
        file_size: true,
        created_at: true,
        // Don't include file_data in list view
      }
    });

    return NextResponse.json({ history });
  } catch (err: any) {
    console.error("History fetch error:", err);
    return NextResponse.json(
      { error: "Failed to fetch history" },
      { status: 500 }
    );
  }
}
