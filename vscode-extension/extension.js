// herdr-vscode-sync — VS Code extension (follow-focus).
//
// Watches current.json (written by the Herdr plugin: the focused workspace)
// and switches the ANCHOR window's folder to follow it. The anchor window is
// the one opened on herdr.code-workspace — no other window is touched.
//
// Change mechanics, in order:
//   1. workspace.updateWorkspaceFolders on the anchor (workspace-file window).
//   2. If VS Code rejects it, rewrite herdr.code-workspace with the new folder
//      and reload the window (deterministic fallback, never loops).
// Nothing is written back to Herdr: this is Herdr -> VS Code only.
//
// Two sources feed the same swap (last change wins):
//   - current.json: written by the Herdr TUI plugin (file watcher).
//   - Herdr desktop app: polled here via appSource.js (no service, no state
//     file). Polled every `pollSeconds` while the anchor window exists, and
//     forced whenever the window gains focus: that is the reliability anchor,
//     the poll only makes the follow feel immediate.
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { readFocusedSpace } = require('./appSource');

const CURRENT_FILE = 'current.json';
const ANCHOR_NAME = 'herdr.code-workspace';
const DISCOVER_DEPTH = 5;

/** @type {{file: string|null, out: import('vscode').OutputChannel, status: import('vscode').StatusBarItem, busy: boolean, queued: boolean, source: 'file'|'app', appTarget: {path: string, name: string}|null, appKey: string, appOk: boolean, lastIssue: string}} */
let ctx = {
  file: null, out: null, status: null, busy: false, queued: false,
  source: 'file', appTarget: null, appKey: '', appOk: false, lastIssue: '',
};

function normalize(p) {
  return process.platform === 'win32' ? String(p).toLowerCase() : String(p);
}

function log(...args) {
  if (ctx.out) ctx.out.appendLine(args.map(String).join(' '));
  console.log('[herdr-vscode-sync]', ...args);
}

function setStatus(text, tooltip) {
  if (ctx.status) {
    ctx.status.text = text;
    ctx.status.tooltip = tooltip || 'Herdr VS Code Sync: seguir ahora';
    ctx.status.show();
  }
}

/** Log a problem once per distinct message, so a 2 s poll cannot flood the log. */
function reportIssue(message) {
  if (ctx.lastIssue === message) return;
  ctx.lastIssue = message;
  log('issue:', message);
}

/** Herdr data roots, derived from the environment (no hardcoded paths). */
function herdrDataRoots() {
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

/** Stable state dir shared by the TUI plugin and the desktop-app bridge. */
function canonicalCurrentFile() {
  const home = os.homedir();
  const stateHome = process.env.XDG_STATE_HOME || path.join(home, '.local', 'state');
  return path.join(stateHome, 'herdr-vscode-sync', CURRENT_FILE);
}

function walkDir(dir, out, depth) {
  if (depth > DISCOVER_DEPTH) return;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    try {
      if (e.isDirectory()) walkDir(full, out, depth + 1);
      else if (e.isFile() && e.name === CURRENT_FILE) out.push(full);
    } catch (_) { /* skip unreadable entries */ }
  }
}

/** Find current.json under the herdr data roots. */
async function discoverCurrentFile() {
  const explicit = vscode.workspace.getConfiguration('herdrVscodeSync').get('currentFile');
  if (explicit) {
    try {
      if (fs.existsSync(explicit)) return explicit;
    } catch (_) { /* fall through */ }
  }
  const canonical = canonicalCurrentFile();
  try {
    if (fs.existsSync(canonical)) return canonical;
  } catch (_) { /* fall through */ }
  for (const root of herdrDataRoots()) {
    const pluginsRoot = path.join(root, 'plugins');
    if (!fs.existsSync(pluginsRoot)) continue;
    const found = [];
    walkDir(pluginsRoot, found, 0);
    if (found.length) return found[0];
  }
  return null;
}

function readTarget(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { name: String(data.name || '').trim() || undefined, path: String(data.path || '').trim() };
}

