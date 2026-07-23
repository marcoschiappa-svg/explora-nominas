# Portal Explora

Portal web de gestión logística de Explora S.A. Centraliza pedidos,
coordinación de despachos, nominación de transportistas/choferes,
seguimiento de viajes en mapa, administración de usuarios, y el
tarifario de fletes.

Ver también: [Changelog](./CHANGELOG.md) · [Procedimiento de cambios y releases](../Procedimiento.md)

---

## Stack

- **React** 19 (Create React App)
- **Firebase**: Authentication (Google, restringido al dominio `explora.com.ar`) + Firestore
- Roles de usuario: `admin`, `coordinador`, `comercial`, `transportista`, `chofer`

## Módulos

| Módulo | Archivo | Para qué es |
|---|---|---|
| Login | `src/pages/Login.js` | Inicio de sesión con Google |
| Home | `src/pages/Home.js` | Landing según rol |
| Pedidos | `src/pages/Pedidos.js` | Carga y seguimiento de pedidos comerciales |
| Coordinador | `src/pages/Coordinador.js` | Cronograma de entregas, asignación de transporte, mapa de unidades |
| Transportista | `src/pages/Transportista.js` | Nominación de choferes/unidades por parte del transportista |
| Chofer | `src/pages/Chofer.js` | Vista del chofer para su viaje asignado |
| Seguimiento | `src/pages/Seguimiento.js` | Mapa en vivo del recorrido de cada viaje |
| Admin | `src/pages/Admin.js` | Gestión de usuarios, import/export de choferes |
| Tarifario | `src/Tarifario.js` | Consulta, edición y aprobación de tarifas de flete |

## Instalación

```bash
npm install
npm start
```

Abre `http://localhost:3000`. Por defecto se conecta a Firebase de
producción — ver la sección siguiente para trabajar contra una base de
datos local, sin riesgo de tocar datos reales.

## Desarrollo local con el emulador de Firestore

El portal puede correr contra una copia 100% local de Firestore
(Firebase Local Emulator Suite), útil para probar cambios sin afectar
producción y sin necesitar acceso al proyecto real de Firebase.

Requiere Node.js, Java 21+ y el Firebase CLI (`npm install -g firebase-tools`).
Los archivos de configuración (`firebase.json`, `.firebaserc`,
`firestore.rules`, `firestore.indexes.json`) ya están en este repo.

```bash
firebase emulators:start --only firestore,auth
```

Con el emulador corriendo, creá un archivo `.env.local` (no se sube a
git) en esta carpeta con:

```
REACT_APP_USE_EMULATOR=true
```

Y corré `npm start` en otra terminal. La consola del navegador va a
mostrar `🔧 Conectado a los emuladores locales de Firebase` cuando la
conexión sea correcta. La UI del emulador queda disponible en
`http://127.0.0.1:4000`.

Sin `.env.local` presente, el portal se conecta a producción exactamente
igual que siempre — el modo emulador nunca se activa por accidente.

## Build de producción

```bash
npm run build
```

Genera la carpeta `build/`, lista para desplegar.

## Versionado

Este proyecto usa versionado semántico (`Portal-vMAYOR.MENOR.PARCHE`).
El detalle de cada versión está en [`CHANGELOG.md`](./CHANGELOG.md).
