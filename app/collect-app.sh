#!/usr/bin/env bash
# Write the followed-workspace state from Herdr desktop (`herdr-app`).
# Uses the shared state dir and the same renderer as the TUI plugin, so the
# VS Code extension keeps watching one current.json.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../herdr-plugin/bin/lib.sh"

HERDR_APP_BIN="${HERDR_APP_BIN:-herdr-app}"
SNAPSHOT_FILE="${APP_SNAPSHOT_FILE:-snapshot-app.json}"
TMP="$STATE_DIR/.$SNAPSHOT_FILE.$$"
trap 'rm -f "$TMP" "$TMP.next"' EXIT

echo "[herdr-vscode-sync] app collect start" >&2

if ! "$HERDR_APP_BIN" ls >"$TMP" 2>/dev/null; then
  echo "[herdr-vscode-sync] herdr-app not running; leaving state unchanged" >&2
  exit 0
fi

if ! python3 "$REPO_DIR/app/snapshot-from-app.py" <"$TMP" >"$TMP.next"; then
  echo "[herdr-vscode-sync] no focused space; leaving state unchanged" >&2
  exit 0
fi

mv "$TMP.next" "$STATE_DIR/$SNAPSHOT_FILE"

STATE_DIR="$STATE_DIR" \
CURRENT_FILE_NAME="$CURRENT_FILE_NAME" \
WORKSPACE_FILE_NAME="$WORKSPACE_FILE_NAME" \
SNAPSHOT_FILE="$SNAPSHOT_FILE" \
  python3 "$PLUGIN_DIR/bin/current.py" \
  || echo "[herdr-vscode-sync] app render failed" >&2

echo "[herdr-vscode-sync] app collect done -> $STATE_DIR" >&2
