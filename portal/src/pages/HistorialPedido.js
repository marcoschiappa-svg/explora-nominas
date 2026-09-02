/**
 * =============================================================================
 * HistorialPedido.js — A6: la línea de tiempo de un pedido
 * =============================================================================
 *
 * PROPÓSITO
 * Mostrar quién hizo qué y cuándo sobre un pedido — `historial` se viene
 * escribiendo desde el primer día y hasta ahora nadie lo mira.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ REEMPLAZA A `aceptado_por` / `asignado_por` / `editado_por`
 * -----------------------------------------------------------------------------
 * Esos son casilleros únicos: reasignar dos veces borra el registro de la
 * primera. `historial` es append-only — todo lo que pasó sigue ahí, en orden.
 *
 * -----------------------------------------------------------------------------
 * COMPONENTE, NO PANTALLA
 * -----------------------------------------------------------------------------
 * Un pedido, un `pedido_id`, un modal. Lo abre `Pedidos.js` desde el detalle
 * de un pedido, y más adelante puede abrirlo `Programacion.js` de la misma
 * forma — nada acá depende de desde dónde se lo llama.
 *
 * -----------------------------------------------------------------------------
 * QUÉ FILTRA Y QUÉ NO
 * -----------------------------------------------------------------------------
 * `where('pedido_id', '==', pedidoId)` trae TODO lo que pasó bajo este pedido:
 * cambios en el pedido mismo, en sus entregas, en sus despachos y en sus
 * viajes — todo lo que `anotar()` denormalizó con ese mismo `pedido_id`. No
 * hace falta consultar cuatro colecciones por separado.
 *
 * Lo `derivado: true` —lo que nadie pidió, y salió de otra cosa: el estado de
 * una entrega que se recalculó porque cambió su despacho— se muestra más
 * chico y apagado. Sigue ahí, pero no compite con lo que alguien decidió
 * activamente.
 * ========================================================================== */

import React, { useState, useEffect } from 'react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

/* -----------------------------------------------------------------------------
 * Traducciones
 *
 * Cubre las acciones que ya existen en `logica-pedidos.js`, `logica-despachos.js`
 * y las que se podían inferir de `datos.js`. Lo que no esté acá cae al
 * fallback (el `snake_case` con espacios) en vez de romper — un accion nueva
 * que todavía no se agregó a este mapa no puede tirar la pantalla abajo.
 * -------------------------------------------------------------------------- */

const ETIQUETA_ACCION = {
  crear_pedido: 'Pedido creado',
  editar_domicilio_pedido: 'Domicilio del pedido cambiado',
  editar_domicilio_entrega: 'Domicilio de una entrega cambiado',
  editar_fecha_entrega: 'Fecha de una entrega cambiada',
  editar_volumen_subir: 'Volumen aumentado',
  editar_volumen_bajar: 'Volumen bajado',
  crear_entrega: 'Entrega agregada',
  suspender_entrega: 'Entrega suspendida',
  reactivar_entrega: 'Entrega reactivada',
  suspender_pedido: 'Pedido suspendido',
  aceptar_entrega: 'Entrega aceptada — despacho creado',
  asignar_transportista: 'Transportista asignado',
  reasignar_transportista: 'Transportista reasignado',
  editar_despacho: 'Fecha u horario de carga editado',
  cancelar_despacho: 'Despacho cancelado',
  cancelar_viaje: 'Viaje cancelado',
  aceptar_despacho: 'El transportista aceptó el despacho',
  rechazar_despacho: 'El transportista rechazó el despacho',
  nominar: 'Unidad nominada',
  iniciar_viaje: 'Viaje iniciado',
  reportar_demora: 'Demora reportada',
  finalizar_viaje: 'Viaje finalizado',
  actualizar_destino_denormalizado: 'Destino actualizado',
  recalcular_estado: 'Estado de la entrega recalculado',
  recalcular_contadores: 'Contadores del pedido recalculados',
};

const ETIQUETA_ENTIDAD = {
  pedido: 'Pedido',
  entrega: 'Entrega',
  despacho: 'Despacho',
  viaje: 'Viaje',
};

function etiquetaAccion(accion) {
  return ETIQUETA_ACCION[accion] || String(accion || '').replace(/_/g, ' ');
}

/** Un valor del historial puede ser un Timestamp, un número, un string o null. */
function formatoValor(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object' && typeof v.toDate === 'function') {
    return v.toDate().toLocaleString('es-AR');
  }
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  return String(v);
}

