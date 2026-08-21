# Entorno de prueba

Guía para trabajar contra una copia de la base de datos real, sin riesgo de tocar producción.

---

## Para qué sirve

`entorno-prueba-explora` es un proyecto de Firebase separado que tiene **una copia de los datos de producción**: los mismos usuarios, los mismos pedidos, los mismos transportistas. Se puede romper todo lo que haga falta — no afecta a nadie.

Sirve para probar cambios que tocan la base de datos: migraciones, cambios de estructura, o cualquier cosa donde un error en producción sería caro de revertir.

---

## Los tres entornos

El portal puede hablar con tres bases de datos distintas:

| Entorno | Proyecto | Qué es |
| --- | --- | --- |
| **Producción** | `explora-portal` | La base REAL. Datos de clientes, choferes y pedidos de verdad. |
| **Prueba** | `entorno-prueba-explora` | Copia de producción. Romper algo acá no afecta a nadie. |
| **Emulador** | `localhost` | Base local, en tu máquina. Se borra al cerrar el emulador. |

Cuál se usa lo decide el archivo `portal/.env.local`, que **no se sube a git** (cada uno tiene el suyo):

| Contenido de `.env.local` | Entorno |
| --- | --- |
| El archivo no existe, o está vacío | **Producción** |
| `REACT_APP_ENV=staging` | **Prueba** |
| `REACT_APP_USE_EMULATOR=true` | **Emulador** |

> **Si no hay ninguna variable, el portal apunta a PRODUCCIÓN.** Es a propósito: en el servidor donde vive el portal real no hay ningún `.env.local`, así que funciona igual que siempre sin depender de que alguien configure algo. Apuntar a otro lado exige una acción explícita.

### La franja de aviso

Cuando el portal **no** está en producción, muestra una franja de color arriba de todo:

- 🧪 Marrón — entorno de prueba
- 🔧 Gris — emulador local

**Si no ves ninguna franja, estás tocando la base real.** Es la señal más importante de la pantalla.

---

## Cómo trabajar en el entorno de prueba

### 1. Crear el archivo de configuración

En la carpeta `portal/`:

```bash
echo "REACT_APP_ENV=staging" > .env.local
```

En Mac:

```bash
echo "REACT_APP_ENV=staging" > .env.local
```

### 2. Arrancar el portal

```bash
npm start
```

> Las variables de entorno se leen **solo al arrancar**. Si cambiás `.env.local` con el portal ya corriendo, hay que cortarlo (`Ctrl+C`) y volver a arrancarlo. Recargar el navegador no alcanza.

### 3. Iniciar sesión

Con tu cuenta de siempre. Los usuarios se copiaron de producción, así que las credenciales son las mismas.

### 4. Volver a producción

Borrá o renombrá el archivo:

```bash
del .env.local
```

En Mac:

```bash
rm .env.local
```

Y reiniciá `npm start`. Cuando la franja desaparece, estás en producción.

---

## Cómo actualizar los datos de prueba

Con el tiempo, la copia se desactualiza respecto de producción. Para volver a copiarla:

### Requisito: las claves de servicio

Hacen falta dos archivos de credenciales, uno por proyecto. Para cada uno, en la consola de Firebase:

> ⚙️ Configuración del proyecto → pestaña **Cuentas de servicio** → **Generar nueva clave privada**

Se descarga un `.json`. Guardalos **fuera de la carpeta del repositorio**, por ejemplo:

```
C:\Proyectos\credenciales\clave-produccion.json
C:\Proyectos\credenciales\clave-staging.json
```

> ⚠️ **Estas claves son secretas de verdad.** A diferencia de la configuración pública que está en `src/firebase.js`, dan acceso total a la base de datos ignorando todas las reglas de seguridad. No van al repositorio, no se comparten por mail ni por chat. Cada uno genera las suyas.

### Correr la copia

```bash
cd portal
npm install firebase-admin --no-save
```

Primero en modo simulación, que cuenta lo que copiaría sin escribir nada:

```bash
node scripts/copiar-a-staging.js --simular --produccion C:\Proyectos\credenciales\clave-produccion.json --staging C:\Proyectos\credenciales\clave-staging.json
```

Si los números tienen sentido, la copia real (el mismo comando sin `--simular`):

```bash
node scripts/copiar-a-staging.js --produccion C:\Proyectos\credenciales\clave-produccion.json --staging C:\Proyectos\credenciales\clave-staging.json
```

### Qué copia y qué no

| Colección | ¿Se copia? |
| --- | --- |
| `usuarios_portal` | Sí |
| `pedidos_portal` | Sí |
| `transportistas_portal` | Sí |
| `portal` | Sí |
| `catac_versiones` | Sí |
| `tarifario_versiones` | Sí |
| `app_logs` | **No** — son diagnósticos de producción, no aportan nada y pueden ser miles |

**No copia las cuentas de Firebase Auth.** Eso se hizo una vez, aparte, con `firebase auth:export` / `auth:import`. Si se crean usuarios nuevos en producción, hay que repetir ese paso para que puedan entrar al entorno de prueba.

**No borra de prueba lo que ya no existe en producción.** Si un pedido se eliminó en producción, en prueba va a seguir estando. Para una copia limpia hay que vaciar las colecciones antes, desde la consola de Firebase.

### El resguardo del script

Antes de escribir nada, el script abre las dos credenciales y **verifica que el `project_id` de adentro sea el que corresponde**. Si se pasan las claves al revés, se frena y avisa — en vez de copiar el entorno de prueba sobre producción.

---

## Las reglas de seguridad

El entorno de prueba usa **exactamente las mismas reglas que producción**. Es a propósito: si tuviera reglas distintas, probar ahí no diría nada sobre lo que va a pasar en la base real.

Si se modifican las reglas, hay que publicarlas en los dos proyectos. El procedimiento está en [`Procedimiento.md`](../Procedimiento.md), Paso 8.

---

## Preguntas frecuentes

**¿Puedo romper producción trabajando en el entorno de prueba?**

No, siempre que la franja marrón esté visible. El portal habla con un proyecto de Firebase distinto, con su propia base de datos y sus propios usuarios.

Hay una excepción que ya está resuelta: el módulo de Administración usaba una configuración hardcodeada apuntando a producción para crear usuarios. Se corrigió en la versión 1.0.4 — ahora usa el mismo proyecto que el resto del portal.

**¿Los datos de prueba son datos reales?**

Sí. Se copian tal cual de producción: nombres de clientes, CUITs, DNIs de choferes, teléfonos. No están anonimizados. Tratalos con el mismo cuidado que los de producción.

**¿La app TrackEx también apunta al entorno de prueba?**

No. La app siempre apunta a producción — su configuración está hardcodeada en `explora-app/src/config/firebase.js`. Si en algún momento hace falta probar la app contra el entorno de prueba, hay que hacer ese cambio aparte.

**¿Cuánto cuesta tener este proyecto?**

Nada. Está en plan Spark (gratuito), igual que producción.

---

*Explora Nóminas — documentación interna*
