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

## v1.0.3 - versionCode 7 - 18/08/2026
** Corrección permisos de ubicación en la aplicación

Se corrige la utilización de permisos de ubicacion otorgados por el usuario para, inicialmente pedir usar la ubicación en primer
plano y posteriormente utilizar la ubicación en segundo plano para trackear el viaje sin necesidad de que tenga la pantalla prendida

Asi como tambien se corrigen las notificaciones para que se muestre información util y no sea molesto al uso.

## v1.0.2 - versionCode 6 - 23/07/2026
** Filtro de precisión/velocidad GPS + recorrido completo en seguimiento**

Se programa un filtro para evitar saltos imposibles que impiden una lectura limpia del recorrido del chofer en el seguimiento
Estos cambios se perdieron anteriormente por recontrucción de las rama main

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

