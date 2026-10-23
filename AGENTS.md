# AGENTS.md

## Contexto

Idea: puente Herdr → VS Code en modo follow. Una sola ventana de VS Code (ancla) sigue al workspace **enfocado** de Herdr. Problema que resuelve: nada de una ventana por proyecto ni de sincronizar multi-root (frágil); solo el workspace enfocado → carpeta abierta.

Dirección: **solo Herdr → VS Code**, **solo el workspace enfocado**. Nada más se sincroniza.

## Arquitectura

- `herdr-plugin/` — plugin de Herdr.
  - `herdr-plugin.toml` — manifest: `[[actions]]` (collect, open) y `[[events]]` (`workspace.focused`, `worktree.created/opened/removed`). Sin startup: estrictamente on-demand.
  - `bin/lib.sh` — rutas/config compartidas (sourced). Resuelve `$HERDR_PLUGIN_STATE_DIR` o fallback portable.
  - `bin/collect.sh` — snapshot vía `herdr api snapshot` → `bin/current.py`.
  - `bin/current.py` — encuentra el workspace enfocado (flag `focused`, fallback `focused_workspace_id`), path = cwd del primer pane. Escribe `current.json` (`{path, name}`) y `herdr.code-workspace` single-folder.
  - `bin/startup.sh` — collect + abre/enfoca VS Code sobre el ancla (`code <herdr.code-workspace>`) si ninguna ventana la tiene abierta.
- `vscode-extension/` — extensión VS Code (JS vanilla, sin build).
  - `extension.js` — descubre `current.json` (env-based), vigila con FileSystemWatcher, y en la ventana ancla aplica la carpeta: `updateWorkspaceFolders(0, n, {name, uri})`; si devuelve `false`, reescribe `herdr.code-workspace` y recarga la ventana. Serializado (nunca dos swaps solapados).
- `config/sync.env` — `CURRENT_FILE_NAME`, `WORKSPACE_FILE_NAME`. Defaults inline en `lib.sh`.
- `README.md` — documento público (idea, problema, instalación, configuración, avisos).

## Restricciones del repo

- **Cero rutas de usuario o de máquina versionadas.** Todo se resuelve en runtime: `$HERDR_PLUGIN_STATE_DIR`, `$HERDR_BIN_PATH`, `HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`.
- El estado vive en `$HERDR_PLUGIN_STATE_DIR` (bajo `$XDG_STATE_HOME/herdr/plugins/<id>` o equiva al de la plataforma). La extensión lo descubre recorriendo ambos árboles.
- README.md y AGENTS.md contienen únicamente: idea, problema resuelto, e instalación/configuración. Sin promesas de correctitud: experimental.
- Commits solo con archivos del propio repo.

## Cómo probar cambios

- Regenerar estado: `herdr plugin action invoke local.herdr-vscode-sync.collect` → verifica `$HERDR_PLUGIN_STATE_DIR/current.json` (debe contener el workspace enfocado actual).
- El ancla siempre es `herdr plugin action invoke local.herdr-vscode-sync.open` (abre/enfoca la ventana ancla). La extensión solo actúa en esa ventana.
- Simular cambio real de foco: con herdr enfocar otro workspace (`prefix+w` o `herdr workspace focus <id>`) → `current.json` cambia → la ventana ancla cambia de carpeta sin recarga manual.
- Fallback ante `updateWorkspaceFolders=false`: la extensión reescribe `herdr.code-workspace` y recarga la ventana (registrado en el canal *Output* → "Herdr VS Code Sync").
