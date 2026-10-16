/**
 * =============================================================================
 * organizaciones/logica-ficha-organizacion.js — v1.2.2 (rediseño del modal)
 * =============================================================================
 *
 * SÍNTOMA
 *   El modal de organización pasa a tener pestañas, una "Ficha completa" y la
 *   línea "Última modificación". Esa lógica no puede vivir en el componente, y
 *   la línea de auditoría mostraba el `Timestamp` de Firestore crudo
 *   (`Timestamp(seconds=..., nanoseconds=...)`).
 *
 * CAUSA RAÍZ
 *   El resumen anterior hacía `String(org.actualizado_en)`, que sobre un
 *   `Timestamp` imprime el objeto; y no existía ninguna función que calculara
 *   la completitud de una organización.
 *
 * ALCANCE
 *   Funciones puras, sin Firestore ni JSX:
 *   - `iniciales(nombre)`: dos letras para el avatar.
 *   - `verificarCuit(texto)`: advertencia del dígito verificador (módulo 11).
 *     Es SOLO una advertencia: el bloqueo de guardado sigue siendo el de
 *     `validarFormulario()` (11 dígitos), que no cambia.
 *   - `calcularFicha(...)`: ítems y porcentaje de la "Ficha completa", sobre
 *     los ítems que aplican a ese tipo de organización.
 *   - `formatearUltimaModificacion(ts, ahora)`: acepta `Timestamp`, `Date`,
 *     `{seconds}` o número; devuelve "—" si el valor no es una fecha válida.
 *   - `detectarDuplicados(usuarios)`: marca (sin ocultar ni deduplicar) los
 *     usuarios que comparten nombre normalizado o DNI.
 *
 * LIMITACIONES CONOCIDAS
 *   El dígito verificador solo se evalúa con 11 dígitos; con otro largo ya
 *   bloquea `validarFormulario()`.
 *
 * CÓMO SE VERIFICA
 *   `logica-ficha-organizacion.test.js` y `CI=true npm run build` sin warnings.
 * ========================================================================== */

import { claveNormalizada, normalizarCuit } from '../../mapa-normalizacion';

/** 1. Dos letras para el avatar ("TRANSPORTE G&G" -> "TG"). */
export function iniciales(nombre) {
  const palabras = String(nombre || '')
    .replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ ]/g, ' ')
    .trim().split(/\s+/).filter(Boolean);
  const a = (palabras[0] || '?')[0];
  const b = (palabras[1] || '')[0] || '';
  return (a + b).toUpperCase();
}

/**
 * 2. Estado del CUIT para mostrar. `estado`:
 *   'vacio' | 'incompleto' (no bloquea acá: lo bloquea validarFormulario) |
 *   'ok' | 'advertencia' (dígito verificador que no coincide).
 */
export function verificarCuit(texto) {
  const digitos = String(texto || '').replace(/\D/g, '');
  if (!digitos) return { estado: 'vacio', digitos };
  if (digitos.length !== 11) {
    return { estado: 'incompleto', digitos, mensaje: `Faltan dígitos (${digitos.length}/11)` };
  }
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let suma = 0;
  for (let i = 0; i < 10; i++) suma += Number(digitos[i]) * pesos[i];
  let verificador = 11 - (suma % 11);
  if (verificador === 11) verificador = 0;
  if (verificador === 10 || verificador !== Number(digitos[10])) {
    return { estado: 'advertencia', digitos, mensaje: 'El dígito verificador no coincide. Revisalo (no impide guardar).' };
  }
  return { estado: 'ok', digitos };
}

/** CUIT con guiones si tiene 11 dígitos; si no, lo que haya. */
export function formatearCuit(digitos) {
  const d = String(digitos || '').replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : (d || '—');
}

/**
 * 3. La "Ficha completa". `aplican` dice qué pestañas existen para esta
 * organización: Usuarios y Productos solo cuentan si existen.
 *
 * @param {Object} p
 * @param {Object} p.form        razon_social, cuit, es_exterior, telefono
 * @param {Object} p.cantidades  { domicilios, correos, usuarios, productos }
 * @param {{usuarios: boolean, productos: boolean}} p.aplican
 * @returns {{items: Array, porcentaje: number}}
 */
export function calcularFicha({ form, cantidades, aplican }) {
  const razon = String(form.razon_social || '').trim();
  const cuit = String(form.cuit || '').trim();
  const fiscalOk = !!razon && (form.es_exterior ? !!cuit : !!normalizarCuit(cuit));

  const items = [
    { clave: 'fiscal', etiqueta: 'Datos fiscales', ok: fiscalOk, pestana: 'general' },
    { clave: 'telefono', etiqueta: 'Teléfono', ok: !!String(form.telefono || '').trim(), pestana: 'general' },
    { clave: 'domicilios', etiqueta: 'Domicilio', ok: cantidades.domicilios > 0, pestana: 'domicilios' },
    { clave: 'correos', etiqueta: 'Correo de contacto', ok: cantidades.correos > 0, pestana: 'correos' },
  ];
  if (aplican.usuarios) {
    items.push({ clave: 'usuarios', etiqueta: 'Usuarios asignados', ok: cantidades.usuarios > 0, pestana: 'usuarios' });
  }
  if (aplican.productos) {
    items.push({ clave: 'productos', etiqueta: 'Productos habilitados', ok: cantidades.productos > 0, pestana: 'productos' });
  }

  const completos = items.filter(i => i.ok).length;
  return { items, porcentaje: Math.round((completos / items.length) * 100) };
}

function aFecha(ts) {
  if (!ts) return null;
  let f = null;
  if (typeof ts.toDate === 'function') f = ts.toDate();
  else if (ts instanceof Date) f = ts;
  else if (typeof ts.seconds === 'number') f = new Date(ts.seconds * 1000);
  else if (typeof ts === 'number') f = new Date(ts);
  return f && !isNaN(f.getTime()) ? f : null;
}

/** 4. "Última modificación hace 14 días · 02/10/2026 15:08" o "—". */
export function formatearUltimaModificacion(ts, ahora = new Date()) {
  const f = aFecha(ts);
  if (!f) return 'Última modificación: —';

  const dias = Math.max(0, Math.floor((ahora.getTime() - f.getTime()) / 86400000));
  const hace = dias === 0 ? 'hoy' : (dias === 1 ? 'hace 1 día' : `hace ${dias} días`);
  const fecha = f.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const hora = f.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `Última modificación ${hace} · ${fecha} ${hora}`;
}

/**
 * 5. Devuelve un `Set` con los IDs de usuario que parecen duplicados: mismo
 * nombre normalizado, o mismo DNI. NUNCA se oculta ni se deduplica.
 */
export function detectarDuplicados(usuarios) {
  const porNombre = new Map();
  const porDni = new Map();
  for (const u of usuarios || []) {
    const nombre = claveNormalizada(u.nombre || '');
    if (nombre) porNombre.set(nombre, [...(porNombre.get(nombre) || []), u.id]);
    const dni = u.datos_chofer && u.datos_chofer.dni;
    if (dni) porDni.set(String(dni), [...(porDni.get(String(dni)) || []), u.id]);
  }
  const ids = new Set();
  [...porNombre.values(), ...porDni.values()].forEach(lista => {
    if (lista.length > 1) lista.forEach(id => ids.add(id));
  });
  return ids;
}
