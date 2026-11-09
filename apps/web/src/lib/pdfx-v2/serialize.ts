import type {
  PdfCell,
  PdfElement,
  PdfPageLayout,
  PdfPageTranslation,
} from './schemas';

const TRANSLATABLE_ELEMENT_KINDS = new Set<PdfElement['kind']>([
  'heading',
  'paragraph',
  'list',
  'table',
  'header',
  'footer',
]);

export function isTextualElement(element: PdfElement): boolean {
  return TRANSLATABLE_ELEMENT_KINDS.has(element.kind) || element.kind === 'suppressed_text';
}

export function isTranslatableElement(element: PdfElement): boolean {
  return TRANSLATABLE_ELEMENT_KINDS.has(element.kind) && element.translate;
}

export function hasTranslatableText(layout: PdfPageLayout): boolean {
  return layout.elements.some((element) => {
    if (!isTranslatableElement(element)) return false;
    if (element.kind !== 'table') return Boolean(element.text.trim());
    return element.rows.some((row) => row.cells.some((cell) => cell.translate && cell.text.trim()));
  });
}

export function listTextWithMarkers(text: string): string {
  const lines = text.split(/\r?\n/g).map((line) => line.trim()).filter(Boolean);
  return lines.map((line) =>
    /^(?:[•‣◦▪*-]|\(?\d+[.)]|\(?[A-Za-zА-Яа-я][.)])\s+/.test(line)
      ? line
      : `• ${line}`,
  ).join('\n');
}

function orderedElements(layout: PdfPageLayout): PdfElement[] {
  return [...layout.elements].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id),
  );
}

function tableMatrix(element: PdfElement): string[][] {
  const rowCount = Math.max(element.rowCount, ...element.rows.map((row) => row.rowIndex + 1), 0);
  const columnCount = Math.max(
    element.columnCount,
    ...element.rows.flatMap((row) =>
      row.cells.map((cell) => cell.columnIndex + cell.columnSpan),
    ),
    0,
  );
  const matrix = Array.from({ length: rowCount }, () =>
    Array.from({ length: columnCount }, () => ''),
  );
  for (const row of element.rows) {
    for (const cell of row.cells) {
      if (matrix[cell.rowIndex]?.[cell.columnIndex] !== undefined) {
        matrix[cell.rowIndex][cell.columnIndex] = cell.text;
      }
    }
  }
  return matrix;
}

export function pageLayoutToPlainText(layout: PdfPageLayout): string {
  const blocks: string[] = [];
  for (const element of orderedElements(layout).filter(isTextualElement)) {
    if (element.kind === 'table') {
      const matrix = tableMatrix(element);
      if (element.text.trim()) blocks.push(element.text.trim());
      blocks.push(...matrix.map((row) => row.join('\t')));
    } else if (element.kind === 'list' && element.text.trim()) {
      blocks.push(listTextWithMarkers(element.text));
    } else if (element.text.trim()) {
      blocks.push(element.text.trim());
    }
  }
  return blocks.join('\n').trim();
}

export function pageLayoutForTranslation(layout: PdfPageLayout): object {
  return {
    pageNumber: layout.pageNumber,
    sourceLanguage: layout.sourceLanguage,
    sourceScript: layout.sourceScript,
    elements: orderedElements(layout).filter(isTranslatableElement).map((element) => ({
      id: element.id,
      kind: element.kind,
      translate: element.translate,
      text: element.text,
      cells: element.kind === 'table'
        ? element.rows.flatMap((row) =>
            row.cells.map((cell) => ({
              id: cell.id,
              rowIndex: cell.rowIndex,
              columnIndex: cell.columnIndex,
              rowSpan: cell.rowSpan,
              columnSpan: cell.columnSpan,
              isHeader: cell.isHeader,
              translate: cell.translate,
              text: cell.text,
            })),
          )
        : [],
    })),
  };
}

export function mergePageTranslation(
  source: PdfPageLayout,
  translation: PdfPageTranslation,
): PdfPageLayout {
  const translatedElements = new Map(
    translation.elements.map((element) => [element.id, element]),
  );
  return {
    ...source,
    warnings: [...source.warnings, ...translation.warnings],
    elements: source.elements.map((element) => {
      if (!isTranslatableElement(element)) return element;
      const translated = translatedElements.get(element.id);
      const translatedCells = new Map(
        (translated?.cells ?? []).map((cell) => [cell.id, cell.text]),
      );
      return {
        ...element,
        text: translated?.text ?? '',
        rows: element.rows.map((row) => ({
          ...row,
          cells: row.cells.map((cell) => ({
            ...cell,
            text: cell.translate ? translatedCells.get(cell.id) ?? '' : cell.text,
          })),
        })),
      };
    }),
  };
}

export function allCells(element: PdfElement): PdfCell[] {
  return element.rows.flatMap((row) => row.cells);
}

/** Copy immutable source text back into a structurally exact fresh provider
 * proposal. Missing IDs or changed order are left untouched so validation can
 * report the actual structural failure. Persisted checkpoints are never
 * normalized through this helper. */
export function preserveSourceCellsInProposal(
  source: PdfPageLayout,
  proposal: PdfPageTranslation,
): PdfPageTranslation {
  const sourceElements = source.elements.filter(isTranslatableElement);
  if (source.pageNumber !== proposal.pageNumber || sourceElements.length !== proposal.elements.length) {
    return proposal;
  }
  const sourceById = new Map(sourceElements.map((element) => [element.id, element]));
  if (sourceById.size !== sourceElements.length || proposal.elements.some((element) => !sourceById.has(element.id))) {
    return proposal;
  }
  const sourceCellsById = new Map(sourceElements.map((element) => [element.id, allCells(element)]));
  if (!proposal.elements.every((element) => {
    const sourceCells = sourceCellsById.get(element.id);
    return sourceCells !== undefined &&
      element.cells.length === sourceCells.length &&
      sourceCells.every((cell, cellIndex) => cell.id === element.cells[cellIndex]?.id);
  })) return proposal;
  return {
    ...proposal,
    elements: proposal.elements.map((element) => ({
      ...element,
      cells: element.cells.map((cell, cellIndex) =>
        sourceCellsById.get(element.id)![cellIndex]!.translate
          ? cell
          : { ...cell, text: sourceCellsById.get(element.id)![cellIndex]!.text },
      ),
    })),
  };
}
