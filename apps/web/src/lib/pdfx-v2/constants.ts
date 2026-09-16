// Match the largest individual file accepted by OpenAI's file platform. The
// Translator splits the source locally and submits one page at a time, so the
// source document itself is never sent to a model as one 512 MB request.
export const MAX_PDF_UPLOAD_BYTES = 512 * 1024 * 1024;
export const MAX_PDF_MULTIPART_OVERHEAD_BYTES = 4 * 1024 * 1024;
export const MAX_PDF_REQUEST_BYTES =
  MAX_PDF_UPLOAD_BYTES + MAX_PDF_MULTIPART_OVERHEAD_BYTES;

// PDF Translator v2 is deliberately pinned to Luna for every OpenAI pass. Do
// not make this an environment override: stale worker settings must never
// select any other model for extraction, translation, review, or retries.
export const PDFX_V2_MODEL = 'gpt-5.6-luna' as const;
export const PDFX_V2_RENDERER_VERSION = 'clean-layout-v2-2026-09-14' as const;

// Checkpoints created by older geometry/rendering rules must not be mixed with
// pages created by this pipeline. Bump this whenever the stored layout contract
// changes in a way that requires re-extraction.
export const PDFX_V2_PIPELINE_VERSION = 'luna-layout-v5-native-2026-09-14' as const;

// Queue type is a deployment fence, not the product/pipeline version. The
// native v5 repair remains the v5 translator, but an already-running old v5
// worker must be unable to claim jobs submitted by this build. This also makes
// local testing safe when the local app deliberately points at production DB.
export const PDFX_V2_QUEUE_JOB_TYPE = 'pdf_translation_v5_native' as const;
export const PDFX_V2_LEGACY_QUEUE_JOB_TYPES = [
  'pdf_translation_v5',
  'pdf_translation_v4',
  'pdf_translation_v3',
  'pdf_translation_v2',
] as const;
export const PDFX_V2_QUEUE_JOB_TYPES = [
  PDFX_V2_QUEUE_JOB_TYPE,
  ...PDFX_V2_LEGACY_QUEUE_JOB_TYPES,
] as const;

export type PdfxV2QueueJobType = (typeof PDFX_V2_QUEUE_JOB_TYPES)[number];

export function isPdfxV2QueueJobType(value: string): value is PdfxV2QueueJobType {
  return (PDFX_V2_QUEUE_JOB_TYPES as readonly string[]).includes(value);
}

export function buildPdfContentDisposition(
  disposition: 'attachment' | 'inline',
  filename: string,
): string {
  const wellFormedFilename = makeWellFormed(String(filename || 'document.pdf'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim() || 'document.pdf';
  const asciiFallback = wellFormedFilename
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\;]/g, '_')
    .trim()
    .slice(0, 180) || 'document.pdf';
  const encodedFilename = encodeURIComponent(wellFormedFilename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`;
}

function makeWellFormed(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += value[index] + value[index + 1];
        index += 1;
      } else {
        result += '\ufffd';
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      result += '\ufffd';
    } else {
      result += value[index];
    }
  }
  return result;
}
