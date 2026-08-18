# AGENTS.md — Instrucciones para asistentes de IA que trabajen en este repo

Este archivo aplica a `explora-app/` (TrackEx). El proceso de cambios y releases
está en [`../Procedimiento.md`](../Procedimiento.md) y es de lectura obligatoria
antes de cualquier build.

---

## 1. Expo cambió — leer la doc versionada

**Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/
before writing any code.**

Este proyecto usa **Expo SDK 56**. Las APIs de Expo cambian entre versiones y el
conocimiento previo de un modelo suele estar desactualizado. Antes de escribir
código que toque un módulo de Expo, hay que leer la página versionada de ese
módulo — no la de `latest`, no la de una versión anterior.

Se puede acceder a la versión Markdown de cualquier página agregando `.md` a la
URL. Por ejemplo:
`https://docs.expo.dev/versions/v56.0.0/sdk/location.md`

**Esto no es una formalidad.** Ejemplo real: la doc de `expo-location` para SDK
56 dice explícitamente que en Android los permisos de primer plano deben
concederse *antes* de pedir los de segundo plano. El código no lo hacía, y el
seguimiento GPS de los viajes nunca registró un solo punto. El defecto estuvo
activo semanas.

---

## 2. Documentación del código — obligatoria y completa

Todo código que se escriba o modifique en este repo tiene que quedar documentado
**por completo**, no solo en las partes que se tocaron. El objetivo es
trazabilidad: que dentro de seis meses cualquiera pueda abrir un archivo y
entender qué hace, por qué está hecho así, y qué problema resolvía.

### 2.1 Cabecera de archivo

Todo archivo de código lleva un bloque de cabecera con:

- **Propósito** — qué resuelve el archivo, en dos o tres oraciones.
- **Modelo de datos** — si lee o escribe en Firestore, listar los campos con su
  tipo y significado. Incluir los que escribe *otro* módulo si son relevantes
  para entenderlo.
- **Arquitectura / decisiones de diseño** — cómo está estructurado y por qué. Si
  hay varias piezas que podrían parecer redundantes, explicar por qué no lo son.
- **Historial de correcciones** — cuando un archivo se modifica para arreglar un
  defecto que costó diagnosticar, dejar registrada la causa raíz. No el síntoma:
  la causa.
- **Dependencias y entorno** — versiones relevantes, y condiciones especiales
  para probar (por ejemplo: "el GPS en background no corre en Expo Go").

### 2.2 Funciones

Bloque JSDoc en toda función, con `@param`, `@returns` y una descripción que
explique el **porqué**, no solo el qué. El "qué" ya se lee en el código; lo que
se pierde con el tiempo es el motivo.

Mal:
```js
/** Pide el permiso de notificaciones. */
```

Bien:
```js
/**
 * Solicita POST_NOTIFICATIONS en Android 13+ (API 33).
 *
 * Android exige que un foreground service muestre una notificación persistente;
 * sin este permiso la notificación no se muestra, el chofer no tiene señal
 * visible de que lo están rastreando, y varios fabricantes matan servicios sin
 * notificación visible por gestión agresiva de batería.
 *
 * @returns {Promise<boolean>} True si está concedido o si la plataforma no lo exige.
 */
```

### 2.3 Constantes

Toda constante numérica lleva el razonamiento del valor. Un número sin
justificación es un número que nadie se va a animar a cambiar después.

```js
/**
 * Cadencia de captura GPS. Con 60s/100m, un camión a 80 km/h (~1,3 km por
 * minuto) generaba un punto cada kilómetro y medio: más un boceto que un
 * recorrido. El costo extra en escrituras lo absorbe el buffer por lotes.
 */
const GPS_INTERVALO_MS = 30000;
```

### 2.4 Efectos, JSX y estilos

- Cada `useEffect` numerado y explicado, incluyendo **por qué** tiene esas
  dependencias. Si se omite una dependencia a propósito, decirlo.
- Bloques de JSX comentados por sección.
- Estilos agrupados por sección, con la paleta institucional identificada.

### 2.5 Marcar los pendientes donde viven

Si se detecta un defecto que no se arregla en ese momento, dejar el comentario
**en el lugar exacto del código**, no solo en un documento aparte. Ejemplo:

