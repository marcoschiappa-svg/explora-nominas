/**
 * =============================================================================
 * nuevo-tarifario/ModalDetalleRuta.js — v1.2.0 (rediseño NuevoTarifario)
 * =============================================================================
 *
 * SÍNTOMA
 *   El detalle de una ruta (maestra o derivada) no tenía un modal propio:
 *   la maestra solo abría un modal de HISTORIAL (`ModalHistorialRuta`, tabla
 *   simple) y la derivada no tenía detalle, solo acciones sueltas en la fila
 *   de la tabla de "Rutas derivadas".
 *
 * CAUSA RAÍZ
 *   El diseño pide, para las dos clases de ruta, el mismo modal de dos
 *   columnas que ya usan Pedidos/Programación (`ui/Modal.js`, `ancho={920}`),
 *   con los datos a la izquierda y un panel cálido a la derecha — no existía
 *   ese componente para esta pantalla.
 *
 * ALCANCE
 *   Un solo componente, parametrizado por `tipo`:
 *     - `tipo="maestra"`: columna izquierda con los datos de la ruta (Km,
 *       Categoría, Tarifa base, Tarifa vigente destacada, Referencia CATAC,
 *       Brecha, Actualizada por/el), la cantidad de derivadas que dependen de
 *       ella (enlace a Rutas derivadas filtrado), y "Desactivar" (admin,
 *       `variante="secundario"`); columna derecha, panel cálido "HISTORIAL DE
 *       TARIFAS" — reusa `leerTarifasDeRuta(ruta.id)` que ya carga el
 *       orquestador, esto solo cambia la presentación (tarjetas con borde
 *       izquierdo rojo, en vez de la tabla que tenía `ModalHistorialRuta`).
 *     - `tipo="derivada"`: columna izquierda con los datos más la caja "Cómo
 *       se calcula" (fórmula con los valores reales); columna derecha,
 *       "Tarifa al crear" vs "Tarifa al día" + la variación
 *       (`calcularVariacion`, de `logica-tarifario.js`, ya calculada por el
 *       orquestador — este componente NO recalcula nada); acciones (editar,
 *       desactivar, reasignar maestra -- reasignar se hace reusando "Editar"
 *       porque `ModalEditarDerivada` original ya permite cambiar
 *       `ruta_maestra_id`, no hay una acción separada) condicionadas a
 *       `puedeEditar` (`puedeEditarDerivada()`); el comercial ve todo en
 *       solo lectura porque el orquestador nunca le pasa `onEditar`/
 *       `onDesactivar`.
 *
 * LIMITACIONES CONOCIDAS
 *   "Reasignar maestra" no es un botón separado: es el mismo flujo de
 *   `ModalEditarDerivada` (que ya incluye el select de maestra) — separarlo
 *   sería una pantalla nueva que el archivo original tampoco tenía.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Manual: ver la lista de pruebas de
 *   `NuevoTarifario` en el CHANGELOG v1.2.0.
 * ========================================================================== */

import React from 'react';
import Modal from '../../ui/Modal';
import Boton from '../../ui/Boton';
import Pastilla from '../../ui/Pastilla';
import { espacio, tipografia, colorEstado, paletaTarifario } from '../../shared/tokens';
import { useTema } from '../../ui/TemaContext';
import { formatoMoneda, formatoKm, formatoPorcentaje, formatoFechaLarga } from '../../formatos';

function Dato({ S, label, valor, destacado, completo }) {
  const tieneValor = valor !== undefined && valor !== null && valor !== '';
  return (
    <div style={{ ...S.campo, ...(completo ? { gridColumn: '1 / -1' } : {}) }}>
      <span style={S.labelGrilla}>{label}</span>
      <span style={destacado ? S.valorDestacado : S.valor}>{tieneValor ? valor : 'Sin dato'}</span>
    </div>
  );
}

