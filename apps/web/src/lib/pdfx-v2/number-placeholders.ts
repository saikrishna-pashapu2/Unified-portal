// Narrow blank-number protection. Never rewrites source or output punctuation.
// The digit lookahead applies only to dash blanks, where «№ —» must be told
// apart from a dash that separates a real number («№ —123»). Underscore, dot
// and ellipsis blanks stay blanks even directly before a date or year, so a
// correct «№ ___ 2025 года» is never miscounted as a filled number.
const PREFIXED_BLANK_RE = /(?:№|\bNo\.?|\bN|номер(?:а|ом)?)\s*["'«“]?\s*(?:[_…]+[_\-–—….]*|\.{2,}[_\-–—…]*|[-–—]+(?!\s*\d))/gi;
// A run of underscores is unambiguously a blank even without a «№» prefix:
// a faithful translation of «___-сонли» keeps the underscores («___-го»).
// (?!_) pins the match to the full underscore run so backtracking cannot
// shorten it to sneak past the сонли exclusion, which keeps the Uzbek source
// blank itself out because uzbekBlanks already counts it.
const BARE_BLANK_RE = /(^|[\s(«“])(_{2,})(?!_)(?!\s*[-–—]?\s*(?:сонли|sonli))/gi;

function blankCounts(text: string): { prefixed: number; bare: number } {
  const prefixed = Array.from(text.matchAll(PREFIXED_BLANK_RE));
  const covered = prefixed.map((match) => [match.index!, match.index! + match[0].length] as const);
  const bare = Array.from(text.matchAll(BARE_BLANK_RE)).filter((match) => {
    const start = match.index! + match[1].length;
    return !covered.some(([from, to]) => start >= from && start < to);
  });
  return { prefixed: prefixed.length, bare: bare.length };
}

// A leading delimiter is essential: 123-sonli / ABC-sonli are NOT blanks.
const UZBEK_BLANK_RE = /(?:^|[\s(«“])(?:[_\-–—…]+|\.{2,})\s*(?:сонли|sonli)(?![A-Za-zЀ-ӿ])/gi;

export function numberPlaceholderFailure(source: string, translated: string, targetLanguage: string): string | undefined {
  if (targetLanguage !== 'Russian') return undefined;
  const uzbekBlanks = Array.from(source.matchAll(UZBEK_BLANK_RE)).length;
  if (!uzbekBlanks) return undefined;
  const sourceCounts = blankCounts(source);
  const translatedCounts = blankCounts(translated);
  // Only сонли-blanks and «№»-prefixed blanks are demanded back. Bare source
  // underscores (a blank date such as «__.__.2025») never raise the bar, and
  // bare translated underscores earn credit only beyond the source's own bare
  // blanks — so «___-го» satisfies a «___-сонли» blank, while dropping the
  // numbered blank cannot be papered over by an unrelated blank date.
  // A «___-сонли» blank retained verbatim on the translated page (footers of
  // scanned protocols repeat it untranslated on every page) is still a blank,
  // so it earns credit too; it never counts as bare thanks to the сонли
  // exclusion, so this cannot double-count.
  const expected = uzbekBlanks + sourceCounts.prefixed;
  const retainedUzbekBlanks = Array.from(translated.matchAll(UZBEK_BLANK_RE)).length;
  const credit = translatedCounts.prefixed + retainedUzbekBlanks +
    Math.max(0, translatedCounts.bare - sourceCounts.bare);
  // Fewer blanks than the source means one was filled in or dropped. More is
  // acceptable: rendering a source blank in two connected fragments must not
  // permanently fail the page.
  if (credit < expected) {
    return 'A blank source document number was filled or omitted; preserve each blank as an empty number placeholder such as № — or ___, without inventing a value.';
  }
  return undefined;
}
