import { PrismaClient as CreditPrismaClient, Prisma } from "../generated/client";

const url = process.env.CREDIT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("CREDIT_DATABASE_URL is missing");

declare global { var __creditPrisma: CreditPrismaClient | undefined; }

// --------------- retry helpers ---------------
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

function isRetryableError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return ["P1001", "P1002", "P1008", "P1017"].includes(error.code);
  }
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("can't reach database server") ||
      msg.includes("connection refused") ||
      msg.includes("connection reset") ||
      msg.includes("connection timed out") ||
      msg.includes("server has closed the connection") ||
      msg.includes("econnrefused") ||
      msg.includes("econnreset") ||
      msg.includes("etimedout")
    );
  }
  return false;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function withRetry(client: CreditPrismaClient) {
  return client.$extends({
    query: {
      $allOperations: async ({ args, query, operation, model }: any) => {
        let lastError: unknown;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            return await query(args);
          } catch (error) {
            lastError = error;
            if (attempt < MAX_RETRIES && isRetryableError(error)) {
              const delay = BASE_DELAY_MS * Math.pow(2, attempt);
              console.warn(
                `[credit-prisma-retry] ${model ?? "raw"}.${operation} failed ` +
                `(attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms…`,
                error instanceof Error ? error.message : error,
              );
              await sleep(delay);
            } else {
              throw error;
            }
          }
        }
        throw lastError;
      },
    },
  });
}
// --------------- end retry helpers ---------------

const baseClient =
  global.__creditPrisma ??
  new CreditPrismaClient({
    log: ["warn", "error"],
    datasources: { db: { url } },
  });

if (process.env.NODE_ENV !== "production") global.__creditPrisma = baseClient;

export const creditPrisma = withRetry(baseClient) as unknown as CreditPrismaClient;
