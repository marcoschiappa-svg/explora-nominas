// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyMKtE56JvOgsaXvZysn5SFkwswzIW_MAmy48XwEubAAWZttDYvwTvR7GZTjwAWismx/exec';

const PRODUCTOS = {
  'Carga':    ['Biodiesel', 'EMAG', 'Glicerina', 'Otros'],
  'Descarga': ['Aceite', 'Metanol', 'Metilato', 'Ac Sulf 98%', 'Ac Sulf 33%', 'Soda Cáustica', 'Antioxidante', 'Oleina', 'Otros'],
};

// ─── NAVEGACIÓN ───────────────────────────────────────────────────────────────
function showScreen(id) {
  ['screen-login','screen-registro','screen-recover','screen-form'].forEach(s => {
    document.getElementById(s).style.display = s === id ? (id === 'screen-form' ? 'block' : 'flex') : 'none';
  });
  if (id === 'screen-form') document.getElementById('screen-form').style.display = 'block';
}

// ─── MODO INDIVIDUAL / MASIVA ─────────────────────────────────────────────────
function setModo(modo) {
  document.getElementById('modo-individual').style.display = modo === 'individual' ? 'block' : 'none';
  document.getElementById('modo-masiva').style.display     = modo === 'masiva'     ? 'block' : 'none';
  document.getElementById('btn-modo-individual').className = 'mode-btn' + (modo === 'individual' ? ' active' : '');
  document.getElementById('btn-modo-masiva').className     = 'mode-btn' + (modo === 'masiva'     ? ' active' : '');
}

// ─── UI INDIVIDUAL ────────────────────────────────────────────────────────────
function updateTipo() {
  const tipo = document.getElementById('f-tipo-op').value;
  document.getElementById('field-descarga-wrap').style.display = tipo === 'Descarga' ? 'grid' : 'none';
  document.getElementById('sec-cisternas').style.display       = tipo === 'Carga'    ? 'block' : 'none';
  const sel = document.getElementById('f-producto');
  sel.innerHTML = '<option value="">Seleccionar...</option>';
  if (tipo && PRODUCTOS[tipo]) {
    PRODUCTOS[tipo].forEach(p => { const o = document.createElement('option'); o.value = p; o.textContent = p; sel.appendChild(o); });
  }
  updateProducto();
}

function updateProducto() {
  const tipo     = document.getElementById('f-tipo-op').value;
  const producto = document.getElementById('f-producto').value;
  const mostrar  = tipo === 'Carga' && producto === 'Glicerina';
  document.getElementById('subsec-export').style.display = mostrar ? 'block' : 'none';
  if (!mostrar) { exportOn = false; document.getElementById('toggle-export').className = 'toggle'; document.getElementById('export-fields').style.display = 'none'; }
}

function updateCisternas() {
  const cant = parseInt(document.getElementById('f-cant-cisternas').value) || 0;
  const cont = document.getElementById('cisternas-campos');
  cont.innerHTML = '';
  for (let i = 1; i <= cant; i++) {
    const div = document.createElement('div');
    div.className = 'field';
    div.innerHTML = `<label>Cisterna ${i} (m³)</label><input type="number" id="f-cist-${i}" placeholder="0.00" step="0.01" min="0" max="999999" />`;
    cont.appendChild(div);
  }
}

let exportOn = false;
function toggleExport() {
  exportOn = !exportOn;
  document.getElementById('toggle-export').className = 'toggle' + (exportOn ? ' on' : '');
  document.getElementById('export-fields').style.display = exportOn ? 'block' : 'none';
}

// ─── VALIDACIÓN INDIVIDUAL ────────────────────────────────────────────────────
const REQUIRED = ['f-cliente','f-tipo-op','f-producto','f-orden','f-fecha','f-camion','f-empresa','f-cuit','f-dni','f-chofer','f-destino'];

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
    email_remitente: window._userEmail || '',
    nombre_remitente: window._userName || '',
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

// ─── ENVIAR ───────────────────────────────────────────────────────────────────
async function enviar(data) {
  const params = new URLSearchParams(data).toString();
  await fetch(APPS_SCRIPT_URL + '?' + params, { method: 'GET', mode: 'no-cors' });
}

// ─── SUBMIT INDIVIDUAL ────────────────────────────────────────────────────────
async function handleSubmit() {
  if (!validate()) return;
  const btn      = document.getElementById('btn-submit');
  const spinner  = document.getElementById('spinner');
  const bannerOk = document.getElementById('banner-ok');
  const bannerErr= document.getElementById('banner-err');
  const btnNueva = document.getElementById('btn-nueva');
  btn.disabled = true;
  spinner.style.display = 'block';
  bannerOk.style.display = 'none';
  bannerErr.style.display = 'none';
  try {
    const data = collectData();
    await enviar(data);
    bannerOk.innerHTML = `✓ Nómina enviada correctamente. Te enviamos una confirmación a <strong>${window._userEmail}</strong>.`;
    bannerOk.style.display = 'block';
    btn.textContent = 'Enviado';
    btnNueva.style.display = 'block';
  } catch(err) {
    console.error(err);
    bannerErr.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Enviar nómina';
  } finally {
    spinner.style.display = 'none';
  }
}

