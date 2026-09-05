function neutralizeSpreadsheetFormula(value){
  const text=String(value??"");
  const trimmed=text.replace(/^[\u0000-\u0020]+/,"");
  if(/^[=+\-@]/.test(trimmed))return "'"+text;
  return text;
}

function escapeCsvCell(value){
  const safe=neutralizeSpreadsheetFormula(value);
  return `"${safe.replace(/"/g,'""')}"`;
}

function toCsv(headers,rows){
  return [
    headers.map(escapeCsvCell).join(","),
    ...rows.map(row=>row.map(escapeCsvCell).join(","))
  ].join("\n");
}

module.exports={neutralizeSpreadsheetFormula,escapeCsvCell,toCsv};
