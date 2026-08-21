# Portal Explora

Portal web de gestión logística de Explora S.A. Centraliza pedidos,
coordinación de despachos, nominación de transportistas/choferes,
seguimiento de viajes en mapa, administración de usuarios, y el
tarifario de fletes.

Ver también: [Changelog](./CHANGELOG.md) · [Entorno de prueba](./ENTORNO_PRUEBA.md) · [Procedimiento de cambios y releases](../Procedimiento.md)

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
producción — ver la sección siguiente para trabajar contra otra base de
datos, sin riesgo de tocar datos reales.

---

## Los tres entornos

El portal puede hablar con tres bases de datos distintas:

| Entorno | Proyecto | Qué es |
|---|---|---|
| **Producción** | `explora-portal` | La base REAL. Datos de clientes, choferes y pedidos de verdad. |
| **Prueba** | `entorno-prueba-explora` | Copia de producción. Romper algo acá no afecta a nadie. |
| **Emulador** | `localhost` | Base local, en tu máquina. Se borra al cerrar el emulador. |

Cuál se usa lo decide el archivo `.env.local` de esta carpeta, que **no se
sube a git** (cada uno tiene el suyo):

| Contenido de `.env.local` | Entorno |
|---|---|
| El archivo no existe, o está vacío | **Producción** |
| `REACT_APP_ENV=staging` | **Prueba** |
| `REACT_APP_USE_EMULATOR=true` | **Emulador** |

Sin `.env.local` presente, el portal se conecta a producción exactamente
igual que siempre — ningún otro entorno se activa por accidente.

Cuando el portal **no** está en producción, muestra una franja de color
arriba de todo: marrón para el entorno de prueba, gris para el emulador.
**Si no ves ninguna franja, estás en la base real.**

> Las variables de entorno se leen **al arrancar**. Si cambiás `.env.local`
> con el portal ya corriendo, hay que cortarlo (`Ctrl+C`) y volver a
> arrancarlo. Recargar el navegador no alcanza.

### Entorno de prueba

`entorno-prueba-explora` es un proyecto de Firebase separado con una copia
de los datos de producción: los mismos usuarios, los mismos pedidos, los
mismos transportistas. Sirve para probar cambios que tocan la base de
datos.

```
REACT_APP_ENV=staging
```

El detalle completo —cómo refrescar los datos, qué colecciones se copian,
cómo conseguir las credenciales— está en
[`ENTORNO_PRUEBA.md`](./ENTORNO_PRUEBA.md).

### Emulador local de Firestore

El portal puede correr contra una copia 100% local de Firestore
(Firebase Local Emulator Suite), útil para probar cambios sin conexión y
sin necesitar acceso a ningún proyecto de Firebase.

Requiere Node.js, Java 21+ y el Firebase CLI (`npm install -g firebase-tools`).
Los archivos de configuración (`firebase.json`, `.firebaserc`,
`firestore.rules.produccion`, `firestore.indexes.json`) ya están en este repo.

**El emulador corre con las reglas reales de producción**
(`firestore.rules.produccion`), no con reglas permisivas. Esto es a
propósito: lo que se prueba local es lo que va a pasar en producción. Si
una operación falla con `permission-denied` en el emulador, no es un
problema del entorno — es que las reglas la rechazan de verdad.

El archivo `firestore.rules.emulador` queda en el repo solo como
referencia histórica de las reglas permisivas que se usaban antes. No lo
usa nadie.

```bash
firebase emulators:start --only firestore,auth
```

Con el emulador corriendo, creá `.env.local` en esta carpeta con:

```
REACT_APP_USE_EMULATOR=true
```

Y corré `npm start` en otra terminal. La consola del navegador va a
mostrar `🔧 Conectado a los emuladores locales de Firebase` cuando la
conexión sea correcta. La UI del emulador queda disponible en
`http://127.0.0.1:4000`.

Para configurar el emulador en una Mac desde cero, ver
[`../SETUP_EMULADOR_MAC.md`](../SETUP_EMULADOR_MAC.md).

---

## Reglas de seguridad de Firestore

Las reglas de producción viven en `firestore.rules.produccion` y se
publican desde el repo con `firebase deploy`, **no desde la consola web**.
El procedimiento completo, con sus comprobaciones previas, está en
[`../Procedimiento.md`](../Procedimiento.md), Paso 8.

## Build de producción

```bash
npm run build
```

Genera la carpeta `build/`, lista para desplegar.

## Versionado

Este proyecto usa versionado semántico (`Portal-vMAYOR.MENOR.PARCHE`).
El detalle de cada versión está en [`CHANGELOG.md`](./CHANGELOG.md).
