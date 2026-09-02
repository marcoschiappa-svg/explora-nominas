/**
 * =============================================================================
 * Pastilla.js — B1
 * =============================================================================
 *
 * El "pill" de estado que aparece en cada lista: "Nominado", "Cumplido",
 * "Sin cubrir"...
 *
 * -----------------------------------------------------------------------------
 * NO DEFINE COLORES DE ESTADO — LOS RECIBE
 * -----------------------------------------------------------------------------
 * `COLOR_DESPACHO`, `COLOR_PEDIDO`, `COLOR_ENTREGA` y `COLOR_VIAJE` YA están
 * definidos en `estados.js`, con la forma `{ bg, color }`. Eso es información
 * del DOMINIO (qué significa cada estado), no del diseño — vive ahí, no acá.
 * Este componente solo sabe pintar un par `{bg, color}` con la tipografía y el
 * padding correctos; no sabe qué es un despacho `NOMINADO`.
 *
 * Esos pares son fijos en los dos temas —no cambian con el modo oscuro, igual
 * que `colorEstado` en `tokens.js`—. Solo el fallback (cuando `colores` viene
 * undefined) usa el tema actual, para no quedar con un gris que no combine.
 *
 * USO
 *   import { COLOR_DESPACHO, ETIQUETA_DESPACHO } from '../estados';
 *   import Pastilla from '../ui/Pastilla';
 *
 *   <Pastilla colores={COLOR_DESPACHO[d.estado]}>
 *     {ETIQUETA_DESPACHO[d.estado] || d.estado}
 *   </Pastilla>
 * ========================================================================== */

import React from 'react';
import { radio, tipografia } from './tokens';
import { useTema } from './TemaContext';

export default function Pastilla({ colores, chico = false, children }) {
  const { colores: colorsDelTema } = useTema();
  const { bg, color: texto } = colores || { bg: colorsDelTema.fondoAlterno, color: colorsDelTema.textoSuave };

  return (
    <span
      style={{
        display: 'inline-block',
        background: bg,
        color: texto,
        // El relleno pastel de cada estado (bg) queda casi pegado al blanco
        // de Tarjeta en modo claro -- medido, 1.1:1 de contraste, invisible
        // como forma aunque el texto adentro se lea bien. Un borde en el
        // MISMO color que ya recibe la pastilla (texto, con alpha bajo) la
        // separa de la tarjeta sin sumar ningun color nuevo a la paleta, y
        // en modo oscuro no cambia nada porque ahi ya se distinguia sola.
        border: `1px solid ${texto}40`,
        boxSizing: 'border-box',
        fontSize: chico ? tipografia.tamano.xs : tipografia.tamano.sm,
        fontWeight: tipografia.peso.medio,
        padding: chico ? '2px 8px' : '3px 10px',
        borderRadius: radio.pastilla,
        flexShrink: 0,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}
