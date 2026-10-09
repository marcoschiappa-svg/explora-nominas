/* =============================================================================
 * SelectorTransportista.js — v1.2.0 (rediseño Programación)
 * =============================================================================
 *
 * SÍNTOMA
 *   `Programacion.js` pasaba las ~2000 líneas que el prompt de la tarea pide
 *   evitar ("se puede partir en componentes... si supera unas 700 líneas").
 *
 * CAUSA RAÍZ
 *   Este componente (RF-08: agrupa transportistas por si declaran el
 *   producto del pedido) no tiene ninguna dependencia del resto del archivo
 *   más allá de los props que ya recibía -- es una extracción pura, sin
 *   cambio de comportamiento.
 *
 * ALCANCE
 *   Movido tal cual desde `Programacion.js` (mismo componente, misma lógica
 *   de `agruparTransportistasPorProducto()`, mismos estilos) a su propio
 *   archivo. `Programacion.js` y `ModalDetallePedido.js` lo importan.
 *   `agruparTransportistasPorProducto` sigue exportada con el mismo nombre --
 *   `Programacion.test.js` la sigue pudiendo testear, solo cambia de dónde se
 *   importa (`./programacion/SelectorTransportista`, re-exportada también
 *   desde `Programacion.js` para no romper el import existente del test).
 *
 * LIMITACIONES CONOCIDAS
 *   Las mismas de RF-08 -- ver el encabezado v1.2.0 (RF-08) que tenía
 *   `Programacion.js` antes de este rediseño (se conserva el texto en el
 *   historial de git): un transportista que declaró el producto y después lo
 *   desactivó en `Productos.js` sigue contando como "declara" acá.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm test -- Programacion` (los tests de
 *   `agruparTransportistasPorProducto` siguen en verde, ahora importando
 *   desde el archivo nuevo). `CI=true npm run build` sin warnings.
 * ========================================================================== */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { claveNormalizada } from '../../mapa-normalizacion';
import { marca, colorEstado, radio, tipografia, paletaTexto } from '../../shared/tokens';
import { useTema } from '../../ui/TemaContext';

/** Iniciales para el avatar del selector: "Transportes ABC" -> "TA". */
function inicialesDe(nombre) {
  const palabras = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return '?';
  if (palabras.length === 1) return palabras[0].slice(0, 2).toUpperCase();
  return (palabras[0][0] + palabras[1][0]).toUpperCase();
}

// Reparte los acentos que YA existen en tokens.js entre los avatares --
// ningun color nuevo entra a la paleta.
const PALETA_AVATARES = [
  colorEstado.acentoPurpura, colorEstado.acentoVerde, colorEstado.acentoAzul,
  colorEstado.acentoAmbar, colorEstado.acentoAzulFuerte, marca,
];

function colorAvatarDe(nombre) {
  const texto = String(nombre || '');
  let hash = 0;
  for (let i = 0; i < texto.length; i++) hash = (hash * 31 + texto.charCodeAt(i)) >>> 0;
  return PALETA_AVATARES[hash % PALETA_AVATARES.length];
}

/**
 * v1.2.0 (RF-08) -- Agrupa los transportistas según si declaran el producto
 * del pedido (`org.productos_ids`). `null` si no hay producto o es genérico.
 *
 * @param {Array} transportistas
 * @param {Object|null} producto
 * @returns {{declaran: Array, noDeclaran: Array}|null}
 */
export function agruparTransportistasPorProducto(transportistas, producto) {
  if (!producto || producto.es_generico) return null;

  const declaran = [];
  const noDeclaran = [];
  transportistas.forEach(t => {
    if ((t.productos_ids || []).includes(producto.id)) declaran.push(t);
    else noDeclaran.push(t);
  });

  const porNombre = (a, b) => a.razon_social.localeCompare(b.razon_social, 'es');
  return { declaran: declaran.sort(porNombre), noDeclaran: noDeclaran.sort(porNombre) };
}

