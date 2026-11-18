// Invisible overlay used as a Herdr-app command: opens or focuses the VS Code
// anchor for the focused desktop space. Bind it with "mod.open:herdr-vscode-sync".
import { View, div } from "gpui-kit";
import { checking, closeOverlay, exec, home, notify, props } from "herdr";

const SCRIPT = `${home()}/.local/bin/herdr-vscode-sync-open`;

export default class OpenVscodeSync extends View {
  init(_props, cx) {
    if (checking()) return;

    // Do not leave a 2x2 popup on screen while the script runs.
    const overlay = props()?.overlay;
    if (overlay) closeOverlay(overlay);

    cx.spawn(async () => {
      try {
        const result = await exec(SCRIPT, [], { timeout: 30000 });
        if (result.code !== 0) {
          notify({
            title: "Herdr VS Code Sync",
            body: (result.stderr || result.stdout || "open failed").trim(),
            level: "error",
          });
        }
      } catch (error) {
        notify({
          title: "Herdr VS Code Sync",
          body: String(error?.message || error),
          level: "error",
        });
      }
    });
  }

  render() {
    return div();
  }
}
