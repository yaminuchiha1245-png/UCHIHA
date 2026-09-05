from pathlib import Path

p = Path('.github/workflows/game-zone-production-deploy.yml')
s = p.read_text(encoding='utf-8')
old = '''          curl -fsSI --max-time 15 "https://$DOMAIN/" >/dev/null
          curl -fsSI --max-time 15 "https://$DOMAIN/admin/" >/dev/null
          curl -fsS --max-time 15 "https://$DOMAIN/v21.js?v=210" | grep -F 'Game Zone v2.1 production UX layer' >/dev/null
          curl -fsS --max-time 15 "https://$DOMAIN/v21.css?v=210" | grep -F 'gz21-balance-chip' >/dev/null
'''
new = '''          retry_head() {
            url="$1"
            for i in $(seq 1 6); do
              if curl -fsSI --max-time 12 "$url" >/dev/null 2>&1; then return 0; fi
              sleep 4
            done
            return 1
          }
          retry_marker() {
            url="$1"
            marker="$2"
            for i in $(seq 1 6); do
              if curl -fsS --max-time 12 "$url" 2>/dev/null | grep -F "$marker" >/dev/null; then return 0; fi
              sleep 4
            done
            return 1
          }
          retry_head "https://$DOMAIN/"
          retry_head "https://$DOMAIN/admin/"
          retry_marker "https://$DOMAIN/v21.js?v=210" 'Game Zone v2.1 production UX layer'
          retry_marker "https://$DOMAIN/v21.css?v=210" 'gz21-balance-chip'
'''
if old not in s:
    if 'retry_head() {' in s and 'retry_marker() {' in s:
        print('HTTPS_RETRY_PATCH=ALREADY_APPLIED')
        raise SystemExit(0)
    raise SystemExit('expected HTTPS verification block not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
print('HTTPS_RETRY_PATCH=APPLIED')
