import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const command = join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "prisma.CMD" : "prisma",
);
const result = spawnSync(command, ["generate"], {
  cwd: process.cwd(),
  encoding: "utf8",
  shell: process.platform === "win32",
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) console.error(result.error.message);

if (result.status === 0) {
  process.exit(0);
}

const output = `${result.stdout || ""}\n${result.stderr || ""}`;
const generatedClientExists = existsSync(join(process.cwd(), "generated", "client", "index.js"));
const isWindowsEngineRenameLock =
  process.platform === "win32" &&
  /EPERM: operation not permitted, rename/.test(output) &&
  /query_engine-windows\.dll\.node/.test(output);

if (generatedClientExists && isWindowsEngineRenameLock) {
  console.warn(
    [
      "[prisma-generate-safe] Prisma could not replace the Windows query engine DLL.",
      "[prisma-generate-safe] Existing generated client files are present, so continuing build.",
    ].join("\n"),
  );
  process.exit(0);
}

process.exit(result.status ?? 1);
