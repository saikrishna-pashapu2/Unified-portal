import { describe, expect, it } from 'vitest';
import { translatorDisplayMessage } from './display-message';

describe('translator display messages', () => {
  it('uses neutral copy for legacy status and failure messages', () => {
    expect(translatorDisplayMessage('OpenAI could not extract page 7: cells overlap.'))
      .toBe('Translation service could not extract page 7: cells overlap.');
    expect(translatorDisplayMessage('Queued for OpenAI page analysis'))
      .not.toMatch(/openai/i);
    expect(translatorDisplayMessage('openai returned invalid JSON; OPENAI retry failed.'))
      .toBe('Translation service returned invalid JSON; Translation service retry failed.');
  });

  it('keeps service configuration errors provider-neutral', () => {
    expect(translatorDisplayMessage('OPENAI_API_KEY is required for PDF Translator'))
      .toBe('Translation service configuration is required for PDF Translator');
  });

  it('preserves meaningful details and already-neutral messages', () => {
    const message = 'Page 10: table e006 overlaps 2 grid positions; 9 completed pages retained.';
    expect(translatorDisplayMessage(message)).toBe(message);
    expect(translatorDisplayMessage('e004: Требуется единица кВт·ч.')).toBe('e004: Требуется единица кВт·ч.');
  });

  it('handles absent messages without displaying a placeholder', () => {
    expect(translatorDisplayMessage(null)).toBe('');
    expect(translatorDisplayMessage(undefined)).toBe('');
    expect(translatorDisplayMessage('')).toBe('');
  });
});
