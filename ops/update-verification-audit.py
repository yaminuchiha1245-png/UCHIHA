from pathlib import Path

p=Path('server/scripts/web-security-audit.js')
s=p.read_text()
old='if(!mini.includes(\'[KYC]\'))failures.push("KYC request flow missing");\nif(/document(Number|No)|passport(Number|No)/i.test(mini))failures.push("KYC flow must not collect full document numbers in this release");'
new='''if(!mini.includes("/api/verification"))failures.push("dedicated verification API missing from Mini App");
if(!server.includes('app.get("/api/verification"')||!server.includes('app.post("/api/verification"'))failures.push("customer verification routes missing");
if(!server.includes('app.get("/api/admin/verifications"')||!server.includes('app.patch("/api/admin/verifications/:id"'))failures.push("admin verification routes missing");
if(/gz21Kyc(?:Name|Country|Dob|Doc)/.test(mini))failures.push("legacy identity-data KYC form still present");
if(/document(Number|No)|passport(Number|No)/i.test(mini))failures.push("verification flow must not collect full document numbers");'''
if old not in s:
    raise SystemExit('legacy KYC audit anchor not found')
p.write_text(s.replace(old,new,1))
print('Verification web-security audit updated')
