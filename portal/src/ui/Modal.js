/**
 * =============================================================================
 * Modal.js — B1
 * =============================================================================
 *
 * El overlay + panel centrado que ya está repetido, con pequeñas diferencias
 * de padding y radio, en `Home.js` (cambiar contraseña), `MisViajes.js`
 * (reportar demora) e `HistorialPedido.js`.
 *
 * `onCerrar` se dispara al clickear el fondo O apretar Escape — las dos
 * formas que alguien espera que cierren un modal, sin tener que acordarse de
 * armar las dos veces en cada pantalla nueva.
 *
 * USO
 *   <Modal titulo="Cambiar contraseña" onCerrar={() => setModalPass(false)}>
 *     <form>...</form>
 *   </Modal>
 *
 *   <Modal titulo="Historial" onCerrar={cerrar} ancho={560}>
 *     contenido con scroll propio si es largo
 *   </Modal>
 * ========================================================================== */

import React, { useEffect } from 'react';
import { espacio, radio, sombra, tipografia } from './tokens';
import { useTema } from './TemaContext';

export default function Modal({ titulo, onCerrar, ancho = 420, children }) {
  const { colores } = useTema();

  useEffect(() => {
    function alApretarTecla(e) {
      if (e.key === 'Escape') onCerrar();
    }
    document.addEventListener('keydown', alApretarTecla);
    return () => document.removeEventListener('keydown', alApretarTecla);
  }, [onCerrar]);

  return (
    <div
      onMouseDown={onCerrar}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: espacio.lg, zIndex: 1000,
      }}
    >
      <div
        onMouseDown={e => e.stopPropagation()}
        style={{
          background: colores.superficieModal, borderRadius: radio.xl, width: '100%', maxWidth: ancho,
          maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: sombra.modal,
        }}
      >
        {titulo && (
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 20px', borderBottom: `0.5px solid ${colores.borde}`, flexShrink: 0,
            }}
          >
            <div style={{ fontSize: tipografia.tamano.xl, fontWeight: tipografia.peso.medio, color: colores.texto }}>
              {titulo}
            </div>
            <button
              onClick={onCerrar}
              style={{ border: 'none', background: 'transparent', color: colores.textoTenue, fontSize: 16, cursor: 'pointer', padding: 4 }}
            >
              ✕
            </button>
          </div>
        )}
        <div style={{ padding: espacio.xl, overflowY: 'auto' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
