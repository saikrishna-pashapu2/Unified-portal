import type { CellView } from "@/lib/xlsx-translator/types";

export function cellTranslationReason(
  cell: CellView | undefined,
  target: string,
): string | null {
  if (!cell?.text.trim()) return "This cell has no text to translate.";
  if (cell.language === target)
    return `Already in ${target}. No translation is needed.`;
  if (cell.language === "English" || cell.protection === "English is preserved")
    return "English is preserved under this workbook's translation rules.";
  switch (cell.protection) {
    case "Identifier / numeric text":
      return "Numbers and identifiers are preserved.";
    case "Number / date / value":
      return "Numbers, dates and other non-text values are preserved.";
    case "Rich text formatting":
      return "Rich-text formatting is protected.";
    case "Excel table header":
      return "Native Excel table headers are protected.";
    default:
      return cell.protection || null;
  }
}
