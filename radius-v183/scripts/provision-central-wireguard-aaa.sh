#!/usr/bin/env bash
set -Eeuo pipefail

api_unit=uchiha-radius-v183-staging.service
agent_unit=uchiha-radius-v183-agent.service
workdir="$(systemctl show "$api_unit" -p WorkingDirectory --value)"
agent_runtime=/opt/uchiha-radius/runtime/v183-agent
api_env="$(systemctl cat "$api_unit" | sed -n 's/^[[:space:]]*EnvironmentFile=-\{0,1\}//p' | tail -1 | tr -d '"')"
node=/opt/uchiha-radius/tools/node24/node_modules/node/bin/node
bot=/opt/uchiha-radius/release-candidates/v183-0c1ea716-20260927/telegram-bot-bundle
cfg=/etc/uchiha-radius-v183
state=/var/lib/uchiha-radius-v183-agent
secure=/opt/uchiha-radius/secure/wireguard-v183
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/opt/uchiha-radius/backups/v183-central-aaa-$stamp"

test -x "$node"
test -r "$agent_runtime/src/index.js"
test "$(systemctl is-active wg-quick@wg-v183)" = active
ip -4 addr show dev wg-v183 | grep -Fq '10.83.0.1/24'
install -d -m 0700 "$backup" "$cfg" "$secure"
install -d -m 0750 "$state"

for f in \
  "$cfg/agent.env" "$cfg/freeradius.env" "$cfg/nas.secret" \
  "/etc/systemd/system/$agent_unit" \
  /etc/freeradius/3.0/mods-available/uchiha_v183 \
  /etc/freeradius/3.0/sites-enabled/uchiha-v183 \
  /etc/freeradius/3.0/clients.d/uchiha-v183.conf \
  /etc/freeradius/3.0/clients.conf \
  /etc/systemd/system/freeradius.service.d/uchiha-v183.conf; do
  if test -e "$f" || test -L "$f"; then
    dst="$backup${f}"
    install -d -m 0700 "$(dirname "$dst")"
    cp -a "$f" "$dst"
  fi
done
cp -p "$api_env" "$backup/api.env"

rollback() {
  set +e
  systemctl stop freeradius
  systemctl stop "$agent_unit"
  cp -p "$backup/api.env" "$api_env" 2>/dev/null || true
  for f in \
    "/etc/systemd/system/$agent_unit" \
    /etc/freeradius/3.0/mods-available/uchiha_v183 \
    /etc/freeradius/3.0/sites-enabled/uchiha-v183 \
    /etc/freeradius/3.0/clients.d/uchiha-v183.conf \
    /etc/systemd/system/freeradius.service.d/uchiha-v183.conf; do
    b="$backup$f"
    if test -e "$b" || test -L "$b"; then
      install -d -m 0755 "$(dirname "$f")"
      cp -a "$b" "$f"
    else
      rm -f "$f"
    fi
  done
  if test -f "$backup/etc/freeradius/3.0/clients.conf"; then
    cp -a "$backup/etc/freeradius/3.0/clients.conf" /etc/freeradius/3.0/clients.conf
  fi
  systemctl daemon-reload
  systemctl restart "$api_unit" || true
  set -e
}
trap 'rc=$?; echo "CENTRAL_AAA_FAILED rc=$rc"; rollback; exit $rc' ERR

if ss -H -ltnp 'sport = :8795' | grep -q . && ! systemctl is-active --quiet "$agent_unit"; then
  echo "PORT_8795_CONFLICT"
  exit 31
fi

read_bot_env_py='
import pathlib,re,shlex,subprocess
env={}
unit=subprocess.check_output(["systemctl","cat","uchiha-radius-telegram-bot.service"],text=True)
for line in unit.splitlines():
    line=line.strip()
    if line.startswith("EnvironmentFile="):
        try:
            p=shlex.split(line.partition("=")[2].lstrip("-"))[0]
            for raw in pathlib.Path(p).read_text(encoding="utf-8").splitlines():
                if not raw or raw.startswith("#") or "=" not in raw: continue
                k,v=raw.split("=",1); env[k.strip()]=v.strip().strip(chr(34)).strip(chr(39))
        except Exception: pass
    elif line.startswith("Environment="):
        try:
            for item in shlex.split(line.partition("=")[2]):
                if "=" in item:
                    k,v=item.split("=",1); env[k]=v
        except ValueError: pass
