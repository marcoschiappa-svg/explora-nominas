# Procedimiento para hacer cambios y publicar nuevas versiones — TrackEx y Portal Explora

Este documento explica, paso a paso, cómo se debe trabajar cada vez que alguien quiere modificar la app TrackEx (la aplicación de los choferes) o el portal web de Explora, y cómo se publica una nueva versión.

**No hace falta saber programar para seguir este documento.** Está escrito para que cualquiera de la empresa pueda entender qué se está haciendo y por qué.

**Idea principal:** en varios pasos de este proceso hay una casilla que dice **"Antes de seguir, comprobar que..."**. Si esa comprobación no se cumple, **hay que parar** y arreglarlo antes de continuar. La mayoría de los problemas que tuvimos hasta ahora pasaron porque alguien saltó uno de estos pasos sin darse cuenta.

---

## Datos importantes del proyecto (no se cambian nunca)

Estos son como el "documento de identidad" de la aplicación. Sirven para comprobar, más adelante, que estamos trabajando sobre la app correcta y no sobre una copia equivocada.

| Dato | Valor correcto |
| --- | --- |
| Repositorio | `explora-nominas` |
| Carpeta de la app móvil | `explora-app/` |
| Carpeta del portal | `portal/` |
| Cuenta/organización EAS | `explora-sa` |
| Slug EAS | `explora-app-54` |
| Project ID EAS | `d9e00dba-515c-4683-b3ba-d708a3d43d94` |
| Package Android | `com.explora.trackex` |
| Nombre público | TrackEx |
| Expo SDK | 56 |
| versionCode | Lo gestiona EAS automáticamente (`appVersionSource: remote`) |

---

## Paso 1 — Empezar siempre desde la versión más actualizada

Antes de tocar cualquier cosa, la persona que va a hacer el cambio tiene que asegurarse de estar trabajando sobre la copia más reciente de todo el proyecto. Esto es como asegurarse de estar editando la última versión de un documento compartido, y no una copia vieja guardada en la computadora desde hace semanas.

La persona que va a hacer el cambio debe:

1. Traer a su computadora la versión más nueva del proyecto guardado en GitHub (el sistema donde se guarda todo el código de la empresa, con el historial completo de cambios).

Si **ya tenés** el repo clonado:
```bash
cd <ruta-donde-tengas>/explora-nominas
git checkout main
git pull origin main
```

Si **no lo tenés** (o no estás seguro de dónde quedó):
```bash
git clone <URL-del-repo> explora-nominas
cd explora-nominas
```

2. Comprobar que no quedó ningún cambio anterior sin guardar, de él mismo o de otra persona.

```bash
git status
git log -1 --oneline
```
- `git status` tiene que decir que estás en `main` y "up to date" / sin cambios pendientes raros.


**Antes de seguir, comprobar que:** la persona confirma que tiene la versión más reciente y que no hay cambios sueltos de antes sin guardar. Si hay dudas, hay que resolverlas antes de avanzar — no seguir "por las dudas".

---

## Paso 2 — Hacer el cambio en un espacio separado (una "rama")

Los cambios nunca se hacen directamente sobre la versión oficial de la app. Se trabaja en una copia de trabajo separada (rama), que es como sacar una fotocopia del documento para corregirla, sin tocar el original hasta que la corrección esté lista y revisada.

La persona:
1. Crea esa copia de trabajo con un nombre que describa el cambio (por ejemplo, "arreglo del GPS cuando el camión está detenido").

Nunca se trabaja directo sobre `main`. Una rama por cambio:
```bash
git checkout -b <tipo>/<descripcion-corta>
# ejemplos:
#   git checkout -b fix/gps-chofer-quieto
#   git checkout -b feat/reporte-demoras
```

2. Instala las herramientas necesarias en su computadora para poder probar la app

### Instalar dependencias si es un cambio en la app
La carpeta `node_modules/` no está en el repo, hay que generarla:
```bash
cd explora-app
npm install
```

3. Programa el cambio.

4. Prueba que el cambio funcione antes de avanzar.

---

## Paso 3 — Comprobación de seguridad antes de guardar el cambio

Este es el paso más importante de todo el documento, porque es el que evitó (y hubiera evitado antes) el problema más grave que tuvimos: generar una versión de la app que en realidad era "otra app" distinta, sin que nadie se diera cuenta hasta que ya era tarde.

Antes de guardar el cambio definitivamente, la persona tiene que abrir un archivo de configuración interno de la app (llamado `app.json`) y comprobar que ahí figuren, exactos, estos datos:
```json
{
  "expo": {
    "name": "TrackEx",
    "slug": "explora-app-54",
    "owner": "explora-sa",
    "android": {
      "package": "com.explora.trackex"
    },
    "extra": {
      "eas": {
        "projectId": "d9e00dba-515c-4683-b3ba-d708a3d43d94"
      }
    }
  }
}
```

**Si alguno de estos datos es distinto hay que parar inmediatamente**. Eso significa que se está trabajando sobre una copia vieja o incorrecta del proyecto, y hay que volver al Paso 1 antes de seguir. 

---

## Paso 4 — Guardar el cambio y pedir revisión

1. Se guarda el cambio en su copia de trabajo (esto se llama "hacer un commit": es como guardar una versión con un comentario explicando qué se cambió y por qué).

```bash
git add .
git commit -m "<descripción clara de qué cambió y por qué>"
git push origin <nombre-de-tu-rama>
```

2. Sube esa copia de trabajo a GitHub.

3. Ahí se abre lo que se llama un "Pull Request" (una solicitud para incorporar el cambio a la versión oficial). En esa solicitud se debe escribir en palabras simples **qué se cambió y por qué** — esto sirve como registro histórico de todos los cambios que se hicieron a la app con el tiempo.

