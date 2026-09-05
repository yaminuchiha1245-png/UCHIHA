from pathlib import Path
import re
p=Path('admin/admin.js')
s=p.read_text()
expected='  topups:[{id:"topup_preview_1",telegramId:"8120730186",amount:20,status:"pending",method:"manual",receiptUploaded:true,receiptUploadedAt:new Date().toISOString(),createdAt:new Date().toISOString()}],'
pattern=r'^\s*topups:\[\{id:"topup_preview_1"[^\n]*\}\],\s*$'
s2,n=re.subn(pattern,expected,s,count=1,flags=re.M)
if n!=1:
    raise SystemExit('could not normalize admin preview topup row')
p.write_text(s2)
print('Admin preview topup row normalized')