'

if test ! -s "$cfg/agent.env"; then
  setup_json="$(python3 - "$bot" "$read_bot_env_py" <<'PY'
import sys,json
bot,bootstrap=sys.argv[1:]
exec(bootstrap)
sys.path.insert(0,bot)
from v183_bot import V183Api
api=V183Api(env["TELEGRAM_BOT_TOKEN"],int(env["UCHIHA_RADIUS_OWNER_TELEGRAM_ID"]))
api.login()
setup=api.request("/radius/agent-setup")
print(json.dumps({"credentialConfigured":bool(setup.get("credentialConfigured")),
                  "tenantSlug":setup.get("tenantSlug")}))
PY
)"
  configured="$(python3 -c 'import json,sys;print("yes" if json.loads(sys.argv[1])["credentialConfigured"] else "no")' "$setup_json")"
  tenant_slug="$(python3 -c 'import json,sys;print(json.loads(sys.argv[1])["tenantSlug"])' "$setup_json")"
  test "$tenant_slug" = "uchiha-radius-v183"
  if test "$configured" = yes; then
    echo "RADIUS_CREDENTIAL_EXISTS_WITHOUT_LOCAL_ENV"
    exit 32
  fi
  connector="$(python3 - "$bot" "$read_bot_env_py" <<'PY'
import sys
bot,bootstrap=sys.argv[1:]
exec(bootstrap)
sys.path.insert(0,bot)
from v183_bot import V183Api
api=V183Api(env["TELEGRAM_BOT_TOKEN"],int(env["UCHIHA_RADIUS_OWNER_TELEGRAM_ID"]))
api.login()
import uuid
out=api.request("/radius/credential",{
  "reason":"Provision central WireGuard AAA connector for first authorized real MikroTik",
  "confirmation":"ISSUE"
},"POST",key="v183-central-aaa-"+uuid.uuid4().hex)
secret=out.get("connectorSecret")
if not isinstance(secret,str) or len(secret)<32: raise SystemExit("connector secret missing")
print(secret,end="")
PY
)"
  local_secret="$(openssl rand -hex 32)"
  cache_key="$(openssl rand -hex 32)"
  nas_secret="$(openssl rand -hex 32)"
  umask 077
  cat > "$cfg/agent.env" <<EOF
RADIUS_AGENT_HOST=127.0.0.1
RADIUS_AGENT_PORT=8795
RADIUS_AGENT_DB=$state/spool.sqlite
RADIUS_AGENT_LOCAL_SECRET=$local_secret
RADIUS_AGENT_CACHE_KEY=$cache_key
UCHIHA_API_URL=https://radius.uchiha-builder.com
UCHIHA_TENANT_SLUG=uchiha-radius-v183
RADIUS_AGENT_SIGNING_SECRET=$connector
RADIUS_AGENT_ID=v183-central-wireguard
RADIUS_AGENT_NAME=UCHIHA-V183-Central-AAA
RADIUS_AGENT_ROLE=primary
RADIUS_AGENT_ENDPOINT=127.0.0.1:8795
RADIUS_COMMAND_ADAPTER=disabled
RADIUS_DIRECTORY_SYNC_MS=30000
RADIUS_HEARTBEAT_MS=15000
EOF
  printf 'RADIUS_AGENT_LOCAL_SECRET=%s\n' "$local_secret" > "$cfg/freeradius.env"
  printf '%s\n' "$nas_secret" > "$cfg/nas.secret"
  chmod 0600 "$cfg/agent.env" "$cfg/freeradius.env" "$cfg/nas.secret"
fi

if ! id -u uchiha-radius-agent-v183 >/dev/null 2>&1; then
  useradd --system --home "$state" --shell /usr/sbin/nologin uchiha-radius-agent-v183
fi
chown -R uchiha-radius-agent-v183:uchiha-radius-agent-v183 "$state"

