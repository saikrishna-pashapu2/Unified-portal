import { zipSync, strToU8 } from "fflate";
export function incrementalInput() {
  const data: Record<string, string> = {
    "[Content_Types].xml":
      '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    "xl/workbook.xml":
      '<workbook xmlns:r="urn:r"><sheets><sheet name="Data" r:id="r1"/><sheet name="Other" r:id="r2"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml":
      '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Quyosh panellari</t></is></c><c r="B1"><f>1+1</f><v>2</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Quyosh panellari</t></is></c></row></sheetData></worksheet>',
    "xl/worksheets/sheet2.xml":
      '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Quyosh stansiyasi</t></is></c></row></sheetData></worksheet>',
  };
  return Buffer.from(
    zipSync(
      Object.fromEntries(Object.entries(data).map(([k, v]) => [k, strToU8(v)])),
    ),
  );
}
