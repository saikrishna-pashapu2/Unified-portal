import { looksDefinitelyEnglish } from "@/lib/pdfx-v2/language-protection";
import type { DetectedLanguage } from "./types";
import { normalizeKnownRussianPlaceNames } from "./russian-place-names";

// Paid v1/v2 scopes must replay their exact original classifier: language is
// part of the entry hash, selection eligibility and durable request budget.
export function detectLegacyCellLanguage(text: string): DetectedLanguage {
  if (
    /[ўқғҳ]/i.test(text) ||
    /\b(?:tumani|viloyati|maktab|shahri|bilan|uchun|quyosh|hisoblagich|soni|nomi|yil|bo.yicha|o.rnatilgan|tashkilot|tuman|hudud|mahalla|mfy|йил|учун|билан|сони|тумани)\b/i.test(
      text,
    )
  )
    return "Uzbek";
  if (/[\u0600-\u06ff]/.test(text)) return "Arabic";
  if (/[а-яё]/i.test(text))
    return /(?:количество|наименование|област|район|примечан|организац|состояни|станци|выполнен|мощност|город)/i.test(
      text,
    )
      ? "Russian"
      : "Unknown";
  if (
    looksDefinitelyEnglish(text) ||
    /^(?:meterId|meterNotes|date|name|notes|total|regionName|status|description|capacity|power)$/i.test(
      text.trim(),
    )
  )
    return "English";
  return "Unknown";
}

export function detectCellLanguage(text: string): DetectedLanguage {
  // JavaScript \b treats Cyrillic letters as non-word characters. Use Unicode
  // boundaries so Uzbek prose is recognised even beside Russian/English text.
  const uzbekWord = new RegExp(
    "(?<![\\p{L}\\p{N}_])(?:tumani|viloyati|maktab|shahri|bilan|uchun|quyosh|hisoblagich|soni|nomi|yil|bo.yicha|o.rnatilgan|tashkilot|tuman|hudud|mahalla|mfy|йил(?:и|да|нинг)?|учун|билан|сони|тумани|номи|мактаб(?:и)?|вилояти|шаҳри|хизмат(?:и|лар|лари)?)(?![\\p{L}\\p{N}_])",
    "iu",
  );
  if (/[ўқғҳ]/i.test(text) || uzbekWord.test(text)) return "Uzbek";

  const legacy = detectLegacyCellLanguage(text);
  if (legacy !== "Unknown") return legacy;
  if (!/[а-яё]/i.test(text)) return "Unknown";

  // Require multiple Russian lexical/inflection clues, not Cyrillic alone:
  // Uzbek also uses Cyrillic and a lone company/place name is not evidence.
  const words = text.toLowerCase().match(/[а-яё]+/g) || [];
  const clues = words.filter((word) =>
    /^(?:услуг(?:а|и|у|ой|ам|ами|ах)?|техническ(?:ий|ая|ое|ие|ого|ому|ой|ую|их|ими|им|ом)|обслуживани(?:е|я|ю|ем|и)|фотоэлектрическ(?:ий|ая|ое|ие|ого|ому|ой|ую|их|ими|им|ом)|панел(?:ь|и|ей|ям|ями|ях)|подготовк(?:а|и|у|ой|е)|(?:пара)?олимпийск(?:ий|ая|ое|ие|ого|ому|ой|ую|их|ими|им|ом)|видам|спорт(?:а|у|ом|е)?|цент(?:р|ра|ру|ром|ре|ры|ров)|солнечн(?:ый|ая|ое|ые|ого|ому|ой|ую|ых|ыми|ым|ом)|договор(?:а|у|ом|е|ы|ов)?|поставк(?:а|и|у|ой|е)|оплат(?:а|ы|у|ой|е))$/.test(
      word,
    ),
  );
  return new Set(clues).size >= 2 ? "Russian" : "Unknown";
}

export function isIdentifierText(text: string): boolean {
  const value = text.trim();
  return (
    !new RegExp("\\p{L}", "u").test(value) ||
    /^\d{4}-\d\d-\d\d[T ]/.test(value) ||
    /^(?:https?:\/\/|www\.|[^\s@]+@[^\s@]+\.)/i.test(value) ||
    (new RegExp("^[\\p{L}\\d_./:+-]+$", "u").test(value) &&
      /\d/.test(value) &&
      !/\s/.test(value))
  );
}