export default function SelectorTransportista({ transportistas, producto = null, valor, onElegir, permitirVacio = true, notaVacio }) {
  const styles = useEstilos();
  const { colores } = useTema();
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const contenedorRef = useRef(null);

  const elegido = transportistas.find(t => t.id === valor) || null;

  const grupos = useMemo(
    () => agruparTransportistasPorProducto(transportistas, producto),
    [transportistas, producto]
  );

  const conTexto = useCallback((lista) => {
    const texto = claveNormalizada(busqueda);
    if (!texto) return lista;
    return lista.filter(t => claveNormalizada(t.razon_social).includes(texto));
  }, [busqueda]);

  const filtrados = useMemo(() => conTexto(transportistas), [transportistas, conTexto]);
  const declaranFiltrados = useMemo(() => (grupos ? conTexto(grupos.declaran) : []), [grupos, conTexto]);
  const noDeclaranFiltrados = useMemo(() => (grupos ? conTexto(grupos.noDeclaran) : []), [grupos, conTexto]);

  useEffect(() => {
    function alClickearFuera(e) {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target)) {
        setAbierto(false);
        setBusqueda('');
      }
    }
    document.addEventListener('mousedown', alClickearFuera);
    return () => document.removeEventListener('mousedown', alClickearFuera);
  }, []);

  // RF-08: elegir uno del grupo "No declaran este producto" pide
  // confirmación -- no bloquea, solo avisa.
  function elegir(id, pedirConfirmacion = false) {
    if (pedirConfirmacion) {
      const t = transportistas.find(x => x.id === id);
      const nombre = t ? t.razon_social : 'Este transportista';
      const ok = window.confirm(`${nombre} no declara que transporte ${producto.nombre}. ¿Asignarlo igual?`);
      if (!ok) return;
    }
    onElegir(id);
    setAbierto(false);
    setBusqueda('');
  }

  function FilaTransportista({ t, pedirConfirmacion = false, sufijo = '' }) {
    const activo = t.id === valor;
    return (
      <button
        type="button" onClick={() => elegir(t.id, pedirConfirmacion)}
        style={{ ...styles.selectorFila, ...(activo ? styles.selectorFilaActiva : {}) }}
        onMouseEnter={e => { if (!activo) e.currentTarget.style.background = colores.fondo; }}
        onMouseLeave={e => { e.currentTarget.style.background = activo ? colores.fondoAlterno : 'transparent'; }}
      >
        <span style={{ ...styles.selectorAvatarChico, background: colorAvatarDe(t.razon_social), color: '#fff' }}>
          {inicialesDe(t.razon_social)}
        </span>
        <span style={styles.selectorFilaTexto}>{t.razon_social}{sufijo}</span>
        {activo && <span style={styles.selectorCheck}>✓</span>}
      </button>
    );
  }

  return (
    <div ref={contenedorRef} style={styles.selectorTransportista}>
      <label style={styles.label}>Transportista{permitirVacio ? '' : ' *'}</label>

      <div style={styles.selectorAncla}>
        <button type="button" style={styles.selectorControl} onClick={() => setAbierto(v => !v)}>
          {elegido ? (
            <>
              <span style={{ ...styles.selectorAvatar, background: colorAvatarDe(elegido.razon_social) }}>
                {inicialesDe(elegido.razon_social)}
              </span>
              <span style={styles.selectorTexto}>{elegido.razon_social}</span>
            </>
          ) : (
            <span style={styles.selectorPlaceholder}>Sin transportista</span>
          )}
          <span style={styles.selectorFlecha}>{abierto ? '▲' : '▼'}</span>
        </button>

        {abierto && (
          <div style={styles.selectorPanel}>
            <input
              autoFocus
              style={styles.selectorBusqueda}
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar transportista..."
            />
            <div style={styles.selectorLista}>
              {permitirVacio && (
                <button
                  type="button" onClick={() => elegir('')}
                  style={{ ...styles.selectorFila, ...(!valor ? styles.selectorFilaActiva : {}) }}
                  onMouseEnter={e => { if (valor) e.currentTarget.style.background = colores.fondo; }}
                  onMouseLeave={e => { e.currentTarget.style.background = !valor ? colores.fondoAlterno : 'transparent'; }}
                >
                  <span style={{ ...styles.selectorAvatarChico, background: colores.fondoAlterno, color: colores.textoTenue }}>—</span>
                  <span style={styles.selectorFilaTexto}>Sin transportista</span>
                  {!valor && <span style={styles.selectorCheck}>✓</span>}
                </button>
              )}
              {!grupos && filtrados.map(t => <FilaTransportista key={t.id} t={t} />)}
              {!grupos && filtrados.length === 0 && <div style={styles.selectorVacio}>Sin resultados.</div>}

              {grupos && (
                <>
                  {declaranFiltrados.length > 0 && (
                    <>
                      <div style={styles.selectorGrupoTitulo}>Declaran {producto.nombre}</div>
                      {declaranFiltrados.map(t => <FilaTransportista key={t.id} t={t} />)}
                    </>
                  )}
                  {noDeclaranFiltrados.length > 0 && (
                    <>
                      <div style={styles.selectorGrupoTitulo}>No declaran este producto</div>
                      {noDeclaranFiltrados.map(t => (
                        <FilaTransportista
                          key={t.id}
                          t={t}
                          pedirConfirmacion
                          sufijo={(t.productos_ids || []).length === 0 ? ' (sin productos declarados)' : ''}
                        />
                      ))}
                    </>
                  )}
                  {declaranFiltrados.length === 0 && noDeclaranFiltrados.length === 0 && (
                    <div style={styles.selectorVacio}>Sin resultados.</div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {notaVacio && <span style={styles.ayuda}>{notaVacio}</span>}
    </div>
  );
}

function crearEstilos(colores, oscuro) {
  const pal = paletaTexto(oscuro);
  return {
    label: { fontSize: 11, color: pal.azul, fontWeight: tipografia.peso.medio },
    ayuda: { fontSize: 11, color: pal.azul, lineHeight: 1.4 },

    selectorTransportista: { display: 'flex', flexDirection: 'column', gap: 6 },
    selectorAncla: { position: 'relative' },
    selectorControl: {
      display: 'flex', alignItems: 'center', gap: 8, width: '100%', boxSizing: 'border-box',
      textAlign: 'left', padding: '9px 12px', borderRadius: radio.xl,
      border: `1px solid ${colores.borde}`, background: colores.superficie, cursor: 'pointer',
      fontSize: 13, color: colores.texto, fontFamily: tipografia.familia,
    },
    selectorAvatar: {
      width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 10, fontWeight: tipografia.peso.negrita, color: '#fff', flexShrink: 0,
    },
    selectorTexto: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: tipografia.peso.medio },
    selectorPlaceholder: { flex: 1, color: pal.rojo },
    selectorFlecha: { fontSize: 10, color: pal.azul, flexShrink: 0 },
    selectorPanel: {
      position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 30,
      background: colores.superficie, border: `1px solid ${colores.borde}`, borderRadius: radio.xl,
      boxShadow: '0 10px 30px rgba(0,0,0,0.18)', overflow: 'hidden',
    },
    selectorBusqueda: {
      width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 12, border: 'none',
      borderBottom: `1px solid ${colores.borde}`, background: 'transparent', color: colores.texto, outline: 'none',
      fontFamily: tipografia.familia,
    },
    selectorLista: { maxHeight: 220, overflowY: 'auto' },
    selectorFila: {
      display: 'flex', alignItems: 'center', gap: 8, width: '100%', boxSizing: 'border-box', textAlign: 'left',
      padding: '9px 12px', border: 'none', background: 'transparent', cursor: 'pointer',
      fontSize: 13, color: colores.texto, fontFamily: tipografia.familia,
    },
    selectorFilaActiva: { background: colores.fondoAlterno, fontWeight: tipografia.peso.medio },
    selectorAvatarChico: {
      width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 9, fontWeight: tipografia.peso.negrita, flexShrink: 0,
    },
    selectorFilaTexto: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    selectorCheck: { color: marca, fontWeight: tipografia.peso.negrita, flexShrink: 0 },
    selectorVacio: { padding: '10px 12px', fontSize: 12, color: pal.rojo },
    selectorGrupoTitulo: {
      padding: '6px 12px 2px', fontSize: 10, color: pal.azul, textTransform: 'uppercase',
      letterSpacing: '0.05em', fontWeight: tipografia.peso.medio,
    },
  };
}

function useEstilos() {
  const { colores, oscuro } = useTema();
  return useMemo(() => crearEstilos(colores, oscuro), [colores, oscuro]);
}
