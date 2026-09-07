import { validateTranslationResult } from './language-validation';
import type { PdfPageLayout, PdfPageTranslation } from './schemas';
import {
  allCells,
  isTranslatableElement,
  isTextualElement,
  mergePageTranslation,
  pageLayoutToPlainText,
} from './serialize';
import type { PdfxV2Validation } from './types';

export class PdfxV2ValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PdfxV2ValidationError';
  }
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return Array.from(repeated);
}

const VISUAL_ONLY_KINDS = new Set<PdfPageLayout['elements'][number]['kind']>([
  'image',
  'stamp',
  'signature',
  'other',
]);

const VISUAL_DESCRIPTION = /\b(?:logo featuring|horizontal line|double line|handwritten (?:note|mark|signature)|decorative (?:line|border)|green line|blue handwritten)\b/i;

function validBBox(bbox: readonly number[]): boolean {
  return bbox.length === 4 && bbox.every((value) => Number.isFinite(value) && value >= 0 && value <= 1000) &&
    bbox[0] < bbox[2] && bbox[1] < bbox[3];
}

function bboxArea(bbox: readonly number[]): number {
  return Math.max(0, (bbox[2] ?? 0) - (bbox[0] ?? 0)) *
    Math.max(0, (bbox[3] ?? 0) - (bbox[1] ?? 0));
}

function bboxIntersectionArea(left: readonly number[], right: readonly number[]): number {
  return Math.max(0, Math.min(left[2], right[2]) - Math.max(left[0], right[0])) *
    Math.max(0, Math.min(left[3], right[3]) - Math.max(left[1], right[1]));
}

function containsBBox(outer: readonly number[], inner: readonly number[], tolerance = 4): boolean {
  return inner[0] >= outer[0] - tolerance &&
    inner[1] >= outer[1] - tolerance &&
    inner[2] <= outer[2] + tolerance &&
    inner[3] <= outer[3] + tolerance;
}

function unionBBoxes(boxes: readonly (readonly number[])[]): readonly number[] | null {
  if (boxes.length === 0) return null;
  return [
    Math.min(...boxes.map((box) => box[0])),
    Math.min(...boxes.map((box) => box[1])),
    Math.max(...boxes.map((box) => box[2])),
    Math.max(...boxes.map((box) => box[3])),
  ];
}

function sourceLanguages(value: string): string[] {
  return Array.from(new Set(
    value.toLocaleLowerCase().match(/english|uzbek|russian|arabic/g) ?? [],
  ));
}

