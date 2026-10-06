/**
 * =============================================================================
 * nuevo-tarifario/ModalNuevaMaestra.js — v1.2.0 (rediseño NuevoTarifario)
 * =============================================================================
 *
 * SÍNTOMA
 *   "Nueva ruta maestra" era un modal angosto (una columna, `ancho={560}`),
 *   sin mostrar en vivo la referencia CATAC ni la brecha resultante mientras
 *   se carga la tarifa inicial.
 *
 * CAUSA RAÍZ
 *   El diseño pide el mismo lenguaje de modal de dos columnas que el resto
 *   de la pantalla (`ui/Modal.js`, grid dos columnas) — la primera versión
 *   era un formulario de una sola columna, previo al rediseño.
 *
 * ALCANCE
 *   Misma lógica EXACTA que tenía `NuevoTarifario.js` (`validarRuta` +
 *   `crearRutaParametro`, tal cual, sin tocar `logica-tarifario.js`):
 *   columna izquierda con el formulario (Origen/Destino/Producto con
 *   `CampoConSugerencias`, Km, Categoría, Tarifa vigente inicial,
 *   Justificación); columna derecha, panel cálido con Referencia CATAC y
 *   Brecha calculadas EN VIVO contra `getCatac(km)` a medida que se tipea
 *   —dato nuevo que el modal angosto original no mostraba—. Botón primario
 *   "Crear ruta maestra".
 *
 * LIMITACIONES CONOCIDAS
 *   Ninguna nueva — mismas validaciones y mensajes de error que el modal
 *   original.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Manual: ver la lista de pruebas de
 *   `NuevoTarifario` en el CHANGELOG v1.2.0.
 * ========================================================================== */

import React, { useState, useMemo } from 'react';
import Modal from '../../ui/Modal';
import Boton from '../../ui/Boton';
import { espacio } from '../../ui/tokens';
import { formatoMoneda, formatoPorcentaje } from '../../formatos';
import { brechaContraCatac } from '../../calculo-tarifario';
import { validarRuta, crearRutaParametro, CATEGORIAS } from '../../logica-tarifario';
import CampoConSugerencias from './CampoConSugerencias';

export default function ModalNuevaMaestra({ S, usuario, rutas, getCatac, sugOrigenes, sugDestinos, sugProductos, onCerrar, onCreada }) {
  const [origen, setOrigen] = useState('');
  const [destino, setDestino] = useState('');
  const [producto, setProducto] = useState('');
  const [categoria, setCategoria] = useState('General');
  const [km, setKm] = useState('');
  const [tarifa, setTarifa] = useState('');
  const [just, setJust] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const catacRef = useMemo(() => (km ? getCatac(km) : null), [km, getCatac]);
  const brecha = useMemo(() => (catacRef ? brechaContraCatac(tarifa, catacRef) : null), [tarifa, catacRef]);

  const guardar = async () => {
    setErr('');
    const datos = { origen, destino, producto, km, tarifa_vigente: tarifa, categoria, catac_ref: catacRef };
    const problemas = validarRuta(datos, { rutas });
    if (problemas.length > 0) { setErr(problemas.join(' ')); return; }
    if (!just.trim()) { setErr('Ingresá la justificación de la tarifa inicial.'); return; }
    setBusy(true);
    try {
      await crearRutaParametro({ datos, usuario, rutas, extra: { just } });
      onCreada();
    } catch (e) {
      setErr(e.message || 'No se pudo crear la ruta.');
    }
    setBusy(false);
  };

  return (
    <Modal titulo="Nueva ruta maestra" onCerrar={onCerrar} ancho={640}>
      <div style={S.modalDosColumnas}>
        <div style={S.modalColumna}>
          <div style={{ ...S.fr, display: 'flex', gap: espacio.sm }}>
            <CampoConSugerencias S={S} etiqueta="Origen" id="dl-nm-origen" valor={origen} opciones={sugOrigenes} onChange={setOrigen} />
            <CampoConSugerencias S={S} etiqueta="Destino" id="dl-nm-destino" valor={destino} opciones={sugDestinos} onChange={setDestino} />
          </div>
          <div style={{ display: 'flex', gap: espacio.sm, flexWrap: 'wrap', marginBottom: espacio.md }}>
            <CampoConSugerencias S={S} etiqueta="Producto" id="dl-nm-producto" valor={producto} opciones={sugProductos} onChange={setProducto} ancho={160} />
            <div>
              <label style={S.label}>Categoría</label>
              <select style={S.select} value={categoria} onChange={e => setCategoria(e.target.value)}>
                {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={S.label}>Km</label>
              <input style={{ ...S.input, width: 90 }} type="number" min="1" value={km} onChange={e => setKm(e.target.value)} />
            </div>
            <div>
              <label style={S.label}>Tarifa vigente inicial</label>
              <input style={{ ...S.input, width: 140 }} type="number" min="1" value={tarifa} onChange={e => setTarifa(e.target.value)} />
            </div>
          </div>
          <div style={S.fr}>
            <label style={S.label}>Justificación</label>
            <input style={{ ...S.input, width: '100%' }} value={just} onChange={e => setJust(e.target.value)} />
          </div>
          {err && <div style={S.aviso('error')}>{err}</div>}
          <Boton disabled={busy} onClick={guardar}>{busy ? 'Guardando…' : 'Crear ruta maestra'}</Boton>
        </div>

        <div style={{ ...S.modalColumna, ...S.panelCalido }}>
          <div style={S.panelCalidoTitulo}>Referencia CATAC</div>
          <div style={{ marginBottom: espacio.md, fontSize: 20, fontWeight: 700 }}>
            {catacRef != null ? formatoMoneda(catacRef) : '— (cargá el km)'}
          </div>
          <div style={S.panelCalidoTitulo}>Brecha contra CATAC</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {brecha != null ? formatoPorcentaje(brecha) : '— (cargá la tarifa)'}
          </div>
        </div>
      </div>
    </Modal>
  );
}
