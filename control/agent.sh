#!/usr/bin/env bash
set -Eeuo pipefail

REPO_SLUG="yaminuchiha1245-png/UCHIHA"
CONTROL_BRANCH="server-control"
CONTROL_BASE="https://raw.githubusercontent.com/${REPO_SLUG}/${CONTROL_BRANCH}/control"
STATE_DIR="/var/lib/uchiha-control"
LOCK_FILE="/run/uchiha-control.lock"
MANIFEST_TMP="/tmp/uchiha-control-manifest.json"

mkdir -p "$STATE_DIR" /opt/uchiha/projects /etc/uchiha/secrets
chmod 700 /etc/uchiha/secrets
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

log(){ printf '%s [uchiha-control] %s\n' "$(date -Is)" "$*"; }

curl -fsSL --retry 3 --connect-timeout 10 "${CONTROL_BASE}/manifest.json" -o "$MANIFEST_TMP"
jq -e '.version == 1 and (.projects|type=="object")' "$MANIFEST_TMP" >/dev/null

compose_cmd(){
  if docker compose version >/dev/null 2>&1; then echo "docker compose";
  elif command -v docker-compose >/dev/null 2>&1; then echo "docker-compose";
  else return 1; fi
}

remote_sha(){
  local repo="$1" branch="$2"
  curl -fsSL --retry 3 --connect-timeout 10 "https://api.github.com/repos/${repo}/branches/${branch}" | jq -r '.commit.sha // empty'
}

compose_apply(){
  local target="$1" compose_file="$2" env_file="$3" action="$4"
  local compose_dir compose_bin
  [ -n "$compose_file" ] || return 0
  [ -f "$target/$compose_file" ] || { log "compose file missing: $target/$compose_file"; return 1; }
  compose_bin="$(compose_cmd)" || { log "Docker Compose is not installed"; return 1; }
  compose_dir="$(dirname "$target/$compose_file")"
  if [ -n "$env_file" ]; then
    [ -f "$env_file" ] || { log "secrets file missing: $env_file"; return 2; }
    chmod 600 "$env_file"
    ln -sfn "$env_file" "$compose_dir/.env.production"
  fi
  cd "$compose_dir"
  case "$action" in
    up)
      if [ -n "$env_file" ]; then
        $compose_bin --env-file .env.production -f "$(basename "$compose_file")" up -d --build --remove-orphans
      else
        $compose_bin -f "$(basename "$compose_file")" up -d --build --remove-orphans
      fi
      ;;
    stop)
      $compose_bin -f "$(basename "$compose_file")" stop
      ;;
    restart)
      if [ -n "$env_file" ]; then
        $compose_bin --env-file .env.production -f "$(basename "$compose_file")" up -d --build --force-recreate --remove-orphans
      else
        $compose_bin -f "$(basename "$compose_file")" up -d --build --force-recreate --remove-orphans
      fi
      ;;
  esac
}

deploy_branch_project(){
  local name="$1" repo="$2" branch="$3" subdir="$4" target="$5" compose_file="$6" env_file="$7" desired="$8" restart_token="$9"
  local new old old_restart tmp archive src project_src changed=0

  new="$(remote_sha "$repo" "$branch")"
  [ -n "$new" ] || { log "$name: cannot resolve $repo@$branch"; return 1; }
  old="$(cat "$STATE_DIR/$name.sha" 2>/dev/null || true)"
  old_restart="$(cat "$STATE_DIR/$name.restart" 2>/dev/null || true)"

  if [ "$old" != "$new" ] || [ ! -d "$target" ]; then
    changed=1
    tmp="$(mktemp -d)"; archive="$tmp/source.tar.gz"; src="$tmp/source"
    mkdir -p "$src" "$target"
    log "$name: downloading $repo@$branch ($new)"
    curl -fL --retry 3 --connect-timeout 15 "https://api.github.com/repos/${repo}/tarball/${branch}" -o "$archive"
    tar -xzf "$archive" -C "$src" --strip-components=1
    if [ -n "$subdir" ] && [ "$subdir" != "." ]; then project_src="$src/$subdir"; else project_src="$src"; fi
    [ -d "$project_src" ] || { log "$name: source directory not found: $subdir"; rm -rf "$tmp"; return 1; }
    rsync -a --delete \
      --exclude='.git/' --exclude='.env' --exclude='.env.production' --exclude='node_modules/' \
      --exclude='uploads/' --exclude='receipts/' --exclude='backups/' --exclude='storage/' --exclude='data/' \
      "$project_src/" "$target/"
    printf '%s\n' "$new" > "$STATE_DIR/$name.sha"
    rm -rf "$tmp"
  fi

  case "$desired" in
    stopped)
      if [ -f "$target/$compose_file" ]; then compose_apply "$target" "$compose_file" "$env_file" stop || true; fi
      log "$name: desired state stopped"
      ;;
    running|*)
      if [ "$changed" = 1 ]; then
        log "$name: applying updated runtime"
        compose_apply "$target" "$compose_file" "$env_file" up || true
      elif [ "$old_restart" != "$restart_token" ]; then
        log "$name: restart token changed; recreating runtime"
        compose_apply "$target" "$compose_file" "$env_file" restart || true
      else
        log "$name: already current ($new)"
      fi
      ;;
  esac

  printf '%s\n' "$restart_token" > "$STATE_DIR/$name.restart"
}

mapfile -t names < <(jq -r '.projects | keys[]' "$MANIFEST_TMP")
for name in "${names[@]}"; do
  enabled="$(jq -r --arg n "$name" '.projects[$n].enabled // false' "$MANIFEST_TMP")"
  [ "$enabled" = "true" ] || { log "$name: disabled"; continue; }

  type="$(jq -r --arg n "$name" '.projects[$n].source.type // "branch"' "$MANIFEST_TMP")"
  case "$type" in
    branch)
      repo="$(jq -r --arg n "$name" '.projects[$n].source.repo' "$MANIFEST_TMP")"
      branch="$(jq -r --arg n "$name" '.projects[$n].source.branch' "$MANIFEST_TMP")"
      subdir="$(jq -r --arg n "$name" '.projects[$n].source.subdir // "."' "$MANIFEST_TMP")"
      target="$(jq -r --arg n "$name" '.projects[$n].target' "$MANIFEST_TMP")"
      compose_file="$(jq -r --arg n "$name" '.projects[$n].compose_file // ""' "$MANIFEST_TMP")"
      env_file="$(jq -r --arg n "$name" '.projects[$n].env_file // ""' "$MANIFEST_TMP")"
      desired="$(jq -r --arg n "$name" '.projects[$n].state // "running"' "$MANIFEST_TMP")"
      restart_token="$(jq -r --arg n "$name" '.projects[$n].restart_token // "0"' "$MANIFEST_TMP")"
      deploy_branch_project "$name" "$repo" "$branch" "$subdir" "$target" "$compose_file" "$env_file" "$desired" "$restart_token"
      ;;
    *) log "$name: unsupported source type: $type" ;;
  esac
done

cp "$MANIFEST_TMP" "$STATE_DIR/last-manifest.json"
log "sync complete"
