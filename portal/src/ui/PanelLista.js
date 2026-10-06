/**
 * =============================================================================
 * PanelLista.js — v1.2.0 (rediseño NuevoTarifario)
 * =============================================================================
 *
 * SÍNTOMA
 *   `Programacion.js` dibuja un panel blanco (fondo/borde/radio/overflow)
 *   con una lista de filas, calculando a mano `esUltima={i === visibles.length
 *   - 1}` para que la última fila (`FilaPedido`) pueda sacarse su propio
 *   `borderBottom`. El rediseño de `NuevoTarifario.js` necesita el mismo
 *   contenedor "panel de filas" para sus propias listas (historial de
 *   tarifas, etc.), sin copiar ese cálculo de "es la última" cada vez.
 *
 * CAUSA RAÍZ
 *   No había versión reusable en `ui/` -- el chrome del panel (`panelLista`
 *   en `crearEstilos` de `Programacion.js`) y el cálculo de `esUltima`
 *   vivían juntos, mezclados con el contenido de cada fila.
 *
 * ALCANCE
 *   Componente de PRESENTACIÓN puro: aporta SOLO el contenedor (fondo
 *   blanco, borde, radio, overflow hidden -- mismos valores que ya tenía
 *   `styles.panelLista` en `Programacion.js`, vía tokens/`useTema()`, no
 *   hardcodeados) y pasa `esUltima` a quien arma cada fila. No sabe nada
 *   del contenido de una fila -- eso lo decide `render(item, index,
 *   esUltima)`, provisto por quien usa el componente.
 *   `Programacion.js` ahora pasa `items={visibles}` y
 *   `render={(x, i, esUltima) => <FilaPedido ... esUltima={esUltima} />}`;
 *   `FilaPedido` (el contenido/estilo de cada fila) se queda tal cual, local
 *   a `Programacion.js` -- solo cambia quién calcula "es la última".
 *
 * LIMITACIONES CONOCIDAS
 *   `vacio` es un `ReactNode` opcional que se muestra en vez del panel
 *   cuando `items` está vacío -- `Programacion.js` no lo usa hoy (sigue
 *   mostrando su propio `<Vacio>` por fuera, con su propia condición), así
 *   que viaja sin uso en esa pantalla; queda disponible para quien lo
 *   necesite.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. `Programacion.js`: la lista de
 *   pedidos se ve exactamente igual que antes de la extracción (mismo
 *   panel, misma última fila sin borde inferior), en claro y en oscuro.
 * ========================================================================== */

import React, { useMemo } from 'react';
import { useTema } from './TemaContext';
import { radioProgramacion } from './tokens';

/**
 * @param {Object} props
 * @param {Array} props.items
 * @param {(item: any, index: number, esUltima: boolean) => React.ReactNode} props.render
 *   El contenido de la fila, SIN el wrapper de fila -- quien llama decide su
 *   propio estilo de fila (borde, padding, hover...).
 * @param {React.ReactNode} [props.vacio] se muestra en vez del panel si `items` está vacío.
 */
export default function PanelLista({ items, render, vacio = null }) {
  const styles = useEstilos();
  if (!items || items.length === 0) return vacio;
  return (
    <div style={styles.panel}>
      {items.map((item, i) => render(item, i, i === items.length - 1))}
    </div>
  );
}

function crearEstilos(colores) {
  return {
    panel: {
      background: colores.superficie, border: `1px solid ${colores.borde}`,
      borderRadius: radioProgramacion.panel, overflow: 'hidden',
    },
  };
}

function useEstilos() {
  const { colores } = useTema();
  return useMemo(() => crearEstilos(colores), [colores]);
}
