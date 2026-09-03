/**
 * =============================================================================
 * BuscadorOrganizacion.js — Elegir una organización escribiendo
 * =============================================================================
 *
 * POR QUÉ NO ES UN SELECT
 * Hoy hay 39 clientes y la lista va a crecer. Un desplegable con 39 opciones
 * obliga a recorrerlas con la vista o con el scroll; escribir tres letras es
 * más rápido y no se degrada con el tamaño.
 *
 * -----------------------------------------------------------------------------
 * OBLIGA A ELEGIR, NO ES TEXTO LIBRE
 * -----------------------------------------------------------------------------
 * Esta es la diferencia con el buscador de domicilios. Ahí lo que se escribe
 * puede terminar siendo una dirección nueva; acá el cliente tiene que existir.
 *
 * Si se escribe "Pro Crop" completo y no se elige nada de la lista, el campo
 * queda VACÍO. Es deliberado: el caso peor sería que el pedido se creara sin
 * cliente porque alguien escribió el nombre y no se dio cuenta de que faltaba
 * el clic.
 *
 * Cuando no hay ninguna coincidencia aparece el botón para crear la
 * organización ahí mismo, sin abandonar la carga del pedido.
 *
 * -----------------------------------------------------------------------------
 * BUSCA POR RAZÓN SOCIAL Y POR NOMBRE CORTO
 * -----------------------------------------------------------------------------
 * Escribir "PAE" tiene que encontrar "PAN AMERICAN ENERGY". Para eso existe
 * `nombre_corto`: en los 215 pedidos relevados, "PAE" y "Pan American Energy"
 * conviven como si fueran dos clientes distintos.
 * ========================================================================== */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { claveNormalizada } from '../mapa-normalizacion';

/**
 * Cuánto se parece lo tipeado a una organización.
 *
 * Prefijo y subcadena valen como coincidencia plena, y se busca tanto en la
 * razón social como en el nombre corto.
 *
 * No usa distancia de Levenshtein a propósito: acá el usuario está eligiendo de
 * una lista que ve, no escribiendo algo nuevo. Tolerar erratas mostraría
 * candidatos raros arriba de los que coinciden de verdad.
 */
function coincide(texto, org) {
  if (!texto) return true;
  const razon = claveNormalizada(org.razon_social);
  const corto = claveNormalizada(org.nombre_corto);
  return razon.includes(texto) || (corto && corto.includes(texto));
}

export default function BuscadorOrganizacion({
  organizaciones,
  valor,                    // el id elegido, o ''
  onElegir,
  onCrear = null,           // si se pasa, aparece el botón de alta
  placeholder = 'Escribí para buscar...',
  deshabilitado = false,
  etiquetaCrear = '+ Crear organización',
}) {
  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [resaltado, setResaltado] = useState(0);
  const contenedor = useRef(null);

  const elegida = useMemo(
    () => organizaciones.find(o => o.id === valor) || null,
    [organizaciones, valor]
  );

  const resultados = useMemo(() => {
    const t = claveNormalizada(texto);
    return organizaciones
      .filter(o => coincide(t, o))
      .sort((a, b) => a.razon_social.localeCompare(b.razon_social, 'es'))
      .slice(0, 8);
  }, [organizaciones, texto]);

  // Cerrar al hacer clic afuera. Sin esto, la lista queda abierta tapando los
  // campos de abajo.
  useEffect(() => {
    function alClickear(e) {
      if (contenedor.current && !contenedor.current.contains(e.target)) {
        setAbierto(false);
      }
    }
    document.addEventListener('mousedown', alClickear);
    return () => document.removeEventListener('mousedown', alClickear);
  }, []);

  function elegir(org) {
    onElegir(org.id);
    setTexto('');
    setAbierto(false);
  }

  function limpiar() {
    onElegir('');
    setTexto('');
    setAbierto(true);
  }

  /** Flechas para recorrer, Enter para elegir, Escape para cerrar. */
  function alTeclear(e) {
    if (!abierto) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setResaltado(r => Math.min(r + 1, resultados.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setResaltado(r => Math.max(r - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (resultados[resaltado]) elegir(resultados[resaltado]);
    } else if (e.key === 'Escape') {
      setAbierto(false);
    }
  }

  /* ── Ya hay una elegida ─────────────────────────────────────────────────── */

  if (elegida) {
    return (
      <div style={estilos.elegida}>
        <span style={estilos.elegidaNombre}>
          {elegida.razon_social}
          {elegida.nombre_corto && elegida.nombre_corto !== elegida.razon_social && (
            <span style={estilos.elegidaCorto}> · {elegida.nombre_corto}</span>
          )}
        </span>
        {!deshabilitado && (
          <button type="button" style={estilos.btnCambiar} onClick={limpiar}>
            Cambiar
          </button>
        )}
      </div>
    );
  }

  /* ── Buscando ───────────────────────────────────────────────────────────── */

  return (
    <div ref={contenedor} style={estilos.contenedor}>
      <input
        style={estilos.input}
        value={texto}
        disabled={deshabilitado}
        placeholder={placeholder}
        onChange={e => { setTexto(e.target.value); setAbierto(true); setResaltado(0); }}
        onFocus={() => setAbierto(true)}
        onKeyDown={alTeclear}
      />

      {abierto && (
        <div style={estilos.lista}>
          {resultados.map((o, i) => (
            <button
              key={o.id}
              type="button"
              style={{ ...estilos.opcion, background: i === resaltado ? '#F3F4F6' : '#fff' }}
              onMouseEnter={() => setResaltado(i)}
              onClick={() => elegir(o)}
            >
              <span>{o.razon_social}</span>
              {o.nombre_corto && o.nombre_corto !== o.razon_social && (
                <span style={estilos.opcionCorto}>{o.nombre_corto}</span>
              )}
            </button>
          ))}

          {resultados.length === 0 && (
            <div style={estilos.sinResultados}>
              No hay ninguna que coincida con "{texto}".
            </div>
          )}

          {onCrear && (
            <button
              type="button"
              style={estilos.opcionCrear}
              onClick={() => { setAbierto(false); onCrear(texto); }}
            >
              {etiquetaCrear}
              {texto ? ` "${texto}"` : ''}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const estilos = {
  contenedor: { position: 'relative' },
  input: { fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '0.5px solid #E5E7EB', color: '#111827', width: '100%', boxSizing: 'border-box' },
  lista: { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 2, background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', maxHeight: 260, overflowY: 'auto' },
  opcion: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', fontSize: 13, color: '#111827', cursor: 'pointer' },
  opcionCorto: { fontSize: 11, color: '#9CA3AF', flexShrink: 0 },
  opcionCrear: { width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', borderTop: '0.5px solid #E5E7EB', background: '#F9FAFB', fontSize: 12, color: '#C8102E', cursor: 'pointer' },
  sinResultados: { padding: '10px', fontSize: 12, color: '#9CA3AF' },
  elegida: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 10px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#F9FAFB' },
  elegidaNombre: { fontSize: 13, color: '#111827' },
  elegidaCorto: { fontSize: 11, color: '#9CA3AF' },
  btnCambiar: { border: 'none', background: 'none', color: '#C8102E', fontSize: 12, cursor: 'pointer', padding: 0, flexShrink: 0 },
};
