/**
 * =============================================================================
 * nuevo-tarifario/CampoConSugerencias.js — v1.2.0 (rediseño NuevoTarifario)
 * =============================================================================
 *
 * SÍNTOMA
 *   `CampoConSugerencias` vivía local a `NuevoTarifario.js` (RF-09b) — al
 *   partir ese archivo en `pages/nuevo-tarifario/`, los modales de alta
 *   (`ModalNuevaMaestra`, `ModalGenerarDerivada`) necesitan importarla.
 *
 * CAUSA RAÍZ
 *   No era un cambio de comportamiento, solo de ubicación.
 *
 * ALCANCE
 *   Traslado 1:1 — mismo `<input>` + `<datalist>` que ya tenía el archivo
 *   original (ver RF-09b en el encabezado viejo de `NuevoTarifario.js`):
 *   `origen`/`destino`/`producto` son texto estandarizado, no vínculos a
 *   otra colección — el `<datalist>` sugiere lo que ya existe en el registro
 *   maestro, pero se puede escribir un valor nuevo igual.
 *
 * LIMITACIONES CONOCIDAS
 *   Mismas que antes: las sugerencias salen solo de las maestras activas
 *   cargadas en memoria.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Los modales de alta siguen
 *   sugiriendo los mismos valores que antes del traslado.
 * ========================================================================== */

import React from 'react';

/**
 * @param {Object} props
 * @param {Object} props.S estilos (`useEstilos()` de `./estilos`)
 * @param {string} props.etiqueta
 * @param {string} props.id id único del `<datalist>`
 * @param {string} props.valor
 * @param {string[]} props.opciones
 * @param {(v: string) => void} props.onChange
 * @param {number} [props.ancho]
 */
export default function CampoConSugerencias({ S, etiqueta, id, valor, opciones, onChange, ancho }) {
  return (
    <div style={ancho ? { width: ancho } : { flex: 1 }}>
      <label style={S.label}>{etiqueta}</label>
      <input
        style={{ ...S.input, width: '100%' }}
        list={id}
        value={valor}
        maxLength={120}
        placeholder="Escribir…"
        onChange={e => onChange(e.target.value)}
      />
      <datalist id={id}>
        {opciones.map(o => <option key={o} value={o} />)}
      </datalist>
    </div>
  );
}
