# Explora Nóminas

Repositorio de **Explora S.A.** — Complejo Industrial Puerto General San Martín.

Contiene **tres proyectos** relacionados con la logística de transporte de la planta:

| Proyecto | Dónde vive | Qué es | Quién lo usa |
| --- | --- | --- | --- |
| **Portal Explora** | [`portal/`](./portal/) | Portal web de gestión logística | Admin, coordinador, comercial, transportista |
| **TrackEx** | [`explora-app/`](./explora-app/) | App móvil de viajes y seguimiento GPS | Choferes |
| **Formulario de Nóminas** | raíz (`index.html`, `app.js`, `Code.gs`) | Formulario web de nominación de camiones | Transportistas externos |

El portal y la app comparten la misma base de datos: **Firebase** (Firestore + Authentication), proyecto `explora-portal`. El formulario de nóminas es independiente: escribe en una planilla de Google Sheets.

---

## 🧭 Quiero hacer...

| Si tenés que... | Andá a |
| --- | --- |
| **Cambiar algo del portal o de la app** | [`Procedimiento.md`](./Procedimiento.md) — pasos 1 a 4 |
| **Publicar una versión nueva de la app en Google Play** | [`Procedimiento.md`](./Procedimiento.md) — pasos 5 a 7 |
| **Cambiar los permisos de la base de datos** | [`Procedimiento.md`](./Procedimiento.md) — paso 8 |
| **Probar un cambio sin tocar datos reales** | [`portal/ENTORNO_PRUEBA.md`](./portal/ENTORNO_PRUEBA.md) |
| **Configurar el emulador local en una Mac** | [`SETUP_EMULADOR_MAC.md`](./SETUP_EMULADOR_MAC.md) |
| **Saber qué cambió en cada versión del portal** | [`portal/CHANGELOG.md`](./portal/CHANGELOG.md) |
| **Saber qué cambió en cada versión de la app** | [`explora-app/CHANGELOG.md`](./explora-app/CHANGELOG.md) |
| **Entender la estructura del portal** | [`portal/README.md`](./portal/README.md) |
| **Entender la estructura de la app** | [`explora-app/README.md`](./explora-app/README.md) |
| **Trabajar en la app con ayuda de una IA** | [`explora-app/AGENTS.md`](./explora-app/AGENTS.md) |

---

## ⚠️ Las cinco reglas que no se saltean

Cada una está acá porque **ya causó un problema real** en este proyecto.

### 1. Antes de empezar: traer la versión actualizada

```bash
git checkout main
git fetch origin
git status
git pull origin main
```

El `git fetch origin` va **antes** del `status` y es un comando aparte. Sin él, `git status` puede decirte "estás actualizado" cuando en realidad estás días atrás.

### 2. Después de mergear un Pull Request, actualizar tu copia

Cuando apretás "Merge pull request" en GitHub, el commit de fusión se crea **en los servidores de GitHub**, no en tu computadora. Si no hacés `pull`, la próxima rama que crees va a nacer de un `main` viejo.

```bash
git checkout main
git pull origin main
```

### 3. Nunca commitear directo a `main`

Todo cambio va en una rama aparte y entra por Pull Request. El formato del nombre está en [`Procedimiento.md`](./Procedimiento.md).

### 4. Antes de generar un build de la app: verificar la identidad del proyecto

| Dato | Valor correcto |
| --- | --- |
| Owner EAS | `explora-sa` |
| Slug | `explora-app-54` |
| Package Android | `com.explora.trackex` |
| Project ID EAS | `d9e00dba-515c-4683-b3ba-d708a3d43d94` |
| Expo SDK | 56 |

`eas project:info` tiene que devolver exactamente esos valores. Si alguno no coincide, **parar**. Ya se subió una vez un build con el package equivocado.

### 5. Si el portal no muestra ninguna franja de color arriba, estás en la base REAL