function formatoFecha(ts) {
  if (!ts || typeof ts.toDate !== 'function') return '';
  return ts.toDate().toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function HistorialPedido({ pedidoId, onCerrar }) {
  const [eventos, setEventos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!pedidoId) return;

    const q = query(
      collection(db, 'historial'),
      where('pedido_id', '==', pedidoId),
      orderBy('ts', 'desc')
    );

    const unsub = onSnapshot(q, (snap) => {
      setEventos(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setCargando(false);
    }, (err) => {
      console.error('Historial:', err);
      setError('No se pudo cargar el historial.');
      setCargando(false);
    });

    return () => unsub();
  }, [pedidoId]);

  return (
    <div style={styles.overlay} onMouseDown={onCerrar}>
      <div style={styles.panel} onMouseDown={e => e.stopPropagation()}>
        <div style={styles.header}>
          <div style={styles.titulo}>Historial del pedido</div>
          <button style={styles.btnCerrar} onClick={onCerrar}>✕</button>
        </div>

        {cargando && <div style={styles.vacio}>Cargando...</div>}
        {error && <div style={styles.error}>{error}</div>}
        {!cargando && !error && eventos.length === 0 && (
          <div style={styles.vacio}>Todavía no hay nada registrado.</div>
        )}

        <div style={styles.linea}>
          {eventos.map(ev => (
            <div
              key={ev.id}
              style={{ ...styles.evento, ...(ev.derivado ? styles.eventoDerivado : {}) }}
            >
              <div style={styles.eventoHeader}>
                <span style={styles.eventoAccion}>{etiquetaAccion(ev.accion)}</span>
                {ev.entidad_tipo && (
                  <span style={styles.pillEntidad}>
                    {ETIQUETA_ENTIDAD[ev.entidad_tipo] || ev.entidad_tipo}
                  </span>
                )}
                <span style={styles.eventoFecha}>{formatoFecha(ev.ts)}</span>
              </div>

              <div style={styles.eventoAutor}>
                {ev.usuario_nombre || 'Sin identificar'}
                {ev.derivado ? ' · automático' : ''}
              </div>

              {ev.razon && <div style={styles.eventoRazon}>Motivo: {ev.razon}</div>}

              {(ev.campos_modificados || []).length > 0 && (
                <div style={styles.eventoCambios}>
                  {ev.campos_modificados.map(campo => (
                    <div key={campo} style={styles.cambioLinea}>
                      <span style={styles.cambioCampo}>{campo}</span>
                      <span style={styles.cambioValor}>
                        {formatoValor(ev.antes ? ev.antes[campo] : undefined)}
                        {' → '}
                        {formatoValor(ev.despues ? ev.despues[campo] : undefined)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '1rem', zIndex: 100,
  },
  panel: {
    background: '#fff', borderRadius: 14, width: '100%', maxWidth: 560,
    maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 18px', borderBottom: '0.5px solid #E5E7EB', flexShrink: 0,
  },
  titulo: { fontSize: 15, fontWeight: 500, color: '#111827' },
  btnCerrar: {
    border: 'none', background: 'transparent', color: '#9CA3AF',
    fontSize: 16, cursor: 'pointer', padding: 4,
  },
  vacio: { textAlign: 'center', padding: '2rem 1rem', color: '#9CA3AF', fontSize: 13 },
  error: { padding: '1rem', color: '#B91C1C', fontSize: 13, textAlign: 'center' },
  linea: { overflowY: 'auto', padding: '10px 18px 18px' },
  evento: {
    padding: '10px 0', borderBottom: '0.5px solid #F3F4F6',
  },
  eventoDerivado: { opacity: 0.62 },
  eventoHeader: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 },
  eventoAccion: { fontSize: 13, fontWeight: 500, color: '#111827' },
  pillEntidad: {
    fontSize: 10, fontWeight: 500, color: '#6B7280', background: '#F3F4F6',
    padding: '1px 8px', borderRadius: 20,
  },
  eventoFecha: { fontSize: 11, color: '#9CA3AF', marginLeft: 'auto', fontFamily: 'monospace' },
  eventoAutor: { fontSize: 11, color: '#9CA3AF', marginBottom: 4 },
  eventoRazon: { fontSize: 12, color: '#92400E', marginBottom: 4 },
  eventoCambios: { display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 },
  cambioLinea: { display: 'flex', gap: 8, fontSize: 11.5, flexWrap: 'wrap' },
  cambioCampo: { color: '#9CA3AF', minWidth: 130, flexShrink: 0, fontFamily: 'monospace' },
  cambioValor: { color: '#374151' },
};
