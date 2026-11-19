// Invisible overlay used as a Herdr-app command: "doctor + launcher".
// Bind it with "mod.open:herdr-vscode-sync". Each press:
//   1. checks the setup (`code` CLI, VS Code extension, anchor workspace file)
//      and repairs what it safely can;
//   2. opens or focuses the VS Code anchor window;
//   3. tells the person, via notify(), whatever it fixed or could not fix.
// Following the focused space is NOT done here: the VS Code extension does it
// by itself (see vscode-extension/extension.js). This mod holds no state and
// runs no background work; it is safe to press at any time.
import { View, div } from "gpui-kit";
import { checking, closeOverlay, exec, focused, home, notify, props, readTextFile, spaces, appHome, writeTextFile } from "herdr";

const EXT_NAME = "herdr-vscode-sync";
const ANCHOR_NAME = "herdr.code-workspace";

const say = (level, body) => notify({ title: "Herdr VS Code Sync", body, level });

// Real environment, so XDG overrides are honoured (no env access from a mod).
async function stateDir() {
  const r = await exec("sh", ["-c", 'printf %s "${HERDR_VSCODE_SYNC_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/herdr-vscode-sync}"']);
  return r.code === 0 && r.stdout ? r.stdout : `${home()}/.local/state/${EXT_NAME}`;
}

// Link the extension from the repo this mod is symlinked from. Returns a
// human message when it linked something, or throws with the reason.
async function linkExtension() {
  const script = [
    'mod="$1"; ext="$2"',
    '[ -L "$mod" ] || { echo "el mod no es un symlink al repo: instala la extensión a mano"; exit 2; }',
    'repo="$(cd -P "$mod/../.." && pwd)"',
    '[ -f "$repo/vscode-extension/package.json" ] || { echo "no hay vscode-extension en $repo"; exit 2; }',
    'mkdir -p "$(dirname "$ext")"',
    'ln -sfn "$repo/vscode-extension" "$ext"',
  ].join("\n");
  const r = await exec("sh", ["-c", script, "sh", `${appHome()}/mods/${EXT_NAME}`, `${home()}/.vscode/extensions/${EXT_NAME}`]);
  if (r.code !== 0) throw new Error((r.stdout || r.stderr || "no se pudo enlazar").trim());
}

// Seed the anchor with the shown space so a fresh window opens on it; the
// extension corrects it right after if needed. Never overwrites an existing file.
async function seedAnchor(dir) {
  const file = `${dir}/${ANCHOR_NAME}`;
  if ((await readTextFile(file)) !== null) return file;
  const space = spaces().find((s) => s.active);
  const folder = focused()?.cwd || space?.folder || home();
  const name = (space?.name && space.name !== "~" ? space.name : folder.split("/").filter(Boolean).pop()) || "herdr";
  await exec("mkdir", ["-p", dir]);
  await writeTextFile(file, JSON.stringify({ folders: [{ name, path: folder }], settings: {} }, null, 2), null);
  return file;
}

async function doctor() {
  const fixed = [];

  const code = await exec("code", ["--version"]).catch(() => null);
  if (!code || code.code !== 0) {
    say("error", "No encuentro el comando `code` (VS Code) en el PATH. Instálalo o añádelo al PATH.");
    return;
  }

  const ext = await readTextFile(`${home()}/.vscode/extensions/${EXT_NAME}/package.json`);
  if (ext === null) {
    try {
      await linkExtension();
      fixed.push("extensión de VS Code instalada (recarga las ventanas de VS Code ya abiertas)");
    } catch (e) {
      say("error", `La extensión de VS Code no está instalada: ${e.message}`);
      return;
    }
  }

  let ws;
  try {
    ws = await seedAnchor(await stateDir());
  } catch (e) {
    say("error", `No pude preparar el workspace ancla: ${e.message}`);
    return;
  }

  // `code <workspace>` focuses the window if that workspace is already open.
  const open = await exec("code", [ws]).catch((e) => ({ code: 1, stderr: String(e?.message || e) }));
  if (open.code !== 0) {
    say("error", `No pude abrir VS Code: ${(open.stderr || open.stdout || "error").trim()}`);
    return;
  }

  if (fixed.length) say("success", fixed.join("; "));
}

export default class OpenVscodeSync extends View {
  init(_props, cx) {
    if (checking()) return;

    // Do not leave a 2x2 popup on screen while the doctor runs.
    const overlay = props()?.overlay;
    if (overlay) closeOverlay(overlay);

    cx.spawn(async () => {
      try {
        await doctor();
      } catch (error) {
        say("error", String(error?.message || error));
      }
    });
  }

  render() {
    return div();
  }
}
