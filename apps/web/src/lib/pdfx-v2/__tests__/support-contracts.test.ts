import { describe, expect, it } from 'vitest';
import {
  buildPdfContentDisposition,
  buildTranslatedPdfFilename,
  MAX_PDF_REQUEST_BYTES,
  MAX_PDF_UPLOAD_BYTES,
  PDFX_V2_MODEL,
  PDFX_V2_QUEUE_JOB_TYPE,
  PDFX_V2_RENDERER_VERSION,
} from '../constants';
import { normalizePdfDisplayName } from '../file-policy';
import { validateTranslationResult } from '../language-validation';
import { parsePdfxV2Pagination } from '../pagination';
import { isPdfxV2TargetLanguage } from '../types';

describe('PDF translator support contracts', () => {
  it('accepts exactly the supported target languages', () => {
    expect(isPdfxV2TargetLanguage('English')).toBe(true);
    expect(isPdfxV2TargetLanguage('Arabic')).toBe(true);
    expect(isPdfxV2TargetLanguage('Russian')).toBe(true);
    expect(isPdfxV2TargetLanguage('French')).toBe(false);
  });

  it('fences new jobs from obsolete workers and pins every pass to Luna', () => {
    expect(PDFX_V2_QUEUE_JOB_TYPE).toBe('pdf_translation_v6');
    expect(PDFX_V2_MODEL).toBe('gpt-5.6-luna');
    expect(PDFX_V2_RENDERER_VERSION).toBe('clean-layout-v2-2026-09-14');
  });

  it('accepts the upstream maximum file size plus bounded multipart overhead', () => {
    expect(MAX_PDF_UPLOAD_BYTES).toBe(512 * 1024 * 1024);
    expect(MAX_PDF_REQUEST_BYTES).toBe(516 * 1024 * 1024);
  });

  it('creates a safe display name and Unicode download header', () => {
    expect(normalizePdfDisplayName('../../quarterly-report.pdf', 'job-id')).toBe(
      'quarterly-report.pdf',
    );
    const header = buildPdfContentDisposition(
      'attachment',
      'translated_تقرير ESG 📄.pdf',
    );
    expect(header).toMatch(/^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
    expect(header).toContain('%D8%AA%D9%82%D8%B1%D9%8A%D8%B1');
    expect(header).not.toContain('\r');
    expect(header).not.toContain('\n');
    expect(buildTranslatedPdfFilename('openai_translated_report.pdf')).toBe(
      'translated_report.pdf',
    );
    expect(buildTranslatedPdfFilename('openai_transalted_report.pdf')).toBe(
      'translated_report.pdf',
    );
    expect(buildTranslatedPdfFilename('openair.pdf')).toBe('translated_openair.pdf');
    expect(buildTranslatedPdfFilename('OpenAI source.pdf')).toBe('translated_OpenAI source.pdf');
    expect(buildTranslatedPdfFilename('translated_openai_translated_Отчёт.pdf')).toBe('translated_Отчёт.pdf');
  });

  it('uses the Translator API pageSize parameter and rejects unsafe values', () => {
    expect(parsePdfxV2Pagination(new URLSearchParams('page=3&pageSize=8'))).toEqual({
      page: 3,
      pageSize: 8,
      skip: 16,
    });
    expect(parsePdfxV2Pagination(new URLSearchParams('pageSize=101'))).toBeNull();
  });

  it('rejects unchanged Uzbek source requested in Russian', () => {
    const source = [
      'Ушбу қарор давлат органлари томонидан амалга оширилади.',
      'Мазкур тартиб қонун талабларига мувофиқ бўлиши керак.',
      'Уларнинг вазифалари соҳасида назорат қилиш учун белгиланади.',
    ].join(' ');
    expect(validateTranslationResult(source, 'Russian', source)).toContain(
      'appears to leave Uzbek source text untranslated',
    );
  });
});
