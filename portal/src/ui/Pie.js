/**
 * =============================================================================
 * Pie.js — B1: el pie de página con el sello del build
 * =============================================================================
 *
 * PROPÓSITO
 * Mostrar qué código está corriendo, abajo de cualquier pantalla — para saber
 * de un vistazo si lo que se está viendo en producción (o en staging) es lo
 * último, sin tener que preguntar en el chat "¿ya subiste el cambio?".
 *
 * -----------------------------------------------------------------------------
 * DE DÓNDE SALE EL DATO
 * -----------------------------------------------------------------------------
 * `REACT_APP_VERSION` (el tag de Git más cercano, tipo "v1.2.0") y
 * `REACT_APP_BUILD_DATE`, dos variables que `scripts/preparar-build.js`
 * escribe SOLO, en cada build, antes de que corra `react-scripts build` —
 * ver ese archivo para el detalle completo, incluido el único paso manual
 * real que queda: taggear (`git tag v1.2.0`) cuando se corta una versión.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ AHORA RESPETA EL TEMA
 * -----------------------------------------------------------------------------
 * Antes tenía un solo color fijo. Con `TemaProvider` envolviendo todo el
 * portal, el pie tiene que verse bien en los dos modos igual que la barra
 * superior — sería raro que todo lo de arriba cambie a oscuro y la última
 * línea de la pantalla se quede clara.
 *
 * -----------------------------------------------------------------------------
 * DÓNDE SE ENGANCHA
 * -----------------------------------------------------------------------------
 * Un solo lugar: `App.js`, envolviendo TODO —incluida la pantalla de login y
 * la de carga—, no adentro de cada pantalla.
 * ========================================================================== */

import React from 'react';
import { tipografia } from './tokens';
import { useTema } from './TemaContext';

export default function Pie() {
  const { colores } = useTema();
  const version = process.env.REACT_APP_VERSION || 'dev';
  const fecha = process.env.REACT_APP_BUILD_DATE || '';

  return (
    <div
      style={{
        textAlign: 'center',
        padding: '10px 16px',
        fontSize: tipografia.tamano.xs,
        color: colores.textoTenue,
        fontFamily: tipografia.familia,
        background: colores.fondo,
      }}
    >
      Portal Explora · {version}{fecha ? ` · ${fecha}` : ''}
    </div>
  );
}
