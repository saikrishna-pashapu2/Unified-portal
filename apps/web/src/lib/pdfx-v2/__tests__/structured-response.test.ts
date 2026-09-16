import { describe, expect, it } from 'vitest';
import {
  isPdfxProviderRefusalError,
  parsePdfStructuredResponse,
  PdfxProviderResponseError,
  type PdfxStructuredResponseSchema,
} from '../structured-response';

type TestValue = { answer: string };

const schema: PdfxStructuredResponseSchema<TestValue> = {
  parse(input) {
    if (
      !input ||
      typeof input !== 'object' ||
      typeof (input as { answer?: unknown }).answer !== 'string'
    ) {
      throw new Error('schema rejected the candidate');
    }
    return input as TestValue;
  },
};

function response(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'resp_test_123',
    model: 'gpt-5.6-luna',
    status: 'completed',
    usage: {
      input_tokens: 42,
      output_tokens: 7,
      input_tokens_details: { cached_tokens: 3 },
    },
    incomplete_details: null,
    error: null,
    output: [{
      type: 'message',
      content: [{ type: 'output_text', text: '{"answer":"ok"}' }],
    }],
    ...overrides,
  };
}

function expectProviderError(error: unknown): PdfxProviderResponseError {
  expect(error).toBeInstanceOf(PdfxProviderResponseError);
  return error as PdfxProviderResponseError;
}

describe('parsePdfStructuredResponse', () => {
  it('parses completed output text and preserves provider usage', () => {
    const parse = (input: unknown) => schema.parse(input);
    const result = parsePdfStructuredResponse(response(), { parse }, 'extract');

    expect(result).toEqual({
      value: { answer: 'ok' },
      inputTokens: 42,
      outputTokens: 7,
      cachedInputTokens: 3,
      responseId: 'resp_test_123',
      model: 'gpt-5.6-luna',
      usageKnown: true,
    });
  });

  it('rejects an incomplete response while retaining known usage and reason', () => {
    let parsed = false;
    const error = (() => {
      try {
        parsePdfStructuredResponse(
          response({
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
          }),
          { parse: (input) => { parsed = true; return schema.parse(input); } },
          'extract',
        );
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();

    const providerError = expectProviderError(error);
    expect(parsed).toBe(false);
    expect(providerError.kind).toBe('incomplete');
    expect(providerError.responseStatus).toBe('incomplete');
    expect(providerError.responseReason).toBe('max_output_tokens');
    expect(providerError.providerUsage).toMatchObject({
      inputTokens: 42,
      outputTokens: 7,
      cachedInputTokens: 3,
      usageKnown: true,
    });
    expect(providerError.terminal).toBe(false);
  });

  it('treats a refusal as terminal and does not expose its text', () => {
    const refusalText = 'SECRET_REFUSAL_DOCUMENT_CONTENT';
    let error: unknown;
    try {
      parsePdfStructuredResponse(
        response({
          output: [{
            type: 'message',
            content: [{ type: 'refusal', refusal: refusalText }],
          }],
        }),
        schema,
        'translate',
      );
    } catch (caught) {
      error = caught;
    }

    const providerError = expectProviderError(error);
    expect(providerError.kind).toBe('refusal');
    expect(providerError.terminal).toBe(true);
    expect(isPdfxProviderRefusalError(providerError)).toBe(true);
    expect(JSON.stringify(providerError)).not.toContain(refusalText);
    expect(providerError.message).not.toContain(refusalText);
  });

  it('rejects a completed response without output text', () => {
    expect(() => parsePdfStructuredResponse(
      response({ output: [] }),
      schema,
      'extract',
    )).toThrowError(PdfxProviderResponseError);

    try {
      parsePdfStructuredResponse(response({ output: [] }), schema, 'extract');
    } catch (error) {
      const providerError = expectProviderError(error);
      expect(providerError.kind).toBe('no_text');
      expect(providerError.responseReason).toBe('no_output_text');
    }
  });

  it('rejects malformed JSON without exposing the output text', () => {
    const secret = 'SECRET_SOURCE_TEXT';
    try {
      parsePdfStructuredResponse(
        response({ output: [{ type: 'message', content: [{ type: 'output_text', text: `{"answer":"${secret}` }] }] }),
        schema,
        'extract',
      );
    } catch (error) {
      const providerError = expectProviderError(error);
      expect(providerError.kind).toBe('invalid_json');
      expect(providerError.message).not.toContain(secret);
      expect(JSON.stringify(providerError)).not.toContain(secret);
    }
  });

  it('turns schema parser failures into provider response errors without a raw cause', () => {
    const secret = 'SECRET_SCHEMA_DOCUMENT_TEXT';
    let error: unknown;
    try {
      parsePdfStructuredResponse(
        response({ output: [{ type: 'message', content: [{ type: 'output_text', text: `{"answer":"${secret}"}` }] }] }),
        {
          parse() {
            throw new Error(`invalid candidate includes ${secret}`);
          },
        },
        'review',
      );
    } catch (caught) {
      error = caught;
    }

    const providerError = expectProviderError(error);
    expect(providerError.kind).toBe('schema_error');
    expect(providerError.cause).toBeUndefined();
    expect(providerError.message).not.toContain(secret);
    expect(JSON.stringify(providerError)).not.toContain(secret);
  });

  it('marks missing usage as unknown instead of pretending it was zero', () => {
    const result = parsePdfStructuredResponse(response({ usage: undefined }), schema, 'extract');
    expect(result).toMatchObject({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, usageKnown: false });
  });

  it('keeps explicit zero usage known', () => {
    const result = parsePdfStructuredResponse(response({
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        input_tokens_details: { cached_tokens: 0 },
      },
    }), schema, 'extract');
    expect(result).toMatchObject({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, usageKnown: true });
  });

  it('marks nonfinite or malformed usage as unknown', () => {
    const result = parsePdfStructuredResponse(response({
      usage: {
        input_tokens: Number.NaN,
        output_tokens: Number.POSITIVE_INFINITY,
        input_tokens_details: { cached_tokens: 0 },
      },
    }), schema, 'extract');
    expect(result).toMatchObject({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, usageKnown: false });
  });

  it('rejects unknown and missing response statuses before parsing output', () => {
    for (const status of ['mystery_status', undefined]) {
      let error: unknown;
      try {
        parsePdfStructuredResponse(response({ status }), schema, 'context');
      } catch (caught) {
        error = caught;
      }
      const providerError = expectProviderError(error);
      expect(providerError.kind).toBe('status');
      expect(providerError.responseStatus).toBe(status);
      expect(providerError.responseReason).toBe(status === undefined ? 'missing_status' : 'unknown_status');
      expect(providerError.providerUsage.usageKnown).toBe(true);
    }
  });

  it('does not leak raw response or provider error messages in bounded metadata', () => {
    const secret = 'SECRET_RAW_DOCUMENT_PAYLOAD';
    let error: unknown;
    try {
      parsePdfStructuredResponse(
        response({
          status: 'failed',
          error: { code: 'provider_failure', message: secret },
          output: [{ type: 'message', content: [{ type: 'output_text', text: secret }] }],
        }),
        schema,
        'extract',
      );
    } catch (caught) {
      error = caught;
    }
    const providerError = expectProviderError(error);
    expect(providerError.kind).toBe('failed');
    expect(providerError.responseErrorCode).toBe('provider_failure');
    expect(providerError.message).not.toContain(secret);
    expect(JSON.stringify(providerError)).not.toContain(secret);
  });
});