/** Rewrite the anchor workspace file with a single folder. */
function rewriteAnchorFile(uri, target) {
  let data = { folders: [], settings: {} };
  try {
    data = JSON.parse(fs.readFileSync(uri.fsPath, 'utf8'));
  } catch (_) { /* seed defaults */ }
  if (!Array.isArray(data.folders)) data.folders = [];
  if (!data.settings || typeof data.settings !== 'object') data.settings = {};
  data.folders = [{ name: target.name, path: target.path }];
  fs.writeFileSync(uri.fsPath, JSON.stringify(data, null, 2), 'utf8');
  log('anchor file rewritten:', uri.fsPath);
}

/**
 * Follow the target workspace in the anchor window.
 * Returns a short human-readable outcome.
 */
async function sync() {
  let target;
  if (ctx.source === 'app' && ctx.appTarget) {
    target = ctx.appTarget;
  } else {
    if (!ctx.file) {
      ctx.file = await discoverCurrentFile();
    }
    if (!ctx.file) {
      setStatus('Herdr: sin fuente', 'No hay herdr-app en ejecución ni current.json');
      return 'no-file';
    }
    try {
      target = readTarget(ctx.file);
    } catch (e) {
      log('cannot parse', ctx.file, e && e.message);
      return 'parse-error';
    }
  }

  const ws = vscode.workspace;
  // Only the anchor window follows; never hijack other windows.
  if (!ws.workspaceFile || path.basename(ws.workspaceFile.fsPath) !== ANCHOR_NAME) {
    setStatus('Herdr: abre la ventana ancla (herdr.code-workspace)');
    return 'not-anchor';
  }
  log('target:', target.path);

  const current = ws.workspaceFolders || [];
  const currentPath = current.length ? current[0].uri.fsPath : null;
  if (currentPath && normalize(currentPath) === normalize(target.path)) {
    setStatus('Herdr: sigue ' + target.name);
    return 'same';
  }

  // 1) Swap in place (allowed on a workspace-file window).
  const ok = await ws.updateWorkspaceFolders(0, current.length,
    { name: target.name, uri: vscode.Uri.file(target.path) });
  const applied =
    ok === true &&
    (ws.workspaceFolders || []).length === 1 &&
    normalize(ws.workspaceFolders[0].uri.fsPath) === normalize(target.path);
  if (applied) {
    log('switched to', target.path);
    setStatus('Herdr: sigue ' + target.name);
    return 'switched';
  }

  // 2) Deterministic fallback: rewrite the anchor file, reload the window.
  log('in-window swap returned', ok, '- rewriting anchor + reload');
  try {
    rewriteAnchorFile(ws.workspaceFile, target);
  } catch (e) {
    log('anchor rewrite failed:', e && e.message);
    return 'rewrite-fail';
  }
  setStatus('Herdr: sigue ' + target.name);
  vscode.commands.executeCommand('workbench.action.reloadWindow');
  return 'reloaded';
}

function isAnchorWindow() {
  const wf = vscode.workspace.workspaceFile;
  return Boolean(wf && path.basename(wf.fsPath) === ANCHOR_NAME);
}

/**
 * Ask Herdr desktop for its selected space and follow it.
 * `force`: apply even when the space did not change (window focus).
 * Returns true when the app answered (so the caller need not fall back to the file).
 */
async function refreshApp(force) {
  if (!isAnchorWindow()) return false;
  const cfg = vscode.workspace.getConfiguration('herdrVscodeSync');
  const res = await readFocusedSpace({ appBin: cfg.get('appBin'), hcBin: cfg.get('hcBin') });
  if (!res.ok) {
    ctx.appOk = false;
    // A missing binary is a setup problem: say so. A closed app is normal
    // (the TUI may be in use): stay quiet and let current.json drive.
    if (res.reason === 'no-bin') {
      setStatus('Herdr: herdr-app no encontrado', res.detail);
      reportIssue(res.detail);
    } else {
      reportIssue(res.reason + ': ' + res.detail);
    }
    return false;
  }
  ctx.appOk = true;
  ctx.lastIssue = '';
  const key = res.id + '\t' + res.path;
  if (!force && key === ctx.appKey) return true;
  ctx.appKey = key;
  ctx.appTarget = { path: res.path, name: res.name };
  ctx.source = 'app';
  await runSync();
  return true;
}

