/**
 * =============================================================================
 * organizaciones/ArmazonModalOrganizacion.js — v1.2.2 (rediseño del modal)
 * =============================================================================
 *
 * SÍNTOMA
 *   El modal de organización rediseñado necesita encabezado propio, pestañas,
 *   cuerpo con scroll interno y pie, en un panel de `min(1120px, 96vw)` por
 *   `min(760px, 92vh)`.
 *
 * CAUSA RAÍZ
 *   `ui/Modal.js` solo ofrece un título fijo, `ancho`/`alto` como máximos y un
 *   cuerpo con padding propio: no tiene pestañas ni pie, ni `role="dialog"`.
 *   Decisión cerrada: no se modifica `Modal.js` (lo usan todas las pantallas).
 *
 * ALCANCE
 *   Solo estructura, ninguna lógica de datos. `role="dialog"` + `aria-modal`,
 *   `role="tablist"`/`tab`/`tabpanel` con `aria-selected` y flechas
 *   izquierda/derecha, foco inicial en el panel y devolución del foco al
 *   cerrar, Esc y clic en el fondo cierran (misma regla que `Modal.js`; quien
 *   lo usa decide si pide confirmación antes de descartar cambios).
 *
 * LIMITACIONES CONOCIDAS
 *   No atrapa el foco con Tab (tampoco lo hace `Modal.js`).
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Esc y clic afuera cierran; las
 *   pestañas deshabilitadas no se pueden elegir.
 * ========================================================================== */

import React, { useEffect, useRef } from 'react';
import { marca, sombra, tipografia } from '../../shared/tokens';
import { Chip, Avatar, Icono, useTonos } from './piezas-modal-organizacion';

/**
 * @param {Object} p
 * @param {{iniciales: string, nombre: string, cuit: string, activa: boolean|null,
 *          roles: string[], sinGuardar: boolean}} p.cabecera
 * @param {{id: string, etiqueta: string, cantidad?: number, deshabilitada?: boolean,
 *          ayuda?: string}[]} p.pestanas
 * @param {string} p.pestanaActiva
 * @param {function} p.onElegirPestana
 * @param {function} p.onCerrar
 * @param {React.ReactNode} p.pie
 */
export default function ArmazonModalOrganizacion({
  cabecera, pestanas, pestanaActiva, onElegirPestana, onCerrar, pie, children,
}) {
  const { colores, pal, tonos } = useTonos();
  const panelRef = useRef(null);

  useEffect(() => {
    const previo = document.activeElement;
    if (panelRef.current) panelRef.current.focus();
    return () => { if (previo && previo.focus) previo.focus(); };
  }, []);

  useEffect(() => {
    function alApretarTecla(e) { if (e.key === 'Escape') onCerrar(); }
    document.addEventListener('keydown', alApretarTecla);
    return () => document.removeEventListener('keydown', alApretarTecla);
  }, [onCerrar]);

  function alTeclearEnPestana(e, indice) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const paso = e.key === 'ArrowRight' ? 1 : -1;
    for (let i = 1; i <= pestanas.length; i++) {
      const candidata = pestanas[(indice + paso * i + pestanas.length * 2) % pestanas.length];
      if (!candidata.deshabilitada) { onElegirPestana(candidata.id); break; }
    }
  }

  return (
    <div
      onMouseDown={onCerrar}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.5)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        // Margen superior: la barra del portal (y el cartel de entorno de
        // prueba) quedan por encima del overlay, así que el panel no puede
        // llegar hasta arriba.
        boxSizing: 'border-box', padding: '96px 16px 20px',
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="org-titulo"
        onMouseDown={e => e.stopPropagation()}
        style={{
          width: 'min(1120px, 100%)', height: 'min(860px, 100%)', borderRadius: 18,
          background: colores.superficieModal, color: colores.texto, boxShadow: sombra.modal,
          display: 'flex', flexDirection: 'column', overflow: 'hidden', outline: 'none',
          fontFamily: tipografia.familia,
        }}
      >
        {/* Encabezado */}
        <div style={{ padding: '16px 28px 12px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', flexShrink: 0 }}>
          <Avatar texto={cabecera.iniciales} tamano={52} redondo={false} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexGrow: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h2 id="org-titulo" style={{ margin: 0, fontSize: 21, fontWeight: tipografia.peso.negrita, color: colores.texto }}>
                {cabecera.nombre}
              </h2>
              {cabecera.activa === true && <Chip tono="exito" punto>Activa</Chip>}
              {cabecera.activa === false && <Chip tono="peligro">Dada de baja</Chip>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: colores.textoSuave, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'monospace', fontSize: 12.5, color: colores.textoSecundario }}>{cabecera.cuit}</span>
              {cabecera.roles.map(r => <Chip key={r} tono="aviso">{r}</Chip>)}
            </div>
          </div>
          {cabecera.sinGuardar && <Chip tono="aviso" punto>Cambios sin guardar</Chip>}
          <button
            type="button" aria-label="Cerrar" onClick={onCerrar}
            style={{ width: 44, height: 44, borderRadius: 12, border: 'none', background: 'transparent', color: colores.textoSuave, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <Icono nombre="cerrar" tamano={20} />
          </button>
        </div>

        {/* Pestañas */}
        <div role="tablist" aria-label="Secciones de la organización" style={{ display: 'flex', gap: 4, padding: '0 20px', borderBottom: `1px solid ${colores.borde}`, overflowX: 'auto', overflowY: 'hidden', flexShrink: 0 }}>
          {pestanas.map((p, i) => {
            const activa = p.id === pestanaActiva;
            const cero = p.cantidad === 0;
            return (
              <button
                key={p.id} type="button" role="tab" id={`tab-${p.id}`} aria-selected={activa}
                aria-controls="panel-org" aria-disabled={p.deshabilitada || undefined}
                tabIndex={activa ? 0 : -1} disabled={p.deshabilitada} title={p.deshabilitada ? p.ayuda : undefined}
                onClick={() => onElegirPestana(p.id)} onKeyDown={e => alTeclearEnPestana(e, i)}
                style={{
                  height: 44, padding: '0 14px', border: 'none', background: 'transparent', cursor: p.deshabilitada ? 'not-allowed' : 'pointer',
                  fontFamily: tipografia.familia, fontSize: 14, fontWeight: activa ? tipografia.peso.negrita : tipografia.peso.normal,
                  color: p.deshabilitada ? colores.textoTenue : (activa ? pal.rojo : colores.textoSecundario),
                  borderBottom: `2.5px solid ${activa ? marca : 'transparent'}`,
                  display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', borderRadius: '8px 8px 0 0',
                }}
              >
                {p.etiqueta}
                {typeof p.cantidad === 'number' && (
                  <span
                    style={{
                      minWidth: 20, height: 20, padding: '0 6px', boxSizing: 'border-box', borderRadius: 999,
                      fontSize: 11.5, fontWeight: tipografia.peso.negrita, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      background: cero ? tonos.peligro.bg : (activa ? marca : colores.fondoAlterno),
                      color: cero ? tonos.peligro.color : (activa ? '#fff' : colores.textoSecundario),
                    }}
                  >
                    {p.cantidad}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Cuerpo */}
        <div
          role="tabpanel" id="panel-org" aria-labelledby={`tab-${pestanaActiva}`}
          style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column' }}
        >
          {children}
        </div>

        {/* Pie */}
        <div style={{ borderTop: `1px solid ${colores.borde}`, padding: '12px 28px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: colores.fondoAlterno }}>
          {pie}
        </div>
      </div>
    </div>
  );
}
