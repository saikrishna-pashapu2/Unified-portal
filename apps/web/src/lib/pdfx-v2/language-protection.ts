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

const RUSSIAN_CUES = new Set([
  'акции', 'акционер', 'акционера', 'анализ', 'без', 'более', 'будет', 'быть',
  'включая', 'выполнения', 'государственных', 'данные', 'договор', 'документ',
  'документы', 'документации', 'должен', 'для', 'его', 'если', 'исполнитель',
  'исполнителя', 'информации', 'интересов', 'компании', 'комплаенса',
  'компетенции', 'конфиденциальность', 'конфликт', 'контроль', 'корпоративного',
  'между', 'мероприятий', 'методология', 'на', 'наличие', 'настоящего',
  'независимость', 'обеспечение', 'области', 'объем', 'ограничения', 'оценки',
  'от', 'первичного', 'план', 'плана', 'по', 'предложения', 'предложений',
  'предоставить', 'при', 'приложение', 'публичного', 'публичному', 'работ',
  'работы', 'результат', 'результаты', 'развития', 'размещения', 'рекомендации',
  'ресурсов', 'соблюдение', 'состояние', 'сроки', 'стороны', 'структура',
  'требования', 'требований', 'технического', 'участие', 'участника', 'услуг',
  'формате', 'цель', 'целевую', 'чтобы', 'что', 'это', 'также', 'после', 'или',
  'и', 'из', 'к', 'с', 'со', 'во', 'не', 'но', 'как', 'архитектура', 'внешней',
  'взаимодействие', 'взаимодействия', 'внутренний', 'готовность', 'доступа',
  'информация', 'ключевых', 'коммуникации', 'местными', 'нефинансовая',
  'необходимости', 'общая', 'обязательства', 'отчетность', 'отчета', 'проверки',
  'проекта', 'проектами', 'процессы', 'ресурсами', 'система', 'системы', 'содержание',
  'стратегия', 'сбор', 'своевременного', 'устойчивое', 'управление', 'управления',
  'формирования', 'хранилища',
  // Keep the original high-confidence legal/HR cues as a compatibility
  // floor when the broader document vocabulary evolves.
  'общество', 'работников', 'работник', 'должности', 'сотрудников', 'количество',
  'утвердить', 'приказ', 'настоящий', 'соответствии', 'предприятия',
  'организации', 'директора', 'подразделений', 'должностей', 'штатное',
  'расписание', 'составляет', 'рублей', 'решение',
]);

const UZBEK_CYRILLIC_CUES = new Set([
  'амалга', 'белгиланади', 'белгиланган', 'билан', 'бундай', 'бўйича', 'давлат',
  'мазкур', 'мувофиқ', 'ошириш', 'соҳасида', 'тартиби', 'томонидан', 'тўғрисида',
  'уларнинг', 'унинг', 'учун', 'ушбу', 'ҳам', 'ҳамда', 'қилиш', 'қилиши', 'қонун',
  'қонуннинг', 'йил', 'йилда', 'бош', 'буйича', 'ва', 'сони', 'нафар', 'лавозим',
]);

function latinWords(text: string): string[] {
  return (text.toLocaleLowerCase().match(/[a-z]+(?:['’‘`][a-z]+)?/g) ?? []);
}

function hasLatinProse(text: string): boolean {
  const words = text.match(/[A-Za-z]+(?:['’‘`][A-Za-z]+)?/g) ?? [];
  const proseWords = words.filter((word) => {
    if (word.replace(/[^A-Za-z]/g, '').length < 3) return false;
    // Acronyms, initials, and short product/unit identifiers can appear in an
    // otherwise Russian block without making it Uzbek or English prose.
    if (/^[A-Z]{2,8}$/.test(word)) return false;
    return true;
  });
  // Even one unrecognized Latin word can be the action in an otherwise
  // Russian sentence. Leave it eligible for translation and semantic review.
  return proseWords.length > 0;
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
  if (hasLatinProse(text)) return false;
  if (latinWords(text).some((word) => UZBEK_LATIN_CUES.has(word))) return false;
  const words = text.toLowerCase().match(/[а-яё]+/g) ?? [];
  // Uzbek written with only shared Cyrillic letters must NOT be protected.
  if (words.some((word) => UZBEK_CYRILLIC_CUES.has(word))) return false;
  return words.filter((word) => RUSSIAN_CUES.has(word)).length >= 2;
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
