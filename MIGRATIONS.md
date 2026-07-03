# Database Migrations

This repo now contains Prisma baseline migrations generated from the current checked-in Prisma schemas. This follows the Prisma baselining flow described in `ARCHITECTURE_AUDIT.md` §4.6: the production databases already exist, so the initial migration SQL is committed for history but must be marked as already applied in each production database.

## One-time production baseline

Do not run `prisma migrate dev` against production.

After deploying this baseline commit to the EC2 host, run these commands once against the existing production databases:

```bash
cd /path/to/Portal_v3

DATABASE_URL="$ESG_DATABASE_URL" pnpm -C packages/db-esg exec prisma migrate resolve --schema prisma/schema.prisma --applied 0_init
DATABASE_URL="$CREDIT_DATABASE_URL" pnpm -C packages/db-credit exec prisma migrate resolve --schema prisma/schema.prisma --applied 0_init
```

The package schemas use `env("DATABASE_URL")`, while the app runtime uses `ESG_DATABASE_URL` and `CREDIT_DATABASE_URL` through the Prisma client wrappers. The commands above intentionally map the runtime database URLs to Prisma Migrate's expected `DATABASE_URL` name.

## Future schema changes

The two PostgreSQL schemas are shared contracts. An external scraper service outside this repo writes directly to both databases. Never rename, drop, or alter tables or columns unless the scraper contract has been checked and coordinated first.

For every future schema change:

1. Update the relevant `schema.prisma` intentionally.
2. Generate a migration against a disposable/local database, not production.
3. Review the generated SQL before it is committed.
4. Deploy with `prisma migrate deploy` after backups and scraper coordination.
5. If production drift is found, stop and investigate before creating or applying a migration.

Do not use `prisma db push` for shared database changes. Do not edit production databases manually as a shortcut around migrations. Do not use `prisma migrate dev` against RDS production databases.