export function protectedTokens(text: string): string[] {
  // Numbered Uzbek prose is not an equipment/serial identifier: e.g.
  // "123-maktab" -> "школа №123", "103-sonli" -> "№103".
  // Only these explicit grammatical suffixes may change; arbitrary codes,
  // acronyms (22-DMTT), dates and serials must still match exactly.
  const numberedProse = text.replace(
    new RegExp(
      "(?<![\\p{L}\\p{N}_./:+-])(\\d+)[-‑–](?:sonli|son|maktabi|maktab|blok|блок|yil|сонли|сон|йил)(?![\\p{L}\\p{N}_./:+-])",
      "giu",
    ),
    "$1 ",
  );
  // Russian ordinal endings are grammar, not part of the numeric value.
  // Deliberately case-sensitive: uppercase suffixes may be equipment codes.
  const normalized = numberedProse.replace(
    new RegExp(
      "(?<![\\p{L}\\p{N}_./:+-])(\\d+)[-‑–](?:го|му|й|я|е|х|ми|ю|ой|ым|ом)(?![\\p{L}\\p{N}_./:+-])",
      "gu",
    ),
    "$1 ",
  );
  return (
    normalized.match(
      new RegExp(
        "(?:https?:\\/\\/\\S+|(?<![\\p{L}\\p{N}_])[+-]?[\\p{L}\\d]*\\d(?:[\\p{L}\\d_./:+-]*[\\p{L}\\d])?(?![\\p{L}\\p{N}_]))",
        "gu",
      ),
    ) ?? []
  ).sort();
}

// Permit only the legal-form label to change inside an otherwise untouched
// English company name. This is not a general exemption for mixed-language
// cells: every other character (including names/codes) must match exactly.
export function isRussianLegalFormOnlyTranslation(
  source: string,
  text: string,
): boolean {
  const label = new RegExp(
    "(?<![\\p{L}\\p{N}_])(?:MChJ|MCHJ|МЧЖ)(?![\\p{L}\\p{N}_])",
    "gu",
  );
  const replaced = source.replace(label, "ООО");
  return replaced !== source && text === replaced;
}

// Correct verified administrative place spellings first, then an evidenced
// Latin source-name root retaining Uzbek ҳ in a Russian adjective suffix.
// Neither rule transliterates arbitrary Uzbek prose or ungrounded names.
export function normalizeRussianPlaceNameSpelling(
  source: string,
  text: string,
): string {
  text = normalizeKnownRussianPlaceNames(source, text);
  const roman: Record<string, string> = {
    а: "a",
    б: "b",
    в: "v",
    г: "g",
    д: "d",
    е: "e",
    ё: "yo",
    ж: "j",
    з: "z",
    и: "i",
    й: "y",
    к: "k",
    л: "l",
    м: "m",
    н: "n",
    о: "o",
    п: "p",
    р: "r",
    с: "s",
    т: "t",
    у: "u",
    ф: "f",
    х: "h",
    ҳ: "h",
    ц: "ts",
    ч: "ch",
    ш: "sh",
    щ: "shch",
    э: "e",
    ю: "yu",
    я: "ya",
  };
  const names = new Set(
    (
      source.match(
        new RegExp("(?<![\\p{L}\\p{N}_])[A-Z][a-z]+(?![\\p{L}\\p{N}_])", "gu"),
      ) || []
    ).map((s) => s.toLowerCase()),
  );
  return text.replace(
    new RegExp("(?<![\\p{L}\\p{N}_])[А-ЯЁҲ][а-яёҳ]+(?![\\p{L}\\p{N}_])", "gu"),
    (word) => {
      if (!/[ҳҲ]/.test(word)) return word;
      const match =
        /^(.*?)(?:ского|скому|ским|ском|ский|ская|ской|ское|ские|ских|скими|скую)$/i.exec(
          word,
        );
      if (!match) return word;
      const root = Array.from(match[1].toLowerCase())
        .map((c) => roman[c] || "?")
        .join("");
      return names.has(root)
        ? word.replace(/ҳ/g, "х").replace(/Ҳ/g, "Х")
        : word;
    },
  );
}
