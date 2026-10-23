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
//  - Status bar shows the current state; "Herdr VS Code Sync: Sync now" in the
//    Command Palette re-runs the reconciliation for diagnosis.
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');

const STATE_FILE = 'folders.json';
const MANAGED_KEY = 'herdrVscodeSync.managedFolders';

/** @type {{managed: Set<string>, file: string|null, out: import('vscode').OutputChannel, status: import('vscode').StatusBarItem}} */
let ctx = { managed: new Set(), file: null, out: null, status: null };

function normalize(p) {
  return process.platform === 'win32' ? String(p).toLowerCase() : String(p);
}

function log(...args) {
  if (ctx.out) {
    ctx.out.appendLine(args.map(String).join(' '));
  }
  console.log('[herdr-vscode-sync]', ...args);
}

function setStatus(text) {
  if (ctx.status) {
    ctx.status.text = text;
    ctx.status.show();
  }
}

/** Herdr data roots, derived from the environment (no hardcoded paths).
 *  State lives under XDG_STATE_HOME, config under XDG_CONFIG_HOME. */
function herdrConfigRoots() {
  const home = os.homedir();
  const roots = [];
  const configHome = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  const stateHome = process.env.XDG_STATE_HOME || path.join(home, '.local', 'state');
  if (process.platform === 'win32') {
    roots.push(path.join(home, '.config', 'herdr'));
    roots.push(path.join(process.env.APPDATA || home, 'herdr'));
    roots.push(path.join(process.env.LOCALAPPDATA || home, 'herdr'));
  } else {
    roots.push(path.join(configHome, 'herdr'));
    roots.push(path.join(stateHome, 'herdr'));
  }
  return roots;
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

/** Find folders.json under the herdr data roots. */
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

/** Rewrite the current workspace file's folder list (keeps existing settings). */
async function writeWorkspaceFile(desired) {
  const wsFile = vscode.workspace.workspaceFile;
  if (!wsFile) return;
  let data = { folders: [], settings: {} };
  try {
    data = JSON.parse(fs.readFileSync(wsFile.fsPath, 'utf8'));
  } catch (_) {
    /* seed defaults */
  }
  if (!Array.isArray(data.folders)) data.folders = [];
  if (!data.settings || typeof data.settings !== 'object') data.settings = {};
  data.folders = desired.map((f) => ({ name: f.name, path: f.path }));
  fs.writeFileSync(wsFile.fsPath, JSON.stringify(data, null, 2), 'utf8');
  log('workspace file rewritten:', wsFile.fsPath);
}

/**
 * Apply the desired folder list to the current window.
 * Returns a human-readable outcome describing what happened.
 */
async function reconcile() {
  const ws = vscode.workspace;

  // updateWorkspaceFolders only exists on a workspace opened from a file.
  if (!ws.workspaceFile) {
    setStatus('Herdr: no .code-workspace open');
    log('WARN: window is not on a .code-workspace file; nothing to sync here. Open the stub via `herdr plugin action invoke local.herdr-vscode-sync.open`.');
    return 'no-workspace-file';
  }

  let file = ctx.file;
  if (!file) {
    file = await discoverFoldersFile();
    ctx.file = file;
  }
  if (!file) {
    setStatus('Herdr: folders.json not found');
    log('WARN: folders.json not found under any herdr data root.');
    return 'no-state-file';
  }
  log('state file:', file);

  let desired = [];
  try {
    desired = readDesired(file);
  } catch (e) {
    log('WARN: cannot parse', file, e && e.message);
    setStatus('Herdr: estado ilegible');
    return 'parse-error';
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

  setStatus(`Herdr: ${desired.length} workspaces`);
  if (additions.length === 0 && deletions.length === 0) {
    log(`no change (desired=${desired.length}, current=${current.length})`);
    return `up-to-date (${desired.length})`;
  }

  const summary = `added ${additions.length}, removed ${deletions.length}`;
  try {
    // Delete first so indices stay valid for the additions call.
    const ok = await ws.updateWorkspaceFolders(deletions, deletions.length, ...additions);
    const applied = ok === true && (vscode.workspace.workspaceFolders || []).length === desired.length;
    if (!applied) {
      // Empty multi-root base: updateWorkspaceFolders silently no-ops. Fall back
      // to writing the folder list into the workspace file and reloading the
      // window. After the reload the file already matches, so this never loops.
      log('in-window apply returned', ok, '- falling back to file rewrite + reload');
      await writeWorkspaceFile(desired);
      setStatus(`Herdr: ${desired.length} workspaces`);
      vscode.commands.executeCommand('workbench.action.reloadWindow');
      return summary + ' (reload)';
    }
    ctx.managed = managed;
    await ctx.state.update(MANAGED_KEY, [...managed]);
    log('reconciled: ' + summary);
    // Post-state check: what does the window actually hold now?
    const now = (ws.workspaceFolders || []).map((f) => `'${f.name}' @ ${f.uri.fsPath}`);
    log('workspaceFile:', ws.workspaceFile && ws.workspaceFile.fsPath);
    log('folders now (' + now.length + '):', now.join(' | '));
    log('focused window id:', vscode.window.activeTextEditor ? 'editor' : 'no-editor');
    setStatus(`Herdr: ${desired.length} workspaces`);
    // Bring the Explorer into view so the folders are obviously there.
    vscode.commands.executeCommand('workbench.view.explorer');
    return summary;
  } catch (e) {
    log('ERROR applying folders:', e && e.stack);
    setStatus('Herdr: error al aplicar');
    return 'apply-error: ' + (e && e.message);
  }
}

/** @param {vscode.ExtensionContext} context */
async function activate(context) {
  ctx.out = vscode.window.createOutputChannel('Herdr VS Code Sync');
  ctx.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
  setStatus('Herdr: …');
  log('activated');

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
  // herdr data roots to catch late creation.
  if (file) {
    const w = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(path.dirname(file), path.basename(file))
    );
    w.onDidCreate(schedule);
    w.onDidChange(schedule);
    w.onDidDelete(schedule);
    context.subscriptions.push(w);
  }
  for (const root of roots) {
    const w = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(root, '**/' + STATE_FILE)
    );
    w.onDidCreate(schedule);
    w.onDidChange(schedule);
    w.onDidDelete(schedule);
    context.subscriptions.push(w);
  }

  // Re-check when the window regains focus: covers files that appeared while
  // VS Code was closed or the window hidden.
  vscode.window.onDidChangeWindowState((s) => {
    if (s.focused) schedule();
  });

  // Manual diagnostic entry point.
  context.subscriptions.push(
    vscode.commands.registerCommand('herdrVscodeSync.syncNow', async () => {
      const result = await reconcile();
      const msg = result === 'up-to-date' || result.startsWith('added') || result.startsWith('removed')
        ? `Sincronizado: ${result}`
        : `Estado: ${result}`;
      vscode.window.showInformationMessage('[Herdr Sync] ' + msg);
    })
  );

  await reconcile();
  log('activate finished');
}

function deactivate() {}

module.exports = { activate, deactivate };
