import { describe, it, expect } from "vitest";
import { incrementalInput } from "./test-fixtures";
import { buildPlan, inspectWorkbook } from "./workbook";
import { buildJobPlan } from "./job-plan";
import { unzipSync, zipSync, strToU8 } from "fflate";
import { createHash } from "node:crypto";
const id = "22222222-2222-4222-8222-222222222222";
describe("Incremental workbook plan", () => {
  it("replays paid v1/v2 languages, entry hashes and budgets while new scopes use v3 detection", () => {
    const parts = unzipSync(incrementalInput());
    const text =
      "Услуга по техническому обслуживанию фотоэлектрических панелей";
    parts["xl/worksheets/sheet1.xml"] = strToU8(
      `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${text}</t></is></c><c r="B1" t="str"><f>CONCAT("Quyosh", " panellari")</f><v>Quyosh panellari</v></c></row></sheetData></worksheet>`,
    );
    const book = inspectWorkbook(Buffer.from(zipSync(parts)));
    const payload = {
      filename: "test.xlsx",
      targetLang: "Russian",
      selections: [{ sheet: "Data", range: "A1:B1" }],
    };
    const expectedOldId = createHash("sha256")
      .update(JSON.stringify([`Sheet: Data; column: ${text}`, text, "Unknown"]))
      .digest("hex")
      .slice(0, 24);
    for (const version of [undefined, 2] as const) {
      const old = buildJobPlan(book, { ...payload, planVersion: version });
      expect(old.entries[0]).toMatchObject({
        id: expectedOldId,
        language: "Unknown",
      });
      expect(old.entries).toHaveLength(version === undefined ? 1 : 2);
      expect(old.batchKeys).toEqual(["0"]);
      const next = buildJobPlan(book, {
        ...payload,
        planVersion: version,
        additions: [
          {
            id,
            planVersion: 3,
            selections: [{ sheet: "Data", range: "B1" }],
            planHash: "unused",
          },
        ],
      });
      expect(next.entries[0]).toMatchObject({
        id: expectedOldId,
        language: "Unknown",
      });
      expect(next.batchKeys).toEqual(["0", `${id}:0`]);
      expect(next.entries.at(-1)?.id).toMatch(new RegExp(`^${id}:`));
    }
    const fresh = buildJobPlan(book, { ...payload, planVersion: 3 });
    expect(fresh.entries).toHaveLength(1);
    expect(fresh.entries[0].source).toBe("Quyosh panellari");
    expect(fresh.entries[0].cells).toEqual(['["Data","B1"]']);
  });
  it("preserves original IDs and budget keys for legacy jobs", () => {
    const book = inspectWorkbook(incrementalInput()),
      selections = [{ sheet: "Data", range: "A1:A2" }];
    const old = buildPlan(book, selections, "Russian");
    const next = buildJobPlan(book, {
      filename: "test.xlsx",
      targetLang: "Russian",
      selections,
    });
    expect(next.entries).toEqual(old.entries);
    expect(next.batches).toEqual(old.batches);
    expect(next.batchKeys).toEqual(["0"]);
  });
  it("supersedes only one cell of a deduplicated group and gives the new cell its own budget", () => {
    const p = {
      filename: "test.xlsx",
      targetLang: "Russian",
      selections: [{ sheet: "Data", range: "A1:A2" }],
      additions: [
        {
          id,
          selections: [{ sheet: "Data", range: "A1" }],
          planHash: "unused",
        },
      ],
    };
    const plan = buildJobPlan(inspectWorkbook(incrementalInput()), p);
    expect(plan.batchKeys).toEqual(["0", `${id}:0`]);
    expect(plan.entries[0].cells).toEqual(['["Data","A2"]']);
    expect(plan.entries[1].cells).toEqual(['["Data","A1"]']);
    expect(plan.entries[1].id).toContain(id);
  });
});
