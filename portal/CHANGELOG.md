# Changelog — Portal Explora

Versionado semántico: **MAYOR.MENOR.PARCHE**

- **PARCHE** (x.x.N): fixes, detalles, cambios menores
- **MENOR** (x.N.x): nuevas funciones, cambios medianos
- **MAYOR** (N.x.x): reescritura completa del portal, o una decisión de gran impacto

Cada versión, además de esta entrada, se marca con un tag de git con el
formato `Portal-vX.Y.Z` (por ejemplo `Portal-v1.0.1`).

Las versiones más nuevas van arriba.

---

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
