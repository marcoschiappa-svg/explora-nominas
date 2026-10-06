/**
 * =============================================================================
 * nuevo-tarifario/GenerarDerivada.js — v1.2.0 (rediseño NuevoTarifario, corrección post-revisión)
 * =============================================================================
 *
 * SÍNTOMA
 *   La primera versión de este rediseño convirtió "Generar derivada" en un
 *   MODAL abierto desde un botón del encabezado (`ModalGenerarDerivada.js`).
 *   Feedback de revisión: se perdió lo más importante de esa pantalla -- el
 *   coordinador necesita ir completando origen/destino/producto/km y VER la
 *   maestra sugerida, la tarifa resultante y el cálculo mientras ajusta
 *   datos, para recién después decidir si guarda -- un flujo exploratorio
 *   que un modal angosto, pensado para una acción rápida, no acompaña bien.
 *
 * CAUSA RAÍZ
 *   El Paso 1 original pedía sacar "Generar derivada" de las pestañas. Eso
 *   no era lo que hacía falta: el problema no era la pestaña, era que
 *   convivía con "Nueva ruta maestra" (que sí es una acción puntual, bien
 *   resuelta como modal) bajo el mismo criterio.
 *
 * ALCANCE
 *   Vuelve a ser una PESTAÑA (`tab === 'generar'`, admin+coordinador), con el
 *   mismo contenido exacto que tenía `ModalGenerarDerivada.js` (mismo grid de
 *   dos columnas, mismo panel cálido con maestra sugerida/similares/tarifa
 *   resultante/"Cómo se calcula"), SIN el wrapper `<Modal>`. Al guardar, en
 *   vez de cerrarse, limpia el formulario y queda lista para cargar la
 *   siguiente derivada -- mismo comportamiento que tenía la pestaña original
 *   (`NuevoTarifario.js`, antes del split). `ModalGenerarDerivada.js` queda
 *   sin uso -- se borra.
 *
 * LIMITACIONES CONOCIDAS
 *   Ninguna nueva -- misma lógica (`calcularGenerador`/
 *   `calcularTarifaDerivada`/`crearRutaDerivada`), sin tocar
 *   `calculo-tarifario.js` ni `logica-tarifario.js`.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Manual: el coordinador entra a la
 *   pestaña "Generar derivada", completa los campos, ve el cálculo en vivo
 *   y guarda sin perder el contexto de la pantalla.
 * ========================================================================== */

import React, { useState, useMemo, useEffect } from 'react';
import Boton from '../../ui/Boton';
import Tarjeta from '../../ui/Tarjeta';
import { espacio } from '../../ui/tokens';
import { formatoMoneda, formatoKm } from '../../formatos';
import {
  CATEGORIAS, claveRuta, buscarPorClave, crearRutaDerivada,
} from '../../logica-tarifario';
import { calcularGenerador, calcularTarifaDerivada } from '../../calculo-tarifario';
import CampoConSugerencias from './CampoConSugerencias';

