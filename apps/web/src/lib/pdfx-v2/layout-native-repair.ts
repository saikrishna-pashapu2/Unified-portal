import type { PdfElement } from './schemas';
import { isTextualElement } from './serialize';
import {
  canonicalText,
  containsBox,
  joinNativeText,
  matchNativeBox,
  unionBoxes,
  type Box,
  type NativeGeometry,
  type NativeText,
} from './native-geometry';

/** Compare source text without changing the spelling stored in the layout. */
function sourceKey(text: string): string {
  return canonicalText(text)
    .replace(/[ʻʼ’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-');
}

function area(bbox: readonly number[]): number {
  return Math.max(0, bbox[2] - bbox[0]) * Math.max(0, bbox[3] - bbox[1]);
}

function intersection(left: readonly number[], right: readonly number[]): number {
  return Math.max(0, Math.min(left[2], right[2]) - Math.max(left[0], right[0])) *
    Math.max(0, Math.min(left[3], right[3]) - Math.max(left[1], right[1]));
}

function intersects(left: readonly number[], right: readonly number[]): boolean {
  return Math.min(left[2], right[2]) > Math.max(left[0], right[0]) &&
    Math.min(left[3], right[3]) > Math.max(left[1], right[1]);
}

function expandBox(bbox: readonly number[], padding: number): Box {
  return [
    Math.max(0, bbox[0] - padding),
    Math.max(0, bbox[1] - padding),
    Math.min(1000, bbox[2] + padding),
    Math.min(1000, bbox[3] + padding),
  ];
}

function nativeTextMatch(
  text: string,
  near: readonly number[],
  native: NativeGeometry,
  padding: number,
): Box | null {
  if (!text.trim() || native.canReconstruct === false) return null;
  const searchBox = expandBox(near, padding);
  if (native.images.some((image) => intersects(image, searchBox))) return null;
  const wanted = sourceKey(text);
  const items = native.texts
    .filter((item) => containsBox(searchBox, item.bbox, 0.5))
    .sort((left, right) => left.bbox[1] - right.bbox[1] || left.bbox[0] - right.bbox[0]);
  const hits: Box[] = [];
  for (let start = 0; start < items.length; start += 1) {
    for (let end = start + 1; end <= Math.min(items.length, start + 80); end += 1) {
      const subset = items.slice(start, end);
      const actual = sourceKey(joinNativeText(subset));
      if (actual === wanted) {
        hits.push(unionBoxes(subset.map((item) => item.bbox)));
        break;
      }
      if (actual.length > wanted.length) break;
    }
  }
  return hits.length === 1 ? hits[0] : null;
}

/** Permit a bounded native-text correction only for a complete, unique match. */
export function matchNativeBoxWithBoundedDrift(
  text: string,
  near: readonly number[],
  native: NativeGeometry,
): Box | null {
  const strict = matchNativeBox(text, near, native);
  return strict ?? nativeTextMatch(text, near, native, 60);
}

type NativeLine = { text: string; bbox: Box };

function nativeLinesInBox(bbox: readonly number[], native: NativeGeometry): NativeLine[] {
  const items = native.texts
    .filter((item) => containsBox(bbox, item.bbox, 0.5))
    .sort((left, right) => left.bbox[1] - right.bbox[1] || left.bbox[0] - right.bbox[0]);
  const lines: NativeText[][] = [];
  for (const item of items) {
    const previous = lines.length ? lines[lines.length - 1] : undefined;
    const tolerance = Math.min(
      item.bbox[3] - item.bbox[1],
      previous ? previous[0]!.bbox[3] - previous[0]!.bbox[1] : 0,
    ) * 0.4;
    if (previous && Math.abs(previous[0]!.bbox[1] - item.bbox[1]) <= tolerance) previous.push(item);
    else lines.push([item]);
  }
  return lines.map((line) => ({
    text: joinNativeText(line),
    bbox: unionBoxes(line.map((item) => item.bbox)),
  }));
}

type CanonicalMap = { text: string; ranges: Array<[number, number]> };

function canonicalMap(value: string): CanonicalMap {
  let offset = 0;
  let text = '';
  const ranges: Array<[number, number]> = [];
  for (const character of value) {
    const end = offset + character.length;
    const normalized = sourceKey(character);
    if (normalized) {
      for (const normalizedCharacter of normalized) {
        text += normalizedCharacter;
        ranges.push([offset, Math.min(end, value.length)]);
      }
    }
    offset = end;
  }
  return { text, ranges };
}

function partitionSourceText(text: string, lines: readonly NativeLine[]): string[] | null {
  const source = canonicalMap(text);
  const lineKeys = lines.map((line) => sourceKey(line.text)).filter(Boolean);
  const nativeKey = lineKeys.join('');
  if (!nativeKey || source.text !== nativeKey) return null;
  const parts: string[] = [];
  let canonicalOffset = 0;
  let rawOffset = 0;
  for (const key of lineKeys) {
    if (source.text.slice(canonicalOffset, canonicalOffset + key.length) !== key) return null;
    const first = source.ranges[canonicalOffset];
    const last = source.ranges[canonicalOffset + key.length - 1];
    if (!first || !last || last[1] < rawOffset) return null;
    const end = last[1];
    parts.push(text.slice(rawOffset, end));
    rawOffset = end;
    canonicalOffset += key.length;
  }
  if (canonicalOffset !== source.text.length) return null;
  if (rawOffset < text.length && parts.length) parts[parts.length - 1] += text.slice(rawOffset);
  return parts.every((part) => part.trim()) ? parts : null;
}

/** Split only when native lines exactly cover the source text. */
export function splitOversizedNativeTextElement(
  element: PdfElement,
  native: NativeGeometry,
): PdfElement[] | null {
  if (element.kind === 'table' || !isTextualElement(element) || !element.text.trim() ||
      element.text.length < 400 || area(element.bbox) < 550_000 || native.canReconstruct === false ||
      native.images.some((image) => intersects(image, element.bbox))) return null;
  const lines = nativeLinesInBox(element.bbox, native);
  if (lines.length < 2 || lines.some((line) => !line.text.trim())) return null;
  const parts = partitionSourceText(element.text, lines);
  if (!parts || parts.length !== lines.length || parts.join('') !== element.text) return null;
  return parts.map((text, index) => ({
    ...element,
    id: index === 0 ? element.id : `${element.id}-native-${index}`,
    text,
    bbox: lines[index]!.bbox,
  }));
}

/** Drop only a native-proven duplicate nested inside a larger source block. */
export function dropNativeDuplicateTextElements(
  elements: readonly PdfElement[],
  native: NativeGeometry,
): PdfElement[] {
  if (native.canReconstruct === false) return [...elements];
  const drop = new Set<string>();
  for (let leftIndex = 0; leftIndex < elements.length; leftIndex += 1) {
    const left = elements[leftIndex]!;
    if (!isTextualElement(left) || left.kind === 'table' || !left.text.trim()) continue;
    for (let rightIndex = 0; rightIndex < elements.length; rightIndex += 1) {
      if (leftIndex === rightIndex) continue;
      const right = elements[rightIndex]!;
      if (!isTextualElement(right) || right.kind === 'table' || !right.text.trim() || drop.has(right.id)) continue;
      const overlap = intersection(left.bbox, right.bbox);
      const rightKey = sourceKey(right.text);
      if (overlap <= 300 || overlap / Math.max(1, area(right.bbox)) <= 0.15 ||
          !rightKey || sourceKey(left.text).length <= rightKey.length || !sourceKey(left.text).includes(rightKey)) continue;
      const leftNative = matchNativeBoxWithBoundedDrift(left.text, left.bbox, native);
      const rightNative = matchNativeBoxWithBoundedDrift(right.text, right.bbox, native);
      if (leftNative && rightNative && containsBox(leftNative, rightNative, 0.5)) drop.add(right.id);
    }
  }
  return elements.filter((element) => !drop.has(element.id));
}

/** Keep stable model order while making duplicate order fields deterministic. */
export function normalizeUniqueReadingOrders(elements: readonly PdfElement[]): PdfElement[] {
  const orders = elements.map((element) => element.order);
  if (new Set(orders).size === orders.length) return [...elements];
  const firstOrder = Math.min(...orders);
  const sorted = elements.map((element, index) => ({ element, index }))
    .sort((left, right) => left.element.order - right.element.order || left.index - right.index);
  const normalized = new Map(sorted.map(({ element }, index) => [element.id, firstOrder + index]));
  return elements.map((element) => ({ ...element, order: normalized.get(element.id) ?? element.order }));
}
