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


def main() -> int:
    try:
        with open(os.path.join(STATE_DIR, "snapshot.json"), encoding="utf-8") as fh:
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

    with open(os.path.join(STATE_DIR, CURRENT_FILE_NAME), "w", encoding="utf-8") as fh:
        json.dump({"path": path, "name": label}, fh, indent=2)

    stub = os.path.join(STATE_DIR, WORKSPACE_FILE_NAME)
    with open(stub, "w", encoding="utf-8") as fh:
        json.dump({"folders": [{"name": label, "path": path}], "settings": {}}, fh, indent=2)

    return 0


if __name__ == "__main__":
    sys.exit(main())
