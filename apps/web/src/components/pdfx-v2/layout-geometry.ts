import type { StoredPdfPageLayout } from '@/lib/pdfx-v2/schemas';

export type PageBox = { x: number; y: number; width: number; height: number };

const A4_PORTRAIT = { width: 595.28, height: 841.89 };

export const DEFAULT_LAYOUT_ZOOM_PERCENT = 200;
export const MIN_LAYOUT_ZOOM_PERCENT = 100;
export const MAX_LAYOUT_ZOOM_PERCENT = 400;
export const LAYOUT_ZOOM_STEP_PERCENT = 25;

export function clampLayoutZoomPercent(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LAYOUT_ZOOM_PERCENT;
  return Math.max(
    MIN_LAYOUT_ZOOM_PERCENT,
    Math.min(MAX_LAYOUT_ZOOM_PERCENT, Math.round(value)),
  );
}

export function layoutZoomWidth(value: number): string {
  return `${clampLayoutZoomPercent(value)}%`;
}

export function layoutTextFitsBox({
  availableHeight,
  availableWidth,
  contentScrollHeight,
  contentScrollWidth,
}: {
  availableHeight: number;
  availableWidth: number;
  contentScrollHeight: number;
  contentScrollWidth: number;
}): boolean {
  // DOM scroll dimensions are whole pixels while SVG boxes often land on
  // fractions. Be conservative vertically so hidden overflow never cuts a
  // line, while allowing one fractional horizontal pixel caused by the
  // width:100% SVG layout quantization.
  return contentScrollHeight <= Math.max(1, Math.floor(availableHeight)) &&
    contentScrollWidth <= Math.ceil(availableWidth + 0.25);
}

export function resolvePageSize(layout: StoredPdfPageLayout) {
  const width = Number(layout.pageWidthPoints);
  const height = Number(layout.pageHeightPoints);
  if (
    Number.isFinite(width) && Number.isFinite(height) &&
    width > 0 && height > 0 && width / height >= 0.2 && width / height <= 5
  ) {
    return { width, height };
  }
  return layout.orientation === 'landscape'
    ? { width: A4_PORTRAIT.height, height: A4_PORTRAIT.width }
    : A4_PORTRAIT;
}

export function normalizedBox(
  bbox: readonly number[],
  width: number,
  height: number,
): PageBox {
  const left = Math.max(0, Math.min(1000, bbox[0] ?? 0));
  const top = Math.max(0, Math.min(1000, bbox[1] ?? 0));
  const right = Math.max(left, Math.min(1000, bbox[2] ?? left));
  const bottom = Math.max(top, Math.min(1000, bbox[3] ?? top));
  return {
    x: (left / 1000) * width,
    y: (top / 1000) * height,
    width: ((right - left) / 1000) * width,
    height: ((bottom - top) / 1000) * height,
  };
}

function estimatedLineCount(text: string, boxWidth: number, fontSize: number): number {
  const charactersPerLine = Math.max(1, Math.floor(boxWidth / Math.max(1, fontSize * 0.52)));
  return Math.max(1, text.split(/\r?\n/g).reduce(
    (count, line) => count + Math.max(1, Math.ceil(Array.from(line).length / charactersPerLine)),
    0,
  ));
}

export function fitLayoutFontSize(
  text: string,
  box: PageBox,
  maximum: number,
  minimum = 3.2,
): number {
  const max = Math.max(minimum, Math.min(maximum, box.height * 0.82));
  for (let size = max; size >= minimum; size -= 0.25) {
    if (estimatedLineCount(text, box.width, size) * size * 1.18 <= box.height + 0.25) {
      return size;
    }
  }
  return minimum;
}
