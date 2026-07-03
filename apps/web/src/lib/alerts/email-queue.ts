/**
 * Email Alert System Library
 * Handles email queue processing and sending
 */

import { esgPrisma } from "@esgcredit/db-esg";
import { env } from "@/lib/config/env";

export type EmailQueueItem = {
  id: number;
  user_id: number;
  email_to: string;
  email_subject: string;
  email_body: string;
  email_html: string | null;
  priority: number;
  scheduled_for: Date;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  last_attempt_at: Date | null;
  sent_at: Date | null;
  processed_by: string | null;
  created_at: Date;
  updated_at: Date;
  alert_type: string | null;
  domain: string | null;
  metadata: any;
};

/**
 * Get emails ready to be sent from the queue
 */
export async function getEmailsToSend(limit = 10): Promise<EmailQueueItem[]> {
  const emails = await esgPrisma.$queryRaw<EmailQueueItem[]>`
    SELECT * FROM email_queue
    WHERE status = 'queued'
      AND scheduled_for <= NOW()
      AND attempts < max_attempts
    ORDER BY priority DESC, scheduled_for ASC
    LIMIT ${limit}
  `;
  return emails;
}

/**
 * Mark email as processing
 */
export async function markEmailAsProcessing(
  emailId: number,
  workerId: string
): Promise<void> {
  await esgPrisma.$queryRaw`
    UPDATE email_queue
    SET status = 'processing',
        processed_by = ${workerId},
        updated_at = NOW()
    WHERE id = ${emailId}
  `;
}

/**
 * Mark email as sent successfully
 */
export async function markEmailAsSent(emailId: number): Promise<void> {
  await esgPrisma.$queryRaw`
    UPDATE email_queue
    SET status = 'sent',
        sent_at = NOW(),
        updated_at = NOW()
    WHERE id = ${emailId}
  `;

  // Update alert_history if exists
  await esgPrisma.$queryRaw`
    UPDATE alert_history
    SET email_status = 'sent',
        sent_at = NOW()
    WHERE email_subject = (
      SELECT email_subject FROM email_queue WHERE id = ${emailId}
    )
    AND email_status = 'pending'
  `;
}

/**
 * Mark email as failed with error message
 */
export async function markEmailAsFailed(
  emailId: number,
  errorMessage: string
): Promise<void> {
  await esgPrisma.$queryRaw`
    UPDATE email_queue
    SET status = 'failed',
        last_error = ${errorMessage},
        last_attempt_at = NOW(),
        attempts = attempts + 1,
        updated_at = NOW()
    WHERE id = ${emailId}
  `;

  // Check if max attempts reached
  const [email] = await esgPrisma.$queryRaw<EmailQueueItem[]>`
    SELECT * FROM email_queue WHERE id = ${emailId}
  `;

  if (email && email.attempts >= email.max_attempts) {
    // Update alert_history as permanently failed
    await esgPrisma.$queryRaw`
      UPDATE alert_history
      SET email_status = 'failed',
          error_message = ${errorMessage},
          retry_count = ${email.attempts}
      WHERE email_subject = ${email.email_subject}
        AND email_status = 'pending'
    `;
  }
}

/**
 * Retry failed email (requeue it)
 */
export async function requeueEmail(emailId: number): Promise<void> {
  await esgPrisma.$queryRaw`
    UPDATE email_queue
    SET status = 'queued',
        scheduled_for = NOW() + INTERVAL '5 minutes',
        updated_at = NOW()
    WHERE id = ${emailId}
      AND attempts < max_attempts
  `;
}

/**
 * Send email using Gmail SMTP via Nodemailer
 * FREE & UNLIMITED (within Gmail's 500 emails/day limit)
 * Works with all email providers including Outlook/Gmail/Yahoo
 * 
 * Setup:
 * 1. Add to .env file:
 *    MAIL_SERVER=smtp.gmail.com
 *    MAIL_PORT=587
 *    MAIL_USERNAME=alerts@example.com
 *    MAIL_PASSWORD=<app-password>
 *    MAIL_FROM=alerts@example.com
 * 2. Install nodemailer: npm install nodemailer
 * 3. Done! No API keys or signups needed
 */
