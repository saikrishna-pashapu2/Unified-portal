/**
 * A small boundary around the raw Responses API object.
 *
 * The Responses SDK's `parse` helper can turn an output item into a parsed
 * value before callers have a chance to inspect the raw response.  PDFX uses
 * this boundary with `responses.create` so that usage and terminal provider
 * states are retained before any application-level schema validation runs.
 */

const MAX_METADATA_LENGTH = 128;

export type PdfxProviderResponseFailure =
  | 'incomplete'
  | 'failed'
  | 'refusal'
  | 'no_text'
  | 'invalid_json'
  | 'schema_error'
  | 'status';

/** Usage reported by a provider response, with provenance for accounting. */
export interface PdfxProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  responseId: string;
  model: string;
  /** False when the provider did not report trustworthy input/output totals. */
  usageKnown: boolean;
}

export type PdfxStructuredResponseUsage = PdfxProviderUsage;

export interface PdfxStructuredResponse<T> extends PdfxProviderUsage {
  value: T;
}

export type PdfxProviderResponseMetadata = {
  stage: string;
  responseStatus?: string;
  responseReason?: string;
  responseErrorCode?: string;
  responseId: string;
  model: string;
  usageKnown: boolean;
};

export type PdfxProviderResponseErrorOptions = {
  providerUsage: PdfxProviderUsage;
  stage: string;
  kind: PdfxProviderResponseFailure;
  responseStatus?: string;
  responseReason?: string;
  responseErrorCode?: string;
  terminal?: boolean;
};

/**
 * A provider/transport response could not be converted into a typed value.
 *
 * This is deliberately separate from PdfxV2ValidationError: the latter is
 * reserved for semantic validation of an otherwise parsed candidate.  The
 * request budget can therefore account for this response and decide whether
 * a retry is appropriate.  Refusals are marked terminal so a retry layer
 * cannot accidentally bypass a safety refusal.
 */
export class PdfxProviderResponseError extends Error {
  readonly providerUsage: PdfxProviderUsage;
  readonly stage: string;
  readonly kind: PdfxProviderResponseFailure;
  readonly responseStatus?: string;
  readonly responseReason?: string;
  readonly responseErrorCode?: string;
  readonly terminal: boolean;
  readonly metadata: PdfxProviderResponseMetadata;

  constructor(message: string, options: PdfxProviderResponseErrorOptions) {
    super(message);
    this.name = 'PdfxProviderResponseError';
    this.providerUsage = options.providerUsage;
    this.stage = options.stage;
    this.kind = options.kind;
    this.responseStatus = options.responseStatus;
    this.responseReason = options.responseReason;
    this.responseErrorCode = options.responseErrorCode;
    this.terminal = options.terminal ?? options.kind === 'refusal';
    this.metadata = {
      stage: options.stage,
      ...(options.responseStatus !== undefined
        ? { responseStatus: options.responseStatus }
        : {}),
      ...(options.responseReason !== undefined
        ? { responseReason: options.responseReason }
        : {}),
      ...(options.responseErrorCode !== undefined
        ? { responseErrorCode: options.responseErrorCode }
        : {}),
      responseId: options.providerUsage.responseId,
      model: options.providerUsage.model,
      usageKnown: options.providerUsage.usageKnown,
    };
  }
}

export interface PdfxStructuredResponseSchema<T> {
  parse(input: unknown): T;
}

type RawResponseRecord = Record<string, unknown>;

function asRecord(value: unknown): RawResponseRecord | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as RawResponseRecord;
}

/** Keep diagnostics useful without carrying provider messages or document text. */
function boundedMetadata(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim();
  if (!normalized) return undefined;
  return normalized.slice(0, MAX_METADATA_LENGTH);
}

/** Status/reason labels are safe to put in a short diagnostic. */
function boundedLabel(value: unknown): string | undefined {
  const normalized = boundedMetadata(value);
  if (!normalized) return undefined;
  return normalized.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, MAX_METADATA_LENGTH);
}

