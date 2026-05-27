import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzXOlu0PUTAVubDJCXh7WxjZp1ruCH5SMu9YmWbFCNF2ff7l5mn447nV8BIWbQ5-Mz-uQ/exec';

function Coordinador({ usuario, onVolver }) {
  const [pedidos, setPedidos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState('todos');
  const [expandido, setExpandido] = useState(null);
  const [nuevoDespacho, setNuevoDespacho] = useState({});
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'pedidos_portal'), (snap) => {
      const data = snap.docs.map(d => ({
        docId: d.id,
        ...d.data(),
        despachos: d.data().despachos || [],
      }));
      data.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setPedidos(data);
      setCargando(false);
    });
    return () => unsub();
  }, []);

  const pillColors = {
    'Pendiente':    { bg: '#EEEDFE', color: '#3C3489' },
    'prog-parcial': { bg: '#FAEEDA', color: '#633806' },
    'Programado':   { bg: '#E1F5EE', color: '#085041' },
    'Nominado':     { bg: '#EEEDFE', color: '#3C3489' },
    'Suspendido':   { bg: '#FCEBEB', color: '#791F1F' },
  };

  const pillLabel = {
    'Pendiente':    'Pendiente',
    'prog-parcial': 'Prog. parcial',
    'Programado':   'Programado',
    'Nominado':     'Nominado',
    'Suspendido':   'Suspendido',
  };

  function volAsignado(p) {
    return (p.despachos || []).reduce((s, d) => s + Number(d.volumen), 0);
  }

  function saldo(p) {
    return Number(p.volumen) - volAsignado(p);
  }

  function pct(p) {
    return Math.min(100, Math.round(volAsignado(p) / Number(p.volumen) * 100));
  }

  async function confirmarDespacho(pedidoId) {
    const nd = nuevoDespacho[pedidoId] || {};
    if (!nd.volumen || !nd.fecha_carga || !nd.transporte) {
      alert('Completá volumen, fecha de carga y transportista.');
      return;
    }
    const p = pedidos.find(x => x.id === pedidoId);
    const sal = saldo(p);
    if (Number(nd.volumen) > sal) {
      alert(`El volumen (${nd.volumen} tn) supera el saldo disponible (${sal} tn).`);
      return;
      const fechaCarga = new Date(nd.fecha_carga + 'T00:00:00');
const fechaEntrega = new Date(p.fecha_entrega + 'T00:00:00');
if (fechaCarga > fechaEntrega) {
  alert('La fecha de carga no puede ser posterior a la fecha de entrega comprometida (' + p.fecha_entrega + ').');
  return;
    }

    const now = new Date().toLocaleString('es-AR');
    const despacho = {
      id: 'D' + ((p.despachos || []).length + 1),
      volumen: Number(nd.volumen),
      fecha_carga: nd.fecha_carga,
      transporte: nd.transporte,
      email_transportista: nd.email_transportista || '',
      estado: 'Programado',
      programado_por: usuario?.nombre || 'Coordinador',
      programado_en: now,
    };

    const nuevosDespachos = [...(p.despachos || []), despacho];
    const nuevoSaldo = Number(p.volumen) - nuevosDespachos.reduce((s, d) => s + Number(d.volumen), 0);
    const nuevoEstado = nuevoSaldo === 0 ? 'Programado' : 'prog-parcial';

    setEnviando(true);
    try {
      await updateDoc(doc(db, 'pedidos_portal', p.docId), {
        despachos: nuevosDespachos,
        estado: nuevoEstado,
      });

      const payload = {
        accion: 'programar_despacho',
        pedido_id: p.id,
        programado_por: usuario?.nombre || 'Coordinador',
        fecha_carga: nd.fecha_carga,
        transporte: nd.transporte,
        email_transportista: nd.email_transportista || '',
        tipo: p.tipo,
        producto: p.producto,
        volumen: Number(nd.volumen),
        cliente: p.cliente,
        ov: p.ov,
        lugar: p.lugar,
        fecha_entrega: p.fecha_entrega,
        obs: p.obs || '',
      };

      const params = new URLSearchParams({ payload: JSON.stringify(payload) });
      await fetch(APPS_SCRIPT_URL + '?' + params.toString(), { mode: 'no-cors' });

      setNuevoDespacho({ ...nuevoDespacho, [pedidoId]: {} });
      alert(`✓ Despacho confirmado. Se escribió en el Plan de Producción CI PGSM y se notificó al transportista.`);
    } catch (err) {
      console.error(err);
      alert('Error al confirmar el despacho: ' + err.message);
    } finally {
      setEnviando(false);
    }
  }

  async function suspender(p) {
    const motivo = prompt('Motivo de la suspensión (requerido):');
    if (!motivo) return;
    await updateDoc(doc(db, 'pedidos_portal', p.docId), { estado: 'Suspendido' });
  }

  const filtrados = pedidos.filter(p =>
    filtro === 'todos' || p.estado === filtro
  );

  return (
    <div style={styles.wrap}>
      <div style={styles.topbar}>
        <div style={styles.logoArea}>
          <img src="/logo.png" alt="Explora" style={{ height: 32, objectFit: 'contain' }} />
          <span style={styles.portalText}>Programación</span>
        </div>
        <button style={styles.btnVolver} onClick={onVolver}>← Inicio</button>
      </div>

      <div style={styles.metrics}>
        <div style={styles.metric}>
          <div style={styles.metricLabel}>Pendientes</div>
          <div style={{ ...styles.metricValue, color: '#534AB7' }}>
            {pedidos.filter(p => p.estado === 'Pendiente').length}
          </div>
        </div>
        <div style={styles.metric}>
          <div style={styles.metricLabel}>Prog. parcial</div>
          <div style={{ ...styles.metricValue, color: '#BA7517' }}>
            {pedidos.filter(p => p.estado === 'prog-parcial').length}
          </div>
        </div>
        <div style={styles.metric}>
          <div style={styles.metricLabel}>Programados</div>
          <div style={{ ...styles.metricValue, color: '#0F6E56' }}>
            {pedidos.filter(p => p.estado === 'Programado').length}
          </div>
        </div>
        <div style={styles.metric}>
          <div style={styles.metricLabel}>Suspendidos</div>
          <div style={{ ...styles.metricValue, color: '#A32D2D' }}>
            {pedidos.filter(p => p.estado === 'Suspendido').length}
          </div>
        </div>
      </div>

      <div style={styles.filtros}>
        {['todos', 'Pendiente', 'prog-parcial', 'Programado', 'Suspendido'].map(f => (
          <button key={f}
            style={{ ...styles.filtroBtnBase, ...(filtro === f ? styles.filtroBtnActive : {}) }}
            onClick={() => setFiltro(f)}>
            {f === 'todos' ? 'Todos' : pillLabel[f] || f}
          </button>
        ))}
      </div>

      {cargando && <div style={styles.empty}>Cargando pedidos...</div>}

      {!cargando && filtrados.length === 0 && (
        <div style={styles.empty}>Sin pedidos para mostrar.</div>
      )}

      {!cargando && filtrados.map(p => (
        <div key={p.id} style={styles.card}>
          <div style={styles.cardHeader} onClick={() => setExpandido(expandido === p.id ? null : p.id)}>
            <span style={{ ...styles.pill, background: pillColors[p.estado]?.bg, color: pillColors[p.estado]?.color }}>
              {pillLabel[p.estado] || p.estado}
            </span>
            <span style={styles.cardNro}>{p.id}</span>
            <span style={styles.cardResumen}>{p.cliente} · {p.producto} {p.volumen} tn</span>
            <span style={styles.cardFecha}>Creado {p.creado_en}</span>
            <span style={styles.chevron}>{expandido === p.id ? '▲' : '▼'}</span>
          </div>

          {expandido === p.id && (
            <div style={styles.cardBody}>
              <div style={styles.origen}>
                Pedido creado por <strong>{p.creado_por}</strong> · {p.creado_en}
              </div>

              <div style={styles.detailGrid}>
                <div style={styles.field}><span style={styles.label}>Tipo</span><span>{p.tipo}</span></div>
                <div style={styles.field}><span style={styles.label}>Producto</span><span>{p.producto}</span></div>
                <div style={styles.field}><span style={styles.label}>Volumen total</span><span>{p.volumen} tn</span></div>
                <div style={styles.field}><span style={styles.label}>Recipiente</span><span>{p.recipiente}</span></div>
                <div style={styles.field}><span style={styles.label}>Cliente / Proveedor</span><span>{p.cliente}</span></div>
                <div style={styles.field}><span style={styles.label}>OV / OC</span><span>{p.ov}</span></div>
                <div style={styles.field}><span style={styles.label}>Teléfono</span><span>{p.telefono || '—'}</span></div>
                <div style={styles.field}><span style={styles.label}>Entrega comprometida</span><span>{p.fecha_entrega}</span></div>
                <div style={{ ...styles.field, gridColumn: '1/-1' }}>
                  <span style={styles.label}>Lugar</span><span>{p.lugar}</span>
                </div>
                {p.obs && (
                  <div style={{ ...styles.field, gridColumn: '1/-1' }}>
                    <span style={styles.label}>Observaciones</span><span>{p.obs}</span>
                  </div>
                )}
              </div>

              <div style={styles.volBar}>
                <div style={styles.volBarLabels}>
                  <span>Asignado: <strong>{volAsignado(p)} tn</strong> de {p.volumen} tn</span>
                  <span>{pct(p)}%</span>
                </div>
                <div style={styles.barTrack}>
                  <div style={{ ...styles.barFill, width: `${pct(p)}%`, background: pct(p) < 100 ? '#EF9F27' : '#0F6E56' }} />
                </div>
                <div style={{ fontSize: 11, color: saldo(p) === 0 ? '#0F6E56' : '#BA7517', marginTop: 4 }}>
                  {saldo(p) === 0 ? '✓ Volumen completo' : `Saldo pendiente: ${saldo(p)} tn`}
                </div>
              </div>

              <div style={styles.despachosSection}>
                <div style={styles.despachosTitle}>Despachos</div>

                {(p.despachos || []).map((d, i) => (
                  <div key={i} style={styles.despachoItem}>
                    <div style={styles.despachoHeader}>
                      <span style={styles.despachoNro}>Despacho {i + 1}</span>
                      <span style={{ ...styles.pill, background: '#E1F5EE', color: '#085041', fontSize: 10 }}>Programado</span>
                      <span style={styles.despachoPor}>por {d.programado_por} · {d.programado_en}</span>
                    </div>
                    <div style={styles.despachoGrid}>
                      <div style={styles.field}><span style={styles.label}>Volumen</span><span>{d.volumen} tn</span></div>
                      <div style={styles.field}><span style={styles.label}>Fecha de carga</span><span>{d.fecha_carga}</span></div>
                      <div style={{ ...styles.field, gridColumn: '1/-1' }}><span style={styles.label}>Transportista</span><span>{d.transporte}</span></div>
                    </div>
                  </div>
                ))}

                {saldo(p) > 0 && p.estado !== 'Suspendido' && (
                  <div style={styles.nuevoDespacho}>
                    <div style={styles.despachosTitle}>Nuevo despacho</div>
                    <div style={styles.despachoGrid}>
                      <div style={styles.formField}>
                        <label style={styles.formLabel}>Volumen (tn) — saldo: {saldo(p)} tn</label>
                        <input style={styles.input} type="number" placeholder={saldo(p)}
                          value={nuevoDespacho[p.id]?.volumen || ''}
                          onChange={e => setNuevoDespacho({ ...nuevoDespacho, [p.id]: { ...nuevoDespacho[p.id], volumen: e.target.value } })} />
                      </div>
                      <div style={styles.formField}>
                        <label style={styles.formLabel}>Fecha de carga</label>
                        <input style={styles.input} type="date"
                          value={nuevoDespacho[p.id]?.fecha_carga || ''}
                          onChange={e => setNuevoDespacho({ ...nuevoDespacho, [p.id]: { ...nuevoDespacho[p.id], fecha_carga: e.target.value } })} />
                      </div>
                      <div style={{ ...styles.formField, gridColumn: '1/-1' }}>
                        <label style={styles.formLabel}>Empresa transportista</label>
                        <input style={styles.input} type="text" placeholder="Nombre del transportista"
                          value={nuevoDespacho[p.id]?.transporte || ''}
                          onChange={e => setNuevoDespacho({ ...nuevoDespacho, [p.id]: { ...nuevoDespacho[p.id], transporte: e.target.value } })} />
                      </div>
                      <div style={{ ...styles.formField, gridColumn: '1/-1' }}>
                        <label style={styles.formLabel}>Email del transportista</label>
                        <input style={styles.input} type="email" placeholder="transportista@empresa.com"
                          value={nuevoDespacho[p.id]?.email_transportista || ''}
                          onChange={e => setNuevoDespacho({ ...nuevoDespacho, [p.id]: { ...nuevoDespacho[p.id], email_transportista: e.target.value } })} />
                      </div>
                    </div>
                    <button style={{ ...styles.btnConfirmar, opacity: enviando ? 0.7 : 1 }}
                      disabled={enviando}
                      onClick={() => confirmarDespacho(p.id)}>
                      {enviando ? 'Enviando...' : '✓ Confirmar despacho'}
                    </button>
                  </div>
                )}
              </div>

              <div style={styles.cardActions}>
                <button style={styles.btnSuspender} onClick={() => suspender(p)}>Suspender</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const styles = {
  wrap: { maxWidth: 720, margin: '0 auto', padding: '1.5rem 1rem' },
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '1rem', borderBottom: '0.5px solid #E5E7EB', marginBottom: '1.5rem' },
  logoArea: { display: 'flex', alignItems: 'center', gap: 8 },
  portalText: { fontSize: 13, color: '#9CA3AF', marginLeft: 4 },
  btnVolver: { padding: '6px 14px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 13, cursor: 'pointer' },
  metrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, marginBottom: '1.5rem' },
  metric: { background: '#F9FAFB', borderRadius: 8, padding: '12px 14px' },
  metricLabel: { fontSize: 11, color: '#9CA3AF', marginBottom: 4 },
  metricValue: { fontSize: 20, fontWeight: 500 },
  filtros: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: '1rem' },
  filtroBtnBase: { padding: '6px 14px', borderRadius: 20, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 12, cursor: 'pointer' },
  filtroBtnActive: { background: '#EEEDFE', borderColor: '#C8102E', color: '#C8102E', fontWeight: 500 },
  empty: { textAlign: 'center', padding: '2rem', color: '#9CA3AF', fontSize: 13 },
  card: { background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 12, overflow: 'hidden', marginBottom: 10 },
  cardHeader: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', cursor: 'pointer', flexWrap: 'wrap', background: '#F9FAFB' },
  pill: { fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 20, flexShrink: 0 },
  cardNro: { fontSize: 13, fontWeight: 500, color: '#111827', flexShrink: 0 },
  cardResumen: { fontSize: 12, color: '#6B7280', flex: 1 },
  cardFecha: { fontSize: 11, color: '#9CA3AF' },
  chevron: { fontSize: 10, color: '#9CA3AF', flexShrink: 0 },
  cardBody: { padding: '12px 14px' },
  origen: { fontSize: 12, color: '#6B7280', padding: '8px 10px', background: '#F9FAFB', borderRadius: 8, marginBottom: 12 },
  detailGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginBottom: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 3 },
  label: { fontSize: 11, color: '#9CA3AF' },
  volBar: { padding: '10px 12px', borderRadius: 8, background: '#F9FAFB', border: '0.5px solid #E5E7EB', marginBottom: 12 },
  volBarLabels: { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6B7280', marginBottom: 6 },
  barTrack: { height: 8, borderRadius: 4, background: '#E5E7EB', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4, transition: 'width 0.3s' },
  despachosSection: { marginTop: 12, paddingTop: 12, borderTop: '0.5px solid #E5E7EB' },
  despachosTitle: { fontSize: 11, fontWeight: 500, color: '#0F6E56', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 },
  despachoItem: { border: '0.5px solid #E5E7EB', borderRadius: 8, padding: '10px 12px', marginBottom: 8, background: '#F9FAFB' },
  despachoHeader: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  despachoNro: { fontSize: 11, fontWeight: 500, color: '#6B7280' },
  despachoPor: { fontSize: 11, color: '#9CA3AF' },
  despachoGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 },
  nuevoDespacho: { border: '0.5px solid #E5E7EB', borderRadius: 8, padding: '10px 12px', marginBottom: 8, background: '#fff' },
  formField: { display: 'flex', flexDirection: 'column', gap: 4 },
  formLabel: { fontSize: 11, color: '#6B7280' },
  input: { fontSize: 13, padding: '7px 9px', borderRadius: 8, border: '0.5px solid #E5E7EB', color: '#111827', width: '100%' },
  btnConfirmar: { marginTop: 10, padding: '8px 16px', borderRadius: 8, border: 'none', background: '#C8102E', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  cardActions: { display: 'flex', gap: 8, marginTop: 12 },
  btnSuspender: { padding: '6px 14px', borderRadius: 8, border: '0.5px solid #A32D2D', background: '#fff', color: '#A32D2D', fontSize: 12, cursor: 'pointer' },
};

export default Coordinador;