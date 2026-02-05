
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import { esgPrisma } from "@esgcredit/db-esg";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id;

    if (!userId) {
      // Allow anonymous tracking? For now, let's skip anonymous to keep DB clean
      // or map to a guest user if needed.
      return NextResponse.json({ message: "User not authenticated" }, { status: 401 });
    }

    const body = await req.json();
    const { action, resource_type, resource_id, details, path } = body;

    // Fallback: use path as details if not provided
    const finalDetails = details || path || "Unknown path";

    // Detect IP from headers
    const forwardedFor = req.headers.get("x-forwarded-for");
    const ip_address = forwardedFor ? forwardedFor.split(',')[0] : "127.0.0.1";
    const user_agent = req.headers.get("user-agent") || null;

    await (esgPrisma as any).user_activity.create({
      data: {
        user_id: parseInt(userId),
        action: action || "view_page",
        resource_type: resource_type || "page",
        resource_id: resource_id ? parseInt(resource_id) : null,
        details: finalDetails,
        ip_address,
        user_agent,
        timestamp: new Date(),
        created_at: new Date(), // schema has both?
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error logging activity:", error);
    return NextResponse.json(
      { error: "Failed to log activity" },
      { status: 500 }
    );
  }
}
