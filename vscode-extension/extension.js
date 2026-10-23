// herdr-vscode-sync — VS Code extension.
//
// Watches the folders.json file the Herdr plugin writes and reconciles the
// current multi-root window so it mirrors Herdr workspaces live.
//
// Design notes:
//  - Works only on a multi-root window (a .code-workspace file must be open).
//  - Folders added by this extension are remembered in globalState so folders
//    the user added manually in VS Code are never removed.
//  - Nothing is written back to Herdr: this is Herdr -> VS Code only.
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');

const STATE_FILE = 'folders.json';
const MANAGED_KEY = 'herdrVscodeSync.managedFolders';

/** @type {{managed: Set<string>, file: string|null}} */
let ctx = { managed: new Set(), file: null };

function normalize(p) {
  return process.platform === 'win32' ? String(p).toLowerCase() : String(p);
}

/** Herdr config roots, derived from the environment (no hardcoded paths). */
function herdrConfigRoots() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return [path.join(home, '.config', 'herdr'), path.join(process.env.APPDATA || home, 'herdr')];
  }
  return [path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'herdr')];
}

function walkDir(dir, out, depth) {
  if (depth > 5) return;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    try {
      if (e.isDirectory()) {
        walkDir(full, out, depth + 1);
      } else if (e.isFile() && e.name === STATE_FILE) {
        out.push(full);
      }
    } catch (_) {
      /* skip unreadable entries */
    }
  }
}

/** Find folders.json under the herdr plugins directory. */
async function discoverFoldersFile() {
  const explicit = vscode.workspace.getConfiguration('herdrVscodeSync').get('foldersFile');
  if (explicit) {
    try {
      if (fs.existsSync(explicit)) return explicit;
    } catch (_) { /* fall through to discovery */ }
  }
  for (const root of herdrConfigRoots()) {
    const pluginsRoot = path.join(root, 'plugins');
    if (!fs.existsSync(pluginsRoot)) continue;
    const found = [];
    walkDir(pluginsRoot, found, 0);
    if (found.length) return found[0];
  }
  return null;
}

function readDesired(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return (raw.folders || [])
    .filter((f) => f && typeof f.path === 'string' && f.path.trim())
    .map((f) => ({ name: String(f.name || '').trim() || undefined, path: f.path }));
}

async function reconcile() {
  const ws = vscode.workspace;
  // updateWorkspaceFolders only exists on a workspace opened from a file.
  if (!ws.workspaceFile) {
    console.log('[herdr-vscode-sync] no .code-workspace open; nothing to reconcile');
    return;
  }
  let file = ctx.file;
  if (!file) {
    file = await discoverFoldersFile();
    ctx.file = file;
  }
  if (!file) {
    console.log('[herdr-vscode-sync] folders.json not found; plugin may not have run yet');
    return;
  }

  let desired = [];
  try {
    desired = readDesired(file);
  } catch (_) {
    return; // file missing/mid-write; the watcher will fire again
  }

  const current = ws.workspaceFolders || [];
  const desiredByPath = new Map(desired.map((f) => [normalize(f.path), f.name]));
  const present = new Set(current.map((f) => normalize(f.uri.fsPath)));
  const managed = new Set([...ctx.managed]);

  // Add what Herdr has and we don't yet.
  const additions = [];
  for (const d of desired) {
    const key = normalize(d.path);
    if (!present.has(key)) {
      additions.push({ name: d.name, uri: vscode.Uri.file(d.path) });
      managed.add(key);
    }
  }

  // Remove what we previously added but Herdr no longer has.
  const deletions = [];
  current.forEach((folder, index) => {
    const key = normalize(folder.uri.fsPath);
    if (managed.has(key) && !desiredByPath.has(key)) {
      deletions.push(index);
      managed.delete(key);
    }
  });

  if (additions.length === 0 && deletions.length === 0) {
    ctx.managed = managed;
    return;
  }

  // Delete first so indices stay valid for the additions call.
  await ws.updateWorkspaceFolders(deletions, deletions.length, ...additions);
  ctx.managed = managed;
  await ctx.state.update(MANAGED_KEY, [...managed]);
  console.log(`[herdr-vscode-sync] reconciled (+${additions.length} -${deletions.length})`);
}

/** @param {vscode.ExtensionContext} context */
async function activate(context) {
  ctx.state = context.globalState;
  ctx.managed = new Set(context.globalState.get(MANAGED_KEY) || []);

  const roots = herdrConfigRoots().filter((r) => fs.existsSync(path.join(r, 'plugins')));
  const file = await discoverFoldersFile();
  ctx.file = file;

  const schedule = () => {
    clearTimeout(schedule.timer);
    schedule.timer = setTimeout(() => reconcile(), 300);
  };

  // Watch the exact file when it exists, plus a recursive glob under the
  // herdr plugins root to catch late creation.
  if (file) {
    vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(path.dirname(file), path.basename(file)))
      .onDidCreate(schedule).onDidChange(schedule).onDidDelete(schedule);
  }
  for (const root of roots) {
    vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/' + STATE_FILE))
      .onDidCreate(schedule).onDidChange(schedule).onDidDelete(schedule);
  }

  await reconcile();
}

function deactivate() {}

module.exports = { activate, deactivate };
