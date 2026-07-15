import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.env.NODE_ENV !== "production") {
  const inheritedKeys = new Set(Object.keys(process.env));
  for (const filename of [
    ".env",
    "apps/web/.env",
    ".env.local",
    "apps/web/.env.local",
  ]) {
    const envPath = path.join(root, filename);
    if (!existsSync(envPath)) continue;
    const parsed = parseEnv(readFileSync(envPath, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (!inheritedKeys.has(key)) process.env[key] = value;
    }
  }
}

const requested = process.argv[2] ? [process.argv[2]] : ["esg", "credit"];
const databases = {
  esg: {
    runtime: "ESG_DATABASE_URL",
    migration: "ESG_MIGRATION_DATABASE_URL",
    schema: "packages/db-esg/prisma/schema.prisma",
    // The prisma CLI is a devDependency of this package, not of the workspace
    // root, and pnpm does not hoist. `pnpm exec prisma` from the root therefore
    // fails with "Command \"prisma\" not found", so every invocation must be
    // scoped to the package that owns the CLI.
    package: "packages/db-esg",
  },
  credit: {
    runtime: "CREDIT_DATABASE_URL",
    migration: "CREDIT_MIGRATION_DATABASE_URL",
    schema: "packages/db-credit/prisma/schema.prisma",
    package: "packages/db-credit",
  },
};

for (const name of requested) {
  const database = databases[name];
  if (!database) throw new Error(`Unknown database '${name}'. Use esg or credit.`);

  const migrationUrl = process.env[database.migration];
  const runtimeUrl = process.env[database.runtime];
  if (process.env.NODE_ENV === "production" && !migrationUrl) {
    throw new Error(`${database.migration} is required for production migration deployment.`);
  }
  if (process.env.NODE_ENV === "production" && migrationUrl === runtimeUrl) {
    throw new Error(`${database.migration} must use a separate deployment identity.`);
  }
  const databaseUrl = migrationUrl || runtimeUrl;
  if (!databaseUrl) throw new Error(`${database.migration} or ${database.runtime} is required.`);

  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(
    command,
    [
      "-C",
      path.join(root, database.package),
      "exec",
      "prisma",
      "migrate",
      "deploy",
      "--schema",
      path.join(root, database.schema),
    ],
    {
      cwd: root,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      shell: process.platform === "win32",
      stdio: "inherit",
    },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
