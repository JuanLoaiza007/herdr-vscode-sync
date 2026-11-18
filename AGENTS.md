# AGENTS.md

## Contexto

Idea: puente Herdr → VS Code en modo follow. Una sola ventana de VS Code (ancla) sigue al workspace **enfocado** de Herdr. Problema que resuelve: nada de una ventana por proyecto ni de sincronizar multi-root (frágil); solo el workspace enfocado → carpeta abierta.

Dirección: **solo Herdr → VS Code**, **solo el workspace enfocado**. Nada más se sincroniza.

## Arquitectura

- `herdr-plugin/` — plugin de Herdr TUI.
  - `herdr-plugin.toml` — manifest: `[[actions]]` (collect, open) y `[[events]]` (`workspace.focused`, `worktree.created/opened/removed`). Sin startup: estrictamente on-demand.
  - `bin/lib.sh` — rutas/config compartidas (sourced). Estado canónico en `$HERDR_VSCODE_SYNC_STATE_DIR` o `$XDG_STATE_HOME/herdr-vscode-sync`.
  - `bin/collect.sh` — snapshot vía `herdr api snapshot` → `bin/current.py`.
  - `bin/current.py` — encuentra el workspace enfocado (flag `focused`, fallback `focused_workspace_id`), path = cwd del primer pane. Escribe `current.json` (`{path, name}`) y `herdr.code-workspace` single-folder, atómicamente. Acepta `SNAPSHOT_FILE`.
  - `bin/startup.sh` — collect + abre/enfoca VS Code sobre el ancla (`code <herdr.code-workspace>`) si ninguna ventana la tiene abierta.
- `app/` — puente para Herdr desktop.
  - `snapshot-from-app.py` — `herdr-app ls` → snapshot con la forma que espera `current.py`; `--key` para detectar cambios. La carpeta es el cwd real de la shell de la pestaña activa (`hc get` → `foreground.cwd`, resuelto a raíz git); si falla, usa el `folder` registrado del space.
  - `collect-app.sh` — escribe `snapshot-app.json` y llama al mismo `current.py`.
  - `watch-app.sh` — poll 1 s; escribe solo cuando cambia el space seleccionado en la app.
  - `open-app.sh` — collect de la app + abre/enfoca el ancla; no debe usar `startup.sh`, que lee la TUI.
  - `herdr-vscode-sync-app.service` — unit systemd user para el watcher.
  - `herdr-app-mod/` — mod de Herdr desktop. Overlay invisible; `mod.open:herdr-vscode-sync` ejecuta `~/.local/bin/herdr-vscode-sync-open` (symlink a `open-app.sh`). Se instala enlazado en `~/.config/herdr-app/mods/`.
- `vscode-extension/` — extensión VS Code (JS vanilla, sin build).
  - `extension.js` — descubre `current.json` (estado canónico primero; fallback a rutas viejas de Herdr), vigila con FileSystemWatcher, y en la ventana ancla aplica la carpeta: `updateWorkspaceFolders(0, n, {name, uri})`; si devuelve `false`, reescribe `herdr.code-workspace` y recarga la ventana. Serializado (nunca dos swaps solapados).
- `config/sync.env` — `CURRENT_FILE_NAME`, `WORKSPACE_FILE_NAME`. Defaults inline en `lib.sh`.
- `README.md` — documento público (idea, problema, instalación, configuración, avisos).

## Restricciones del repo

- **Cero rutas de usuario o de máquina versionadas.** Todo se resuelve en runtime: `$HERDR_VSCODE_SYNC_STATE_DIR`, `$HERDR_BIN_PATH`, `$HERDR_APP_BIN`, `$HC_BIN`, `HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`.
- El estado vive en `$XDG_STATE_HOME/herdr-vscode-sync` (o `$HERDR_VSCODE_SYNC_STATE_DIR`). No se usa el directorio por-plugin de Herdr: la app no lo alcanza. La extensión busca ese archivo primero y mantiene el descubrimiento antiguo como fallback.
- README.md y AGENTS.md contienen únicamente: idea, problema resuelto, e instalación/configuración. Sin promesas de correctitud: experimental.
- Commits solo con archivos del propio repo.

## Cómo probar cambios

- Regenerar estado TUI: `herdr plugin action invoke local.herdr-vscode-sync.collect` → verifica `~/.local/state/herdr-vscode-sync/current.json` (debe contener el workspace enfocado actual).
- Regenerar estado app: `app/collect-app.sh` → mismo `current.json`, con la carpeta del space activo de `herdr-app ls`.
- El ancla siempre es `herdr plugin action invoke local.herdr-vscode-sync.open` (abre/enfoca la ventana ancla). La extensión solo actúa en esa ventana.
- Simular cambio real de foco: con herdr enfocar otro workspace (`prefix+w` o `herdr workspace focus <id>`) → `current.json` cambia → la ventana ancla cambia de carpeta sin recarga manual.
- App: cambiar de space → `watch-app.sh` reescribe `current.json`. Si TUI y app están abiertos, gana el último cambio; la app no reescribe mientras su space no cambie.
- Atajo app: `herdr-app do mod.open --name herdr-vscode-sync` debe actualizar `current.json`, abrir/enfocar el ancla y no dejar overlays ni errores en `herdr-app status`.
- Fallback ante `updateWorkspaceFolders=false`: la extensión reescribe `herdr.code-workspace` y recarga la ventana (registrado en el canal *Output* → "Herdr VS Code Sync").
