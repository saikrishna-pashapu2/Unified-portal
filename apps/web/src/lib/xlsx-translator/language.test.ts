import { describe, expect, it } from "vitest";
import { detectCellLanguage, detectLegacyCellLanguage } from "./language";

const russianSentences = [
  "Услуга по техническому обслуживанию фотоэлектрических панелей",
  "Центр подготовки к олимпийским и паралимпийским видам спорта Намангана HV2330700729",
];

describe("Cell language eligibility", () => {
  it("recognises the reported Russian sentences without spending API requests", () => {
    for (const text of russianSentences) {
      expect(detectLegacyCellLanguage(text)).toBe("Unknown");
      expect(detectCellLanguage(text)).toBe("Russian");
    }
  });
  it("uses multiple Russian clues without guessing the language of every Cyrillic cell", () => {
    expect(detectCellLanguage("Солнечные панели")).toBe("Russian");
    expect(detectCellLanguage("Договор поставки")).toBe("Russian");
    for (const text of [
      "Наманган",
      "Яшил Энергия",
      "ФЭС",
      "Центр",
      "Тошкент",
    ]) {
      expect(detectCellLanguage(text)).toBe("Unknown");
    }
  });
  it("recognises Cyrillic Uzbek words at real Unicode boundaries before Russian clues", () => {
    for (const text of [
      "Станция учун",
      "Услуга по техническому обслуживанию — 2025 йил",
      "Услуга по техническому обслуживанию билан",
      "Количество: ном и сони",
      "Обслуживание хизмати",
      "quyosh panellari",
      "Қуёш панели",
      "Услуга по техническому обслуживанию quyosh",
    ]) {
      expect(detectCellLanguage(text)).toBe("Uzbek");
    }
    expect(detectLegacyCellLanguage("Станция учун")).toBe("Russian");
    expect(detectCellLanguage("Количество — сонирование")).toBe("Russian");
  });
  it("does not broaden the English protection heuristic", () => {
    for (const text of [
      "meterNotes",
      "This is a solar power station",
      "SUN HIGH TECH",
      "Arabic العربية",
      "Unclassified proper names",
    ]) {
      expect(detectCellLanguage(text)).toBe(detectLegacyCellLanguage(text));
    }
  });
});
