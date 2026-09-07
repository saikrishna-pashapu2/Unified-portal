import type { PdfPageLayout } from './schemas';

type Rule = { axis: 'h' | 'v'; fixed: number; from: number; to: number };
/** Detect long black printed rules locally. No OCR, API or image background is
 * involved. Text, signatures and logos are not painted behind the translation. */
export async function detectScanRules(png: Buffer) {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  const width = image.width, height = image.height;
  const dark = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return data[i] < 160 && data[i + 1] < 160 && data[i + 2] < 160;
  };
  const rules: Rule[] = [];
  for (const axis of ['h', 'v'] as const) {
    const span = axis === 'h' ? width : height;
    const rows = axis === 'h' ? height : width;
    const minimum = Math.max(24, (axis === 'h' ? width : height) * 0.015);
    const raw: Rule[] = [];
    for (let fixed = 3; fixed < rows - 3; fixed += 2) {
      let start = -1, missing = 0;
      for (let position = 0; position <= span; position++) {
        let ink = false;
        if (position < span) for (let band = -3; band <= 3; band++) {
          if (axis === 'h' ? dark(position, fixed + band) : dark(fixed + band, position)) { ink = true; break; }
        }
        if (ink) { if (start < 0) start = position; missing = 0; }
        else if (start >= 0 && (++missing > 2 || position === span)) {
          const end = position - missing + 1;
          if (end - start >= minimum) {
            // Distinguish an actual thin rule from a word connected by the
            // search band. Allow slight scan skew, but require a continuous
            // dark path; text strokes do not cover 72% of a straight line.
            let best = 0;
            for (const slope of [-0.02, 0, 0.02]) for (let offset = -3; offset <= 3; offset++) {
              let hit = 0, samples = 0;
              for (let p = start + 2; p < end - 2; p += 2) {
                const f = Math.round(fixed + offset + slope * (p - (start + end) / 2));
                if (f < 1 || f >= rows - 1) continue;
                samples++;
                if ([-1,0,1].some((delta) => axis === 'h' ? dark(p, f + delta) : dark(f + delta, p))) hit++;
              }
              best = Math.max(best, samples ? hit / samples : 0);
            }
            if (best >= 0.72) raw.push({ axis, fixed, from: start, to: end });
          }
          start = -1;
        }
      }
    }
    for (const rule of raw.sort((a, b) => (b.to - b.from) - (a.to - a.from))) {
      if (rules.some((prior) => prior.axis === axis && Math.abs(prior.fixed - rule.fixed) < 9 &&
          Math.min(prior.to, rule.to) - Math.max(prior.from, rule.from) > (rule.to - rule.from) * 0.75)) continue;
      rules.push(rule);
    }
  }
  const longRules = rules.filter((rule) => rule.to - rule.from >= (rule.axis === 'h' ? width * 0.065 : height * 0.045));
  const structuralRules = rules.filter((rule) => longRules.includes(rule) ||
    longRules.some((anchor) => anchor.axis !== rule.axis &&
      (Math.abs(rule.from - anchor.fixed) <= 9 || Math.abs(rule.to - anchor.fixed) <= 9) &&
      rule.fixed >= anchor.from - 9 && rule.fixed <= anchor.to + 9));
  const graphics: NonNullable<PdfPageLayout['graphics']> = structuralRules.map((rule) => {
    const points = rule.axis === 'h'
      ? [{ x: rule.from / width * 1000, y: rule.fixed / height * 1000 }, { x: rule.to / width * 1000, y: rule.fixed / height * 1000 }]
      : [{ x: rule.fixed / width * 1000, y: rule.from / height * 1000 }, { x: rule.fixed / width * 1000, y: rule.to / height * 1000 }];
    return { kind: 'polyline', bbox: [points[0].x, points[0].y, points[1].x, points[1].y], points, arrowEnd: false, dashed: false };
  });
  return graphics;
}

/** Only snap a label to an independently detected closed box when there is a
 * unique nearby match. This cannot manufacture a box from the model output. */
export function alignDiagramLabels(layout: PdfPageLayout): PdfPageLayout {
  const segments = (layout.graphics ?? []).filter((g) => g.kind === 'polyline' && g.points.length === 2);
  const horizontal = segments.filter((g) => Math.abs(g.points[0].y - g.points[1].y) < 1);
  const vertical = segments.filter((g) => Math.abs(g.points[0].x - g.points[1].x) < 1);
  const boxes: number[][] = [];
  for (const top of horizontal) for (const bottom of horizontal) {
    const [a, b] = top.points, [c, d] = bottom.points;
    if (c.y - a.y < 12 || c.y - a.y > 300 || b.x - a.x < 35 || b.x - a.x > 950 ||
        Math.abs(a.x - c.x) > 9 || Math.abs(b.x - d.x) > 9) continue;
    if (![a.x, b.x].every((x) => vertical.some((v) => Math.abs(v.points[0].x - x) < 9 && v.points[0].y <= a.y + 9 && v.points[1].y >= c.y - 9))) continue;
    const box = [Math.max(a.x, c.x), a.y, Math.min(b.x, d.x), c.y];
    if (boxes.some((prior) => prior.every((value, i) => Math.abs(value - box[i]) < 9))) continue;
    boxes.push(box);
  }
  const center = (bbox: number[]) => [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
  const candidates = layout.elements.filter((e) => e.text.trim() && e.kind !== 'heading' && e.kind !== 'table').map((element) => {
    const [x, y] = center(element.bbox);
    const ranked = boxes.map((box, index) => {
      const [bx, by] = center(box);
      return { index, distance: Math.hypot(x - bx, y - by), box };
    }).sort((a, b) => a.distance - b.distance);
    const best = ranked[0];
    if (!best || best.distance > 65 || (ranked[1] && ranked[1].distance < best.distance + 15)) return null;
    return { element, ...best };
  }).filter((candidate) => candidate !== null);
  const elements = layout.elements.map((element) => {
    const match = candidates.find((candidate) => candidate.element.id === element.id);
    if (!match || candidates.filter((candidate) => candidate.index === match.index).length !== 1) return element;
    const [l, t, r, b] = match.box;
    return { ...element, bbox: [l + 3, t + 3, r - 3, b - 3] };
  });
  const graphics = layout.graphics?.filter((graphic) => {
    if (graphic.kind !== 'polyline' || graphic.points.length !== 2) return true;
    // A long serif baseline can resemble a rule. Never draw a detected stroke
    // wholly inside a text region; actual node borders sit outside fitted text.
    return !elements.some((element) => element.text.trim() && graphic.points.every((point) =>
      point.x > element.bbox[0] && point.x < element.bbox[2] &&
      point.y > element.bbox[1] && point.y < element.bbox[3]));
  });
  return { ...layout, elements, graphics };
}
