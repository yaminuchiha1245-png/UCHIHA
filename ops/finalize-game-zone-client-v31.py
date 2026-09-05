from pathlib import Path

APK='https://github.com/yaminuchiha1245-png/UCHIHA/releases/download/game-zone-client-v3.1.0/Game-Zone-Client-v3.1.0.apk'

bot=Path('bot/bot.js')
s=bot.read_text(encoding='utf-8')
s=s.replace('https://github.com/yaminuchiha1245-png/UCHIHA/releases/download/game-zone-client-v3.0.0/Game-Zone-Client-v3.0.0.apk',APK)
if APK not in s: raise SystemExit('bot APK v3.1 URL missing')
bot.write_text(s,encoding='utf-8')

compose=Path('deploy/docker-compose.yml')
c=compose.read_text(encoding='utf-8')
old='      MINI_APP_URL: https://${DOMAIN}\n'
new='      MINI_APP_URL: https://${DOMAIN}\n      ANDROID_APK_URL: '+APK+'\n'
if 'ANDROID_APK_URL:' in c:
    import re
    c=re.sub(r'^\s*ANDROID_APK_URL:.*$', '      ANDROID_APK_URL: '+APK, c, flags=re.M)
elif old in c:
    c=c.replace(old,new,1)
else:
    raise SystemExit('bot compose environment anchor missing')
compose.write_text(c,encoding='utf-8')
print('GAME_ZONE_CLIENT_V31_RUNTIME_FINALIZED=YES')
