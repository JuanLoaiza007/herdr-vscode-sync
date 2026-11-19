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
  - `herdr-app-mod/` — mod de Herdr desktop (overlay invisible, `mod.open:herdr-vscode-sync`). "Doctor + lanzador" sin estado: valida `code`, instala la extensión si falta (symlink desde el repo, del que el mod es symlink), siembra `herdr.code-workspace`, ejecuta `code <ancla>` y avisa con `notify()` solo si arregló o falló algo. No sigue nada: eso lo hace la extensión. Se instala enlazado en `~/.config/herdr-app/mods/`. No hay servicio ni scripts de puente.
- `vscode-extension/` — extensión VS Code (JS vanilla, sin build).
  - `appSource.js` — fuente Herdr desktop: `herdr-app ls` (space `active`) + `hc get` (cwd vivo) + `git rev-parse` (raíz). Resuelve binarios (ajuste → env → PATH → `~/.local/bin`). Devuelve razón de fallo, no lanza.
  - `extension.js` — descubre `current.json` (estado canónico primero; fallback a rutas viejas de Herdr), vigila con FileSystemWatcher, sigue además la app (poll `pollSeconds` + foco de ventana; solo en la ventana ancla) y en la ventana ancla aplica la carpeta: `updateWorkspaceFolders(0, n, {name, uri})`; si devuelve `false`, reescribe `herdr.code-workspace` y recarga la ventana. Serializado (nunca dos swaps solapados).
- `config/sync.env` — `CURRENT_FILE_NAME`, `WORKSPACE_FILE_NAME`. Defaults inline en `lib.sh`.
- `README.md` — documento público (idea, problema, instalación, configuración, avisos).

## Restricciones del repo

- **Cero rutas de usuario o de máquina versionadas.** Todo se resuelve en runtime: `$HERDR_VSCODE_SYNC_STATE_DIR`, `$HERDR_BIN_PATH`, `$HERDR_APP_BIN`, `$HC_BIN`, `HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`.
- El estado vive en `$XDG_STATE_HOME/herdr-vscode-sync` (o `$HERDR_VSCODE_SYNC_STATE_DIR`). No se usa el directorio por-plugin de Herdr: la app no lo alcanza. La extensión busca ese archivo primero y mantiene el descubrimiento antiguo como fallback.
- README.md y AGENTS.md contienen únicamente: idea, problema resuelto, e instalación/configuración. Sin promesas de correctitud: experimental.
- Commits solo con archivos del propio repo.

## Cómo probar cambios

- Regenerar estado TUI: `herdr plugin action invoke local.herdr-vscode-sync.collect` → verifica `~/.local/state/herdr-vscode-sync/current.json` (debe contener el workspace enfocado actual).
- App: sin estado intermedio. Probar `node -e "require('./vscode-extension/appSource').readFocusedSpace().then(console.log)"` → space activo y carpeta.
- El ancla siempre es `herdr plugin action invoke local.herdr-vscode-sync.open` (abre/enfoca la ventana ancla). La extensión solo actúa en esa ventana.
- Simular cambio real de foco: con herdr enfocar otro workspace (`prefix+w` o `herdr workspace focus <id>`) → `current.json` cambia → la ventana ancla cambia de carpeta sin recarga manual.
- App: cambiar de space → la ventana ancla lo sigue (poll o al enfocarla). Si TUI y app están abiertos, gana el último cambio.
- Atajo app: `herdr-app do mod.open --name herdr-vscode-sync` debe abrir/enfocar el ancla y no dejar overlays ni errores en `herdr-app status`. Validar el mod sin tocar la app: `herdr-app check app/herdr-app-mod`.
- Fallback ante `updateWorkspaceFolders=false`: la extensión reescribe `herdr.code-workspace` y recarga la ventana (registrado en el canal *Output* → "Herdr VS Code Sync").

## Decisiones

Por qué el diseño es así (servicio eliminado, foco como ancla, doctor en el mod): `docs/DECISIONS.md`. Léelo antes de cambiar el seguimiento de la app.
