import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

let standardFontDataUrl: string | undefined;
const STANDARD_FONT_SENTINEL = "LiberationSans-Regular.ttf";

type FileExists = (path: string) => boolean;

/**
 * All Node PDF readers share one graphics runtime, including text-only readers.
 * PDF.js only supplies missing globals: an empty Path2D/DOMMatrix shim installed
 * by another job would otherwise survive and fail when a later job draws text.
 * Install the constructors from the same native package used by our canvases
 * before importing PDF.js. Reassert them on every load, even after module caching.
 * Keep both imports lazy and server-external for Next.js and standalone workers.
 */
export async function loadNodePdfJs(): Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> {
  if (typeof window !== "undefined") {
    throw new Error("The Node PDF graphics runtime cannot be loaded in a browser");
  }
  const { Path2D, DOMMatrix, ImageData } = await import("@napi-rs/canvas");
  Object.assign(globalThis, { Path2D, DOMMatrix, ImageData });
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

function candidateStandardFontDirectories(startDirectory: string): string[] {
  const candidates = new Set<string>();
  let current = resolve(startDirectory);

  while (true) {
    // Normal pnpm/npm package execution, including `pnpm -C apps/web start`.
    candidates.add(join(current, "node_modules", "pdfjs-dist", "standard_fonts"));
    // Monorepo-root execution and Next standalone output rooted above apps/web.
    candidates.add(join(
      current,
      "apps",
      "web",
      "node_modules",
      "pdfjs-dist",
      "standard_fonts",
    ));

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return Array.from(candidates);
}

/**
 * Resolve PDF.js assets from runtime filesystem anchors only.
 *
 * Do not use `require.resolve("pdfjs-dist/package.json")` here. Next/Webpack
 * folds that expression into a virtual bundle identifier such as
 * `(rsc)/../../node_modules/...`; treating it as a filesystem path is what
 * caused valid preview requests to fail with HTTP 422.
 */
export function resolvePdfJsStandardFontDataUrl(
  startDirectory: string,
  fileExists: FileExists = existsSync,
): string {
  for (const directory of candidateStandardFontDirectories(startDirectory)) {
    if (fileExists(join(directory, STANDARD_FONT_SENTINEL))) {
      return `${directory}${sep}`;
    }
  }

  throw new Error(
    `PDF.js standard font data could not be located from runtime directory: ${resolve(startDirectory)}`,
  );
}

/**
 * PDF.js' Node font loader expects a filesystem directory ending in a path
 * separator. Resolve it through stable runtime directories so this works with
 * pnpm workspaces, Next.js route bundles, and standalone deployments.
 */
export function getPdfJsStandardFontDataUrl(): string {
  if (standardFontDataUrl) return standardFontDataUrl;
  standardFontDataUrl = resolvePdfJsStandardFontDataUrl(process.cwd());
  return standardFontDataUrl;
}
