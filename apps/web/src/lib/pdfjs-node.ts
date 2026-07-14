import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";

const requireFromThisModule = createRequire(import.meta.url);

let standardFontDataUrl: string | undefined;

/**
 * PDF.js' Node font loader expects a filesystem directory ending in a path
 * separator. Resolve it from the installed package so this also works with
 * pnpm's versioned package store and Next.js standalone deployments.
 */
export function getPdfJsStandardFontDataUrl(): string {
  if (standardFontDataUrl) return standardFontDataUrl;

  const directory = join(
    dirname(requireFromThisModule.resolve("pdfjs-dist/package.json")),
    "standard_fonts",
  );
  if (!existsSync(join(directory, "LiberationSans-Regular.ttf"))) {
    throw new Error(
      `PDF.js standard font data is missing from the installed package: ${directory}`,
    );
  }

  standardFontDataUrl = `${directory}${sep}`;
  return standardFontDataUrl;
}
