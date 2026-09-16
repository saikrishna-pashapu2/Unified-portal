// Narrow blank-number protection. Never rewrites source or output punctuation.
function numberedBlankCount(text: string): number {
  return Array.from(text.matchAll(/(?:№|\bNo\.?|\bN|номер(?:а|ом)?)\s*["'«“]?\s*(?:[_\-–—…]+|\.{2,})(?!\s*\d)/gi)).length;
}

export function numberPlaceholderFailure(source: string, translated: string, targetLanguage: string): string | undefined {
  if (targetLanguage !== 'Russian') return undefined;
  // A leading delimiter is essential: 123-sonli / ABC-sonli are NOT blanks.
  const uzbekBlanks = Array.from(source.matchAll(/(?:^|[\s(«“])(?:[_\-–—…]+|\.{2,})\s*(?:сонли|sonli)(?![A-Za-z\u0400-\u04ff])/gi)).length;
  if (!uzbekBlanks) return undefined;
  const expected = uzbekBlanks + numberedBlankCount(source);
  if (numberedBlankCount(translated) !== expected) {
    return 'A blank source document number was filled or omitted; preserve each blank as an empty number placeholder such as № —, without inventing a value.';
  }
  return undefined;
}
