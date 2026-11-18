#!/usr/bin/env bash
# Keep current.json following Herdr desktop.
# The TUI plugin writes on workspace.focused events; this bridge polls the app
# because herdr-app has no event stream for space changes. It writes only when
# the app's selected space changes, so the TUI's writes are not overwritten
# while the app is idle. If both frontends are used at once, last change wins.
set -u
. "$(dirname "${BASH_SOURCE[0]}")/../herdr-plugin/bin/lib.sh"

HERDR_APP_BIN="${HERDR_APP_BIN:-herdr-app}"
POLL_SECONDS="${POLL_SECONDS:-1}"
last=""

log() { echo "[herdr-vscode-sync] $*" >&2; }

log "watching herdr-app (every ${POLL_SECONDS}s)"

while :; do
  key=$("$HERDR_APP_BIN" ls 2>/dev/null |
    python3 "$REPO_DIR/app/snapshot-from-app.py" --key 2>/dev/null) || key=""

  if [ -n "$key" ] && [ "$key" != "$last" ]; then
    if "$REPO_DIR/app/collect-app.sh"; then
      last="$key"
      log "followed: $key"
    fi
  fi

  sleep "$POLL_SECONDS"
done