function identifier(value: unknown, kind: 'response' | 'model'): string {
  const label = boundedLabel(value);
  if (!label) return 'unknown';

  // Responses IDs and model IDs have stable provider-controlled prefixes. Do
  // not copy arbitrary top-level strings into durable error metadata: a bad
  // gateway or a mocked response could otherwise smuggle document text into
  // logs through an id/model field.
  if (
    kind === 'response' &&
    /^(?:resp|response)[_.:-][A-Za-z0-9_.:-]{1,127}$/i.test(label)
  ) {
    return label;
  }
  if (
    kind === 'model' &&
    /^(?:gpt|o\d|chatgpt|codex|text|omni|computer-use|dall-e|whisper|tts|embedding)[A-Za-z0-9_.:-]{0,127}$/i.test(label)
  ) {
    return label;
  }
  return 'unknown';
}

function tokenCount(value: unknown): number | undefined {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    return undefined;
  }
  return value;
}

function readProviderUsage(response: RawResponseRecord | undefined): PdfxProviderUsage {
  const usage = asRecord(response?.usage);
  const inputTokens = tokenCount(usage?.input_tokens);
  const outputTokens = tokenCount(usage?.output_tokens);
  const inputDetails = asRecord(usage?.input_tokens_details);
  const cachedInputTokens = tokenCount(inputDetails?.cached_tokens);

  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    cachedInputTokens: cachedInputTokens ?? 0,
    responseId: identifier(response?.id, 'response'),
    model: identifier(response?.model, 'model'),
    // The cache breakdown is optional in Responses API usage.  Input/output
    // totals are sufficient to account for the bill; a missing or malformed
    // cached_tokens detail should not make an otherwise complete usage report
    // look unknown to the durable budget.
    usageKnown: inputTokens !== undefined && outputTokens !== undefined,
  };
}

function responseErrorCode(value: unknown): string | undefined {
  const error = asRecord(value);
  const code = boundedLabel(error?.code);
  if (!code) return undefined;

  // Keep only provider error labels we expect to be useful to operators. The
  // provider error message is intentionally never copied because it can carry
  // prompt or source-document content.
  const knownCodes = new Set([
    'server_error',
    'rate_limit_exceeded',
    'invalid_request_error',
    'authentication_error',
    'permission_denied',
    'not_found',
    'conflict',
    'unprocessable_entity',
    'timeout',
    'content_filter',
    'provider_failure',
    'upstream_error',
    'test_error',
  ]);
  return knownCodes.has(code) ? code : 'provider_error';
}

function responseReason(
  response: RawResponseRecord | undefined,
  status: string | undefined,
  kind: PdfxProviderResponseFailure,
): string | undefined {
  if (kind === 'incomplete') {
    const reason = boundedLabel(asRecord(response?.incomplete_details)?.reason);
    const knownReasons = new Set([
      'max_output_tokens',
      'content_filter',
      'tool_error',
      'turn_limit',
      'safety',
      'other',
    ]);
    return reason && knownReasons.has(reason) ? reason : 'incomplete';
  }
  if (kind === 'failed') {
    return responseErrorCode(response?.error) ?? 'failed';
  }
  if (kind === 'refusal') return 'refusal';
  if (kind === 'no_text') return 'no_output_text';
  if (kind === 'invalid_json') return 'invalid_json';
  if (kind === 'schema_error') return 'schema_validation';
  if (status === undefined) return 'missing_status';
  return 'unknown_status';
}

function stageLabel(stage: string): string {
  return boundedLabel(stage) ?? 'structured_response';
}

function failureMessage(
  kind: PdfxProviderResponseFailure,
  stage: string,
  reason: string | undefined,
): string {
  switch (kind) {
    case 'incomplete':
      return `OpenAI returned an incomplete ${stage} structured response${reason ? ` (${reason})` : ''}.`;
    case 'failed':
      return `OpenAI returned a failed ${stage} structured response${reason ? ` (${reason})` : ''}.`;
    case 'refusal':
      return `OpenAI refused the ${stage} structured response.`;
    case 'no_text':
      return `OpenAI returned no structured output text for ${stage}.`;
    case 'invalid_json':
      return `OpenAI returned invalid structured JSON for ${stage}.`;
    case 'schema_error':
      return `OpenAI structured JSON failed schema validation for ${stage}.`;
    case 'status':
      return `OpenAI returned a non-completed ${stage} structured response${reason ? ` (${reason})` : ''}.`;
  }
}

