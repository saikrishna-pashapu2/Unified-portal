import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import { creditPrisma } from "@esgcredit/db-credit";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userEmail = session.user.email;
    const { id } = await params;
    const historyId = parseInt(id);

    // Get the history record
    const history = await creditPrisma.fitch_upload_history.findFirst({
      where: {
        id: historyId,
        user_email: userEmail, // Ensure user owns this upload
      },
    });

    if (!history) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Parse Excel file to JSON
    const workbook = XLSX.read(history.file_data, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    return NextResponse.json({
      filename: history.updated_filename,
      sheetName,
      data,
      metadata: {
        original_filename: history.original_filename,
        companies_count: history.companies_count,
        success_count: history.success_count,
        error_count: history.error_count,
        created_at: history.created_at,
      }
    });
  } catch (err: any) {
    console.error("History view error:", err);
    return NextResponse.json(
      { error: "Failed to load file" },
      { status: 500 }
    );
  }
}
