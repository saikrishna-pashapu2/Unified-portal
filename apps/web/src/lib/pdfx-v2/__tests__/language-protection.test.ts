import { describe, expect, it } from 'vitest';
import type { PdfPageLayout } from '../schemas';
import {
  enforceEnglishProtection,
  looksDefinitelyEnglish,
  looksDefinitelyRussian,
} from '../language-protection';

describe('PDF Translator English protection', () => {
  it('recognizes clear English without misclassifying Uzbek Latin', () => {
    expect(looksDefinitelyEnglish('GRIEVANCE HANDLING POLICY AND PROCEDURE')).toBe(true);
    expect(looksDefinitelyEnglish('This document is the property of the Company.')).toBe(true);
    expect(looksDefinitelyEnglish('Mazkur hujjat xodimlar uchun amal qiladi')).toBe(false);
    expect(looksDefinitelyEnglish('Murojaat va shikoyatlarni ko‘rib chiqish')).toBe(false);
  });

  it('protects English blocks and cells while leaving Uzbek routed to translation', () => {
    const layout: PdfPageLayout = {
      pageNumber: 1,
      width: 1000,
      height: 1000,
      orientation: 'portrait',
      sourceLanguage: 'English + Uzbek',
      sourceScript: 'Latin',
      warnings: [],
      elements: [
        {
          id: 'e001', kind: 'heading', order: 0, level: 1, translate: true,
          text: 'GRIEVANCE HANDLING POLICY', bbox: [50, 40, 450, 90],
          columnCount: 0, rowCount: 0, rows: [],
        },
        {
          id: 'e002', kind: 'paragraph', order: 1, level: 0, translate: true,
          text: 'Mazkur hujjat xodimlar uchun amal qiladi', bbox: [550, 100, 950, 180],
          columnCount: 0, rowCount: 0, rows: [],
        },
        {
          id: 'e003', kind: 'table', order: 2, level: 0, translate: true, text: '',
          bbox: [50, 220, 950, 320], columnCount: 2, rowCount: 1,
          rows: [{
            rowIndex: 0,
            cells: [
              {
                id: 'e003-r0-c0', rowIndex: 0, columnIndex: 0, rowSpan: 1,
                columnSpan: 1, isHeader: true, translate: true, text: 'Purpose',
                bbox: [50, 220, 500, 320],
              },
              {
                id: 'e003-r0-c1', rowIndex: 0, columnIndex: 1, rowSpan: 1,
                columnSpan: 1, isHeader: true, translate: true, text: 'Maqsad',
                bbox: [500, 220, 950, 320],
              },
            ],
          }],
        },
      ],
    };

    const routed = enforceEnglishProtection(layout);

    expect(routed.elements[0].translate).toBe(false);
    expect(routed.elements[1].translate).toBe(true);
    expect(routed.elements[2].rows[0].cells.map((cell) => cell.translate))
      .toEqual([false, true]);
  });

  it('recognizes Russian legal text without protecting Uzbek Cyrillic stubs', () => {
    expect(looksDefinitelyRussian(
      'Минимальная структура плана мероприятий и ответственность участника',
    )).toBe(true);
    expect(looksDefinitelyRussian(
      'КОНФИДЕНЦИАЛЬНОСТЬ НЕЗАВИСИМОСТЬ КОНФЛИКТ ИНТЕРЕСОВ',
    )).toBe(true);
    expect(looksDefinitelyRussian('Общая информация')).toBe(true);
    expect(looksDefinitelyRussian('Стратегия системы управления ресурсами')).toBe(true);
    expect(looksDefinitelyRussian('Штатное расписание')).toBe(true);
    expect(looksDefinitelyRussian('План работ: topshirish.')).toBe(false);
    expect(looksDefinitelyRussian('Должности сотрудников')).toBe(true);
    expect(looksDefinitelyRussian(
      'План работ. Soliq hisobotini tayyorlash va topshirish.',
    )).toBe(false);
    expect(looksDefinitelyRussian(
      'Ушбу ҳужжат давлат органлари томонидан амалга оширилади',
    )).toBe(false);
    expect(looksDefinitelyRussian(
      'Бош ишлар учун ва уларнинг натижалари',
    )).toBe(false);
  });
});
