# Explora Nóminas

Repositorio de Explora S.A. — contiene **tres proyectos independientes**
relacionados con la logística de transporte de la planta:

| Proyecto | Carpeta | Qué es |
|---|---|---|
| **Formulario de Nóminas** | raíz (este archivo) | Formulario web simple para la nominación inicial de camiones |
| **Portal Explora** | [`portal/`](./portal/README.md) | Portal web de gestión: pedidos, coordinación, tarifario, seguimiento |
| **TrackEx** | [`explora-app/`](./explora-app/README.md) | App móvil (Android/iOS) para choferes — tracking de viajes |

Cada carpeta tiene su propio `README.md` con instrucciones específicas de
instalación y desarrollo, y su propio `CHANGELOG.md` con el historial de
versiones. El proceso para hacer cambios y publicar nuevas versiones de
`portal/` y `explora-app/` está documentado en **[`Procedimiento.md`](./Procedimiento.md)**
— léelo antes de tocar código en cualquiera de los dos.

---

## Formulario de Nóminas (este proyecto)

Formulario web para nominación de camiones. El chofer/transportista lo
completa, los datos se escriben directo en una planilla de Google Sheets
y se notifica por email al área de operaciones.

Es un proyecto simple, sin build ni dependencias de npm — solo HTML y
JavaScript plano, desplegado como sitio estático en Vercel.

### Archivos

| Archivo | Qué hace |
|---|---|
| `index.html` | Formulario visible para el cliente |
| `app.js` | Lógica: validación, envío por EmailJS, escritura en Google Sheets |
| `Code.gs` | Script de Google que recibe los datos y escribe en el sheet |
| `logo.png` | Logo de Explora |

### Configuración — Google Apps Script

1. Abrí el sheet en Google Sheets
2. Menú: **Extensiones → Apps Script**
3. Borrá el contenido vacío y pegá todo el contenido de `Code.gs`
4. Guardá (Ctrl+S)
5. Clic en **Implementar → Nueva implementación**
6. Tipo: **Aplicación web**
7. Configuración:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquiera**
8. Clic en **Implementar** → copiá la URL que aparece
9. Abrí `app.js` y reemplazá `TU_APPS_SCRIPT_URL_AQUI` con esa URL

### Configuración — Template de EmailJS

1. Entrá a emailjs.com → **Email Templates** → editá `template_xu84i2v`
2. Pegá este contenido en el cuerpo del template:

```
Nueva nómina de carga recibida — {{timestamp}}

OPERACIÓN
  Cliente:      {{cliente}}
  Tipo:         {{tipo_op}}
  N° Orden:     {{orden}}
  Producto:     {{producto}}
  Fecha carga:  {{fecha_carga}}

TRANSPORTE
  Patente camión:   {{patente}}
  Patente acoplado: {{acoplado}}
  Empresa:          {{empresa}}
  CUIT:             {{cuit}}
  DNI chofer:       {{dni}}
  Nombre chofer:    {{chofer}}

{{exportacion}}

DESTINO
  Terminal:   {{destino}}
  Dirección:  {{direccion}}
  Localidad:  {{localidad}}
  Provincia:  {{provincia}}
  CP:         {{cp}}
```

3. En el campo **To email**: `{{to_email}}`
4. Subject: `Nueva nómina — {{cliente}} · {{fecha_carga}}`
5. Guardá el template

### Deploy en Vercel

1. Entrá a vercel.com e iniciá sesión con GitHub
2. Clic en **Add New Project**
3. Importá este repositorio
4. Sin cambiar nada, clic en **Deploy**
5. En segundos tenés un link público tipo `explora-nominas.vercel.app`

Para dominio propio (`nominas.explora.com.ar`): Vercel → Settings →
Domains → agregá el dominio.

### Cambiar el email de destino

En `app.js`, línea 8:
```js
destino: 'luis.hernandez@explora.com.ar',
```

### Flujo completo

```
Cliente completa formulario
        ↓
app.js valida campos obligatorios
        ↓
      ┌───────────────────────────┐
      │ EmailJS → email a Explora │
      │ Apps Script → fila sheet  │
      └───────────────────────────┘
        ↓
Explora aprueba/rechaza desde el email
        ↓
Patente habilitada (fase siguiente)
```
