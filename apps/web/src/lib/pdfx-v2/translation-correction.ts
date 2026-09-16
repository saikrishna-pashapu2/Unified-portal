import {
  PdfPageLayoutSchema,
  PdfPageTranslationSchema,
  type PdfCell,
  type PdfElement,
  type PdfPageLayout,
  type PdfPageTranslation,
} from './schemas';
import { allCells, isTranslatableElement } from './serialize';

/**
 * A targeted translation request is deliberately a small, auditable patch.
 * The caller sends `source` and `previousTranslation` to the model and must
 * merge the model response through the returned function.  In particular,
 * the model never receives the full page merely because one text block was
 * rejected by semantic review.
 */
export interface TranslationCorrectionPlan {
  source: PdfPageLayout;
  previousTranslation: PdfPageTranslation;
  merge(patch: PdfPageTranslation): PdfPageTranslation;
}

type CellOwner = {
  cell: PdfCell;
  element: PdfElement;
};

type SourceIndex = {
  elementById: Map<string, PdfElement>;
  cellById: Map<string, CellOwner>;
  translatableElements: PdfElement[];
};

type StructuralCheck = {
  sourceIndex: SourceIndex;
  expectedElements: PdfElement[];
};

type IdentifierOccurrence = {
  id: string;
  start: number;
  end: number;
};

type ElementRange = {
  start: IdentifierOccurrence;
  end: IdentifierOccurrence;
  spanStart: number;
  spanEnd: number;
};

type RangeParseResult = {
  ranges: ElementRange[];
  invalid: boolean;
};

/*
 * IDs are document data, not a grammar.  Do not interpolate them into a
 * regular expression: an extracted ID may contain regex metacharacters.
 * These are only the characters which can extend the familiar e004 or
 * e005-r000-c005 identifier form when it appears inside free-form feedback.
 * IDs containing punctuation are still matched by the exact indexOf check;
 * the extra check prevents a parent ID from matching the beginning of a cell
 * ID, or e004 from matching e0040.
 */
function isIdentifierContinuation(character: string): boolean {
  if (!character) return false;
  // The web project intentionally targets ES5.  Keep this boundary check
  // ASCII-only rather than using the ES2018 Unicode-property-regex syntax;
  // structural IDs emitted by the translator use ASCII letters, digits,
  // underscores and hyphens.  Non-ASCII punctuation remains a boundary, so
  // reviewer text using curly quotes around an ID is accepted.
  return /^[A-Za-z0-9_-]$/.test(character);
}

function isDistinctiveIdentifier(identifier: string): boolean {
  // A plain alphabetic word such as "table" is too common in reviewer prose
  // to be an unambiguous citation.  IDs with digits, separators, or other
  // punctuation (e004, e4, cell-12, hash#) can be recognized safely by exact
  // token boundaries.
  return !/^[A-Za-z]+$/.test(identifier);
}

