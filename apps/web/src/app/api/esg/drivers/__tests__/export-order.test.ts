import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ user: vi.fn(), job: vi.fn(), build: vi.fn(), integrity: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/session-user', () => ({ ensureUserId: mocks.user }));
vi.mock('@/lib/api-usage', () => ({ enforceApiUsage: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/esg-drivers', () => ({ getEsgDriverJob: mocks.job, isDriverJobId: () => true }));
vi.mock('@/lib/esg-drivers/export', () => ({ buildDriverWorkbook: mocks.build }));
vi.mock('@/lib/esg-drivers/result-integrity', () => ({ savedResultError: mocks.integrity }));
vi.mock('@/lib/workbook', () => ({ workbookErrorResponse: () => ({ status: 500, message: 'Export failed' }) }));

import { GET } from '../[jobId]/export/route';

const id = '4c4ebf2b-a9e5-4f40-b633-740ee43ea7ec';
const result = { country: 'UAE', sector: 'Banking', language: 'English', generatedAt: '2026-11-16T00:00:00Z' };
const request = (query = '') => new Request(`http://localhost/api/esg/drivers/${id}/export${query}`);
const context = { params: { jobId: id } };

beforeEach(() => {
  mocks.user.mockResolvedValue(7);
  mocks.job.mockResolvedValue({ id, status: 'done', result, checkpoint: {} });
  mocks.build.mockResolvedValue(Buffer.from('xlsx'));
  mocks.integrity.mockReturnValue(null);
});

describe('ESG driver export ordering', () => {
  it.each([['', 'report'], ['?order=alphabetical', 'alphabetical']])('exports %s only after ownership and saved-result validation', async (query, order) => {
    const response = await GET(request(query), context);
    expect(response.status).toBe(200);
    expect(mocks.job).toHaveBeenCalledWith(id, 7, { includeCheckpoint: true });
    expect(mocks.integrity).toHaveBeenCalledWith(result, {});
    expect(mocks.build).toHaveBeenCalledWith(result, { order });
  });

  it('rejects unsupported orders before reading a job', async () => {
    const response = await GET(request('?order=score-edit'), context);
    expect(response.status).toBe(400);
    expect(mocks.job).not.toHaveBeenCalled();
    expect(mocks.build).not.toHaveBeenCalled();
  });

  it('does not bypass authentication or result integrity for alphabetical exports', async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await GET(request('?order=alphabetical'), context)).status).toBe(401);
    mocks.integrity.mockReturnValueOnce('Saved evidence failed verification');
    expect((await GET(request('?order=alphabetical'), context)).status).toBe(409);
    expect(mocks.build).not.toHaveBeenCalled();
  });
});
