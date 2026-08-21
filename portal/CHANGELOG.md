# Changelog — Portal Explora

Versionado semántico: **MAYOR.MENOR.PARCHE**

- **PARCHE** (x.x.N): fixes, detalles, cambios menores
- **MENOR** (x.N.x): nuevas funciones, cambios medianos
- **MAYOR** (N.x.x): reescritura completa del portal, o una decisión de gran impacto

Cada versión, además de esta entrada, se marca con un tag de git con el
formato `Portal-vX.Y.Z` (por ejemplo `Portal-v1.0.1`).

Las versiones más nuevas van arriba.

---

## v1.0.4 — 21/08/2026

**Entorno de prueba con datos reales.** Se agrega un tercer entorno al que
el portal puede apuntar: un proyecto de Firebase separado
(`entorno-prueba-explora`) con una copia de los datos de producción. Sirve
para probar cambios que tocan la base de datos sin riesgo, en particular la
migración del modelo de datos que viene.

- **Modificado**: `src/firebase.js` — dos configuraciones de proyecto
  (producción y prueba) y una variable de entorno que elige cuál. Nuevo
  export `ENTORNO`. Sin `.env.local`, el portal apunta a producción
  exactamente igual que antes de este cambio.
- **Modificado**: `src/App.js` — franja de aviso arriba de todo cuando el
  portal NO está apuntando a producción. En producción no se renderiza
  nada, así que el portal real queda idéntico.
- **Corregido**: `src/pages/Admin.js` tenía la configuración de Firebase
  hardcodeada apuntando a producción, para la instancia secundaria que usa
  al crear usuarios. Eso significaba que crear un usuario desde el entorno
  de prueba habría creado la cuenta de Auth en la base REAL, mientras el
  perfil se escribía en la de prueba. Ahora importa la configuración
  activa, así que la instancia secundaria siempre apunta al mismo proyecto
  que el resto del portal.
- **Corregido**: `src/pages/Login.js` descartaba el error original del
  login con Google y mostraba siempre el mismo mensaje genérico. Eso hacía
  imposible distinguir "Google rechazó el login" de "Firestore rechazó la
  lectura del perfil", que son problemas completamente distintos. Ahora el
  código de error se registra en la consola y se incluye en el mensaje.
- **Nuevo**: `scripts/copiar-a-staging.js` — copia las colecciones de
  producción al entorno de prueba conservando los IDs de documento
  (imprescindible: el ID de un documento de `usuarios_portal` ES el UID de
  Firebase Auth). Tiene modo simulación, recorre subcolecciones, y verifica
  el `project_id` de cada credencial antes de escribir, para que pasar las
  claves al revés no pueda escribir sobre producción.
- **Nuevo**: `ENTORNO_PRUEBA.md` — guía completa del entorno: cómo
  activarlo, cómo volver a producción, cómo refrescar los datos, y qué se
  copia y qué no.
- **Corregido**: `.gitignore` — la regla de `firestore-debug.log` estaba
  escrita en UTF-16 y Git no la interpretaba (se leía como caracteres
  sueltos separados por espacios). Se reescriben los tres `.gitignore` del
  repo en UTF-8 y se agregan reglas para las claves de cuentas de servicio
  y para la exportación de cuentas de Auth, que contiene hashes de
  contraseñas.

Las cuentas de Firebase Auth se importaron al entorno de prueba con sus
UIDs originales (`firebase auth:export` / `auth:import`), así que las
credenciales de acceso son las mismas que en producción.

Sin impacto en producción: sin `.env.local`, el comportamiento es idéntico
al de la versión anterior. Se verificó arrancando el portal sin el archivo
y confirmando que no aparece ninguna franja.

Pendiente conocido, sin resolver en esta versión: la app TrackEx sigue
apuntando siempre a producción — su configuración está hardcodeada en
`explora-app/src/config/firebase.js`. Y `Login.js` crea su propio
`GoogleAuthProvider` en vez de usar el que exporta `firebase.js`, así que
la restricción de dominio `hd: 'explora.com.ar'` está configurada pero
nunca se aplica.

---

## v1.0.3 — 20/08/2026

