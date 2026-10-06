/**
 * =============================================================================
 * ModalCierreManual.js — v1.2.0 (RF-02)
 * =============================================================================
 *
 * SÍNTOMA
 *   El cierre manual de un viaje ("Cerrar viaje a mano", en Programación) era
 *   un `window.prompt()` pidiendo el motivo como texto libre, sin fecha de
 *   fin propia -- quedaba `serverTimestamp()`, "ahora mismo", aunque el
 *   coordinador estuviera cerrando dos días después un viaje que se le
 *   había pasado -- y sin validación de ningún tipo.
 *
 * CAUSA RAÍZ
 *   No existía un componente para esto: la acción se armó rápido, sobre la
 *   marcha, con la herramienta más simple posible (`window.prompt`).
 *
 * ALCANCE
 *   Modal reutilizable -- lo usan `Programacion.js` y `Seguimiento.js` (y,
 *   cuando exista, la vista de ciclo de vida de RF-05). Motivo de una lista
 *   cerrada (`MOTIVOS_CIERRE_MANUAL`, exportada para que agregar uno sea
 *   editar un array) + detalle obligatorio solo si el motivo es "Otro", y
 *   fecha/hora de fin obligatoria, sin pedir inicio: un viaje cerrado desde
 *   `RECIBIDO` queda sin inicio siempre -- el cierre manual nunca inventa un
 *   dato que no se tiene (ver el encabezado v2 de `finalizarViaje()`, en
 *   `logica-viajes.js`).
 *
 *   1. La validación de la fecha de fin (`validarCierreManual()`, en
 *      `logica-viajes.js`) se corre ACÁ antes de guardar, y otra vez DENTRO
 *      de la transacción de `finalizarViaje()`, sobre el viaje releído --
 *      la misma función en los dos lugares, no dos criterios que puedan
 *      divergir.
 *   2. El motivo se guarda en el campo YA EXISTENTE `cierre_motivo`, como
 *      texto: el motivo elegido tal cual, o `"<motivo>: <detalle>"` si hay
 *      detalle (obligatorio para "Otro", opcional para el resto). No se
 *      agrega ningún campo nuevo al viaje.
 *
 * LIMITACIONES CONOCIDAS
 *   El encabezado (chofer, patente, número de despacho) se arma con lo que
 *   el llamador ya tiene a mano -- si `despacho.numero` no está (por
 *   ejemplo, desde `Seguimiento.js`, que no lee `despachos` para no sumar
 *   una consulta nueva a Firestore), esa línea simplemente no se muestra.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Manualmente: motivo "Otro" sin
 *   detalle no deja guardar; fin en el futuro, o dos días antes de la fecha
 *   de carga, tampoco. Con motivo de la lista y fecha válida, el despacho
 *   pasa a Entregado y el viaje muestra "Finalizado (cerrado por Explora)"
 *   con el `cierre_motivo` correcto.
 * ========================================================================== */

import React, { useState } from 'react';
import { finalizarViaje, validarCierreManual } from '../logica-viajes';
import { espacio, tipografia, colorEstado, paletaTexto } from '../ui/tokens';
import { useTema } from '../ui/TemaContext';
import Modal from '../ui/Modal';
import Campo from '../ui/Campo';
import Boton from '../ui/Boton';

/** 3. Lista cerrada -- editar acá para agregar o sacar un motivo. */
export const MOTIVOS_CIERRE_MANUAL = [
  'El chofer no usa la app',
  'El chofer no cerró el viaje',
  'Problema con el teléfono o la app',
  'Otro',
];

const MOTIVO_OTRO = 'Otro';

function ahoraParaInput() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 4. Mismo criterio de traducción que `traducirError` de las pantallas
 * (Programacion.js, Organizaciones.js...): `permission-denied` es el que
 * más aparece y el que menos dice. */
function traducirError(err) {
  if (err && err.code === 'permission-denied') {
    return 'Firestore rechazó la escritura. Revisá la consola del navegador.';
  }
  return (err && err.message) || 'Error desconocido.';
}

/**
 * @param {Object} props
 * @param {Object} props.viaje
 * @param {{id: string, numero?: string, fecha_carga?: string}} props.despacho
 * @param {Object} props.usuario
 * @param {() => void} props.onCerrado
 * @param {() => void} props.onCancelar
 */
