#!/usr/bin/env bash
# Herdr startup hook: refresh the folder list, then open VS Code on the
# multi-root stub if it is not already open.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

echo "[herdr-vscode-sync] startup" >&2

"$PLUGIN_DIR/bin/collect.sh" || true

if ! command -v code >/dev/null 2>&1; then
  echo "[herdr-vscode-sync] 'code' CLI not found; not launching VS Code" >&2
  exit 0
fi

WS_FILE="$STATE_DIR/$WORKSPACE_FILE_NAME"
if command -v pgrep >/dev/null 2>&1 && pgrep -f "$WS_FILE" >/dev/null 2>&1; then
  echo "[herdr-vscode-sync] VS Code window already on $WS_FILE" >&2
  exit 0
fi

# Best effort, detached: if VS Code is already running this opens a new window
# on the stub; otherwise it starts VS Code with the stub.
(code "$WS_FILE" >/dev/null 2>&1 &) || true
echo "[herdr-vscode-sync] opened VS Code on $WS_FILE" >&2
