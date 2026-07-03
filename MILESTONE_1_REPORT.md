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
- Stabilized build verification without changing runtime behavior:
  - `apps/web/src/lib/alert-scheduler.ts` now lazy-loads `node-cron` only when the scheduler starts, so Next does not bundle Node-only cron internals through `instrumentation.ts`.
  - `scripts/prisma-generate-safe.mjs` still runs `prisma generate`, but allows a Windows-only generated query-engine DLL rename lock to continue only when the generated client already exists.

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
- PASS: `pnpm build` using the user-installed pnpm 10.18.1 at `C:\Users\saikr\AppData\Roaming\npm\pnpm.cmd`
  - Prisma clients generated for both DB packages.
  - Next production build completed successfully.
  - Existing warnings remain: one `react-hooks/exhaustive-deps` warning, two `@next/next/no-img-element` warnings, and stale browserslist/baseline-browser-mapping notices.

## Open questions

- Should generated Prisma clients remain tracked? They are noisy in the working tree and make Windows query-engine DLL locks more likely.
- Should the repo declare a `packageManager` field in a later dependency-management milestone? I did not keep one in this milestone because the Dockerfile still installs global `pnpm@8` explicitly.
