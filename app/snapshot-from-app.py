#!/usr/bin/env python3
"""Turn `herdr-app ls` into the snapshot shape `current.py` already knows.

The desktop app is a different product from the TUI: it has no
`herdr api snapshot`. Its window exposes spaces, tabs and terminals as JSON.
Only the focused space matters here: folder plus label.

Usage:
  herdr-app ls | snapshot-from-app.py          # synthetic snapshot (JSON)
  herdr-app ls | snapshot-from-app.py --key    # id<TAB>folder<TAB>label
"""
import json
import os
import sys


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

    folder = str(focused.get("folder") or "").strip()
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
