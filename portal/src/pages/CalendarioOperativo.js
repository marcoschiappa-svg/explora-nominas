/**
 * =============================================================================
 * CalendarioOperativo.js — v1.2.0 (RF-10)
 * =============================================================================
 *
 * SÍNTOMA
 *   No había un único lugar donde marcar "hoy no se carga" o "hoy no se
 *   opera" — un feriado o una parada de planta se manejaba de palabra.
 *
 * CAUSA RAÍZ
 *   El calendario operativo (`logica-calendario.js`) recién se agrega en
 *   esta versión.
 *
 * ALCANCE
 *   Vista mensual con navegación, construida con CSS grid (sin librería de
 *   calendario). Cada día muestra su tipo (explícito o por regla semanal)
 *   con color y una leyenda fija. Clic en un día abre un panel para
 *   marcarlo, cambiarle el tipo/motivo o desmarcarlo (`desactivar()` de
 *   `datos.js` — nada se borra). Al marcar o cambiar el tipo de un día, el
 *   panel lista, informativamente, los despachos vivos con `fecha_carga` ese
 *   día y las entregas no suspendidas ni cumplidas con `fecha_solicitada`
 *   ese día (`where` de un solo campo cada una — no hay índice compuesto que
 *   pedir). Es solo informativo: no mueve nada.
 *
 *   Sección "Reglas semanales": los siete días con un selector de tipo cada
 *   uno, sobre el documento único `calendario_reglas/semanal`.
 *
 *   Esta pantalla se suscribe a la colección `calendario_operativo` ENTERA
 *   (activos e inactivos), a diferencia de `Pedidos.js`/`Programacion.js`
 *   (que solo necesitan los activos): acá hace falta saber si ya existe un
 *   documento para una fecha — aunque esté inactivo — para decidir si hay
 *   que `crear()` uno nuevo o `actualizar()`/`reactivar()` el que ya está
 *   (el ID es fijo, `YYYY-MM-DD`; `crear()` con un ID que ya existe tira
 *   error).
 *
 * LIMITACIONES CONOCIDAS
 *   No hay un tipo "abierto" que anule la regla semanal: desmarcar un día
 *   puntual cubierto por una regla semanal activa no lo abre — la regla
 *   sigue rigiendo. Para abrir ESE día puntual hay que marcarlo
 *   explícitamente con otro criterio (hoy no existe "abierto" como tipo).
 *   Documentado también en `logica-calendario.js` y `COMPORTAMIENTO.md`.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Pruebas manuales al pie del
 *   reporte de la tarea: marcar un día explícito, marcar una regla semanal,
 *   confirmar que desmarcar un día puntual cubierto por una regla activa no
 *   lo abre, y que el comercial/transportista no ven este módulo.
 * ========================================================================== */

import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { crear, actualizar, desactivar } from '../datos';
import { motivoSinAcceso } from '../sesion';
import { rolesDe } from '../modulos';
import { despachoVivo, ENTREGA } from '../estados';
import {
  tipoDelDia, TIPO_SIN_DESPACHO, TIPO_SIN_OPERACION, ETIQUETA_TIPO_DIA,
} from '../logica-calendario';
import { marca, colorEstado, espacio, radio, tipografia } from '../ui/tokens';
import { useTema } from '../ui/TemaContext';
import Boton from '../ui/Boton';
import Tarjeta from '../ui/Tarjeta';
import Campo from '../ui/Campo';
import Modal from '../ui/Modal';
import Vacio from '../ui/Vacio';

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const COLOR_TIPO = {
  [TIPO_SIN_OPERACION]: { bg: colorEstado.peligroFondo, borde: colorEstado.peligroBordeAlterno, texto: colorEstado.peligroTexto },
  [TIPO_SIN_DESPACHO]: { bg: colorEstado.advertenciaFondo, borde: colorEstado.advertenciaBorde, texto: colorEstado.advertenciaTexto },
};

