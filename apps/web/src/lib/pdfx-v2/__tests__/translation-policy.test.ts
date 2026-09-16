import { describe, expect, it } from 'vitest';
import { contextForTranslation, translationFidelityPolicy } from '../translation-policy';

describe('shared translation and review fidelity policy', () => {
  it('removes only whole ordinary Uzbek unit/currency preserve entries for Russian', () => {
    const context = {
      sourceLanguage: 'Uzbek', targetLanguage: 'Russian', documentType: 'Report', summary: 'Energy report',
      preserveTerms: ['сўм', 'млн. сўм', 'млрд.сўм', "so'm", 'soʻm', 'кВт/соат', 'kVt/soat', 'МВт', 'кВт', 'Yashil Energiya', 'Сўм Банк', 'МЧЖ'],
      terminology: [{ source: 'сўм', target: 'сум', note: 'Currency label' }],
    };
    const snapshot = structuredClone(context);
    expect(contextForTranslation(context, 'Russian').preserveTerms).toEqual(['МВт', 'кВт', 'Yashil Energiya', 'Сўм Банк', 'МЧЖ']);
    expect(contextForTranslation(context, 'Russian').terminology).toEqual(context.terminology);
    expect(context).toEqual(snapshot);
    expect(contextForTranslation(context, 'English')).toBe(context);
  });

  it('distinguishes explicit energy notation from power or ambiguous source facts', () => {
    const policy = translationFidelityPolicy('Russian');
    expect(policy).toContain('кВт·ч, not кВт/час');
    expect(policy).toContain('clearly describes a quantity of electrical energy');
    expect(policy).toContain('Do not apply that interpretation to capacity, ramp rates, or ambiguous contexts');
    expect(policy).toContain('a table heading printed with kW alone must not acquire hours');
    expect(policy).toContain('English and translate=false text remain verbatim');
    expect(policy).toContain('Preserve all numeric values, digit sequences, scale factors and identifiers exactly');
    expect(translationFidelityPolicy('English')).not.toContain('Russian terminology:');
  });
});
