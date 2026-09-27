#!/usr/bin/env bash
# Isolated navigation candidate: never edits or restarts the production tree.
set -Eeuo pipefail
test -n "$HOST" && test -n "$USER" && test -n "$KEY_B64" && test -n "$KNOWN_HOSTS"
PORT="${PORT:-22}"
stage=/opt/uchiha/projects/bot-service-stage/integration-00-nav-v0551-20260927
root=/opt/uchiha/projects/bot-service-stage/uchiha-bot-service
install -d -m 700 ~/.ssh
printf '%s' "$KEY_B64" | base64 -d > ~/.ssh/bot_service_stage
printf '%s\n' "$KNOWN_HOSTS" > ~/.ssh/known_hosts
chmod 600 ~/.ssh/bot_service_stage ~/.ssh/known_hosts
ssh-keygen -y -f ~/.ssh/bot_service_stage >/dev/null
echo 'SSH=PINNED'
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -p "$PORT" -i ~/.ssh/bot_service_stage "$USER@$HOST" 'bash -s' <<'REMOTE'
set -Eeuo pipefail
umask 077
ROOT=/opt/uchiha/projects/bot-service-stage/uchiha-bot-service
STAGE=/opt/uchiha/projects/bot-service-stage/integration-00-nav-v0551-20260927
test -d "$ROOT" && test "$(cat "$ROOT/VERSION")" = '0.5.51'
test ! -e "$STAGE"
echo '01dcc64cd6b86a58374c63f490005acd1a6fd73f7839f963e9e45a65d6545ac3  '"$ROOT"'/apps/bot-engine/main.py' | sha256sum -c --status
echo '24038e3a37ae403a79ef34261c062520f4005eede41d34b14575bd0c3fa25c0a  '"$ROOT"'/apps/bot-engine/merchant_admin_panel.py' | sha256sum -c --status
mkdir -p "$STAGE/apps/bot-engine" "$STAGE/apps/admin-bot" "$STAGE/tests"
cp "$ROOT/VERSION" "$STAGE/VERSION"
cp "$ROOT"/apps/bot-engine/*.py "$STAGE/apps/bot-engine/"
cp "$ROOT"/apps/admin-bot/*.py "$STAGE/apps/admin-bot/"
cp "$ROOT/tests/smoke_merchant_panel_bot_v0540.py" "$STAGE/tests/"
chmod -R go-rwx "$STAGE"
echo 'STAGE_CREATED=YES; PRODUCTION_MODIFIED=NO'
REMOTE
base=ops/bot-service/coordinator
scp -o BatchMode=yes -o StrictHostKeyChecking=yes -P "$PORT" -i ~/.ssh/bot_service_stage "$base/panel_navigation.py" "$USER@$HOST:$stage/panel_navigation.py"
scp -o BatchMode=yes -o StrictHostKeyChecking=yes -P "$PORT" -i ~/.ssh/bot_service_stage "$base/stage_owner_panel.py" "$USER@$HOST:$stage/stage_owner_panel.py"
scp -o BatchMode=yes -o StrictHostKeyChecking=yes -P "$PORT" -i ~/.ssh/bot_service_stage "$base/test_owner_panel_navigation_00.py" "$USER@$HOST:$stage/tests/test_owner_panel_navigation_00.py"
echo 'STAGE_UPLOAD=YES'
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -p "$PORT" -i ~/.ssh/bot_service_stage "$USER@$HOST" 'bash -s' <<'REMOTE'
set -Eeuo pipefail
umask 077
stage=/opt/uchiha/projects/bot-service-stage/integration-00-nav-v0551-20260927
python3 "$stage/stage_owner_panel.py" --stage "$stage" --helper "$stage/panel_navigation.py"
python3 "$stage/tests/test_owner_panel_navigation_00.py"
image=$(docker inspect --format '{{.Image}}' uchiha_bot_service-bot-engine-1)
test -n "$image"
docker run --rm --network none --read-only --tmpfs /tmp --user 0:0 \
  -v "$stage/apps/bot-engine:/stage/apps/bot-engine:ro" \
  -v "$stage/apps/admin-bot:/stage/apps/admin-bot:ro" \
  -v "$stage/tests:/stage/tests:ro" -w /stage \
  -e PYTHONDONTWRITEBYTECODE=1 \
  -e PYTHONPATH=/stage/apps/bot-engine:/stage/apps/admin-bot \
  -e PLATFORM_OWNER_TELEGRAM_ID=1234567890 \
  -e UCHIHA_SHOWCASE_BOT_USERNAME=UchihaShowcase_Bot \
  --entrypoint python3 "$image" \
  /stage/tests/smoke_merchant_panel_bot_v0540.py
echo 'ISOLATED_NAV_QA=PASS'
echo 'PRODUCTION_DEPLOYED=NO'
REMOTE