function aFechaISOLocal(d) {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function hoyISO() {
  return aFechaISOLocal(new Date());
}

function traducirError(err) {
  if (err && err.code === 'permission-denied') {
    return 'Firestore rechazó la escritura. Revisá la consola del navegador.';
  }
  return (err && err.message) || 'Error desconocido.';
}

/** Las celdas del mes: relleno con los días del mes anterior/siguiente para
 * completar semanas enteras, empezando en domingo. */
function celdasDelMes(anio, mes) {
  const primero = new Date(anio, mes, 1);
  const ultimoDia = new Date(anio, mes + 1, 0).getDate();
  const inicioGrilla = new Date(anio, mes, 1 - primero.getDay());

  const celdas = [];
  const cursor = new Date(inicioGrilla);
  // 6 semanas cubren cualquier mes con el mismo tamaño de grilla siempre.
  for (let i = 0; i < 42; i++) {
    celdas.push({
      fecha: aFechaISOLocal(cursor),
      dia: cursor.getDate(),
      delMes: cursor.getMonth() === mes,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  // No hace falta la sexta semana si ya se completaron todos los días del
  // mes y la semana entera siguiente cae fuera -- pero dejarla no molesta,
  // así que se simplifica no recortando (evita off-by-one con meses de 4
  // semanas exactas como febrero en años bisiestos raros).
  void ultimoDia;
  return celdas;
}

export default function CalendarioOperativo({ usuario, onVolver }) {
  const styles = useEstilos();
  const sinAcceso = motivoSinAcceso(usuario, rolesDe('calendario'));

  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth());

  const [dias, setDias] = useState([]); // TODOS los documentos, activos e inactivos
  const [reglas, setReglas] = useState(null);
  const [cargando, setCargando] = useState(true);

  const [diaAbierto, setDiaAbierto] = useState(null); // fechaISO, o null
  const [guardandoReglas, setGuardandoReglas] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (sinAcceso) { setCargando(false); return; }
    const unsubs = [
      onSnapshot(collection(db, 'calendario_operativo'), (snap) => {
        setDias(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setCargando(false);
      }, (err) => { console.error('calendario_operativo:', err); setCargando(false); }),
      onSnapshot(collection(db, 'calendario_reglas'), (snap) => {
        const semanal = snap.docs.find(d => d.id === 'semanal');
        setReglas(semanal ? semanal.data() : null);
      }),
    ];
    return () => unsubs.forEach(u => u());
  }, [sinAcceso]);

  const docsPorFecha = useMemo(() => new Map(dias.map(d => [d.id, d])), [dias]);
  // Solo los activos entran a `tipoDelDia()` -- mismo criterio que las
  // pantallas que consumen el calendario (ver `logica-calendario.js`).
  const activosPorFecha = useMemo(
    () => new Map(dias.filter(d => d.estado === 'activo').map(d => [d.id, d])),
    [dias]
  );

  function cambiarMes(delta) {
    const d = new Date(anio, mes + delta, 1);
    setAnio(d.getFullYear());
    setMes(d.getMonth());
  }

  const celdas = useMemo(() => celdasDelMes(anio, mes), [anio, mes]);

  async function guardarDia(fechaISO, tipo, motivo) {
    setError('');
    try {
      const existente = docsPorFecha.get(fechaISO);
      const motivoLimpio = (motivo || '').trim();
      if (!motivoLimpio) throw new Error('El motivo es obligatorio.');

      if (!existente) {
        await crear({
          coleccion: 'calendario_operativo', id: fechaISO,
          datos: { tipo, motivo: motivoLimpio, estado: 'activo' },
          accion: 'marcar_dia_calendario', entidadTipo: 'calendario_operativo', usuario,
        });
      } else {
        await actualizar({
          coleccion: 'calendario_operativo', id: fechaISO,
          cambios: { tipo, motivo: motivoLimpio, estado: 'activo' },
          accion: 'marcar_dia_calendario', entidadTipo: 'calendario_operativo', usuario,
        });
      }
    } catch (err) {
      console.error(err);
      setError(traducirError(err));
    }
  }

  async function desmarcarDia(fechaISO) {
    setError('');
    try {
      await desactivar({
        coleccion: 'calendario_operativo', id: fechaISO,
        accion: 'desmarcar_dia_calendario', usuario,
      });
    } catch (err) {
      console.error(err);
      setError(traducirError(err));
    }
  }

  async function guardarReglaDia(dow, tipo) {
    setGuardandoReglas(true);
    setError('');
    try {
      const nuevoMapa = { ...(reglas && reglas.dias ? reglas.dias : {}), [String(dow)]: tipo || null };
      const refReglas = doc(db, 'calendario_reglas', 'semanal');
      const snap = await getDoc(refReglas);
      if (!snap.exists()) {
        await crear({
          coleccion: 'calendario_reglas', id: 'semanal', datos: { dias: nuevoMapa },
          accion: 'editar_regla_semanal', entidadTipo: 'calendario_reglas', usuario,
        });
      } else {
        await actualizar({
          coleccion: 'calendario_reglas', id: 'semanal', cambios: { dias: nuevoMapa },
          accion: 'editar_regla_semanal', entidadTipo: 'calendario_reglas', usuario,
        });
      }
    } catch (err) {
      console.error(err);
      setError(traducirError(err));
    } finally {
      setGuardandoReglas(false);
    }
  }

  if (sinAcceso) {
    return <div style={styles.wrap}><div style={styles.bannerError}>{sinAcceso}</div></div>;
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.panelHeader}>
        <div style={styles.titulo}>Calendario operativo</div>
      </div>

      {error && <div style={styles.bannerError}>{error}</div>}

      <div style={styles.leyenda}>
        <span style={styles.leyendaItem}>
          <span style={{ ...styles.leyendaPunto, background: COLOR_TIPO[TIPO_SIN_OPERACION].bg, borderColor: COLOR_TIPO[TIPO_SIN_OPERACION].borde }} />
          Sin operación — bloquea cualquier tipo de pedido
        </span>
        <span style={styles.leyendaItem}>
          <span style={{ ...styles.leyendaPunto, background: COLOR_TIPO[TIPO_SIN_DESPACHO].bg, borderColor: COLOR_TIPO[TIPO_SIN_DESPACHO].borde }} />
          Sin despacho — bloquea solo "Entrega al cliente"
        </span>
      </div>

      <Tarjeta style={{ padding: espacio.lg, marginBottom: espacio.lg }}>
        <div style={styles.navMes}>
          <Boton variante="secundario" chico onClick={() => cambiarMes(-1)}>← Anterior</Boton>
          <div style={styles.mesTitulo}>{MESES[mes]} {anio}</div>
          <Boton variante="secundario" chico onClick={() => cambiarMes(1)}>Siguiente →</Boton>
        </div>

        <div style={styles.grillaSemana}>
          {DIAS_CORTOS.map(d => <div key={d} style={styles.encabezadoDia}>{d}</div>)}
        </div>

        {cargando
          ? <Vacio titulo="Cargando..." />
          : (
            <div style={styles.grilla}>
              {celdas.map(c => {
                const tipo = tipoDelDia(c.fecha, activosPorFecha, reglas);
                const explicito = activosPorFecha.get(c.fecha);
                const porRegla = tipo && !explicito;
                const col = tipo ? COLOR_TIPO[tipo] : null;
                return (
                  <button
                    key={c.fecha}
                    type="button"
                    onClick={() => setDiaAbierto(c.fecha)}
                    style={{
                      ...styles.celda,
                      opacity: c.delMes ? 1 : 0.35,
                      background: col ? col.bg : undefined,
                      borderColor: col ? col.borde : undefined,
                      outline: c.fecha === hoyISO() ? `1.5px solid ${marca}` : undefined,
                    }}
                  >
                    <span style={{ ...styles.celdaNro, color: col ? col.texto : undefined }}>{c.dia}</span>
                    {tipo && (
                      <span style={{ ...styles.celdaEtiqueta, color: col.texto }}>
                        {ETIQUETA_TIPO_DIA[tipo]}{porRegla ? ' (regla)' : ''}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
      </Tarjeta>

      <ReglasSemanales reglas={reglas} guardando={guardandoReglas} onGuardarDia={guardarReglaDia} />

      {diaAbierto && (
        <PanelDia
          fechaISO={diaAbierto}
          documento={docsPorFecha.get(diaAbierto) || null}
          tipoEfectivo={tipoDelDia(diaAbierto, activosPorFecha, reglas)}
          onGuardar={(tipo, motivo) => guardarDia(diaAbierto, tipo, motivo)}
          onDesmarcar={() => desmarcarDia(diaAbierto)}
          onCerrar={() => setDiaAbierto(null)}
        />
      )}
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Reglas semanales
 * -------------------------------------------------------------------------- */

function ReglasSemanales({ reglas, guardando, onGuardarDia }) {
  const styles = useEstilos();
  return (
    <Tarjeta style={{ padding: espacio.lg }}>
      <div style={styles.seccionTitulo}>Reglas semanales</div>
      <div style={styles.instruccion}>
        Para marcar algo que se repite todas las semanas (por ejemplo, "domingos sin
        operación") sin cargar un día a la vez. Un día marcado explícitamente arriba
        gana sobre esto. Desmarcar un día puntual NO anula la regla: para abrir un
        domingo puntual hay que marcarlo explícitamente con otro criterio -- hoy no
        existe un tipo "abierto" que anule la regla semanal.
      </div>
      <div style={styles.reglasGrid}>
        {DIAS_LARGOS.map((nombre, dow) => (
          <div key={dow} style={styles.reglaFila}>
            <span style={styles.reglaDia}>{nombre}</span>
            <select
              style={styles.reglaSelect}
              disabled={guardando}
              value={(reglas && reglas.dias && reglas.dias[String(dow)]) || ''}
              onChange={e => onGuardarDia(dow, e.target.value || null)}
            >
              <option value="">Sin regla</option>
              <option value={TIPO_SIN_OPERACION}>{ETIQUETA_TIPO_DIA[TIPO_SIN_OPERACION]}</option>
              <option value={TIPO_SIN_DESPACHO}>{ETIQUETA_TIPO_DIA[TIPO_SIN_DESPACHO]}</option>
            </select>
          </div>
        ))}
      </div>
    </Tarjeta>
  );
}

/* -----------------------------------------------------------------------------
 * Panel de un día -- marcar/cambiar/desmarcar + lo que ya está cargado ahí
 * -------------------------------------------------------------------------- */

function PanelDia({ fechaISO, documento, tipoEfectivo, onGuardar, onDesmarcar, onCerrar }) {
  const styles = useEstilos();
  const estaActivo = documento && documento.estado === 'activo';

  const [tipo, setTipo] = useState((estaActivo && documento.tipo) || TIPO_SIN_OPERACION);
  const [motivo, setMotivo] = useState((estaActivo && documento.motivo) || '');
  const [guardando, setGuardando] = useState(false);
  const [errorForm, setErrorForm] = useState('');

  const [cargandoUso, setCargandoUso] = useState(true);
  const [despachosDelDia, setDespachosDelDia] = useState([]);
  const [entregasDelDia, setEntregasDelDia] = useState([]);

  useEffect(() => {
    let cancelado = false;
    setCargandoUso(true);
    Promise.all([
      getDocs(query(collection(db, 'despachos'), where('fecha_carga', '==', fechaISO))),
      getDocs(query(collection(db, 'entregas'), where('fecha_solicitada', '==', fechaISO))),
    ]).then(([snapD, snapE]) => {
      if (cancelado) return;
      setDespachosDelDia(snapD.docs.map(d => ({ id: d.id, ...d.data() })).filter(despachoVivo));
      setEntregasDelDia(snapE.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(e => e.estado !== ENTREGA.SUSPENDIDA && e.estado !== ENTREGA.CUMPLIDA));
      setCargandoUso(false);
    }).catch(err => {
      console.error('Uso del día:', err);
      if (!cancelado) setCargandoUso(false);
    });
    return () => { cancelado = true; };
  }, [fechaISO]);

  async function guardar() {
    if (!motivo.trim()) { setErrorForm('El motivo es obligatorio.'); return; }
    setErrorForm('');
    setGuardando(true);
    await onGuardar(tipo, motivo);
    setGuardando(false);
    onCerrar();
  }

  async function desmarcar() {
    setGuardando(true);
    await onDesmarcar();
    setGuardando(false);
    onCerrar();
  }

  return (
    <Modal titulo={fechaISO} onCerrar={onCerrar} ancho={480}>
      {tipoEfectivo && !estaActivo && (
        <div style={styles.avisoRegla}>
          Este día está cubierto por la regla semanal ({ETIQUETA_TIPO_DIA[tipoEfectivo]}).
          Marcarlo acá lo pasa a explícito para esta fecha puntual.
        </div>
      )}

      {errorForm && <div style={styles.bannerErrorChico}>{errorForm}</div>}

      <Campo as="select" label="Tipo" value={tipo} onChange={e => setTipo(e.target.value)}>
        <option value={TIPO_SIN_OPERACION}>{ETIQUETA_TIPO_DIA[TIPO_SIN_OPERACION]} -- bloquea cualquier tipo de pedido</option>
        <option value={TIPO_SIN_DESPACHO}>{ETIQUETA_TIPO_DIA[TIPO_SIN_DESPACHO]} -- bloquea solo "Entrega al cliente"</option>
      </Campo>

      <Campo
        label="Motivo *" value={motivo} onChange={e => setMotivo(e.target.value)}
        placeholder='Ej: "Feriado 9 de julio" o "Parada de planta"'
      />

      <div style={styles.accionesFila}>
        <Boton disabled={guardando} onClick={guardar}>
          {guardando ? 'Guardando...' : (estaActivo ? 'Guardar cambios' : 'Marcar día')}
        </Boton>
        {estaActivo && (
          <Boton variante="peligro" disabled={guardando} onClick={desmarcar}>Desmarcar</Boton>
        )}
        <Boton variante="secundario" disabled={guardando} onClick={onCerrar}>Cerrar</Boton>
      </div>

      <div style={styles.usoTitulo}>Lo que ya cae en esta fecha (informativo)</div>
      {cargandoUso && <div style={styles.usoVacio}>Consultando...</div>}
      {!cargandoUso && despachosDelDia.length === 0 && entregasDelDia.length === 0 && (
        <div style={styles.usoVacio}>Nada, por ahora.</div>
      )}
      {!cargandoUso && despachosDelDia.length > 0 && (
        <div style={styles.usoBloque}>
          <div style={styles.usoSubtitulo}>Despachos vivos con fecha de carga ese día</div>
          {despachosDelDia.map(d => (
            <div key={d.id} style={styles.usoItem}>
              {d.numero || d.id} -- {d.cliente_razon_social || 'sin cliente denormalizado'} -- {d.estado}
            </div>
          ))}
        </div>
      )}
      {!cargandoUso && entregasDelDia.length > 0 && (
        <div style={styles.usoBloque}>
          <div style={styles.usoSubtitulo}>Entregas (no suspendidas ni cumplidas) solicitadas ese día</div>
          {entregasDelDia.map(e => (
            <div key={e.id} style={styles.usoItem}>
              Pedido {e.pedido_id} -- entrega #{e.numero} -- {e.volumen} tn -- {e.estado}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/* -----------------------------------------------------------------------------
 * Estilos -- crearEstilos(colores, oscuro) + useEstilos()
 * -------------------------------------------------------------------------- */

function crearEstilos(colores, oscuro) {
  return {
    wrap: { maxWidth: 960, margin: '0 auto', padding: `${espacio.xl}px ${espacio.lg}px` },
    panelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: espacio.lg },
    titulo: { fontSize: tipografia.tamano.titulo, fontWeight: tipografia.peso.negrita, color: colores.texto },
    bannerError: {
      padding: '10px 14px', borderRadius: radio.md, background: colorEstado.peligroFondo,
      border: `0.5px solid ${colorEstado.peligroBordeAlterno}`, fontSize: tipografia.tamano.md,
      color: colorEstado.peligroTexto, marginBottom: espacio.md,
    },
    bannerErrorChico: {
      padding: '8px 10px', borderRadius: radio.sm, background: colorEstado.peligroFondo,
      fontSize: tipografia.tamano.sm, color: colorEstado.peligroTexto, marginBottom: espacio.sm,
    },

    leyenda: { display: 'flex', gap: espacio.lg, flexWrap: 'wrap', marginBottom: espacio.md },
    leyendaItem: { display: 'flex', alignItems: 'center', gap: 6, fontSize: tipografia.tamano.sm, color: colores.textoSecundario },
    leyendaPunto: { width: 12, height: 12, borderRadius: 4, border: '1px solid', display: 'inline-block' },

    navMes: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: espacio.md },
    mesTitulo: { fontSize: tipografia.tamano.xl, fontWeight: tipografia.peso.medio, color: colores.texto },

    grillaSemana: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 },
    encabezadoDia: { textAlign: 'center', fontSize: tipografia.tamano.xs, color: colores.textoTenue, fontWeight: tipografia.peso.medio, padding: '4px 0' },

    grilla: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 },
    celda: {
      minHeight: 64, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start',
      padding: '6px 6px', borderRadius: radio.sm, border: `0.5px solid ${colores.borde}`,
      background: colores.superficie, cursor: 'pointer', textAlign: 'left', fontFamily: tipografia.familia,
    },
    celdaNro: { fontSize: tipografia.tamano.sm, color: colores.texto, fontWeight: tipografia.peso.medio },
    celdaEtiqueta: { fontSize: 9, marginTop: 4, lineHeight: 1.2 },

    seccionTitulo: { fontSize: tipografia.tamano.lg, fontWeight: tipografia.peso.medio, color: colores.texto, marginBottom: espacio.xs },
    instruccion: { fontSize: tipografia.tamano.sm, color: colores.textoSuave, lineHeight: 1.5, marginBottom: espacio.md },

    reglasGrid: { display: 'flex', flexDirection: 'column', gap: espacio.xs },
    reglaFila: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: espacio.sm },
    reglaDia: { fontSize: tipografia.tamano.md, color: colores.texto, textTransform: 'capitalize' },
    reglaSelect: {
      fontSize: tipografia.tamano.sm, padding: '6px 8px', borderRadius: radio.sm,
      border: `0.5px solid ${colores.borde}`, color: colores.texto, background: colores.superficie,
      fontFamily: tipografia.familia,
    },

    avisoRegla: {
      fontSize: tipografia.tamano.sm, color: oscuro ? '#93C5FD' : colorEstado.acentoAzul,
      lineHeight: 1.4, padding: '8px 10px', background: colores.fondoAlterno, borderRadius: radio.sm,
      marginBottom: espacio.md,
    },
    accionesFila: { display: 'flex', gap: espacio.sm, marginTop: espacio.sm, marginBottom: espacio.lg, flexWrap: 'wrap' },

    usoTitulo: { fontSize: tipografia.tamano.md, fontWeight: tipografia.peso.medio, color: colores.texto, marginBottom: 4 },
    usoVacio: { fontSize: tipografia.tamano.sm, color: colores.textoTenue },
    usoBloque: { marginTop: espacio.xs },
    usoSubtitulo: { fontSize: tipografia.tamano.xs, color: colores.textoTenue, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 },
    usoItem: { fontSize: tipografia.tamano.sm, color: colores.textoSecundario, padding: '3px 0', borderBottom: `0.5px solid ${colores.borde}` },
  };
}

function useEstilos() {
  const { colores, oscuro } = useTema();
  return useMemo(() => crearEstilos(colores, oscuro), [colores, oscuro]);
}
