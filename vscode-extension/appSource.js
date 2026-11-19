// herdr-vscode-sync — source: Herdr desktop app.
//
// Asks the running app which space is selected and where its terminal really
// is. Runs inside the VS Code extension host, so it needs no service and no
// state file: it lives and dies with the anchor window.
//
//   herdr-app ls  -> spaces; the one with `active: true` is the shown space.
//   hc get <term> -> `foreground.cwd`, the live directory of its shell.
//   git rev-parse -> repo root, so a `cd` into a subfolder keeps the folder.
//
// Every failure is reported as a reason string, never thrown: the caller
// shows it in the status bar instead of failing silently.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const EXEC_TIMEOUT_MS = 3000;

/** Absolute paths to try after PATH: the editor may not inherit ~/.local/bin. */
function fallbackCandidates(name) {
  const home = os.homedir();
  const byName = {
    'herdr-app': [
      path.join(home, '.local', 'bin', 'herdr-app'),
      path.join(home, '.local', 'share', 'herdr-app', 'herdr-app'),
    ],
    hc: [path.join(home, '.local', 'bin', 'hc'), path.join(home, '.local', 'bin', 'herdr-core')],
  };
  return byName[name] || [];
}

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch (_) {
    return false;
  }
}

/** Resolve a binary: explicit setting/env, then PATH, then known locations. */
function findBin(name, explicit) {
  const candidates = [];
  if (explicit) candidates.push(explicit);
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) candidates.push(path.join(d, name));
  candidates.push(...fallbackCandidates(name));
  return candidates.find((c) => path.isAbsolute(c) && isExecutable(c)) || null;
}

function run(bin, args, options) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: EXEC_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, ...options }, (err, stdout) => {
      resolve(err ? { ok: false, out: '', err } : { ok: true, out: String(stdout).trim() });
    });
  });
}

async function liveFolder(space, hcBin) {
  if (!hcBin) return '';
  const tabs = space.tabs || [];
  const tab = tabs.find((t) => t.active) || tabs[0];
  const terminals = (tab && tab.terminals) || [];
  if (!terminals.length || !terminals[0].terminal) return '';
  const got = await run(hcBin, ['get', String(terminals[0].terminal)]);
  if (!got.ok) return '';
  let cwd = '';
  try {
    cwd = String(((JSON.parse(got.out).foreground || {}).cwd) || '').trim();
  } catch (_) {
    return '';
  }
  if (!cwd || !isDir(cwd)) return '';
  const root = await run('git', ['rev-parse', '--show-toplevel'], { cwd });
  return root.ok && root.out && isDir(root.out) ? root.out : cwd;
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch (_) {
    return false;
  }
}

/**
 * Read the selected space of Herdr desktop.
 * @param {{appBin?: string, hcBin?: string}} opts
 * @returns {Promise<{ok: true, id: string, path: string, name: string}
 *   | {ok: false, reason: 'no-bin'|'not-running'|'no-space'|'no-folder', detail: string}>}
 */
async function readFocusedSpace(opts = {}) {
  const appBin = findBin('herdr-app', opts.appBin || process.env.HERDR_APP_BIN);
  if (!appBin) {
    return { ok: false, reason: 'no-bin', detail: 'herdr-app no encontrado (ajuste herdrVscodeSync.appBin)' };
  }
  const ls = await run(appBin, ['ls']);
  if (!ls.ok) {
    return { ok: false, reason: 'not-running', detail: 'herdr-app ls falló: ' + (ls.err && ls.err.message) };
  }
  let doc;
  try {
    doc = JSON.parse(ls.out);
  } catch (_) {
    return { ok: false, reason: 'not-running', detail: 'herdr-app ls no devolvió JSON' };
  }
  const space = (doc.spaces || []).find((s) => s.active);
  if (!space) return { ok: false, reason: 'no-space', detail: 'ningún space activo' };

  const hcBin = findBin('hc', opts.hcBin || process.env.HC_BIN);
  const folder = (await liveFolder(space, hcBin)) || String(space.folder || '').trim();
  if (!folder) return { ok: false, reason: 'no-folder', detail: 'el space no tiene carpeta' };

  const name = String(space.name || '').trim();
  // The app labels an unnamed home space "~": use the folder name instead.
  const label = name && name !== '~' ? name : path.basename(path.normalize(folder));
  return { ok: true, id: String(space.id || ''), path: folder, name: label };
}

module.exports = { readFocusedSpace, findBin };