function providerError(
  response: RawResponseRecord | undefined,
  stage: string,
  kind: PdfxProviderResponseFailure,
  responseStatus: string | undefined,
  options: { terminal?: boolean; responseErrorCode?: string } = {},
): PdfxProviderResponseError {
  const providerUsage = readProviderUsage(response);
  const safeStage = stageLabel(stage);
  const safeReason = responseReason(response, responseStatus, kind);
  return new PdfxProviderResponseError(
    failureMessage(kind, safeStage, safeReason),
    {
      providerUsage,
      stage: safeStage,
      kind,
      responseStatus,
      responseReason: safeReason,
      responseErrorCode: options.responseErrorCode,
      terminal: options.terminal,
    },
  );
}

function containsRefusal(response: RawResponseRecord): boolean {
  if (!Array.isArray(response.output)) return false;
  for (const outputItem of response.output) {
    const item = asRecord(outputItem);
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const contentItem of item.content) {
      if (asRecord(contentItem)?.type === 'refusal') return true;
    }
  }
  return false;
}

function outputText(response: RawResponseRecord): string | undefined {
  if (!Array.isArray(response.output)) return undefined;
  for (const outputItem of response.output) {
    const item = asRecord(outputItem);
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const contentItem of item.content) {
      const content = asRecord(contentItem);
      if (
        content?.type === 'output_text' &&
        typeof content.text === 'string' &&
        content.text.trim().length > 0
      ) {
        return content.text;
      }
    }
  }
  return undefined;
}

/**
 * Parse one raw Responses API response and retain provider usage even when
 * parsing fails. Only an explicitly completed response is accepted.
 */
export function parsePdfStructuredResponse<T>(
  response: unknown,
  schema: PdfxStructuredResponseSchema<T>,
  stage: string,
): PdfxStructuredResponse<T> {
  const record = asRecord(response);
  const usage = readProviderUsage(record);
  const status = boundedLabel(record?.status);

  if (!record) {
    throw providerError(undefined, stage, 'status', undefined);
  }

  // A refusal is terminal even if a malformed provider object also carries a
  // non-completed status. Do not expose the refusal text in the error.
  if (containsRefusal(record)) {
    throw providerError(record, stage, 'refusal', status, { terminal: true });
  }

  if (status !== 'completed') {
    if (status === 'incomplete') {
      throw providerError(record, stage, 'incomplete', status);
    }
    if (status === 'failed') {
      throw providerError(record, stage, 'failed', status, {
        responseErrorCode: responseErrorCode(record.error),
      });
    }
    throw providerError(record, stage, 'status', status);
  }

  // A completed object carrying an error is not a valid successful response.
  // Ignore provider error messages, which may contain request/document data.
  if (record.error !== undefined && record.error !== null) {
    throw providerError(record, stage, 'failed', status, {
      responseErrorCode: responseErrorCode(record.error),
    });
  }

  const text = outputText(record);
  if (text === undefined) {
    throw providerError(record, stage, 'no_text', status);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw providerError(record, stage, 'invalid_json', status);
  }

  let value: T;
  try {
    if (!schema || typeof schema.parse !== 'function') {
      throw new TypeError('schema parser unavailable');
    }
    value = schema.parse(parsed);
  } catch {
    // Do not use the thrown validation error as a cause: custom schemas can
    // include snippets of model output or source document text in messages.
    throw providerError(record, stage, 'schema_error', status);
  }

  return { value, ...usage };
}

export function isPdfxProviderResponseError(
  error: unknown,
): error is PdfxProviderResponseError {
  return error instanceof PdfxProviderResponseError;
}

export function isPdfxProviderRefusalError(error: unknown): boolean {
  return isPdfxProviderResponseError(error) && error.kind === 'refusal' && error.terminal;
}
