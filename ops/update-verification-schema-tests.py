from pathlib import Path

p=Path('server/tests/migrations.test.js')
s=p.read_text()
old='assert.equal(result.to,8);'
if s.count(old)<2:
    raise SystemExit('expected migration v8 assertions not found')
s=s.replace(old,'assert.equal(result.to,9);',2)
p.write_text(s)

p=Path('server/tests/backupRestore.integration.test.js')
s=p.read_text()
if '/Schema migration: .*0.* -> .*8/' not in s or 'assert.equal(restored.schemaVersion,8);' not in s:
    raise SystemExit('backup restore v8 expectations not found')
s=s.replace('/Schema migration: .*0.* -> .*8/','/Schema migration: .*0.* -> .*9/',1)
s=s.replace('assert.equal(restored.schemaVersion,8);','assert.equal(restored.schemaVersion,9);',1)
p.write_text(s)

print('Schema v9 verification test expectations updated')
