import { describe, expect, it } from 'vitest';
import { normalizeRedundantDateRangeYear } from '../date-range-normalization';

const latinSource =
  '1. 2025-yil 11-avgustdan 15-avgust kuniga qadar yig‘ilish o‘tkaziladi.';
const latinTranslation =
  '1. С 11 августа 2025 года по 15 августа 2025 года состоится заседание.';

describe('PDF Translator bounded date-range normalization', () => {
  it('removes the first repeated year for the Uzbek Latin August range', () => {
    expect(normalizeRedundantDateRangeYear(latinSource, latinTranslation)).toBe(
      '1. С 11 августа по 15 августа 2025 года состоится заседание.',
    );
  });

  it('handles spaces and hyphens in the Uzbek Latin April range', () => {
    const source =
      '3. 2026 yil 30- mart kunidan 04- aprel kuniga qadar arizalar qabul qilinadi.';
    const translation =
      '3. С 30 марта 2026 года по 04 апреля 2026 года принимаются заявления.';

    expect(normalizeRedundantDateRangeYear(source, translation)).toBe(
      '3. С 30 марта по 04 апреля 2026 года принимаются заявления.',
    );
  });

  it('retains the range when Russian prose uses uppercase range markers', () => {
    const translation =
      '1. С 11 августа 2025 года ПО 15 августа 2025 года состоится заседание.';

    expect(normalizeRedundantDateRangeYear(latinSource, translation)).toBe(
      '1. С 11 августа ПО 15 августа 2025 года состоится заседание.',
    );
  });

  it('recognizes Uzbek Cyrillic date-range inflections', () => {
    const source = '4. 2025-йил 11-августдан 15-август кунига қадар амал қилади.';
    const translation = '4. С 11 августа 2025 года по 15 августа 2025 года действует.';

    expect(normalizeRedundantDateRangeYear(source, translation)).toBe(
      '4. С 11 августа по 15 августа 2025 года действует.',
    );
  });

  it('does not normalize a different-year range', () => {
    const translation =
      '1. С 11 августа 2025 года по 15 августа 2026 года состоится заседание.';

    expect(normalizeRedundantDateRangeYear(latinSource, translation)).toBe(translation);
  });

  it('does not normalize changed endpoint days or months', () => {
    const changedDay = '1. С 12 августа 2025 года по 15 августа 2025 года состоится заседание.';
    const changedMonth = '1. С 11 июля 2025 года по 15 августа 2025 года состоится заседание.';

    expect(normalizeRedundantDateRangeYear(latinSource, changedDay)).toBe(changedDay);
    expect(normalizeRedundantDateRangeYear(latinSource, changedMonth)).toBe(changedMonth);
  });

  it('does not normalize when the source has no recognized date range', () => {
    const source = '1. 2025-yil davomida yig‘ilish o‘tkaziladi.';

    expect(normalizeRedundantDateRangeYear(source, latinTranslation)).toBe(latinTranslation);
  });

  it('does not normalize multiple or ambiguous source ranges', () => {
    const multiple =
      '2025-yil 11-avgustdan 15-avgust kuniga qadar va 2026-yil 1-sentabrdan 2-sentabr kuniga qadar.';
    const ambiguous =
      '2025-yil 11-avgustda yoki 15-avgustda uchrashuv bo‘ladi.';

    expect(normalizeRedundantDateRangeYear(multiple, latinTranslation)).toBe(latinTranslation);
    expect(normalizeRedundantDateRangeYear(ambiguous, latinTranslation)).toBe(latinTranslation);
  });

  it('does not infer a range across intervening source prose', () => {
    const source =
      '2025-yil 11-avgustdan uchrashuv 15-avgust kuniga qadar davom etadi.';

    expect(normalizeRedundantDateRangeYear(source, latinTranslation)).toBe(latinTranslation);
  });

  it('does not touch a repeated year outside the date range', () => {
    const translation = `${latinTranslation} Hujjat 2025 raqamida qayd etilgan.`;

    expect(normalizeRedundantDateRangeYear(latinSource, translation)).toBe(translation);
  });

  it('does not normalize when an unrelated source number is missing', () => {
    const source = '12-modda: 2025-yil 11-avgustdan 15-avgust kuniga qadar kuchga kiradi.';
    const translation = 'Статья: С 11 августа 2025 года по 15 августа 2025 года вступает в силу.';

    expect(normalizeRedundantDateRangeYear(source, translation)).toBe(translation);
  });

  it('preserves identifiers and legal references while removing only the date year', () => {
    const source = '12-modda: 2025-yil 11-avgustdan 15-avgust kuniga qadar kuchga kiradi.';
    const translation = 'Статья 12: С 11 августа 2025 года по 15 августа 2025 года вступает в силу.';

    expect(normalizeRedundantDateRangeYear(source, translation)).toBe(
      'Статья 12: С 11 августа по 15 августа 2025 года вступает в силу.',
    );
  });

  it('does not normalize a repeated date range in prose', () => {
    const translation = `${latinTranslation} С 11 августа 2025 года по 15 августа 2025 года.`;

    expect(normalizeRedundantDateRangeYear(latinSource, translation)).toBe(translation);
  });
});
