import { NextResponse } from "next/server";
import { JOBS, Job } from "./jobstore";
import * as XLSX from "xlsx";
import { getSlug, getCompany } from "@/lib/fitch";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import { creditPrisma } from "@esgcredit/db-credit";

export const runtime = "nodejs";         // ensure Node runtime (not Edge)
export const dynamic = "force-dynamic";  // disable static optimization

function uid() {
  return Math.random().toString(36).slice(2, 12);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userEmail = session?.user?.email || null;

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

  const originalFilename = file.name;
  const job: Job = { id: uid(), status: "queued", createdAt: Date.now() };
  JOBS.set(job.id, job);

  // process asynchronously
  (async () => {
    let successCount = 0;
    let errorCount = 0;
    let companiesCount = 0;
    
    try {
      job.status = "processing";

      const arrayBuffer = await file.arrayBuffer();
      const wb = XLSX.read(Buffer.from(arrayBuffer), { type: "buffer" });

      const wsName = wb.SheetNames[0];
      const ws = wb.Sheets[wsName];

      // header row as array
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
      if (rows.length === 0) throw new Error("Empty sheet");

      const headers = rows[0].map((h: any) => String(h).trim().toLowerCase());
      // accept Company or Company Name
      const companyIdx = headers.findIndex((h: string) =>
        ["company", "company name"].includes(h)
      );
      if (companyIdx === -1) {
        throw new Error('Missing "Company" or "Company Name" column');
      }

      // Define all the columns we want to add
      const outputHeaders = [...rows[0]];
      const ensureCol = (name: string) => {
        if (!outputHeaders.includes(name)) outputHeaders.push(name);
      };
      
      // Add all Fitch data columns
      ensureCol("Fitch Name");
      ensureCol("Fitch Slug");
      ensureCol("Rating Code");
      ensureCol("Rating Action");
      ensureCol("Rating Change Date");
      ensureCol("Rating Type");
      ensureCol("Rating Alert Code");
      ensureCol("RAC Count");
      ensureCol("Latest RAC Title");
      ensureCol("Latest RAC Slug");

      // Get column indices
      const fitchNameIdx = outputHeaders.indexOf("Fitch Name");
      const fitchSlugIdx = outputHeaders.indexOf("Fitch Slug");
      const ratingCodeIdx = outputHeaders.indexOf("Rating Code");
      const ratingActionIdx = outputHeaders.indexOf("Rating Action");
      const ratingChangeDateIdx = outputHeaders.indexOf("Rating Change Date");
      const ratingTypeIdx = outputHeaders.indexOf("Rating Type");
      const ratingAlertCodeIdx = outputHeaders.indexOf("Rating Alert Code");
      const racCountIdx = outputHeaders.indexOf("RAC Count");
      const latestRacTitleIdx = outputHeaders.indexOf("Latest RAC Title");
      const latestRacSlugIdx = outputHeaders.indexOf("Latest RAC Slug");

      const output = [outputHeaders];

      // Count total companies to process
      const totalCompanies = rows.slice(1).filter(r => String(r[companyIdx]).trim()).length;
      let processedCount = 0;

      // Process each company with delay to avoid rate limiting
      for (let i = 1; i < rows.length; i++) {
        const r = [...rows[i]];
        
        // Ensure row has enough columns
        while (r.length < outputHeaders.length) {
          r.push("");
        }
        
        const companyName = String(r[companyIdx]).trim();
        if (!companyName) { 
          output.push(r); 
          continue; 
        }

        try {
          // Update progress
          processedCount++;
          job.progress = {
            current: processedCount,
            total: totalCompanies,
            currentCompany: companyName
          };

          // Add delay between requests to avoid rate limiting (500ms)
          if (i > 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }

          // Get slug from company name
          const slugInfo = await getSlug(companyName);
          
          if (!slugInfo) {
            // Company not found
            r[fitchNameIdx] = "Not Found";
            r[fitchSlugIdx] = "";
            r[ratingCodeIdx] = "";
            r[ratingActionIdx] = "";
            r[ratingChangeDateIdx] = "";
            r[ratingTypeIdx] = "";
            r[ratingAlertCodeIdx] = "";
            r[racCountIdx] = "0";
            r[latestRacTitleIdx] = "";
            r[latestRacSlugIdx] = "";
            output.push(r);
            continue;
          }

          // Get company details
          const details = await getCompany(slugInfo.slug);
          
          if (!details) {
            r[fitchNameIdx] = slugInfo.name;
            r[fitchSlugIdx] = slugInfo.slug;
            r[ratingCodeIdx] = "No Data";
            r[ratingActionIdx] = "";
            r[ratingChangeDateIdx] = "";
            r[ratingTypeIdx] = "";
            r[ratingAlertCodeIdx] = "";
            r[racCountIdx] = "0";
            r[latestRacTitleIdx] = "";
            r[latestRacSlugIdx] = "";
            output.push(r);
            continue;
          }

          // Fill in all the data
          r[fitchNameIdx] = details.name || slugInfo.name;
          r[fitchSlugIdx] = slugInfo.slug;
          
          // Latest rating info
          const latestRating = details.ratings?.[0];
          r[ratingCodeIdx] = latestRating?.ratingCode || "";
          r[ratingActionIdx] = latestRating?.ratingActionDescription || "";
          r[ratingChangeDateIdx] = latestRating?.ratingChangeDate || "";
          r[ratingTypeIdx] = latestRating?.ratingTypeDescription || "";
          r[ratingAlertCodeIdx] = latestRating?.ratingAlertCode || "";
          
          // RAC info
          const racRows = details.latestRAC?.rows || [];
          r[racCountIdx] = String(racRows.length);
          r[latestRacTitleIdx] = racRows[0]?.title || "";
          r[latestRacSlugIdx] = racRows[0]?.slug || "";

          successCount++;

        } catch (err: any) {
          console.error(`Error processing company "${companyName}":`, err);
          
          errorCount++;
          
          // Mark as error but provide details
          r[fitchNameIdx] = "Error";
          r[fitchSlugIdx] = "";
          r[ratingCodeIdx] = "";
          r[ratingActionIdx] = err.message || "Processing error";
          r[ratingChangeDateIdx] = "";
          r[ratingTypeIdx] = "";
          r[ratingAlertCodeIdx] = "";
          r[racCountIdx] = "0";
          r[latestRacTitleIdx] = "";
          r[latestRacSlugIdx] = "";
        }

        output.push(r);
      }

      const outWs = XLSX.utils.aoa_to_sheet(output);
      const outWb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(outWb, outWs, wsName || "Sheet1");

      // WRITE TO BUFFER
      const outBuffer = XLSX.write(outWb, { type: "buffer", bookType: "xlsx" }) as Buffer;

      const updatedFilename = `fitch_${job.id}_${Date.now()}.xlsx`;

      // Save to database history
      if (userEmail) {
        try {
          await creditPrisma.fitch_upload_history.create({
            data: {
              user_email: userEmail,
              original_filename: originalFilename,
              updated_filename: updatedFilename,
              file_data: outBuffer,
              companies_count: companiesCount,
              success_count: successCount,
              error_count: errorCount,
              file_size: outBuffer.length,
            }
          });
        } catch (dbErr) {
          console.error("Failed to save upload history:", dbErr);
        }
      }

      job.buffer = outBuffer;
      job.filename = updatedFilename;
      job.status = "done";
    } catch (err: any) {
      job.status = "error";
      job.error = `Excel processing error: ${err?.message || String(err)}`;
      console.error("Excel processing error:", err);
    }
  })();

  return NextResponse.json({ jobId: job.id });
}