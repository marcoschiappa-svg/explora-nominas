# Changelog — Portal Explora

Versionado semántico: **MAYOR.MENOR.PARCHE**

- **PARCHE** (x.x.N): fixes, detalles, cambios menores
- **MENOR** (x.N.x): nuevas funciones, cambios medianos
- **MAYOR** (N.x.x): reescritura completa del portal, o una decisión de gran impacto

Cada versión, además de esta entrada, se marca con un tag de git con el
formato `Portal-vX.Y.Z` (por ejemplo `Portal-v1.0.1`).

Las versiones más nuevas van arriba.

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
