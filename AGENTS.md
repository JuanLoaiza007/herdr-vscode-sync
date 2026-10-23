# AGENTS.md

## Contexto

Idea: puente Herdr → VS Code. Los workspaces de Herdr se reflejan en una sola ventana de VS Code (multi-root). Problema que resuelve: evitar una ventana de VS Code por proyecto cuando Herdr trabaja con varios workspaces.

Dirección: **solo Herdr → VS Code**. No existe sync inverso.

## Arquitectura

- `herdr-plugin/` — plugin de Herdr.
  - `herdr-plugin.toml` — manifest: `[[startup]]`, `[[actions]]`, `[[events]]`.
  - `bin/lib.sh` — rutas y configuración compartida (sourced).
  - `bin/collect.sh` — lee `herdr api snapshot`, escribe estado. Ejecutado por cada evento y por la acción `collect`.
  - `bin/render_folders.py` — transforma el snapshot: por workspace, cwd del primer pane = path de la carpeta; label del workspace = nombre. Excluye labels de `EXCLUDE_LABELS`. Escribe `folders.json` + el stub `herdr.code-workspace`.
  - `bin/startup.sh` — al arrancar el servidor: collect + abre VS Code sobre el stub si no está abierto.
- `vscode-extension/` — extensión VS Code (JS vanilla, sin build ni dependencias).
  - `extension.js` — descubre `folders.json` (env-based, sin rutas fijas), vigila con FileSystemWatcher, reconcilia con `workspace.updateWorkspaceFolders()`. Recuerda carpetas auto-añadidas en `globalState` para no borrar las manuales.
- `config/sync.env` — configuración editable. Defaults inline en `lib.sh` también.
- `README.md` — documento público (idea, instalación, configuración, avisos).

## Restricciones del repo

- **Cero rutas de usuario o de máquina versionadas.** Nada de `/home/<user>`, carpetas personales, ni rutas absolutas. Todo se resuelve en runtime: `$HERDR_PLUGIN_STATE_DIR`, `$HERDR_BIN_PATH`, `$HOME`, `%USERPROFILE%`, `$XDG_CONFIG_HOME`.
- Las rutas de estado las crea Herdr (`$HERDR_PLUGIN_STATE_DIR`) en el momento de correr; la extensión las descubre bajo el directorio de configuración de Herdr. Si se asume una ruta, debe derivarse del entorno.
- README.md y AGENTS.md contienen únicamente: idea de la app, problema que resuelve, y cómo instalar y configurar. Sin promesas de correctitud: el proyecto es experimental.

## Instalación para desarrollo en cualquier máquina

```sh
git clone <este-repo>
herdr plugin link <repo>/herdr-plugin
ln -s <repo>/vscode-extension ~/.vscode/extensions/herdr-vscode-sync
# recargar VS Code; luego:
herdr plugin action invoke local.herdr-vscode-sync.collect
```

## Probar cambios

- Regenerar estado a mano: `herdr plugin action invoke local.herdr-vscode-sync.collect` (escribe `$HERDR_PLUGIN_STATE_DIR/folders.json`; el log del plugin muestra el directorio real).
- Verificar el JSON: contener un objeto por workspace, sin los de `EXCLUDE_LABELS`.
- Forzar evento real: crear/renombrar/cerrar un workspace con `herdr workspace create --cwd ... --label ...` y comprobar que `folders.json` cambia.
- La reconcilación solo ocurre en una ventana abierta sobre `herdr.code-workspace` (la extensión no puede añadir carpetas sin `.code-workspace`).
