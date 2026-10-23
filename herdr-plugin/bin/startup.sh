#!/usr/bin/env bash
# Open (or focus) the VS Code anchor window on the followed workspace.
# Runs collect first so the anchor file is fresh, then opens `code <anchor>`
# if no window is already on it.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

echo "[herdr-vscode-sync] open" >&2

"$PLUGIN_DIR/bin/collect.sh" || true

if ! command -v code >/dev/null 2>&1; then
  echo "[herdr-vscode-sync] 'code' CLI not found; not launching VS Code" >&2
  exit 0
fi

WS_FILE="$STATE_DIR/$WORKSPACE_FILE_NAME"
if command -v pgrep >/dev/null 2>&1 && pgrep -f "$WS_FILE" >/dev/null 2>&1; then
  echo "[herdr-vscode-sync] anchor window already open on $WS_FILE" >&2
  exit 0
fi

# Best effort, detached: reuses an already running VS Code app instance.
(code "$WS_FILE" >/dev/null 2>&1 &) || true
echo "[herdr-vscode-sync] opened VS Code on $WS_FILE" >&2
