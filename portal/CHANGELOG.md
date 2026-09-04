### SEÑALIZACIÓN DE LA VERSIÓN ACTUAL - MANTENER ACTUALIZADO

VERSION_ACTUAL: 1.1.2

# Changelog — Portal Explora

Versionado semántico: **MAYOR.MENOR.PARCHE**

- **PARCHE** (x.x.N): fixes, detalles, cambios menores
- **MENOR** (x.N.x): nuevas funciones, cambios medianos
- **MAYOR** (N.x.x): reescritura completa del portal, o una decisión de gran impacto

Cada versión, además de esta entrada, se marca con un tag de git con el
formato `Portal-vX.Y.Z` (por ejemplo `Portal-v1.0.1`).

Las versiones más nuevas van arriba.

---
## v1.1.1 — 04-09-2026

**Parche de estabilización post-v1.1.0.** Cuatro correcciones puntuales
detectadas al probar el rediseño en producción: dos de comportamiento en
el modal de detalle de pedido, una del pie de página, y una de layout en
Seguimiento.

- **Corregido**: `Pedidos.js` — el aviso "Se llegó al volumen total de la
  orden" en `ModalDetallePedido` se mostraba apenas el pedido alcanzaba su
  volumen nominal, sin que el usuario hubiera hecho nada. Ahora solo
  aparece al clickear "+ Agregar entrega", que es el momento en que
  realmente es información accionable. El aviso equivalente dentro del
  formulario de carga (que sí corresponde ahí) no cambió.
- **Corregido**: `Pedidos.js` — el segmento ámbar de `BarraProgreso`
  (entregas programadas, no solo cumplidas) se ajusta para distinguirse
  mejor del fondo de la barra. El cálculo de `cubiertas`/`cumplidas` ya
  era correcto desde v1.1.0; el ajuste es solo de contraste visual.
- **Corregido**: `scripts/preparar-build.js` — el pie de página mostraba
  el hash corto del commit (`6a061a1`) en vez del tag de versión
  (`v1.1.0`) en el deploy de producción. La causa era que Vercel clona el
  repo con historia de Git limitada durante el build, y en ese contexto
  `git describe --tags` no siempre encuentra el tag. Se agrega un intento
  de traer los tags explícitamente antes de leer la versión, con
  fallback silencioso si el repo ya tiene el historial completo.
- **Corregido**: `App.js` — el contenedor de `Pagina` que envuelve todo
  el contenido no tenía `minHeight: 0`, lo que rompía la cadena de
  `flex: 1, minHeight: 0` que usan las pantallas con layout de alto
  completo (como el mapa de `Seguimiento.js`). El mapa quedaba con una
  altura recortada, dependiente de la cantidad de viajes activos en el
  panel lateral, en vez de ocupar el espacio disponible de la ventana.

Sin cambios en el modelo de datos ni en las reglas de Firestore. No
requiere migración ni redeploy de reglas — solo build y deploy del
portal.

## v1.1.0 — 02-09-2026

**El modelo de datos nuevo entra en producción, en convivencia con el viejo.**
Las seis colecciones de `MODELO_DATOS_TOBE.md` (`organizaciones`, `domicilios`,
`organizacion_domicilios`, `usuarios`, `productos`, `camiones`, y el árbol
`pedidos/entregas/despachos/viajes/gps_puntos`) se implementan y conviven con
`pedidos_portal`/`usuarios_portal` hasta que los pedidos viejos terminan su
ciclo. El comportamiento de cada acción sigue `COMPORTAMIENTO.md`.

- **Nuevo**: `sesion.js` — `cargarSesion()` lee los dos modelos de usuario (el
  perfil viejo de `usuarios_portal` y el nuevo de `usuarios`) y decide si
  puede entrar. `App.js` rutea las pantallas legacy por el campo `rol` de
  siempre y las nuevas por `tieneAlgunRol()` contra el array `perfil.roles`,
  con la misma lista de roles que su tile en `Home.js`.
- **Nuevo**: `estados.js`, `logica-pedidos.js`, `logica-despachos.js`,
  `logica-transportista.js`, `logica-viajes.js` — la lógica de negocio del
  modelo nuevo: transacciones, recálculo de estados en cascada
  (despacho → entrega → pedido), historial.
- **Nuevo**: pantallas — `Programacion.js` (reemplazo de `Coordinador.js`),
  `MisDespachos.js` (reemplazo de `Transportista.js`), `MisViajes.js`
  (reemplazo de `Chofer.js`), `Organizaciones.js`, `Usuarios.js`,
  `Productos.js`, `Camiones.js`, `Domicilios.js` (con sus modales
  `ModalOrganizacion.js` / `ModalDomicilio.js`), `HistorialPedido.js`,
  `BuscadorOrganizacion.js`.