cat > "/etc/systemd/system/$agent_unit" <<EOF
[Unit]
Description=UCHIHA RADIUS V1-83 central AAA agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=uchiha-radius-agent-v183
Group=uchiha-radius-agent-v183
WorkingDirectory=$agent_runtime
EnvironmentFile=$cfg/agent.env
ExecStart=$node src/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$state
CapabilityBoundingSet=
AmbientCapabilities=

[Install]
WantedBy=multi-user.target
EOF
chmod 0644 "/etc/systemd/system/$agent_unit"

local_secret="$(sed -n 's/^RADIUS_AGENT_LOCAL_SECRET=//p' "$cfg/agent.env")"
nas_secret="$(cat "$cfg/nas.secret")"

cat > /etc/freeradius/3.0/mods-available/uchiha_v183 <<'EOF'
rest uchiha_v183 {
  connect_uri = "http://127.0.0.1:8795"
  authorize {
    uri = "${..connect_uri}/authorize"
    method = "post"
    body = "json"
    data = '{"Packet-Id":"%{Packet-Id}","User-Name":"%{User-Name}","CHAP-Password":"%{CHAP-Password}","MS-CHAP-Response":"%{MS-CHAP-Response}","MS-CHAP2-Response":"%{MS-CHAP2-Response}","NAS-IP-Address":"%{NAS-IP-Address}","Calling-Station-Id":"%{Calling-Station-Id}"}'
    header = "X-Agent-Secret: %{env:RADIUS_AGENT_LOCAL_SECRET}"
  }
  accounting {
    uri = "${..connect_uri}/accounting"
    method = "post"
    body = "json"
    data = '{"Acct-Status-Type":"%{Acct-Status-Type}","Acct-Session-Id":"%{Acct-Session-Id}","Acct-Unique-Session-Id":"%{Acct-Unique-Session-Id}","User-Name":"%{User-Name}","NAS-IP-Address":"%{NAS-IP-Address}","Framed-IP-Address":"%{Framed-IP-Address}","Acct-Session-Time":"%{Acct-Session-Time}","Acct-Input-Octets":"%{Acct-Input-Octets}","Acct-Input-Gigawords":"%{Acct-Input-Gigawords}","Acct-Output-Octets":"%{Acct-Output-Octets}","Acct-Output-Gigawords":"%{Acct-Output-Gigawords}","Acct-Terminate-Cause":"%{Acct-Terminate-Cause}","Event-Timestamp":"%{Event-Timestamp}"}'
    header = "X-Agent-Secret: %{env:RADIUS_AGENT_LOCAL_SECRET}"
  }
  post-auth {
    uri = "${..connect_uri}/post-auth"
    method = "post"
    body = "json"
    data = '{"Packet-Id":"%{Packet-Id}","User-Name":"%{User-Name}","CHAP-Password":"%{CHAP-Password}","MS-CHAP-Response":"%{MS-CHAP-Response}","MS-CHAP2-Response":"%{MS-CHAP2-Response}","NAS-IP-Address":"%{NAS-IP-Address}","Calling-Station-Id":"%{Calling-Station-Id}","Response-Packet-Type":"%{reply:Packet-Type}","Module-Failure-Message":"%{Module-Failure-Message}"}'
    header = "X-Agent-Secret: %{env:RADIUS_AGENT_LOCAL_SECRET}"
  }
  timeout = 4.0
}
EOF
chmod 0644 /etc/freeradius/3.0/mods-available/uchiha_v183

cat > /etc/freeradius/3.0/sites-enabled/uchiha-v183 <<'EOF'
server uchiha-v183 {
  listen {
    type = auth
    ipaddr = 10.83.0.1
    port = 1812
  }
  listen {
    type = acct
    ipaddr = 10.83.0.1
    port = 1813
  }
  authorize {
    uchiha_v183
    chap
    mschap
    pap
  }
  authenticate {
    Auth-Type PAP {
      pap
    }
    Auth-Type CHAP {
      chap
    }
    Auth-Type MS-CHAP {
      mschap
    }
  }
  accounting {
    uchiha_v183
  }
  post-auth {
    uchiha_v183
    Post-Auth-Type REJECT {
      uchiha_v183
    }
  }
}
EOF
chmod 0644 /etc/freeradius/3.0/sites-enabled/uchiha-v183

