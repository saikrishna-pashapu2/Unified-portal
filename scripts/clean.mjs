import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
  "node_modules",
  "apps/web/node_modules",
  "apps/web/.next",
  "packages/db-esg/node_modules",
  "packages/db-credit/node_modules",
];

for (const relativeTarget of targets) {
  const target = path.resolve(root, relativeTarget);
  if (target !== root && target.startsWith(`${root}${path.sep}`)) {
    await rm(target, { recursive: true, force: true });
  }
}
