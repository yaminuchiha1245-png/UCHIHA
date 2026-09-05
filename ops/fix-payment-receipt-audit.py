from pathlib import Path

p=Path('server/scripts/web-security-audit.js')
s=p.read_text()
old='''const server=fs.readFileSync(path.join(root,"server/server.js"),"utf8");\n'''
new='''const server=fs.readFileSync(path.join(root,"server/server.js"),"utf8");\nconst adminTopupPolicy=fs.readFileSync(path.join(root,"server/lib/adminTopupPolicy.js"),"utf8");\n'''
if old not in s:
    raise SystemExit('missing server audit source anchor')
s=s.replace(old,new,1)
old='''if(!server.includes("topupApprovalEvidenceError")||!server.includes("topup_receipt_required"))failures.push("required topup receipt backend policy missing");'''
new='''if(!server.includes("topupApprovalEvidenceError")||!adminTopupPolicy.includes("topup_receipt_required"))failures.push("required topup receipt backend policy missing");'''
if old not in s:
    raise SystemExit('missing receipt audit check anchor')
s=s.replace(old,new,1)
p.write_text(s)
print('Payment receipt audit now validates the dedicated backend policy file')
