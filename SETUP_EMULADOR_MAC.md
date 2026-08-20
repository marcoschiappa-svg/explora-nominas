# Armá tu base de datos de prueba en tu Mac

Guía paso a paso para instalar el emulador local de Firebase — sin tocar nada de producción.

**Para qué sirve esto:** para instalar una copia de la base de datos que funciona igual que la real, pero que no toca nada de producción.

---

## Antes de arrancar

### ¿Cómo se usan los comandos de esta guía?

A lo largo de la guía vas a ver bloques como este:

```bash
brew --version
```

1. Seleccioná todo el texto del bloque
2. Copialo: `Cmd + C`
3. Pegalo en la terminal: `Cmd + V`
4. Apretá Enter

Después de apretar Enter, esperá a que la Terminal termine de trabajar antes de pegar el próximo comando.

### Cosas normales que NO son un error

A veces te va a pedir tu contraseña de Mac (la misma que usás para desbloquear la computadora). Es normal — escribila y apretá Enter, aunque no veas ni puntitos ni letras apareciendo mientras tipeás (es así a propósito, por seguridad).

A veces la Terminal se queda "pensando" en silencio varios segundos o minutos. Es normal, está descargando o instalando algo.

Vas a ver mucho texto en inglés aparecer de golpe. La mayoría es información técnica que no hace falta leer — en cada paso te aviso específicamente qué buscar para confirmar que salió bien.

---

## Paso 1 de 8 — Homebrew

**¿Qué es esto?** Homebrew es un programa que instala otros programas — pensalo como una "tienda de aplicaciones", pero se usa escribiendo comandos en vez de tocando botones. Lo vamos a necesitar para instalar las dos herramientas de los pasos siguientes.

**1.1 — Fijate si ya lo tenés:**

```bash
brew --version
```

Si aparece algo como `Homebrew 4.x.x` → ya está instalado, saltá directo al Paso 2.
Si aparece `command not found` (comando no encontrado) → seguí con el 1.2.

**1.2 — Instalarlo:**

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Tarda varios minutos. Te va a pedir tu contraseña de Mac en algún momento. Al final del todo, va a aparecer un mensaje con 2 líneas que empiezan con las palabras `echo` y `eval` — son 2 comandos más, distintos en cada computadora porque incluyen tu nombre de usuario. Copialos de **TU** pantalla (no de acá) y pegalos uno por uno, apretando Enter después de cada uno.

**1.3 — Cerrá la Terminal por completo y abrí una nueva:** cerrá la ventana entera (el botón rojo, arriba a la izquierda) y volvé a abrirla de cero (`Cmd+Espacio`, escribir Terminal, Enter).

**1.4 — Confirmá:**

```bash
brew --version
```

Ahora sí debería mostrarte un número.

---

## Paso 2 de 8 — Node.js

**¿Qué es esto?** Node es el programa que tu computadora necesita para poder "leer y correr" el código del portal.

```bash
brew install node
```

Tarda un par de minutos. Confirmá, con estos dos comandos (uno por vez):

```bash
node --version
```

```bash
npm --version
```

Los dos te tienen que devolver un número (por ejemplo `v22.14.0`).

---

## Paso 3 de 8 — Java, versión 21

La herramienta que simula la base de datos en tu computadora está construida con Java por dentro, y lo necesita instalado para poder arrancar. Tiene que ser específicamente **la versión 21 o más nueva**.

```bash
brew install --cask temurin@21
```

Puede volver a pedirte tu contraseña de Mac — normal, es para instalar el programa.

Confirmá:

```bash
java --version
```

En algún lado del texto que aparece tiene que decir `21` (por ejemplo `openjdk version "21.0.5"`).

---

## Paso 4 de 8 — Traer la última versión del proyecto

Nos aseguramos de que tengas la versión más actualizada del código. Necesitás pararte, con la Terminal, adentro de la carpeta del proyecto (la que se llama `explora-nominas`).

Si no te acordás la ruta exacta: escribí `cd` (con un espacio al final, sin apretar Enter todavía), después abrí esa carpeta con el Finder, y arrastrala desde el Finder directo arriba de la ventana de Terminal — Mac completa la ruta sola. Ahí sí, apretá Enter.

