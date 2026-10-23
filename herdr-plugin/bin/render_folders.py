#!/usr/bin/env python3
"""Render the VS Code folder list from a Herdr session snapshot.

Reads $STATE_DIR/snapshot.json (written by collect.sh) and writes:
  $STATE_DIR/folders.json        -- folder list the VS Code extension watches
  $STATE_DIR/herdr.code-workspace -- multi-root stub VS Code opens

One workspace is one folder. A workspace's folder path is the cwd of its
first pane; its folder name is the workspace label (or the cwd basename).
Excluded labels (EXCLUDE_LABELS, case-insensitive substring) are dropped.
"""
import json
import os
import re
import sys

STATE_DIR = os.environ.get("STATE_DIR", "")
EXCLUDE = [
    p.strip().lower()
    for p in os.environ.get("EXCLUDE_LABELS", "").split(",")
    if p.strip()
]
WORKSPACE_FILE_NAME = os.environ.get("WORKSPACE_FILE_NAME", "herdr.code-workspace")
STATE_FILE_NAME = os.environ.get("STATE_FILE_NAME", "folders.json")


def main() -> int:
    try:
        with open(os.path.join(STATE_DIR, "snapshot.json"), encoding="utf-8") as fh:
            snap = json.load(fh)["result"]["snapshot"]
    except (OSError, KeyError, ValueError):
        return 1

    # First pane with a cwd per workspace (stable, one path per workspace).
    pane_cwd: dict[str, str] = {}
    for pane in snap.get("panes", []):
        wid = pane.get("workspace_id")
        cwd = pane.get("cwd")
        if wid and cwd and wid not in pane_cwd:
            pane_cwd[wid] = cwd

    folders = []
    for ws in snap.get("workspaces", []):
        wid = ws.get("workspace_id")
        path = pane_cwd.get(wid)
        if not path:
            continue
        label = (ws.get("label") or "").strip()
        if not label:
            label = os.path.basename(os.path.normpath(path))
        low = label.lower()
        if any(exc in low for exc in EXCLUDE):
            continue
        folders.append({"name": label, "path": path})

    folders.sort(key=lambda f: f["name"].lower())
    with open(os.path.join(STATE_DIR, STATE_FILE_NAME), "w", encoding="utf-8") as fh:
        json.dump({"folders": folders}, fh, indent=2)

    # The workspace stub carries the REAL folder list so `code <stub>` opens an
    # already-populated multi-root window (native path, no extension needed for
    # the base state). The extension only keeps the open window in sync live.
    stub = os.path.join(STATE_DIR, WORKSPACE_FILE_NAME)
    with open(stub, "w", encoding="utf-8") as fh:
        json.dump(
            {"folders": [{"name": f["name"], "path": f["path"]} for f in folders], "settings": {}},
            fh,
            indent=2,
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
