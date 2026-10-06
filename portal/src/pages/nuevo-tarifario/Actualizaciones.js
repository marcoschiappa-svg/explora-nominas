/**
 * =============================================================================
 * nuevo-tarifario/Actualizaciones.js — v1.2.0 (rediseño NuevoTarifario)
 * =============================================================================
 *
 * SÍNTOMA
 *   "Actualizar por indicador" era un solo panel largo (indicador + tabla de
 *   pendientes + versiones, todo junto, sin indicar en qué paso está el
 *   admin).
 *
 * CAUSA RAÍZ
 *   El Paso 6 del rediseño pide tres pasos numerados con un indicador de
 *   paso arriba: Indicador → Vista previa → Pendientes.
 *
 * ALCANCE
 *   MISMA lógica exacta que tenía la pestaña "Actualizar por indicador" del
 *   archivo original — `evaluarCatamp`/`aplicarIndicador`/
 *   `aprobarPendientes`/`descartarPendientes`/`leerVersiones`/
 *   `restaurarVersion`, tal cual, sin tocar `logica-tarifario.js` ni
 *   `calculo-tarifario.js` — repartida en tres pasos:
 *     1. Indicador (`Segmentado` CATAMP/CATAC, meses e índices o
 *        porcentaje, alcance, justificación, link al informe — el aviso de
 *        techo se mantiene igual).
 *     2. Vista previa: tabla (ruta, tarifa anterior, nueva, variación)
 *        CALCULADA EN EL CLIENTE con `aplicarFactor()` (`calculo-tarifario.js`,
 *        ya existente — misma fórmula que usa `aplicarIndicador()` del lado
 *        del servidor, así que la vista previa coincide con lo que se va a
 *        guardar) — nada se escribe todavía. Botón "Generar pendientes"
 *        ejecuta recién ahí `aplicarIndicador()` (guarda la foto en
 *        `rutas_versiones` y deja cada maestra con `pendiente`).
 *     3. Pendientes: la misma tabla que ya tenía el archivo original
 *        ("Aprobar todo"/"Descartar todo") — NO hay aprobación por fila
 *        porque `aprobarPendientes()` nunca la tuvo (aprueba todos los
 *        pendientes en un solo batch); el Paso 6 del prompt lo preveía como
 *        condicional ("si hoy existe") y hoy no existe.
 *   Debajo de los tres pasos, "Versiones" sigue igual: lista de fotos +
 *   "Restaurar como pendientes".
 *
 * LIMITACIONES CONOCIDAS
 *   Mismas que el archivo original — ninguna nueva.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Manual: ver la lista de pruebas de
 *   `NuevoTarifario` en el CHANGELOG v1.2.0.
 * ========================================================================== */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import Tarjeta from '../../ui/Tarjeta';
import Boton from '../../ui/Boton';
import Segmentado from '../../ui/Segmentado';
import { espacio, colorEstado } from '../../ui/tokens';
import { formatoMoneda, formatoPorcentaje } from '../../formatos';
import { evaluarCatamp, aplicarFactor } from '../../calculo-tarifario';
import {
  CATEGORIAS, aplicarIndicador, aprobarPendientes, descartarPendientes,
  leerVersiones, restaurarVersion,
} from '../../logica-tarifario';

