import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { createWorkbookCheckpoint } from '@/lib/esg-drivers/workbook';
import type { EsgDriver, EsgDriverResult } from '@/lib/esg-drivers/types';
const mocks = vi.hoisted(() => ({ job: vi.fn(), user: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/session-user', () => ({ ensureUserId: mocks.user }));
vi.mock('@/lib/api-usage', () => ({ enforceApiUsage: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/esg-drivers', () => ({ getEsgDriverJob: mocks.job, isDriverJobId: () => true }));
import { GET as status } from '../status/route';
import { GET as exportWorkbook } from '../[jobId]/export/route';

const input = { country: 'UAE', sector: 'Banking', language: 'English' };
const id = '4c4ebf2b-a9e5-4f40-b633-740ee43ea7ec';
beforeEach(() => { mocks.user.mockResolvedValue(7); mocks.job.mockReset(); });

describe('workbook status and export contract', () => {
  it('returns the pinned 52-row plan and saved scope when reopening a running job', async () => {
    const checkpoint = createWorkbookCheckpoint(input);
    mocks.job.mockResolvedValue({ id, ...input, status: 'processing', progress: 40, activity: [], checkpoint, selectionPolicy: 'relevance-top15-v1', candidateCount: 52, candidateAssessedCount: 12, publishedDriverCount: 0, expectedDriverCount: 15 });
    const response = await status(new Request(`http://localhost/api/esg/drivers/status?jobId=${id}`));
    const body = await response.json();
    expect(body).toMatchObject(input); expect(body.driverPlan).toHaveLength(52);
    expect(body).toMatchObject({ selectionPolicy: 'relevance-top15-v1', candidateCount: 52, candidateAssessedCount: 12, publishedDriverCount: 0, expectedDriverCount: 15 });
    expect(body.driverPlan[51].title).toBe(checkpoint.definitions[51].name);
    expect(mocks.job).toHaveBeenCalledWith(id, 7, { includeCheckpoint: true });
    expect(body.checkpoint).toBeUndefined(); expect(body.allowedSources).toBeUndefined();
  });
  it('exports every unavailable row with status and original baseline; handles long source previews', async () => {
    const checkpoint = createWorkbookCheckpoint(input);
    // Saved reports before relevance selection retain their full-workbook export.
    delete checkpoint.selectionPolicy;
    const drivers: EsgDriver[] = checkpoint.definitions.map((d) => ({ id: d.id, driverSection: d.section, driverType: d.type, driverTitle: d.name, driverText: 'No verified update.', countrySectorRelevance: 'Unverified.', evidenceKpi: 'Unavailable.', keySources: [], sourceLinks: [], sourceRefs: [], confidence: 0, lastChecked: '2026-09-09', generationStatus: 'unavailable', statusReason: 'Source is unavailable.', workbookSheet: d.sheet, workbookRow: d.row, baseline: { logic: d.logic, evidenceKpi: d.evidenceKpi, keySources: d.keySources } }));
    const result: EsgDriverResult = { ...input, workflow: 'excel-sources', workbook: checkpoint.workbook, catalogVersion: checkpoint.catalogVersion, generatedAt: '2026-09-09', completion: 'partial', expectedDriverCount: 52, verifiedDriverCount: 0, drivers, evidence: [{ id: 's', title: 'Source', domain: 'example.org', url: 'https://example.org', contentSnippet: 'evidence '.repeat(5000), snippet: '', retrievedAt: '2026-09-09', publishedDate: null, updatedDate: null, lastModified: null, passages: [] } as any], warnings: ['Unavailable updates.'] };
    result.provenance = { contract: 'excel-evidence-v3', configuredModel: 'gpt-5.6-luna', actualModels: [] };
    Object.assign(result.evidence[0], { url: checkpoint.allowedSources[0].url, finalUrl: checkpoint.allowedSources[0].url, retrievalStatus: 'retrieved', evidenceProvenance: 'retrieved-page', isContextualFallback: false });
    mocks.job.mockResolvedValue({ id, status: 'done', result, checkpoint });
    const response = await exportWorkbook(new Request(`http://localhost/api/esg/drivers/${id}/export`), { params: { jobId: id } });
    expect(response.status).toBe(200);
    const book = XLSX.read(await response.arrayBuffer(), { type: 'array' });
    expect(book.SheetNames).toEqual(['Summary', 'Drivers', 'Citations', 'Sources']);
    const rows = XLSX.utils.sheet_to_json<string[]>(book.Sheets.Drivers, { header: 1 });
    expect(rows).toHaveLength(53);
    expect(rows[1][2]).toBe('Paris Agreement'); expect(rows[52][2]).toBe(checkpoint.definitions[51].name);
    expect(rows[1][10]).toBe('unavailable'); expect(rows[1][14]).toBe(checkpoint.definitions[0].logic);
    expect(rows[1][5]).toBe('Unavailable.');
    const sources = XLSX.utils.sheet_to_json<string[]>(book.Sheets.Sources, { header: 1 });
    expect(sources[1][7]).toContain('supporting quotes are in Citations');
  });
  it('refuses to export a legacy result attached to a new workbook checkpoint', async () => {
    const checkpoint = createWorkbookCheckpoint(input);
    mocks.job.mockResolvedValue({ id, status: 'done', checkpoint, result: { ...input, catalogVersion: 'old', drivers: [], evidence: [], warnings: [] } });
    const response = await exportWorkbook(new Request(`http://localhost/api/esg/drivers/${id}/export`), { params: { jobId: id } });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('failed workbook verification');
  });
});
