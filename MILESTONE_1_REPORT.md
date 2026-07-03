# Milestone 1 Report

## What changed

- Added Prisma baseline migrations for audit §4.6:
  - `packages/db-esg/prisma/migrations/0_init/migration.sql` creates 49 tables.
  - `packages/db-credit/prisma/migrations/0_init/migration.sql` creates 35 tables.
  - `MIGRATIONS.md` documents the external-writer constraint and the exact production `migrate resolve --applied 0_init` commands.
- Added `apps/web/src/lib/config/env.ts` with zod validation and a typed `env` export.
  - Actual code had 54 `process.env` reads at the start of this milestone, not the 53 noted in audit §5.4.
  - Current state: 1 central `process.env` read in `env.ts`, plus 3 allowed `NODE_ENV` checks.
  - There are 0 non-`NODE_ENV` direct env reads outside `env.ts`.
- Added root `.env.example` with dummy values only. It documents every config-module variable and the database/Auth runtime variables needed by this repo.
- Added Vitest to `apps/web` with `test` and `test:watch` scripts, `apps/web/vitest.config.ts`, and 4 characterization test files.

## Behavior oddities preserved

- Cron auth still fails closed when `CRON_SECRET` is missing, returning `500 Server misconfiguration` as noted in audit §6.13.
- Login rate limiting still increments once during `checkLoginRateLimit` and again during `recordFailedAttempt`; the characterization test includes a TODO documenting that current double-count behavior.
- Both email conventions remain intact: queued alerts use `MAIL_*`, while the manual admin sender uses `EMAIL_*`.
- Existing fallbacks remain intact, including `NEXTAUTH_URL`, `NEXT_PUBLIC_API_URL`, `PDFX_STORAGE_DIR`, `OPENAI_ESG_DRIVERS_MODEL`, `OLLAMA_HOST`, `OLLAMA_MODEL`, `MAIL_SERVER`, `MAIL_PORT`, and `MAIL_FROM`.

## Verification

- PASS: `apps/web/node_modules/.bin/vitest.CMD run`
  - 4 test files passed.
  - 23 tests passed.
- PASS: `apps/web/node_modules/.bin/tsc.CMD --noEmit -p apps/web/tsconfig.json`
- FAIL: `pnpm build` using pnpm 10.23.0 to match the existing pnpm store.
  - Fails during `pnpm db:generate` at Prisma generate with `EPERM: operation not permitted, rename ... query_engine-windows.dll.node.tmp* -> query_engine-windows.dll.node`.
  - Deleting the generated Prisma DLLs so Prisma could recreate them was also denied, which indicates the generated engine files are locked or protected outside this shell.
- FAIL: `pnpm -C apps/web build` without the root `db:generate` wrapper.
  - Fails in Next/Webpack while bundling `node-cron` from `apps/web/src/instrumentation.ts` / `apps/web/src/lib/alert-scheduler.ts`.
  - Errors include unresolved Node built-ins: `node:crypto`, `path`, `child_process`, and `stream`.
  - I did not patch `next.config.js` because that is build/deployment configuration and this milestone explicitly says not to touch deployment.

## Open questions

- Can the process locking `packages/db-*/generated/client/query_engine-windows.dll.node` be stopped, or should generated Prisma clients be removed from source control in a later milestone?
- Do you want a separate approved build-fix task for the `node-cron` instrumentation bundling issue?
- Should future verification use a pinned pnpm 10 command, or should the repo declare a `packageManager` field in a separate dependency-management milestone?