export default function ModalCierreManual({ viaje, despacho, usuario, onCerrado, onCancelar }) {
  const styles = useEstilos();
  const [motivo, setMotivo] = useState(MOTIVOS_CIERRE_MANUAL[0]);
  const [detalle, setDetalle] = useState('');
  const [finLocal, setFinLocal] = useState(ahoraParaInput());
  const [errores, setErrores] = useState([]);
  const [guardando, setGuardando] = useState(false);

  const detalleObligatorio = motivo === MOTIVO_OTRO;

  /** 5. `cierre_motivo`: el motivo tal cual, o "<motivo>: <detalle>" si hay
   * detalle -- "Otro: <detalle>" incluido, es el mismo caso general. */
  function armarCierreMotivo() {
    const det = detalle.trim();
    return det ? `${motivo}: ${det}` : motivo;
  }

  function validar() {
    const problemas = [];

    if (!motivo) problemas.push('Elegí un motivo.');
    if (detalleObligatorio && !detalle.trim()) {
      problemas.push('Contá el detalle: con "Otro" es obligatorio.');
    }

    if (!finLocal) {
      problemas.push('Elegí la fecha y hora de fin.');
    } else {
      problemas.push(...validarCierreManual({
        finTs: new Date(finLocal),
        fechaCarga: despacho && despacho.fecha_carga,
        inicioTs: viaje && viaje.inicio_ts,
      }));
    }

    return problemas;
  }

  async function guardar() {
    const problemas = validar();
    if (problemas.length > 0) { setErrores(problemas); return; }

    setGuardando(true);
    setErrores([]);

    try {
      await finalizarViaje({
        viaje,
        despacho: { id: despacho.id },
        posicion: null,
        cerradoPor: 'manual',
        motivo: armarCierreMotivo(),
        finTsManual: finLocal,
        usuario,
      });
      onCerrado();
    } catch (err) {
      console.error(err);
      setErrores([traducirError(err)]);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Cerrar viaje a mano" onCerrar={onCancelar} ancho={460}>
      <div style={styles.encabezado}>
        {despacho && despacho.numero && <div style={styles.encabezadoLinea}>Despacho {despacho.numero}</div>}
        {viaje && viaje.chofer_dni && (
          <div style={styles.encabezadoLinea}>
            Chofer {viaje.chofer_dni}
            {viaje.patente_tractor && <> · {viaje.patente_tractor}</>}
            {viaje.patente_semi && <> + {viaje.patente_semi}</>}
          </div>
        )}
      </div>

      <div style={styles.aviso}>
        Sin hora de inicio: un viaje cerrado a mano queda sin esa marca,
        siempre -- el cierre manual no inventa un dato que no se tiene.
      </div>

      {errores.length > 0 && (
        <div style={styles.bannerError}>
          {errores.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}

      <Campo as="select" label="Motivo *" value={motivo} onChange={e => setMotivo(e.target.value)}>
        {MOTIVOS_CIERRE_MANUAL.map(m => <option key={m} value={m}>{m}</option>)}
      </Campo>

      <Campo
        as="textarea"
        label={detalleObligatorio ? 'Detalle *' : 'Detalle'}
        value={detalle}
        onChange={e => setDetalle(e.target.value)}
        style={{ minHeight: 60, resize: 'vertical' }}
        ayuda={detalleObligatorio ? 'Obligatorio con "Otro".' : 'Opcional.'}
      />

      <Campo
        label="Fecha y hora de fin *"
        type="datetime-local"
        value={finLocal}
        onChange={e => setFinLocal(e.target.value)}
      />

      <div style={styles.acciones}>
        <Boton disabled={guardando} onClick={guardar}>
          {guardando ? 'Cerrando...' : 'Cerrar viaje'}
        </Boton>
        <Boton variante="secundario" disabled={guardando} onClick={onCancelar}>
          Cancelar
        </Boton>
      </div>
    </Modal>
  );
}

/* -----------------------------------------------------------------------------
 * Estilos -- crearEstilos(colores, oscuro) + useEstilos(), mismo patrón que
 * el resto de `ui/` y de las pantallas migradas.
 * -------------------------------------------------------------------------- */

function crearEstilos(colores, oscuro) {
  const pal = paletaTexto(oscuro);

  return {
    encabezado: { marginBottom: espacio.sm },
    encabezadoLinea: { fontSize: tipografia.tamano.md, color: colores.texto, fontWeight: tipografia.peso.medio },
    aviso: {
      fontSize: tipografia.tamano.sm, color: pal.azul, lineHeight: 1.4,
      padding: '8px 10px', background: colores.fondoAlterno, borderRadius: 8, marginBottom: espacio.md,
    },
    bannerError: {
      padding: '10px 14px', borderRadius: 8, background: colorEstado.peligroFondo,
      border: `0.5px solid ${colorEstado.peligroBordeAlterno}`, fontSize: tipografia.tamano.md,
      color: colorEstado.peligroTexto, marginBottom: espacio.md, whiteSpace: 'pre-line',
    },
    acciones: { display: 'flex', gap: espacio.sm, marginTop: espacio.sm },
  };
}

function useEstilos() {
  const { colores, oscuro } = useTema();
  return crearEstilos(colores, oscuro);
}
