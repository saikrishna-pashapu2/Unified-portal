import { describe, expect, it } from 'vitest';
import { sanitizeDocumentContext, sanitizeTerminologyTarget } from '../context-sanitizer';
import type { DocumentContext } from '../schemas';

const baseContext: DocumentContext = {
  sourceLanguage: 'Uzbek',
  targetLanguage: 'Russian',
  documentType: 'IPO procurement document',
  summary: 'A legal document.',
  preserveTerms: [],
  terminology: [],
};

describe('PDF translator terminology context sanitizer', () => {
  it('repairs the uniquely corresponding mixed-script company name', () => {
    expect(sanitizeTerminologyTarget(
      '“Qorasuvenergo” AJ',
      'АО «Qorasuvэнерго»',
    )).toBe('АО «Qorasuvenergo»');
  });

  it('repairs repeated occurrences while retaining the Russian legal form', () => {
    const context = {
      ...baseContext,
      terminology: [{
        source: '“Qorasuvenergo” AJ',
        target: 'АО «Qorasuvэнерго»; АО «Qorasuvэнерго»',
        note: 'Registered company name',
      }],
    };

    expect(sanitizeDocumentContext(context).terminology[0]).toEqual({
      source: context.terminology[0].source,
      target: 'АО «Qorasuvenergo»; АО «Qorasuvenergo»',
      note: 'Registered company name',
    });
    expect(context.terminology[0].target).toContain('энерго');
  });

  it('leaves a correct target and non-matching mixed-script names unchanged', () => {
    expect(sanitizeTerminologyTarget(
      '“Qorasuvenergo” AJ',
      'АО «Qorasuvenergo»',
    )).toBe('АО «Qorasuvenergo»');
    expect(sanitizeTerminologyTarget(
      '“Qorasuvenergo” AJ and “QulayEnergetics” LLC',
      'АО «Qorasuvэнерго»',
    )).toBe('АО «Qorasuvэнерго»');
    expect(sanitizeTerminologyTarget(
      '“Qorasuvenergo” AJ',
      'АО «Корасувэнерго»',
    )).toBe('АО «Корасувэнерго»');
  });

  it('does not mutate the context when nothing needs repair', () => {
    const context = { ...baseContext, terminology: [{
      source: 'Qorasuvenergo',
      target: 'АО «Qorasuvenergo»',
      note: 'Registered company name',
    }] };
    expect(sanitizeDocumentContext(context)).toBe(context);
  });
});
