/**
 * =============================================================================
 * Tabla.js — B1
 * =============================================================================
 *
 * El portal casi no usa tablas HTML hoy — todo es lista de tarjetas, incluso
 * donde una tabla comprimiría mejor la información (`Programacion.js`,
 * `Usuarios.js`). Este componente queda listo para cuando el rediseño de una
 * pantalla puntual decida que ahí sí conviene una tabla — B4 (tablero por
 * estado) es el candidato más probable —, sin que haya que inventar el
 * patrón en el momento.
 *
 * El encabezado usa el rojo de marca, no un acento azul — coherente con que
 * `#C60000` es AHORA el único color de marca del portal.
 *
 * USO
 *   <Tabla
 *     columnas={[
 *       { clave: 'numero', titulo: 'N°' },
 *       { clave: 'cliente', titulo: 'Cliente' },
 *       { clave: 'volumen', titulo: 'Volumen', numerica: true },
 *     ]}
 *     filas={despachos}
 *     obtenerId={(d) => d.id}
 *   />
 * ========================================================================== */

import React from 'react';
import { marca, tipografia } from './tokens';
import { useTema } from './TemaContext';

export default function Tabla({ columnas, filas, obtenerId, onFilaClick }) {
  const { colores } = useTema();

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: tipografia.tamano.md }}>
      <thead>
        <tr>
          {columnas.map(c => (
            <th
              key={c.clave}
              style={{
                background: marca, color: '#fff', padding: '9px 11px',
                textAlign: c.numerica ? 'right' : 'left', fontWeight: tipografia.peso.medio,
              }}
            >
              {c.titulo}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {filas.map(fila => (
          <tr
            key={obtenerId(fila)}
            onClick={onFilaClick ? () => onFilaClick(fila) : undefined}
            style={{ cursor: onFilaClick ? 'pointer' : 'default' }}
            onMouseEnter={e => { e.currentTarget.style.background = colores.fondo; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            {columnas.map(c => (
              <td
                key={c.clave}
                style={{
                  padding: '8px 11px', borderBottom: `0.5px solid ${colores.borde}`, color: colores.texto,
                  textAlign: c.numerica ? 'right' : 'left',
                  fontVariantNumeric: c.numerica ? 'tabular-nums' : 'normal',
                }}
              >
                {c.render ? c.render(fila) : fila[c.clave]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