export default function GenerarDerivada({
  S, usuario, rutas, maestraPorId, maestrasConProducto, catacTabla,
  sugOrigenes, sugDestinos, sugProductos,
}) {
  const [origen, setOrigen] = useState('');
  const [destino, setDestino] = useState('');
  const [producto, setProducto] = useState('');
  const [categoria, setCategoria] = useState('General');
  const [km, setKm] = useState('');
  const [maestraId, setMaestraId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const genResult = useMemo(() => {
    if (!km) return null;
    return calcularGenerador({
      km, productoNombre: producto, rutas: maestrasConProducto, tablaCatac: catacTabla, kmMaximo: 1500,
    });
  }, [km, producto, maestrasConProducto, catacTabla]);

  useEffect(() => {
    if (genResult && genResult.vecina) setMaestraId(genResult.vecina.id);
  }, [genResult]);

  const maestraElegida = useMemo(() => maestraPorId.get(maestraId) || null, [maestraPorId, maestraId]);
  const tarifaCalc = useMemo(
    () => (maestraElegida ? calcularTarifaDerivada({ km }, maestraElegida, catacTabla) : null),
    [maestraElegida, km, catacTabla]
  );

  const datos = useMemo(() => ({ origen, destino, producto, km, categoria }), [origen, destino, producto, km, categoria]);
  const clave = claveRuta(datos);
  const rutaExistente = (origen.trim() && destino.trim() && producto.trim()) ? buscarPorClave(rutas, clave) : null;

  const guardar = async () => {
    setMsg(null);
    if (!maestraElegida) { setMsg({ tipo: 'error', texto: 'Elegí de qué ruta maestra depende esta derivada.' }); return; }
    if (tarifaCalc && tarifaCalc.tarifa == null) { setMsg({ tipo: 'error', texto: 'No se pudo calcular una tarifa: revisá el km y la tabla CATAC.' }); return; }
    setBusy(true);
    try {
      await crearRutaDerivada({
        datos: { ...datos, tarifa_vigente: tarifaCalc.tarifa },
        usuario, rutas, rutaMaestra: maestraElegida,
      });
      setMsg({ tipo: 'ok', texto: 'Ruta derivada guardada.' });
      setOrigen(''); setDestino(''); setProducto(''); setKm(''); setCategoria('General'); setMaestraId('');
    } catch (e) {
      if (e.rutaExistente) setMsg({ tipo: 'error', texto: 'Esa ruta ya existe. Se muestra la que hay en vez de duplicarla.' });
      else setMsg({ tipo: 'error', texto: e.message || 'No se pudo guardar la ruta.' });
    }
    setBusy(false);
  };

  return (
    <div style={S.modalDosColumnas}>
      <div style={S.modalColumna}>
        <Tarjeta style={S.card}>
          <div style={S.cardH}>Datos de la ruta</div>
          <div style={{ ...S.fr, display: 'flex', gap: espacio.sm }}>
            <CampoConSugerencias S={S} etiqueta="Origen" id="dl-gen-origen" valor={origen} opciones={sugOrigenes} onChange={setOrigen} />
            <CampoConSugerencias S={S} etiqueta="Destino" id="dl-gen-destino" valor={destino} opciones={sugDestinos} onChange={setDestino} />
          </div>
          <div style={{ display: 'flex', gap: espacio.sm, flexWrap: 'wrap' }}>
            <CampoConSugerencias S={S} etiqueta="Producto" id="dl-gen-producto" valor={producto} opciones={sugProductos} onChange={setProducto} ancho={200} />
            <div>
              <label style={S.label}>Categoría</label>
              <select style={S.select} value={categoria} onChange={e => setCategoria(e.target.value)}>
                {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={S.label}>Km</label>
              <input style={{ ...S.input, width: 100 }} type="number" min="1" value={km} onChange={e => setKm(e.target.value)} />
            </div>
          </div>

          {rutaExistente && (
            <div style={S.aviso('advertencia')}>
              Esa ruta ya existe: {rutaExistente.origen} → {rutaExistente.destino}, tarifa {formatoMoneda(rutaExistente.tarifa_vigente)}. No se puede duplicar.
            </div>
          )}
          {msg && <div style={S.aviso(msg.tipo)}>{msg.texto}</div>}
        </Tarjeta>
      </div>

      <div style={{ ...S.modalColumna, ...S.panelCalido }}>
        <div style={S.panelCalidoTitulo}>Maestra de la que depende</div>
        {!genResult ? (
          <div style={{ opacity: 0.7, fontSize: 13 }}>Completá origen, destino, producto y km para ver el cálculo.</div>
        ) : (
          <>
            <div style={S.fr}>
              <label style={S.label}>Elegí la maestra (sugerida: la más cercana en km)</label>
              <div style={S.listaSeleccionable}>
                {genResult.similares.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    style={S.opcionLista(maestraId === s.id)}
                    onClick={() => setMaestraId(s.id)}
                  >
                    <span>{s.origen} → {s.destino}</span>
                    <span>{formatoKm(s.km)} km · {formatoMoneda(s.tarifa_vigente)}</span>
                  </button>
                ))}
              </div>
            </div>
            {genResult.productoDifiere && <div style={S.aviso('advertencia')}>La vecina sugerida es de otro producto.</div>}
            {tarifaCalc && (
              <div style={{ marginBottom: espacio.md }}>
                <div style={S.panelCalidoTitulo}>Tarifa resultante</div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>
                  {tarifaCalc.tarifa != null ? formatoMoneda(tarifaCalc.tarifa) : '— (revisá el km o la tabla CATAC)'}
                </div>
              </div>
            )}
            {maestraElegida && tarifaCalc && tarifaCalc.ratio != null && (
              <div style={S.calculoBox}>
                <strong>Cómo se calcula:</strong> CATAC ({formatoKm(km)} km) × (tarifa de la maestra ÷ CATAC
                ({formatoKm(maestraElegida.km)} km de la maestra)) = {formatoMoneda(tarifaCalc.tarifa)}
              </div>
            )}
            <Boton disabled={busy || !maestraElegida || !!rutaExistente} onClick={guardar}>
              {busy ? 'Guardando…' : 'Guardar ruta derivada'}
            </Boton>
          </>
        )}
      </div>
    </div>
  );
}
