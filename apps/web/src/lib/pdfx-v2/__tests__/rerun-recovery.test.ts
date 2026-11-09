import { describe, expect, it } from 'vitest';
import { preparePageRerunRecovery } from '../rerun-recovery';

describe('explicit PDF page rerun recovery', () => {
  it('marks page translation recovery while retaining whole-page and fragment checkpoints', () => {
    const candidate = { pageNumber: 6, elements: [{ id: 'whole', text: 'retained', cells: [] }] };
    const fragmentDraft = { pageNumber: 6, elements: [{ id: 'fragment', text: 'draft', cells: [] }] };
    const recovery = {
      version: 'page-translation-v1',
      fingerprint: 'fingerprint-6',
      passes: {
        whole: { attempts: 3, candidate, validationFailure: 'retry whole' },
        'fragment:0': { attempts: 1, localDraft: fragmentDraft },
        'fragment:1': { attempts: 1, candidate: fragmentDraft },
      },
      lastFailure: 'page exhausted its review attempts',
    };

    const result = preparePageRerunRecovery({
      translationRecovery: recovery,
      pinnedFromMemory: { e001: 'retained repeated heading' },
    }, 'translation');

    expect(result.kind).toBe('translation');
    expect(result.validation.translationRecovery).toEqual({ ...recovery, retryRequested: true });
    expect(result.validation.pinnedFromMemory).toEqual({ e001: 'retained repeated heading' });
    expect((result.validation.translationRecovery as typeof recovery).passes).toEqual(recovery.passes);
    expect(recovery).not.toHaveProperty('retryRequested');
  });

  it('preserves native cell-batch values without adding a page retry marker', () => {
    const recovery = {
      version: 'native-cell-batches-v1',
      fingerprint: 'fingerprint-table',
      values: { 'cell:1': 'one', 'cell:2': 'two' },
    };

    const result = preparePageRerunRecovery({ denseTranslation: recovery }, 'translation');

    expect(result.kind).toBe('native-cell-batches');
    expect(result.validation).toEqual({ denseTranslation: { ...recovery, retryRequested: true } });
    expect(result.validation).not.toHaveProperty('translationRecovery');
  });

  it('keeps large native cell checkpoints and unfinished empty cells', () => {
    const values = Object.fromEntries(
      Array.from({ length: 129 }, (_, index) => [`cell:${index}`, index === 128 ? '' : `value-${index}`]),
    );
    const result = preparePageRerunRecovery({
      denseTranslation: {
        version: 'native-cell-batches-v1',
        fingerprint: 'fingerprint-large-table',
        values,
      },
    }, 'translation');

    expect(result.kind).toBe('native-cell-batches');
    expect((result.validation.denseTranslation as { values: Record<string, string> }).values).toEqual(values);
  });

  it('resets extraction attempts but retains usable candidate, rotation and failures', () => {
    const candidate = { pageNumber: 6, elements: [{ id: 'candidate', text: 'retained' }] };
    const result = preparePageRerunRecovery({
      extractionRecovery: {
        version: 'v5-local-repair-1',
        attempts: 3,
        rotation: 90,
        candidate,
        firstFailure: 'initial OCR issue',
        failures: ['still missing the table grid'],
        requestFailure: 'timeout from the provider',
        terminal: true,
      },
      translationRecovery: { version: 'page-translation-v1', fingerprint: 'stale', passes: {} },
      denseTranslation: { version: 'native-cell-batches-v1', fingerprint: 'stale', values: {} },
    }, 'extraction');

    expect(result.kind).toBe('extraction');
    expect(result.validation).toEqual({
      extractionRecovery: {
        version: 'v5-local-repair-1',
        attempts: 0,
        rotation: 90,
        candidate,
        firstFailure: 'initial OCR issue',
        failures: ['still missing the table grid'],
      },
    });
    expect(result.validation).not.toHaveProperty('translationRecovery');
    expect(result.validation).not.toHaveProperty('denseTranslation');
  });

  it('clears malformed or unknown recovery rather than guessing at a checkpoint', () => {
    expect(preparePageRerunRecovery({
      translationRecovery: { version: 'legacy', fingerprint: 'old', passes: {} },
    }, 'translation')).toMatchObject({ kind: 'none', validation: {} });

    expect(preparePageRerunRecovery({
      extractionRecovery: {
        version: 'v5-local-repair-1',
        attempts: 'three',
        failures: [],
      },
    }, 'extraction')).toMatchObject({ kind: 'none', validation: {} });
  });
});
