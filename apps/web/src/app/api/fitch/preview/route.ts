import { NextResponse } from "next/server";
import { JOBS } from "../upload/jobstore";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("jobId") ?? "";
  const job = JOBS.get(id);
  
  if (!job || job.status !== "done" || !job.buffer) {
    return NextResponse.json({ error: "Not ready" }, { status: 400 });
  }

  try {
    // Parse Excel buffer to JSON
    const workbook = XLSX.read(job.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    return NextResponse.json({
      filename: job.filename,
      sheetName,
      data,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to parse Excel" },
      { status: 500 }
    );
  }
}
