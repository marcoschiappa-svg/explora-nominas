/**
 * =============================================================================
 * organizaciones/PestanaProductos.js — v1.2.2 (rediseño del modal)
 * =============================================================================
 *
 * SÍNTOMA
 *   La pestaña Productos del modal rediseñado: chips con "x" y un selector
 *   para agregar, con escritura inmediata.
 *
 * CAUSA RAÍZ
 *   El checklist de `ModalProductos` exige "Guardar" y reescribe el array
 *   entero.
 *
 * ALCANCE
 *   Presentación. Cada alta o baja llama a `onAgregar(id)` / `onQuitar(id)`
 *   (el modal escribe con `cambiarProductoDeclarado()`, una transacción por
 *   cambio). El selector ofrece los mismos productos que `ModalProductos`:
 *   activos y no genéricos, que todavía no estén declarados; con buscador si
 *   hay más de 10. Los chips se resuelven contra TODOS los productos, así uno
 *   desactivado sigue mostrando su nombre. Solo transportistas.
 *
 * LIMITACIONES CONOCIDAS
 *   Un ID declarado que ya no existe en `productos` no se muestra (igual que
 *   en `ModalProductos`) pero tampoco se pierde.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Agregar y quitar actualiza los chips
 *   al instante; sin permiso de edición no hay selector ni "x".
 * ========================================================================== */

import React, { useMemo, useState } from 'react';
import Boton from '../../ui/Boton';
import { tipografia } from '../../shared/tokens';
import { Icono, EstadoVacio, useTonos } from './piezas-modal-organizacion';

export default function PestanaProductos({ org, productos, puedeEditar, ocupado, onAgregar, onQuitar }) {
  const { colores } = useTonos();
  const [elegido, setElegido] = useState('');
  const [busqueda, setBusqueda] = useState('');

  const declarados = useMemo(() => org.productos_ids || [], [org.productos_ids]);
  const porId = useMemo(() => new Map(productos.map(p => [p.id, p])), [productos]);

  const ofrecidos = useMemo(() => {
    const base = productos
      .filter(p => p.activo !== false && !p.es_generico && !declarados.includes(p.id))
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
    if (base.length <= 10 || !busqueda.trim()) return base;
    const texto = busqueda.trim().toLowerCase();
    return base.filter(p => (p.nombre || '').toLowerCase().includes(texto));
  }, [productos, declarados, busqueda]);

  const hayMuchos = productos.filter(p => p.activo !== false && !p.es_generico).length > 10;
  const estiloInput = {
    width: '100%', boxSizing: 'border-box', height: 42, padding: '0 14px', borderRadius: 10,
    border: `1.5px solid ${colores.borde}`, background: colores.superficie, color: colores.texto,
    fontFamily: tipografia.familia, fontSize: 14,
  };

  async function agregar() {
    if (!elegido) return;
    await onAgregar(elegido);
    setElegido('');
  }

  const chips = declarados.map(id => porId.get(id)).filter(Boolean);

  return (
    <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 760 }}>
      {puedeEditar && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          {hayMuchos && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexGrow: 1, minWidth: 180 }}>
              <label htmlFor="f-prod-buscar" style={{ fontSize: 12, fontWeight: tipografia.peso.negrita, color: colores.textoSecundario }}>Buscar</label>
              <input id="f-prod-buscar" style={estiloInput} value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar producto…" />
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexGrow: 2, minWidth: 220 }}>
            <label htmlFor="f-prod" style={{ fontSize: 12, fontWeight: tipografia.peso.negrita, color: colores.textoSecundario }}>Habilitar producto</label>
            <select id="f-prod" style={estiloInput} value={elegido} onChange={e => setElegido(e.target.value)}>
              <option value="">{ofrecidos.length === 0 ? 'No hay productos para agregar' : 'Elegir…'}</option>
              {ofrecidos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
          <Boton disabled={!elegido || ocupado} onClick={agregar} style={{ height: 42, padding: '0 20px' }}>Agregar</Boton>
        </div>
      )}

      {chips.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {chips.map(p => (
            <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: puedeEditar ? '6px 6px 6px 14px' : '6px 14px', borderRadius: 999, background: colores.superficie, border: `1.5px solid ${colores.borde}`, fontSize: 13.5, color: colores.texto, fontFamily: tipografia.familia }}>
              {p.nombre}{p.activo === false ? ' (inactivo)' : ''}
              {puedeEditar && (
                <button
                  type="button" aria-label={`Quitar ${p.nombre}`} disabled={ocupado} onClick={() => onQuitar(p.id)}
                  style={{ width: 26, height: 26, borderRadius: '50%', border: 'none', background: 'transparent', color: colores.textoSuave, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Icono nombre="cerrar" tamano={13} grosor={2.4} />
                </button>
              )}
            </span>
          ))}
        </div>
      ) : (
        <EstadoVacio icono="caja" titulo="Sin productos habilitados" texto="Programación avisa si el transportista elegido no declaró el producto del pedido; no bloquea la asignación." />
      )}
    </div>
  );
}
