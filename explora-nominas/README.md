# Explora — Nóminas de Carga

Formulario web para nominación de camiones. Escribe directo en Google Sheets y notifica a operaciones por email.

---

## Archivos

| Archivo     | Qué hace |
|-------------|----------|
| `index.html`| Formulario visible para el cliente |
| `app.js`    | Lógica: validación, EmailJS, Google Sheets |
| `Code.gs`   | Script de Google que recibe los datos y escribe en el sheet |
| `logo.png`  | Logo de Explora (ya incluido) |

---

## Paso 1 — Configurar Google Apps Script

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

---

## Paso 2 — Configurar el template de EmailJS

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

---

## Paso 3 — Subir a GitHub

```bash
git init
git add .
git commit -m "Formulario nóminas Explora v1"
git remote add origin https://github.com/TU_USUARIO/explora-nominas.git
git push -u origin main
```

---

## Paso 4 — Deploy en Vercel

1. Entrá a vercel.com e iniciá sesión con GitHub
2. Clic en **Add New Project**
3. Importá el repositorio `explora-nominas`
4. Sin cambiar nada, clic en **Deploy**
5. En segundos tenés un link público tipo `explora-nominas.vercel.app`

Para dominio propio (`nominas.explora.com.ar`): en Vercel → Settings → Domains → agregá el dominio.

---

## Cambiar el email de destino

En `app.js`, línea 8:
```js
destino: 'luis.hernandez@explora.com.ar',
```
Cambiar por la casilla definitiva cuando corresponda.

---

## Flujo completo

```
Cliente completa formulario
        ↓
app.js valida campos obligatorios
        ↓
      ┌─────────────────────────┐
      │ EmailJS → email a Explora│
      │ Apps Script → fila sheet │
      └─────────────────────────┘
        ↓
Explora aprueba/rechaza desde el email
        ↓
Patente habilitada (fase siguiente)
```
