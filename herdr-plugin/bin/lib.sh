#!/usr/bin/env bash
# Shared helpers for herdr-vscode-sync plugin scripts. Sourced, not executed.
set -u

# Locate plugin and repo roots from this file's own location.
PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$PLUGIN_DIR/.." && pwd)"

# Load user-editable repo config, then pin defaults (config wins).
CONFIG_FILE="$REPO_DIR/config/sync.env"
if [ -f "$CONFIG_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$CONFIG_FILE"
  set +a
fi
CURRENT_FILE_NAME="${CURRENT_FILE_NAME:-current.json}"
WORKSPACE_FILE_NAME="${WORKSPACE_FILE_NAME:-herdr.code-workspace}"

# State dir. Shared by the TUI plugin and the desktop-app bridge, so the VS
# Code extension watches one stable file. Do not use Herdr's per-plugin state
# dir: it is not reachable from the app.
STATE_DIR="${HERDR_VSCODE_SYNC_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/herdr-vscode-sync}"
mkdir -p "$STATE_DIR"

# Herdr binary: prefer the path Herdr injects (portable across sockets/pipes).
HERDR_BIN="${HERDR_BIN_PATH:-herdr}"
