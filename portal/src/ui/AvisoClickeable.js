/**
 * =============================================================================
 * AvisoClickeable.js — v1.2.0 (rediseño NuevoTarifario)
 * =============================================================================
 *
 * SÍNTOMA
 *   `Pedidos.js` dibuja una franja de "avisos clickeables" (banner que
 *   prende/apaga un filtro al tocarlo -- "N entrega(s) vencida(s) sin
 *   cubrir", "N entrega(s) sin cubrir") más un tercer aviso sin color ni
 *   click ("N programada(s) esta semana"), todo como JSX inline con sus
 *   estilos locales. El rediseño de `NuevoTarifario.js` necesita el mismo
 *   patrón de "banner de aviso que togglea un filtro" para sus propios
 *   avisos, sin copiar el bloque una segunda vez.
 *
 * CAUSA RAÍZ
 *   No había versión reusable en `ui/` -- el patrón (botón pastilla,
 *   color semántico peligro/advertencia, estado "prendido" cuando el
 *   filtro está activo) vivía atado al JSX puntual de `Pedidos.js`.
 *
 * ALCANCE
 *   Tres componentes de PRESENTACIÓN puros, estilos copiados TAL CUAL de
 *   `Pedidos.js` (`franjaResumen`, `avisoBtn`, `avisoBtnPeligro`,
 *   `avisoBtnAdvertencia`, `avisoBtnActivo`, `avisoNeutro` -- colores de
 *   `colorEstado`, fijos en los dos temas, y `paletaPedidos(oscuro)` para el
 *   texto neutro, igual que antes):
 *     - `FranjaAvisos` -- el contenedor (`franjaResumen`). No decide si se
 *       muestra o no: el padre sigue controlando eso con su propia
 *       condición, igual que hoy (`resumen.vencidas > 0 || ...`).
 *     - `AvisoClickeable` (default) -- un botón de aviso. `tipo` elige el
 *       color semántico (`'peligro'` | `'advertencia'`), `activo` marca el
 *       estado "prendido" (el filtro ya puesto), `onClick` togglea -- el
 *       propio criterio de toggle (clic de nuevo apaga) se queda en
 *       `Pedidos.js`, que ya lo tenía en `setAvisoFiltro`.
 *     - `AvisoNeutro` -- el tercer aviso, sin color ni click (hoy un
 *       `<span>` con "programada(s) esta semana").
 *   `Pedidos.js` ahora arma ese bloque con estos tres componentes en vez de
 *   JSX inline, mismo comportamiento de toggle exacto.
 *
 * LIMITACIONES CONOCIDAS
 *   Solo dos `tipo` (`peligro`/`advertencia`) -- los dos que ya existían.
 *   Agregar un tercero (p.ej. "éxito") es agregar una rama más en el mapeo
 *   interno, sin tocar la firma.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. `Pedidos.js`: la franja de avisos
 *   (vencidas/sin cubrir/programadas esta semana) se ve y togglea el filtro
 *   exactamente igual que antes de la extracción, en claro y en oscuro.
 * ========================================================================== */

import React, { useMemo } from 'react';
import { useTema } from './TemaContext';
import { colorEstado, radio, tipografia, paletaPedidos } from '../shared/tokens';

/** Contenedor de la franja de avisos -- el padre decide si se muestra. */
export function FranjaAvisos({ children }) {
  const styles = useEstilos();
  return <div style={styles.franjaResumen}>{children}</div>;
}

/**
 * @param {Object} props
 * @param {'peligro'|'advertencia'} props.tipo
 * @param {boolean} props.activo estado "prendido" (el filtro ya puesto)
 * @param {() => void} props.onClick
 */
export default function AvisoClickeable({ tipo, activo, onClick, children }) {
  const styles = useEstilos();
  const estiloTipo = tipo === 'advertencia' ? styles.avisoBtnAdvertencia : styles.avisoBtnPeligro;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ ...styles.avisoBtn, ...estiloTipo, ...(activo ? styles.avisoBtnActivo : {}) }}
    >
      {children}
    </button>
  );
}

/** Tercer aviso, sin color de alerta ni click. */
export function AvisoNeutro({ children }) {
  const styles = useEstilos();
  return <span style={styles.avisoNeutro}>{children}</span>;
}

function crearEstilos(oscuro) {
  const paleta = paletaPedidos(oscuro);
  return {
    franjaResumen: { display: 'flex', gap: 10, flexWrap: 'wrap', padding: '2px', marginBottom: 12 },
    avisoBtn: {
      display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid transparent',
      borderRadius: radio.pastilla, padding: '6px 14px', fontSize: tipografia.tamano.sm,
      fontWeight: tipografia.peso.medio, cursor: 'pointer', fontFamily: tipografia.familia,
    },
    avisoBtnPeligro: { background: colorEstado.peligroFondo, color: colorEstado.peligroTexto, borderColor: colorEstado.peligroBordeAlterno },
    avisoBtnAdvertencia: { background: colorEstado.advertenciaFondo, color: colorEstado.advertenciaTexto, borderColor: colorEstado.advertenciaBorde },
    avisoBtnActivo: { borderColor: 'currentcolor', boxShadow: '0 0 0 1px currentcolor' },
    avisoNeutro: { fontSize: tipografia.tamano.sm, color: paleta.textoSecundario, alignSelf: 'center' },
  };
}

function useEstilos() {
  const { oscuro } = useTema();
  return useMemo(() => crearEstilos(oscuro), [oscuro]);
}
