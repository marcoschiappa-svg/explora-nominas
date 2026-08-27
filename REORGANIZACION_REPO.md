# Reorganización del repositorio — para revisar con Marcos

Relevamiento del estado actual de `explora-nominas`. La idea es decidir juntos qué se hace con cada cosa **antes** de empezar la migración del modelo de datos.

Nada de esto está hecho todavía. Es una propuesta para discutir.

Fecha del relevamiento: 21/08/2026

---

## 1. Archivos sueltos en la raíz

| Archivo | Qué hace hoy | Propuesta | A confirmar |
| --- | --- | --- | --- |
| `index.html` | Formulario web de nominación de camiones. Lo completan transportistas externos. | **Mover** a `formulario-nominas/` | ⚠️ Vercel sirve la raíz del repo. Si se mueve sin reconfigurar Vercel, **el formulario deja de funcionar**. |
| `app.js` | Lógica del formulario: validación, envío por EmailJS y a Apps Script. | **Mover** junto con `index.html` | Ídem |
| `Code.gs` | Script de Google del formulario: escribe la fila en el Sheet y manda el mail. | **Mover** junto con `index.html` | Apunta al Sheet `1BRKhb...`. ¿Es el que está en uso? |
| `.DS_Store` | Archivo de macOS. No hace nada, se generó solo. Está commiteado. | **Borrar** del repo (`git rm --cached`) | Ninguna. Ya está cubierto por el `.gitignore` nuevo. |
| `explora-nominas (1).zip` | Archivo comprimido commiteado en el repo. 21 KB. | **Borrar** o mover a archivo | ¿Alguien sabe qué contiene / por qué está? |
| `README.md` | Portada del repositorio en GitHub. Reescrito el 21/08. | **Dejar** | — |
| `Procedimiento.md` | Procedimiento formal de cambios y releases. | **Dejar** | — |
| `SETUP_EMULADOR_MAC.md` | Guía de instalación del emulador local (convertida del PDF). | **Dejar** | ¿Conviene moverlo dentro de `portal/`? |
| `.gitignore` | Reglas de archivos ignorados. Reescrito el 21/08. | **Dejar** | — |

---

## 2. Carpeta `explora-nominas/` (dentro de `explora-nominas/`)

Contiene una copia **anterior** del formulario de nóminas. Todos los archivos son más chicos que los de la raíz:

| Archivo | En la raíz | En la carpeta anidada |
| --- | --- | --- |
| `index.html` | 27.541 bytes | 14.704 bytes |
| `app.js` | 13.273 bytes | 7.346 bytes |
| `Code.gs` | 6.006 bytes | 5.616 bytes |
| `logo.png` | **no está** | 12.728 bytes |
| `README.md` | — | 3.223 bytes |

**Propuesta:** archivar la carpeta, **pero antes recuperar `logo.png`.**

**A confirmar:**
- El `logo.png` está solo acá. Si `index.html` de la raíz lo referencia, **el formulario está mostrando una imagen rota hoy mismo**.
- Los dos `Code.gs` apuntan a **Sheets distintos**: la raíz a `1BRKhb...`, el anidado a `18kB0_...`. ¿Cuál está en uso?
- Los commits que trajeron estos archivos dicen "Add files via upload" — se subieron arrastrando desde la web de GitHub. Probablemente sea un zip descomprimido dentro de sí mismo, sin intención.

---

## 3. Google Apps Script (no está en el repo)

Ninguno de estos scripts tiene copia en ningún lado fuera de Google.

### 3.1 — API del Portal ⚠️ **el más crítico**

| | |
| --- | --- |
| **Qué hace** | Recibe todo lo que el portal le manda: escribe en el Plan de Producción y manda los mails a transportistas. Maneja 8 acciones: `programar_despacho`, `asignar_transportista`, `editar_despacho`, `reprogramar_despacho`, `suspender_pedido`, `confirmar_despacho`, `rechazar_despacho`, `nominar_unidad`. Más `subir_adjunto`, que se llama por POST desde `Pedidos.js`. |
| **Le faltan dos** | `borrar_despacho` y `borrar_adjunto`. El script **solo escribe, nunca borra**: cuando se cancela un despacho o se suspende un pedido, la fila queda en el Plan como si el camión fuera a ir. El modelo nuevo las necesita las dos. |
| **URL** | `https://script.google.com/macros/s/AKfycbzXOlu0PUTAVubDJCXh7WxjZp1ruCH5SMu9YmWbFCNF2ff7l5mn447nV8BIWbQ5-Mz-uQ/exec` |
| **Verificado** | Responde `{"status":"ok","mensaje":"API Portal Explora activa"}`. Está vivo y funcionando. |
| **Problema** | **No aparece en la cuenta de Ivan.** Se necesita acceso de Marcos. |
| **Propuesta** | Dar acceso y guardar una copia en el repo. |

**Por qué importa aunque el plan de producción se vaya a rediseñar:** hoy no existe copia de esa lógica en ningún lado. Si el script se rompe, se borra, o alguien crea una implementación nueva desde un código distinto, el portal deja de escribir y de mandar mails — y **nadie se entera**, porque el portal llama con `mode: 'no-cors'` y nunca ve la respuesta. Sigue mostrando "✓ Se notificó por email" igual.

### 3.2 — Plan de Producción

