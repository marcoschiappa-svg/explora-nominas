# Changelog — TrackEx (explora-app)

Versionado semántico: **MAYOR.MENOR.PARCHE**

- **PARCHE** (x.x.N): fixes, detalles, cambios menores
- **MENOR** (x.N.x): nuevas funciones, cambios medianos
- **MAYOR** (N.x.x): reescritura completa de la app, o una decisión de gran impacto

Además del versionado semántico, cada entrada indica el `versionCode` de
Android correspondiente cuando aplica — es el número que gestiona EAS
automáticamente para Google Play, y es un dato distinto que conviene
seguir viendo junto al semántico.

---
## v1.0.1 — versionCode 4 — 23/07/2026

**Configuración de Android y EAS para Play Store.** Reconstrucción de
`app.json` (paquete, permisos, plugin de ubicación) y creación de
`eas.json`. Resuelve los errores de bundle inválido en Google Play
Console.

- Nuevo: `eas.json`
- Modificado: `app.json`, `package.json`

## v1.0.0 — 23/07/2026

Versión base — punto de partida a partir del cual se empieza a versionar
la app de forma explícita.

