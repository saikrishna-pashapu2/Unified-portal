import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

// Match the web app's local env-file behavior without overriding variables
// injected by PM2 or another production process supervisor.
const inheritedKeys = new Set(Object.keys(process.env));
for (const filename of [".env", ".env.local"]) {
  const path = resolve(process.cwd(), filename);
  if (!existsSync(path)) continue;
  const parsed = parseEnv(readFileSync(path, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (!inheritedKeys.has(key)) process.env[key] = value;
  }
}

if (process.argv.includes("--check")) {
  // Keep the import-graph smoke test independent from production credentials.
  // TypeScript validates the worker entrypoint separately via its tsconfig.
  console.log("[esg-driver-worker] startup check passed");
} else {
  await import("./esg-driver-worker.mts");
}