export default function Actualizaciones({ S, rutas, maestras, usuario }) {
  const [paso, setPaso] = useState(1);

  const [indTipo, setIndTipo] = useState('CATAMP');
  const [indAlcance, setIndAlcance] = useState('all');
  const [indJust, setIndJust] = useState('');
  const [indAdjunto, setIndAdjunto] = useState('');
  const [indMeses, setIndMeses] = useState([{ mes: '', indice: '' }, { mes: '', indice: '' }]);
  const [indTecho, setIndTecho] = useState('15');
  const [indPct, setIndPct] = useState('');
  const [indBusy, setIndBusy] = useState(false);
  const [indMsg, setIndMsg] = useState(null);

  const [versiones, setVersiones] = useState(null);
  const [versBusy, setVersBusy] = useState(false);

  const cargarVersionesTab = useCallback(async () => {
    try {
      setVersiones(await leerVersiones());
    } catch (e) {
      console.error('Actualizaciones: error cargando versiones', e);
      setVersiones([]);
    }
  }, []);

  useEffect(() => { if (versiones === null) cargarVersionesTab(); }, [versiones, cargarVersionesTab]);

  const indCatampCalc = useMemo(() => evaluarCatamp(indMeses, indTecho), [indMeses, indTecho]);
  const indFactor = indTipo === 'CATAMP' ? indCatampCalc.factor : 1 + (Number(indPct) || 0) / 100;
  const indPorcentaje = (indFactor - 1) * 100;

  const setMesRow = (i, campo, val) => setIndMeses(prev => prev.map((m, j) => j === i ? { ...m, [campo]: val } : m));
  const addMesRow = () => setIndMeses(prev => [...prev, { mes: '', indice: '' }]);
  const delMesRow = (i) => setIndMeses(prev => prev.length > 1 ? prev.filter((_, j) => j !== i) : prev);

  const afectadas = useMemo(() => {
    const alcance = indAlcance && indAlcance !== 'all' ? indAlcance : null;
    return maestras.filter(m => !alcance || m.categoria === alcance);
  }, [maestras, indAlcance]);

  const vistaPrevia = useMemo(
    () => afectadas.map(r => ({ ruta: r, nueva: aplicarFactor(r.tarifa_vigente, indFactor) })),
    [afectadas, indFactor]
  );

  function irAVistaPrevia() {
    setIndMsg(null);
    if (!indJust.trim()) { setIndMsg({ tipo: 'error', texto: 'Ingresá la justificación del indicador.' }); return; }
    if (indTipo === 'CATAMP' && indCatampCalc.filas.length === 0) { setIndMsg({ tipo: 'error', texto: 'Cargá al menos un mes con su índice.' }); return; }
    if (afectadas.length === 0) { setIndMsg({ tipo: 'error', texto: 'No hay rutas maestras afectadas por ese alcance.' }); return; }
    setPaso(2);
  }

  async function generarPendientes() {
    setIndMsg(null);
    if (!indAdjunto.trim() && !window.confirm('No cargaste el link del informe de respaldo. ¿Aplicar igual?')) return;
    if (indTipo === 'CATAMP' && indCatampCalc.superaTecho && !window.confirm(`El ajuste compuesto (${indCatampCalc.porcentaje.toFixed(2)}%) supera el techo de ${indTecho}%. ¿Aplicar igual?`)) return;

    setIndBusy(true);
    try {
      const cantidad = await aplicarIndicador({
        tipo: indTipo, factor: indFactor, alcanceCategoria: indAlcance, just: indJust, adjunto: indAdjunto || null,
      }, rutas, usuario);
      setIndMsg({ tipo: 'ok', texto: `${cantidad} ruta(s) maestra(s) quedaron pendientes de aprobación.` });
      setIndJust(''); setIndAdjunto('');
      cargarVersionesTab();
      setPaso(3);
    } catch (e) {
      setIndMsg({ tipo: 'error', texto: e.message || 'No se pudo aplicar el indicador.' });
    }
    setIndBusy(false);
  }

  const pendientes = useMemo(() => maestras.filter(m => m.pendiente), [maestras]);

  const aprobarTodos = async () => {
    try {
      const n = await aprobarPendientes(rutas, usuario);
      alert(`${n} tarifa(s) actualizada(s).`);
    } catch (e) { alert(e.message || 'No se pudo aprobar.'); }
  };
  const descartarTodos = async () => {
    if (!window.confirm('¿Descartar todos los cambios pendientes?')) return;
    try { await descartarPendientes(rutas, usuario); } catch (e) { alert(e.message || 'No se pudo descartar.'); }
  };

  const restaurarVersionClick = async (v) => {
    if (!window.confirm(`¿Restaurar "${v.desc}"? Las rutas afectadas quedan pendientes de aprobación.`)) return;
    setVersBusy(true);
    try {
      const { aplicadas, sinMapear } = await restaurarVersion({ version: v, rutas, usuario });
      alert(`${aplicadas} ruta(s) quedaron pendientes.${sinMapear.length ? ` ${sinMapear.length} sin mapear.` : ''}`);
    } catch (e) {
      alert(e.message || 'No se pudo restaurar la versión.');
    }
    setVersBusy(false);
  };

  return (
    <div>
      <div style={S.pasos}>
        {['Indicador', 'Vista previa', 'Pendientes'].map((label, i) => (
          <div key={label} style={S.pasoItem}>
            <span style={S.pasoNumero(paso === i + 1, paso > i + 1)}>{paso > i + 1 ? '✓' : i + 1}</span>
            <span style={S.pasoLabel(paso === i + 1)}>{label}</span>
          </div>
        ))}
      </div>

      {paso === 1 && (
        <Tarjeta style={S.card}>
          <div style={S.cardH}>Paso 1 — Indicador</div>
          <div style={{ marginBottom: espacio.md }}>
            <Segmentado
              opciones={[{ id: 'CATAMP', label: 'CATAMP' }, { id: 'CATAC', label: 'CATAC' }]}
              valor={indTipo}
              onCambiar={setIndTipo}
            />
          </div>
          <div style={{ display: 'flex', gap: espacio.sm, marginBottom: espacio.md, flexWrap: 'wrap' }}>
            <div>
              <label style={S.label}>Alcance</label>
              <select style={S.select} value={indAlcance} onChange={e => setIndAlcance(e.target.value)}>
                <option value="all">Todas las maestras</option>
                {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {indTipo === 'CATAMP' ? (
            <div style={S.fr}>
              <label style={S.label}>Meses e índices</label>
              {indMeses.map((m, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                  <input style={{ ...S.input, flex: 1 }} placeholder="Mes" value={m.mes} onChange={e => setMesRow(i, 'mes', e.target.value)} />
                  <input style={{ ...S.input, width: 110 }} type="number" placeholder="% índice" value={m.indice} onChange={e => setMesRow(i, 'indice', e.target.value)} />
                  <Boton chico variante="secundario" onClick={() => delMesRow(i)}>✕</Boton>
                </div>
              ))}
              <Boton chico variante="secundario" onClick={addMesRow}>+ Agregar mes</Boton>
              <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                <label style={S.label}>Techo de alerta %</label>
                <input style={{ ...S.input, width: 80 }} type="number" value={indTecho} onChange={e => setIndTecho(e.target.value)} />
              </div>
            </div>
          ) : (
            <div style={S.fr}>
              <label style={S.label}>Porcentaje de variación</label>
              <input style={{ ...S.input, width: 120 }} type="number" value={indPct} onChange={e => setIndPct(e.target.value)} />
            </div>
          )}

          <div style={{ marginBottom: espacio.md, fontSize: 13 }}>
            Factor: <strong>{indFactor.toFixed(4)}</strong> ({formatoPorcentaje(indPorcentaje)})
            {indTipo === 'CATAMP' && indCatampCalc.superaTecho && <span style={{ color: colorEstado.peligroTexto }}> — supera el techo</span>}
          </div>

          <div style={S.fr}>
            <label style={S.label}>Justificación</label>
            <input style={{ ...S.input, width: '100%' }} value={indJust} onChange={e => setIndJust(e.target.value)} />
          </div>
          <div style={S.fr}>
            <label style={S.label}>Link al informe de respaldo</label>
            <input style={{ ...S.input, width: '100%' }} value={indAdjunto} onChange={e => setIndAdjunto(e.target.value)} placeholder="https://…" />
          </div>

          {indMsg && <div style={S.aviso(indMsg.tipo)}>{indMsg.texto}</div>}
          <Boton onClick={irAVistaPrevia}>Ver vista previa →</Boton>
        </Tarjeta>
      )}

      {paso === 2 && (
        <Tarjeta style={S.card}>
          <div style={S.cardH}>Paso 2 — Vista previa ({vistaPrevia.length} ruta{vistaPrevia.length === 1 ? '' : 's'})</div>
          <div style={S.aviso('advertencia')}>Se guarda una foto de las tarifas vigentes en Versiones antes de aplicar el cambio.</div>
          <div style={S.tblWrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Ruta', 'Tarifa anterior', 'Tarifa nueva', 'Variación'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {vistaPrevia.map(({ ruta, nueva }) => (
                  <tr key={ruta.id}>
                    <td style={S.td}>{ruta.origen} → {ruta.destino}</td>
                    <td style={{ ...S.td, textAlign: 'right', ...S.mono }}>{formatoMoneda(ruta.tarifa_vigente)}</td>
                    <td style={{ ...S.td, textAlign: 'right', ...S.mono, fontWeight: 600 }}>{formatoMoneda(nueva)}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{formatoPorcentaje(indPorcentaje)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {indMsg && <div style={S.aviso(indMsg.tipo)}>{indMsg.texto}</div>}
          <div style={{ display: 'flex', gap: espacio.sm, marginTop: espacio.md }}>
            <Boton variante="secundario" onClick={() => setPaso(1)}>← Volver</Boton>
            <Boton disabled={indBusy} onClick={generarPendientes}>{indBusy ? 'Generando…' : 'Generar pendientes'}</Boton>
          </div>
        </Tarjeta>
      )}

      {paso === 3 && (
        <Tarjeta style={S.card}>
          <div style={S.cardH}>Paso 3 — Pendientes de aprobación ({pendientes.length})</div>
          {pendientes.length === 0 ? (
            <div style={{ opacity: 0.7, fontSize: 13 }}>No hay cambios pendientes.</div>
          ) : (
            <>
              <div style={S.tblWrap}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>{['Ruta', 'Actual', 'Nueva', 'Var.%', 'Ref.', 'Justificación'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {pendientes.map(p => (
                      <tr key={p.id}>
                        <td style={S.td}>{p.origen} → {p.destino}</td>
                        <td style={{ ...S.td, textAlign: 'right', ...S.mono }}>{formatoMoneda(p.tarifa_vigente)}</td>
                        <td style={{ ...S.td, textAlign: 'right', ...S.mono, fontWeight: 600 }}>{formatoMoneda(p.pendiente.tarifa_nueva)}</td>
                        <td style={{ ...S.td, textAlign: 'right' }}>{formatoPorcentaje(p.pendiente.variacion)}</td>
                        <td style={S.td}>{p.pendiente.ref}</td>
                        <td style={{ ...S.td, maxWidth: 260 }}>{p.pendiente.just}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: espacio.md, display: 'flex', gap: espacio.sm }}>
                <Boton onClick={aprobarTodos}>Aprobar todos</Boton>
                <Boton variante="peligro" onClick={descartarTodos}>Descartar todos</Boton>
              </div>
            </>
          )}
          <div style={{ marginTop: espacio.md }}>
            <Boton variante="secundario" onClick={() => setPaso(1)}>+ Aplicar otro indicador</Boton>
          </div>
        </Tarjeta>
      )}

      <Tarjeta style={S.card}>
        <div style={S.cardH}>Versiones recuperables</div>
        {versiones === null ? (
          <div style={{ opacity: 0.7 }}>Cargando…</div>
        ) : versiones.length === 0 ? (
          <div style={{ opacity: 0.7, fontSize: 13 }}>Todavía no hay versiones guardadas.</div>
        ) : (
          <div style={S.tblWrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Descripción', 'Origen', 'Rutas', 'Fecha', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {versiones.map(v => (
                  <tr key={v.id}>
                    <td style={S.td}>{v.desc}</td>
                    <td style={S.td}>{v.origen}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{v.nRutas}</td>
                    <td style={S.td}>{v.fechaTxt}</td>
                    <td style={S.td}><Boton chico variante="secundario" disabled={versBusy} onClick={() => restaurarVersionClick(v)}>Restaurar</Boton></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>
    </div>
  );
}
