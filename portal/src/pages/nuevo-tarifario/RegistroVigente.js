/**
 * =============================================================================
 * nuevo-tarifario/RegistroVigente.js — v1.2.0 (rediseño NuevoTarifario)
 * =============================================================================
 *
 * SÍNTOMA
 *   El registro vigente era una tabla sola, sin alternativa de "filas" (el
 *   lenguaje visual de Pedidos/Programación) ni chip de "pendiente de
 *   aprobación" a la vista.
 *
 * CAUSA RAÍZ
 *   El Paso 3 del rediseño pide un `Segmentado` "Filas/Tabla" (igual que
 *   "Tarjetas/Tabla" de Pedidos): Filas con `PanelLista` (una fila por
 *   maestra, con categoría/brecha/pendiente como chips) y Tabla con el mismo
 *   patrón `tblWrap`/`th`/`td` que ya tenía el archivo original.
 *
 * ALCANCE
 *   Componente de PRESENTACIÓN: recibe `filas` ya filtradas/ordenadas por el
 *   orquestador (`filasRegistro`, con `catacRef`/`brecha` ya calculados
 *   contra la tabla CATAC) y solo dibuja. Clic en una fila o en una fila de
 *   la tabla abre `ModalDetalleRuta` (`onAbrir`, manejado por el
 *   orquestador). Ninguna acción ni dato del registro vigente original se
 *   pierde: "Historial" pasa a ser el propio detalle (ya no un botón aparte
 *   por fila), igual que pide el Paso 3.
 *
 * LIMITACIONES CONOCIDAS
 *   Ninguna nueva.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Manual: ver la lista de pruebas de
 *   `NuevoTarifario` en el CHANGELOG v1.2.0.
 * ========================================================================== */

import React from 'react';
import Segmentado from '../../ui/Segmentado';
import PanelLista from '../../ui/PanelLista';
import Pastilla from '../../ui/Pastilla';
import Vacio from '../../ui/Vacio';
import { colorEstado, paletaTarifario } from '../../shared/tokens';
import { useTema } from '../../ui/TemaContext';
import { formatoMoneda, formatoKm, formatoPorcentaje, formatoFechaLarga } from '../../formatos';

function bucketBrecha(b) {
  if (b == null || isNaN(b)) return null;
  if (b > 10) return 'sobre';
  if (b > 0) return 'enRango';
  return 'bajo';
}

export default function RegistroVigente({ S, filas, vista, onCambiarVista, onAbrir, vacioRegistro }) {
  const { oscuro } = useTema();
  const paleta = paletaTarifario(oscuro);

  if (vacioRegistro) {
    return <Vacio emoji="🧾" titulo="El registro maestro está vacío." nota="Hay que correr la carga inicial de rutas (ver CHANGELOG v1.2.0)." />;
  }

  return (
    <div>
      <div style={{ ...S.controlesFila, justifyContent: 'flex-end' }}>
        <Segmentado
          opciones={[{ id: 'filas', label: '☰ Filas' }, { id: 'tabla', label: '▦ Tabla' }]}
          valor={vista}
          onCambiar={onCambiarVista}
        />
      </div>

      {filas.length === 0 ? (
        <Vacio titulo="No hay rutas que coincidan con los filtros." />
      ) : vista === 'filas' ? (
        <PanelLista
          items={filas}
          render={(r, i, esUltima) => (
            <div key={r.id} style={S.fila(esUltima)} onClick={() => onAbrir(r)}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <span style={S.filaTitulo}>{r.origen} → {r.destino}</span>
                {' · '}
                <span style={S.filaProducto}>{r.producto}</span>
              </div>
              {/* La fecha de actualización no se repite acá -- ya está en el
                  detalle (clic en la fila); lo que sí gana prioridad es el
                  km, como pidió el feedback de revisión. */}
              <div style={S.filaKm}>{formatoKm(r.km)} km</div>
              <div style={S.filaColChip}>
                <Pastilla chico colores={paleta.categoria[r.categoria]}>{r.categoria}</Pastilla>
              </div>
              <div style={S.filaColChip}>
                {r.brecha != null && (
                  <Pastilla chico colores={{ bg: r.brecha > 10 ? colorEstado.peligroFondo : r.brecha > 0 ? colorEstado.advertenciaFondo : colorEstado.exitoFondo, color: paleta.brecha[bucketBrecha(r.brecha)].texto }}>
                    {formatoPorcentaje(r.brecha)}
                  </Pastilla>
                )}
              </div>
              <div style={S.filaDerecha}>
                <div style={{ fontWeight: 600 }}>{formatoMoneda(r.tarifa_vigente)}</div>
                {r.pendiente && (
                  <Pastilla chico colores={paleta.pendiente}>Pendiente {formatoPorcentaje(r.pendiente.variacion)}</Pastilla>
                )}
              </div>
            </div>
          )}
        />
      ) : (
        <div style={S.tblWrap}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              {['Origen', 'Destino', 'Producto', 'Km', 'Categoría', 'Tarifa vigente', 'Referencia CATAC', 'Brecha', 'Actualización'].map(h => (
                <th key={h} style={S.th}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filas.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => onAbrir(r)}>
                  <td style={S.td}>{r.origen}</td>
                  <td style={S.td}>{r.destino}</td>
                  <td style={S.td}>{r.producto}</td>
                  <td style={{ ...S.td, textAlign: 'right' }}>{formatoKm(r.km)}</td>
                  <td style={S.td}><Pastilla chico colores={paleta.categoria[r.categoria]}>{r.categoria}</Pastilla></td>
                  <td style={{ ...S.td, textAlign: 'right', ...S.mono, fontWeight: 600 }}>{formatoMoneda(r.tarifa_vigente)}</td>
                  <td style={{ ...S.td, textAlign: 'right', ...S.mono }}>{r.catacRef != null ? formatoMoneda(r.catacRef) : '—'}</td>
                  <td style={{ ...S.td, textAlign: 'right', fontWeight: 600, color: r.brecha != null ? paleta.brecha[bucketBrecha(r.brecha)].texto : undefined }}>{formatoPorcentaje(r.brecha)}</td>
                  <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{formatoFechaLarga(r.tarifa_actualizada_en)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export { bucketBrecha };
