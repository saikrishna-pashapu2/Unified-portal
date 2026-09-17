// Narrow blank-number protection. Never rewrites source or output punctuation.
// The digit lookahead applies only to dash blanks, where «№ —» must be told
// apart from a dash that separates a real number («№ —123»). Underscore, dot
// and ellipsis blanks stay blanks even directly before a date or year, so a
// correct «№ ___ 2025 года» is never miscounted as a filled number.
function numberedBlankCount(text: string): number {
  return Array.from(text.matchAll(
    /(?:№|\bNo\.?|\bN|номер(?:а|ом)?)\s*["'«“]?\s*(?:[_…]+[_\-–—….]*|\.{2,}[_\-–—…]*|[-–—]+(?!\s*\d))/gi,
  )).length;
}

export function numberPlaceholderFailure(source: string, translated: string, targetLanguage: string): string | undefined {
  if (targetLanguage !== 'Russian') return undefined;
  // A leading delimiter is essential: 123-sonli / ABC-sonli are NOT blanks.
  const uzbekBlanks = Array.from(source.matchAll(/(?:^|[\s(«“])(?:[_\-–—…]+|\.{2,})\s*(?:сонли|sonli)(?![A-Za-zЀ-ӿ])/gi)).length;
  if (!uzbekBlanks) return undefined;
  const expected = uzbekBlanks + numberedBlankCount(source);
  // Fewer blanks than the source means one was filled in or dropped. More is
  // acceptable: rendering a source blank in two connected fragments must not
  // permanently fail the page.
  if (numberedBlankCount(translated) < expected) {
    return 'A blank source document number was filled or omitted; preserve each blank as an empty number placeholder such as № —, without inventing a value.';
  }
  return undefined;
}
