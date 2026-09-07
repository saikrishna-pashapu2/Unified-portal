import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { resolvePdfJsStandardFontDataUrl } from "../pdfjs-node";

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(TEST_DIRECTORY, "../../..");
const REPOSITORY_ROOT = resolve(WEB_ROOT, "../..");
const FONT_SENTINEL = "LiberationSans-Regular.ttf";

function expectUsableFontDirectory(fontDataUrl: string): void {
  expect(isAbsolute(fontDataUrl)).toBe(true);
  expect(fontDataUrl.endsWith(sep)).toBe(true);
  expect(existsSync(join(fontDataUrl, FONT_SENTINEL))).toBe(true);
}

describe("PDF.js standard-font runtime lookup", () => {
  it("resolves the pnpm-linked package when the process starts in apps/web", () => {
    const fontDataUrl = resolvePdfJsStandardFontDataUrl(WEB_ROOT);

    expect(fontDataUrl).toBe(
      `${join(WEB_ROOT, "node_modules", "pdfjs-dist", "standard_fonts")}${sep}`,
    );
    expectUsableFontDirectory(fontDataUrl);
  });

  it("resolves the workspace package when the process starts at the repository root", () => {
    const fontDataUrl = resolvePdfJsStandardFontDataUrl(REPOSITORY_ROOT);

    expect(fontDataUrl).toBe(
      `${join(WEB_ROOT, "node_modules", "pdfjs-dist", "standard_fonts")}${sep}`,
    );
    expectUsableFontDirectory(fontDataUrl);
  });

  it("finds a traced package from a Next standalone runtime directory", () => {
    const standaloneRoot = join(WEB_ROOT, ".next", "standalone");
    const tracedFontDirectory = join(
      standaloneRoot,
      "apps",
      "web",
      "node_modules",
      "pdfjs-dist",
      "standard_fonts",
    );
    const tracedSentinel = join(tracedFontDirectory, FONT_SENTINEL);

    const fontDataUrl = resolvePdfJsStandardFontDataUrl(
      standaloneRoot,
      (path) => path === tracedSentinel,
    );

    expect(fontDataUrl).toBe(`${tracedFontDirectory}${sep}`);
    expect(isAbsolute(fontDataUrl)).toBe(true);
    expect(fontDataUrl.endsWith(sep)).toBe(true);
  });

  it("fails explicitly when no candidate contains the standard-font sentinel", () => {
    const missingRoot = join(WEB_ROOT, ".next", "missing-runtime");

    expect(() => resolvePdfJsStandardFontDataUrl(missingRoot, () => false)).toThrow(
      `PDF.js standard font data could not be located from runtime directory: ${resolve(missingRoot)}`,
    );
  });
});
