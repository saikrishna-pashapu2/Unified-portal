import type { DocumentContext } from './schemas';

const WORD_RE = /[A-Za-z\u0400-\u04ff]+(?:['’‘ʼ-][A-Za-z\u0400-\u04ff]+)*/g;
const LATIN_WORD_RE = /^[A-Za-z]+(?:['’‘ʼ-][A-Za-z]+)*$/;
const CYRILLIC_RE = /[\u0400-\u04ff]/;
const LATIN_RE = /[A-Za-z]/;

// This is intentionally a comparison-only transliteration map. It is not a
// general Russian transliterator and must never rewrite source or translated
// document text. It lets us recognize the one known corruption where a Latin
// registered name has a Cyrillic suffix inserted into the model's glossary.
const CYRILLIC_TO_LATIN: Readonly<Record<string, string>> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function normalizeForComparison(value: string): string {
  return value
    .replace(/[’‘ʼ`]/g, "'")
    .toLocaleLowerCase('ru');
}

function transliteratedComparison(value: string): string {
  let result = '';
  for (const character of normalizeForComparison(value)) {
    if (/[a-z]/.test(character) || character === "'") {
      result += character;
      continue;
    }
    result += CYRILLIC_TO_LATIN[character] ?? character;
  }
  return result;
}

function sourceNameCandidates(source: string): string[] {
  const unique = new Map<string, string>();
  for (const token of source.match(WORD_RE) ?? []) {
    if (!LATIN_WORD_RE.test(token) || token.replace(/[^A-Za-z]/g, '').length < 8) continue;
    const normalized = normalizeForComparison(token);
    if (!unique.has(normalized)) unique.set(normalized, token);
  }
  return Array.from(unique.values());
}

function sanitizeTerminologyTarget(source: string, target: string): string {
  const sourceNames = sourceNameCandidates(source);
  // Terminology entries are often short, name-like strings. If the source
  // contains more than one long Latin token, do not guess which one a mixed
  // target token represents.
  if (sourceNames.length !== 1) return target;

  let changed = false;
  const sanitized = target.replace(WORD_RE, (token) => {
    if (!LATIN_RE.test(token) || !CYRILLIC_RE.test(token)) return token;
    const matches = sourceNames.filter((name) =>
      transliteratedComparison(name) === transliteratedComparison(token),
    );
    if (matches.length !== 1) return token;
    changed = true;
    return matches[0];
  });
  return changed ? sanitized : target;
}

/**
 * Repair only a uniquely identifiable mixed-script proper-name corruption in
 * terminology targets. This is intended for prompt construction; callers
 * should keep the returned context out of persisted recovery fingerprints.
 */
export function sanitizeDocumentContext(context: DocumentContext): DocumentContext {
  let changed = false;
  const terminology = context.terminology.map((entry) => {
    const target = sanitizeTerminologyTarget(entry.source, entry.target);
    if (target === entry.target) return entry;
    changed = true;
    return { ...entry, target };
  });
  return changed ? { ...context, terminology } : context;
}

export { sanitizeTerminologyTarget };
