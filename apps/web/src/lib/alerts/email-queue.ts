import { esgPrisma } from "@esgcredit/db-esg";
import { env } from "@/lib/config/env";

export type EmailQueueItem = {
  id: number;
  user_id: number | null;
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
  metadata: unknown;
  alert_history_id: number | null;
  lease_expires_at: Date | null;
  heartbeat_at: Date | null;
  provider_message_id: string | null;
  idempotency_key: string;
};

export type EnqueueEmailResult = {
  queueId: number | null;
  historyId: number;
  deduplicated: boolean;
};

export type EmailEnqueueTransaction = Pick<typeof esgPrisma, "$queryRaw">;

export async function enqueueEmailWithHistory(args: {
  userId: number | null;
  to: string;
  subject: string;
  text: string;
  html?: string;
  domain: string;
  alertType: string;
  contentType?: string;
  contentIds?: number[];
  totalItems?: number;
  priority?: number;
  metadata?: unknown;
  /** Stable logical-delivery identifier. Reusing it never queues a second email. */
  deliveryKey?: string;
  templateVersion?: string;
  jobId?: string;
}, existingTransaction?: EmailEnqueueTransaction): Promise<EnqueueEmailResult> {
  if (args.userId !== null && (!Number.isSafeInteger(args.userId) || args.userId <= 0)) {
    throw new RangeError("userId must be a positive integer or null");
  }

  const deliveryKey = boundedOptionalValue(args.deliveryKey, 180, "deliveryKey");
  const templateVersion = boundedOptionalValue(args.templateVersion, 10, "templateVersion");
  const jobId = boundedOptionalValue(args.jobId, 100, "jobId");
  const contentIds = args.contentIds ?? [];
  const metadataJson = serializeMetadata(args.metadata);

  // Scheduled digests poll throughout the week. An already recorded delivery
  // needs only a read, even when its queue row has since been cleaned up.
  if (deliveryKey) {
    const existing = await findEmailDelivery(existingTransaction ?? esgPrisma, deliveryKey);
    if (existing) return existing;
  }

  const enqueue = async (transaction: EmailEnqueueTransaction): Promise<EnqueueEmailResult> => {
    const insertedHistory = await transaction.$queryRaw<Array<{ id: number }>>`
      INSERT INTO alert_history (
        user_id, domain, alert_type, content_type, content_ids, email_to,
        email_subject, email_status, total_items, template_version, job_id,
        delivery_key
      ) VALUES (
        ${args.userId}::integer,
        ${args.domain},
        ${args.alertType},
        ${args.contentType ?? null}::varchar,
        ${contentIds}::integer[],
        ${args.to},
        ${args.subject},
        'pending',
        ${args.totalItems ?? contentIds.length}::integer,
        ${templateVersion}::varchar,
        ${jobId}::varchar,
        ${deliveryKey}::varchar
      )
      ON CONFLICT (delivery_key) DO NOTHING
      RETURNING id
    `;

    const history = insertedHistory[0];
    if (history) {
      const insertedQueue = await transaction.$queryRaw<Array<{ id: number }>>`
        INSERT INTO email_queue (
          user_id, email_to, email_subject, email_body, email_html, priority,
          scheduled_for, status, alert_type, domain, metadata, alert_history_id
        ) VALUES (
          ${args.userId}::integer,
          ${args.to},
          ${args.subject},
          ${args.text},
          ${args.html ?? null}::text,
          ${args.priority ?? 5}::integer,
          now(),
          'queued',
          ${args.alertType}::varchar,
          ${args.domain}::varchar,
          ${metadataJson}::jsonb,
          ${history.id}::integer
        )
        RETURNING id
      `;
      const queue = insertedQueue[0];
      if (!queue) throw new Error("Email queue insert did not return a row");
      return {
        queueId: queue.id,
        historyId: history.id,
        deduplicated: false,
      };
    }

    // The only caller-controlled conflict is the optional unique delivery key.
    // Looking up the committed winner makes concurrent scheduler replicas safe.
    if (!deliveryKey) {
      throw new Error("Email history insert conflicted without a delivery key");
    }
    const existing = await findEmailDelivery(transaction, deliveryKey);
    if (!existing) throw new Error("Deduplicated email history could not be loaded");
    return existing;
  };
  // Weekly assembly can hold preference/feedback locks through the email snapshot.
  return existingTransaction ? enqueue(existingTransaction) : esgPrisma.$transaction(enqueue);
}

