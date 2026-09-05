#!/bin/sh
set -eu

case "${1:-}" in
  launcher.py|*/launcher.py)
    exec node /app/src/start.mjs
    ;;
  *)
    exec node "$@"
    ;;
esac
