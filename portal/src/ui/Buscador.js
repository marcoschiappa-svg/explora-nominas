/**
 * =============================================================================
 * Buscador.js — B1
 * =============================================================================
 *
 * El patrón de `BuscadorOrganizacion.js`: escribís, filtra una lista, elegís
 * uno. Generalizado para cualquier lista de opciones, no solo organizaciones
 * — un chofer, un camión, un producto.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ NO ES `BuscadorOrganizacion.js` RENOMBRADO TODAVÍA
 * -----------------------------------------------------------------------------
 * Este es el componente NUEVO y genérico. `BuscadorOrganizacion.js` sigue
 * existiendo tal cual está — migrarlo a usar este por debajo es trabajo de
 * "pantalla por pantalla" (la migración real de B1), no de hoy. Las pantallas
 * nuevas que necesiten este patrón ya pueden usar `Buscador.js` directo, sin
 * esperar a esa migración.
 *
 * USO
 *   <Buscador
 *     opciones={transportistas}
 *     obtenerTexto={(o) => o.razon_social}
 *     valor={form.transportistaId}
 *     onElegir={(id) => setForm({ ...form, transportistaId: id })}
 *     placeholder="Escribí para buscar..."
 *   />
 *
 * `opciones` necesita `id` en cada elemento — el resto de la forma es libre,
 * por eso `obtenerTexto` en vez de asumir un campo `nombre` fijo.
 * ========================================================================== */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { espacio, radio, tipografia } from './tokens';
import { useTema } from './TemaContext';

/** Sin acentos, sin mayúsculas, sin espacios de más — para que "Rio Primero" encuentre "Río Primero". */
function normalizar(texto) {
  return String(texto || '')
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function Buscador({
  opciones, obtenerTexto, valor, onElegir, placeholder = 'Escribí para buscar...',
}) {
  const { colores } = useTema();
  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(false);
  const contenedorRef = useRef(null);

  const elegido = opciones.find(o => o.id === valor) || null;

  const filtradas = useMemo(() => {
    if (!texto.trim()) return opciones;
    const buscado = normalizar(texto);
    return opciones.filter(o => normalizar(obtenerTexto(o)).indexOf(buscado) !== -1);
  }, [texto, opciones, obtenerTexto]);

  // Cierra si se clickea afuera.
  useEffect(() => {
    function alClickearFuera(e) {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target)) setAbierto(false);
    }
    document.addEventListener('mousedown', alClickearFuera);
    return () => document.removeEventListener('mousedown', alClickearFuera);
  }, []);

  return (
    <div ref={contenedorRef} style={{ position: 'relative' }}>
      <input
        style={{
          fontSize: tipografia.tamano.lg,
          padding: '9px 12px',
          borderRadius: radio.md,
          border: `0.5px solid ${colores.borde}`,
          color: colores.texto,
          background: colores.superficie,
          width: '100%',
          boxSizing: 'border-box',
          fontFamily: tipografia.familia,
        }}
        value={abierto ? texto : (elegido ? obtenerTexto(elegido) : '')}
        onFocus={() => { setTexto(''); setAbierto(true); }}
        onChange={e => setTexto(e.target.value)}
        placeholder={placeholder}
      />

      {abierto && (
        <div
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, marginTop: espacio.xs,
            background: colores.superficie, border: `0.5px solid ${colores.borde}`,
            borderRadius: radio.md, maxHeight: 220, overflowY: 'auto', zIndex: 20,
            boxShadow: '0 4px 14px rgba(0,0,0,0.1)',
          }}
        >
          {valor && (
            <div
              onClick={() => { onElegir(''); setTexto(''); setAbierto(false); }}
              style={{ padding: '8px 12px', fontSize: tipografia.tamano.md, color: colores.textoTenue, cursor: 'pointer' }}
            >
              — Quitar selección —
            </div>
          )}
          {filtradas.length === 0 && (
            <div style={{ padding: '8px 12px', fontSize: tipografia.tamano.md, color: colores.textoTenue }}>
              Sin resultados.
            </div>
          )}
          {filtradas.map(o => (
            <div
              key={o.id}
              onClick={() => { onElegir(o.id); setTexto(''); setAbierto(false); }}
              style={{
                padding: '8px 12px', fontSize: tipografia.tamano.lg, color: colores.texto, cursor: 'pointer',
                background: o.id === valor ? colores.fondoAlterno : 'transparent',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = colores.fondo; }}
              onMouseLeave={e => { e.currentTarget.style.background = o.id === valor ? colores.fondoAlterno : 'transparent'; }}
            >
              {obtenerTexto(o)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
