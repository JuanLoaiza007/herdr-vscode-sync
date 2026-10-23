#!/usr/bin/env bash
# Write the followed-workspace state from the current Herdr session.
# Reads a session snapshot via the Herdr CLI and renders current.json plus the
# single-folder workspace file. Safe to re-run freely.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

echo "[herdr-vscode-sync] collect start" >&2

if ! "$HERDR_BIN" api snapshot >"$STATE_DIR/snapshot.json" 2>/dev/null; then
  echo "[herdr-vscode-sync] could not read snapshot; leaving state unchanged" >&2
  exit 0
fi

STATE_DIR="$STATE_DIR" \
CURRENT_FILE_NAME="$CURRENT_FILE_NAME" \
WORKSPACE_FILE_NAME="$WORKSPACE_FILE_NAME" \
  python3 "$PLUGIN_DIR/bin/current.py" \
  || echo "[herdr-vscode-sync] render failed" >&2

echo "[herdr-vscode-sync] collect done -> $STATE_DIR" >&2
