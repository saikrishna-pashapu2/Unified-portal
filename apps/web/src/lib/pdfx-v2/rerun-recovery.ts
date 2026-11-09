/**
 * Select the durable page checkpoint that a user-initiated page rerun should
 * carry forward.  This module intentionally performs only a small JSON-shape
 * check.  The worker owns the complete recovery/fingerprint/schema
 * validation before it sends another provider request.
 */

export type PageRerunStage = 'extraction' | 'translation';

export type RerunRecoveryKind =
  | 'extraction'
  | 'translation'
  | 'native-cell-batches'
  | 'none';

export type PageRerunRecovery = {
  validation: Record<string, unknown>;
  kind: RerunRecoveryKind;
  reason?: string;
};

const EXTRACTION_RECOVERY_VERSION = 'v5-local-repair-1';
const PAGE_TRANSLATION_RECOVERY_VERSION = 'page-translation-v1';
const NATIVE_CELL_BATCHES_RECOVERY_VERSION = 'native-cell-batches-v1';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRecordOfStrings(value: unknown): value is Record<string, string> {
  return isObject(value) && Object.keys(value).length <= 128 &&
    Object.entries(value).every(([key, item]) =>
      /^[A-Za-z0-9:_-]{1,128}$/.test(key) &&
      key !== 'constructor' &&
      key !== 'prototype' &&
      typeof item === 'string' &&
      item.length <= 20_000 &&
      item.trim().length > 0,
    );
}

// Native-table checkpoints are cell-addressed, not element-addressed. A
// dense page can legitimately contain hundreds or thousands of cells and an
// unfinished cell may still be represented by an empty string. Keep a wider
// bounded shape here so a rerun never discards already validated cells.
function isNativeCellValues(value: unknown): value is Record<string, string> {
  if (!isObject(value) || Object.keys(value).length > 10_000) return false;
  return Object.entries(value).every(([key, item]) =>
    /^[A-Za-z0-9:_-]{1,256}$/.test(key) &&
    key !== 'constructor' &&
    key !== 'prototype' &&
    key !== '__proto__' &&
    typeof item === 'string' &&
    item.length <= 20_000,
  );
}

function isValidRotation(value: unknown): value is 0 | 90 | 180 | 270 {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

function cloneJson<T>(value: T): T {
  // Recovery blobs are persisted JSON.  Cloning here prevents setting the
  // rerun marker from mutating the object returned by Prisma or a caller.
  return JSON.parse(JSON.stringify(value)) as T;
}

function isPageTranslationRecovery(value: unknown): value is JsonObject & {
  version: typeof PAGE_TRANSLATION_RECOVERY_VERSION;
  fingerprint: string;
  passes: JsonObject;
} {
  if (!isObject(value)) return false;
  return value.version === PAGE_TRANSLATION_RECOVERY_VERSION &&
    typeof value.fingerprint === 'string' && value.fingerprint.length > 0 &&
    isObject(value.passes);
}

function isNativeCellBatchesRecovery(value: unknown): value is JsonObject & {
  version: typeof NATIVE_CELL_BATCHES_RECOVERY_VERSION;
  fingerprint: string;
  values: Record<string, string>;
} {
  if (!isObject(value)) return false;
  return value.version === NATIVE_CELL_BATCHES_RECOVERY_VERSION &&
    typeof value.fingerprint === 'string' && value.fingerprint.length > 0 &&
    isNativeCellValues(value.values);
}

function isExtractionRecovery(value: unknown): value is JsonObject & {
  version: typeof EXTRACTION_RECOVERY_VERSION;
  attempts: number;
  failures: string[];
  candidate?: JsonObject;
  rotation?: 0 | 90 | 180 | 270;
  firstFailure?: string;
} {
  if (!isObject(value)) return false;
  if (
    value.version !== EXTRACTION_RECOVERY_VERSION ||
    !Number.isInteger(value.attempts) ||
    (value.attempts as number) < 0 ||
    (value.attempts as number) > 3 ||
    !Array.isArray(value.failures) ||
    !value.failures.every(item => typeof item === 'string')
  ) return false;
  if (value.rotation !== undefined && !isValidRotation(value.rotation)) return false;
  if (value.candidate !== undefined && !isObject(value.candidate)) return false;
  if (value.firstFailure !== undefined && typeof value.firstFailure !== 'string') return false;
  return true;
}

function retainExtractionRecovery(value: unknown): PageRerunRecovery {
  if (!isExtractionRecovery(value)) {
    return {
      validation: {},
      kind: 'none',
      reason: 'The saved extraction recovery checkpoint was missing or malformed; the worker will start a fresh bounded extraction.',
    };
  }

  const recovery: JsonObject = {
    version: value.version,
    // A user rerun grants a fresh extraction allowance, while the candidate
    // and its failure history remain available for a targeted repair.
    attempts: 0,
    failures: [...value.failures],
  };
  if (value.rotation !== undefined) recovery.rotation = value.rotation;
  if (value.candidate !== undefined) recovery.candidate = cloneJson(value.candidate);
  if (value.firstFailure !== undefined) recovery.firstFailure = value.firstFailure;
  // Deliberately do not carry requestFailure or terminal into the fresh pass.
  return { validation: { extractionRecovery: recovery }, kind: 'extraction' };
}

function retainTranslationRecovery(value: unknown, pinnedFromMemory: unknown): PageRerunRecovery {
  if (isPageTranslationRecovery(value)) {
    const pins = isRecordOfStrings(pinnedFromMemory) ? cloneJson(pinnedFromMemory) : undefined;
    return {
      // The worker consumes this durable marker to reopen only exhausted pass
      // cursors.  Candidates, fragment drafts and failure history stay intact.
      validation: {
        translationRecovery: {
          ...cloneJson(value),
          retryRequested: true,
        },
        ...(pins ? { pinnedFromMemory: pins } : {}),
      },
      kind: 'translation',
    };
  }

  if (isNativeCellBatchesRecovery(value)) {
    return {
      // Native-table checkpoints are already per-cell and must be resumed
      // exactly as saved. Mark the explicit rerun so the dense translator can
      // reopen only unfinished/failed cell batches instead of replaying an
      // ordinary worker restart.
      validation: { denseTranslation: { ...cloneJson(value), retryRequested: true } },
      kind: 'native-cell-batches',
    };
  }

  return {
    validation: {},
    kind: 'none',
    reason: 'The saved translation recovery checkpoint was missing or malformed; the worker will start a fresh bounded translation.',
  };
}

/**
 * Build the page validation JSON for an explicit rerun.
 *
 * Unknown or malformed blobs are cleared rather than guessed at.  This keeps
 * a stale checkpoint from being treated as a valid worker resume while making
 * the fallback explicit to callers through `reason`.
 */
export function preparePageRerunRecovery(
  validation: unknown,
  stage: PageRerunStage,
): PageRerunRecovery {
  const source = isObject(validation) ? validation : {};
  if (stage === 'extraction') return retainExtractionRecovery(source.extractionRecovery);

  // The pipeline stores native-cell-batches-v1 under denseTranslation and
  // page-translation-v1 under translationRecovery.  Do not cross-promote one
  // format into the other, even if both keys happen to be present.
  return retainTranslationRecovery(
    source.translationRecovery ?? source.denseTranslation,
    source.pinnedFromMemory,
  );
}

export const PDFX_V2_RERUN_RECOVERY_VERSIONS = {
  extraction: EXTRACTION_RECOVERY_VERSION,
  translation: PAGE_TRANSLATION_RECOVERY_VERSION,
  nativeCellBatches: NATIVE_CELL_BATCHES_RECOVERY_VERSION,
} as const;
