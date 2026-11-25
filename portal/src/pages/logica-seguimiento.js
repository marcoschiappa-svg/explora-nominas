/* =============================================================================
 * logica-seguimiento.js — v1.2.6 — Traza en vivo y estado del seguimiento
 *                          (acompaña a TrackEx v1.1.2)
 * =============================================================================
 *
 * PROPÓSITO
 *   Lógica pura de la pantalla de Seguimiento: preparar la traza de un viaje a
 *   partir de su subcolección `gps_puntos`, resumirla y decidir la alerta por
 *   estado del seguimiento. Separada de Seguimiento.js para poder testearla sin
 *   Leaflet ni Firestore (mismo criterio que `seguimiento-encuadre.js`).
 *
 * MODELO DE DATOS (solo lee lo que recibe)
 *   viajes/{id}/gps_puntos/{ts}  (ver MODELO_DATOS_TOBE.md, `gps_puntos`)
 *     lat, lng   number
 *     ts         Timestamp de Firestore (en tests: Date o ms)
 *     precision, velocidad   number|null — no se usan para dibujar
 *   viajes/{id}.estado, .seguimiento_estado — vía `estadoSeguimiento()`.
 *
 * DECISIONES
 *   - La traza se arma con lo que hay en `gps_puntos`, nunca con
 *     `puntos_registrados`: ese contador es un `increment` y queda por encima
 *     de la cantidad real cuando la app reenvía un lote (prompt 1 de TrackEx
 *     v1.1.2, LIMITACIONES de `logica-gps.js`).
 *   - Deduplicado al DIBUJAR, no en la base: los datos de la 1.1.1 se quedan
 *     como están (los puntos no se modifican ni se borran).
 *
 * HISTORIAL
 *   v1.2.6 — archivo nuevo. Ver el bloque "v1.2.6 — Traza en vivo y estado del
 *   seguimiento" de la cabecera de Seguimiento.js.
 *
 * DEPENDENCIAS: `estadoSeguimiento` y `ETIQUETA_SEGUIMIENTO` de
 * `shared/logica-viajes.js`. Tests: `logica-seguimiento.test.js`.
 * ========================================================================== */

import { estadoSeguimiento, ETIQUETA_SEGUIMIENTO } from '../shared/logica-viajes';

/**
 * Ventana de deduplicado: 1000 ms. En los datos de TrackEx 1.1.1 cada lectura
 * aparece dos veces (las dos fuentes de la app la grababan), con las MISMAS
 * coordenadas y entre unos pocos y unos cientos de milisegundos de diferencia
 * (68 ms en el caso real del 24/11). Con captura cada 30 s, dos lecturas
 * reales nunca están a menos de 1 s; y si el camión está quieto, dos lecturas
 * reales iguales a más de 1 s se conservan las dos.
 */
const VENTANA_DUPLICADO_MS = 1000;

/** `true` si `x` es un número finito. */
function esFinito(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * `ts` de un punto a milisegundos: Timestamp de Firestore (`toMillis`), `Date`
 * o número.
 *
 * @param {*} ts
 * @returns {number} ms, o `NaN` si no se puede interpretar.
 */
function aMs(ts) {
  if (ts == null) return NaN;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'number') return ts;
  return NaN;
}

/**
 * Traza lista para dibujar a partir de los `data()` de `gps_puntos`.
 *
 * 1. Descarta coordenadas no finitas o fuera de rango y `ts` ilegibles.
 * 2. Ordena por `ts` (la consulta ya viene con `orderBy('ts')`, pero no se
 *    asume).
 * 3. Deduplica: un punto con las mismas coordenadas que el ÚLTIMO CONSERVADO y
 *    a menos de `VENTANA_DUPLICADO_MS` de él se descarta. Esto limpia los
 *    datos de TrackEx 1.1.1, donde cada lectura quedó grabada dos veces.
 *
 * No muta la entrada.
 *
 * @param {Array<Object>} puntos
 * @returns {Array<{lat: number, lng: number, ts: number}>}
 */
export function prepararTraza(puntos) {
  const validos = (Array.isArray(puntos) ? puntos : [])
    .filter((p) => p && esFinito(p.lat) && esFinito(p.lng)
      && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180)
    .map((p) => ({ lat: p.lat, lng: p.lng, ts: aMs(p.ts) }))
    .filter((p) => Number.isFinite(p.ts))
    .sort((a, b) => a.ts - b.ts);

  const traza = [];
  for (const p of validos) {
    const previo = traza[traza.length - 1];
    const duplicado = previo && previo.lat === p.lat && previo.lng === p.lng
      && p.ts - previo.ts < VENTANA_DUPLICADO_MS;
    if (!duplicado) traza.push(p);
  }
  return traza;
}

/**
 * Resumen de una traza para la tarjeta del historial.
 *
 * @param {Array<{ts: number}>} traza Resultado de `prepararTraza`.
 * @returns {{cantidad: number, primero: number|null, ultimo: number|null}}
 *   `primero`/`ultimo` son los `ts` en ms, `null` si está vacía.
 */
export function resumenTraza(traza) {
  const t = Array.isArray(traza) ? traza : [];
  return {
    cantidad: t.length,
    primero: t.length ? t[0].ts : null,
    ultimo: t.length ? t[t.length - 1].ts : null,
  };
}

/**
 * Alerta por estado del seguimiento de un viaje en vivo.
 *
 * Separa "seguimiento limitado" (el teléfono no tiene "Permitir siempre", las
 * notificaciones o el servicio: hay traza solo con la app abierta) de "sin
 * señal" (`saludGPS`), que antes se confundían. `desconocido` (viaje iniciado
 * con TrackEx ≤ 1.1.1, que no informa) no alerta: no hay dato, no es un
 * problema del teléfono.
 *
 * @param {Object|null} viaje Documento de `viajes`.
 * @returns {{tipo: 'amber'|'red', msg: string}|null}
 */
export function alertaSeguimiento(viaje) {
  const estado = estadoSeguimiento(viaje);
  if (estado === 'limitado') return { tipo: 'amber', msg: ETIQUETA_SEGUIMIENTO.limitado };
  if (estado === 'sin_ubicacion') return { tipo: 'red', msg: ETIQUETA_SEGUIMIENTO.sin_ubicacion };
  return null;
}