| | |
| --- | --- |
| **Archivos** | `Codigo.gs` (script unificado v4.6, ~1400 líneas), `dashboard_operativo.gs`, `dashboard_recepcion_v2.gs` |
| **Qué hace** | Lee `RecepClaude.xlsx` de Drive y escribe los valores reales en el Plan de Producción, con lógica de proyectados, cascadas y cierre de día. Corre solo por trigger cada 15 minutos. |
| **Estado** | Funcionando. Es el único de los tres que se usa. |
| **Propuesta** | **No versionar por ahora** — el plan de producción se va a rediseñar y el código actual quedaría obsoleto. *(Decisión de Ivan, 21/08)* |

**A confirmar:** `dashboard_recepcion_v2.gs` incluye `enviarReporteSemanal()` con un trigger semanal (lunes 8hs) que manda un mail de uso. Aunque el dashboard visual no se use, ese trigger puede estar corriendo. ¿Se sabe si llega ese mail?

---

## 4. Google Sheets

| Sheet | ID | Estado |
| --- | --- | --- |
| Plan de Producción **actual** | (el que usa `Codigo.gs` hoy) | En uso |
| Plan de Producción **anterior** | `1aCG2cBh1rSGUQN30ZPWVUzRioVLblNHwxsqarMxa7NQ` | Solo lectura. Se llenó (límite de celdas de Google Sheets) y el 4/8/2026 se hizo una copia para seguir. |
| Sheet del formulario (raíz) | `1BRKhbZ7wsJ8m8Xi_9mhl5CEl6dDVfJW_XKekjiL7dX0` | ? |
| Sheet del formulario (carpeta anidada) | `18kB0_VISvV7jymEN-jzTlsLSGDj82H1k7ebndLKWxJ8` | ? |

**A confirmar:** cuál de los dos Sheets del formulario está recibiendo las nóminas hoy.

---

## 5. Vercel

**No relevado — Ivan no tiene acceso al proyecto.**

Lo que hace falta saber:

- ¿Cuántos proyectos de Vercel hay?
- ¿Cuál sirve el portal y cuál el formulario?
- ¿Qué "Root Directory" tiene configurado cada uno?
- `nominas.explora.com.ar` no carga. ¿El dominio nunca se configuró, o algo se rompió?

**Esto bloquea el punto 1:** hasta no saber qué carpeta sirve Vercel, no se puede mover `index.html` de la raíz sin riesgo de dejar el formulario caído.

---

## 6. Estructura propuesta (si se aprueba todo)

```
explora-nominas/
│
├── README.md                    ← portada
├── Procedimiento.md             ← cómo se hacen los cambios
├── SETUP_EMULADOR_MAC.md
│
├── portal/                      ← sin cambios
├── explora-app/                 ← sin cambios
│
├── formulario-nominas/          ← hoy suelto en la raíz
│   ├── README.md                ← configuración de Apps Script y EmailJS
│   ├── index.html
│   ├── app.js
│   ├── Code.gs
│   └── logo.png                 ← recuperado de la carpeta anidada
│
└── _archivo/                    ← lo que no se usa pero no se borra todavía
    ├── LEEME.md                 ← qué es cada cosa y desde cuándo está acá
    ├── formulario-version-anterior/
    └── explora-nominas (1).zip
```

Sobre `_archivo/`: el guion bajo lo manda al principio de cualquier listado, y adentro va un `LEEME.md` explicando qué es cada cosa. Así, si en seis meses alguien duda, no tiene que adivinar.

---

## 7. Otros pendientes detectados (no son de reorganización)

Anotados para no perderlos. No hace falta resolverlos en esta charla.

| Tema | Detalle |
| --- | --- |
| **Reglas de `pedidos_portal`** | Cualquier usuario autenticado puede leer y escribir **cualquier** pedido, incluidos los choferes sobre pedidos que no les corresponden. Está marcado como "PENDIENTE DE REVISIÓN" en las reglas desde agosto. |
| **`mode: 'no-cors'`** | El portal nunca ve la respuesta del Apps Script. Si falla, muestra "✓ Se notificó" igual. No hay forma de detectar que las notificaciones dejaron de llegar. |
| **URL del Apps Script expuesta** | Está hardcodeada en JavaScript que corre en el navegador, y el script acepta a cualquiera. Alguien podría mandarle datos arbitrarios: filas falsas en el plan, mails disparados. Es el patrón habitual de estas herramientas internas, pero conviene saberlo. |
| **Suspensión no borra del plan** | Cuando se suspende un pedido, el registro queda en el Plan de Producción. El Apps Script solo escribe, nunca borra. Confirmado por Luis. |
| **`Login.js` no usa el provider con restricción de dominio** | `firebase.js` configura `hd: 'explora.com.ar'`, pero `Login.js` crea su propio `GoogleAuthProvider`, así que esa restricción nunca se aplica. |
| **5 cuentas de Auth sin perfil** | Firebase Auth tiene 70 cuentas, `usuarios_portal` tiene 65 documentos. Probablemente usuarios borrados desde Admin (borra el documento pero no la cuenta). No pueden entrar al portal. |
| **App TrackEx siempre en producción** | Su configuración de Firebase está hardcodeada. No puede apuntar al entorno de prueba sin un cambio de código. |

---

## Resumen de lo que hay que decidir

1. **Vercel** — dar acceso a Ivan, o relevarlo juntos. Bloquea mover el formulario.
2. **API del Portal (Apps Script)** — dar acceso para poder versionarla.
3. **`logo.png`** — confirmar si el formulario lo referencia y recuperarlo.
4. **Los dos Sheets del formulario** — cuál está vivo.
5. **`explora-nominas (1).zip`** — qué es, se puede borrar.
6. **La carpeta anidada** — confirmar que es una copia vieja y archivarla.
7. **`.DS_Store`** — sacarlo del repo (no requiere discusión, es ruido).

---

*Explora S.A. — documento de trabajo*