async function findEmailDelivery(
  database: Pick<typeof esgPrisma, "$queryRaw">,
  deliveryKey: string,
): Promise<EnqueueEmailResult | null> {
  const [existing] = await database.$queryRaw<Array<{ history_id: number; queue_id: number | null }>>`
    SELECT h.id AS history_id, q.id AS queue_id
    FROM alert_history h
    LEFT JOIN email_queue q ON q.alert_history_id = h.id
    WHERE h.delivery_key = ${deliveryKey}
    LIMIT 1
  `;
  return existing ? {
    queueId: existing.queue_id,
    historyId: existing.history_id,
    deduplicated: true,
  } : null;
}

function boundedOptionalValue(
  value: string | undefined,
  maximumLength: number,
  field: string,
): string | null {
  if (value === undefined) return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) {
    throw new RangeError(`${field} must contain 1-${maximumLength} characters`);
  }
  return normalized;
}

function serializeMetadata(metadata: unknown): string | null {
  if (metadata === undefined) return null;
  const serialized = JSON.stringify(metadata);
  if (serialized === undefined) {
    throw new TypeError("metadata must be JSON serializable");
  }
  return serialized;
}

/** Atomically claims queued work and expired leases across all worker replicas. */
export async function claimEmailsToSend(
  workerId: string,
  limit = 10,
  leaseSeconds = 300,
): Promise<EmailQueueItem[]> {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const safeLease = Math.max(60, Math.min(leaseSeconds, 900));
  await esgPrisma.$executeRaw`
    WITH exhausted AS (
      UPDATE email_queue
      SET status = 'failed', lease_expires_at = NULL,
          last_error = COALESCE(last_error, 'Worker lease expired after final attempt'),
          updated_at = now()
      WHERE status = 'processing'
        AND COALESCE(attempts, 0) >= COALESCE(max_attempts, 3)
        AND (lease_expires_at IS NULL OR lease_expires_at < now())
      RETURNING alert_history_id, attempts, last_error
    )
    UPDATE alert_history
    SET email_status = 'failed', error_message = exhausted.last_error,
        retry_count = exhausted.attempts
    FROM exhausted
    WHERE alert_history.id = exhausted.alert_history_id
  `;
  return esgPrisma.$queryRaw<EmailQueueItem[]>`
    WITH candidates AS (
      SELECT id
      FROM email_queue
      WHERE (
        (status = 'queued' AND scheduled_for <= now())
        OR (status = 'processing' AND (lease_expires_at IS NULL OR lease_expires_at < now()))
      )
        AND COALESCE(attempts, 0) < COALESCE(max_attempts, 3)
      ORDER BY priority DESC, scheduled_for ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${safeLimit}
    )
    UPDATE email_queue AS email
    SET status = 'processing',
        attempts = COALESCE(email.attempts, 0) + 1,
        processed_by = ${workerId},
        lease_expires_at = now() + (${safeLease} * INTERVAL '1 second'),
        heartbeat_at = now(),
        last_attempt_at = now(),
        updated_at = now()
    FROM candidates
    WHERE email.id = candidates.id
    RETURNING email.*
  `;
}

export async function heartbeatEmail(
  emailId: number,
  workerId: string,
  leaseSeconds = 300,
): Promise<boolean> {
  const safeLease = Math.max(60, Math.min(leaseSeconds, 900));
  const changed = await esgPrisma.$executeRaw`
    UPDATE email_queue
    SET heartbeat_at = now(),
        lease_expires_at = now() + (${safeLease} * INTERVAL '1 second'),
        updated_at = now()
    WHERE id = ${emailId} AND status = 'processing' AND processed_by = ${workerId}
  `;
  return changed > 0;
}

export async function markEmailAsSent(
  emailId: number,
  workerId: string,
  providerMessageId: string,
): Promise<boolean> {
  const rows = await esgPrisma.$queryRaw<Array<{ id: number }>>`
    WITH sent AS (
      UPDATE email_queue
      SET status = 'sent', sent_at = now(), provider_message_id = ${providerMessageId},
          last_error = NULL, lease_expires_at = NULL, heartbeat_at = now(),
          updated_at = now()
      WHERE id = ${emailId} AND status = 'processing' AND processed_by = ${workerId}
      RETURNING id, alert_history_id, attempts
    ), history AS (
      UPDATE alert_history
      SET email_status = 'sent', sent_at = now(), error_message = NULL,
          retry_count = sent.attempts
      FROM sent
      WHERE alert_history.id = sent.alert_history_id
      RETURNING alert_history.id
    )
    SELECT id FROM sent
  `;
  return rows.length > 0;
}