function hasExplicitPlainIdentifierLabel(text: string, identifierStart: number): boolean {
  const prefix = text.slice(0, identifierStart);
  // Require a structural label at the beginning of a sentence/clause.  This
  // keeps "in the table" from selecting an element whose ID happens to be
  // "table", while accepting "element table" and "cell: amount".  Quoted
  // plain IDs are also unambiguous and are handled below.
  return /(?:^|[.!?;:()[\]{}])\s*(?:element|elements|table|tables|cell|cells|id|region|block)(?:\s+id)?\s*(?:[:=]\s*)?["'`“”‘’]?\s*$/i.test(prefix);
}

function isQuotedIdentifier(text: string, identifierStart: number, identifier: string): boolean {
  const before = identifierStart > 0 ? text.slice(identifierStart - 1, identifierStart) : '';
  const afterIndex = identifierStart + identifier.length;
  const after = afterIndex < text.length ? text.slice(afterIndex, afterIndex + 1) : '';
  return /["'`“”‘’]/.test(before) && /["'`“”‘’]/.test(after);
}

function wholeIdentifierOccurrences(text: string, identifier: string): number[] {
  if (!identifier) return [];
  const occurrences: number[] = [];
  let offset = 0;
  while (offset <= text.length - identifier.length) {
    const found = text.indexOf(identifier, offset);
    if (found < 0) break;
    const before = found > 0 ? text.slice(found - 1, found) : '';
    const afterIndex = found + identifier.length;
    const after = afterIndex < text.length ? text.slice(afterIndex, afterIndex + 1) : '';
    const wholeToken = !isIdentifierContinuation(before) && !isIdentifierContinuation(after);
    const usable = isDistinctiveIdentifier(identifier) ||
      isQuotedIdentifier(text, found, identifier) ||
      hasExplicitPlainIdentifierLabel(text, found);
    if (wholeToken && usable) {
      occurrences.push(found);
    }
    offset = found + Math.max(identifier.length, 1);
  }
  return occurrences;
}

/**
 * A reviewer can mention an unknown e###-style ID alongside a known ID.
 * Such a response is unsafe: silently ignoring the unknown mention would
 * leave an explicitly cited defect unrepaired.  This detector is used only
 * to reject residual unknown tokens after exact known-ID matches have been
 * removed; it is never used to select a source element.
 */
function containsUnknownStructuredId(text: string): boolean {
  return /(?:^|[^A-Za-z0-9_-])e\d+(?:-r\d+-c\d+)?(?=$|[^A-Za-z0-9_-])/.test(text);
}

function isRangeSeparator(character: string): boolean {
  return character === '-' || character === '\u2013' || character === '\u2014';
}

function isWhitespace(character: string): boolean {
  return Boolean(character) && /\s/.test(character);
}

function skipWhitespaceForward(text: string, offset: number): number {
  let index = offset;
  while (index < text.length && isWhitespace(text[index] ?? '')) index += 1;
  return index;
}

function skipWhitespaceBackward(text: string, offset: number): number {
  let index = offset;
  while (index > 0 && isWhitespace(text[index - 1] ?? '')) index -= 1;
  return index;
}

/**
 * Return true only for one range separator surrounded by optional whitespace.
 * A separate helper keeps an ASCII hyphen in a structured cell ID from being
 * treated as a range operator.
 */
function isSingleRangeSeparatorBetween(text: string, start: number, end: number): boolean {
  let index = skipWhitespaceForward(text, start);
  if (index >= end || !isRangeSeparator(text[index] ?? '')) return false;
  index += 1;
  index = skipWhitespaceForward(text, index);
  return index === end;
}

function normalizedElementNumber(id: string): string | null {
  const match = /^e(\d+)$/.exec(id);
  if (!match) return null;
  return match[1]!.replace(/^0+(?=\d)/, '');
}

/**
 * Some reviewers omit the zero padding from generated IDs (e4 instead of
 * e004). Resolve that spelling only when exactly one source element can own
 * the numeric ID. Exact IDs always win, and collisions remain ambiguous.
 */
function elementNumberAliases(sourceIndex: SourceIndex): Map<string, string | null> {
  const aliases = new Map<string, string | null>();
  sourceIndex.elementById.forEach((_element, id) => {
    const number = normalizedElementNumber(id);
    if (!number) return;
    const previous = aliases.get(number);
    aliases.set(number, previous === undefined ? id : previous === id ? id : null);
  });
  return aliases;
}

function boundaryAllowsRangeSeparator(character: string): boolean {
  return isRangeSeparator(character);
}

function rangeBoundaryBefore(text: string, start: number): boolean {
  if (start <= 0) return true;
  const character = text[start - 1] ?? '';
  return !isIdentifierContinuation(character) || boundaryAllowsRangeSeparator(character);
}

function rangeBoundaryAfter(text: string, end: number): boolean {
  if (end >= text.length) return true;
  const character = text[end] ?? '';
  return !isIdentifierContinuation(character) || boundaryAllowsRangeSeparator(character);
}

function collectRangeElementOccurrences(
  text: string,
  maskedText: string,
  sourceIndex: SourceIndex,
  aliases: Map<string, string | null>,
): IdentifierOccurrence[] {
  const occurrences: IdentifierOccurrence[] = [];
  const seen = new Set<string>();
  const add = (id: string, start: number, end: number): void => {
    const key = `${id}\u0000${start}\u0000${end}`;
    if (seen.has(key)) return;
    seen.add(key);
    occurrences.push({ id, start, end });
  };

  // IDs are matched literally.  This is intentionally not a generated
  // regular expression: structural IDs can contain regex metacharacters.
  sourceIndex.elementById.forEach((_element, id) => {
    let offset = 0;
    while (offset <= maskedText.length - id.length) {
      const found = maskedText.indexOf(id, offset);
      if (found < 0) break;
      const end = found + id.length;
      if (rangeBoundaryBefore(maskedText, found) && rangeBoundaryAfter(maskedText, end)) {
        add(id, found, end);
      }
      offset = found + Math.max(id.length, 1);
    }
  });

  // Accept an unpadded e4/e6 spelling only when it maps to one source ID.
  // This regex is fixed (not derived from document data), so it does not
  // weaken the literal-ID handling above.
  const tokenPattern = /e\d+/g;
  let tokenMatch: RegExpExecArray | null;
  while ((tokenMatch = tokenPattern.exec(maskedText)) !== null) {
    const token = tokenMatch[0];
    const start = tokenMatch.index;
    const end = start + token.length;
    if (sourceIndex.elementById.has(token)) continue;
    const number = normalizedElementNumber(token);
    const id = number ? aliases.get(number) : undefined;
    if (!id || !rangeBoundaryBefore(maskedText, start) || !rangeBoundaryAfter(maskedText, end)) {
      continue;
    }
    add(id, start, end);
  }

  return occurrences.sort((left, right) =>
    left.start - right.start || right.end - left.end || left.id.localeCompare(right.id));
}

function maskKnownCellOccurrences(text: string, sourceIndex: SourceIndex): string {
  const masked = text.split('');
  sourceIndex.cellById.forEach((_owner, id) => {
    for (const occurrence of wholeIdentifierOccurrences(text, id)) {
      for (let offset = 0; offset < id.length; offset += 1) {
        masked[occurrence + offset] = ' ';
      }
    }
  });
  return masked.join('');
}

function structuredElementTokenAt(text: string, start: number): { end: number } | null {
  const match = /^e\d+/.exec(text.slice(start));
  if (!match) return null;
  return { end: start + match[0].length };
}

function structuredElementTokenBefore(text: string, end: number): { start: number } | null {
  let start = end;
  while (start > 0 && /\d/.test(text[start - 1] ?? '')) start -= 1;
  if (start <= 0 || (text[start - 1] ?? '') !== 'e') return null;
  return { start: start - 1 };
}

/**
 * Detect a structural unknown endpoint next to a cited element.  This keeps
 * `e004-e999` fail-closed instead of silently repairing only e004, while
 * allowing ordinary prose after a citation.  Known cell spans are masked by
 * the caller, so e004-r003-c007 cannot enter this path.
 */
function hasUnknownStructuredRangeEndpoint(
  maskedText: string,
  occurrences: readonly IdentifierOccurrence[],
): boolean {
  for (const occurrence of occurrences) {
    let separatorStart = skipWhitespaceForward(maskedText, occurrence.end);
    if (separatorStart >= maskedText.length || !isRangeSeparator(maskedText[separatorStart] ?? '')) {
      continue;
    }
    separatorStart += 1;
    const tokenStart = skipWhitespaceForward(maskedText, separatorStart);
    const token = structuredElementTokenAt(maskedText, tokenStart);
    if (!token) continue;
    const matchingOccurrence = occurrences.some((candidate) =>
      candidate.start === tokenStart && candidate.end === token.end,
    );
    if (!matchingOccurrence) return true;
  }

  for (const occurrence of occurrences) {
    let separatorEnd = skipWhitespaceBackward(maskedText, occurrence.start);
    if (separatorEnd <= 0 || !isRangeSeparator(maskedText[separatorEnd - 1] ?? '')) {
      continue;
    }
    separatorEnd -= 1;
    const tokenEnd = skipWhitespaceBackward(maskedText, separatorEnd);
    const token = structuredElementTokenBefore(maskedText, tokenEnd);
    if (!token) continue;
    const matchingOccurrence = occurrences.some((candidate) =>
      candidate.start === token.start && candidate.end === tokenEnd,
    );
    if (!matchingOccurrence) return true;
  }

  return false;
}

function rangeSpansOverlap(left: ElementRange, right: ElementRange): boolean {
  return left.spanStart < right.spanEnd && right.spanStart < left.spanEnd;
}

function parseElementRanges(failure: string, sourceIndex: SourceIndex): RangeParseResult {
  // Masking known cell citations first is important: the parent prefix of
  // e004-r003-c007 must never be mistaken for the left side of a range.
  const maskedText = maskKnownCellOccurrences(failure, sourceIndex);
  const aliases = elementNumberAliases(sourceIndex);
  const occurrences = collectRangeElementOccurrences(failure, maskedText, sourceIndex, aliases);
  const ranges: ElementRange[] = [];

  for (const left of occurrences) {
    for (const right of occurrences) {
      if (right.start <= left.end) continue;
      if (!isSingleRangeSeparatorBetween(maskedText, left.end, right.start)) continue;
      const range: ElementRange = {
        start: left,
        end: right,
        spanStart: left.start,
        spanEnd: right.end,
      };
      // A source element ID that covers the same text makes the hyphen
      // ambiguous (for example, an element literally named foo-bar versus a
      // foo-to-bar range). Do not guess which citation the reviewer meant.
      const exactWholeId = occurrences.some((candidate) =>
        candidate.start === range.spanStart && candidate.end === range.spanEnd &&
        candidate.id !== left.id && candidate.id !== right.id,
      );
      if (exactWholeId) return { ranges: [], invalid: true };
      if (ranges.some((existing) => rangeSpansOverlap(existing, range))) {
        return { ranges: [], invalid: true };
      }
      ranges.push(range);
    }
  }

  if (hasUnknownStructuredRangeEndpoint(maskedText, occurrences)) {
    return { ranges: [], invalid: true };
  }

  return { ranges, invalid: false };
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function buildSourceIndex(source: PdfPageLayout): SourceIndex | null {
  if (!PdfPageLayoutSchema.safeParse(source).success) return null;

  const elementById = new Map<string, PdfElement>();
  const cellById = new Map<string, CellOwner>();

  for (const element of source.elements) {
    if (!element.id || elementById.has(element.id)) return null;
    if (element.kind !== 'table' &&
        (element.rows.length > 0 || element.rowCount !== 0 || element.columnCount !== 0)) {
      return null;
    }
    elementById.set(element.id, element);

    const localCellIds = new Set<string>();
    for (const cell of allCells(element)) {
      // A cell ID must identify one cell globally.  An ID shared by an
      // element and a cell is likewise ambiguous in reviewer feedback.
      if (!cell.id || localCellIds.has(cell.id) || cellById.has(cell.id) || elementById.has(cell.id)) {
        return null;
      }
      localCellIds.add(cell.id);
      cellById.set(cell.id, { cell, element });
    }
  }

  // A later element may reuse an ID already used by an earlier table cell;
  // reject that cross-kind collision as well.
  for (const element of source.elements) {
    if (allCells(element).some((cell) => elementById.has(cell.id))) return null;
  }

  return {
    elementById,
    cellById,
    translatableElements: source.elements.filter(isTranslatableElement),
  };
}

function checkTranslationStructure(
  source: PdfPageLayout,
  sourceIndex: SourceIndex,
  translation: PdfPageTranslation,
  expectedElements: readonly PdfElement[],
): boolean {
  if (!PdfPageTranslationSchema.safeParse(translation).success) return false;
  if (translation.pageNumber !== source.pageNumber) return false;
  if (translation.elements.length !== expectedElements.length) return false;

  const seenElements = new Set<string>();
  for (let index = 0; index < expectedElements.length; index += 1) {
    const sourceElement = expectedElements[index];
    const translatedElement = translation.elements[index];
    if (translatedElement.id !== sourceElement.id || seenElements.has(translatedElement.id)) {
      return false;
    }
    seenElements.add(translatedElement.id);

    const sourceCells = allCells(sourceElement);
    if (translatedElement.cells.length !== sourceCells.length) return false;
    const seenCells = new Set<string>();
    for (let cellIndex = 0; cellIndex < sourceCells.length; cellIndex += 1) {
      const sourceCell = sourceCells[cellIndex];
      const translatedCell = translatedElement.cells[cellIndex];
      if (translatedCell.id !== sourceCell.id || seenCells.has(translatedCell.id)) {
        return false;
      }
      seenCells.add(translatedCell.id);
      if (!sourceIndex.cellById.has(translatedCell.id)) return false;
      // Protected source cells are part of a table patch so the model can
      // return the complete table shape, but they must remain verbatim.
      if (!sourceCell.translate && translatedCell.text !== sourceCell.text) return false;
    }
  }
  return true;
}

function expectedTranslationElements(
  source: PdfPageLayout,
  candidate: PdfPageTranslation,
  sourceIndex: SourceIndex,
): StructuralCheck | null {
  if (candidate.pageNumber !== source.pageNumber) return null;
  const expectedElements = sourceIndex.translatableElements;
  if (!checkTranslationStructure(source, sourceIndex, candidate, expectedElements)) return null;
  return { sourceIndex, expectedElements };
}

function expandElementRange(source: PdfPageLayout, range: ElementRange): string[] | null {
  const startIndex = source.elements.findIndex((element) => element.id === range.start.id);
  const endIndex = source.elements.findIndex((element) => element.id === range.end.id);
  if (startIndex < 0 || endIndex < 0 || startIndex > endIndex) return null;

  const selected: string[] = [];
  for (let index = startIndex; index <= endIndex; index += 1) {
    const element = source.elements[index];
    // Ranges are intentionally element-bounded and inclusive. A protected
    // or otherwise non-translatable interior is an unsafe partial repair, so
    // the caller must use the full-page fallback instead.
    if (!element || !isTranslatableElement(element)) return null;
    selected.push(element.id);
  }
  return selected;
}

function selectedFailureIds(
  failures: readonly string[],
  sourceIndex: SourceIndex,
  source: PdfPageLayout,
): string[] | null {
  if (!Array.isArray(failures) || failures.length === 0 ||
      failures.some((failure) => typeof failure !== 'string' || !failure.trim())) {
    return null;
  }

  const allKnownIds: string[] = [];
  sourceIndex.elementById.forEach((_element, id) => allKnownIds.push(id));
  sourceIndex.cellById.forEach((_owner, id) => allKnownIds.push(id));
  // Longer IDs first means a cell ID is removed from the residual text before
  // its table's shorter parent ID can be considered.
  allKnownIds.sort((left, right) => right.length - left.length || left.localeCompare(right));

  const selected = new Set<string>();
  for (const failure of failures) {
    const rangeResult = parseElementRanges(failure, sourceIndex);
    if (rangeResult.invalid) return null;
    const residual = failure.split('');
    const mentioned: string[] = [];

    for (const range of rangeResult.ranges) {
      const rangeElements = expandElementRange(source, range);
      if (!rangeElements) return null;
      mentioned.push(...rangeElements);
      for (let offset = range.spanStart; offset < range.spanEnd; offset += 1) {
        residual[offset] = ' ';
      }
      for (const id of rangeElements) selected.add(id);
    }

    for (const id of allKnownIds) {
      const occurrences = wholeIdentifierOccurrences(failure, id);
      if (occurrences.length === 0) continue;
      mentioned.push(id);
      // Remove only exact known occurrences.  This makes an unknown e###
      // mention alongside a known ID visible to the residual-token guard.
      for (const occurrence of occurrences) {
        for (let offset = 0; offset < id.length; offset += 1) {
          residual[occurrence + offset] = ' ';
        }
      }
    }
    if (mentioned.length === 0) return null;
    if (containsUnknownStructuredId(residual.join(''))) return null;

    for (const id of mentioned) {
      const element = sourceIndex.elementById.get(id);
      if (element) {
        if (!isTranslatableElement(element)) return null;
        selected.add(element.id);
        continue;
      }
      const owner = sourceIndex.cellById.get(id);
      if (!owner || !isTranslatableElement(owner.element) || !owner.cell.translate) return null;
      // Table correction is intentionally table-bounded.  Returning only one
      // cell would encourage a model to rebuild row shape or silently omit
      // neighbouring cells, so the complete existing table is sent.
      selected.add(owner.element.id);
    }
  }

  return selected.size > 0 ? Array.from(selected) : null;
}

function orderedSelection(
  sourceIndex: SourceIndex,
  selectedIds: ReadonlySet<string>,
): PdfElement[] {
  return sourceIndex.translatableElements.filter((element) => selectedIds.has(element.id));
}

function validatePatch(
  source: PdfPageLayout,
  sourceIndex: SourceIndex,
  patch: PdfPageTranslation,
  selectedElements: readonly PdfElement[],
): void {
  if (!checkTranslationStructure(source, sourceIndex, patch, selectedElements)) {
    throw new Error('Targeted translation correction did not return exactly the requested element and cell IDs.');
  }
}

/**
 * Plan a correction only when every reviewer failure points to a known,
 * translatable source region.  `null` deliberately means "fall back to a
 * complete-page translation" to avoid making an uncited or ambiguous repair.
 */
export function planTranslationCorrection(
  source: PdfPageLayout,
  candidate: PdfPageTranslation,
  failures: readonly string[],
): TranslationCorrectionPlan | null {
  const sourceIndex = buildSourceIndex(source);
  if (!sourceIndex) return null;
  const structure = expectedTranslationElements(source, candidate, sourceIndex);
  if (!structure) return null;

  const failureIds = selectedFailureIds(failures, sourceIndex, source);
  if (!failureIds) return null;
  const selectedIdSet = new Set(failureIds);
  const selectedElements = orderedSelection(sourceIndex, selectedIdSet);
  if (selectedElements.length === 0 || selectedElements.length === structure.expectedElements.length) {
    // A targeted request has no value if it covers the whole page.  The
    // caller should use its ordinary full-page retry/review path instead.
    return null;
  }

  let sourceSubset: PdfPageLayout;
  let previousSubset: PdfPageTranslation;
  try {
    sourceSubset = cloneValue(source);
    sourceSubset.elements = source.elements
      .filter((element) => selectedIdSet.has(element.id))
      .map((element) => cloneValue(element));

    previousSubset = cloneValue(candidate);
    previousSubset.elements = candidate.elements
      .filter((element) => selectedIdSet.has(element.id))
      .map((element) => cloneValue(element));
  } catch {
    // A schema-valid object carrying a non-cloneable extension is not a safe
    // checkpoint to send to a provider.  Leave the caller on its full-page
    // fallback path rather than sharing mutable references.
    return null;
  }

  return {
    source: sourceSubset,
    previousTranslation: previousSubset,
    merge(patch: PdfPageTranslation): PdfPageTranslation {
      validatePatch(source, sourceIndex, patch, selectedElements);
      const patchById = new Map(patch.elements.map((element) => [element.id, element]));
      const merged = cloneValue(candidate);
      merged.elements = candidate.elements.map((element) => {
        const replacement = patchById.get(element.id);
        return replacement && selectedIdSet.has(element.id)
          ? cloneValue(replacement)
          : cloneValue(element);
      });
      merged.warnings = [...candidate.warnings, ...patch.warnings];
      return merged;
    },
  };
}
