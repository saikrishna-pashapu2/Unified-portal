
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import { esgPrisma } from "@esgcredit/db-esg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!(session as any)?.is_admin) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }

        const { searchParams } = new URL(req.url);
        const limit = parseInt(searchParams.get("limit") || "50");

        type ActivityLogRow = {
            id: number;
            action: string;
            resource_type: string | null;
            resource_id: number | null;
            details: string | null;
            ip_address: string | null;
            created_at: Date;
            users?: {
                id: number;
                email: string | null;
                first_name: string | null;
                last_name: string | null;
            } | null;
        };

        const logs = await (esgPrisma as any).user_activity.findMany({
            take: limit,
            orderBy: { created_at: "desc" },
            include: {
                users: {
                    select: {
                        id: true,
                        email: true,
                        first_name: true,
                        last_name: true
                    }
                }
            }
        }) as ActivityLogRow[];

        // Enhance logs with user details from ESG DB (where users table lives usually)
        // Wait, schematic showed users in BOTH credit and esg DBs.
        // Usually user table is shared or replicated. Let's assume user IDs match.
        // We can fetch user details.

        const enrichedLogs = logs.map((log: ActivityLogRow) => ({
            ...log,
            user: log.users || { email: 'Unknown', first_name: 'Unknown', last_name: '' }
        }));

        return NextResponse.json(enrichedLogs);
    } catch (error: any) {
        console.error("Error fetching activity logs:", error);
        return NextResponse.json(
            { error: "Failed to fetch activity logs" },
            { status: 500 }
        );
    }
}
