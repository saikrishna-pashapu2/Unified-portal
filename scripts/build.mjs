import { spawnSync } from "node:child_process";

/**
 * Production build entry point.
 *
 * `next build` for this workspace (98+ routes, two Prisma clients, langchain,
 * pdfjs) needs more heap than Node's default. Node sizes the default old-space
 * from available RAM, so on a small server the build dies with
 * "JavaScript heap out of memory" (V8 limit) or is OOM-killed (exit 137).
 *
 * This wrapper raises the heap ceiling in a cross-platform way (plain
 * `NODE_OPTIONS=... next build` does not work in cmd.exe on Windows) without
 * adding a dependency.
 *
 * Tune with BUILD_HEAP_MB, e.g. `BUILD_HEAP_MB=6144 pnpm build`.
 *
 * NOTE: this raises the *ceiling*, it does not create memory. On a host with
 * less RAM than the ceiling the kernel can still OOM-kill the build — such a
 * host needs swap or a larger instance.
 */
const heapMb = Number(process.env.BUILD_HEAP_MB || 4096);
if (!Number.isFinite(heapMb) || heapMb <= 0) {
  console.error(`Invalid BUILD_HEAP_MB: ${process.env.BUILD_HEAP_MB}`);
  process.exit(1);
}

const existingNodeOptions = process.env.NODE_OPTIONS || "";
const nodeOptions = /--max-old-space-size=/.test(existingNodeOptions)
  ? existingNodeOptions
  : `${existingNodeOptions} --max-old-space-size=${heapMb}`.trim();

const env = { ...process.env, NODE_OPTIONS: nodeOptions };
console.log(`[build] NODE_OPTIONS="${nodeOptions}"`);

function run(args) {
  const result = spawnSync("pnpm", args, { stdio: "inherit", shell: true, env });
  if (result.error) {
    console.error(`[build] failed to start: pnpm ${args.join(" ")}`);
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(["db:generate"]);
run(["-C", "apps/web", "build"]);
