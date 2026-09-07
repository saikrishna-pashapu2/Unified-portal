import type { PdfPageLayout } from './schemas';

const ENGLISH_CUES = new Set([
  'a', 'about', 'and', 'approved', 'are', 'as', 'at', 'be', 'by', 'company',
  'complaint', 'confidential', 'definition', 'document', 'employee', 'employees',
  'for', 'from', 'grievance', 'handling', 'in', 'is', 'may', 'must', 'of', 'on',
  'policy', 'procedure', 'purpose', 'shall', 'source', 'the', 'this', 'to',
  'version', 'with', 'without',
]);

const UZBEK_LATIN_CUES = new Set([
  'amalga', 'bilan', 'bo‘yicha', "bo'yicha", 'bu', 'ham', 'hujjat', 'jamiyat',
  'mazkur', 'murojaat', 'qilish', 'shikoyat', 'uchun', 'ushbu', 'va', 'xodim',
]);

function latinWords(text: string): string[] {
  return (text.toLocaleLowerCase().match(/[a-z]+(?:['’‘`][a-z]+)?/g) ?? []);
}

/** Conservative deterministic backstop for the model's language routing.
 * It only protects text that is clearly English; ambiguous Uzbek Latin remains
 * translatable so a false positive cannot silently skip source content. */
export function looksDefinitelyEnglish(text: string): boolean {
  if (/[Ѐ-ӿ؀-ۿ]/.test(text)) return false;
  const words = latinWords(text);
  if (words.length === 0) return false;
  const english = words.filter((word) => ENGLISH_CUES.has(word)).length;
  const uzbek = words.filter((word) => UZBEK_LATIN_CUES.has(word)).length;
  if (uzbek >= english && uzbek > 0) return false;
  return english >= 2 || (english === 1 && words.length <= 4);
}

export function looksDefinitelyRussian(text: string): boolean {
  if (/[ўқғҳ]/i.test(text) || /\b(?:yil|bilan|uchun|bo'yicha)\b/i.test(text)) return false;
  const words = text.toLowerCase().match(/[а-яё]+/g) ?? [];
  // Uzbek written with only shared Cyrillic letters must NOT be protected.
  if (words.some((word) => ['йил', 'йилда', 'билан', 'учун', 'бош', 'буйича', 'ва', 'сони', 'нафар', 'лавозим'].includes(word))) return false;
  return words.filter((word) => ['общество', 'работников', 'работник', 'должности', 'сотрудников', 'количество', 'утвердить', 'приказ', 'настоящего', 'настоящий', 'соответствии', 'предприятия', 'организации', 'директора', 'подразделений', 'должностей', 'штатное', 'расписание', 'составляет', 'рублей', 'решение'].includes(word)).length >= 2;
}

export function enforceEnglishProtection(layout: PdfPageLayout, targetLanguage?: string): PdfPageLayout {
  const protectedText = (text: string) => looksDefinitelyEnglish(text) ||
    (targetLanguage === 'Russian' && looksDefinitelyRussian(text));
  return {
    ...layout,
    elements: layout.elements.map((element) => {
      if (element.kind === 'table') {
        const rows = element.rows.map((row) => ({
          ...row,
          cells: row.cells.map((cell) => ({
            ...cell,
            translate: cell.translate && !protectedText(cell.text),
          })),
        }));
        return {
          ...element,
          rows,
          translate: rows.some((row) =>
            row.cells.some((cell) => cell.translate && cell.text.trim()),
          ),
        };
      }
      if (['image', 'stamp', 'signature', 'other', 'page_number', 'suppressed_text']
        .includes(element.kind)) {
        return { ...element, translate: false };
      }
      return {
        ...element,
        translate: element.translate && !protectedText(element.text),
      };
    }),
  };
}