- **Nuevo**: `PedidosLegacy.js` — los pedidos que quedaron en `pedidos_portal`,
  en solo lectura. `Coordinador.js`, `Transportista.js`, `Chofer.js` y
  `Admin.js` **no se tocaron**: siguen operativos, transicionalmente, hasta
  que se decida sacarlos del menú.
- **Nuevo**: sistema de diseño (Fase B1) — `ui/BarraSuperior.js` (header
  sticky unificado con logo, toggle de tema, cambio de contraseña migrado
  desde `Home.js`, logout), `ui/tokens.js`, `ui/TemaContext.js`
  (dark/light mode), y los componentes `Boton`, `Tabla`, `Campo`,
  `Buscador`, `Modal`, `Pastilla`, `Tarjeta`, `Pie`, `Vacio`. Color de marca
  único: `#C60000`.
- **Nuevo**: `camiones` separa tractor y acoplado como dos documentos con
  `tipo` (antes era un documento con `patente_tractor` + `patente_semi`).
  Migrado con `scripts/migrar-camiones-a-flota.js` (dry-run por defecto).
- **Nuevo**: la API del Portal (Apps Script de Marcos) **se versiona en el
  repo por primera vez**, en `portal/app-script/plan-produccion/`:
  - `Codigo.gs`: `doPost`/`doGet` unificados contra una sola tabla
    `ACCIONES` — antes tenían copias separadas que podían divergir (el bug
    de la hoja "Pedidos Portal" que nunca se creaba).
  - `BorrarDespacho.gs`: implementa `borrar_despacho`, la acción que
    `REORGANIZACION_REPO.md` marcaba como faltante.
  - `Adjuntos.gs`: subir/borrar adjuntos de Drive (`eliminar_adjunto` ya
    existía con otro nombre del que se pensaba).
  - `Notificaciones.gs`: todos los `enviarEmail*` en un solo archivo, sin
    cambios en la redacción.
  - `PlanDeProduccion.gs`, `MovVehiculos.gs`: escritura de las dos hojas de
    cálculo, separadas.
  - `RecordatorioFirestore.gs`: el recordatorio semanal pasa a leer
    Firestore real en vez de una hoja que nunca se llenaba.
- **Nuevo**: `scripts/verificar-contadores.js` — solo lectura, recuenta
  `entregas_total/cubiertas/cumplidas` de cada pedido contra sus entregas
  reales y lista diferencias.
- **Nuevo**: `scripts/preparar-build.js` + Paso 9 de `Procedimiento.md` — la
  versión del portal (pie de página) sale de `git describe --tags`, ya no
  se escribe a mano. Requiere taggear (`git tag vX.Y.Z && git push origin
  vX.Y.Z`) al cerrar cada versión.
- **Modificado**: `firestore.rules.produccion` y `firestore.indexes.json`
  para las colecciones nuevas.
- **Nueva dependencia**: `firebase-admin` (dev), para los scripts de
  migración y verificación.

Pendiente conocido, sin resolver en esta versión:
- `Coordinador.js`, `Transportista.js`, `Chofer.js` y `Admin.js` quedan
  transicionalmente sin cambios; se retiran cuando termine la migración.
- `portal/src/TemaContext.js` quedó duplicado de `ui/TemaContext.js`, sin
  usarse en ningún lado. Limpieza pendiente.
- Comentarios en el código referencian `PENDIENTES.md`, un documento
  transitorio que no se sube al repo. Falta sacar esas referencias o
  definir un sistema de gestión documental.
- `subirAdjunto()` comparte los archivos de Drive como "cualquiera con el
  link": `visible_transportista` es una bandera de UI, no una protección
  real.

## v1.0.5 — Rediseño del modelo de datos (documentación)

Se descarta el enfoque de dual-write y migración incremental. El modelo nuevo
se construye al lado del actual y los pedidos vivos terminan su ciclo donde
están.

- Nuevos: MODELO_DATOS.md (as-is), RELEVAMIENTO_PEDIDOS_PORTAL.md,
  MODELO_DATOS_TOBE.md, COMPORTAMIENTO.md
- Se retiran MODELO_DATOS_v2.md, PLAN_FASE_1.md y PLAN_MIGRACION.md
- mapa-normalizacion.js: los IDs derivados del nombre se reemplazan por
  clave_normalizada como campo de deduplicación
- Sin cambios en el código que corre.


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
