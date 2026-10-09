/**
 * =============================================================================
 * nuevo-tarifario/RutasDerivadas.js — v1.2.0 (rediseño NuevoTarifario)
 * =============================================================================
 *
 * SÍNTOMA
 *   "Rutas derivadas" era una tabla con una columna por dato y los botones
 *   "Editar"/"Desactivar" sueltos en la última columna — sin el lenguaje de
 *   filas (`PanelLista`) que ya usan Pedidos/Programación/Registro vigente.
 *
 * CAUSA RAÍZ
 *   El Paso 4 del rediseño pide el mismo `PanelLista` que el resto de la
 *   pantalla, con la variación desde que se creó (`calcularVariacion`, de
 *   `logica-tarifario.js` — ya calculada por el orquestador, este componente
 *   no recalcula nada) como chip, y "Editar"/"Desactivar" movidos al detalle
 *   (`ModalDetalleRuta`, `tipo="derivada"`) en vez de la fila.
 *
 * ALCANCE
 *   Componente de PRESENTACIÓN puro: recibe `filas` ya filtradas/ordenadas
 *   (`calc`/`variacionDesdeCreacion`/`maestraTxt` ya resueltos por el
 *   orquestador) y dibuja. Clic en una fila abre el detalle
 *   (`onAbrir`, manejado por el orquestador) — ahí es donde viven, ahora,
 *   "Editar" y "Desactivar" (con la misma condición `puedeEditarDerivada`
 *   de antes).
 *
 * LIMITACIONES CONOCIDAS
 *   Ninguna nueva.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Manual: ver la lista de pruebas de
 *   `NuevoTarifario` en el CHANGELOG v1.2.0.
 * ========================================================================== */

import React from 'react';
import PanelLista from '../../ui/PanelLista';
import Pastilla from '../../ui/Pastilla';
import Vacio from '../../ui/Vacio';
import { colorEstado } from '../../shared/tokens';
import { formatoMoneda, formatoKm, formatoPorcentaje } from '../../formatos';

export default function RutasDerivadas({ S, filas, onAbrir, vacioDerivadas }) {
  if (vacioDerivadas) {
    return <Vacio titulo="Todavía no hay rutas derivadas." nota="Se generan desde la pestaña «Generar derivada»." />;
  }
  if (filas.length === 0) {
    return <Vacio titulo="No hay rutas que coincidan con los filtros." />;
  }

  return (
    <PanelLista
      items={filas}
      render={(d, i, esUltima) => (
        <div key={d.id} style={S.fila(esUltima)} onClick={() => onAbrir(d)}>
          <div>
            <span style={S.filaTitulo}>{d.origen} → {d.destino}</span>
            {' · '}
            <span style={S.filaProducto}>{d.producto}</span>
            <div style={S.filaTenue}>{formatoKm(d.km)} km · Depende de: {d.maestraTxt}</div>
          </div>
          {d.variacionDesdeCreacion != null && (
            <Pastilla chico colores={{ bg: d.variacionDesdeCreacion > 0 ? colorEstado.peligroFondo : colorEstado.exitoFondo, color: d.variacionDesdeCreacion > 0 ? colorEstado.peligroTexto : colorEstado.exitoTexto }}>
              {formatoPorcentaje(d.variacionDesdeCreacion)}
            </Pastilla>
          )}
          <span style={S.filaTenue}>{d.creado_por_uid || '—'}</span>
          <div style={S.filaDerecha}>
            {d.calc.maestraInactiva ? (
              <Pastilla chico colores={{ bg: colorEstado.peligroFondo, color: colorEstado.peligroTexto }}>Maestra inactiva</Pastilla>
            ) : (
              <div style={{ fontWeight: 600 }}>{d.calc.tarifa != null ? formatoMoneda(d.calc.tarifa) : '—'}</div>
            )}
          </div>
        </div>
      )}
    />
  );
}