function scriptCharacters(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function likelyUnsuppressedParallelLanguages(layout: PdfPageLayout): boolean {
  const hasProtectedText = layout.elements.some((element) =>
    (isTextualElement(element) && !element.translate && element.text.trim()) ||
    allCells(element).some((cell) => !cell.translate && cell.text.trim()),
  );
  if (hasProtectedText) return false;
  const languageLabel = layout.sourceLanguage.toLocaleLowerCase();
  if (
    sourceLanguages(languageLabel).length > 1 &&
    /(?:bilingual|parallel|\+|\/|,|\band\b)/.test(languageLabel)
  ) return true;

  const blocks = layout.elements.filter((element) =>
    isTranslatableElement(element) && element.kind !== 'table' && element.text.trim(),
  );
  const left = blocks.filter((element) => (element.bbox[0] + element.bbox[2]) / 2 < 475);
  const right = blocks.filter((element) => (element.bbox[0] + element.bbox[2]) / 2 > 525);
  if (left.length < 2 || right.length < 2) return false;

  const leftText = left.map((element) => element.text).join(' ');
  const rightText = right.map((element) => element.text).join(' ');
  const leftLatin = scriptCharacters(leftText, /[A-Za-z]/g);
  const leftCyrillic = scriptCharacters(leftText, /[\u0400-\u04FF]/g);
  const rightLatin = scriptCharacters(rightText, /[A-Za-z]/g);
  const rightCyrillic = scriptCharacters(rightText, /[\u0400-\u04FF]/g);
  return (leftLatin >= 120 && rightCyrillic >= 120) ||
    (leftCyrillic >= 120 && rightLatin >= 120);
}

export function validateExtractedPage(
  layout: PdfPageLayout,
  expectedPageNumber: number,
): PdfxV2Validation {
  const failures: string[] = [];
  const warnings = [...layout.warnings];
  if (warnings.some((warning) => /(?:table|printed|typed).*(?:unreadable|illegible|omitted|incomplete|difficult to distinguish|cannot read|could not read)|(?:omitted|incomplete|unreadable).*(?:table|rows|cells|printed)/i.test(warning))) {
    failures.push('OCR reported incomplete printed content; re-read the detailed page views instead of accepting missing text');
  }
  if (!layout.elements.some((element) => element.text.trim() || allCells(element).some((cell) => cell.text.trim())) &&
      layout.warnings.some((warning) => /unreadable|illegible|unable|cannot read|could not|неразборчив/i.test(warning))) {
    failures.push('OCR reported unreadable content; an empty extraction is not a completed page');
  }
  if ((layout.graphics?.length ?? 0) > 2000) failures.push('too many structural graphics');
  for (const graphic of layout.graphics ?? []) {
    if (graphic.kind === 'rect' && !validBBox(graphic.bbox)) failures.push('invalid diagram rectangle');
    if (graphic.kind === 'polyline' && (graphic.points.length < 2 || graphic.points.length > 100 ||
        graphic.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1000 || point.y < 0 || point.y > 1000))) failures.push('invalid diagram connector');
  }
  if (layout.pageNumber !== expectedPageNumber) {
    failures.push(`expected page ${expectedPageNumber}, received page ${layout.pageNumber}`);
  }
  if (layout.width !== 1000 || layout.height !== 1000) {
    failures.push('page width and height must both use the normalized 1000-unit canvas');
  }
  const elementIds = layout.elements.map((element) => element.id.trim());
  if (elementIds.some((id) => !id)) failures.push('one or more elements have an empty ID');
  const repeatedElements = duplicates(elementIds);
  if (repeatedElements.length) failures.push(`duplicate element IDs: ${repeatedElements.join(', ')}`);
  const repeatedOrders = duplicates(layout.elements.map((element) => String(element.order)));
  if (repeatedOrders.length) failures.push(`duplicate element reading orders: ${repeatedOrders.join(', ')}`);

  if (likelyUnsuppressedParallelLanguages(layout)) {
    failures.push(
      'parallel bilingual content was not routed safely: preserve every language track verbatim and set translate=false on all English or already-target-language regions',
    );
  }

  for (const element of layout.elements) {
    if (!validBBox(element.bbox)) {
      failures.push(`element ${element.id} has an invalid normalized bounding box`);
    }
    if (VISUAL_ONLY_KINDS.has(element.kind) && element.text.trim()) {
      failures.push(`visual-only element ${element.id} must not contain a translatable description`);
    }
    if (VISUAL_ONLY_KINDS.has(element.kind) && element.translate) {
      failures.push(`visual-only element ${element.id} must set translate=false`);
    }
    if (element.kind === 'page_number' && element.translate) {
      failures.push(`page number element ${element.id} must set translate=false`);
    }
    if (element.kind === 'suppressed_text' && !element.text.trim()) {
      failures.push(
        `suppressed language element ${element.id} must retain its verbatim source text for original-page reconstruction`,
      );
    }
    if (element.kind === 'suppressed_text' && element.translate) {
      failures.push(`protected source element ${element.id} must set translate=false`);
    }
    if (isTextualElement(element) && VISUAL_DESCRIPTION.test(element.text)) {
      failures.push(`element ${element.id} describes styling instead of transcribing document text`);
    }
    if (
      element.kind !== 'table' &&
      isTextualElement(element) &&
      element.text.length >= 400 &&
      bboxArea(element.bbox) >= 550_000
    ) {
      failures.push(`element ${element.id} collapses too much page content into one oversized text box`);
    }
    const cells = allCells(element);
    const repeatedCells = duplicates(cells.map((cell) => cell.id.trim()));
    if (repeatedCells.length) {
      failures.push(`element ${element.id} has duplicate cell IDs: ${repeatedCells.join(', ')}`);
    }
    if (element.kind === 'table') {
      if (element.columnCount < 1 || element.rowCount < 1 || cells.length < 1) {
        failures.push(`table ${element.id} has no complete grid`);
      }
      if (element.text.trim()) {
        failures.push(`table ${element.id} must keep its caption in a separate text element`);
      }
      const tableCharacters = cells.reduce((total, cell) => total + cell.text.length, 0);
      const tableNeedsTranslation = cells.some((cell) => cell.translate && cell.text.trim());
      if (element.translate !== tableNeedsTranslation) {
        failures.push(
          `table ${element.id} translate flag must match whether any non-empty cell needs translation`,
        );
      }
      if (
        element.rowCount === 1 &&
        element.columnCount <= 2 &&
        tableCharacters >= 250 &&
        bboxArea(element.bbox) >= 240_000
      ) {
        failures.push(
          `table ${element.id} looks like whole-page or bilingual columns collapsed into one row`,
        );
      }
      if (element.columnCount > 200 || element.rowCount > 2_000) {
        failures.push(`table ${element.id} declares implausible grid dimensions`);
        continue;
      }
      const coverage = Array.from({ length: element.rowCount }, () =>
        Array.from({ length: element.columnCount }, () => 0),
      );
      for (const cell of cells) {
        if (!validBBox(cell.bbox)) {
          failures.push(`table ${element.id} cell ${cell.id} has an invalid normalized bounding box`);
        }
        if (!containsBBox(element.bbox, cell.bbox)) {
          failures.push(`table ${element.id} cell ${cell.id} lies outside the table bounding box`);
        }
        if (
          cell.rowIndex + cell.rowSpan > element.rowCount ||
          cell.columnIndex + cell.columnSpan > element.columnCount
        ) {
          failures.push(`table ${element.id} cell ${cell.id} lies outside the declared grid`);
          continue;
        }
        for (let row = cell.rowIndex; row < cell.rowIndex + cell.rowSpan; row += 1) {
          for (
            let column = cell.columnIndex;
            column < cell.columnIndex + cell.columnSpan;
            column += 1
          ) {
            coverage[row][column] += 1;
          }
        }
      }
      const uncovered = coverage.reduce(
        (count, row) => count + row.filter((value) => value === 0).length,
        0,
      );
      const overlaps = coverage.reduce(
        (count, row) => count + row.filter((value) => value > 1).length,
        0,
      );
      if (uncovered > 0) {
        failures.push(`table ${element.id} is missing ${uncovered} grid position(s)`);
      }
      if (overlaps > 0) {
        failures.push(`table ${element.id} overlaps ${overlaps} grid position(s)`);
      }
      const cellUnion = unionBBoxes(cells.map((cell) => cell.bbox));
      if (
        cellUnion &&
        cellUnion.some((value, index) => Math.abs(value - element.bbox[index]) > 20)
      ) {
        failures.push(`table ${element.id} bounding box does not match the union of its cells`);
      }
      for (let rowIndex = 0; rowIndex < element.rowCount; rowIndex += 1) {
        const rowCells = cells.filter((cell) => cell.rowIndex === rowIndex && cell.rowSpan === 1);
        if (rowCells.length > 1) {
          const tops = rowCells.map((cell) => cell.bbox[1]);
          const bottoms = rowCells.map((cell) => cell.bbox[3]);
          if (Math.max(...tops) - Math.min(...tops) > 20 ||
              Math.max(...bottoms) - Math.min(...bottoms) > 20) {
            failures.push(`table ${element.id} row ${rowIndex} has inconsistent visual boundaries`);
          }
        }
      }
      for (let columnIndex = 0; columnIndex < element.columnCount; columnIndex += 1) {
        const columnCells = cells.filter((cell) =>
          cell.columnIndex === columnIndex && cell.columnSpan === 1,
        );
        if (columnCells.length > 1) {
          const lefts = columnCells.map((cell) => cell.bbox[0]);
          const rights = columnCells.map((cell) => cell.bbox[2]);
          if (Math.max(...lefts) - Math.min(...lefts) > 20 ||
              Math.max(...rights) - Math.min(...rights) > 20) {
            failures.push(`table ${element.id} column ${columnIndex} has inconsistent visual boundaries`);
          }
        }
      }
    } else if (element.rows.length || element.columnCount || element.rowCount) {
      failures.push(`non-table element ${element.id} unexpectedly contains table geometry`);
    }
  }

  const positionedText = layout.elements.filter(isTextualElement);
  for (let leftIndex = 0; leftIndex < positionedText.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < positionedText.length; rightIndex += 1) {
      const left = positionedText[leftIndex];
      const right = positionedText[rightIndex];
      const smallerArea = Math.min(bboxArea(left.bbox), bboxArea(right.bbox));
      const overlapArea = bboxIntersectionArea(left.bbox, right.bbox);
      if (smallerArea > 0 && overlapArea > 300 && overlapArea / smallerArea > 0.15) {
        failures.push(
          `elements ${left.id} and ${right.id} have overlapping text regions that would overwrite each other`,
        );
      }
    }
  }

  return { valid: failures.length === 0, failures, warnings };
}

