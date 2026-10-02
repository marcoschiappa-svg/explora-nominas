/**
 * =============================================================================
 * Segmentado.js — v1.2.0 (rediseño NuevoTarifario)
 * =============================================================================
 *
 * SÍNTOMA
 *   `Pedidos.js` dibuja el mismo control "cápsula" (dos o más botones
 *   pegados, uno activo en rojo de marca) DOS veces en la misma franja --
 *   "Mis pedidos"/"Todos" y "▦ Tarjetas"/"☰ Tabla" -- con el JSX y los
 *   estilos (`toggleVista`/`toggleBtn`/`toggleBtnActivo`) repetidos a mano
 *   cada vez. El rediseño de `NuevoTarifario.js` necesita el mismo patrón
 *   para su propio conmutador, sin copiar el JSX una tercera vez.
 *
 * CAUSA RAÍZ
 *   No había versión genérica en `ui/` -- vivía como JSX inline en
 *   `Pedidos.js`, con los estilos en su propio `crearEstilos`, acoplado a
 *   nada en particular (no usa colores de dominio), pero sin forma de
 *   reusarlo desde otra pantalla.
 *
 * ALCANCE
 *   Componente de PRESENTACIÓN puro y genérico: recibe `opciones`
 *   (`[{id, label}]`), `valor` (el id activo) y `onCambiar(id)`. Estilos
 *   copiados TAL CUAL de `Pedidos.js` -- mismos paddings/radios, y los
 *   mismos colores que ya tenía ahí (`paletaPedidos(oscuro)`, la paleta
 *   cálida scoped a esa pantalla -- ver `ui/tokens.js`), para que el
 *   traslado a `ui/` no mueva un solo pixel. `Pedidos.js` ahora arma sus dos
 *   segmentados con este componente; el `<div style={controlesFila}>` que
 *   los envuelve a los dos se queda en `Pedidos.js` tal cual estaba (es el
 *   layout de esa pantalla, no de este control).
 *
 * LIMITACIONES CONOCIDAS
 *   No incluye el contenedor "cápsula doble" de `Pedidos.js` (`controlesFila`,
 *   el `<div>` que pone los dos segmentados uno al lado del otro con
 *   fondo/borde propio) -- cada pantalla sigue decidiendo cómo los acomoda.
 *   Al depender de `paletaPedidos()` (y no de los tokens generales del
 *   tema), este componente hoy se ve igual en cualquier pantalla que lo use
 *   -- si una pantalla futura necesita otra paleta, ese es trabajo aparte
 *   (no pedido acá: esta tarea es solo extraer lo que ya existía, sin
 *   cambiarle el aspecto a `Pedidos.js`).
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. `Pedidos.js`: "Mis pedidos"/"Todos"
 *   y "▦ Tarjetas"/"☰ Tabla" se ven y funcionan exactamente igual que antes
 *   de la extracción, en claro y en oscuro.
 * ========================================================================== */

import React, { useMemo } from 'react';
import { useTema } from './TemaContext';
import { marca, tipografia, radio, paletaPedidos } from './tokens';

/**
 * @param {Object} props
 * @param {Array<{id: string, label: React.ReactNode}>} props.opciones
 * @param {string} props.valor id de la opción activa
 * @param {(id: string) => void} props.onCambiar
 */
export default function Segmentado({ opciones, valor, onCambiar }) {
  const styles = useEstilos();
  return (
    <div style={styles.toggleVista}>
      {opciones.map(o => (
        <button
          key={o.id}
          style={{ ...styles.toggleBtn, ...(valor === o.id ? styles.toggleBtnActivo : {}) }}
          onClick={() => onCambiar(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function crearEstilos(oscuro) {
  const paleta = paletaPedidos(oscuro);
  return {
    toggleVista: { display: 'flex', border: `1px solid ${paleta.borde}`, borderRadius: radio.pastilla, overflow: 'hidden', flexShrink: 0 },
    toggleBtn: { padding: '7px 14px', fontSize: 12, background: 'transparent', color: paleta.textoSecundario, border: 'none', cursor: 'pointer', fontFamily: tipografia.familia },
    // Texto siempre blanco -- es sobre el rojo de marca, fijo en los dos temas.
    toggleBtnActivo: { background: marca, color: '#fff' },
  };
}

function useEstilos() {
  const { oscuro } = useTema();
  return useMemo(() => crearEstilos(oscuro), [oscuro]);
}
