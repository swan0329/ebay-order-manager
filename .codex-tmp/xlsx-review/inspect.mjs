import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "C:/Users/SUHAN/Desktop/다운로드/변동결과.xlsx";
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));

const sheets = await workbook.inspect({
  kind: "sheet",
  include: "id,name",
  maxChars: 4000,
});
console.log("SHEETS\n" + sheets.ndjson);

const overview = await workbook.inspect({
  kind: "workbook,sheet,table,region",
  maxChars: 20000,
  tableMaxRows: 30,
  tableMaxCols: 20,
  tableMaxCellChars: 500,
});
console.log("OVERVIEW\n" + overview.ndjson);

for (const sheet of workbook.worksheets.items) {
  const used = sheet.getUsedRange();
  const values = used.values;
  const headers = values[0] ?? [];
  const rows = values.slice(1);
  const countsFor = (header) => {
    const index = headers.indexOf(header);
    return Object.fromEntries(
      [...new Set(rows.map((row) => String(row[index] ?? "(빈값)")))]
        .map((value) => [value, rows.filter((row) => String(row[index] ?? "(빈값)") === value).length])
        .sort((left, right) => right[1] - left[1]),
    );
  };
  console.log("COUNTS " + JSON.stringify({
    total: rows.length,
    action: countsFor("*Action"),
    recommendation: countsFor("권장 조치"),
    sellable: countsFor("판매 가능"),
    image: countsFor("이미지 준비"),
    status: countsFor("Status"),
    errorCode: countsFor("ErrorCode"),
    warningCode: countsFor("WarningCode"),
  }, null, 2));
  const detail = await workbook.inspect({
    kind: "table",
    sheetId: sheet.name,
    range: used?.address ?? "A1:Z100",
    include: "values,formulas",
    maxChars: 30000,
    tableMaxRows: 100,
    tableMaxCols: 30,
    tableMaxCellChars: 2000,
  });
  console.log(`DETAIL ${sheet.name}\n${detail.ndjson}`);

  const render = await workbook.render({
    sheetName: sheet.name,
    autoCrop: "all",
    scale: 1,
    format: "png",
  });
  const safeName = sheet.name.replace(/[^a-z0-9가-힣_-]+/gi, "_");
  await fs.writeFile(`render-${safeName}.png`, new Uint8Array(await render.arrayBuffer()));
}
