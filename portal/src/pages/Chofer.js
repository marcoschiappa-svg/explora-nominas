import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, doc, getDoc, updateDoc } from 'firebase/firestore';

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzXOlu0PUTAVubDJCXh7WxjZp1ruCH5SMu9YmWbFCNF2ff7l5mn447nV8BIWbQ5-Mz-uQ/exec';

const HEADER_COLORS = {
  libre:     { from: '#1a1a2e', to: '#0f3460', badge: null },
  recibido:  { from: '#0C447C', to: '#185FA5', badge: '#378ADD' },
  iniciado:  { from: '#085041', to: '#0F6E56', badge: '#1D9E75' },
  demorado:  { from: '#633806', to: '#BA7517', badge: '#EF9F27' },
  finalizado:{ from: '#085041', to: '#0F6E56', badge: '#1D9E75' },
};

const ESTADO_LABEL = {
  recibido:  'Viaje recibido',
  iniciado:  'En ruta',
  demorado:  'Demorado',
  finalizado: 'Finalizado',
};

function Chofer({ usuario, onVolver }) {
  const [viajes, setViajes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [procesando, setProcesando] = useState(false);
  const [modalDemora, setModalDemora] = useState(null);
  const [motivoDemora, setMotivoDemora] = useState('');
  const [modalFinalizar, setModalFinalizar] = useState(null);

  const dniUsuario = usuario?.dni || '';

  useEffect(() => {
    if (!dniUsuario) { setCargando(false); return; }
    const unsub = onSnapshot(collection(db, 'pedidos_portal'), (snap) => {
      const encontrados = [];
      snap.docs.forEach(d => {
        const pedido = d.data();
        (pedido.despachos || []).forEach((despacho, i) => {
          if (despacho.dni_chofer !== dniUsuario) return;
          const estadoChofer = despacho.estado_chofer || '';
          if (!['recibido', 'iniciado', 'demorado'].includes(estadoChofer)) return;
          encontrados.push({
            docId: d.id,
            pedidoId: pedido.id,
            despachoIdx: i,
            uid: pedido.id + '-D' + (i + 1),
            estado_chofer: estadoChofer,
            estado_chofer_ts: despacho.estado_chofer_ts || '',
            demora_motivo: despacho.demora_motivo || '',
            producto: pedido.producto,
            volumen: despacho.volumen,
            cliente: pedido.cliente,
            ov: pedido.ov,
            lugar: pedido.lugar,
            fecha_carga: despacho.fecha_carga,
            horario_carga: despacho.horario_carga || '',
            fecha_entrega: pedido.fecha_entrega,
            banda_horaria: pedido.banda_horaria || '',
            obs: pedido.obs || '',
            transporte: despacho.transporte,
            patente_tractor: despacho.patente_tractor || '',
            patente_semi: despacho.patente_semi || '',
          });
        });
      });
      encontrados.sort((a, b) => new Date(a.fecha_carga) - new Date(b.fecha_carga));
      setViajes(encontrados);
      setCargando(false);
    });
    return () => unsub();
  }, [dniUsuario]);

  async function cambiarEstado(viaje, nuevoEstado, extras = {}) {
    setProcesando(true);
    try {
      const snap = await getDoc(doc(db, 'pedidos_portal', viaje.docId));
      const pedido = snap.data();
      const nuevosDespachos = [...pedido.despachos];
      nuevosDespachos[viaje.despachoIdx] = {
        ...nuevosDespachos[viaje.despachoIdx],
        estado_chofer: nuevoEstado,
        estado_chofer_ts: new Date().toISOString(),
        ...extras,
      };
      await updateDoc(doc(db, 'pedidos_portal', viaje.docId), { despachos: nuevosDespachos });
      if (nuevoEstado === 'demorado' || nuevoEstado === 'finalizado') {
        const payload = {
          accion: nuevoEstado === 'demorado' ? 'chofer_demora' : 'chofer_finalizo',
          pedido_id: viaje.pedidoId,
          chofer: usuario?.nombre || dniUsuario,
          producto: viaje.producto,
          cliente: viaje.cliente,
          ov: viaje.ov,
          lugar: viaje.lugar,
          motivo: extras.demora_motivo || '',
        };
        await fetch(APPS_SCRIPT_URL + '?' + new URLSearchParams({ payload: JSON.stringify(payload) }).toString(), { mode: 'no-cors' });
      }
    } catch (err) {
      console.error(err);
      alert('Error al actualizar estado: ' + err.message);
    } finally {
      setProcesando(false);
    }
  }

  async function confirmarDemora() {
    if (!motivoDemora.trim()) { alert('Describí el problema antes de continuar.'); return; }
    await cambiarEstado(modalDemora, 'demorado', { demora_motivo: motivoDemora.trim() });
    setModalDemora(null);
    setMotivoDemora('');
  }

  async function confirmarFinalizar() {
    await cambiarEstado(modalFinalizar, 'finalizado', { chofer_fin_ts: new Date().toISOString() });
    setModalFinalizar(null);
  }

  function formatFecha(str) {
    if (!str) return '—';
    const [y, m, d] = str.split('-');
    return d ? `${d}/${m}` : str;
  }

  function tiempoDesde(isoStr) {
    if (!isoStr) return '';
    const diff = Date.now() - new Date(isoStr).getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (h > 0) return `hace ${h} h ${m} min`;
    return `hace ${m} min`;
  }

  const nombreCorto = usuario?.nombre?.split(' ')[0] || 'Chofer';
  const viajeActivo = viajes[0] || null;
  const estadoActual = viajeActivo?.estado_chofer || 'libre';
  const hc = HEADER_COLORS[estadoActual] || HEADER_COLORS.libre;

  return (
    <div style={s.wrap}>

      {/* Modal demora */}
      {modalDemora && (
        <div style={s.overlayWrap}>
          <div style={s.modal}>
            <div style={s.modalIco}>⚠️</div>
            <div style={s.modalTit}>Reportar demora</div>
            <div style={s.modalSub}>{modalDemora.producto} · {modalDemora.cliente}</div>
            <textarea
              style={s.textarea}
              placeholder="Describí el problema (tráfico, desperfecto, clima, etc.)"
              value={motivoDemora}
              onChange={e => setMotivoDemora(e.target.value)}
              rows={3}
            />
            <div style={s.modalActions}>
              <button style={s.btnRojo} onClick={confirmarDemora} disabled={procesando}>
                {procesando ? 'Enviando...' : 'Reportar demora'}
              </button>
              <button style={s.btnGris} onClick={() => { setModalDemora(null); setMotivoDemora(''); }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal finalizar */}
      {modalFinalizar && (
        <div style={s.overlayWrap}>
          <div style={s.modal}>
            <div style={s.modalIco}>✅</div>
            <div style={s.modalTit}>Confirmar entrega</div>
            <div style={s.modalSub}>
              {modalFinalizar.producto} · {modalFinalizar.cliente}<br />
              {modalFinalizar.lugar}
            </div>
            <div style={{ fontSize: 13, color: '#6B7280', margin: '12px 0', lineHeight: 1.5 }}>
              Al confirmar, el coordinador recibirá la notificación y quedás libre para un nuevo viaje.
            </div>
            <div style={s.modalActions}>
              <button style={s.btnVerde} onClick={confirmarFinalizar} disabled={procesando}>
                {procesando ? 'Confirmando...' : '✓ Confirmar entrega'}
              </button>
              <button style={s.btnGris} onClick={() => setModalFinalizar(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header degradé */}
      <div style={{
        ...s.header,
        background: `linear-gradient(135deg, ${hc.from} 0%, ${hc.to} 100%)`,
      }}>
        <div style={s.headerTop}>
          <img src="/logo.png" alt="Explora" style={s.logoHeader} />
          <button style={s.btnVolverHeader} onClick={onVolver}>← Inicio</button>
        </div>

        {cargando ? (
          <div style={s.headerContent}>
            <div style={s.headerSub}>Cargando...</div>
          </div>
        ) : viajeActivo ? (
          <div style={s.headerContent}>
            <div style={s.headerSub}>{ESTADO_LABEL[estadoActual]}</div>
            <div style={s.headerTitulo}>{viajeActivo.producto} · {viajeActivo.cliente}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <span style={{ ...s.badge, background: 'rgba(255,255,255,0.18)' }}>{viajeActivo.volumen} tn</span>
              <span style={{ ...s.badge, background: hc.badge || 'rgba(255,255,255,0.18)' }}>OV {viajeActivo.ov}</span>
              {viajeActivo.estado_chofer_ts && (
                <span style={{ ...s.badge, background: 'rgba(255,255,255,0.12)' }}>{tiempoDesde(viajeActivo.estado_chofer_ts)}</span>
              )}
            </div>
          </div>
        ) : (
          <div style={s.headerContent}>
            <div style={s.headerSub}>Sin viajes activos</div>
            <div style={s.headerTitulo}>Hola, {nombreCorto}</div>
            <div style={{ marginTop: 8 }}>
              <span style={{ ...s.badge, background: 'rgba(255,255,255,0.2)' }}>🟢 Libre</span>
            </div>
          </div>
        )}

        {/* Curva inferior */}
        <div style={s.headerCurve} />
      </div>

      {/* Cuerpo */}
      <div style={s.body}>

        {!cargando && !dniUsuario && (
          <div style={s.alerta}>
            ⚠️ Tu perfil no tiene DNI registrado. Contactá al administrador.
          </div>
        )}

        {/* Estado LIBRE */}
        {!cargando && dniUsuario && viajes.length === 0 && (
          <div style={s.libreWrap}>
            <div style={s.libreIco}>🟢</div>
            <div style={s.libreTit}>Libre</div>
            <div style={s.libreSub}>Cuando el transportista te nomine, el viaje aparecerá acá automáticamente.</div>
          </div>
        )}

        {/* Viajes activos */}
        {!cargando && viajes.map(v => (
          <div key={v.uid} style={s.card}>

            {/* Datos del viaje */}
            <div style={s.grid2}>
              <div style={s.field}>
                <span style={s.lbl}>Destino</span>
                <span style={s.val}>{v.lugar}</span>
              </div>
              <div style={s.field}>
                <span style={s.lbl}>Fecha carga</span>
                <span style={s.val}>{formatFecha(v.fecha_carga)}{v.horario_carga ? ' · ' + v.horario_carga : ''}</span>
              </div>
              {v.fecha_entrega && (
                <div style={s.field}>
                  <span style={s.lbl}>Entrega</span>
                  <span style={s.val}>{formatFecha(v.fecha_entrega)}{v.banda_horaria ? ' · ' + v.banda_horaria : ''}</span>
                </div>
              )}
              <div style={s.field}>
                <span style={s.lbl}>Unidad</span>
                <span style={s.val}>{v.patente_tractor}{v.patente_semi ? ' / ' + v.patente_semi : ''}</span>
              </div>
              <div style={s.field}>
                <span style={s.lbl}>Transporte</span>
                <span style={s.val}>{v.transporte}</span>
              </div>
            </div>

            {v.obs && <div style={s.obsBanner}>📋 {v.obs}</div>}
            {v.estado_chofer === 'demorado' && v.demora_motivo && (
              <div style={s.demoraBanner}>⚠️ {v.demora_motivo}</div>
            )}

            {/* Acciones */}
            <div style={s.actions}>
              {v.estado_chofer === 'recibido' && (
                <button
                  style={{ ...s.btnPrimario, background: '#0F6E56', opacity: procesando ? 0.7 : 1 }}
                  disabled={procesando}
                  onClick={() => cambiarEstado(v, 'iniciado', { chofer_inicio_ts: new Date().toISOString() })}>
                  {procesando ? 'Procesando...' : '🚛 Iniciar viaje'}
                </button>
              )}
              {v.estado_chofer === 'iniciado' && (
                <>
                  <button
                    style={{ ...s.btnPrimario, background: '#0F6E56', opacity: procesando ? 0.7 : 1 }}
                    disabled={procesando}
                    onClick={() => setModalFinalizar(v)}>
                    ✓ Finalizar viaje
                  </button>
                  <button
                    style={{ ...s.btnSecundario, opacity: procesando ? 0.7 : 1 }}
                    disabled={procesando}
                    onClick={() => setModalDemora(v)}>
                    ⚠️ Reportar demora
                  </button>
                </>
              )}
              {v.estado_chofer === 'demorado' && (
                <>
                  <button
                    style={{ ...s.btnPrimario, background: '#0F6E56', opacity: procesando ? 0.7 : 1 }}
                    disabled={procesando}
                    onClick={() => setModalFinalizar(v)}>
                    ✓ Finalizar viaje
                  </button>
                  <button
                    style={{ ...s.btnSecundario, opacity: procesando ? 0.7 : 1 }}
                    disabled={procesando}
                    onClick={() => cambiarEstado(v, 'iniciado')}>
                    ▶ Continuar viaje
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const s = {
  wrap: { minHeight: '100vh', fontFamily: "'DM Sans', system-ui, sans-serif", background: '#F8F8F8' },
  header: { position: 'relative', paddingBottom: 28 },
  headerTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 0' },
  logoHeader: { height: 28, objectFit: 'contain', filter: 'brightness(0) invert(1)', opacity: 0.9 },
  btnVolverHeader: { padding: '5px 12px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 12, cursor: 'pointer' },
  headerContent: { padding: '16px 16px 0' },
  headerSub: { fontSize: 11, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 },
  headerTitulo: { fontSize: 20, fontWeight: 600, color: '#fff', letterSpacing: '-0.3px' },
  badge: { display: 'inline-block', fontSize: 11, fontWeight: 500, color: '#fff', padding: '3px 9px', borderRadius: 20 },
  headerCurve: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 28, background: '#F8F8F8', borderRadius: '14px 14px 0 0' },
  body: { padding: '4px 14px 24px' },
  alerta: { padding: '12px 14px', borderRadius: 10, background: '#FAEEDA', border: '0.5px solid #EF9F27', fontSize: 13, color: '#633806', marginBottom: 14 },
  libreWrap: { textAlign: 'center', padding: '3rem 1rem' },
  libreIco: { fontSize: 40, marginBottom: 12 },
  libreTit: { fontSize: 22, fontWeight: 600, color: '#111827', marginBottom: 8 },
  libreSub: { fontSize: 14, color: '#9CA3AF', lineHeight: 1.6, maxWidth: 280, margin: '0 auto' },
  card: { background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 14, padding: '14px', marginBottom: 12 },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px', marginBottom: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 2 },
  lbl: { fontSize: 11, color: '#9CA3AF' },
  val: { fontSize: 13, color: '#111827', fontWeight: 500 },
  obsBanner: { padding: '8px 10px', borderRadius: 8, background: '#F9FAFB', border: '0.5px solid #E5E7EB', fontSize: 12, color: '#6B7280', marginBottom: 10, lineHeight: 1.5 },
  demoraBanner: { padding: '8px 10px', borderRadius: 8, background: '#FAEEDA', border: '0.5px solid #EF9F27', fontSize: 12, color: '#633806', marginBottom: 10 },
  actions: { display: 'flex', flexDirection: 'column', gap: 8 },
  btnPrimario: { padding: '14px', borderRadius: 10, border: 'none', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' },
  btnSecundario: { padding: '12px', borderRadius: 10, border: '0.5px solid #E5E7EB', background: '#fff', color: '#374151', fontSize: 14, cursor: 'pointer' },
  btnVerde: { padding: '12px', borderRadius: 10, border: 'none', background: '#0F6E56', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  btnRojo: { padding: '12px', borderRadius: 10, border: 'none', background: '#C8102E', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  btnGris: { padding: '12px', borderRadius: 10, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 14, cursor: 'pointer' },
  overlayWrap: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' },
  modal: { background: '#fff', borderRadius: 16, padding: '1.75rem 1.5rem', maxWidth: 380, width: '100%', textAlign: 'center' },
  modalIco: { fontSize: 32, marginBottom: 10 },
  modalTit: { fontSize: 17, fontWeight: 600, color: '#111827', marginBottom: 4 },
  modalSub: { fontSize: 13, color: '#6B7280', marginBottom: 14, lineHeight: 1.5 },
  modalActions: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 },
  textarea: { width: '100%', boxSizing: 'border-box', fontSize: 14, padding: '10px 12px', borderRadius: 8, border: '1px solid #E5E7EB', resize: 'none', fontFamily: 'inherit', color: '#111827' },
};

export default Chofer;
