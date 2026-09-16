import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn(), pageUpdate: vi.fn() }));
vi.mock('@esgcredit/db-esg', () => ({ esgPrisma: { $transaction: mocks.transaction } }));
import { withPdfTranslationLease } from '../lease-checkpoint';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async callback => callback({ $queryRaw: mocks.query, pdf_translation_v2_pages: { update: mocks.pageUpdate } }));
  mocks.query.mockResolvedValue([{ status: 'processing', lease_owner: 'worker-new', lease_valid: true, cancel_requested: false }]);
});

describe('PDF checkpoint lease transaction', () => {
  it('locks the queue row and writes through the same transaction', async () => {
    const write = vi.fn(async transaction => {
      expect(mocks.query).toHaveBeenCalledTimes(1);
      return transaction.pdf_translation_v2_pages.update({ where: { id: 'page' } });
    });
    await withPdfTranslationLease('job', 'worker-new', write);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls[0][0].join(' ')).toContain('FOR UPDATE');
    expect(mocks.pageUpdate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['reclaimed', { status: 'processing', lease_owner: 'replacement', lease_valid: true, cancel_requested: false }],
    ['expired', { status: 'processing', lease_owner: 'worker-new', lease_valid: false, cancel_requested: false }],
    ['cancelled', { status: 'processing', lease_owner: 'worker-new', lease_valid: true, cancel_requested: true }],
    ['completed', { status: 'completed', lease_owner: 'worker-new', lease_valid: true, cancel_requested: false }],
  ])('refuses a %s lease before writing any progress or counters', async (_name, row) => {
    mocks.query.mockResolvedValue([row]);
    const write = vi.fn();
    await expect(withPdfTranslationLease('job', 'worker-new', write)).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  });
});