El portal puede apuntar a tres bases de datos distintas. Cuando **no** está en producción, muestra una franja de aviso arriba de todo. Sin franja = datos reales de clientes y choferes.

Detalle en [`portal/ENTORNO_PRUEBA.md`](./portal/ENTORNO_PRUEBA.md).

---

## 🔀 Cómo se conectan portal y app

Las dos escriben en la misma colección de Firestore: **`pedidos_portal`**.

```
El comercial carga un pedido             → portal
El coordinador programa las entregas     → portal
El transportista acepta y nomina chofer  → portal
El chofer inicia el viaje                → app TrackEx
La app registra el recorrido GPS         → app TrackEx
El coordinador sigue el viaje en el mapa → portal
```

El estado del viaje que escribe la app (`estado_chofer`) y el estado administrativo del portal (`estado`) son **campos distintos** y hoy no se sincronizan automáticamente. Es una de las cosas que la migración del modelo de datos va a resolver.

---

## 🧰 Entornos de base de datos

| Entorno | Proyecto Firebase | Para qué |
| --- | --- | --- |
| Producción | `explora-portal` | Lo real |
| Prueba | `entorno-prueba-explora` | Copia de producción, para probar sin riesgo |
| Emulador | `localhost` | Base local en tu máquina |

El portal puede apuntar a los tres, según `portal/.env.local`. **La app TrackEx siempre apunta a producción.**

---

## 📋 Formulario de Nóminas

Formulario web para nominación de camiones. El transportista lo completa, los datos se escriben en una planilla de Google Sheets y se notifica por email a operaciones.

Proyecto simple, sin build ni dependencias de npm — solo HTML y JavaScript plano, desplegado como sitio estático en Vercel.

| Archivo | Qué hace |
| --- | --- |
| `index.html` | Formulario visible para el transportista |
| `app.js` | Validación, envío por EmailJS, escritura en Google Sheets |
| `Code.gs` | Script de Google que recibe los datos y escribe en el sheet |

### Flujo

```
Transportista completa el formulario
        ↓
app.js valida los campos obligatorios
        ↓
   ┌──────────────────────────────┐
   │ EmailJS      → email a Explora│
   │ Apps Script  → fila en el sheet│
   └──────────────────────────────┘
        ↓
Explora aprueba o rechaza desde el email
        ↓
Patente habilitada
```

### Configuración — Google Apps Script

1. Abrir el sheet en Google Sheets
2. Menú: **Extensiones → Apps Script**
3. Pegar el contenido de `Code.gs`
4. Guardar
5. **Implementar → Nueva implementación**
6. Tipo: **Aplicación web**
7. Ejecutar como: **Yo** · Quién tiene acceso: **Cualquiera**
8. **Implementar** → copiar la URL
9. En `app.js`, reemplazar `TU_APPS_SCRIPT_URL_AQUI` por esa URL

### Configuración — Template de EmailJS

En emailjs.com → **Email Templates** → template `template_xu84i2v`:

- **To email:** `{{to_email}}`
- **Subject:** `Nueva nómina — {{cliente}} · {{fecha_carga}}`
- **Cuerpo:** los campos `{{cliente}}`, `{{tipo_op}}`, `{{orden}}`, `{{producto}}`, `{{fecha_carga}}`, `{{patente}}`, `{{acoplado}}`, `{{empresa}}`, `{{cuit}}`, `{{dni}}`, `{{chofer}}`, `{{exportacion}}`, `{{destino}}`, `{{direccion}}`, `{{localidad}}`, `{{provincia}}`, `{{cp}}`

---

## 🗺️ Mapa del repositorio