**Las reglas de Firestore pasan a versionarse en el repo.** Hasta esta
versión, las reglas de producción se editaban y publicaban a mano desde
la consola web de Firebase, y el repo tenía una copia informativa que
podía divergir sin que nadie se enterara. Además, la configuración del
CLI apuntaba a un proyecto que no existe (`explora-portal-dev`), así que
`firebase deploy` nunca había funcionado en este repo.

- **Renombrado**: `portal/firestore.rules` → `portal/firestore.rules.emulador`
  (queda como referencia histórica, ya no lo usa nadie).
- **Movido**: `firestore.rules.produccion` de la raíz del repo a `portal/`,
  donde vive `firebase.json` y donde el CLI resuelve las rutas.
- **Modificado**: `portal/firebase.json` — la clave `firestore.rules` ahora
  apunta a `firestore.rules.produccion`. Ningún archivo se llama
  `firestore.rules` a secas: si algo apunta mal, el deploy falla en vez de
  publicar reglas equivocadas.
- **Corregido**: `portal/.firebaserc` — el proyecto pasa de
  `explora-portal-dev` (inexistente) a `explora-portal` (el real).
- **Modificado**: encabezado de `firestore.rules.produccion` — documenta el
  procedimiento de publicación y las comprobaciones previas. Las reglas en
  sí no se modificaron.
- **Cambio de comportamiento local**: el emulador ahora usa las reglas de
  producción en vez de las permisivas. Lo que se prueba local es lo que
  corre en la realidad.

Las reglas publicadas no cambiaron: el primer deploy por CLI fue
deliberadamente idéntico a lo que ya estaba en producción, para validar el
mecanismo sin alterar comportamiento.

Pendiente conocido, sin resolver en esta versión: la regla de
`pedidos_portal` sigue permitiendo lectura y escritura a cualquier usuario
autenticado, incluidos los choferes sobre pedidos que no les corresponden.

---

## v1.0.2 — 18/08/2026

**El portal ahora refleja el estado del viaje del chofer.** Hasta esta
versión, `estado_chofer` (que escribe la app TrackEx) y `estado` (el ciclo
administrativo del portal) vivían desincronizados: un viaje entregado por
el chofer seguía figurando como "Nominado" para siempre, sin ninguna
pantalla que mostrara que ya se había completado.

- **Seguimiento**: filtros por transportista y chofer (selección múltiple,
  chofer en cascada según el transportista elegido) y por rango de fecha
  (Hoy / 7 días / Este mes), aplicados a las pestañas "En vivo" e
  "Historial". Corregido: los marcadores de inicio/fin del historial se
  acumulaban en el mapa sin límite; el historial no filtraba por
  transportista porque el campo no se copiaba al armar los registros.
- **Transportista**: insignia con el estado del viaje en cada despacho,
  filtro "Pendientes / En viaje / Entregados / Todos" (arranca en
  Pendientes, así los ya entregados no se acumulan en la lista), y
  horarios de inicio/fin en el detalle. Corregido: el mapa "Mis unidades"
  nunca mostraba nada porque faltaban los campos de posición GPS al armar
  los despachos.
- **Coordinador**: insignia de viaje en la tarjeta del pedido ("En ruta" /
  "Entregado") y en cada despacho individual, con el bloque de
  seguimiento (inicio, fin, motivo de demora si lo hay).
- **Admin**: nueva sección de viajes finalizados (colapsada por defecto),
  con duración del viaje y estado de la traza GPS. Corregido: el cierre
  manual de un viaje escribía `chofer_fin_ts` en formato local en vez de
  ISO 8601, lo que producía "Invalid Date" en el historial de
  Seguimiento — ahora escribe ISO, igual que la app.

Ningún cambio de esta versión modifica el modelo de datos ni ninguna
escritura existente: todo es lectura de campos que ya se guardaban.


## v1.0.1 — 23/07/2026

**Entorno de emulador local de Firestore.** Se agrega la configuración
necesaria para correr el portal contra una base de datos Firestore 100%
local (Firebase Local Emulator Suite), sin tocar producción.

- Nuevo: `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`
- Modificado: `src/firebase.js` — conexión al emulador condicionada a la
  variable `REACT_APP_USE_EMULATOR` (definida en `.env.local`, no se sube
  a git). Sin la variable, el portal se conecta a producción exactamente
  igual que antes de este cambio.
- Sin impacto en producción.

## v1.0.0 — 23/07/2026

Versión base — punto de partida a partir del cual se empieza a versionar
el portal de forma explícita.
