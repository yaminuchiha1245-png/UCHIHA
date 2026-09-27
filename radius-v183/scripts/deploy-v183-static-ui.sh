#!/usr/bin/env bash
# Guarded static-only rollout for the EXISTING V1-83 Nginx alias.
# Does not touch APIs, PostgreSQL, Telegram bot, RouterOS, Nginx or other sites.
set -Eeuo pipefail
umask 077

usage() {
  echo "Usage: $0 check BUILD_DIR | apply BUILD_DIR EXPECTED_LIVE_HTML_SHA256" >&2
  exit 2
}
mode="$1"
source_dir="$2"
[[ "$mode" == check || "$mode" == apply ]] || usage
[[ -d "$source_dir/assets" && -s "$source_dir/index.html" && -s "$source_dir/index.html.gz" ]] || {
  echo "Missing fast-v183 static release" >&2; exit 1;
}
source_dir="$(realpath "$source_dir")"
[[ ! -L "$source_dir" ]] || { echo "Symlinked build root refused" >&2; exit 1; }
cmp -s <(gzip -cd "$source_dir/index.html.gz") "$source_dir/index.html" || {
  echo "Release HTML and precompressed HTML differ" >&2; exit 1;
}
grep -Fq '/v183/assets/runtime-' "$source_dir/index.html"
grep -Fq 'https://telegram.org/js/telegram-web-app.js' "$source_dir/index.html"
css="$(find "$source_dir/assets" -maxdepth 1 -type f -name 'style-4-*.css' -print -quit)"
js="$(find "$source_dir/assets" -maxdepth 1 -type f -name 'runtime-*.js' -print -quit)"
[[ -n "$css" && -n "$js" ]] || { echo "V1-83 compact CSS/runtime missing" >&2; exit 1; }
grep -Fq '#workspace-dialog:has(#v183-direct-connect-form)' "$css" || {
  echo "The approved MikroTik sheet hotfix is absent" >&2; exit 1;
}
grep -Fq 'v183-direct-confirm' "$css"
grep -Fq 'installV183DirectConnect' "$js"
while IFS= read -r -d '' item; do
  [[ ! -L "$item" ]] || { echo "Symlink in release refused" >&2; exit 1; }
done < <(find "$source_dir" -mindepth 1 -print0)
echo "PASS: verified V1-83 static-only hotfix build"
[[ "$mode" == check ]] && exit 0

[[ "$#" -eq 3 && "$3" =~ ^[a-f0-9]{64}$ ]] || usage
[[ "$(id -u)" -eq 0 ]] || { echo "Apply requires an authorized root executor" >&2; exit 1; }
live="/opt/uchiha-radius/v183-stage"
backups="/opt/uchiha-radius/backups"
[[ -d "$live/assets" && -f "$live/index.html" && -f "$live/index.html.gz" && -d "$backups" ]] || {
  echo "Known V1-83 live stage and backups are not present" >&2; exit 1;
}
[[ "$(realpath "$live")" == "$live" && "$(realpath "$backups")" == "$backups" ]] || {
  echo "Unexpected deployment symlink, refusing" >&2; exit 1;
}
command -v flock >/dev/null
exec 9>"$backups/.v183-ui-rollout.lock"
flock -n 9 || { echo "Another V1-83 UI deployment is in progress" >&2; exit 1; }
actual="$(sha256sum "$live/index.html" | cut -d' ' -f1)"
[[ "$actual" == "$3" ]] || {
  echo "Live HTML changed: expected $3, found $actual. Inspect the live release first." >&2; exit 1;
}
[[ ! -L "$live/assets" ]] || {
  echo "Unexpected asset directory symlink; refusing" >&2; exit 1;
}
# A successful independent HTTPS probe may show that another release owner
# already published the identical MikroTik fix. Never overwrite a newer live
# runtime with an older production-source bundle merely to close a ticket.
active_css="$(grep -oE '/v183/assets/style-4-[a-f0-9]{16}\.css' "$live/index.html" | head -n 1 || true)"
active_js="$(grep -oE '/v183/assets/runtime-[a-f0-9]{16}\.js' "$live/index.html" | head -n 1 || true)"
if [[ -n "$active_css" && -n "$active_js" &&
      -f "$live/assets/${active_css##*/}" && -f "$live/assets/${active_js##*/}" ]] &&
   grep -Fq '#workspace-dialog:has(#v183-direct-connect-form)' "$live/assets/${active_css##*/}" &&
   grep -Fq 'name="owned" required><span>' "$live/assets/${active_js##*/}"; then
  echo "LIVE_PATCH_ALREADY_PRESENT: refusing to overwrite the current repaired V1-83 frontend" >&2
  exit 4
fi
backup_dir="$(mktemp -d "$backups/v183-static-before-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")"
tar -czf "$backup_dir/stage-before.tar.gz" -C "$live" .
tar -tzf "$backup_dir/stage-before.tar.gz" >/dev/null
printf '%s\n' "$actual" > "$backup_dir/previous-index-sha256"
sha256sum "$source_dir/index.html" > "$backup_dir/next-index-sha256"
echo "Backup created: $backup_dir/stage-before.tar.gz"
modified=0
rollback() {
  local failed=$?
  trap - ERR HUP INT TERM
  if [[ "$modified" -eq 1 ]]; then
    echo "Smoke check failed; restoring previous HTML and gzip atomically" >&2
    tar -xOzf "$backup_dir/stage-before.tar.gz" ./index.html > "$live/.index.rollback.tmp"
    tar -xOzf "$backup_dir/stage-before.tar.gz" ./index.html.gz > "$live/.index.rollback.gz.tmp"
    chmod 644 "$live/.index.rollback.tmp" "$live/.index.rollback.gz.tmp"
    mv -f "$live/.index.rollback.gz.tmp" "$live/index.html.gz"
    mv -f "$live/.index.rollback.tmp" "$live/index.html"
  fi
  exit "$failed"
}
trap rollback ERR HUP INT TERM
while IFS= read -r -d '' asset; do
  name="$(basename "$asset")"
  if [[ -e "$live/assets/$name" ]]; then
    cmp -s "$asset" "$live/assets/$name" || {
      echo "Immutable asset collision: $name" >&2; exit 1;
    }
  else
    install -m 644 "$asset" "$live/assets/$name"
  fi
done < <(find "$source_dir/assets" -maxdepth 1 -type f -print0)
modified=1
install -m 644 "$source_dir/index.html.gz" "$live/.index.next.gz"
install -m 644 "$source_dir/index.html" "$live/.index.next"
mv -f "$live/.index.next.gz" "$live/index.html.gz"
mv -f "$live/.index.next" "$live/index.html"
cmp -s "$source_dir/index.html" "$live/index.html"
cmp -s "$source_dir/index.html.gz" "$live/index.html.gz"
expected="$(sha256sum "$source_dir/index.html" | cut -d' ' -f1)"
# Cache-busting query prevents a stale proxy/WebView page from passing the proof.
curl -fsSL --retry 2 --retry-delay 2 --max-time 25 --compressed \
  -H 'Cache-Control: no-cache' \
  "https://radius.uchiha-builder.com/v183/?v183-ui=$expected" \
  | sha256sum | cut -d' ' -f1 | grep -Fxq "$expected"
echo "PASS: live HTTPS HTML matches reviewed static release ($expected)"
echo "Rollback backup: $backup_dir/stage-before.tar.gz"
trap - ERR HUP INT TERM