4. Otra persona del equipo revisa el cambio antes de aprobarlo.

5. Una vez aprobado, el cambio se incorpora a la versión oficial del proyecto.

Una vez aprobado y mergeado el PR:
```bash
git checkout main
git pull origin main
git log -1 --oneline
```

**Antes de seguir, comprobar que:** el cambio fue aprobado e incorporado a la versión oficial (no alcanza con que esté guardado en la copia de trabajo de una sola persona).

---

## Paso 5 — Generar el nuevo archivo para publicar en las tiendas (Google Play)

Este paso genera el archivo instalable de la nueva versión de la app ".aab", que es lo que finalmente se sube a Google Play.

**Este paso se hace siempre desde la versión oficial ya actualizada** (la del Paso 4), nunca desde la copia de trabajo de una sola persona ni desde una versión vieja.

1. Se conecta al sistema de construcción de la app (Expo/EAS) y comprueba a qué proyecto está conectada.

```bash
cd explora-app
npm install          # por si cambiaron dependencias
eas whoami
eas project:info
```
- `eas project:info` tiene que devolver: `fullName @explora-sa/explora-app-54` y el ID `d9e00dba-515c-4683-b3ba-d708a3d43d94`.

**Antes de seguir, comprobar que:** el sistema confirma que el proyecto es `explora-sa/explora-app-54` con el identificador `d9e00dba-515c-4683-b3ba-d708a3d43d94`.

**Si el sistema muestra un error de permisos, o muestra un proyecto distinto, o pregunta si se quiere "crear un proyecto nuevo" → hay que parar inmediatamente** y consultar antes de seguir. Aceptar "crear un proyecto nuevo" en este punto es exactamente el error que generó la app equivocada la vez anterior.

2. Se genera el archivo nuevo (el ".aab").

```bash
eas build --platform android --profile production
```
- EAS incrementa el `versionCode` solo (por `appVersionSource: remote`). **Mirá el número que anuncia**: tiene que ser mayor al de la última versión publicada.
- Al terminar, EAS da un link de descarga del `.aab` (también queda en el dashboard: expo.dev → explora-sa → explora-app-54 → Builds).

3. El sistema le asigna automáticamente un número de versión más alto que el anterior — no hace falta que nadie lo calcule a mano.

4. Al terminar, se descarga el archivo generado.

---

## Paso 6 — Subir la nueva versión a Google Play

1. Entrar a Google Play Console (el panel de administración de la app en Google).

2. Ir a la sección de la app TrackEx, dentro de "Prueba y publicación" → la versión de prueba correspondiente.

3. Subir el archivo `.aab` generado en el Paso 5.

4. Escribir las "novedades de esta versión": un resumen breve y en palabras simples de qué cambió, pensado para que lo lea cualquier usuario (no hace falta explicar detalles técnicos acá — el detalle técnico ya quedó documentado en el Paso 4, en el Pull Request).

   *Ejemplo de cómo redactar esto:* "Mejoras en el seguimiento de ubicación: se corrigió un problema que afectaba el registro de la posición cuando el camión permanecía detenido."

5. Revisar que la pantalla de confirmación no muestre ningún error. Si aparece algún mensaje sobre permisos o declaraciones pendientes, hay que resolverlo antes de continuar (esto ya pasó antes con los permisos de ubicación, y tiene solución conocida).

6. Enviar la versión a revisión.

**Antes de seguir, comprobar que:** no quedó ningún error pendiente en la pantalla de confirmación antes de enviar.

## Paso 7 - Documentar qué cambió

Play Console permite registrar los cambios de cada versión, y es lo que responde tu pregunta de "cómo dejar documentado qué se cambió".

### Dónde se cargan
Al crear la versión (Parte D5), hay una sección **"Novedades de esta versión" / "Release notes"**. Ahí se escribe, por cada idioma configurado (al menos español), un resumen breve de los cambios de cara al usuario.

### Cómo escribirlas
- Son visibles para los testers/usuarios, así que se redactan en lenguaje simple, no técnico.
- Ejemplo para el fix del GPS:
  > Mejoras en el seguimiento de ubicación: se corrigió un problema que afectaba el registro de la posición cuando el vehículo permanecía detenido.
- El detalle técnico completo (qué archivos, qué lógica) **no va acá** — ese queda en el historial de Git y en la descripción del Pull Request (Parte C2). Entre el PR y las release notes queda todo trazado: el "qué y por qué" técnico en el repo, el "qué cambió para el usuario" en Play.

### Recomendación adicional
Mantener en el repo un archivo `CHANGELOG.md` con una línea por versión (versionCode + fecha + resumen). Así queda un registro central e histórico que no depende de entrar a Play Console a mirar.
---

## Resumen rápido (para tener a mano)

1. Traer la versión más actualizada del proyecto.
2. Hacer el cambio en una copia de trabajo separada.
3. **Comprobar los 4 datos de identidad de la app antes de continuar.**
4. Guardar, subir y pedir revisión del cambio.
5. Generar el archivo nuevo **comprobando primero que el proyecto conectado es el correcto.**
6. Subir el archivo a Google Play, escribir las novedades, y enviar a revisión.
7. Documentar cambios

Cualquier paso marcado como "comprobar antes de seguir" que no se cumpla es motivo suficiente para frenar y pedir ayuda, en vez de continuar asumiendo que "seguramente está bien".

---

## Pendiente para más adelante

Este documento cubre por ahora solo la publicación en Google Play (Android). Cuando se empiece a publicar también en la tienda de Apple (iPhone), habrá que agregar una sección equivalente con sus propios pasos y comprobaciones.
