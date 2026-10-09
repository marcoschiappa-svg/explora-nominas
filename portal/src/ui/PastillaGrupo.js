/**
 * =============================================================================
 * PastillaGrupo.js — v1.2.0 (rediseño NuevoTarifario)
 * =============================================================================
 *
 * SÍNTOMA
 *   `Pedidos.js` definía `PastillaGrupo` como función de módulo local -- el
 *   mismo patrón de pastilla clickeable (prendida/apagada, con color de
 *   dominio opcional) que el rediseño de `NuevoTarifario.js` también
 *   necesita para sus propios grupos, sin que esa pantalla tuviera que
 *   copiar la definición una segunda vez.
 *
 * CAUSA RAÍZ
 *   No existía versión reusable en `ui/` -- vivía adentro de `Pedidos.js`,
 *   acoplada a nada en particular (ya era un componente de presentación
 *   puro), pero sin forma de importarla desde otra pantalla.
 *
 * ALCANCE
 *   Extracción 1:1 de la función que ya tenía `Pedidos.js`: mismo
 *   comportamiento exacto, incluido el fallback de color (`colores`
 *   undefined -> rojo de marca / fondo alterno del tema). `Pedidos.js` ahora
 *   la importa desde acá en vez de definirla local.
 *
 * LIMITACIONES CONOCIDAS
 *   Sigue sin saber qué es un "pedido" ni un "grupo" -- recibe `label` y
 *   `colores` ya resueltos por quien la usa (igual que antes).
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. `Pedidos.js`: las pastillas de
 *   estado (franja inferior del panel de filtros) se ven y funcionan igual
 *   que antes de la extracción.
 * ========================================================================== */

import React from 'react';
import { useTema } from './TemaContext';
import { marca, radio, tipografia } from '../shared/tokens';

export default function PastillaGrupo({ activo, onClick, label, colores }) {
  const { colores: coloresTema } = useTema();
  const bg = activo ? (colores ? colores.bg : marca) : coloresTema.fondoAlterno;
  const color = activo ? (colores ? colores.color : '#fff') : coloresTema.textoSuave;
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px', borderRadius: radio.pastilla, border: 'none', cursor: 'pointer',
        fontSize: tipografia.tamano.sm, fontWeight: activo ? tipografia.peso.negrita : tipografia.peso.normal,
        background: bg, color, whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}
