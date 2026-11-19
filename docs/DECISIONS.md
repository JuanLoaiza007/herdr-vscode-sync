# Decisiones técnicas

Registro de por qué el puente con Herdr desktop es como es. Léelo antes de cambiar el diseño.

## D1 — El seguimiento vive en la extensión de VS Code, no en un servicio

**Contexto.** La primera versión usaba un servicio systemd (`watch-app.sh`, poll de `herdr-app ls` cada 1 s) que escribía `current.json`; la extensión vigilaba ese archivo.

**Problema.** El servicio arrancaba antes de que el entorno de usuario importara el `PATH` de la sesión. Con `PATH=/usr/local/bin:/usr/bin` no encontraba `herdr-app` (`~/.local/bin`), el bucle seguía vivo y no escribía nada, sin ningún error visible. `Ctrl+Shift+S` parecía funcionar porque corría con el `PATH` del usuario una sola vez.

**Decisión.** Eliminar el servicio y todo el relevo por archivo para la app. La extensión consulta `herdr-app ls` por sí misma (`vscode-extension/appSource.js`). Solo existe mientras exista la ventana ancla: no hay nada que iniciar, habilitar ni vigilar.

**Por qué.** Una sola pieza viva, ligada al ciclo de vida de VS Code. Si falla, lo dice en la barra de estado.

## D2 — Foco como ancla de fiabilidad, poll solo para inmediatez

La extensión sincroniza (a) al ganar foco la ventana, siempre; (b) cada `pollSeconds` (2 s por defecto). `herdr-app ls` + `hc get` tardan ~7 ms. Aunque el poll falle o se desactive (`pollSeconds: 0`), al mirar VS Code después de cambiar de space el seguimiento se corrige. El poll no es lo que garantiza la corrección.

El poll usa un `setTimeout` recursivo, no `setInterval`: una llamada lenta nunca se solapa consigo misma.

## D3 — `Ctrl+Shift+S` es "doctor + lanzador", sin estado

El mod (`app/herdr-app-mod/main.js`) en cada pulsación: comprueba `code`, instala la extensión si falta (symlink desde el repo del que el propio mod es symlink), siembra `herdr.code-workspace` si no existe, ejecuta `code <ancla>` y avisa con `notify()` solo si arregló o no pudo arreglar algo. Silencioso si todo estaba bien.

Descartado: mod persistente que empuje cambios (`spaces()` reactivo). Un mod vive solo mientras su bloque esté en el layout; el docking automático ocurre una vez y otro layout reinicia los mods. Un overlay `keep` como host oculto es frágil.

`exec()` de un mod usa el entorno real del usuario (HOME, PATH), así que el problema del `PATH` de D1 no existe ahí.

`code <ancla>` con el workspace ya abierto enfoca esa ventana (VS Code reutiliza la ventana). Ya no hace falta `pgrep`. En Wayland el compositor puede negar el robo de foco; la ventana igual queda sincronizada.

## D4 — Resolución robusta de binarios en la extensión

El editor puede no heredar `~/.local/bin`. Orden: ajuste (`herdrVscodeSync.appBin` / `hcBin`) → `$HERDR_APP_BIN` / `$HC_BIN` → `PATH` → `~/.local/bin` → `~/.local/share/herdr-app`. Sin `herdr-app`: estado "herdr-app no encontrado" en la barra y mensaje en el canal *Output*. `hc` es opcional: sin él se usa la carpeta registrada del space.

## D5 — Fuentes: archivo (TUI) y app, "gana el último cambio"

El plugin de la TUI sigue escribiendo `current.json`. La extensión admite ambas fuentes:
- Cambio en `current.json` → aplica el archivo.
- La app cambia de space (clave `id + carpeta` distinta) → aplica la app. El poll no pisa un cambio de la TUI mientras el space de la app no cambie.
- Foco de ventana: si la app responde, manda la app; si no, el archivo.

Si `herdr-app ls` falla porque la app está cerrada, no es un error: se calla y manda el archivo.

## D6 — Carpeta del space: cwd real de la shell, raíz git

La `folder` de un space queda fija al crearlo; se queda obsoleta tras un `cd`. Se usa `hc get <terminal>` → `foreground.cwd` de la pestaña activa, resuelto a la raíz git (`git rev-parse --show-toplevel`) para que un `cd` a subcarpeta no cambie el proyecto abierto. Si algo falla, cae a `folder`.

## D7 — Cosas que no cambian

- Solo Herdr → VS Code, solo el space enfocado, solo la ventana ancla.
- El mecanismo de intercambio (`updateWorkspaceFolders`, con reescritura del ancla y recarga como fallback) no se tocó.
- El plugin de la TUI (`herdr-plugin/`) no se tocó.

## Diagnóstico rápido

| Síntoma | Dónde mirar |
| --- | --- |
| No sigue al cambiar de space | Canal *Output* → "Herdr VS Code Sync"; texto de la barra de estado. |
| "herdr-app no encontrado" | Ajuste `herdrVscodeSync.appBin`. |
| Sigue con retraso | `herdrVscodeSync.pollSeconds`; el foco siempre corrige. |
| `Ctrl+Shift+S` no hace nada | `herdr-app status`; avisos del mod por `notify()`. |
| Extensión recién enlazada sin efecto | `Developer: Reload Window` en VS Code. |
