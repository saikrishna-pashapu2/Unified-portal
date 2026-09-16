'use client';

import { useId, useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import type { PdfElement, StoredPdfPageLayout } from '@/lib/pdfx-v2/schemas';
import { listTextWithMarkers } from '@/lib/pdfx-v2/serialize';
import { pageCanvasGeometry, diagramLines } from '@/lib/pdfx-v2/diagram-geometry';
import {
  clampLayoutZoomPercent,
  DEFAULT_LAYOUT_ZOOM_PERCENT,
  fitLayoutFontSize,
  layoutTextFitsBox,
  layoutZoomWidth,
  normalizedBox,
  resolvePageSize,
  type PageBox,
} from './layout-geometry';

type PdfLayoutCanvasProps = {
  emptyLabel: string;
  label: string;
  layout?: StoredPdfPageLayout | null;
  onFitZoom?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  text: string;
  variant: 'original' | 'translated';
  zoomPercent?: number;
};

const VISUAL_KINDS = new Set<PdfElement['kind']>([
  'image',
  'stamp',
  'signature',
  'other',
]);
const NUMERIC_TEXT = /^[\s\d.,:%/()+\-–—]+$/;

function blockStyle(
  element: PdfElement,
  box: PageBox,
  text: string,
): CSSProperties {
  const heading = element.kind === 'heading';
  const headerOrFooter = element.kind === 'header' || element.kind === 'footer';
  const fontSize = fitLayoutFontSize(
    text,
    box,
    heading ? (element.level <= 1 ? 18 : 14) : headerOrFooter ? 9.5 : 11,
  );
  return {
    boxSizing: 'border-box',
    color: '#101827',
    fontFamily: heading
      ? 'Georgia, "Times New Roman", serif'
      : '"DejaVu Sans", "Segoe UI", sans-serif',
    fontSize,
    fontWeight: heading || element.kind === 'header' ? 700 : 400,
    lineHeight: 1.18,
    textAlign: heading ? 'center' : 'left',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    width: '100%',
  };
}

function FittedText({
  box,
  children,
  maximumFontSize,
  minimumFontSize = 1.5,
  style,
  verticallyCentered = false,
}: {
  box: PageBox;
  children: string;
  maximumFontSize: number;
  minimumFontSize?: number;
  style: CSSProperties;
  verticallyCentered?: boolean;
}) {
  minimumFontSize=Math.max(0.05,Math.min(minimumFontSize,box.height/8,box.width/30));
  const outerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const initialFontSize = fitLayoutFontSize(
    children,
    box,
    maximumFontSize,
    minimumFontSize,
  );

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const content = textRef.current;
    if (!outer || !content) return;

    const fit = () => {
      const outerStyle = getComputedStyle(outer);
      const availableHeight = parseFloat(outerStyle.height) -
        parseFloat(outerStyle.paddingTop) - parseFloat(outerStyle.paddingBottom);
      const availableWidth = parseFloat(outerStyle.width) -
        parseFloat(outerStyle.paddingLeft) - parseFloat(outerStyle.paddingRight);
      if (!(availableHeight > 0 && availableWidth > 0)) return;
      let low = minimumFontSize;
      let high = Math.max(
        low,
        Math.min(maximumFontSize, Math.max(low, box.height * 0.82)),
      );
      let fitted = low;
      for (let pass = 0; pass < 14; pass += 1) {
        const candidate = (low + high) / 2;
        content.style.fontSize = `${candidate}px`;
        // The content is already constrained to width: 100%. Comparing its
        // computed width with the padded parent introduces SVG sub-pixel
        // rounding differences and used to reject every candidate font size.
        const fits = layoutTextFitsBox({
          availableHeight,
          availableWidth,
          contentScrollHeight: content.scrollHeight,
          contentScrollWidth: content.scrollWidth,
        });
        if (fits) {
          fitted = candidate;
          low = candidate;
        } else {
          high = candidate;
        }
      }
      content.style.fontSize = `${Math.max(minimumFontSize, fitted)}px`;
    };

    fit();
    void document.fonts?.ready.then(fit);
  }, [box.height, box.width, children, maximumFontSize, minimumFontSize]);

  return (
    <div
      ref={outerRef}
      style={{
        alignItems: verticallyCentered ? 'center' : 'flex-start',
        boxSizing: 'border-box',
        display: 'flex',
        height: '100%',
        justifyContent: 'center',
        overflow: 'hidden',
        padding: `${verticallyCentered?0:Math.min(0.15,box.height/12)}px ${Math.min(0.7,box.width/12)}px`,
        width: '100%',
      }}
    >
      <div ref={textRef} dir="auto" style={{ ...style, fontSize: initialFontSize }}>
        {children}
      </div>
    </div>
  );
}

function TextBlock({
  element,
  pageWidth,
  pageHeight,
}: {
  element: PdfElement;
  pageWidth: number;
  pageHeight: number;
}) {
  const box = normalizedBox(element.bbox, pageWidth, pageHeight);
  const text = element.kind === 'list' ? listTextWithMarkers(element.text) : element.text;
  if (!text.trim()) return null;
  return (
    <foreignObject
      data-element-id={element.id}
      height={box.height}
      width={box.width}
      x={box.x}
      y={box.y}
    >
      <FittedText
        box={box}
        maximumFontSize={element.kind === 'heading'
          ? (element.level <= 1 ? 18 : 14)
          : element.kind === 'header' || element.kind === 'footer' ? 9.5 : 11}
        style={blockStyle(element, box, text)}
        verticallyCentered={element.kind === 'heading'}
      >
        {text}
      </FittedText>
    </foreignObject>
  );
}

