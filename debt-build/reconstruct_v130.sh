#!/usr/bin/env bash
set -euo pipefail
rm -rf debt-app /tmp/debt-source.zip
python3 - <<'PY'
from pathlib import Path
import base64,hashlib,re
parts=sorted(Path('debt-build').glob('source.part*'))
data=base64.b64decode(re.sub(r'[^A-Za-z0-9+/=]','',''.join(p.read_text() for p in parts)),validate=False)
if hashlib.sha256(data).hexdigest()!='f9b1921583b0b9fc9cb50c0b9ac74e7efd17cc5410dc0c93a58800ff1d3396ca': raise SystemExit('base source hash mismatch')
Path('/tmp/debt-source.zip').write_bytes(data)
PY
mkdir -p debt-app
unzip -q /tmp/debt-source.zip -d debt-app
sed -i 's/import android\.app\.biometric\.BiometricPrompt;/import android.hardware.biometrics.BiometricPrompt;/' debt-app/app/src/main/java/com/uchiha/debtstore/MainActivity.java
python3 debt-build/patch_v101.py debt-app
python3 debt-build/patch_v102.py debt-app
python3 debt-build/patch_v103.py debt-app
python3 - <<'PY'
from pathlib import Path
import base64,hashlib,io,tarfile,re
parts=sorted(Path('debt-build').glob('v110payload.part*'))
data=base64.b64decode(re.sub(r'[^A-Za-z0-9+/=]','',''.join(p.read_text() for p in parts)),validate=True)
if len(parts)!=5 or hashlib.sha256(data).hexdigest()!='cb2605e2766f0f4dfa3a53ff7a6dfd4d0637d7c39906705187427bbae39dd55b': raise SystemExit('v110 payload mismatch')
with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as tf: tf.extractall('debt-app')
PY
python3 debt-build/patch_v111.py debt-app
python3 - <<'PY'
from pathlib import Path
import base64,hashlib,io,tarfile,re
def apply(prefix,count,expected):
    parts=sorted(Path('debt-build').glob(prefix+'*'))
    data=base64.b64decode(re.sub(r'[^A-Za-z0-9+/=]','',''.join(p.read_text() for p in parts)),validate=True)
    if len(parts)!=count or hashlib.sha256(data).hexdigest()!=expected: raise SystemExit(prefix+' mismatch')
    with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as tf: tf.extractall('debt-app')
apply('v112payload.part',4,'66dc5cabeadc1fb4b58f10f10861c4d67c482966e6e667e0be81ced0dde68da3')
apply('v120payload.part',5,'81909bbeafee7ce5e71de20e07834743bde286c190f2275e0b827c5561f82fc9')
PY
python3 debt-build/patch_v121.py debt-app
python3 debt-build/patch_v122.py debt-app
python3 debt-build/patch_v122_cleanup.py debt-app
python3 debt-build/patch_v123.py debt-app
python3 debt-build/patch_v124.py debt-app
python3 debt-build/patch_v125.py debt-app
python3 debt-build/patch_v126.py debt-app
python3 debt-build/patch_v127.py debt-app
python3 debt-build/patch_v128_compat.py debt-app
python3 debt-build/patch_v130.py debt-app
(cd debt-app && patch -p0 < ../debt-build/v130_main.patch)