function numberTokens(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of text.match(/\d+(?:[.,:/-]\d+)*/g) ?? []) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function equalCounts(left: Map<string, number>, right: Map<string, number>): boolean {
  if (left.size !== right.size) return false;
  let equal = true;
  left.forEach((count, key) => {
    if (right.get(key) !== count) equal = false;
  });
  return equal;
}

function countDifference(
  expected: Map<string, number>,
  actual: Map<string, number>,
): string[] {
  const difference: string[] = [];
  expected.forEach((count, token) => {
    const delta = count - (actual.get(token) ?? 0);
    if (delta > 0) difference.push(delta === 1 ? token : `${token} (x${delta})`);
  });
  return difference.slice(0, 20);
}

function lexicalTokens(text: string): string[] {
  return (text.toLocaleLowerCase().match(/[A-Za-z\u0400-\u04FF\u0600-\u06FF]+/g) ?? [])
    .filter((token) => token.length > 1);
}

function looksEffectivelyUnchanged(source: string, translated: string): boolean {
  const sourceTokens = lexicalTokens(source);
  const translatedTokens = lexicalTokens(translated);
  if (sourceTokens.length < 3 || translatedTokens.length < 3) return false;
  const normalizedSource = sourceTokens.join(' ');
  const normalizedTranslation = translatedTokens.join(' ');
  if (normalizedSource === normalizedTranslation) return true;
  if (sourceTokens.length < 8) return false;
  const translatedCounts = new Map<string, number>();
  for (const token of translatedTokens) {
    translatedCounts.set(token, (translatedCounts.get(token) ?? 0) + 1);
  }
  let matches = 0;
  for (const token of sourceTokens) {
    const remaining = translatedCounts.get(token) ?? 0;
    if (remaining > 0) {
      matches += 1;
      translatedCounts.set(token, remaining - 1);
    }
  }
  return matches / Math.max(sourceTokens.length, translatedTokens.length) >= 0.88;
}

