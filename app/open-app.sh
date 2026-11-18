#!/usr/bin/env bash
# Open or focus the VS Code anchor using the focused Herdr desktop space.
# App-side counterpart of herdr-plugin/bin/startup.sh: it must not collect from
# the TUI server, or it would overwrite the app's followed space.
set -euo pipefail

# Resolve symlinks: this script is linked from ~/.local/bin, so dirname($0)
# would point at the link, not at the repo.
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  case "$SOURCE" in
    /*) ;;
    *) SOURCE="$DIR/$SOURCE" ;;
  esac
done
HERE="$(cd -P "$(dirname "$SOURCE")" && pwd)"
. "$HERE/../herdr-plugin/bin/lib.sh"

echo "[herdr-vscode-sync] app open" >&2

"$REPO_DIR/app/collect-app.sh" || true

if ! command -v code >/dev/null 2>&1; then
  echo "[herdr-vscode-sync] 'code' CLI not found; not launching VS Code" >&2
  exit 0
fi

WS_FILE="$STATE_DIR/$WORKSPACE_FILE_NAME"
if command -v pgrep >/dev/null 2>&1 && pgrep -f "$WS_FILE" >/dev/null 2>&1; then
  echo "[herdr-vscode-sync] anchor window already open on $WS_FILE" >&2
  exit 0
fi

(code "$WS_FILE" >/dev/null 2>&1 &) || true
echo "[herdr-vscode-sync] opened VS Code on $WS_FILE" >&2
