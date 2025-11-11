import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import { getPrisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userEmail = session.user.email;
    const historyId = parseInt(params.id);
    const prisma = getPrisma("credit");

    // Get the history record
    const history = await prisma.fitch_upload_history.findFirst({
      where: {
        id: historyId,
        user_email: userEmail, // Ensure user owns this upload
      },
    });

    if (!history) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Return the file data from database
    return new NextResponse(history.file_data as any, {
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${history.updated_filename}"`,
      },
    });
  } catch (err: any) {
    console.error("History download error:", err);
    return NextResponse.json(
      { error: "Failed to download file" },
      { status: 500 }
    );
  }
}