export async function sendEmail(email: EmailQueueItem): Promise<boolean> {
  try {
    // Check if SMTP is configured
    if (!env.MAIL_USERNAME || !env.MAIL_PASSWORD) {
      console.warn("⚠️  Gmail SMTP not configured - email not sent");
      console.log(`📧 Would send to: ${email.email_to}`);
      console.log(`Subject: ${email.email_subject}`);
      
      // In development without credentials, just log and pretend it worked
      if (process.env.NODE_ENV === "development") {
        return true;
      }
      return false;
    }

    // Import nodemailer dynamically
    const nodemailer = await import("nodemailer");

    // Create reusable transporter using Gmail SMTP
    const transporter = nodemailer.default.createTransport({
      host: env.MAIL_SERVER,
      port: parseInt(env.MAIL_PORT),
      secure: false, // true for 465, false for other ports
      auth: {
        user: env.MAIL_USERNAME,
        pass: env.MAIL_PASSWORD,
      },
    });

    // Send email
    const info = await transporter.sendMail({
      from: env.MAIL_FROM, // sender address
      to: email.email_to, // recipient
      subject: email.email_subject,
      text: email.email_body, // plain text body
      html: email.email_html || email.email_body, // HTML body
    });

    console.log(`✅ Email sent successfully via Gmail - Message ID: ${info.messageId}`);
    return true;

  } catch (error: any) {
    console.error("❌ Failed to send email via Gmail SMTP:", error);
    
    // Log specific error details for debugging
    if (error.message) {
      console.error("Error message:", error.message);
    }
    if (error.code) {
      console.error("Error code:", error.code);
    }
    
    return false;
  }
}

/**
 * Process email queue - main worker function
 */
export async function processEmailQueue(
  workerId = "worker-1",
  batchSize = 10
): Promise<{
  processed: number;
  sent: number;
  failed: number;
}> {
  const stats = { processed: 0, sent: 0, failed: 0 };

  try {
    // Get emails to send
    const emails = await getEmailsToSend(batchSize);

    if (emails.length === 0) {
      console.log("📭 No emails in queue to process");
      return stats;
    }

    console.log(`📬 Processing ${emails.length} emails from queue...`);

    for (const email of emails) {
      stats.processed++;

      try {
        // Mark as processing
        await markEmailAsProcessing(email.id, workerId);

        // Send email
        const success = await sendEmail(email);

        if (success) {
          await markEmailAsSent(email.id);
          stats.sent++;
          console.log(`✅ Email ${email.id} sent successfully`);
        } else {
          throw new Error("Email sending failed");
        }
      } catch (error: any) {
        await markEmailAsFailed(email.id, error.message || "Unknown error");
        stats.failed++;
        console.error(`❌ Email ${email.id} failed:`, error.message);

        // Requeue if not at max attempts
        if (email.attempts + 1 < email.max_attempts) {
          await requeueEmail(email.id);
          console.log(`🔄 Email ${email.id} requeued for retry`);
        }
      }
    }

    console.log(
      `📊 Queue processing complete: ${stats.sent} sent, ${stats.failed} failed`
    );
  } catch (error) {
    console.error("❌ Error processing email queue:", error);
  }

  return stats;
}

/**
 * Clean up old processed emails from queue
 */
export async function cleanupEmailQueue(olderThanDays = 30): Promise<number> {
  const result = await esgPrisma.$queryRaw<{ count: bigint }[]>`
    WITH deleted AS (
      DELETE FROM email_queue
      WHERE status IN ('sent', 'failed')
        AND updated_at < NOW() - INTERVAL '${olderThanDays} days'
      RETURNING *
    )
    SELECT COUNT(*)::int AS count FROM deleted
  `;

  const count = Number(result[0]?.count || 0);
  console.log(`🧹 Cleaned up ${count} old emails from queue`);
  return count;
}

/**
 * Get queue statistics
 */
export async function getQueueStats() {
  const [stats] = await esgPrisma.$queryRaw<any[]>`
    SELECT 
      COUNT(*)::int AS total,
      COUNT(CASE WHEN status = 'queued' THEN 1 END)::int AS queued,
      COUNT(CASE WHEN status = 'processing' THEN 1 END)::int AS processing,
      COUNT(CASE WHEN status = 'sent' THEN 1 END)::int AS sent,
      COUNT(CASE WHEN status = 'failed' THEN 1 END)::int AS failed,
      COUNT(CASE WHEN status = 'cancelled' THEN 1 END)::int AS cancelled,
      MIN(CASE WHEN status = 'queued' THEN scheduled_for END) AS next_scheduled
    FROM email_queue
  `;

  return stats || {
    total: 0,
    queued: 0,
    processing: 0,
    sent: 0,
    failed: 0,
    cancelled: 0,
    next_scheduled: null,
  };
}
