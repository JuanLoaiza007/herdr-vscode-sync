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
EXCLUDE_LABELS="${EXCLUDE_LABELS:-desktop,escritorio}"
WORKSPACE_FILE_NAME="${WORKSPACE_FILE_NAME:-herdr.code-workspace}"
STATE_FILE_NAME="${STATE_FILE_NAME:-folders.json}"

# State dir. Herdr injects HERDR_PLUGIN_STATE_DIR at runtime; the fallback
# below only covers manual runs outside Herdr.
if [ -n "${HERDR_PLUGIN_STATE_DIR:-}" ]; then
  STATE_DIR="$HERDR_PLUGIN_STATE_DIR"
else
  STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/herdr/plugins/${HERDR_PLUGIN_ID:-local.herdr-vscode-sync}"
fi
mkdir -p "$STATE_DIR"

# Herdr binary: prefer the path Herdr injects (portable across sockets/pipes).
HERDR_BIN="${HERDR_BIN_PATH:-herdr}"
