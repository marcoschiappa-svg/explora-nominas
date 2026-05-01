// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwrY2rh6pdB3BRVBSdGENDVH5ASWFhgioHym_Hyyt79ieIBf9Fqkgg8bGnGy2x5Z8vG/exec';

// ─── UI HELPERS ───────────────────────────────────────────────────────────────
let exportOn = false;

function toggleExport() {
  exportOn = !exportOn;
  document.getElementById('toggle-export').className = 'toggle' + (exportOn ? ' on' : '');
  document.getElementById('export-fields').style.display = exportOn ? 'block' : 'none';
}

function updateOrdenLabel() {
  const tipo  = document.getElementById('f-tipo-op').value;
  const label = document.getElementById('label-orden');
  if      (tipo === 'venta')  label.textContent = 'N° Orden de venta';
  else if (tipo === 'compra') label.textContent = 'N° Orden de compra';
  else                        label.textContent = 'N° Orden';
}

function updateProductoHint() {
  const val   = document.getElementById('f-producto').value;
  const hints = {
    'Glicerina cruda':       'Si corresponde a exportación, activá la sección en Transporte.',
    'Glicerina refinada':    'Si corresponde a exportación, activá la sección en Transporte.',
    'B100 — Biodiesel puro': 'Biodiesel sin mezcla, concentración 100%.',
    'EMAG':                  'Ésteres metílicos de ácidos grasos.',
    'MMPP / Materia prima':  'Materia prima para producción de biodiesel.',
  };
  document.getElementById('producto-hint').textContent = hints[val] || '';
}

// ─── VALIDACIÓN ───────────────────────────────────────────────────────────────
const REQUIRED = ['f-cliente', 'f-fecha', 'f-camion', 'f-empresa', 'f-cuit', 'f-dni', 'f-chofer', 'f-destino'];

function validate() {
  let ok = true;
  REQUIRED.forEach(id => {
    const el = document.getElementById(id);
    if (!el.value.trim()) { el.classList.add('error'); ok = false; }
    else                  { el.classList.remove('error'); }
  });
  return ok;
}

// ─── RECOLECTAR DATOS ────────────────────────────────────────────────────────
function collectData() {
  return {
    cliente:       v('f-cliente'),
    tipo_op:       v('f-tipo-op'),
    orden:         v('f-orden'),
    producto:      v('f-producto'),
    fecha_carga:   v('f-fecha'),
    patente:       v('f-camion'),
    acoplado:      v('f-acoplado'),
    empresa:       v('f-empresa'),
    cuit:          v('f-cuit'),
    dni:           v('f-dni'),
    chofer:        v('f-chofer'),
    destino:       v('f-destino'),
    direccion:     v('f-dir'),
    localidad:     v('f-localidad'),
    provincia:     v('f-provincia'),
    cp:            v('f-cp'),
    exp_activo:    exportOn ? 'Si' : 'No',
    exp_nac:       exportOn ? v('f-nac')        : '',
    exp_cont:      exportOn ? v('f-cont-tipo')  : '',
    exp_permiso:   exportOn ? v('f-permiso')    : '',
    exp_nro_cont:  exportOn ? v('f-nro-cont')   : '',
    exp_tara_cont: exportOn ? v('f-tara-cont')  : '',
    exp_tara_flex: exportOn ? v('f-tara-flexi') : '',
  };
}

function v(id) {
  return document.getElementById(id)?.value?.trim() || '';
}

// ─── ENVIAR AL APPS SCRIPT ────────────────────────────────────────────────────
async function enviar(data) {
  // Usamos GET con parámetros para evitar CORS preflight
  const params = new URLSearchParams(data).toString();
  const url = APPS_SCRIPT_URL + '?' + params;
  const res = await fetch(url, { method: 'GET', mode: 'no-cors' });
  // no-cors no devuelve respuesta legible — asumimos OK si no hay excepción
}

// ─── SUBMIT PRINCIPAL ─────────────────────────────────────────────────────────
async function handleSubmit() {
  if (!validate()) return;

  const btn       = document.getElementById('btn-submit');
  const spinner   = document.getElementById('spinner');
  const bannerOk  = document.getElementById('banner-ok');
  const bannerErr = document.getElementById('banner-err');

  btn.disabled = true;
  spinner.style.display = 'block';
  bannerOk.style.display = 'none';
  bannerErr.style.display = 'none';

  try {
    const data = collectData();
    await enviar(data);
    bannerOk.style.display = 'block';
    btn.textContent = 'Enviado';
  } catch (err) {
    console.error(err);
    bannerErr.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Enviar nómina';
  } finally {
    spinner.style.display = 'none';
  }
}
