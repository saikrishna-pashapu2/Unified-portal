import { describe, expect, it } from "vitest";
import type { CellView } from "@/lib/xlsx-translator/types";
import { cellTranslationReason } from "./cell-feedback";

const cell = (props: Partial<CellView> = {}): CellView => ({
  address: "B2",
  row: 2,
  col: 2,
  text: "Quyosh panellari",
  formula: false,
  language: "Uzbek",
  style: {},
  ...props,
});

describe("Workbook cell action feedback", () => {
  it("allows eligible text and cached formula text", () => {
    expect(cellTranslationReason(cell(), "Russian")).toBeNull();
    expect(
      cellTranslationReason(cell({ formula: true }), "Russian"),
    ).toBeNull();
  });
  it("explains target language and preserved English instead of silently disabling cells", () => {
    expect(
      cellTranslationReason(cell({ language: "Russian" }), "Russian"),
    ).toContain("Already in Russian");
    expect(
      cellTranslationReason(cell({ language: "English" }), "Russian"),
    ).toContain("English is preserved");
    expect(
      cellTranslationReason(cell({ language: "English" }), "English"),
    ).toContain("Already in English");
    expect(
      cellTranslationReason(cell({ language: "Russian" }), "Arabic"),
    ).toBeNull();
  });
  it.each([
    ["Identifier / numeric text", "Numbers and identifiers"],
    ["Number / date / value", "Numbers, dates"],
    ["Rich text formatting", "Rich-text formatting"],
    ["Excel table header", "Native Excel table headers"],
  ])("explains %s", (protection, reason) => {
    expect(cellTranslationReason(cell({ protection }), "Russian")).toContain(
      reason,
    );
  });
  it("explains empty and missing cells", () => {
    expect(cellTranslationReason(undefined, "Russian")).toContain("no text");
    expect(cellTranslationReason(cell({ text: "  " }), "Russian")).toContain(
      "no text",
    );
  });
});
