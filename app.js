// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
const CONFIG = {
  emailjs: {
    publicKey:  '0T758BnhAAvp8Dxz2',
    serviceId:  'service_su9jl9c',
    templateId: 'template_lbtxeoa',
    destino:    'marcos.chiappa@explora.com.ar',
  },
  sheets: {
    // Reemplazar con el Apps Script Web App URL (ver README)
    webAppUrl: 'https://script.google.com/macros/s/AKfycbwrY2rh6pdB3BRVBSdGENDVH5ASWFhgioHym_Hyyt79ieIBf9Fqkgg8bGnGy2x5Z8vG/exec',
  },
};

// ─── INIT ──────────────────────────────────────────────────────────────────────
emailjs.init(CONFIG.emailjs.publicKey);

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
    'Glicerina cruda':    'Si corresponde a exportación, activá la sección correspondiente en Transporte.',
    'Glicerina refinada': 'Si corresponde a exportación, activá la sección correspondiente en Transporte.',
    'B100 — Biodiesel puro': 'Biodiesel sin mezcla, concentración 100%.',
    'EMAG':               'Ésteres metílicos de ácidos grasos.',
    'MMPP / Materia prima': 'Materia prima para producción de biodiesel.',
  };
  document.getElementById('producto-hint').textContent = hints[val] || '';
}

// ─── VALIDACIÓN ───────────────────────────────────────────────────────────────
const REQUIRED = ['f-cliente', 'f-fecha', 'f-camion', 'f-empresa', 'f-cuit', 'f-dni', 'f-chofer', 'f-destino'];

function validate() {
  let ok = true;
  REQUIRED.forEach(id => {
    const el = document.getElementById(id);
    if (!el.value.trim()) {
      el.classList.add('error');
      ok = false;
    } else {
      el.classList.remove('error');
    }
  });
  return ok;
}

// ─── RECOLECTAR DATOS ────────────────────────────────────────────────────────
function collectData() {
  const ts = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Cordoba' });
  return {
    timestamp:    ts,
    cliente:      val('f-cliente'),
    tipo_op:      val('f-tipo-op'),
    orden:        val('f-orden'),
    producto:     val('f-producto'),
    fecha_carga:  val('f-fecha'),
    patente:      val('f-camion'),
    acoplado:     val('f-acoplado'),
    empresa:      val('f-empresa'),
    cuit:         val('f-cuit'),
    dni:          val('f-dni'),
    chofer:       val('f-chofer'),
    destino:      val('f-destino'),
    direccion:    val('f-dir'),
    localidad:    val('f-localidad'),
    provincia:    val('f-provincia'),
    cp:           val('f-cp'),
    // Exportación glicerina
    exp_activo:   exportOn ? 'Sí' : 'No',
    exp_nac:      exportOn ? val('f-nac')       : '',
    exp_cont:     exportOn ? val('f-cont-tipo') : '',
    exp_permiso:  exportOn ? val('f-permiso')   : '',
    exp_nro_cont: exportOn ? val('f-nro-cont')  : '',
    exp_tara_cont:exportOn ? val('f-tara-cont') : '',
    exp_tara_flex:exportOn ? val('f-tara-flexi'): '',
  };
}

function val(id) {
  return document.getElementById(id)?.value?.trim() || '';
}

// ─── ENVIAR EMAIL (EmailJS) ───────────────────────────────────────────────────
async function sendEmail(data) {
  const exportInfo = data.exp_activo === 'Sí'
    ? `
Exportación de glicerina: SÍ
  País destino:     ${data.exp_nac}
  Contenedor:       ${data.exp_cont}
  Permiso embarque: ${data.exp_permiso}
  N° contenedor:    ${data.exp_nro_cont}
  TARA contenedor:  ${data.exp_tara_cont} kg
  TARA flexi:       ${data.exp_tara_flex} kg`
    : 'Exportación de glicerina: No';

  const templateParams = {
    to_email:    'marcos.chiappa@explora.com.ar',
    reply_to:    'marcos.chiappa@explora.com.ar',
    timestamp:   data.timestamp,
    cliente:     data.cliente,
    tipo_op:     data.tipo_op || '—',
    orden:       data.orden   || '—',
    producto:    data.producto|| '—',
    fecha_carga: data.fecha_carga,
    patente:     data.patente,
    acoplado:    data.acoplado || '—',
    empresa:     data.empresa,
    cuit:        data.cuit,
    dni:         data.dni,
    chofer:      data.chofer,
    destino:     data.destino,
    direccion:   data.direccion  || '—',
    localidad:   data.localidad  || '—',
    provincia:   data.provincia  || '—',
    cp:          data.cp         || '—',
    exportacion: exportInfo,
  };

  return emailjs.send(CONFIG.emailjs.serviceId, CONFIG.emailjs.templateId, templateParams);
}

// ─── ESCRIBIR EN GOOGLE SHEETS (Apps Script) ─────────────────────────────────
async function writeToSheet(data) {
  if (CONFIG.sheets.webAppUrl === 'TU_APPS_SCRIPT_URL_AQUI') {
    console.warn('Apps Script URL no configurada — solo se envía el email.');
    return;
  }
  const row = [
    '',                // LL — vacío, vendrá del tótem
    '',                // E  — vacío, vendrá del sistema de pesaje
    '',                // S  — vacío, vendrá del sistema de pesaje
    data.patente,      // Vehículo
    data.chofer,       // Conductor
    data.dni,          // DNI
    `Pendiente aprobación — ${data.timestamp}`, // Aprobó formulario
    data.cliente,      // Procedencia
    data.destino,      // Destino
    data.orden,        // N° RTOS
    `Nómina recibida ${data.timestamp}`,        // Observaciones
    `${data.producto} — ${data.fecha_carga}`,   // Detalle de la carga
    '',                // Nro Pager
  ];
  await fetch(CONFIG.sheets.webAppUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ row }),
  });
}

// ─── SUBMIT PRINCIPAL ─────────────────────────────────────────────────────────
async function handleSubmit() {
  if (!validate()) return;

  const btn     = document.getElementById('btn-submit');
  const spinner = document.getElementById('spinner');
  const bannerOk  = document.getElementById('banner-ok');
  const bannerErr = document.getElementById('banner-err');

  btn.disabled = true;
  spinner.style.display = 'block';
  bannerOk.style.display = 'none';
  bannerErr.style.display = 'none';

  try {
    const data = collectData();
    await Promise.all([
      sendEmail(data),
      writeToSheet(data),
    ]);
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
