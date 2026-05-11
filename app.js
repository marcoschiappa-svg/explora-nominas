// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
const APPS_SCRIPT_URL = 'https://script.google.com/a/macros/explora.com.ar/s/AKfycbzYHIm1IvmRaTlQsxwywkzX6VtdONqq1yrBK6qyiTitwhKwjwXsICGxFnX8PsIB-GBP/exec';

// ─── PRODUCTOS POR TIPO ───────────────────────────────────────────────────────
const PRODUCTOS = {
  'Carga':    ['Biodiesel', 'EMAG', 'Glicerina', 'Otros'],
  'Descarga': ['Aceite', 'Metanol', 'Metilato', 'Ac Sulf 98%', 'Ac Sulf 33%', 'Soda Cáustica', 'Antioxidante', 'Oleina', 'Otros'],
};

// ─── UI — TIPO DE OPERACIÓN ───────────────────────────────────────────────────
function updateTipo() {
  const tipo = document.getElementById('f-tipo-op').value;
  const esCarga    = tipo === 'Carga';
  const esDescarga = tipo === 'Descarga';

  document.getElementById('field-descarga-wrap').style.display = esDescarga ? 'grid' : 'none';
  document.getElementById('sec-cisternas').style.display       = esCarga    ? 'block' : 'none';

  const sel = document.getElementById('f-producto');
  sel.innerHTML = '<option value="">Seleccionar...</option>';
  if (tipo && PRODUCTOS[tipo]) {
    PRODUCTOS[tipo].forEach(p => {
      const opt = document.createElement('option');
      opt.value = p; opt.textContent = p;
      sel.appendChild(opt);
    });
  }
  updateProducto();
}

// ─── UI — PRODUCTO ────────────────────────────────────────────────────────────
function updateProducto() {
  const tipo     = document.getElementById('f-tipo-op').value;
  const producto = document.getElementById('f-producto').value;
  const mostrarExport = tipo === 'Carga' && producto === 'Glicerina';
  document.getElementById('subsec-export').style.display = mostrarExport ? 'block' : 'none';
  if (!mostrarExport) {
    exportOn = false;
    document.getElementById('toggle-export').className = 'toggle';
    document.getElementById('export-fields').style.display = 'none';
  }
}

// ─── UI — CISTERNAS ───────────────────────────────────────────────────────────
function updateCisternas() {
  const cant = parseInt(document.getElementById('f-cant-cisternas').value) || 0;
  const cont = document.getElementById('cisternas-campos');
  cont.innerHTML = '';
  for (let i = 1; i <= cant; i++) {
    const div = document.createElement('div');
    div.className = 'field';
    div.innerHTML = `<label>Cisterna ${i}</label><input type="number" id="f-cist-${i}" placeholder="m³" step="0.01" min="0" />`;
    cont.appendChild(div);
  }
}

// ─── UI — EXPORTACIÓN ────────────────────────────────────────────────────────
let exportOn = false;
function toggleExport() {
  exportOn = !exportOn;
  document.getElementById('toggle-export').className = 'toggle' + (exportOn ? ' on' : '');
  document.getElementById('export-fields').style.display = exportOn ? 'block' : 'none';
}

// ─── VALIDACIÓN ───────────────────────────────────────────────────────────────
const REQUIRED = ['f-cliente', 'f-tipo-op', 'f-producto', 'f-fecha', 'f-camion', 'f-empresa', 'f-cuit', 'f-dni', 'f-chofer', 'f-destino'];

function validate() {
  let ok = true;
  REQUIRED.forEach(id => {
    const el = document.getElementById(id);
    if (!el || !el.value.trim()) { if (el) el.classList.add('error'); ok = false; }
    else el.classList.remove('error');
  });
  return ok;
}

// ─── RECOLECTAR DATOS ────────────────────────────────────────────────────────
function v(id) { return document.getElementById(id)?.value?.trim() || ''; }

function collectData() {
  const cant = parseInt(v('f-cant-cisternas')) || 0;
  const cisternas = [];
  for (let i = 1; i <= cant; i++) cisternas.push(`C${i}: ${v(`f-cist-${i}`)} m³`);

  return {
    tipo_op:        v('f-tipo-op'),
    cliente:        v('f-cliente'),
    orden:          v('f-orden'),
    producto:       v('f-producto'),
    fecha_carga:    v('f-fecha'),
    proveedor:      v('f-proveedor'),
    origen:         v('f-origen'),
    cant_cisternas: cant > 0 ? String(cant) : '',
    cisternas:      cisternas.join(' | '),
    patente:        v('f-camion'),
    acoplado:       v('f-acoplado'),
    empresa:        v('f-empresa'),
    cuit:           v('f-cuit'),
    dni:            v('f-dni'),
    chofer:         v('f-chofer'),
    destino:        v('f-destino'),
    direccion:      v('f-dir'),
    localidad:      v('f-localidad'),
    provincia:      v('f-provincia'),
    cp:             v('f-cp'),
    exp_activo:     exportOn ? 'Si' : 'No',
    exp_nac:        exportOn ? v('f-nac')       : '',
    exp_cont:       exportOn ? v('f-cont-tipo') : '',
    exp_permiso:    exportOn ? v('f-permiso')   : '',
    exp_nro_cont:   exportOn ? v('f-nro-cont')  : '',
    exp_tara_cont:  exportOn ? v('f-tara-cont') : '',
    exp_tara_flex:  exportOn ? v('f-tara-flexi'): '',
  };
}

// ─── ENVIAR AL APPS SCRIPT ────────────────────────────────────────────────────
async function enviar(data) {
  const params = new URLSearchParams(data).toString();
  await fetch(APPS_SCRIPT_URL + '?' + params, { method: 'GET', mode: 'no-cors' });
}

// ─── SUBMIT PRINCIPAL ─────────────────────────────────────────────────────────
async function handleSubmit() {
  if (!validate()) return;
  const btn      = document.getElementById('btn-submit');
  const spinner  = document.getElementById('spinner');
  const bannerOk = document.getElementById('banner-ok');
  const bannerErr= document.getElementById('banner-err');
  btn.disabled = true;
  spinner.style.display = 'block';
  bannerOk.style.display = 'none';
  bannerErr.style.display = 'none';
  try {
    await enviar(collectData());
    bannerOk.style.display = 'block';
    btn.textContent = 'Enviado';
  } catch(err) {
    console.error(err);
    bannerErr.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Enviar nómina';
  } finally {
    spinner.style.display = 'none';
  }
}
