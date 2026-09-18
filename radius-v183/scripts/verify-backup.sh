#!/usr/bin/env bash
set -euo pipefail

backup_file="${1:-}"
if [ -z "$backup_file" ] || [ ! -f "$backup_file" ]; then
  printf 'Usage: scripts/verify-backup.sh /absolute/path/to/backup.dump\n' >&2
  exit 2
fi

sha_file="$backup_file.sha256"
if [ ! -f "$sha_file" ]; then
  printf 'Checksum file is missing: %s\n' "$sha_file" >&2
  exit 2
fi

read -r expected_checksum _ < "$sha_file"
if ! [[ "$expected_checksum" =~ ^[a-fA-F0-9]{64}$ ]]; then
  printf 'Checksum file is malformed: %s\n' "$sha_file" >&2
  exit 2
fi
actual_checksum="$(sha256sum "$backup_file" | awk '{print $1}')"
if [ "$actual_checksum" != "$expected_checksum" ]; then
  printf 'Backup checksum does not match.\n' >&2
  exit 1
fi
pg_restore --list "$backup_file" >/dev/null
printf 'Backup checksum and archive catalog are valid.\n'
