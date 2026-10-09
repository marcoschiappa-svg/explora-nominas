/**
 * =============================================================================
 * nuevo-tarifario/Historial.js — v1.2.0 (rediseño NuevoTarifario)
 * =============================================================================
 *
 * SÍNTOMA
 *   El historial general era una tabla (`th`/`td`) sin agrupar por fecha —
 *   el Paso 5 del rediseño pide una línea de tiempo, con el mismo estilo de
 *   tarjeta que el panel de historial del detalle (`ModalDetalleRuta`),
 *   agrupada por día.
 *
 * CAUSA RAÍZ
 *   No existía una presentación de "línea de tiempo" en esta pantalla — la
 *   tabla original mezclaba todos los cambios sin separador alguno.
 *
 * ALCANCE
 *   Reusa `cargarHistorialGeneral()` (vive en el orquestador, que carga
 *   `leerTarifasDeRuta(m.id)` de TODAS las maestras — misma limitación
 *   conocida que ya tenía el archivo original, documentada ahí) — este
 *   componente solo recibe `histFilas` (ya cargadas) y `histCargando`, filtra
 *   EN MEMORIA (ruta, usuario, origen del cambio, rango de fechas — los
 *   mismos tres primeros que ya existían, más "origen" que el Paso 5 agrega)
 *   y agrupa por día (`toLocaleDateString`) con un separador entre grupos.
 *
 * LIMITACIONES CONOCIDAS
 *   Mismas que el archivo original: carga toda la subcolección `tarifas` de
 *   cada maestra al entrar a la pestaña, no pagina.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Manual: ver la lista de pruebas de
 *   `NuevoTarifario` en el CHANGELOG v1.2.0.
 * ========================================================================== */

import React, { useState, useMemo } from 'react';
import Vacio from '../../ui/Vacio';
import Pastilla from '../../ui/Pastilla';
import { espacio, colorEstado } from '../../shared/tokens';
import { formatoMoneda, formatoPorcentaje, formatoFechaLarga } from '../../formatos';
import { ORIGENES_TARIFA } from '../../logica-tarifario';

function tsMillis(valor) {
  if (!valor) return 0;
  if (typeof valor.toMillis === 'function') return valor.toMillis();
  const d = new Date(valor);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function claveDia(valor) {
  if (!valor) return '—';
  const d = typeof valor.toDate === 'function' ? valor.toDate() : new Date(valor);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

const ETIQUETA_ORIGEN = {
  alta: 'Alta de ruta',
  catamp: 'Indicador CATAMP',
  catac: 'Indicador CATAC',
  generador: 'Generador',
  restauracion: 'Restauración de versión',
  migracion: 'Carga inicial',
  editor: 'Edición manual',
  ajuste_global: 'Ajuste global',
};

export default function Historial({ S, histFilas, histCargando }) {
  const [rutaTxt, setRutaTxt] = useState('');
  const [usuarioTxt, setUsuarioTxt] = useState('');
  const [origen, setOrigen] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  const filtrado = useMemo(() => {
    if (!histFilas) return [];
    const rTxt = rutaTxt.trim().toLowerCase();
    const uTxt = usuarioTxt.trim().toLowerCase();
    const desdeMs = desde ? new Date(desde + 'T00:00:00').getTime() : null;
    const hastaMs = hasta ? new Date(hasta + 'T23:59:59').getTime() : null;
    return histFilas.filter(h => {
      const origenTxt = (h.ruta.origen || '').toLowerCase();
      const destinoTxt = (h.ruta.destino || '').toLowerCase();
      const prodTxt = (h.ruta.producto || '').toLowerCase();
      const mr = !rTxt || origenTxt.includes(rTxt) || destinoTxt.includes(rTxt) || prodTxt.includes(rTxt);
      const mu = !uTxt || (h.usuario_nombre || '').toLowerCase().includes(uTxt);
      const mo = !origen || h.origen === origen;
      const ms = tsMillis(h.ts);
      const md = (!desdeMs || ms >= desdeMs) && (!hastaMs || ms <= hastaMs);
      return mr && mu && mo && md;
    });
  }, [histFilas, rutaTxt, usuarioTxt, origen, desde, hasta]);

  const grupos = useMemo(() => {
    const porDia = new Map();
    filtrado.forEach(h => {
      const clave = claveDia(h.ts);
      if (!porDia.has(clave)) porDia.set(clave, []);
      porDia.get(clave).push(h);
    });
    return Array.from(porDia.entries());
  }, [filtrado]);

  return (
    <div>
      <div style={S.controlesFila}>
        <div>
          <label style={S.label}>Ruta</label>
          <input style={S.input} type="search" placeholder="Origen, destino, producto…" value={rutaTxt} onChange={e => setRutaTxt(e.target.value)} />
        </div>
        <div>
          <label style={S.label}>Usuario</label>
          <input style={S.input} type="search" placeholder="Quién lo hizo…" value={usuarioTxt} onChange={e => setUsuarioTxt(e.target.value)} />
        </div>
        <div>
          <label style={S.label}>Origen del cambio</label>
          <select style={S.select} value={origen} onChange={e => setOrigen(e.target.value)}>
            <option value="">Todos</option>
            {ORIGENES_TARIFA.map(o => <option key={o} value={o}>{ETIQUETA_ORIGEN[o] || o}</option>)}
          </select>
        </div>
        <div>
          <label style={S.label}>Desde</label>
          <input style={S.input} type="date" value={desde} onChange={e => setDesde(e.target.value)} />
        </div>
        <div>
          <label style={S.label}>Hasta</label>
          <input style={S.input} type="date" value={hasta} onChange={e => setHasta(e.target.value)} />
        </div>
      </div>

      {histCargando ? (
        <div style={{ opacity: 0.7 }}>Cargando historial…</div>
      ) : grupos.length === 0 ? (
        <Vacio titulo="Sin cambios de tarifa que coincidan." />
      ) : (
        grupos.map(([dia, cambios]) => (
          <div key={dia} style={{ marginBottom: espacio.lg }}>
            <div style={{ ...S.cardH, marginBottom: espacio.sm }}>{dia}</div>
            {cambios.map(c => (
              <div key={c.id} style={S.tarjetaHistorial}>
                <div style={{ fontSize: 13, marginBottom: 4 }}>
                  <strong>{c.ruta.origen} → {c.ruta.destino}</strong> · {c.ruta.producto}
                </div>
                <div style={{ fontSize: 13, marginBottom: 4 }}>
                  {formatoMoneda(c.tarifa_anterior)} → <strong>{formatoMoneda(c.tarifa_nueva)}</strong>
                  {' '}
                  <Pastilla chico colores={{ bg: c.variacion > 0 ? colorEstado.peligroFondo : colorEstado.exitoFondo, color: c.variacion > 0 ? colorEstado.peligroTexto : colorEstado.exitoTexto }}>
                    {formatoPorcentaje(c.variacion)}
                  </Pastilla>
                </div>
                <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 2 }}>
                  {ETIQUETA_ORIGEN[c.origen] || c.origen}{c.ref && c.ref !== 'Otro' ? ` · ${c.ref}` : ''} — {c.just}
                </div>
                <div style={{ fontSize: 11, opacity: 0.7 }}>
                  {c.usuario_nombre || 'Autor no registrado (historial migrado)'} · {formatoFechaLarga(c.ts)}
                </div>
                {c.adjunto && (
                  <div style={{ marginTop: 4 }}>
                    <a href={c.adjunto} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: colorEstado.acentoAzulFuerte }}>Ver informe</a>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
