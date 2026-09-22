#!/usr/bin/env bash
# Private, interactive onboarding for a dedicated UCHIHA RADIUS bot.
set -euo pipefail
umask 077
TOKEN_FILE="/etc/uchiha-radius/telegram-bot.token"
ACTIVATE="/opt/uchiha-radius/telegram-app/activate-telegram-bot.sh"
[[ "${EUID}" -eq 0 ]] || { echo "Run this script as root." >&2; exit 2; }
[[ -t 0 ]] || { echo "Open an interactive SSH terminal to enter the token privately." >&2; exit 2; }
[[ -x "${ACTIVATE}" ]] || { echo "Telegram activation helper is missing." >&2; exit 3; }
install -d -m 0750 /etc/uchiha-radius
echo "UCHIHA RADIUS | Dedicated Telegram bot"
TOKEN_CREATED=0
if [[ -s "${TOKEN_FILE}" ]]; then
  # A canceled onboarding attempt must be resumable without exposing the token.
  chmod 0600 "${TOKEN_FILE}"
  echo "Found a previously entered bot token. Validating it with Telegram."
  echo "You do not need to paste the token again."
else
  echo "Create a bot using @BotFather /newbot, then paste its token here."
  echo "The token will not be echoed or put in command-line arguments."
  read -r -s -p "BotFather token (hidden): " bot_token
  printf '\n'
  if [[ ! "${bot_token}" =~ ^[0-9]+:[A-Za-z0-9_-]{20,}$ ]]; then
    echo "Invalid token format. Use the token received from BotFather." >&2
    exit 3
  fi
  printf '%s\n' "${bot_token}" >"${TOKEN_FILE}"
  unset bot_token
  chmod 0600 "${TOKEN_FILE}"
  TOKEN_CREATED=1
fi

# Verify this is a real, unused dedicated bot; do not take over other webhooks.
if ! bot_username="$(python3 - "${TOKEN_FILE}" <<'PY'
import json, sys, urllib.error, urllib.request
token = open(sys.argv[1], encoding="utf-8").read().strip()
base = "https://api.telegram.org/bot" + token + "/"
def api(method):
    with urllib.request.urlopen(base + method, timeout=12) as response:
        return json.load(response)
try:
    me = api("getMe")
    hook = api("getWebhookInfo")
except Exception as exc:
    raise SystemExit("Telegram validation failed (" + type(exc).__name__ + ").")
if me.get("ok") is not True or not me.get("result", {}).get("is_bot"):
    raise SystemExit("The Telegram token was not accepted.")
if hook.get("ok") is not True or hook.get("result", {}).get("url"):
    raise SystemExit("The bot has an active webhook. Use a dedicated RADIUS bot.")
username = str(me["result"].get("username") or "")
if not username or not username.replace("_", "").isalnum():
    raise SystemExit("Telegram returned an invalid bot username.")
print(username)
PY
)"; then
    echo "No bot settings were changed. Check the token or create a dedicated bot." >&2
    if [[ "${TOKEN_CREATED}" -eq 1 ]]; then
      rm -f "${TOKEN_FILE}"
    fi
    exit 4
fi
echo "Verified: @${bot_username}"
echo "Use a dedicated RADIUS bot only. Do not re-use any existing store bot."
echo "IMPORTANT: Type only the word RADIUS below; do not paste a shell command."
read -r -p "Type RADIUS to confirm that this is a dedicated bot: " confirmation
if [[ "${confirmation}" != "RADIUS" ]]; then
  echo "Activation canceled. Existing bots have not been changed." >&2
  echo "The verified bot token remains securely saved. Rerun this wizard and enter exactly RADIUS." >&2
  exit 4
fi

read -r -p "Your numeric Telegram user ID (Enter for secure pairing): " owner_id
if [[ -z "${owner_id}" ]]; then
  OWNER_FILE="$(mktemp /etc/uchiha-radius/.bot-owner.XXXXXX)"
  chmod 0600 "${OWNER_FILE}"
  if ! python3 - "${TOKEN_FILE}" "${OWNER_FILE}" "${bot_username}" <<'PY'
import json, secrets, sys, time, urllib.error, urllib.request
from pathlib import Path
token = Path(sys.argv[1]).read_text(encoding="utf-8").strip()
owner_file = Path(sys.argv[2])
username = sys.argv[3]
challenge = secrets.token_urlsafe(16)
print("Open this private pairing link and press Start:", flush=True)
print(f"https://t.me/{username}?start={challenge}", flush=True)
print("Only the account sending this one-time code will become the owner.", flush=True)
base = "https://api.telegram.org/bot" + token + "/"
offset = 0
deadline = time.monotonic() + 600
while time.monotonic() < deadline:
    timeout = max(1, min(20, int(deadline - time.monotonic())))
    payload = json.dumps({"offset": offset, "timeout": timeout,
                          "allowed_updates": ["message"]}).encode()
    request = urllib.request.Request(base + "getUpdates", data=payload,
                                     headers={"Content-Type": "application/json"})

    try:
        with urllib.request.urlopen(request, timeout=timeout + 6) as response:
            data = json.load(response)
    except urllib.error.HTTPError as exc:
        if exc.code == 409:
            raise SystemExit("Another process is polling this bot. Use a dedicated bot.")
        raise SystemExit("Telegram pairing request was rejected.")
    except (urllib.error.URLError, TimeoutError):
        continue
    if data.get("ok") is not True:
        continue
    for update in data.get("result", []):
        offset = max(offset, int(update["update_id"]) + 1)
        message = update.get("message") or {}
        user = message.get("from") or {}
        chat = message.get("chat") or {}
        if (message.get("text") == "/start " + challenge
                and chat.get("type") == "private"
                and int(chat.get("id") or 0) == int(user.get("id") or 0)
                and int(user.get("id") or 0) > 0):
            owner_file.write_text(str(user["id"]) + "\n", encoding="utf-8")
            print("Owner pairing verified.", flush=True)
            sys.exit(0)
raise SystemExit("Pairing did not complete within 10 minutes. Re-run the wizard when ready.")
PY
  then
    rm -f "${OWNER_FILE}"
    exit 5
  fi
  owner_id="$(tr -d '\r\n' <"${OWNER_FILE}")"
  rm -f "${OWNER_FILE}"
fi

if [[ ! "${owner_id}" =~ ^[0-9]+$ || "${owner_id}" -le 0 ]]; then
  echo "Invalid Telegram owner ID." >&2
  exit 6
fi
bash "${ACTIVATE}" --token-file "${TOKEN_FILE}" --owner-id "${owner_id}"
echo
echo "RADIUS Telegram bot is now linked: https://t.me/${bot_username}"
echo "Open the bot and send /start to see the administration buttons."
# The bot enables its Mini App menu automatically after valid public HTTPS.
if ! curl -fsS --max-time 5 "https://radius.uchiha-builder.com/healthz" \
     | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("service")=="uchiha-radius-edge" and d.get("tlsReady") else 1)' 2>/dev/null; then
  echo "Mini App waiting for radius DNS and a valid HTTPS certificate."
  echo "Set the radius A record to 155.254.35.187; then enable TLS."
fi
echo "Bot token stored only in a root-protected file and provider configuration."
