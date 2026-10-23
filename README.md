# herdr-vscode-sync

## Idea

Un puente entre [Herdr](https://herdr.dev) y Visual Studio Code, en modo *follow*: **una** ventana de VS Code que sigue al workspace enfocado de Herdr.

- Un plugin de Herdr escribe, en cada cambio de foco (`workspace.focused`, `worktree.*`), el workspace actual en un archivo de estado (`current.json`).
- Una extensión de VS Code vigila ese archivo y cambia la carpeta de la ventana ancla (`herdr.code-workspace`) al workspace que Herdr tiene enfocado.

## Problema que resuelve

Con varios proyectos activos, abrir una ventana de VS Code por workspace es demasiadas ventanas; sincronizar todos los workspaces en un multi-root resultó frágil (la API de carpetas de VS Code falla en silencio y en paralelo).

Este enfoque es el mínimo viable: lo único que se sincroniza es **el workspace enfocado de Herdr → la carpeta abierta en VS Code**. Cambias de workspace en Herdr y la misma ventana lo sigue. `Ctrl+B s` abre (o enfoca) esa ventana ancla.

## Requisitos

- Linux o macOS (scripts usan `bash` y `python3`; en Windows requeriría Git Bash/WSL).
- Herdr 0.7.0 o posterior en `PATH`.
- VS Code con el binario `code` en `PATH`.

## Instalación

### 1. Plugin de Herdr

```sh
herdr plugin link <ruta-a-este-repo>/herdr-plugin
```

### 2. Extensión de VS Code

```sh
ln -s <ruta-a-este-repo>/vscode-extension ~/.vscode/extensions/herdr-vscode-sync
```

Recarga VS Code (Command Palette → *Developer: Reload Window*).

### 3. Añadir el atajo (opcional) — `~/.config/herdr/config.toml`

```toml
[[keys.command]]
key = "prefix+s"
type = "plugin_action"
command = "local.herdr-vscode-sync.open"
description = "open VS Code on current workspace"
```

Recarga config de Herdr (`prefix+r`). Listo: `Ctrl+B s` abre o enfoca la ventana ancla sobre el workspace actual.

## Configuración

En `config/sync.env` (con defaults inline en `bin/lib.sh`):

| Variable | Default | Efecto |
| --- | --- | --- |
| `CURRENT_FILE_NAME` | `current.json` | Archivo de estado que la extensión vigila. |
| `WORKSPACE_FILE_NAME` | `herdr.code-workspace` | Archivo single-folder de la ventana ancla. |

Si la extensión no encuentra el estado, fija la ruta en ajustes de VS Code:

```json
"herdrVscodeSync.currentFile": "/ruta/absoluta/a/current.json"
```

## Cómo funciona el flujo

1. Herdr enfoca un workspace (o un worktree aterriza/cambia) → evento → `collect.sh` lee un snapshot vía CLI y escribe `current.json` (`{path, name}` del workspace enfocado) y `herdr.code-workspace` con esa carpeta.
2. La extensión (solo en la ventana ancla) detecta el cambio y aplica la carpeta del nuevo workspace en la misma ventana (`updateWorkspaceFolders`); si VS Code la rechaza, reescribe el archivo ancla y recarga la ventana.
3. `Ctrl+B s` = `startup.sh`: actualiza estado y abre/enfoca la ventana ancla.

## Alcance y avisos

- **Experimental — sin garantía de funcionamiento.** Prueba antes de confiar en flujos críticos.
- Sincronización **solo Herdr → VS Code** y **solo el workspace enfocado**. Nada más.
- La extensión participa únicamente en la ventana ancla (`herdr.code-workspace`). Otras ventanas de VS Code no se tocan.
- Cambiar de workspace cierra las pestañas del anterior en esa ventana (es un cambio de carpeta, no de pestañas).
