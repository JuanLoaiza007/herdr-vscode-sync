# herdr-vscode-sync

## Idea

Un puente entre [Herdr](https://herdr.dev) y Visual Studio Code: los workspaces de Herdr se reflejan **en una sola ventana** VS Code, como carpetas de un workspace multi-root.

- Un plugin de Herdr escucha los eventos del servidor (`workspace.created`, `renamed`, `moved`, `closed`, `worktree.*`) y escribe la lista actual de proyectos en un archivo de estado (`folders.json`).
- Una extensión de VS Code vigila ese archivo y reconcilia la ventana: añade, renombra y quita carpetas en vivo vía `workspace.updateWorkspaceFolders()`.

## Problema que resuelve

Herdr organiza el trabajo en workspaces (normalmente un proyecto por workspace). La integración habitual abre una ventana de VS Code por proyecto: con varios proyectos activos eso son muchas ventanas.

Esto mantiene **un** workspace VS Code (archivo `.code-workspace`) abierto y sincronizado con todos los workspaces de Herdr. Cierras, creas o renombras un workspace en Herdr y la misma ventana de VS Code se actualiza sola. Nada de guardar workspaces de VS Code a mano ni decidir dónde viven: el estado lo gestiona el plugin en el directorio que Herdr asigna para el plugin.

## Requisitos

- Linux o macOS (los scripts usan `bash` y `python3`; en Windows requeriría Git Bash/WSL/`python`).
- Herdr 0.7.0 o posterior en `PATH`.
- VS Code con el binario `code` en `PATH` (para que el plugin pueda abrir la ventana).

## Instalación

### 1. Plugin de Herdr

```sh
herdr plugin link <ruta-a-este-repo>/herdr-plugin
herdr plugin list   # verificar que aparece local.herdr-vscode-sync
```

### 2. Extensión de VS Code

Opción A — enlace simbólico (cambios del repo se ven al recargar la ventana):

```sh
ln -s <ruta-a-este-repo>/vscode-extension ~/.vscode/extensions/herdr-vscode-sync
```

Opción B — copia:

```sh
cp -r <ruta-a-este-repo>/vscode-extension ~/.vscode/extensions/herdr-vscode-sync
```

Recarga VS Code (Command Palette → *Developer: Reload Window*) y abre el workspace:

```sh
# la primera vez, o cuando quieras abrir la ventana sincronizada:
herdr plugin action invoke local.herdr-vscode-sync.collect
code <directorio-de-estado-del-plugin>/herdr.code-workspace
```

El directorio de estado del plugin es el que Herdr inyecta (`$HERDR_PLUGIN_STATE_DIR`, típicamente `~/.local/state/herdr/plugins/local.herdr-vscode-sync`, o el equivalente del sistema). No necesitas recordarlo: el plugin lo crea solo y la extensión lo descubre.

Si la extensión no encuentra el archivo de estado, fija la ruta en los ajustes de VS Code:

```json
"herdrVscodeSync.foldersFile": "/ruta/absoluta/a/folders.json"
```

## Configuración

Toda la configuración vive en `config/sync.env` (con defaults inline):

| Variable | Default | Efecto |
| --- | --- | --- |
| `EXCLUDE_LABELS` | `desktop,escritorio` | Workspaces cuyo label coincida (substring, sin distinguir mayúsculas) NO se reflejan. Útil para pseudo-workspaces como un "Desktop". |
| `STATE_FILE_NAME` | `folders.json` | Nombre del archivo de lista de carpetas que vigila la extensión. |
| `WORKSPACE_FILE_NAME` | `herdr.code-workspace` | Nombre del stub de workspace que abre VS Code. |

## Cómo funciona el flujo

1. Herdr emite un evento de workspace (crear/renombrar/mover/cerrar, o worktree).
2. `collect.sh` lee un snapshot de sesión vía CLI (`herdr api snapshot`) y reescribe `folders.json`, tomando por cada workspace el cwd de su primer pane. Filtra labels de `EXCLUDE_LABELS`.
3. El mismo render escribe el workspace `herdr.code-workspace` **con las carpetas ya pobladas**: abrir la ventana vía `code herdr.code-workspace` muestra los proyectos al instante, sin depender de la extensión.
4. La extensión detecta cambios en `folders.json`, difiere contra las carpetas actuales y aplica solo lo que cambió (vía `updateWorkspaceFolders`; si VS Code lo rechaza en vivo, reescribe el workspace file y recarga la ventana).

Carpetas que añadiste a mano en VS Code se conservan; la extensión solo gestiona las que ella añadió (las recuerda en `globalState`).

## Alcance y avisos

- **Experimental — sin garantía de funcionamiento.** Prueba antes de confiar en workflows críticos.
- Sincronización **solo Herdr → VS Code**. Cerrar una carpeta en VS Code no cierra el workspace de Herdr.
- La ventana sincronizada debe estar abierta sobre `herdr.code-workspace` para que la extensión aplique cambios.
- Si Herdr no está corriendo, no hay eventos; la lista se actualiza al arrancar el servidor.
