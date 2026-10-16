import { describe, expect, it } from 'vitest';
import { repairExtractedLayout } from '../layout-repair';
import { validateExtractedPage } from '../validation';
import type { NativeGeometry } from '../native-geometry';
import type { PdfPageLayout } from '../schemas';

function fixture() {
  const page: PdfPageLayout = { pageNumber: 1, width: 1000, height: 1000,
    orientation: 'landscape', sourceLanguage: 'Uzbek', sourceScript: 'Latin', warnings: [],
    elements: [{ id: 'e002', kind: 'other', text: 'ID: 0123456789abcdef01234567',
      bbox: [7, 32, 170, 47], order: 2, level: 0, rows: [], rowCount: 0, columnCount: 0, translate: false }],
  };
  const native: NativeGeometry = { canReconstruct: true, rules: [], images: [],
    texts: [{ text: 'ID:', bbox: [8, 33, 20, 44] },
      { text: '0123456789abcdef01234567', bbox: [21, 33, 160, 44] }],
  };
  return { page, native };
}

describe('native evidence for misclassified printed text', () => {
  it('preserves the printed ID and makes it renderable text instead of removing it', () => {
    const { page, native } = fixture();
    const repaired = repairExtractedLayout(page, native);
    expect(validateExtractedPage(page, 1).valid).toBe(false);
    expect(validateExtractedPage(repaired, 1).failures).toEqual([]);
    expect(repaired.elements[0]).toEqual({ ...page.elements[0], kind: 'paragraph', bbox: [8, 33, 160, 44] });
    expect(page.elements[0].kind).toBe('other');
    expect(repairExtractedLayout(repaired, native)).toEqual(repaired);
  });

  it.each(['no-native', 'hidden', 'scan', 'different-text', 'ambiguous', 'table-data', 'image', 'stamp', 'signature'])(
    'keeps validation active without safe plain-text evidence: %s', reason => {
      const { page, native } = fixture();
      if (reason === 'hidden') native.canReconstruct = false;
      if (reason === 'scan') native.images = [[0, 0, 200, 70]];
      if (reason === 'different-text') native.texts[1].text = 'different source ID';
      if (reason === 'ambiguous') native.texts.push(...native.texts.map(t => ({ ...t, bbox: [t.bbox[0], 50, t.bbox[2], 61] as [number, number, number, number] })));
      if (reason === 'table-data') page.elements[0].rowCount = 1;
      if (reason === 'image' || reason === 'stamp' || reason === 'signature') page.elements[0].kind = reason;
      const repaired = repairExtractedLayout(page, reason === 'no-native' ? undefined : native);
      expect(repaired.elements[0]).toEqual(page.elements[0]);
      expect(validateExtractedPage(repaired, 1).valid).toBe(false);
    },
  );
});
