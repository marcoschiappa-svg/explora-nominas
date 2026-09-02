/**
 * =============================================================================
 * MisViajes.js — Pantalla del chofer (Portal Explora)
 * =============================================================================
 *
 * PROPÓSITO
 * Lo que el chofer ve y hace: sus viajes asignados, arrancar, avisar una demora
 * y cerrar.
 *
 * Es la versión web de lo que hace TrackEx. Las dos escriben lo mismo, así que
 * un chofer puede usar cualquiera de las dos — y mientras la app no se publique,
 * esta es la que hay.
 *
 * -----------------------------------------------------------------------------
 * LEE UNA SOLA COLECCION
 * -----------------------------------------------------------------------------
 * El chofer NO lee `pedidos` ni `despachos`: las reglas lo dejan afuera. Todo
 * lo que esta pantalla muestra —cliente, producto, destino, volumen, patentes—
 * está denormalizado en el viaje, copiado al nominar.
 *
 * Eso no es una optimización: es lo que hace posible acotarle el acceso. Hoy la
 * app trae TODOS los pedidos y filtra en memoria por DNI, así que un chofer
 * tiene en su teléfono los datos comerciales de todos los clientes.
 *
 * -----------------------------------------------------------------------------
 * BUSCA POR DNI
 * -----------------------------------------------------------------------------
 * Es lo que hace la app y lo que las reglas verifican. Por eso el DNI es
 * inmutable: cambiarlo dejaría al chofer sin ver sus propios viajes.
 *
 * -----------------------------------------------------------------------------
 * EL GPS
 * -----------------------------------------------------------------------------
 * Cada 60 segundos mientras hay un viaje en curso, igual que hoy. Lo que cambia
 * es dónde se guarda: antes era un campo del pedido que se reescribía entero;
 * ahora cada punto es un documento en la subcolección del viaje, con su
 * timestamp como clave.
 *
 * El navegador no puede seguir tomando ubicación con la pestaña cerrada. Para
 * eso está la app, que corre un servicio en segundo plano. Acá el GPS funciona
 * mientras la pantalla esté abierta, y eso está dicho al chofer en pantalla en
 * vez de dejarlo suponer.
 * ========================================================================== */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { collection, onSnapshot, query, where, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { miDni, motivoSinAcceso } from '../sesion';
import { VIAJE, ETIQUETA_VIAJE } from '../estados';
import {
  iniciarViaje, reportarDemora, finalizarViaje,
  registrarPuntos, saludGPS, ETIQUETA_GPS, COLOR_GPS,
} from '../logica-viajes';

/** Cada cuánto se toma una posición, en milisegundos. */
const INTERVALO_GPS = 60000;

export default function MisViajes({ usuario, onVolver }) {
  const [viajes, setViajes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const [modalDemora, setModalDemora] = useState(null);
  const [motivoDemora, setMotivoDemora] = useState('');
  const [gpsActivo, setGpsActivo] = useState(false);
  const [ultimoPunto, setUltimoPunto] = useState(null);
  const [avisos, setAvisos] = useState([]);

  const intervalo = useRef(null);
  const dni = miDni(usuario);
  const sinAcceso = motivoSinAcceso(usuario, ['chofer', 'admin']);

  /* ── Carga ──────────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (sinAcceso || !dni) { setCargando(false); return; }

    // Filtrada por DNI, siempre. Sin el `where`, las reglas rechazan la
    // consulta entera.
    const unsub = onSnapshot(
      query(collection(db, 'viajes'), where('chofer_dni', '==', dni)),
      (snap) => {
        setViajes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setCargando(false);
      },
      (err) => { console.error('Viajes:', err); setCargando(false); }
    );

    // Mismo criterio que en `viajes`: por DNI, y solo los no leídos —los
    // leídos ya cumplieron su función. `MisDespachos.js` hace lo mismo para
    // el transportista, con `destinatario_org_id` en vez de esta columna.
    const unsubAvisos = onSnapshot(
      query(collection(db, 'avisos'), where('destinatario_chofer_dni', '==', dni), where('leido', '==', false)),
      (snap) => setAvisos(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );

    return () => { unsub(); unsubAvisos(); };
  }, [sinAcceso, dni]);

  /* ── Los viajes que importan ────────────────────────────────────────────── */

  const activos = useMemo(
    () => viajes
      .filter(v => v.estado === VIAJE.RECIBIDO || v.estado === VIAJE.EN_VIAJE)
      .sort((a, b) => (a.fecha_carga || '').localeCompare(b.fecha_carga || '')),
    [viajes]
  );

  const cerrados = useMemo(
    () => viajes
      .filter(v => v.estado === VIAJE.FINALIZADO || v.estado === VIAJE.CANCELADO)
      .sort((a, b) => (b.fecha_carga || '').localeCompare(a.fecha_carga || ''))
      .slice(0, 10),
    [viajes]
  );

  const enCurso = useMemo(
    () => activos.find(v => v.estado === VIAJE.EN_VIAJE) || null,
    [activos]
  );

  /* ── GPS ────────────────────────────────────────────────────────────────── */

  /**
   * Toma una posición del navegador.
   *
   * `enableHighAccuracy` pide el GPS del dispositivo en vez de la ubicación
   * aproximada por wifi o antenas. Consume más batería, pero en una ruta es la
   * diferencia entre saber dónde está el camión y saber en qué provincia.
   */
  function tomarPosicion() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) { resolve(null); return; }

      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          precision: pos.coords.accuracy,
          velocidad: pos.coords.speed,
          origen: 'actual',
          ts: Date.now(),
        }),
        (err) => {
          console.warn('GPS:', err.code, err.message);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
      );
    });
  }

  // Mientras haya un viaje en curso, se toma y se manda una posición cada
  // minuto. Al cerrar el viaje o salir de la pantalla, se corta.
  useEffect(() => {
    if (!enCurso) {
      setGpsActivo(false);
      if (intervalo.current) { clearInterval(intervalo.current); intervalo.current = null; }
      return;
    }

    let cancelado = false;

    async function enviar() {
      const p = await tomarPosicion();
      if (cancelado) return;

      if (!p) { setGpsActivo(false); return; }

      setGpsActivo(true);
      setUltimoPunto(p);

      try {
        await registrarPuntos(enCurso.id, [p]);
      } catch (err) {
        // Un punto que no se puede escribir no tiene que romper la pantalla:
        // el chofer está manejando y lo único que le importa es poder cerrar el
        // viaje cuando llegue.
        console.warn('No se pudo registrar el punto:', err.code || err.message);
      }
    }

    enviar();
    intervalo.current = setInterval(enviar, INTERVALO_GPS);

    return () => {
      cancelado = true;
      if (intervalo.current) { clearInterval(intervalo.current); intervalo.current = null; }
    };
  }, [enCurso]);

  /* ── Acciones ───────────────────────────────────────────────────────────── */

  /**
   * Marca un aviso como leído. Es lo único que las reglas dejan tocarle a un
   * chofer sobre su propio aviso.
   */
  async function marcarLeido(aviso) {
    try {
      await updateDoc(doc(db, 'avisos', aviso.id), { leido: true });
    } catch (err) {
      console.error(err);
      setError(traducirError(err));
    }
  }

  async function arrancar(viaje) {
    setOcupado(true);
    setError('');
    try {
      const posicion = await tomarPosicion();
      await iniciarViaje({ viaje, posicion, misViajes: viajes, usuario });
    } catch (err) {
      console.error(err);
      setError(traducirError(err));
    } finally {
      setOcupado(false);
    }
  }

  async function confirmarDemora() {
    if (!motivoDemora.trim()) return;

    setOcupado(true);
    setError('');
    try {
      await reportarDemora({ viaje: modalDemora, motivo: motivoDemora, usuario });
      setModalDemora(null);
      setMotivoDemora('');
    } catch (err) {
      console.error(err);
      setError(traducirError(err));
    } finally {
      setOcupado(false);
    }
  }

  /**
   * Cierra el viaje.
   *
   * `finalizarViaje` ya no recibe `entregas`, `despachos` ni un `pedido`
   * armado a mano: el chofer no puede leer esas colecciones, y ahora la
   * función tampoco los necesita. Toca su viaje, hace la transición puntual
   * del despacho (`NOMINADO → ENTREGADO`, autorizada en las reglas por DNI), y
   * suma uno al contador `entregas_cumplidas` del pedido con `increment()` —
   * sin leer nada de por medio.
   */
  async function cerrar(viaje) {
    if (!window.confirm('¿Cerrar el viaje?\n\nSe le avisa al coordinador que entregaste.')) return;

    setOcupado(true);
    setError('');
    try {
      const posicion = await tomarPosicion();

      await finalizarViaje({
        viaje,
        despacho: { id: viaje.despacho_id },
        posicion,
        cerradoPor: 'chofer',
        usuario,
      });
    } catch (err) {
      console.error(err);
      setError(traducirError(err));
    } finally {
      setOcupado(false);
    }
  }

  /* ── Render ─────────────────────────────────────────────────────────────── */

  if (sinAcceso) {
    return (
      <div style={styles.wrap}>
        <Topbar onVolver={onVolver} />
        <div style={styles.bannerError}>{sinAcceso}</div>
      </div>
    );
  }

  if (!dni) {
    return (
      <div style={styles.wrap}>
        <Topbar onVolver={onVolver} />
        <div style={styles.bannerError}>
          Tu usuario no tiene DNI cargado, y los viajes se buscan por DNI.
          Pedile a tu transportista que lo cargue.
        </div>
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
      <Topbar onVolver={onVolver} />

      <div style={styles.panelHeader}>
        <div>
          <div style={styles.titulo}>Mis viajes</div>
          <div style={styles.subtitulo}>{usuario.nombre}</div>
        </div>
      </div>

      {avisos.length > 0 && (
        <div style={styles.avisosWrap}>
          <div style={styles.avisosTitulo}>Avisos</div>
          {avisos.map((a, i) => (
            <div key={a.id} style={{ ...styles.avisoItem, marginTop: i === 0 ? 0 : 10 }}>
              <span style={styles.avisoMensaje}>{a.mensaje}</span>
              <button style={styles.btnMarcarLeido} onClick={() => marcarLeido(a)}>
                Marcar leído
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <div style={styles.bannerError}>{error}</div>}

      {/* Estado del GPS, solo con un viaje en curso */}
      {enCurso && (
        <div style={{ ...styles.gpsBarra, background: gpsActivo ? '#E1F5EE' : '#FEF3C7' }}>
          <span style={{ color: gpsActivo ? '#085041' : '#92400E' }}>
            {gpsActivo
              ? `Ubicación activa${ultimoPunto ? ` · ${hora(ultimoPunto.ts)}` : ''}`
              : 'Sin ubicación. Revisá que el navegador tenga permiso.'}
          </span>
          <span style={styles.gpsNota}>
            Mientras esta pantalla esté abierta
          </span>
        </div>
      )}

      {cargando && <div style={styles.empty}>Cargando...</div>}

      {!cargando && activos.length === 0 && (
        <div style={styles.empty}>
          No tenés viajes asignados.
          <div style={styles.emptyNota}>
            Cuando tu transportista te nomine en un despacho, va a aparecer acá.
          </div>
        </div>
      )}

      {activos.map(v => {
        const enViaje = v.estado === VIAJE.EN_VIAJE;
        const salud = saludGPS(v);

        return (
          <div key={v.id} style={{ ...styles.card, ...(enViaje ? styles.cardActivo : {}) }}>
            <div style={styles.cardHeader}>
              <span style={{ ...styles.pill, ...(enViaje ? PILLS.enViaje : PILLS.recibido) }}>
                {ETIQUETA_VIAJE[v.estado] || v.estado}
              </span>
              {v.demorado && <span style={{ ...styles.pill, ...PILLS.demorado }}>Demorado</span>}
              <span style={styles.fechaCarga}>carga {v.fecha_carga}</span>
            </div>

            <div style={styles.cardBody}>
              <div style={styles.destinoLabel}>Entregar en</div>
              <div style={styles.destino}>{v.destino_texto || '—'}</div>

              <div style={styles.datosGrid}>
                <Dato label="Cliente" valor={v.cliente_razon_social} />
                <Dato label="Producto" valor={v.producto_nombre} />
                <Dato label="Volumen" valor={v.volumen} />
                <Dato
                  label="Unidad"
                  valor={`${v.patente_tractor || '—'}${v.patente_semi ? ` + ${v.patente_semi}` : ''}`}
                />
              </div>

              {v.demorado && v.demora_motivo && (
                <div style={styles.demoraMotivo}>Demora: {v.demora_motivo}</div>
              )}

              {enViaje && salud !== 'no_corresponde' && salud !== 'activo' && (
                <div style={{ ...styles.saludGps, color: COLOR_GPS[salud] }}>
                  {ETIQUETA_GPS[salud]}
                </div>
              )}

              <div style={styles.acciones}>
                {v.estado === VIAJE.RECIBIDO && (
                  <button
                    style={{ ...styles.btnGrande, opacity: ocupado ? 0.6 : 1 }}
                    disabled={ocupado}
                    onClick={() => arrancar(v)}
                  >
                    {ocupado ? 'Iniciando...' : 'Iniciar viaje'}
                  </button>
                )}

                {enViaje && (
                  <>
                    <button
                      style={{ ...styles.btnGrande, opacity: ocupado ? 0.6 : 1 }}
                      disabled={ocupado}
                      onClick={() => cerrar(v)}
                    >
                      Finalizar viaje
                    </button>
                    {!v.demorado && (
                      <button
                        style={styles.btnDemora}
                        disabled={ocupado}
                        onClick={() => { setModalDemora(v); setMotivoDemora(''); }}
                      >
                        Reportar demora
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {cerrados.length > 0 && (
        <>
          <div style={styles.seccionTitulo}>Últimos viajes</div>
          {cerrados.map(v => (
            <div key={v.id} style={styles.cardCerrado}>
              <span style={styles.cerradoFecha}>{v.fecha_carga}</span>
              <span style={styles.cerradoDestino}>{v.destino_texto}</span>
              <span style={styles.cerradoEstado}>
                {ETIQUETA_VIAJE[v.estado] || v.estado}
                {v.cerrado_por === 'manual' && ' (cerrado por Explora)'}
              </span>
            </div>
          ))}
        </>
      )}

      {/* Modal de demora */}
      {modalDemora && (
        <div style={styles.fondoModal} onMouseDown={() => setModalDemora(null)}>
          <div style={styles.modal} onMouseDown={e => e.stopPropagation()}>
            <div style={styles.modalTitulo}>Reportar demora</div>
            <div style={styles.modalTexto}>
              Contá qué pasó. El coordinador lo va a ver enseguida.
            </div>
            <textarea
              style={styles.textarea}
              value={motivoDemora}
              onChange={e => setMotivoDemora(e.target.value)}
              placeholder="Corte de ruta, espera en planta, rotura..."
              autoFocus
            />
            <div style={styles.modalNota}>
              El viaje sigue en curso: esto es un aviso, no lo detiene.
            </div>
            <div style={styles.acciones}>
              <button
                style={{ ...styles.btnGrande, opacity: (ocupado || !motivoDemora.trim()) ? 0.5 : 1 }}
                disabled={ocupado || !motivoDemora.trim()}
                onClick={confirmarDemora}
              >
                {ocupado ? 'Enviando...' : 'Enviar'}
              </button>
              <button style={styles.btnSecundario} onClick={() => setModalDemora(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Auxiliares
 * -------------------------------------------------------------------------- */

function Topbar({ onVolver }) {
  return (
    <div style={styles.topbar}>
      <div style={styles.logoArea}>
        <img src="/logo.png" alt="Explora" style={styles.logoImg} />
      </div>
      <button style={styles.btnVolver} onClick={onVolver}>← Volver</button>
    </div>
  );
}

function Dato({ label, valor }) {
  return (
    <div style={styles.dato}>
      <span style={styles.datoLabel}>{label}</span>
      <span style={styles.datoValor}>{valor || '—'}</span>
    </div>
  );
}

function hora(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function traducirError(err) {
  if (err && err.code === 'permission-denied') {
    return 'No se pudo guardar. Puede que el viaje ya no sea tuyo o que lo hayan '
         + 'cancelado. Actualizá la página.';
  }
  return (err && err.message) || 'Error desconocido.';
}

/* -----------------------------------------------------------------------------
 * Estilos
 *
 * Más grandes que en el resto del portal: esta pantalla se usa en un celular,
 * probablemente con el camión en marcha.
 * -------------------------------------------------------------------------- */

const PILLS = {
  recibido: { background: '#EEEDFE', color: '#3C3489' },
  enViaje:  { background: '#E1F5EE', color: '#085041' },
  demorado: { background: '#FEF3C7', color: '#92400E' },
};

const styles = {
  wrap: { maxWidth: 640, margin: '0 auto', padding: '1.5rem 1rem' },
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '1rem', borderBottom: '0.5px solid #E5E7EB', marginBottom: '1.25rem' },
  logoArea: { display: 'flex', alignItems: 'center' },
  logoImg: { height: 36, objectFit: 'contain' },
  btnVolver: { padding: '8px 16px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 14, cursor: 'pointer' },
  panelHeader: { marginBottom: '1rem' },
  titulo: { fontSize: 20, fontWeight: 500, color: '#111827' },
  subtitulo: { fontSize: 14, color: '#6B7280', marginTop: 2 },
  gpsBarra: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 14px', borderRadius: 10, fontSize: 13, marginBottom: 12, flexWrap: 'wrap' },
  gpsNota: { fontSize: 11, color: '#9CA3AF' },
  empty: { textAlign: 'center', padding: '3rem 1rem', color: '#9CA3AF', fontSize: 15 },
  emptyNota: { fontSize: 13, marginTop: 8, lineHeight: 1.5 },
  card: { background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 14, overflow: 'hidden', marginBottom: 12 },
  cardActivo: { borderColor: '#5DCAA5', borderWidth: 1 },
  cardHeader: { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', background: '#F9FAFB', flexWrap: 'wrap' },
  cardBody: { padding: '14px 16px' },
  pill: { fontSize: 12, fontWeight: 500, padding: '4px 12px', borderRadius: 20 },
  fechaCarga: { fontSize: 13, color: '#6B7280', marginLeft: 'auto' },
  destinoLabel: { fontSize: 11, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em' },
  destino: { fontSize: 17, color: '#111827', lineHeight: 1.4, marginTop: 3, marginBottom: 14 },
  datosGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 12 },
  dato: { display: 'flex', flexDirection: 'column', gap: 2 },
  datoLabel: { fontSize: 11, color: '#9CA3AF' },
  datoValor: { fontSize: 14, color: '#111827' },
  demoraMotivo: { fontSize: 13, color: '#92400E', padding: '8px 12px', background: '#FEF3C7', borderRadius: 8, marginBottom: 12 },
  saludGps: { fontSize: 12, marginBottom: 10 },
  acciones: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  btnGrande: { flex: 1, minWidth: 140, padding: '14px 20px', borderRadius: 10, border: 'none', background: '#C8102E', color: '#fff', fontSize: 15, fontWeight: 500, cursor: 'pointer' },
  btnDemora: { flex: 1, minWidth: 140, padding: '14px 20px', borderRadius: 10, border: '0.5px solid #F59E0B', background: '#fff', color: '#92400E', fontSize: 15, cursor: 'pointer' },
  btnSecundario: { padding: '14px 20px', borderRadius: 10, border: '0.5px solid #E5E7EB', background: '#fff', color: '#374151', fontSize: 15, cursor: 'pointer' },
  seccionTitulo: { fontSize: 12, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 24, marginBottom: 10 },
  cardCerrado: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#F9FAFB', borderRadius: 10, marginBottom: 6, fontSize: 13, flexWrap: 'wrap' },
  cerradoFecha: { color: '#9CA3AF', fontFamily: 'monospace', flexShrink: 0 },
  cerradoDestino: { color: '#374151', flex: 1, minWidth: 120 },
  cerradoEstado: { color: '#9CA3AF', fontSize: 12, flexShrink: 0 },
  fondoModal: { position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 50 },
  modal: { background: '#fff', borderRadius: 14, padding: '1.5rem', width: '100%', maxWidth: 420 },
  modalTitulo: { fontSize: 17, fontWeight: 500, color: '#111827', marginBottom: 6 },
  modalTexto: { fontSize: 14, color: '#6B7280', marginBottom: 12, lineHeight: 1.5 },
  textarea: { width: '100%', minHeight: 90, padding: '10px 12px', borderRadius: 10, border: '0.5px solid #E5E7EB', fontSize: 15, color: '#111827', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' },
  modalNota: { fontSize: 12, color: '#9CA3AF', margin: '10px 0 14px', lineHeight: 1.5 },
  bannerError: { padding: '12px 16px', borderRadius: 10, background: '#FEF2F2', border: '0.5px solid #FCA5A5', fontSize: 14, color: '#B91C1C', marginBottom: 12, lineHeight: 1.5 },
  avisosWrap: { padding: '12px 16px', borderRadius: 10, background: '#FEF3C7', border: '0.5px solid #F59E0B', marginBottom: 12 },
  avisosTitulo: { fontSize: 12, fontWeight: 600, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 },
  avisoItem: { display: 'flex', flexDirection: 'column', gap: 8 },
  avisoMensaje: { fontSize: 14, color: '#92400E', lineHeight: 1.5 },
  btnMarcarLeido: { alignSelf: 'flex-start', padding: '8px 14px', borderRadius: 8, border: '0.5px solid #92400E', background: 'transparent', color: '#92400E', fontSize: 13, cursor: 'pointer' },
};
