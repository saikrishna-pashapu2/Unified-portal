import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock('@esgcredit/db-esg', () => ({ esgPrisma: { $queryRaw: mocks.query, $executeRaw: mocks.execute } }));

import { BACKGROUND_JOB_TYPES, claimBackgroundJobs, countActiveJobs, enqueueBackgroundJob, isEsgDriverQueueType, reconcileEsgDriverDomainJobs } from './queue';

const jobId = '4c4ebf2b-a9e5-4f40-b633-740ee43ea7ec';
const queryText = (call: unknown[]) => (call[0] as TemplateStringsArray).join('?');

beforeEach(() => {
  mocks.query.mockReset().mockResolvedValue([]);
  mocks.execute.mockReset().mockResolvedValue(1);
});

describe('category-balanced ESG queue fencing', () => {
  it('registers the current and older ESG queue types without changing unrelated queues', () => {
    expect(BACKGROUND_JOB_TYPES).toContain('esg_driver_excel_v8');
    expect(BACKGROUND_JOB_TYPES).toContain('esg_driver_excel_v7');
    expect(BACKGROUND_JOB_TYPES).toContain('esg_driver_excel_v6');
    expect(BACKGROUND_JOB_TYPES).toContain('esg_driver_excel_v5');
    expect(BACKGROUND_JOB_TYPES).toContain('xlsx_translation_v1');
    expect(BACKGROUND_JOB_TYPES).toContain('pdf_translation_v6');
    expect(isEsgDriverQueueType('esg_driver_excel_v8')).toBe(true);
    expect(isEsgDriverQueueType('esg_driver_excel_v6')).toBe(true);
    expect(isEsgDriverQueueType('pdf_translation_v6')).toBe(false);
  });

  it('keeps the production worker on v5 through v8 ESG Driver routes', () => {
    const worker = readFileSync(
      fileURLToPath(new URL('../../esg-driver-worker.mts', import.meta.url)),
      'utf8',
    );
    expect(worker).toContain('? (["esg_driver_excel_v5", "esg_driver_excel_v6", "esg_driver_excel_v7", "esg_driver_excel_v8"] as const)');
    expect(worker).toContain('jobType === "esg_driver_excel_v6"');
    expect(worker).toContain('jobType === "esg_driver_excel_v8"');
  });

  it('shares the user concurrency lock and active-job limit across old and balanced queue versions', async () => {
    mocks.query.mockResolvedValueOnce([{ id: 'existing-job' }]);
    await expect(enqueueBackgroundJob({ id: jobId, userId: 7, jobType: 'esg_driver_excel_v6', payload: {} })).rejects.toThrow();
    expect(queryText(mocks.execute.mock.calls[0])).toContain("hashtext('esg_driver')");
    const activeQuery = queryText(mocks.query.mock.calls[0]);
    expect(activeQuery).toContain("'esg_driver_excel_v5'");
    expect(activeQuery).toContain("'esg_driver_excel_v6'");
    expect(activeQuery).toContain("'esg_driver_excel_v8'");
    expect(mocks.execute.mock.calls.some((call) => queryText(call).includes('INSERT INTO background_jobs'))).toBe(false);
  });

  it.each(['esg_driver_excel_v5', 'esg_driver_excel_v6', 'esg_driver_excel_v7', 'esg_driver_excel_v8'] as const)('rejects the specialized legacy worker for %s before touching the database', async (type) => {
    await expect(claimBackgroundJobs('legacy', 1, 90, [type], 'esg_driver')).rejects.toThrow('unversioned');
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('claims a new queue with the generic lease fence and propagates cancelled jobs to the domain', async () => {
    mocks.query.mockResolvedValueOnce([{ id: jobId, job_type: 'esg_driver_excel_v8', user_id: 7 }]);
    await claimBackgroundJobs('worker', 1, 90, ['esg_driver_excel_v8'], 'generic');
    const claim = mocks.query.mock.calls.find((call) => queryText(call).includes('FOR UPDATE SKIP LOCKED'))!;
    expect(claim.slice(1)).toContainEqual(['esg_driver_excel_v8']);
    expect(claim.slice(1).some((value) => typeof value === 'string' && value.startsWith('generic:'))).toBe(true);
    const domainUpdate = mocks.execute.mock.calls.find((call) => queryText(call).includes('UPDATE esg_driver_jobs'))!;
    expect(domainUpdate.slice(1)).toContain(jobId);
    expect(domainUpdate.slice(1)).toContain('cancelled');
  });

  it('includes the new queue in active-job counts and terminal reconciliation', async () => {
    mocks.query.mockResolvedValueOnce([{ count: 1 }]);
    expect(await countActiveJobs(7, 'esg_driver')).toBe(1);
    expect(queryText(mocks.query.mock.calls[0])).toContain("'esg_driver_excel_v8'");
    expect(queryText(mocks.query.mock.calls[0])).toContain("'esg_driver_excel_v6'");
    await reconcileEsgDriverDomainJobs();
    expect(queryText(mocks.execute.mock.calls[0])).toContain("'esg_driver_excel_v8'");
    expect(queryText(mocks.execute.mock.calls[0])).toContain("'esg_driver_excel_v6'");
  });
});
