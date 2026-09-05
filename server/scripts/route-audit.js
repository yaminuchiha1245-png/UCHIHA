const fs = require("fs");
const path = require("path");

const file = path.join(__dirname,"..","server.js");
const text = fs.readFileSync(file,"utf8");
const re = /app\.(get|post|patch|put|delete)\("([^"]+)"/g;
const seen = new Map();
let m;
while ((m=re.exec(text))) {
  const key=`${m[1].toUpperCase()} ${m[2]}`;
  const line=text.slice(0,m.index).split("\n").length;
  if(!seen.has(key))seen.set(key,[]);
  seen.get(key).push(line);
}
const duplicates=[...seen.entries()].filter(([,lines])=>lines.length>1);
if(duplicates.length){
  console.error("Duplicate API routes detected:");
  for(const [route,lines] of duplicates)console.error("-",route,"lines",lines.join(","));
  process.exit(1);
}
console.log(`Route audit OK: ${seen.size} unique routes`);