function TableBlock({
  element,
  pageWidth,
  pageHeight,
}: {
  element: PdfElement;
  pageWidth: number;
  pageHeight: number;
}) {
  return (
    <g data-element-id={element.id}>
      {element.rows.flatMap((row) => row.cells).map((cell) => {
        const box = normalizedBox(cell.bbox, pageWidth, pageHeight);
        const fontSize = fitLayoutFontSize(cell.text, box, cell.isHeader ? 8.5 : 9, 2.8);
        const alignment = cell.isHeader ? 'center' : NUMERIC_TEXT.test(cell.text) ? 'right' : 'left';
        return (
          <g key={cell.id} data-cell-id={cell.id}>
            <rect
              fill={cell.isHeader ? '#f1f5f9' : '#ffffff'}
              height={box.height}
              stroke="#64748b"
              strokeWidth={Math.min(0.55,box.height*0.08,box.width*0.08)}
              vectorEffect="non-scaling-stroke"
              width={box.width}
              x={box.x}
              y={box.y}
            />
            {cell.text.trim() && (
              <foreignObject
                height={box.height}
                width={box.width}
                x={box.x}
                y={box.y}
              >
                <FittedText
                  box={box}
                  maximumFontSize={cell.isHeader ? 8.5 : 9}
                  minimumFontSize={1.4}
                  style={{
                    color: '#101827',
                    fontFamily: '"DejaVu Sans", "Segoe UI", sans-serif',
                    fontSize,
                    fontWeight: cell.isHeader ? 700 : 400,
                    lineHeight: 1.12,
                    overflowWrap: 'anywhere',
                    textAlign: alignment,
                    whiteSpace: 'pre-wrap',
                    width: '100%',
                  }}
                  verticallyCentered={cell.isHeader}
                >
                  {cell.text}
                </FittedText>
              </foreignObject>
            )}
          </g>
        );
      })}
    </g>
  );
}

export function PdfLayoutCanvas({
  emptyLabel,
  label,
  layout,
  onFitZoom,
  onZoomIn,
  onZoomOut,
  text,
  variant,
  zoomPercent = DEFAULT_LAYOUT_ZOOM_PERCENT,
}: PdfLayoutCanvasProps) {
  const instructionsId = useId();

  if (!layout) {
    if (!text.trim()) {
      return <div className="grid min-h-64 place-items-center p-8 text-sm italic text-slate-400">{emptyLabel}</div>;
    }
    return <pre className="m-0 whitespace-pre-wrap break-words p-6 text-xs leading-relaxed text-slate-800">{text}</pre>;
  }

  const size = resolvePageSize(layout);
  const canvas = pageCanvasGeometry(size.width, size.height, layout.rotation);
  const elements = [...layout.elements]
    .filter((element) => !VISUAL_KINDS.has(element.kind))
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const safeZoomPercent = clampLayoutZoomPercent(zoomPercent);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if ((event.key === '+' || event.key === '=') && onZoomIn) {
      event.preventDefault();
      onZoomIn();
    } else if (event.key === '-' && onZoomOut) {
      event.preventDefault();
      onZoomOut();
    } else if (event.key === '0' && onFitZoom) {
      event.preventDefault();
      onFitZoom();
    }
  };

  return (
    <div className="bg-slate-200 p-2 sm:p-3">
      <p id={instructionsId} className="sr-only">
        This selectable page is shown at {safeZoomPercent} percent. Use plus and minus to zoom, or zero to fit the whole page width. Scroll horizontally when zoomed.
      </p>
      <div
        aria-describedby={instructionsId}
        aria-keyshortcuts="+ - 0"
        aria-label={`${label} viewer at ${safeZoomPercent} percent zoom`}
        className="overflow-x-auto overscroll-x-contain rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 [scrollbar-gutter:stable]"
        data-layout-zoom={safeZoomPercent}
        onKeyDown={handleKeyDown}
        role="region"
        tabIndex={0}
      >
        <div
          className="min-w-full transition-[width] duration-200 motion-reduce:transition-none"
          style={{ width: layoutZoomWidth(safeZoomPercent) }}
        >
          <svg
            aria-label={`${label}, geometry-preserving selectable text layout`}
            className="block h-auto w-full max-w-none bg-white shadow-sm"
            data-layout-variant={variant}
            preserveAspectRatio="xMidYMid meet"
            role="document"
            viewBox={`0 0 ${size.width} ${size.height}`}
          >
            <rect fill="#ffffff" height={size.height} width={size.width} x={0} y={0} />
            <g transform={canvas.transform}>
            {diagramLines(layout.graphics, canvas.width, canvas.height).map((line, index) => (
              <line key={`line-${index}`} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
                stroke="#101827" strokeWidth={0.65} strokeDasharray={line.dashed ? '3 2' : undefined} />
            ))}
            {elements.map((element) => element.kind === 'table'
              ? (
                  <TableBlock
                    key={element.id}
                    element={element}
                    pageHeight={canvas.height}
                    pageWidth={canvas.width}
                  />
                )
              : (
                  <TextBlock
                    key={element.id}
                    element={element}
                    pageHeight={canvas.height}
                    pageWidth={canvas.width}
                  />
                ))}
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
}
