/**
 * =============================================================================
 * Campo.js — B1
 * =============================================================================
 *
 * label + input + ayuda + error. El bloque que se repite en cada formulario
 * (`Pedidos.js`, `Usuarios.js`, `Programacion.js`...), normalmente con el
 * label en mayúsculas chico arriba y una línea de ayuda gris abajo.
 *
 * NO reemplaza el `<input>` — lo envuelve. Cualquier prop que no sea
 * `label`/`ayuda`/`error` se le pasa directo al input de adentro
 * (`value`, `onChange`, `type`, `placeholder`, todo funciona igual).
 *
 * USO
 *   <Campo label="Fecha de carga" type="date" value={f.fecha}
 *          onChange={e => setF({...f, fecha: e.target.value})}
 *          ayuda="Entre hoy y la fecha comprometida." />
 *
 *   <Campo label="Motivo" error={errores.motivo} value={motivo}
 *          onChange={e => setMotivo(e.target.value)} />
 *
 * Para un `<select>` o un `<textarea>` en vez de `<input>`, usar `as`:
 *   <Campo as="select" label="Rol" value={rol} onChange={...}>
 *     <option value="chofer">Chofer</option>
 *   </Campo>
 * ========================================================================== */

import React from 'react';
import { colorEstado, espacio, radio, tipografia } from './tokens';
import { useTema } from './TemaContext';

export default function Campo({ label, ayuda, error, as = 'input', children, style, ...resto }) {
  const { colores } = useTema();
  const Elemento = as;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: espacio.xs, marginBottom: espacio.sm }}>
      {label && (
        <label
          style={{
            fontSize: tipografia.tamano.xs,
            fontWeight: tipografia.peso.medio,
            color: colores.textoTenue,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          {label}
        </label>
      )}

      <Elemento
        style={{
          fontSize: tipografia.tamano.lg,
          padding: '9px 12px',
          borderRadius: radio.md,
          border: `0.5px solid ${error ? colorEstado.peligroBorde : colores.borde}`,
          color: colores.texto,
          background: colores.superficie,
          width: '100%',
          boxSizing: 'border-box',
          fontFamily: tipografia.familia,
          ...style,
        }}
        {...resto}
      >
        {children}
      </Elemento>

      {error && (
        <span style={{ fontSize: tipografia.tamano.sm, color: colorEstado.peligroTexto }}>{error}</span>
      )}
      {!error && ayuda && (
        <span style={{ fontSize: tipografia.tamano.sm, color: colores.textoTenue, lineHeight: 1.4 }}>{ayuda}</span>
      )}
    </div>
  );
}
