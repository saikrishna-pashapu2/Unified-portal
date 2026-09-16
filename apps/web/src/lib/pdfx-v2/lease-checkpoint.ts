import { esgPrisma } from '@esgcredit/db-esg';
import { JobCancelledError, JobLeaseLostError } from '@/lib/jobs/queue';

type PdfTransaction = Pick<typeof esgPrisma, 'pdf_translation_v2_jobs' | 'pdf_translation_v2_pages'>;

/** Serialize checkpoint/accounting writes with queue claims. Checking ownership
 * and writing in separate transactions lets an expired worker overwrite its
 * replacement's progress and request reservations. */
export async function withPdfTranslationLease<T>(
  jobId: string,
  leaseOwner: string,
  write: (transaction: PdfTransaction) => Promise<T>,
): Promise<T> {
  return esgPrisma.$transaction(async transaction => {
    const rows = await transaction.$queryRaw<Array<{
      status: string; lease_owner: string | null; lease_valid: boolean; cancel_requested: boolean;
    }>>`
      SELECT status, lease_owner, lease_expires_at >= now() AS lease_valid, cancel_requested
      FROM background_jobs WHERE id = ${jobId}::uuid FOR UPDATE
    `;
    const row = rows[0];
    if (!row || row.status !== 'processing' || row.lease_owner !== leaseOwner || !row.lease_valid) {
      throw new JobLeaseLostError();
    }
    if (row.cancel_requested) throw new JobCancelledError();
    return write(transaction);
  });
}
