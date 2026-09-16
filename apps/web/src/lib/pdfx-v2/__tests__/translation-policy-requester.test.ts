import { describe, expect, it, vi } from 'vitest';
import { translationFidelityPolicy } from '../translation-policy';
import type { PdfPageLayout } from '../schemas';

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('openai', () => ({ default: class { responses = { create }; } }));
vi.mock('@/lib/config/env', () => ({ env: { OPENAI_API_KEY: 'unit-test-not-a-key' } }));

describe('default requester unit policy consistency (no API)', () => {
  it('uses identical higher-priority fidelity instructions for context, translation and review', async () => {
    const { defaultPdfxV2Requester } = await import('../openai');
    const source: PdfPageLayout = { pageNumber: 7, width: 1000, height: 1000, orientation: 'portrait', sourceLanguage: 'Uzbek', sourceScript: 'Cyrillic', warnings: [], elements: [] };
    const context = { sourceLanguage: 'Uzbek', targetLanguage: 'Russian', documentType: 'Report', summary: 'Energy', preserveTerms: ['млрд. сўм', 'Company'], terminology: [] };
    const translation = { pageNumber: 7, elements: [], warnings: [] };
    const review = { pageNumber: 7, complete: true, meaningPreserved: true, targetLanguageSatisfied: true, tableStructurePreserved: true, failures: [], warnings: [] };
    for (const value of [context, translation, review]) create.mockResolvedValueOnce({
      id: 'mock', model: 'gpt-5.6-luna', status: 'completed', usage: { input_tokens: 1, output_tokens: 1 },
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
    });
    await defaultPdfxV2Requester.context({ sourcePages: [], targetLanguage: 'Russian', model: 'gpt-5.6-luna' });
    await defaultPdfxV2Requester.translate({ source, context, targetLanguage: 'Russian', model: 'gpt-5.6-luna' });
    await defaultPdfxV2Requester.validate({ source, translation, context, targetLanguage: 'Russian', model: 'gpt-5.6-luna' });
    expect(create).toHaveBeenCalledTimes(3);
    for (const [args] of create.mock.calls) {
      expect(args.instructions).toBe(translationFidelityPolicy('Russian'));
      expect(args.store).toBe(false);
      expect(args.model).toBe('gpt-5.6-luna');
    }
    for (const [args] of create.mock.calls.slice(1)) {
      expect(args.input).toContain('"preserveTerms":["Company"]');
      expect(args.input).not.toContain('"млрд. сўм"');
    }
    expect(create.mock.calls[2][0].input).toContain('all material defects');
    expect(context.preserveTerms).toEqual(['млрд. сўм', 'Company']);
  });
});