```js
// PENDIENTE: `paddingTop: 60` es un valor fijo. Debe reemplazarse por
// useSafeAreaInsets() como parte del arreglo de edge-to-edge para Android 15/16.
```

### 2.6 Idioma

Documentación en **español**. Nombres de variables y funciones en español,
siguiendo la convención que ya usa el repo (`cambiarEstado`, `viajeActivo`,
`descargarBuffer`). No mezclar.

---

## 3. Orden de trabajo

**Entender el problema → plantear la solución → recién ahí escribir código.**

No empezar a codear hasta que el planteo esté explícitamente validado. Un
diagnóstico apurado produce parches sobre síntomas, y este proyecto ya tuvo
varios casos donde el síntoma reportado no era el problema real.

---

## 4. Leer el repositorio antes de responder

Nunca responder sobre el estado del código de memoria ni por inferencia. Leer el
archivo real.

Motivo concreto: hubo un incidente en el que `app.json` en el repo era un stub
desactualizado (sin package name, sin permisos, sin el plugin de `expo-location`)
mientras los builds se generaban desde una copia local nunca commiteada. Cualquier
respuesta basada en "lo que debería estar" habría sido incorrecta.

---

## 5. Entregar archivos completos

Nada de fragmentos con `...` ni de "el resto queda igual". Los archivos se
entregan enteros, listos para reemplazar. Un fragmento mal integrado es una de
las formas más fáciles de meter un bug silencioso en producción.

---

## 6. Trampas conocidas de este repo

| Tema | Qué tener en cuenta |
| --- | --- |
| **Contexto JS de background** | Android puede ejecutar una tarea de `expo-task-manager` en un contexto donde React nunca se montó. Toda variable global o de módulo llega vacía. Lo que tenga que sobrevivir va a `AsyncStorage`. |
| **Permisos de Android** | Son escalonados: foreground → notificaciones → background. En Android 11+ el pedido de background abre Ajustes en vez de un diálogo, así que hay que explicar antes. |
| **Permisos "pegajosos"** | Tras dos denegaciones el sistema deja de preguntar. Entre pruebas hay que desinstalar la app o limpiar permisos, o se mide contra un estado sucio. |
| **Expo Go** | El GPS en segundo plano **no funciona** en Expo Go. Para probarlo hace falta un development build de EAS. |
| **Errores silenciosos** | Prohibido un `catch` que descarte `err.code`. En release no hay consola: si el código no se expone o no se registra en `app_logs`, el error es invisible. |
| **Array `despachos`** | Firestore no permite actualizar un elemento de array por índice, así que toda escritura reescribe el array completo. Es last-write-wins entre portal, app y tarea GPS. Minimizar la frecuencia de escritura. |
| **Límite de 1 MB por documento** | Los campos `gps_track_{i}` acumulan puntos dentro del documento del pedido. Vigilar el crecimiento. |
| **Timestamps mezclados** | Conviven ISO 8601 y `toLocaleString('es-AR')` en 12h **sin AM/PM** (ambiguo y no ordenable). Todo lo nuevo va en ISO 8601. |
| **`git status` sin `git fetch`** | No es confiable. Correr `git fetch origin` primero. |
| **CRLF/LF en Windows** | Genera diffs espurios. `git reset --hard origin/main` es el reset confiable. |
| **Reglas de Firestore** | Las de producción **no están versionadas**: viven solo en la consola. El `portal/firestore.rules` del repo es del emulador y no debe desplegarse nunca. |

---

## 7. Antes de cualquier build

Verificar los datos de identidad contra [`../Procedimiento.md`](../Procedimiento.md):

| Dato | Valor correcto |
| --- | --- |
| Owner EAS | `explora-sa` |
| Slug | `explora-app-54` |
| Package Android | `com.explora.trackex` |
| Project ID EAS | `d9e00dba-515c-4683-b3ba-d708a3d43d94` |
| Expo SDK | 56 |
| versionCode | Lo gestiona EAS (`appVersionSource: remote`) — no editar a mano |

`eas project:info` tiene que devolver esos valores. Si no coinciden, **parar** y
resolverlo antes de continuar.