export async function markEmailAsFailed(
  email: EmailQueueItem,
  workerId: string,
  errorMessage: string,
): Promise<"queued" | "failed"> {
  const retry = email.attempts < email.max_attempts;
  const delaySeconds = Math.min(3600, 60 * 2 ** Math.max(0, email.attempts - 1));
  const status = retry ? "queued" : "failed";
  await esgPrisma.$executeRaw`
    WITH failed AS (
      UPDATE email_queue
      SET status = ${status},
          last_error = ${errorMessage.slice(0, 10_000)},
          scheduled_for = CASE
            WHEN ${retry} THEN now() + (${delaySeconds} * INTERVAL '1 second')
            ELSE scheduled_for
          END,
          lease_expires_at = NULL,
          updated_at = now()
      WHERE id = ${email.id} AND status = 'processing' AND processed_by = ${workerId}
      RETURNING alert_history_id, attempts
    )
    UPDATE alert_history
    SET email_status = 'failed', error_message = ${errorMessage.slice(0, 10_000)},
        retry_count = failed.attempts
    FROM failed
    WHERE ${!retry} AND alert_history.id = failed.alert_history_id
  `;
  return status;
}

export async function sendEmail(email: EmailQueueItem): Promise<string> {
  if (!env.MAIL_USERNAME || !env.MAIL_PASSWORD) {
    if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
      return `<portal-email-${email.id}-${email.idempotency_key}@local.invalid>`;
    }
    throw new Error("SMTP is not configured");
  }

  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.default.createTransport({
    host: env.MAIL_SERVER,
    port: Number.parseInt(env.MAIL_PORT, 10),
    secure: Number.parseInt(env.MAIL_PORT, 10) === 465,
    connectionTimeout: 30_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    auth: { user: env.MAIL_USERNAME, pass: env.MAIL_PASSWORD },
  });
  const mailFrom = env.MAIL_FROM || env.MAIL_USERNAME;
  const stableMessageId = `<portal-email-${email.id}-${email.idempotency_key}@${emailDomain(mailFrom)}>`;
  const info = await transporter.sendMail({
    messageId: stableMessageId,
    from: mailFrom,
    to: email.email_to,
    subject: email.email_subject,
    text: email.email_body,
    html: email.email_html || email.email_body,
  });
  return info.messageId || stableMessageId;
}

export async function processEmailQueue(
  workerId = "email-worker",
  batchSize = 10,
): Promise<{ processed: number; sent: number; failed: number }> {
  const stats = { processed: 0, sent: 0, failed: 0 };
  const emails = await claimEmailsToSend(workerId, batchSize);

  for (const email of emails) {
    stats.processed += 1;
    try {
      await heartbeatEmail(email.id, workerId);
      const messageId = await sendEmail(email);
      if (!(await markEmailAsSent(email.id, workerId, messageId))) {
        throw new Error("Email lease was lost before completion");
      }
      stats.sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown email error";
      await markEmailAsFailed(email, workerId, message);
      stats.failed += 1;
    }
  }
  return stats;
}

export async function cleanupEmailQueue(olderThanDays = 30): Promise<number> {
  const safeDays = Math.max(1, Math.min(olderThanDays, 365));
  const result = await esgPrisma.$queryRaw<Array<{ count: number }>>`
    WITH deleted AS (
      DELETE FROM email_queue
      WHERE status IN ('sent', 'failed')
        AND updated_at < now() - (${safeDays} * INTERVAL '1 day')
      RETURNING id
    )
    SELECT COUNT(*)::int AS count FROM deleted
  `;
  return Number(result[0]?.count ?? 0);
}

export async function getQueueStats() {
  const [stats] = await esgPrisma.$queryRaw<any[]>`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
      COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
      COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
      COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
      COUNT(*) FILTER (WHERE status = 'processing' AND lease_expires_at < now())::int AS stale,
      MIN(scheduled_for) FILTER (WHERE status = 'queued') AS next_scheduled
    FROM email_queue
  `;
  return stats ?? {
    total: 0,
    queued: 0,
    processing: 0,
    sent: 0,
    failed: 0,
    cancelled: 0,
    stale: 0,
    next_scheduled: null,
  };
}

function emailDomain(from: string): string {
  const domain = from.split("@").pop()?.replace(/[^a-z0-9.-]/gi, "");
  return domain || "portal.local";
}
