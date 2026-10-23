#!/usr/bin/env bash
# Regenerate the folder list (folders.json) from the current Herdr workspaces.
# Reads a session snapshot via the Herdr CLI, renders folders.json plus the
# multi-root workspace stub, and exits. Safe to re-run freely; the VS Code
# extension diffs before applying anything.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

echo "[herdr-vscode-sync] collect start" >&2

if ! "$HERDR_BIN" api snapshot >"$STATE_DIR/snapshot.json" 2>/dev/null; then
  echo "[herdr-vscode-sync] could not read snapshot; leaving state unchanged" >&2
  exit 0
fi

STATE_DIR="$STATE_DIR" \
EXCLUDE_LABELS="$EXCLUDE_LABELS" \
WORKSPACE_FILE_NAME="$WORKSPACE_FILE_NAME" \
STATE_FILE_NAME="$STATE_FILE_NAME" \
  python3 "$PLUGIN_DIR/bin/render_folders.py" \
  || echo "[herdr-vscode-sync] render failed" >&2

echo "[herdr-vscode-sync] collect done -> $STATE_DIR" >&2
