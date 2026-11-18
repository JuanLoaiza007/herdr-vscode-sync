#!/usr/bin/env python3
"""Turn `herdr-app ls` into the snapshot shape `current.py` already knows.

The desktop app is a different product from the TUI: it has no
`herdr api snapshot`. Its window exposes spaces, tabs and terminals as JSON.
Only the focused space matters here: folder plus label. The folder is the
shell's live cwd (via `hc get`, repo root if any), falling back to the space's
registered `folder`.

Usage:
  herdr-app ls | snapshot-from-app.py          # synthetic snapshot (JSON)
  herdr-app ls | snapshot-from-app.py --key    # id<TAB>folder<TAB>label
"""
import json
import os
import subprocess
import sys

HC_BIN = os.environ.get("HC_BIN", "hc")


def run(argv, cwd=None):
    """Run a command, return stripped stdout or "" on any failure."""
    try:
        out = subprocess.run(
            argv, cwd=cwd, capture_output=True, text=True, timeout=2, check=True
        )
        return out.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def live_folder(space: dict) -> str:
    """Real directory of the space: the shell's cwd in its active tab.

    The space's `folder` is fixed when it is created and goes stale after a
    `cd`. `hc get` reports the foreground process cwd. Any failure returns ""
    so the caller falls back to `folder`.
    """
    tabs = space.get("tabs") or []
    tab = next((t for t in tabs if t.get("active")), tabs[0] if tabs else None)
    terminals = (tab or {}).get("terminals") or []
    if not terminals or not terminals[0].get("terminal"):
        return ""
    raw = run([HC_BIN, "get", str(terminals[0]["terminal"])])
    try:
        cwd = str(((json.loads(raw).get("foreground") or {}).get("cwd")) or "").strip()
    except (ValueError, AttributeError):
        return ""
    if not cwd or not os.path.isdir(cwd):
        return ""
    # A `cd` into a subfolder must not change the VS Code folder: use the repo root.
    root = run(["git", "rev-parse", "--show-toplevel"], cwd=cwd)
    return root if root and os.path.isdir(root) else cwd


def main() -> int:
    as_key = "--key" in sys.argv[1:]
    try:
        doc = json.load(sys.stdin)
    except ValueError:
        return 1

    spaces = doc.get("spaces") or []
    focused = next((s for s in spaces if s.get("active")), None)
    if focused is None:
        return 1

    folder = live_folder(focused) or str(focused.get("folder") or "").strip()
    if not folder:
        return 1

    name = str(focused.get("name") or "").strip()
    # The app labels an unnamed home space "~"; use the folder basename so the
    # VS Code anchor gets a useful name, as the TUI plugin does.
    label = "" if name in ("", "~") else name
    if not label:
        label = os.path.basename(os.path.normpath(folder))

    if as_key:
        print(f"{focused.get('id', '')}\t{folder}\t{label}")
        return 0

    snapshot = {
        "result": {
            "snapshot": {
                "focused_workspace_id": focused.get("id"),
                "workspaces": [
                    {
                        "workspace_id": focused.get("id"),
                        "focused": True,
                        "label": label,
                    }
                ],
                "panes": [
                    {
                        "workspace_id": focused.get("id"),
                        "cwd": folder,
                    }
                ],
            }
        }
    }
    json.dump(snapshot, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
