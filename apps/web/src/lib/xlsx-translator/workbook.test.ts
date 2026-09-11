import { describe, it, expect } from "vitest";
import { zipSync, strToU8, strFromU8 } from "fflate";
import {
  buildPlan,
  cellKey,
  inspectWorkbook,
  rangeBounds,
  readZip,
  writeTranslations,
  sheetPreview,
} from "./workbook";
export function fixture(extra: Record<string, string> = {}) {
  const entries: Record<string, string> = {
    "[Content_Types].xml":
      '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    "xl/workbook.xml":
      '<workbook xmlns:r="urn:r"><sheets><sheet name="Data" r:id="r1"/><sheet name="Calculations" state="hidden" r:id="r2"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/></Relationships>',
    "xl/sharedStrings.xml":
      "<sst><si><t>Quyosh panellari</t></si><si><t>Hudud</t></si><si><t>Ijtimoiy soha</t></si></sst>",
    "xl/worksheets/sheet1.xml":
      '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>meterId</t></is></c><c r="B1" t="inlineStr"><is><t>meterNotes</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>123456</t></is></c><c r="B2" s="1" t="s"><v>0</v></c><c r="C2"><v>250</v></c></row><row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3" t="s"><v>0</v></c></row><row r="6"><c r="A6" t="s"><v>1</v></c><c r="B6" t="inlineStr"><is><t>maktab</t></is></c></row></sheetData><mergeCells><mergeCell ref="A6:A7"/></mergeCells></worksheet>',
    "xl/worksheets/sheet2.xml":
      '<worksheet><sheetData><row r="1"><c r="A1"><f>COUNTIF(Data!A:A,"Ijtimoiy soha")</f><v>1</v></c></row></sheetData></worksheet>',
    "xl/styles.xml":
      '<styleSheet><fonts><font><sz val="12"/></font><font><b/><sz val="14"/></font></fonts><fills><fill/></fills><cellXfs><xf fontId="0"/><xf fontId="1"/></cellXfs></styleSheet>',
    "docProps/custom.xml": "<Properties>preserve verbatim</Properties>",
    ...extra,
  };
  return Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(entries).map(([k, v]) => [k, strToU8(v)]),
      ),
    ),
  );
}
describe("Excel structure-preserving translation", () => {
  it("marks untranslated selected cells as pending while preserving other originals", () => {
    const view = sheetPreview(
      inspectWorkbook(fixture()),
      "Data",
      "A1:C3",
      { [cellKey("Data", "B2")]: "Солнечные панели" },
      new Set([cellKey("Data", "B3")]),
    );
    expect(view.cells.find((c) => c.address === "B2")).toMatchObject({
      translated: "Солнечные панели",
      translationPending: false,
    });
    expect(view.cells.find((c) => c.address === "B3")).toMatchObject({
      translationPending: true,
    });
    expect(view.cells.find((c) => c.address === "A1")).toMatchObject({
      text: "meterId",
      translated: "meterId",
      translationPending: false,
    });
  });
  it("does not swallow populated cells after self-closing formatted blank cells", () => {
    const b = inspectWorkbook(
      fixture({
        "xl/worksheets/sheet1.xml":
          '<worksheet><sheetData><row r="1"><c r="A1" s="1"/><c r="B1" t="s"><v>0</v></c></row></sheetData></worksheet>',
      }),
    );
    const out = inspectWorkbook(
      writeTranslations(b, { [cellKey("Data", "B1")]: "Солнечные панели" }),
    );
    expect(out.sheets[0].cells.get("B1")?.text).toBe("Солнечные панели");
  });
  it("protects rich text and actual Excel table headers", () => {
    const b = inspectWorkbook(
      fixture({
        "xl/sharedStrings.xml":
          "<sst><si><r><rPr><b/></rPr><t>Quyosh panellari</t></r></si><si><t>Hudud</t></si></sst>",
        "xl/worksheets/_rels/sheet1.xml.rels":
          '<Relationships><Relationship Id="table1" Target="../tables/table1.xml"/></Relationships>',
        "xl/tables/table1.xml": '<table displayName="Meters" ref="A6:B6"/>',
      }),
    );
    expect(b.sheets[0].cells.get("B2")?.protection).toBe(
      "Rich text formatting",
    );
    expect(b.sheets[0].cells.get("B6")?.protection).toBe("Excel table header");
  });
  it("allows text despite shared and structured formula dependencies, but replays legacy plans unchanged", () => {
    const b = inspectWorkbook(
      fixture({
        "xl/worksheets/sheet2.xml":
          '<worksheet><sheetData><row r="1"><c r="A1"><f t="shared">SUM(Meters[Hudud])</f><v>1</v></c></row></sheetData></worksheet>',
      }),
    );
    expect(
      buildPlan(b, [{ sheet: "Data", range: "A1:C3" }], "Russian").entries,
    ).toHaveLength(2);
    expect(
      buildPlan(b, [{ sheet: "Data", range: "A1:C3" }], "Russian", true)
        .entries,
    ).toHaveLength(0);
  });
  it("inspects hidden sheets, formulas, merged ranges and separate regions", () => {
    const b = inspectWorkbook(fixture());
    expect(b.inspection.sheetCount).toBe(2);
    expect(b.inspection.formulaCount).toBe(1);
    expect(b.inspection.mergeCount).toBe(1);
    expect(b.inspection.sheets[1].hidden).toBe(true);
    expect(b.sheets[0].tables).toHaveLength(2);
    expect(b.sheets[0].cells.get("B2")?.style.bold).toBe(true);
  });
  it("protects English and numbers but allows labels referenced by hidden formulas", () => {
    const b = inspectWorkbook(fixture()),
      p = buildPlan(b, [{ sheet: "Data", range: "A1:C3" }], "Russian");
    expect(p.entries).toHaveLength(2);
    expect(p.entries[0].cells).toHaveLength(2);
    expect(p.entries[0].source).toBe("Quyosh panellari");
    expect(p.protectedCells).toBe(4);
    expect(b.sheets[0].cells.get("A3")?.protection).toBeUndefined();
  });
  it("replaces selected cells only and never edits a shared string used elsewhere", () => {
    const b = inspectWorkbook(fixture()),
      output = readZip(
        writeTranslations(b, { [cellKey("Data", "B2")]: "Солнечные панели" }),
      );
    for (const part of Object.keys(b.parts))
      if (
        part !== "xl/worksheets/sheet1.xml" &&
        part !== "xl/worksheets/sheet2.xml"
      )
        expect(output[part]).toEqual(b.parts[part]);
    const text = strFromU8(output["xl/worksheets/sheet1.xml"]);
    expect(text).toContain('<c r="B3" t="s"><v>0</v></c>');
    expect(text).toContain('s="1" t="inlineStr"');
    expect(text).toContain("Солнечные панели");
    const reopened = inspectWorkbook(Buffer.from(zipSync(output)));
    expect(reopened.sheets[0].cells.get("B3")?.text).toBe("Quyosh panellari");
  });
  it("stores formula-looking model output as literal text, not an executable formula", () => {
    const result = readZip(
      writeTranslations(inspectWorkbook(fixture()), {
        [cellKey("Data", "B2")]: '=HYPERLINK("https://example.com") <&>',
      }),
    );
    expect(strFromU8(result["xl/worksheets/sheet1.xml"])).toContain(
      "&lt;&amp;&gt;",
    );
    expect(strFromU8(result["xl/worksheets/sheet1.xml"])).not.toContain(
      "<f>HYPERLINK",
    );
  });
  it("rejects protected writes and invalid selections", () => {
    const b = inspectWorkbook(fixture());
    expect(() =>
      writeTranslations(b, { [cellKey("Data", "C2")]: "changed" }),
    ).toThrow("protected");
    expect(() =>
      buildPlan(b, [{ sheet: "Data", range: "A1:ZZ9999" }], "Russian"),
    ).toThrow("bounds");
    expect(() => rangeBounds("XFE1:XFE9")).toThrow();
  });
  it("supports column selection and overlapping ranges without duplicate work", () => {
    const b = inspectWorkbook(fixture()),
      p = buildPlan(
        b,
        [
          { sheet: "Data", range: "A1:C3", columns: [2] },
          { sheet: "Data", range: "B2:B3" },
        ],
        "Russian",
      );
    expect(p.selectedCells).toBe(3);
    expect(p.entries[0].cells).toHaveLength(2);
  });
  it("rejects non-workbook ZIPs, macros and XML entities", () => {
    expect(() =>
      inspectWorkbook(Buffer.from(zipSync({ "hello.txt": strToU8("hello") }))),
    ).toThrow();
    expect(() =>
      inspectWorkbook(fixture({ "xl/vbaProject.bin": "macro" })),
    ).toThrow("Macros");
    expect(() =>
      inspectWorkbook(
        fixture({ "xl/workbook.xml": "<!DOCTYPE x><workbook/>" }),
      ),
    ).toThrow("entities");
  });
  it("bounds archive expansion before decompressing", () => {
    const b = fixture();
    for (let i = 0; i < b.length - 46; i++)
      if (b.readUInt32LE(i) === 0x02014b50) {
        b.writeUInt32LE(256 * 1024 * 1024, i + 24);
        break;
      }
    expect(() => readZip(b)).toThrow("safe processing");
  });
  it("uses actual Excel table ranges when available", () => {
    const b = inspectWorkbook(
      fixture({
        "xl/worksheets/_rels/sheet1.xml.rels":
          '<Relationships><Relationship Id="table1" Target="../tables/table1.xml"/></Relationships>',
        "xl/tables/table1.xml": '<table displayName="Meters" ref="A1:C3"/>',
      }),
    );
    expect(b.sheets[0].tables[0]).toMatchObject({
      kind: "table",
      label: "Meters",
      range: "A1:C3",
    });
  });
});
