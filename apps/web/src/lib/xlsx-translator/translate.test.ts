import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/config/env", () => ({ env: {} }));
const provider = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({
  default: class {
    responses = { create: provider.create };
  },
}));
import {
  requestBatch,
  validateBatch,
  validateBatchCells,
  type BatchResponse,
} from "./translate";
import {
  detectCellLanguage,
  isIdentifierText,
  protectedTokens,
  normalizeRussianPlaceNameSpelling,
} from "./language";
const entry = {
  id: "a",
  source: "Quyosh panellari 25",
  context: "Equipment",
  language: "Uzbek" as const,
  cells: ["x"],
};
describe("Excel translation validation", () => {
  it.each([
    ["Yakkasaroy sanoat zonasi 8-blok", "Промышленная зона Яккасарай, 8-блок"],
    [
      "Yangiariq tumani 37-maktabi B2540609608",
      "Янгиарыкский район школа №37 B2540609608",
    ],
    [
      "Gurlan tuman 2-son politexnikumi NS2481025368",
      "Гурленский районный политехникум 2-го номера NS2481025368",
    ],
    [
      "Shahrisabz tumani 3-sonli OP NS24A1065194",
      "Шахрисабзский районный OP 3-го номера NS24A1065194",
    ],
    [
      "Yunusobod tumani 4-son issiqlik markazi (qo'shimcha) NS24B1059871",
      "Юнусабадский районный тепловой центр 4-го номера (дополнительный) NS24B1059871",
    ],
  ])(
    "accepts saved numbered-text candidate without changing protected values: %s",
    (source, text) => {
      expect(
        validateBatch(
          [{ ...entry, source }],
          {
            cells: [
              { id: "a", text, action: "translated", sourceLanguage: "Uzbek" },
            ],
          },
          "Russian",
        ).a,
      ).toBe(text);
    },
  );
  it("accepts only the MChJ label change within an otherwise untouched English company name", () => {
    const source = "Master Building Products MChJ (Vero Group) TA22B0431368";
    const text = "Master Building Products ООО (Vero Group) TA22B0431368";
    const e = { ...entry, source, language: "Unknown" as const };
    const c = {
      id: "a",
      text,
      sourceLanguage: "English" as const,
      action: "translated" as const,
    };
    expect(validateBatch([e], { cells: [c] }, "Russian").a).toBe(text);
    for (const bad of [
      text.replace("Master", "Мастер"),
      text.replace("Vero Group", "Vero"),
      text.replace("Products", "products"),
      text.replace("TA22B0431368", "TA22B0431369"),
    ])
      expect(() =>
        validateBatch([e], { cells: [{ ...c, text: bad }] }, "Russian"),
      ).toThrow();
    expect(() =>
      validateBatch([e], { cells: [{ ...c, action: "preserved" }] }, "Russian"),
    ).toThrow();
    expect(() => validateBatch([e], { cells: [c] }, "Arabic")).toThrow();
  });
  it.each([
    ["37-maktabi", "школа №38"],
    ["8-blok", "9-блок"],
    ["2-son", "3-го номера"],
    ["2-son", "2-го и 2-го"],
    ["AB2-го", "AB2"],
    ["2-ГО", "2-го"],
    ["5-M", "5-й"],
  ])("does not weaken number or code checks: %s", (source, text) => {
    expect(protectedTokens(source)).not.toEqual(protectedTokens(text));
  });
  it("accepts the actual B318 response after a source-evidenced Russian spelling correction", () => {
    const source =
      "Yangihayot tumani Turizmni rivojlantirish kolleji TA22B0365031";
    const text = "Колледж развития туризма Янгиҳаётского района TA22B0365031";
    const result = validateBatch(
      [{ ...entry, source }],
      {
        cells: [
          { id: "a", text, sourceLanguage: "Uzbek", action: "translated" },
        ],
      },
      "Russian",
    );
    expect(result.a).toBe(
      "Колледж развития туризма Янгихаётского района TA22B0365031",
    );
  });
  it.each([
    [
      "Chiroqchi tumani 8-DMTT B2551945085",
      "Чироқчинский район 8-DMTT B2551945085",
      "Чиракчинский район 8-DMTT B2551945085",
    ],
    [
      "Marg'ilon shahri 26-DMTT NS2481025360",
      "город Марғилон 26-DMTT NS2481025360",
      "город Маргилан 26-DMTT NS2481025360",
    ],
    [
      "Bo'stonliq tumani 18-DMTT TA22B0311613",
      "Бўстонлиқский район 18-DMTT TA22B0311613",
      "Бостанлыкский район 18-DMTT TA22B0311613",
    ],
  ])(
    "recovers a saved Russian response with an evidenced administrative place name: %s",
    (source, text, expected) => {
      expect(detectCellLanguage(text)).toBe("Uzbek");
      expect(
        validateBatch(
          [{ ...entry, source }],
          {
            cells: [
              { id: "a", text, sourceLanguage: "Uzbek", action: "translated" },
            ],
          },
          "Russian",
        ).a,
      ).toBe(expected);
      expect(protectedTokens(expected)).toEqual(protectedTokens(source));
      expect(() =>
        validateBatch(
          [{ ...entry, source }],
          {
            cells: [
              {
                id: "a",
                text: text.replace(/.$/, "9"),
                sourceLanguage: "Uzbek",
                action: "translated",
              },
            ],
          },
          "Russian",
        ),
      ).toThrow("numeric value or identifier");
    },
  );
  it.each(["'", "‘", "’", "ʻ", "ʼ", "`"])(
    "matches an exact place name across Uzbek apostrophe variant %s",
    (apostrophe) => {
      expect(
        normalizeRussianPlaceNameSpelling(
          `Marg${apostrophe}ilon shahri`,
          "в городе Марғилоне",
        ),
      ).toBe("в городе Маргилане");
      expect(
        normalizeRussianPlaceNameSpelling(
          `Bo${apostrophe}stonliq tumani`,
          "Бўстонлиқского района",
        ),
      ).toBe("Бостанлыкского района");
    },
  );
  it.each([
    ["Other tumani", "Чироқчинский район"],
    ["ChiroqchiX tumani", "Чироқчинский район"],
    ["Chiroqchi savdo", "Чироқчинский район"],
    ["Chiroqchi tumani", "Чироқчинский МЧЖ"],
    ["Chiroqchi tumani", "Код Чироқчинский123 район"],
    ["Marg'ilon shahri", "Марғилон шаҳри"],
    ["Marg'ilon company", "город Марғилон"],
    ["Marg'ilon shahri", "город Марғилон123"],
    ["Bo'stonliq tumani", "Бўстонлиқ тумани"],
    ["Bo'stonliq district", "Бўстонлиқский район"],
  ])(
    "does not hide untranslated prose or modify unsupported names/codes: %s",
    (source, text) => {
      expect(normalizeRussianPlaceNameSpelling(source, text)).toBe(text);
      expect(() =>
        validateBatch(
          [{ ...entry, source }],
          {
            cells: [
              { id: "a", text, sourceLanguage: "Uzbek", action: "translated" },
            ],
          },
          "Russian",
        ),
      ).toThrow();
    },
  );
  it("still rejects Uzbek prose and protected-language changes around a corrected place", () => {
    const source = "Chiroqchi tumani";
    const value: BatchResponse = {
      cells: [
        {
          id: "a",
          text: "Чироқчинский район учун",
          sourceLanguage: "Uzbek",
          action: "translated",
        },
      ],
    };
    expect(() =>
      validateBatch([{ ...entry, source }], value, "Russian"),
    ).toThrow("Uzbek prose");
    value.cells[0].text = "Чироқчинский район";
    expect(() =>
      validateBatch(
        [{ ...entry, source, language: "English" }],
        value,
        "Russian",
      ),
    ).toThrow("Protected language");
    expect(() =>
      validateBatch(
        [{ ...entry, source }],
        { cells: [{ ...value.cells[0], action: "preserved" }] },
        "Russian",
      ),
    ).toThrow();
  });
  it.each([
    ["Other tumani", "Колледж Янгиҳаётского района"],
    ["Yangihayot tumani", "Янгиҳаёт тумани коллежи"],
    ["Yangihayot tumani", "Код Янгиҳаётского123"],
    ["Yangihayot tumani", "янгиҳаётского"],
  ])(
    "does not rewrite arbitrary Uzbek or ungrounded names: %s",
    (source, text) => {
      expect(normalizeRussianPlaceNameSpelling(source, text)).toBe(text);
    },
  );
  it("still rejects genuinely untranslated prose alongside the corrected name", () => {
    expect(() =>
      validateBatch(
        [{ ...entry, source: "Yangihayot tumani" }],
        {
          cells: [
            {
              id: "a",
              text: "Янгиҳаётского района tumani",
              sourceLanguage: "Uzbek",
              action: "translated",
            },
          ],
        },
        "Russian",
      ),
    ).toThrow("Uzbek prose");
  });
  it("sends explicit protected tokens to Luna without calling a real provider", async () => {
    provider.create.mockResolvedValueOnce({
      status: "completed",
      output_text: JSON.stringify({ cells: [] }),
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    await requestBatch(
      [{ ...entry, source: "123-maktab HV23A8284375" }],
      "Russian",
    );
    const request = provider.create.mock.calls.at(-1)![0];
    expect(request.model).toBe("gpt-5.6-luna");
    expect(request.max_output_tokens).toBe(6000);
    expect(request.store).toBe(false);
    expect(
      JSON.parse(request.input[1].content).cells[0].protectedTokens,
    ).toEqual(["123", "HV23A8284375"]);
  });
  const cell = (id: string, text: string): BatchResponse["cells"][number] => ({
    id,
    text,
    sourceLanguage: "Uzbek",
    action: "translated",
  });
  it.each([
    ["Uchtepa tumani 123-maktab ", "Учтепинский район, школа №123"],
    [
      "Chilonzor tumani 103-sonli maktab HV23A8284375",
      "Чиланзарский район, школа №103 HV23A8284375",
    ],
    [
      "2-son tumanlaro dispanseri BT2270596241",
      "Межрайонный диспансер №2 BT2270596241",
    ],
    ["2025-йил учун", "за 2025 год"],
  ])(
    "accepts numbered prose without freezing its Uzbek suffix: %s",
    (source, text) => {
      expect(
        validateBatch(
          [{ ...entry, source }],
          { cells: [cell("a", text)] },
          "Russian",
        ).a,
      ).toBe(text);
    },
  );
  it.each([
    ["123-maktab", "школа №124"],
    ["123-maktab", "школа"],
    ["123-maktab", "школа №123, №123"],
    ["22-DMTT B2550934830", "22-DMTT B2550934831"],
    ["22-DMTT B2550934830", "22 B2550934830"],
    ["код АБ123", "код АБ124"],
    ["-25.50", "25.50"],
    ["01.03.2025", "03.01.2025"],
  ])("still protects figures and actual codes: %s", (source, text) => {
    expect(protectedTokens(source)).not.toEqual(protectedTokens(text));
  });
  it("does not split a grammatical-looking suffix inside a real identifier", () => {
    expect(protectedTokens("AB123-sonli")).toEqual(["AB123-sonli"]);
    expect(protectedTokens("103-sonli-ABC")).toEqual(["103-sonli-ABC"]);
  });
  it("retains valid sibling cells while rejecting missing, duplicate and bad IDs", () => {
    const entries = [
      entry,
      { ...entry, id: "b" },
      { ...entry, id: "c" },
      { ...entry, id: "d" },
    ];
    const result = validateBatchCells(
      entries,
      {
        cells: [
          cell("a", "Солнечные панели 25"),
          cell("b", "Солнечные панели 26"),
          cell("c", "Солнечные панели 25"),
          cell("c", "Солнечные панели 25"),
          cell("unexpected", "Солнечные панели 25"),
        ],
      },
      "Russian",
    );
    expect(result.translations).toEqual({ a: "Солнечные панели 25" });
    expect(result.issues.map((i) => i.id)).toEqual(["b", "c", "d", "response"]);
  });
  it("detects supported language cues without mistaking IDs and dates for prose", () => {
    expect(detectCellLanguage("Toshloq tumani maktab")).toBe("Uzbek");
    expect(detectCellLanguage("Наименование организации")).toBe("Russian");
    expect(detectCellLanguage("meterNotes")).toBe("English");
    expect(isIdentifierText("2026-08-09T19:00:00.000Z")).toBe(true);
    expect(isIdentifierText("HV23A8181154")).toBe(true);
  });
  it("validates a translation and rejects altered figures", () => {
    const response = {
      cells: [
        {
          id: "a",
          text: "Солнечные панели 25",
          sourceLanguage: "Uzbek" as const,
          action: "translated" as const,
        },
      ],
    };
    expect(validateBatch([entry], response, "Russian").a).toBe(
      "Солнечные панели 25",
    );
    expect(() =>
      validateBatch(
        [entry],
        { cells: [{ ...response.cells[0], text: "Солнечные панели 26" }] },
        "Russian",
      ),
    ).toThrow("numeric");
  });
  it("rejects missing IDs, duplicate IDs and unchanged Uzbek", () => {
    expect(() => validateBatch([entry], { cells: [] }, "Russian")).toThrow();
    expect(() =>
      validateBatch(
        [entry],
        {
          cells: [
            {
              id: "a",
              text: entry.source,
              sourceLanguage: "Uzbek",
              action: "preserved",
            },
          ],
        },
        "Russian",
      ),
    ).toThrow("not translated");
  });
  it("does not allow English text to be changed", () => {
    expect(() =>
      validateBatch(
        [{ ...entry, source: "The company", language: "English" }],
        {
          cells: [
            {
              id: "a",
              text: "Компания",
              sourceLanguage: "English",
              action: "translated",
            },
          ],
        },
        "Russian",
      ),
    ).toThrow("Protected");
  });
});