// ─── NUEVA NÓMINA ─────────────────────────────────────────────────────────────
function nuevaNomina() {
  // Limpiar todos los campos
  const campos = ['f-cliente','f-tipo-op','f-orden','f-producto','f-fecha','f-proveedor','f-origen',
    'f-cant-cisternas','f-camion','f-acoplado','f-empresa','f-cuit','f-dni','f-chofer',
    'f-destino','f-dir','f-localidad','f-provincia','f-cp',
    'f-nac','f-cont-tipo','f-permiso','f-nro-cont','f-tara-cont','f-tara-flexi'];
  campos.forEach(id => { const el = document.getElementById(id); if (el) { el.value = ''; el.classList.remove('error'); } });
  document.getElementById('cisternas-campos').innerHTML = '';
  document.getElementById('field-descarga-wrap').style.display = 'none';
  document.getElementById('sec-cisternas').style.display = 'none';
  document.getElementById('subsec-export').style.display = 'none';
  document.getElementById('export-fields').style.display = 'none';
  document.getElementById('toggle-export').className = 'toggle';
  exportOn = false;
  document.getElementById('banner-ok').style.display = 'none';
  document.getElementById('banner-err').style.display = 'none';
  document.getElementById('btn-nueva').style.display = 'none';
  const btn = document.getElementById('btn-submit');
  btn.disabled = false;
  btn.textContent = 'Enviar nómina';
  window.scrollTo(0, 0);
}

// ─── CARGA MASIVA ─────────────────────────────────────────────────────────────
function addRowMasiva() {
  const tbody = document.getElementById('tabla-masiva-body');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><select class="m-tipo" onchange="updateProductoMasiva(this)">
      <option value="">-</option><option>Carga</option><option>Descarga</option>
    </select></td>
    <td><input type="text" class="m-cliente" placeholder="Razón social" /></td>
    <td><input type="text" class="m-orden" placeholder="N° orden" /></td>
    <td><select class="m-producto"><option value="">-</option></select></td>
    <td><input type="date" class="m-fecha" /></td>
    <td><input type="text" class="m-patente" placeholder="AA333DD" oninput="this.value=this.value.toUpperCase()" maxlength="8" /></td>
    <td><input type="text" class="m-chofer" placeholder="Apellido, Nombre" /></td>
    <td><input type="text" class="m-empresa" placeholder="Empresa" /></td>
    <td><input type="text" class="m-destino" placeholder="Destino" /></td>
    <td><button class="btn-del-row" onclick="this.closest('tr').remove()">✕</button></td>`;
  tbody.appendChild(tr);
}

function updateProductoMasiva(sel) {
  const tipo = sel.value;
  const prodSel = sel.closest('tr').querySelector('.m-producto');
  prodSel.innerHTML = '<option value="">-</option>';
  if (tipo && PRODUCTOS[tipo]) {
    PRODUCTOS[tipo].forEach(p => { const o = document.createElement('option'); o.value = p; o.textContent = p; prodSel.appendChild(o); });
  }
}

async function handleSubmitMasiva() {
  const rows = document.querySelectorAll('#tabla-masiva-body tr');
  if (rows.length === 0) { alert('Agregá al menos una fila.'); return; }

  const btn      = document.getElementById('btn-submit-masiva');
  const spinner  = document.getElementById('spinner-masiva');
  const bannerOk = document.getElementById('banner-ok-masiva');
  const bannerErr= document.getElementById('banner-err-masiva');

  btn.disabled = true;
  spinner.style.display = 'block';
  bannerOk.style.display = 'none';
  bannerErr.style.display = 'none';

  try {
    let enviadas = 0;
    for (const tr of rows) {
      const data = {
        email_remitente:  window._userEmail || '',
        nombre_remitente: window._userName  || '',
        tipo_op:   tr.querySelector('.m-tipo').value,
        cliente:   tr.querySelector('.m-cliente').value.trim(),
        orden:     tr.querySelector('.m-orden').value.trim(),
        producto:  tr.querySelector('.m-producto').value,
        fecha_carga: tr.querySelector('.m-fecha').value,
        patente:   tr.querySelector('.m-patente').value.trim(),
        chofer:    tr.querySelector('.m-chofer').value.trim(),
        empresa:   tr.querySelector('.m-empresa').value.trim(),
        destino:   tr.querySelector('.m-destino').value.trim(),
        exp_activo: 'No',
      };
      if (!data.tipo_op || !data.cliente || !data.orden || !data.producto || !data.fecha_carga || !data.patente || !data.chofer || !data.empresa || !data.destino) continue;
      await enviar(data);
      enviadas++;
      await new Promise(r => setTimeout(r, 300)); // pausa entre envíos
    }
    bannerOk.innerHTML = `✓ ${enviadas} nómina${enviadas !== 1 ? 's' : ''} enviada${enviadas !== 1 ? 's' : ''} correctamente.`;
    bannerOk.style.display = 'block';
    btn.textContent = 'Enviado';
  } catch(err) {
    console.error(err);
    bannerErr.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Enviar todas';
  } finally {
    spinner.style.display = 'none';
  }
}

// Inicializar tabla masiva con una fila
document.addEventListener('DOMContentLoaded', () => {
  addRowMasiva();
  // Mostrar pantalla login por defecto hasta que Firebase confirme el estado
  showScreen('screen-login');
});
