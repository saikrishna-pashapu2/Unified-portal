import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { ESG_JOBS, type EsgJob } from "./jobstore";
import { esgPrisma } from "@esgcredit/db-esg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uid = () => Math.random().toString(36).slice(2, 12);

async function insertRow(job: EsgJob, original_filename: string, userId: string | null) {
  // Only include user_id if it's provided and valid
  const data: any = {
    task_id: job.id,
    original_filename,
    status: job.status,
    stored_filename: "",      // we're keeping in memory; keep empty or save temp path if you choose
    output_filename: "",
  };

  // Only add user_id if it's provided (avoid FK constraint error)
  if (userId && userId !== "anon") {
    const parsedUserId = parseInt(userId);
    if (!isNaN(parsedUserId)) {
      data.user_id = parsedUserId;
    }
  }

  await esgPrisma.file_uploads.create({ data });
}

async function updateRow(job: EsgJob, patch: Partial<{status: string, error_message: string, output_filename: string, file_data: Buffer}>) {
  const updateData: any = {
    status: patch.status,
    error_message: patch.error_message,
    output_filename: patch.output_filename,
    updated_at: new Date(),
  };

  // Only include file_data if it's provided
  if (patch.file_data) {
    updateData.file_data = patch.file_data;
  }

  await esgPrisma.file_uploads.update({
    where: { task_id: job.id },
    data: updateData,
  });
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const userId = form.get("userId") ? String(form.get("userId")) : null; // Only use userId if provided

    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

    const job: EsgJob = {
      id: uid(),
      userId,
      status: "queued",
      progress: 0,
      createdAt: Date.now(),
    };
    ESG_JOBS.set(job.id, job);
    console.log(`Created job ${job.id} in memory`);

    await insertRow(job, file.name ?? "upload.xlsx", userId);

    // Start processing in the background
    (async () => {
      try {
        job.status = "processing";
        console.log(`Job ${job.id} starting processing`);
        await updateRow(job, { status: "processing" });

        const buf = Buffer.from(await file.arrayBuffer());
        const wb = XLSX.read(buf, { type: "buffer" });
        const wsName = wb.SheetNames[0];
        const ws = wb.Sheets[wsName];

        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
        job.rowsTotal = Math.max(rows.length - 1, 0);
        job.rowsDone = 0;

        // Detect company column
        const headers = (rows[0] || []).map(String);
        const lower = headers.map(h => h.toLowerCase());
        let companyIdx = lower.findIndex(h => h === "company" || h === "company name" || h.includes("company"));
        if (companyIdx === -1) companyIdx = 0;

        // Add target columns if missing (S&P, ISS, LSEG)
        const ensureCol = (name: string) => {
          if (!headers.includes(name)) { 
            headers.push(name); 
            rows[0].push(name); 
          }
          return headers.indexOf(name);
        };
        const snpCol = ensureCol("S&P ESG");
        const issCol = ensureCol("ISS (oekom)");
        const lsegCol = ensureCol("LSEG (TR.TRESG)");

        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

        // Process row by row with progress + cancel
        for (let r = 1; r < rows.length; r++) {
          if (job.cancelled) break;

          const name = String(rows[r][companyIdx] ?? "").trim();
          if (!name) { 
            job.rowsDone!++; 
            job.progress = Math.floor((job.rowsDone! / (job.rowsTotal || 1)) * 100);
            continue; 
          }

          // Call the source APIs to get ESG data
          const [snp, iss, lseg] = await Promise.allSettled([
            fetch(`${baseUrl}/api/esg/source/snp?name=${encodeURIComponent(name)}`).then(r => r.json()),
            fetch(`${baseUrl}/api/esg/source/iss?name=${encodeURIComponent(name)}`).then(r => r.json()),
            fetch(`${baseUrl}/api/esg/source/lseg?name=${encodeURIComponent(name)}`).then(r => r.json()),
          ]);

          // Extract scores and populate the Excel cells
          rows[r][snpCol] = (snp as any)?.value?.esg_score ?? "-";
          rows[r][issCol] = (iss as any)?.value?.oekomRating ?? "-";
          rows[r][lsegCol] = (lseg as any)?.value?.["TR.TRESG"] ?? "-";

          job.rowsDone!++;
          job.progress = Math.floor((job.rowsDone! / (job.rowsTotal || 1)) * 100);
          
          // Update database every 10 rows for better status sync
          if (job.rowsDone! % 10 === 0) {
            try {
              await updateRow(job, { status: "processing" });
            } catch (dbError) {
              console.error("Database update error:", dbError);
            }
          }
        }

        // Build workbook to buffer and save to disk
        const outWs = XLSX.utils.aoa_to_sheet(rows);
        const outWb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(outWb, outWs, wsName || "Sheet1");
        const outBuffer = XLSX.write(outWb, { type: "buffer", bookType: "xlsx" }) as Buffer;

        if (job.cancelled) {
          job.status = "cancelled";
          job.buffer = undefined;
          job.filename = undefined;
          await updateRow(job, { status: "cancelled" });
          return;
        }

        // Generate filename for reference
        const filename = `esg_updated_${job.id}_${Date.now()}.xlsx`;

        job.buffer = outBuffer; // Keep in memory for immediate access
        job.filename = filename;
        job.status = "done";
        job.progress = 100;
        
        // Save file to database instead of disk
        await updateRow(job, { 
          status: "done", 
          output_filename: filename,
          file_data: outBuffer 
        });
      } catch (e: any) {
        console.error("Excel processing error:", e);
        job.status = "error";
        job.error = e?.message || "Processing error";
        await updateRow(job, { status: "error", error_message: job.error });
      }
    })();

    return NextResponse.json({ jobId: job.id });
  } catch (error: any) {
    console.error("Upload API error:", error);
    return NextResponse.json(
      { error: error.message || "Upload failed" },
      { status: 500 }
    );
  }
}