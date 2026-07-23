# TrackEx (explora-app)

App móvil de Explora S.A. para choferes — registra y transmite el
recorrido de cada viaje de reparto en tiempo real, incluso con la app en
segundo plano.

Ver también: [Changelog](./CHANGELOG.md) · [Procedimiento de cambios y releases](../Procedimiento.md)

---

## Stack

- **Expo SDK 56** (React Native 0.85, React 19)
- **Firebase**: Authentication + Firestore
- Ubicación en segundo plano: `expo-location` + `expo-task-manager`
- Notificaciones: `expo-notifications`
- Autenticación biométrica: `expo-local-authentication`

## Instalación

```bash
npm install
```

## Correr la app en desarrollo

```bash
npx expo start
```

Esto genera un código QR para abrir la app desde tu celular con **Expo Go**.

> **Importante:** Expo Go para SDK 56 **no está disponible en las tiendas
> oficiales** (App Store / Play Store). En Android se instala bajando el
> `.apk` directo desde el repositorio oficial de Expo
> ([expo/expo-go-releases](https://github.com/expo/expo-go-releases/releases)).
> En iOS requiere TestFlight o el comando `eas go`.

Si el celular y la computadora no están en la misma red (o el QR no
carga), usá el modo túnel:

```bash
npx expo start --tunnel
```

## Build y publicación (Google Play / App Store)

Los builds se generan con **EAS** (Expo Application Services), no
localmente. La configuración vive en `eas.json` y `app.json`:

- **Owner de Expo:** `explora-sa`
- **Slug:** `explora-app-54`
- **Package Android:** `com.explora.trackex`
- **Project ID de EAS:** `d9e00dba-515c-4683-b3ba-d708a3d43d94`
- El `versionCode` de Android lo gestiona EAS automáticamente
  (`appVersionSource: "remote"` en `eas.json`) — no se edita a mano.

```bash
npm install -g eas-cli
eas login
eas build --platform android --profile production
```

**Antes de generar un build, verificar siempre** que `eas project:info`
devuelva el owner/slug/projectId de arriba — evita el error de construir
sobre un proyecto de Expo incorrecto. El detalle completo del proceso de
release está en [`Procedimiento.md`](../Procedimiento.md).

## Versionado

Este proyecto usa versionado semántico (`App-vMAYOR.MENOR.PARCHE`),
independiente del `versionCode` de Android. El detalle de cada versión
está en [`CHANGELOG.md`](./CHANGELOG.md).