export default function ModalDetalleRuta({
  S, tipo, ruta, onCerrar,
  // maestra
  historial, derivadasDependientes, onVerDerivadas, isAdmin, onDesactivar,
  // derivada
  maestra, calc, variacionDesdeCreacion, puedeEditar, onEditar, onDesactivarDerivada, soloLectura,
}) {
  const { oscuro } = useTema();
  const paleta = paletaTarifario(oscuro);

  if (!ruta) return null;

  return (
    <Modal
      titulo={`${ruta.origen} → ${ruta.destino}`}
      onCerrar={onCerrar}
      ancho={920}
    >
      <div style={S.modalDosColumnas}>
        <div style={S.modalColumna}>
          <div style={{ marginBottom: espacio.sm, color: colorEstado.peligroTexto, fontSize: tipografia.tamano.sm }}>
            {ruta.producto}
          </div>

          {tipo === 'maestra' ? (
            <>
              <div style={S.modalGrid}>
                <Dato S={S} label="Km" valor={formatoKm(ruta.km)} />
                <Dato S={S} label="Categoría" valor={<Pastilla chico colores={paleta.categoria[ruta.categoria]}>{ruta.categoria}</Pastilla>} />
                <Dato S={S} label="Tarifa base" valor={formatoMoneda(ruta.tarifa_base)} />
                <Dato S={S} label="Tarifa vigente" valor={formatoMoneda(ruta.tarifa_vigente)} destacado />
                <Dato S={S} label="Referencia CATAC" valor={ruta.catacRef != null ? formatoMoneda(ruta.catacRef) : null} />
                <Dato S={S} label="Brecha" valor={ruta.brecha != null ? formatoPorcentaje(ruta.brecha) : null} />
                <Dato S={S} label="Actualizada por" valor={ruta.tarifa_actualizada_por ? ruta.tarifa_actualizada_por.nombre : null} />
                <Dato S={S} label="Actualizada el" valor={formatoFechaLarga(ruta.tarifa_actualizada_en)} />
              </div>

              <div style={{ marginBottom: espacio.md, fontSize: tipografia.tamano.sm }}>
                <button
                  type="button"
                  onClick={onVerDerivadas}
                  style={{ border: 'none', background: 'none', color: colorEstado.acentoAzulFuerte, cursor: 'pointer', padding: 0, font: 'inherit', textDecoration: 'underline' }}
                >
                  {derivadasDependientes} ruta{derivadasDependientes === 1 ? '' : 's'} derivada{derivadasDependientes === 1 ? '' : 's'} que depende{derivadasDependientes === 1 ? '' : 'n'} de esta →
                </button>
              </div>

              {isAdmin && (
                <div style={S.accionesColumna}>
                  <Boton variante="secundario" onClick={onDesactivar}>Desactivar ruta maestra</Boton>
                </div>
              )}
            </>
          ) : (
            <>
              <div style={S.modalGrid}>
                <Dato S={S} label="Km" valor={formatoKm(ruta.km)} />
                <Dato S={S} label="Categoría" valor={<Pastilla chico colores={paleta.categoria[ruta.categoria]}>{ruta.categoria}</Pastilla>} />
                <Dato
                  S={S}
                  label="Depende de"
                  valor={calc.maestraInactiva ? <Pastilla chico colores={{ bg: colorEstado.peligroFondo, color: colorEstado.peligroTexto }}>Maestra inactiva</Pastilla> : (maestra ? `${maestra.origen} → ${maestra.destino}` : 'Sin maestra')}
                  completo
                />
                <Dato S={S} label="Tarifa al día" valor={calc.tarifa != null ? formatoMoneda(calc.tarifa) : '—'} destacado />
              </div>

              {!calc.maestraInactiva && maestra && (
                <div style={S.calculoBox}>
                  <strong>Cómo se calcula:</strong> CATAC ({formatoKm(ruta.km)} km) × (tarifa de la maestra ÷ CATAC
                  ({formatoKm(maestra.km)} km de la maestra)) = CATAC × ({formatoMoneda(maestra.tarifa_vigente)} ÷
                  CATAC({formatoKm(maestra.km)})) = {calc.tarifa != null ? formatoMoneda(calc.tarifa) : '— (revisá la tabla CATAC)'}
                </div>
              )}

              {puedeEditar && !soloLectura && (
                <div style={S.accionesColumna}>
                  <Boton variante="secundario" onClick={onEditar}>Editar / reasignar maestra</Boton>
                  <Boton variante="peligro" onClick={onDesactivarDerivada}>Desactivar derivada</Boton>
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ ...S.modalColumna, ...S.panelCalido }}>
          {tipo === 'maestra' ? (
            <>
              <div style={S.panelCalidoTitulo}>Historial de tarifas</div>
              {historial === null ? (
                <div style={{ opacity: 0.7, fontSize: tipografia.tamano.sm }}>Cargando…</div>
              ) : historial.length === 0 ? (
                <div style={{ opacity: 0.7, fontSize: tipografia.tamano.sm }}>Sin cambios registrados.</div>
              ) : (
                historial.map(c => (
                  <div key={c.id} style={S.tarjetaHistorial}>
                    <div style={{ fontSize: tipografia.tamano.xs, color: colorEstado.acentoAmbar, marginBottom: 4 }}>{formatoFechaLarga(c.ts)}</div>
                    <div style={{ fontSize: tipografia.tamano.sm, marginBottom: 4 }}>
                      {formatoMoneda(c.tarifa_anterior)} → <strong>{formatoMoneda(c.tarifa_nueva)}</strong>
                      {' '}
                      <Pastilla chico colores={{ bg: c.variacion > 0 ? colorEstado.peligroFondo : colorEstado.exitoFondo, color: c.variacion > 0 ? colorEstado.peligroTexto : colorEstado.exitoTexto }}>
                        {formatoPorcentaje(c.variacion)}
                      </Pastilla>
                    </div>
                    <div style={{ fontSize: tipografia.tamano.xs, opacity: 0.8, marginBottom: 2 }}>
                      Origen: {origenLegible(c.origen)}{c.ref && c.ref !== 'Otro' ? ` · ${c.ref}` : ''}
                    </div>
                    {c.just && <div style={{ fontSize: tipografia.tamano.xs, opacity: 0.8, marginBottom: 2 }}>{c.just}</div>}
                    <div style={{ fontSize: tipografia.tamano.xs, opacity: 0.7 }}>
                      {c.usuario_nombre || 'Autor no registrado (historial migrado)'}
                    </div>
                    {c.adjunto && (
                      <div style={{ marginTop: 4 }}>
                        <a href={c.adjunto} target="_blank" rel="noreferrer" style={{ fontSize: tipografia.tamano.xs, color: colorEstado.acentoAzulFuerte }}>Ver informe</a>
                      </div>
                    )}
                  </div>
                ))
              )}
            </>
          ) : (
            <>
              <div style={S.panelCalidoTitulo}>Tarifa al crear vs. tarifa al día</div>
              <div style={S.modalGrid}>
                <Dato S={S} label="Tarifa al crear" valor={formatoMoneda(ruta.tarifa_al_crear)} />
                <Dato S={S} label="Tarifa al día" valor={calc.tarifa != null ? formatoMoneda(calc.tarifa) : '—'} destacado />
              </div>
              {variacionDesdeCreacion != null && (
                <Pastilla colores={{ bg: variacionDesdeCreacion > 0 ? colorEstado.peligroFondo : colorEstado.exitoFondo, color: variacionDesdeCreacion > 0 ? colorEstado.peligroTexto : colorEstado.exitoTexto }}>
                  {formatoPorcentaje(variacionDesdeCreacion)} desde que se creó
                </Pastilla>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function origenLegible(origen) {
  const MAPA = {
    alta: 'Alta de ruta',
    catamp: 'Indicador CATAMP',
    catac: 'Indicador CATAC',
    restauracion: 'Restauración de versión',
    migracion: 'Carga inicial',
    editor: 'Edición manual',
    ajuste_global: 'Ajuste global',
  };
  return MAPA[origen] || origen || 'Otro';
}