```
explora-nominas/
│
├── README.md                    ← este archivo
├── Procedimiento.md             ← CÓMO SE HACEN LOS CAMBIOS (lectura obligatoria)
├── SETUP_EMULADOR_MAC.md        ← instalar el emulador local en Mac
│
├── index.html / app.js / Code.gs    ← Formulario de Nóminas
│
├── portal/                      ← Portal web (React)
│   ├── README.md                ← estructura, módulos, cómo correrlo
│   ├── CHANGELOG.md             ← qué cambió en cada versión
│   ├── ENTORNO_PRUEBA.md        ← cómo probar sin tocar datos reales
│   ├── firestore.rules.produccion   ← permisos REALES de la base de datos
│   ├── firestore.rules.emulador     ← referencia histórica, no se usa
│   ├── firebase.json / .firebaserc  ← configuración del Firebase CLI
│   ├── scripts/
│   │   └── copiar-a-staging.js  ← copia datos de producción al entorno de prueba
│   └── src/
│       ├── firebase.js          ← conexión: elige producción / prueba / emulador
│       ├── App.js               ← ruteo por rol + franja de entorno
│       └── pages/               ← una pantalla por módulo
│
└── explora-app/                 ← App móvil TrackEx (React Native / Expo SDK 56)
    ├── README.md
    ├── CHANGELOG.md
    ├── AGENTS.md                ← estándares de código y trampas conocidas
    ├── app.json                 ← identidad del proyecto (verificar antes de buildear)
    └── src/
        ├── config/firebase.js   ← conexión (SIEMPRE apunta a producción)
        └── screens/             ← Login y pantalla del chofer
```

---

## 🚧 Pendiente de relevar

Cosas detectadas y **todavía no resueltas**. Están acá para que no se pierdan.

| Tema | Qué se sabe |
| --- | --- |
| **Apps Script del Plan de Producción** | El portal (`Coordinador.js`) llama a un Apps Script con payloads del tipo `accion: 'asignar_transportista'`. Ese script **no está en este repositorio** — vive solo en Google. Si se rompe o se borra, no hay copia. Es el mismo problema que tenían las reglas de Firestore antes de la v1.0.3. |
| **Dos Google Sheets distintos** | El `Code.gs` de la raíz y el de `explora-nominas/` apuntan a planillas diferentes (misma pestaña `Mov Vehículos Carga y Desc`). Falta determinar cuál está en uso. |
| **Carpeta `explora-nominas/`** | Copia anterior del formulario de nóminas (archivos más chicos, incluye el `logo.png` que falta en la raíz). Candidata a archivar, pero antes hay que confirmar que nada la referencia. |
| **Vercel** | Nunca se relevó. Falta saber cuántos proyectos hay, cuál sirve el portal y cuál el formulario, y qué carpeta raíz tiene configurada cada uno. Esto condiciona cualquier reorganización de archivos. |
| **`nominas.explora.com.ar`** | No carga. Falta determinar si el dominio nunca se configuró o si algo se rompió. |
| **Archivos sueltos en la raíz** | `.DS_Store` (de macOS) y `explora-nominas (1).zip` están commiteados y no deberían. |
| **`logo.png`** | Está en `explora-nominas/` pero no en la raíz. Si `index.html` lo referencia, el formulario muestra una imagen rota. |
| **Reglas de `pedidos_portal`** | Cualquier usuario autenticado puede leer y escribir cualquier pedido, incluidos los choferes sobre pedidos que no les corresponden. |

---

## ❓ Preguntas frecuentes

**Vengo de otra máquina y no sé por dónde empezar.**
Leé [`Procedimiento.md`](./Procedimiento.md) entero una vez. Son 15 minutos y evita la mayoría de los problemas.

**Quiero probar algo pero me da miedo romper producción.**
Para eso está el entorno de prueba: [`portal/ENTORNO_PRUEBA.md`](./portal/ENTORNO_PRUEBA.md). Tiene una copia de los datos reales y romper algo ahí no afecta a nadie.

**Algo no funciona y no entiendo por qué.**
Antes de investigar el código, verificá la regla 1: puede que estés mirando una versión vieja del repositorio.

---

*Explora S.A. — repositorio interno*