/** Serialized: never overlap two folder-swaps. */
async function runSync() {
  if (ctx.busy) {
    ctx.queued = true;
    return;
  }
  ctx.busy = true;
  try {
    await sync();
  } finally {
    ctx.busy = false;
    if (ctx.queued) {
      ctx.queued = false;
      setTimeout(() => runSync(), 120);
    }
  }
}

/** @param {vscode.ExtensionContext} context */
async function activate(context) {
  ctx.out = vscode.window.createOutputChannel('Herdr VS Code Sync');
  ctx.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
  ctx.status.command = 'herdrVscodeSync.syncNow';
  setStatus('Herdr: …');
  log('activated');

  const roots = herdrDataRoots().filter((r) => fs.existsSync(path.join(r, 'plugins')));
  const file = await discoverCurrentFile();
  ctx.file = file;

  const schedule = () => {
    clearTimeout(schedule.timer);
    schedule.timer = setTimeout(() => { ctx.source = 'file'; runSync(); }, 300);
  };

  if (file) {
    const w = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(path.dirname(file), path.basename(file))
    );
    w.onDidCreate(schedule);
    w.onDidChange(schedule);
    w.onDidDelete(() => { ctx.file = null; schedule(); });
    context.subscriptions.push(w);
  }

  // Canonical file: may not exist yet. Watch its folder so the first write
  // from either Herdr frontend is picked up without reloading VS Code.
  const canonical = canonicalCurrentFile();
  try {
    fs.mkdirSync(path.dirname(canonical), { recursive: true });
  } catch (_) { /* watcher still handles an existing folder */ }
  const cw = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(path.dirname(canonical), CURRENT_FILE)
  );
  cw.onDidCreate(() => { ctx.file = canonical; schedule(); });
  cw.onDidChange(() => { ctx.file = canonical; schedule(); });
  cw.onDidDelete(() => { if (ctx.file === canonical) ctx.file = null; schedule(); });
  context.subscriptions.push(cw);

  for (const root of roots) {
    const w = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(root, '**/' + CURRENT_FILE)
    );
    w.onDidCreate(schedule);
    w.onDidChange(schedule);
    w.onDidDelete(schedule);
    context.subscriptions.push(w);
  }

  // Focus is the reliability anchor: whatever the poll missed is fixed here.
  context.subscriptions.push(vscode.window.onDidChangeWindowState(async (s) => {
    if (!s.focused) return;
    if (!(await refreshApp(true))) schedule();
  }));

  // Light poll so a space change is followed without touching VS Code.
  // Recursive timeout (not setInterval): a slow call can never overlap itself.
  let stopped = false;
  const poll = async () => {
    if (stopped) return;
    const secs = Number(vscode.workspace.getConfiguration('herdrVscodeSync').get('pollSeconds'));
    try {
      if (secs > 0) await refreshApp(false);
    } catch (e) {
      reportIssue('poll error: ' + (e && e.message));
    }
    if (!stopped) poll.timer = setTimeout(poll, Math.max(1, secs > 0 ? secs : 5) * 1000);
  };
  context.subscriptions.push({ dispose: () => { stopped = true; clearTimeout(poll.timer); } });

  context.subscriptions.push(
    vscode.commands.registerCommand('herdrVscodeSync.syncNow', async () => {
      if (!(await refreshApp(true))) await runSync();
      vscode.window.showInformationMessage('[Herdr Sync] ' + (ctx.appOk ? 'app' : 'file') + ': ' +
        ((ctx.status && ctx.status.text) || ''));
    })
  );

  if (!(await refreshApp(true))) await runSync();
  poll();
  log('activate finished');
}

function deactivate() {}

module.exports = { activate, deactivate };
