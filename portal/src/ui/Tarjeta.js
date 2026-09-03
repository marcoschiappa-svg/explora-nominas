/**
 * =============================================================================
 * Tarjeta.js — B1
 * =============================================================================
 *
 * El `card` que se repite en `Pedidos.js`, `Programacion.js`,
 * `MisDespachos.js`, `MisViajes.js`... — fondo blanco, borde suave, radio
 * grande. La franja de color de arriba (`cardBar`, la que usa `Home.js` para
 * marcar la categoría) es opcional: la mayoría de las listas no la necesitan.
 *
 * USO
 *   <Tarjeta>contenido</Tarjeta>
 *   <Tarjeta acento="#0F6E56">con franja de color arriba</Tarjeta>
 *   <Tarjeta onClick={() => setAbierto(id)}>clickeable, como el header de una fila</Tarjeta>
 * ========================================================================== */

import React from 'react';
import { radio, sombra } from './tokens';
import { useTema } from './TemaContext';

export default function Tarjeta({ acento, onClick, style, children, ...resto }) {
  const { colores } = useTema();

  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative',
        background: colores.superficie,
        border: `0.5px solid ${colores.borde}`,
        borderRadius: radio.xl,
        boxShadow: sombra.card,
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : 'default',
        ...style,
      }}
      {...resto}
    >
      {acento && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: acento }} />
      )}
      {children}
    </div>
  );
}
