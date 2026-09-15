import { describe, expect, it } from 'vitest';
import { isTransientEsgDriverError } from '../errors';
import { EsgDriverQualityGateError } from '../result-integrity';

describe('durable ESG failure classification', () => {
  it.each(['P1001', 'P1002', 'P1008', 'P1017'])('resumes a checkpoint after transient Prisma %s', (code) => {
    expect(isTransientEsgDriverError(Object.assign(new Error('Database unavailable'), { code }))).toBe(true);
    expect(isTransientEsgDriverError({ errorCode: code })).toBe(true);
  });
  it('recognizes a connection initialization failure without a Prisma code', () => {
    expect(isTransientEsgDriverError(new Error("Can't reach database server at database.example:5432"))).toBe(true);
  });
    it.each([
      "Transaction API error: Transaction already closed: A commit cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms, however 8127 ms passed since the transaction began.",
      "Transaction API error: Transaction already closed: A batch query cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms, however 8127 ms passed since the transaction began.",
      "Transaction API error: Transaction already closed: A query cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms, however 8127 ms passed since the start of the transaction.",
    ])('resumes a checkpoint for an expired interactive transaction timeout', (message) => {
    expect(isTransientEsgDriverError(Object.assign(new Error(message), { code: 'P2028' }))).toBe(true);
  });
    it.each([
      "Transaction API error: Transaction already closed: A commit cannot be executed on a closed transaction.",
      "Transaction API error: Transaction already closed: A commit cannot be executed on an expired transaction.",
      "Transaction API error: Transaction already closed: A query cannot be executed on a transaction. The timeout for this transaction was 5000 ms, however 8127 ms passed since the start of the transaction.",
      "Transaction API error: Transaction API misuse.",
  ])('does not retry a P2028 without the elapsed-time expiry proof', (message) => {
    expect(isTransientEsgDriverError(Object.assign(new Error(message), { code: 'P2028' }))).toBe(false);
  });
  it('does not retry authentication, constraint, or quality failures', () => {
    expect(isTransientEsgDriverError({ code: 'P1000' })).toBe(false);
    expect(isTransientEsgDriverError({ code: 'P2002' })).toBe(false);
    expect(isTransientEsgDriverError(Object.assign(new EsgDriverQualityGateError(['Unverified claims']), { cause: { code: 'P1001' } }))).toBe(false);
    expect(isTransientEsgDriverError(Object.assign(new EsgDriverQualityGateError(['Unverified claims']), {
      cause: Object.assign(new Error('Transaction already closed: expired; timeout for this transaction was 5000 ms, however 8127 ms passed since the transaction began.'), { code: 'P2028' }),
    }))).toBe(false);
  });
});
