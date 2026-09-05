#!/bin/sh
set -eu

DOMAIN="${1:-${DOMAIN:-}}"
if [ -z "$DOMAIN" ]; then
  echo "Usage: ./check-live.sh gamezone.example.com"
  exit 1
fi

BASE="https://$DOMAIN"
echo "Checking $BASE ..."

HEALTH="$(curl -fsS "$BASE/api/health")"
LIVE="$(curl -fsS "$BASE/api/health/live")"
READY="$(curl -fsS "$BASE/api/health/ready")"
CONFIG="$(curl -fsS "$BASE/api/config")"

printf '%s' "$HEALTH" | node -e '
let x="";process.stdin.on("data",d=>x+=d).on("end",()=>{
  const j=JSON.parse(x);
  if(j.ok!==true)process.exit(1);
  if(j.service!=="game-zone-api")process.exit(1);
});'

printf '%s' "$LIVE" | node -e '
let x="";process.stdin.on("data",d=>x+=d).on("end",()=>{if(JSON.parse(x).ok!==true)process.exit(1);});'
printf '%s' "$READY" | node -e '
let x="";process.stdin.on("data",d=>x+=d).on("end",()=>{if(JSON.parse(x).ok!==true)process.exit(1);});'

printf '%s' "$CONFIG" | node -e '
let x="";process.stdin.on("data",d=>x+=d).on("end",()=>{
  const j=JSON.parse(x);
  const raw=JSON.stringify(j);
  for(const forbidden of ["secretEnv","checkoutUrlTemplate","ADMIN_SESSION_SECRET","USER_SESSION_SECRET","PAYMENT_WEBHOOK_SECRET"]){
    if(raw.includes(forbidden)){console.error("Public config leaked forbidden field:",forbidden);process.exit(1);}
  }
  if(!j.privacyPolicyUrl||!j.termsUrl||!j.accountDeletionUrl)process.exit(1);
});'

curl -fsS "$BASE/privacy.html" >/dev/null
curl -fsS "$BASE/terms.html" >/dev/null
curl -fsS "$BASE/account-deletion.html" >/dev/null
curl -fsS "$BASE/admin/" >/dev/null

HEADERS="$(curl -fsSI "$BASE/")"
printf '%s' "$HEADERS" | grep -qi "content-security-policy:"
printf '%s' "$HEADERS" | grep -qi "x-content-type-options:"
printf '%s' "$HEADERS" | grep -qi "strict-transport-security:"

echo "Health / live / ready: OK"
echo "Public config leak check: OK"
echo "Privacy / Terms / Account deletion: OK"
echo "Admin page: reachable"
echo "Security headers: OK"
echo "Game Zone live check: PASS"
