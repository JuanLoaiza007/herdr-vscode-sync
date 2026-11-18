#!/usr/bin/env python3
"""Write the followed-workspace state from a Herdr session snapshot.

Reads $STATE_DIR/snapshot.json (written by collect.sh). The followed workspace
is the one Herdr currently has focused; its folder path is the cwd of its first
pane and the folder name is the workspace label (or the cwd basename).

Writes:
  $STATE_DIR/current.json           -- {path, name}; the extension watches this
  $STATE_DIR/herdr.code-workspace   -- single-folder workspace file; `code
                                       <file>` opens an anchored window on it
"""
import json
import os
import sys

STATE_DIR = os.environ.get("STATE_DIR", "")
CURRENT_FILE_NAME = os.environ.get("CURRENT_FILE_NAME", "current.json")
WORKSPACE_FILE_NAME = os.environ.get("WORKSPACE_FILE_NAME", "herdr.code-workspace")
SNAPSHOT_FILE = os.environ.get("SNAPSHOT_FILE", "snapshot.json")


def write_json(name: str, data: dict) -> None:
    """Atomic replace: VS Code may read while the TUI and the app race."""
    path = os.path.join(STATE_DIR, name)
    tmp = f"{path}.tmp.{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
    os.replace(tmp, path)


def main() -> int:
    try:
        with open(os.path.join(STATE_DIR, SNAPSHOT_FILE), encoding="utf-8") as fh:
            snap = json.load(fh)["result"]["snapshot"]
    except (OSError, KeyError, ValueError):
        return 1

    # Focused workspace: prefer the focused flag, fall back to focused id.
    focused = next((w for w in snap.get("workspaces", []) if w.get("focused")), None)
    if focused is None:
        fid = snap.get("focused_workspace_id")
        focused = next((w for w in snap.get("workspaces", []) if w.get("workspace_id") == fid), None)
    if focused is None:
        return 1

    wid = focused.get("workspace_id")
    path = next((p.get("cwd") for p in snap.get("panes", []) if p.get("workspace_id") == wid and p.get("cwd")), None)
    if not path:
        return 1

    label = (focused.get("label") or "").strip() or os.path.basename(os.path.normpath(path))

    write_json(CURRENT_FILE_NAME, {"path": path, "name": label})
    write_json(
        WORKSPACE_FILE_NAME,
        {"folders": [{"name": label, "path": path}], "settings": {}},
    )

    return 0


if __name__ == "__main__":
    sys.exit(main())
