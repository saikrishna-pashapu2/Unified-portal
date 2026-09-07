import type { PdfPageLayout } from './schemas';

export function pageCanvasGeometry(width: number, height: number, rotation = 0) {
  return {
    width: rotation === 90 || rotation === 270 ? height : width,
    height: rotation === 90 || rotation === 270 ? width : height,
    transform: rotation === 90 ? `translate(${width} 0) rotate(90)`
      : rotation === 180 ? `translate(${width} ${height}) rotate(180)`
        : rotation === 270 ? `translate(0 ${height}) rotate(270)` : undefined,
  };
}

/** Same line primitives in browser and exported PDF. No source text image
 * underneath: diagrams cannot expose untranslated text through white masks. */
export function diagramLines(graphics: PdfPageLayout['graphics'], width: number, height: number) {
  const lines: { x1: number; y1: number; x2: number; y2: number; dashed: boolean }[] = [];
  for (const graphic of graphics ?? []) {
    const [l, t, r, b] = graphic.bbox;
    const points = (graphic.kind === 'rect'
      ? [{ x: l, y: t }, { x: r, y: t }, { x: r, y: b }, { x: l, y: b }, { x: l, y: t }]
      : graphic.points).map((point) => ({ x: point.x * width / 1000, y: point.y * height / 1000 }));
    for (let i = 1; i < points.length; i++) {
      lines.push({ x1: points[i - 1].x, y1: points[i - 1].y, x2: points[i].x, y2: points[i].y, dashed: graphic.dashed });
    }
    if (graphic.kind === 'polyline' && graphic.arrowEnd && points.length >= 2) {
      const end = points[points.length - 1];
      const start = points[points.length - 2];
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      for (const delta of [-0.45, 0.45]) {
        lines.push({ x1: end.x, y1: end.y, x2: end.x - 4 * Math.cos(angle + delta), y2: end.y - 4 * Math.sin(angle + delta), dashed: false });
      }
    }
  }
  return lines;
}