Una vez parado adentro de esa carpeta:

```bash
git checkout main
```

```bash
git fetch origin
```

```bash
git pull origin main
```

> **Importante:** el `git fetch origin` va **antes** del `pull` y es un comando aparte. Sin él, `git status` puede decirte que estás actualizado cuando en realidad no lo estás. Está explicado en `Procedimiento.md`.

---

## Paso 5 de 8 — Instalar lo que necesita el portal

Entrá a la carpeta `portal` (está adentro de `explora-nominas`):

```bash
cd portal
```

Ahora instalá todo lo que ese proyecto necesita para funcionar:

```bash
npm install
```

Tarda alrededor de un minuto y al final tira bastante texto con advertencias — es normal, no es un error, mientras no aparezca la palabra "error" en rojo. Si en cambio ves un mensaje sobre "dependencias en conflicto", corré este otro comando en su lugar:

```bash
npm install --legacy-peer-deps
```

---

## Paso 6 de 8 — Firebase y confirmar archivos

```bash
npm install -g firebase-tools
```

Confirmá que los archivos ya están ahí (no hace falta crear ninguno de estos, tienen que aparecer solos después del `git checkout` del Paso 4):

```bash
ls -la
```

Deberías ver en la lista:

- `firebase.json`
- `.firebaserc`
- `firestore.rules.produccion`
- `firestore.rules.emulador`
- `firestore.indexes.json`

y el archivo `src/firebase.js` ya con el cambio adentro (no hace falta que lo abras a revisar, pero si tenés curiosidad, podés hacerlo).

> **Sobre los dos archivos de reglas:** las "reglas" son las que deciden quién puede ver y modificar cada cosa en la base de datos.
>
> - `firestore.rules.produccion` → son las reglas **reales**. Es el que usa el emulador y el que se publica a producción.
> - `firestore.rules.emulador` → quedó solo como referencia histórica. **No lo usa nadie.**
>
> El emulador corre con las reglas reales a propósito: así, lo que probás en tu máquina es lo que va a pasar en producción. Si algo te da un error de permisos en el emulador, no es un problema de tu instalación — es que las reglas lo rechazan de verdad.

Ahora sí, tenés que crear vos en tu máquina el siguiente archivo (este **nunca** se comparte por git, cada uno tiene el suyo):

```bash
echo "REACT_APP_USE_EMULATOR=true" > .env.local
```

---

## Paso 7 de 8 — Prender la base de datos y el portal

Primero, la base de datos de prueba:

```bash
firebase emulators:start --only firestore,auth
```

La primera vez descarga un archivo grande — puede tardar varios minutos, es normal. Al terminar, aparece un recuadro que dice **"All emulators ready!"**. Eso significa que ya está funcionando.

**No cierres esta ventana.** Dejala abierta, corriendo, todo el tiempo que quieras usar el portal en modo de prueba.

Ahora abrí una ventana de Terminal **NUEVA** (`Cmd+Espacio`, Terminal, Enter — una ventana adicional, sin cerrar la anterior), entrá de nuevo a la carpeta `portal` (repetí el Paso 4 y el `cd portal` del Paso 5 si hace falta), y prendé el portal:

```bash
npm start
```

Se abre solo una pestaña del navegador con el portal, en una dirección que dice `localhost:3000`.

**Última confirmación:** con el portal abierto, apretá `Cmd + Option + I` para abrir las herramientas de desarrollador del navegador, andá a la pestaña "Console", y fijate si aparece este texto:

```
🔧 Conectado a los emuladores locales de Firebase
```

Si lo ves, ¡ya quedó todo funcionando!

La interfaz del emulador, para mirar los datos de prueba, queda en `http://127.0.0.1:4000`.

---

## Paso 8 de 8 — A implementar cambios nomás

Ya deberías tener todo listo para trabajar nuevas versiones en tu Mac.

Recordá seguir los pasos de [`Procedimiento.md`](../Procedimiento.md) para tener trazabilidad.

---

*Explora Nóminas — guía de configuración interna*
