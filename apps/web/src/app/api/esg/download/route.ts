import { NextResponse } from "next/server";
import { ESG_JOBS } from "../upload/jobstore";
import { esgPrisma } from "@esgcredit/db-esg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("jobId") || "";
  
  // First try in-memory job
  const job = ESG_JOBS.get(id);
  if (job && job.status === "done" && job.buffer) {
    return new NextResponse(new Uint8Array(job.buffer), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${job.filename ?? `esg_updated_${id}.xlsx`}"`,
        "cache-control": "no-store"
      }
    });
  }
  
  // Fallback to database
  try {
    const dbJob = await esgPrisma.file_uploads.findUnique({ 
      where: { task_id: id },
      select: {
        status: true,
        output_filename: true,
        file_data: true,
      }
    });
    
    if (!dbJob || dbJob.status !== "done" || !dbJob.file_data) {
      return NextResponse.json({ error: "File not ready for download" }, { status: 400 });
    }
    
    // Convert Buffer to Uint8Array for NextResponse
    const fileBuffer = new Uint8Array(dbJob.file_data);
    
    return new NextResponse(fileBuffer, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${dbJob.output_filename ?? `esg_updated_${id}.xlsx`}"`,
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    console.error("Download error:", error);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}