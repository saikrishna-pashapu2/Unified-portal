export class EsgDriverCandidateRejectedError extends Error {
  constructor(
    message: string,
    readonly attempts = 1,
  ) {
    super(message);
    this.name = "EsgDriverCandidateRejectedError";
  }
}

export class EsgDriverQualityGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EsgDriverQualityGateError";
  }
}

const TERMINAL_ERROR_NAMES = new Set([
  "EsgDriverCandidateRejectedError",
  "EsgDriverQualityGateError",
  "EsgResearchBudgetExceededError",
  "HarnessBudgetExceededError",
]);

const TRANSIENT_ERROR_NAMES = new Set([
  "APIConnectionError",
  "APIConnectionTimeoutError",
  "APITimeoutError",
  "InternalServerError",
  "RateLimitError",
  "TimeoutError",
]);

const TRANSIENT_ERROR_CODES = new Set([
  // Retry the durable job from its checkpoint, never blindly replay raw writes.
  "P1001",
  "P1002",
  "P1008",
  "P1017",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
]);

// Prisma uses P2028 for several deterministic transaction API failures as
// well as interactive transactions that exceeded their configured timeout.
// Retry only the latter when the message proves both expiry and elapsed-time
// timeout details; a bare P2028 must remain terminal.
const EXPIRED_TRANSACTION_TIMEOUT_PATTERN =
  /\btransaction\b[\s\S]{0,500}\bexpired\b[\s\S]{0,500}\btimeout\s+for\s+this\s+transaction\s+was\s+\d+\s*ms\b[\s\S]{0,300}\b\d+\s*ms\s+passed\s+since\s+(?:the\s+)?(?:transaction\s+began|start\s+of\s+the\s+transaction)\b/i;

const TRANSIENT_MESSAGE_PATTERN =
  /\b(?:can't reach database server|server has closed the connection|connection error|connection refused|connection reset|connection timed out|eai_again|econnrefused|econnreset|enetunreach|enotfound|epipe|etimedout|fetch failed|gateway timeout|network error|rate limited|rate limit|request timed out|service unavailable|socket hang up|temporarily unavailable|too many requests)\b/i;

/**
 * Retry only failures that are explicitly recognizable as temporary provider or
 * network conditions. Unknown errors fail closed so deterministic quality bugs
 * cannot replay a complete 12-driver pack.
 */
export function isTransientEsgDriverError(error: unknown): boolean {
  const chain = errorChain(error);
  if (chain.some((item) => TERMINAL_ERROR_NAMES.has(errorName(item)))) {
    return false;
  }

  return chain.some((item) => {
    const status = numericProperty(item, "status") ?? numericProperty(item, "statusCode");
    if (
      status === 408 ||
      status === 409 ||
      status === 425 ||
      status === 429 ||
      (status !== null && status >= 500 && status <= 599)
    ) {
      return true;
    }

    const name = errorName(item);
    if (TRANSIENT_ERROR_NAMES.has(name)) return true;
    const code = (stringProperty(item, "code") || stringProperty(item, "errorCode")).toUpperCase();
    if (TRANSIENT_ERROR_CODES.has(code)) return true;
    if (code === "P2028" && EXPIRED_TRANSACTION_TIMEOUT_PATTERN.test(stringProperty(item, "message"))) {
      return true;
    }
    return TRANSIENT_MESSAGE_PATTERN.test(stringProperty(item, "message"));
  });
}

function errorChain(error: unknown): object[] {
  const chain: object[] = [];
  const seen = new Set<object>();
  let current = error;
  while (current && typeof current === "object" && chain.length < 8) {
    if (seen.has(current)) break;
    seen.add(current);
    chain.push(current);
    current = "cause" in current ? current.cause : null;
  }
  return chain;
}

function errorName(error: object): string {
  return stringProperty(error, "name");
}

function stringProperty(value: object, key: string): string {
  if (!(key in value)) return "";
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" ? property : "";
}

function numericProperty(value: object, key: string): number | null {
  if (!(key in value)) return null;
  const property = (value as Record<string, unknown>)[key];
  if (typeof property === "number" && Number.isFinite(property)) return property;
  if (typeof property === "string" && /^\d{3}$/.test(property)) return Number(property);
  return null;
}
