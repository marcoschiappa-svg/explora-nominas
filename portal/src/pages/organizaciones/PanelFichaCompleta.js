/**
 * =============================================================================
 * organizaciones/PanelFichaCompleta.js — v1.2.2 (rediseño del modal)
 * =============================================================================
 *
 * SÍNTOMA
 *   El resumen anterior mostraba solo los primeros 4 usuarios ("Usuarios (7)"
 *   listaba 4 nombres) y la auditoría imprimía el `Timestamp` crudo.
 *
 * CAUSA RAÍZ
 *   `PanelResumen` cortaba con `slice(0, 4)` y hacía `String(actualizado_en)`.
 *
 * ALCANCE
 *   Columna derecha de "Datos generales": tarjeta "Ficha completa" (porcentaje,
 *   barra y checklist, con "Agregar →" que salta a la pestaña), tarjetas con
 *   contador por pestaña (clic abre la pestaña; con 0, "Sin cargar" y número
 *   en tono de alerta) y la línea de última modificación. Es de SOLO LECTURA:
 *   no bloquea nada. Todo el cálculo viene de `logica-ficha-organizacion.js`.
 *
 * LIMITACIONES CONOCIDAS
 *   En el alta no hay pestañas habilitadas: se muestra la ficha sin enlaces ni
 *   tarjetas.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Una organización cliente no muestra
 *   Usuarios ni Productos en la ficha ni en las tarjetas.
 * ========================================================================== */

import React from 'react';
import { marca, tipografia } from '../../shared/tokens';
import { Tarjeta, Icono, useTonos } from './piezas-modal-organizacion';

/**
 * @param {Object} p
 * @param {{items: Array, porcentaje: number}} p.ficha
 * @param {{id: string, etiqueta: string, cantidad: number, vista: string}[]} p.tarjetas
 * @param {string|null} p.ultimaModificacion null en el alta
 * @param {boolean} p.puedeNavegar false en el alta
 * @param {function} p.onIrA (idPestana) => void
 */
export default function PanelFichaCompleta({ ficha, tarjetas, ultimaModificacion, puedeNavegar, onIrA }) {
  const { colores, pal, tonos } = useTonos();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <Tarjeta style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 14, fontWeight: tipografia.peso.negrita }}>Ficha completa</span>
          <span style={{ fontSize: 22, fontWeight: tipografia.peso.fuerte, color: pal.rojo }}>{ficha.porcentaje}%</span>
        </div>
        <div
          role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={ficha.porcentaje}
          aria-label="Completitud de la ficha"
          style={{ height: 8, borderRadius: 999, background: colores.fondoAlterno, border: `0.5px solid ${colores.borde}`, overflow: 'hidden' }}
        >
          <div style={{ height: '100%', width: `${ficha.porcentaje}%`, background: marca, borderRadius: 999, transition: 'width .3s' }} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {ficha.items.map(item => (
            <div key={item.clave} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 25, fontSize: 13 }}>
              <span
                aria-hidden="true"
                style={{
                  width: 18, height: 18, borderRadius: '50%', boxSizing: 'border-box', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
                  background: item.ok ? tonos.exito.color : 'transparent',
                  border: `1.5px solid ${item.ok ? tonos.exito.color : colores.textoTenue}`,
                }}
              >
                {item.ok && <Icono nombre="check" tamano={10} grosor={3.6} />}
              </span>
              <span style={{ flexGrow: 1, color: item.ok ? colores.texto : colores.textoSuave }}>
                {item.etiqueta}
                {item.ok ? <span style={{ position: 'absolute', left: -9999 }}> (completo)</span> : <span style={{ position: 'absolute', left: -9999 }}> (falta)</span>}
              </span>
              {!item.ok && puedeNavegar && item.pestana !== 'general' && (
                <button
                  type="button" onClick={() => onIrA(item.pestana)}
                  style={{ border: 'none', background: 'transparent', color: pal.azul, font: 'inherit', fontSize: 12.5, fontWeight: tipografia.peso.medio, cursor: 'pointer', padding: '4px 6px', textDecoration: 'underline' }}
                >
                  Agregar →
                </button>
              )}
            </div>
          ))}
        </div>
      </Tarjeta>

      {puedeNavegar && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          {tarjetas.map(t => (
            <Tarjeta
              key={t.id} onClick={() => onIrA(t.id)}
              style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 4, minHeight: 78 }}
            >
              <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <span style={{ fontSize: 12, fontWeight: tipografia.peso.negrita, color: colores.textoSuave, letterSpacing: '.3px', textTransform: 'uppercase' }}>{t.etiqueta}</span>
                <span style={{ color: colores.textoTenue, display: 'flex' }}><Icono nombre="flecha" tamano={14} /></span>
              </span>
              <span style={{ fontSize: 22, fontWeight: tipografia.peso.fuerte, lineHeight: 1.1, color: t.cantidad === 0 ? tonos.peligro.color : colores.texto }}>
                {t.cantidad}
              </span>
              <span style={{ fontSize: 12, color: colores.textoSuave, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>
                {t.cantidad === 0 ? 'Sin cargar' : t.vista}
              </span>
            </Tarjeta>
          ))}
        </div>
      )}

      {ultimaModificacion && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: colores.textoSuave, padding: '0 4px' }}>
          <Icono nombre="reloj" tamano={14} />
          <span>{ultimaModificacion}</span>
        </div>
      )}
    </div>
  );
}
