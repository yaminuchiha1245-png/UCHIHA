from pathlib import Path
import re
APK='https://github.com/yaminuchiha1245-png/UCHIHA/releases/download/game-zone-client-v3.1.1/Game-Zone-Client-v3.1.1.apk'
bot=Path('bot/bot.js'); s=bot.read_text(encoding='utf-8')
s=re.sub(r'https://github\.com/yaminuchiha1245-png/UCHIHA/releases/download/game-zone-client-v3\.1\.0/Game-Zone-Client-v3\.1\.0\.apk',APK,s)
if APK not in s: raise SystemExit('v3.1.1 bot URL missing')
bot.write_text(s,encoding='utf-8')
compose=Path('deploy/docker-compose.yml'); c=compose.read_text(encoding='utf-8')
c=re.sub(r'^\s*ANDROID_APK_URL:.*$', '      ANDROID_APK_URL: '+APK, c, flags=re.M)
if APK not in c: raise SystemExit('v3.1.1 compose URL missing')
compose.write_text(c,encoding='utf-8')
print('GAME_ZONE_CLIENT_V311_RUNTIME_FINALIZED=YES')
