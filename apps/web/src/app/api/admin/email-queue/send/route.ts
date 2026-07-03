import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import { esgPrisma } from "@esgcredit/db-esg";
import { env } from "@/lib/config/env";
import nodemailer from "nodemailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/email-queue/send
 * Manually send an email (bypassing queue system)
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!(session as any)?.is_admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await req.json();
    const { to, subject, htmlBody, userId } = body;

    // Validate inputs
    if (!to || !subject || !htmlBody) {
      return NextResponse.json(
        { error: "Missing required fields: to, subject, htmlBody" },
        { status: 400 }
      );
    }

    // Create email queue entry
    const queueEntry = await esgPrisma.email_queue.create({
      data: {
        user_id: userId || null,
        email_to: to,
        email_subject: subject,
        email_body: htmlBody,
        status: "processing",
        alert_type: "manual",
        scheduled_for: new Date(),
      },
    });

    // Send email
    try {
      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        auth: {
          user: env.EMAIL_USER,
          pass: env.EMAIL_PASS,
        },
      });

      await transporter.sendMail({
        from: `"ESG Portal" <${env.EMAIL_USER}>`,
        to,
        subject,
        html: htmlBody,
      });

      // Update queue entry as sent
      await esgPrisma.email_queue.update({
        where: { id: queueEntry.id },
        data: {
          status: "sent",
          sent_at: new Date(),
          last_attempt_at: new Date(),
          attempts: 1,
        },
      });

      return NextResponse.json({
        success: true,
        message: "Email sent successfully",
        queueId: queueEntry.id,
      });
    } catch (emailError: any) {
      console.error("Error sending email:", emailError);

      // Update queue entry as failed
      await esgPrisma.email_queue.update({
        where: { id: queueEntry.id },
        data: {
          status: "failed",
          last_error: emailError.message,
          last_attempt_at: new Date(),
          attempts: 1,
        },
      });

      return NextResponse.json(
        {
          error: "Failed to send email",
          details: emailError.message,
          queueId: queueEntry.id,
        },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error("Error in manual email send:", error);
    return NextResponse.json(
      { error: error.message || "Failed to send email" },
      { status: 500 }
    );
  }
}
