
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import { normalizeActivityId, recordUserActivity } from "@/lib/user-activity";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = normalizeActivityId((session?.user as any)?.id);

    if (!userId) {
      return NextResponse.json({ message: "User not authenticated" }, { status: 401 });
    }

    const body = await req.json();
    const { action, resource_type, resource_id, details, path } = body;

    // Fallback: use path as details if not provided
    const finalDetails = details || path || "Unknown path";

    // Detect IP from headers
    const forwardedFor = req.headers.get("x-forwarded-for");
    const ip_address = forwardedFor
      ? forwardedFor.split(",")[0]?.trim() || null
      : req.headers.get("x-real-ip");
    const user_agent = req.headers.get("user-agent") || null;

    const success = await recordUserActivity({
      userId,
      action: action || "view_page",
      resourceType: resource_type || "page",
      resourceId: resource_id,
      details: finalDetails,
      ipAddress: ip_address,
      userAgent: user_agent,
    });

    if (!success) {
      return NextResponse.json(
        { error: "Failed to log activity" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error logging activity:", error);
    return NextResponse.json(
      { error: "Failed to log activity" },
      { status: 500 }
    );
  }
}