function translatablePageText(layout: PdfPageLayout): string {
  const blocks: string[] = [];
  for (const element of [...layout.elements]
    .filter(isTranslatableElement)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))) {
    if (element.kind === 'table') {
      for (const row of [...element.rows].sort((left, right) => left.rowIndex - right.rowIndex)) {
        const cells = [...row.cells]
          .sort((left, right) => left.columnIndex - right.columnIndex)
          .filter((cell) => cell.translate);
        if (cells.length) blocks.push(cells.map((cell) => cell.text).join('\t'));
      }
    } else if (element.text.trim()) {
      blocks.push(element.text.trim());
    }
  }
  return blocks.join('\n').trim();
}

export function validateTranslatedPage(
  source: PdfPageLayout,
  translation: PdfPageTranslation,
  targetLanguage: string,
): PdfxV2Validation {
  const failures: string[] = [];
  const warnings = [...translation.warnings];
  if (translation.pageNumber !== source.pageNumber) {
    failures.push(`translation returned page ${translation.pageNumber} for source page ${source.pageNumber}`);
  }

  const sourceElements = source.elements.filter(isTranslatableElement);
  const sourceIds = sourceElements.map((element) => element.id);
  const translatedIds = translation.elements.map((element) => element.id);
  if (sourceIds.length !== translatedIds.length ||
      sourceIds.some((id, index) => translatedIds[index] !== id)) {
    failures.push('translated elements do not preserve the exact source order and IDs');
  }

  const translatedById = new Map(translation.elements.map((element) => [element.id, element]));
  for (const sourceElement of sourceElements) {
    const translatedElement = translatedById.get(sourceElement.id);
    if (!translatedElement) continue;
    if (sourceElement.text.trim() && !translatedElement.text.trim()) {
      failures.push(`element ${sourceElement.id} lost its text`);
    } else if (!sourceElement.text.trim() && translatedElement.text.trim()) {
      failures.push(`element ${sourceElement.id} added text where the source is empty`);
    }
    const sourceCells = allCells(sourceElement);
    const translatedCellIds = translatedElement.cells.map((cell) => cell.id);
    if (
      sourceCells.length !== translatedCellIds.length ||
      sourceCells.some((cell, index) => translatedCellIds[index] !== cell.id)
    ) {
      failures.push(`table ${sourceElement.id} does not preserve cell order and IDs`);
      continue;
    }
    translatedElement.cells.forEach((cell, index) => {
      if (sourceCells[index]?.text.trim() && !cell.text.trim()) {
        failures.push(`table cell ${cell.id} lost its text`);
      } else if (!sourceCells[index]?.text.trim() && cell.text.trim()) {
        failures.push(`table cell ${cell.id} added text where the source is empty`);
      }
      if (sourceCells[index] && !sourceCells[index].translate && cell.text !== sourceCells[index].text) {
        failures.push(`protected English or target-language table cell ${cell.id} changed`);
      }
    });
  }

  const merged = mergePageTranslation(source, translation);
  const sourceText = pageLayoutToPlainText(source);
  const translatedText = pageLayoutToPlainText(merged);
  const sourceNumbers = numberTokens(sourceText);
  const translatedNumbers = numberTokens(translatedText);
  if (!equalCounts(sourceNumbers, translatedNumbers)) {
    const missing = countDifference(sourceNumbers, translatedNumbers);
    const added = countDifference(translatedNumbers, sourceNumbers);
    failures.push(
      'numeric values or legal references changed during translation' +
      `${missing.length ? `; restore exactly: ${missing.join(', ')}` : ''}` +
      `${added.length ? `; remove or correct: ${added.join(', ')}` : ''}`,
    );
  }
  const translatableSourceText = translatablePageText(source);
  const translatableTranslatedText = translatablePageText(merged);
  const languageFailure = validateTranslationResult(
    translatableSourceText,
    targetLanguage,
    translatableTranslatedText,
  );
  if (languageFailure) failures.push(languageFailure);
  if (
    translatableSourceText &&
    looksEffectivelyUnchanged(translatableSourceText, translatableTranslatedText)
  ) {
    failures.push(
      `page ${source.pageNumber} is effectively unchanged from ${source.sourceLanguage}; ` +
      `it was not translated into ${targetLanguage}`,
    );
  }

  return { valid: failures.length === 0, failures, warnings };
}
