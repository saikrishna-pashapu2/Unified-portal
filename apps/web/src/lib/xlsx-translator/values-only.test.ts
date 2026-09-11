import { describe, it, expect } from "vitest";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { incrementalInput } from "./test-fixtures";
import {
  inspectWorkbook,
  buildPlan,
  writeTranslations,
  valuesOnlyWorkbook,
  cellKey,
  assertSavedFormulaResults,
} from "./workbook";
import { buildJobPlan } from "./job-plan";

function source(extra = "") {
  const parts = unzipSync(incrementalInput());
  parts["xl/worksheets/sheet1.xml"] = strToU8(`<worksheet><sheetData>
 <row r="1"><c r="A1" s="1" t="str"><f>CONCAT("Quyosh"," panellari")</f><v>Quyosh panellari</v></c><c r="B1"><f>1+1</f><v>2</v></c><c r="C1" t="str"><f>""</f><v/></c><c r="D1" t="str"><f>"English remains unchanged"</f><v>English remains unchanged</v></c></row>
 <row r="2"><c r="A2" t="str"><f t="shared" si="0" ref="A2:B2">A1</f><v>Quyosh panellari</v></c><c r="B2"><f t="shared" si="0"/><v>0</v></c><c r="C2"><f t="array" ref="C2:D2">SEQUENCE(1,2)</f><v>42</v></c><c r="D2"><v>43</v></c></row>
 <row r="3"><c r="A3" t="b"><f>1=1</f><v>1</v></c><c r="B3" s="2"><f>DATE(2026,1,1)</f><v>46023</v></c><c r="C3" t="e"><f>1/0</f><v>#DIV/0!</v></c>${extra}</row>
 <row r="4"><c r="A4" t="inlineStr"><is><t>Quyosh stansiyasi</t></is></c></row>
 </sheetData><dataValidations><dataValidation sqref="A4"><formula1>A1</formula1></dataValidation></dataValidations></worksheet>`);
  parts["xl/worksheets/sheet2.xml"] = strToU8(
    '<worksheet><sheetData><row r="1"><c r="A1"><f>SUM(INDIRECT("Data!B1"),OFFSET(Data!B2,0,0),Table1[Hudud])</f><v>2</v></c></row></sheetData></worksheet>',
  );
  parts["xl/calcChain.xml"] = strToU8(
    '<calcChain><c r="A1" i="1"/></calcChain>',
  );
  parts["xl/_rels/workbook.xml.rels"] = strToU8(
    strFromU8(parts["xl/_rels/workbook.xml.rels"]).replace(
      "</Relationships>",
      '<Relationship Id="calc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/></Relationships>',
    ),
  );
  parts["[Content_Types].xml"] = strToU8(
    strFromU8(parts["[Content_Types].xml"]).replace(
      "</Types>",
      '<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/></Types>',
    ),
  );
  parts["xl/tables/table1.xml"] = strToU8(
    "<table><tableColumns><tableColumn><calculatedColumnFormula>A1</calculatedColumnFormula><totalsRowFormula>SUM(A1)</totalsRowFormula></tableColumn></tableColumns></table>",
  );
  return Buffer.from(zipSync(parts));
}

describe("Values-only Excel export", () => {
  it("allows formula text and referenced labels without changing other protections", () => {
    const book = inspectWorkbook(source());
    const plan = buildPlan(
      book,
      [{ sheet: "Data", range: "A1:D4" }],
      "Russian",
    );
    expect(plan.entries.flatMap((e) => e.cells)).toEqual(
      expect.arrayContaining([
        cellKey("Data", "A1"),
        cellKey("Data", "A2"),
        cellKey("Data", "A4"),
      ]),
    );
    // Use a label covered by the unchanged deterministic English detector.
    expect(
      inspectWorkbook(
        Buffer.from(
          zipSync({
            ...unzipSync(source()),
            "xl/worksheets/sheet1.xml": strToU8(
              '<worksheet><sheetData><row r="1"><c r="D1" t="str"><f>"meterNotes"</f><v>meterNotes</v></c></row></sheetData></worksheet>',
            ),
          }),
        ),
      ).sheets[0].cells.get("D1")?.protection,
    ).toBe("English is preserved");
    expect(book.sheets[0].cells.get("B1")?.protection).toBe(
      "Number / date / value",
    );
    expect(book.sheets[0].cells.get("C1")?.protection).toBeTruthy();
  });
  it("removes every cell/shared/array formula and calculation metadata while preserving saved types, values and the input", () => {
    const input = source(),
      before = Buffer.from(input),
      book = inspectWorkbook(input);
    const output = writeTranslations(book, {
      [cellKey("Data", "A1")]: "Солнечные панели",
    });
    expect(input).toEqual(before);
    const parts = unzipSync(output);
    for (const name of ["xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"])
      expect(strFromU8(parts[name])).not.toMatch(/<f\b/);
    expect(parts["xl/calcChain.xml"]).toBeUndefined();
    expect(strFromU8(parts["xl/_rels/workbook.xml.rels"])).not.toContain(
      "calcChain",
    );
    expect(strFromU8(parts["[Content_Types].xml"])).not.toContain("calcChain");
    expect(strFromU8(parts["xl/tables/table1.xml"])).not.toContain("Formula");
    const sheet = strFromU8(parts["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain('<c r="B2"><v>0</v></c>');
    expect(sheet).toContain('<c r="C1" t="str"><v/></c>');
    expect(sheet).toContain('<c r="B3" s="2"><v>46023</v></c>');
    expect(sheet).toContain('<c r="A3" t="b"><v>1</v></c>');
    expect(sheet).toContain('<c r="C3" t="e"><v>#DIV/0!</v></c>');
    const reopened = inspectWorkbook(output);
    expect(reopened.inspection.formulaCount).toBe(0);
    expect(reopened.sheets[0].cells.get("A1")?.text).toBe("Солнечные панели");
    expect(reopened.sheets[0].cells.get("A2")?.text).toBe("Quyosh panellari");
    expect(reopened.sheets[0].cells.get("D1")?.text).toBe(
      "English remains unchanged",
    );
    expect(reopened.sheets[1].cells.get("A1")?.text).toBe("2");
    expect(
      inspectWorkbook(valuesOnlyWorkbook(output)).inspection.formulaCount,
    ).toBe(0);
  });
  it.each(['<c r="D3"><f>1+1</f></c>', '<c r="D3"><f>1+1</f><v/></c>'])(
    "rejects a missing cached result before discarding any formula",
    (extra) => {
      const input = source(extra),
        book = inspectWorkbook(input);
      expect(() => assertSavedFormulaResults(book)).toThrow("Data!D3");
      expect(() => valuesOnlyWorkbook(input)).toThrow("recalculate");
    },
  );
  it("keeps old paid scopes frozen while enabling new additions in the same job", () => {
    const book = inspectWorkbook(source()),
      selections = [{ sheet: "Data", range: "A1:D4" }];
    const payload = {
      filename: "test.xlsx",
      targetLang: "Russian",
      selections,
    };
    expect(buildJobPlan(book, payload).entries).toHaveLength(0);
    const id = "22222222-2222-4222-8222-222222222222";
    const next = buildJobPlan(book, {
      ...payload,
      additions: [{ id, planVersion: 2, selections, planHash: "unused" }],
    });
    expect(next.entries.length).toBeGreaterThan(0);
    expect(next.batchKeys).toEqual([`${id}:0`]);
  });
});
