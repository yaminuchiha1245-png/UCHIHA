const test=require("node:test");
const assert=require("node:assert/strict");
const {neutralizeSpreadsheetFormula,escapeCsvCell,toCsv}=require("../lib/csv");

test("CSV export neutralizes spreadsheet formula injection",()=>{
  for(const value of ["=HYPERLINK(\"https://evil\")","+SUM(1,2)","-10+5","@cmd","   =1+1"]){
    const safe=neutralizeSpreadsheetFormula(value);
    assert.ok(safe.startsWith("'"),`not neutralized: ${value}`);
  }
  assert.equal(neutralizeSpreadsheetFormula("normal text"),"normal text");
});

test("CSV export quotes cells and escapes quotes",()=>{
  assert.equal(escapeCsvCell('a"b'),'"a""b"');
  const csv=toCsv(["name"],[["=1+1"],["hello"]]);
  assert.match(csv,/"'=1\+1"/);
  assert.match(csv,/"hello"/);
});