install -d -m 0755 /etc/freeradius/3.0/clients.d
cat > /etc/freeradius/3.0/clients.d/uchiha-v183.conf <<EOF
client uchiha-v183-mikrotik {
  ipaddr = 10.83.0.2
  secret = $nas_secret
  shortname = uchiha-v183
}
EOF
chown root:freerad /etc/freeradius/3.0/clients.d/uchiha-v183.conf 2>/dev/null || true
chmod 0640 /etc/freeradius/3.0/clients.d/uchiha-v183.conf

include_line='$INCLUDE clients.d/uchiha-v183.conf'
if ! grep -Fxq "$include_line" /etc/freeradius/3.0/clients.conf; then
  printf '\n# UCHIHA RADIUS V1-83 WireGuard NAS\n%s\n' "$include_line" >> /etc/freeradius/3.0/clients.conf
fi

install -d -m 0755 /etc/systemd/system/freeradius.service.d
cat > /etc/systemd/system/freeradius.service.d/uchiha-v183.conf <<EOF
[Service]
EnvironmentFile=$cfg/freeradius.env
EOF
chmod 0644 /etc/systemd/system/freeradius.service.d/uchiha-v183.conf

systemctl daemon-reload
systemctl enable --now "$agent_unit"

for i in $(seq 1 30); do
  if curl -fsS --max-time 2 http://127.0.0.1:8795/ready >/tmp/v183-agent-ready.json 2>/dev/null; then break; fi
  sleep 1
done
test -s /tmp/v183-agent-ready.json
python3 - <<'PY'
import json
j=json.load(open("/tmp/v183-agent-ready.json"))
assert j.get("ready") is True,j
print("CENTRAL_AGENT_READY=yes")
print("CENTRAL_AGENT_CACHED_PRINCIPALS",j.get("cachedPrincipals"))
PY

RADIUS_AGENT_LOCAL_SECRET="$local_secret" freeradius -XC >/tmp/v183-fr-xc.log 2>&1
grep -qi 'configuration appears to be ok' /tmp/v183-fr-xc.log
systemctl enable --now freeradius
test "$(systemctl is-active freeradius)" = active
ss -H -lunp | grep -Eq '10\.83\.0\.1:1812[[:space:]]'
ss -H -lunp | grep -Eq '10\.83\.0\.1:1813[[:space:]]'

if grep -q '^RADIUS_UDP_READY=' "$api_env"; then
  sed -i 's/^RADIUS_UDP_READY=.*/RADIUS_UDP_READY=true/' "$api_env"
else
  printf '\nRADIUS_UDP_READY=true\n' >> "$api_env"
fi
systemctl restart "$api_unit"
for i in $(seq 1 30); do
  systemctl is-active --quiet "$api_unit" && break
  sleep 1
done
test "$(systemctl is-active "$api_unit")" = active

python3 - "$bot" "$read_bot_env_py" <<'PY'
import sys
bot,bootstrap=sys.argv[1:]
exec(bootstrap)
sys.path.insert(0,bot)
from v183_bot import V183Api
api=V183Api(env["TELEGRAM_BOT_TOKEN"],int(env["UCHIHA_RADIUS_OWNER_TELEGRAM_ID"]))
api.login()
caps=api.request("/devices/direct-capabilities")
assert caps.get("vpnEnabled") is True,caps
assert caps.get("radiusUdpReady") is True,caps
nodes=api.request("/radius/nodes")
print("API_RADIUS_UDP_READY yes")
print("API_RADIUS_NODE_COUNT",len(nodes.get("items",[])))
PY

cp -p "$cfg/nas.secret" "$secure/v183-nas.secret"
chmod 0600 "$secure/v183-nas.secret"
rm -f /tmp/v183-agent-ready.json /tmp/v183-fr-xc.log
trap - ERR
echo "CENTRAL_AAA_DEPLOY=PASS backup=$backup"
