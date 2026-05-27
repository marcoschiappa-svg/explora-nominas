import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzXOlu0PUTAVubDJCXh7WxjZp1ruCH5SMu9YmWbFCNF2ff7l5mn447nV8BIWbQ5-Mz-uQ/exec';

function Transportista({ usuario, onVolver }) {
  const [despachos, setDespachos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [expandido, setExpandido] = useState(null);
  const [nomData, setNomData] = useState({});
  const [enviando, setEnviando] = useState(false);
  const [filtro, setFiltro] = useState('todos');

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'pedidos_portal'), (snap) => {
      const todos = [];
      snap.docs.forEach(d => {
        const pedido = d.data();
        (pedido.despachos || []).forEach((despacho, i) => {
          if (despacho.estado === 'Programado' || despacho.estado === 'Aceptado' || despacho.estado === 'Nominado') {
            todos.push({
              docId: d.id,
              pedidoId: pedido.id,
              despachoIdx: i,
              uid: pedido.id + '-D' + (i + 1),
              despachoNro: i + 1,
              estado: despacho.estado,
              producto: pedido.producto,
              volumen: despacho.volumen,
              volumenTotal: pedido.volumen,
              cliente: pedido.cliente,
              ov: pedido.ov,
              fecha_carga: despacho.fecha_carga,
              fecha_entrega: pedido.fecha_entrega,
              lugar: pedido.lugar,
              recipiente: pedido.recipiente,
              obs: pedido.obs || '',
              tipo: pedido.tipo,
              transporte: despacho.transporte,
              programado_por: despacho.programado_por,
              programado_en: despacho.programado_en,
              patente_tractor: despacho.patente_tractor || '',
              patente_semi: despacho.patente_semi || '',
              chofer: despacho.chofer || '',
              cuit: despacho.cuit || '',
            });
          }
        });
      });
      todos.sort((a, b) => new Date(a.fecha_carga) - new Date(b.fecha_carga));
      setDespachos(todos);
      setCargando(false);
    });
    return () => unsub();
  }, []);

  const pillColors = {
    'Programado': { bg: '#FAEEDA', color: '#633806' },
    'Aceptado':   { bg: '#E1F5EE', color: '#085041' },
    'Nominado':   { bg: '#EEEDFE', color: '#3C3489' },
  };

  const pillLabel = {
    'Programado': 'Asignado',
    'Aceptado':   'Aceptado',
    'Nominado':   'Nominado',
  };

  async function aceptar(d) {
    const pedidoSnap = await import('firebase/firestore').then(({ getDoc }) =>
      getDoc(doc(db, 'pedidos_portal', d.docId))
    );
    const pedido = pedidoSnap.data();
    const nuevosDespachos = [...pedido.despachos];
    nuevosDespachos[d.despachoIdx] = { ...nuevosDespachos[d.despachoIdx], estado: 'Aceptado' };
    await updateDoc(doc(db, 'pedidos_portal', d.docId), { despachos: nuevosDespachos });
    alert('✓ Despacho aceptado. Completá los datos de la unidad para nominar.');
  }

  async function rechazar(d) {
    const motivo = prompt('Motivo del rechazo (requerido):');
    if (!motivo) return;
    const pedidoSnap = await import('firebase/firestore').then(({ getDoc }) =>
      getDoc(doc(db, 'pedidos_portal', d.docId))
    );
    const pedido = pedidoSnap.data();
    const nuevosDespachos = [...pedido.despachos];
    nuevosDespachos[d.despachoIdx] = { ...nuevosDespachos[d.despachoIdx], estado: 'Rechazado' };
    await updateDoc(doc(db, 'pedidos_portal', d.docId), {
      despachos: nuevosDespachos,
      estado: 'Pendiente',
    });
    alert('Despacho rechazado. Se notificó al coordinador.');
  }

  async function nominar(d) {
    const nd = nomData[d.uid] || {};
    if (!nd.patente_tractor || !nd.chofer || !nd.cuit) {
      alert('Completá patente tractor, chofer y CUIT antes de nominar.');
      return;
    }

    setEnviando(true);
    try {
      // 1 — Actualizar Firestore
      const { getDoc } = await import('firebase/firestore');
      const pedidoSnap = await getDoc(doc(db, 'pedidos_portal', d.docId));
      const pedido = pedidoSnap.data();
      const nuevosDespachos = [...pedido.despachos];
      nuevosDespachos[d.despachoIdx] = {
        ...nuevosDespachos[d.despachoIdx],
        estado: 'Nominado',
        patente_tractor: nd.patente_tractor,
        patente_semi: nd.patente_semi || '',
        chofer: nd.chofer,
        cuit: nd.cuit,
      };
      await updateDoc(doc(db, 'pedidos_portal', d.docId), {
        despachos: nuevosDespachos,
        estado: 'Nominado',
      });

      // 2 — Llamar Apps Script para escribir en Mov Vehículos Carga y Desc
      const payload = {
        accion: 'nominar_unidad',
        pedido_id: d.pedidoId,
        fecha_carga: d.fecha_carga,
        tipo: d.tipo,
        producto: d.producto,
        volumen: d.volumen,
        cliente: d.cliente,
        ov: d.ov,
        lugar: d.lugar,
        patente_tractor: nd.patente_tractor,
        patente_semi: nd.patente_semi || '',
        chofer: nd.chofer,
        cuit_transporte: nd.cuit,
        transporte: d.transporte,
      };

      const params = new URLSearchParams({ payload: JSON.stringify(payload) });
      await fetch(APPS_SCRIPT_URL + '?' + params.toString(), { mode: 'no-cors' });

      alert('✓ Nominación confirmada. Se escribió en Mov Vehículos Carga y Desc y se notificó a Portería.');
    } catch (err) {
      console.error(err);
      alert('Error al nominar: ' + err.message);
    } finally {
      setEnviando(false);
    }
  }

  const filtrados = despachos.filter(d =>
    filtro === 'todos' ||
    (filtro === 'Programado' && d.estado === 'Programado') ||
    (filtro === 'Aceptado' && d.estado === 'Aceptado') ||
    (filtro === 'Nominado' && d.estado === 'Nominado')
  );

  return (
    <div style={styles.wrap}>
      <div style={styles.topbar}>
        <div style={styles.logoArea}>
         <img src="/logo.png" alt="Explora" style={{ height: 32, objectFit: 'contain' }} />
          <span style={styles.portalText}>Mis despachos</span>
        </div>
        <button style={styles.btnVolver} onClick={onVolver}>← Inicio</button>
      </div>

      <div style={styles.intro}>
        ℹ️ Solo ves los despachos asignados a tu empresa. Aceptá cada despacho y completá los datos de la unidad.
      </div>

      <div style={styles.metrics}>
        <div style={styles.metric}>
          <div style={styles.metricLabel}>Asignados</div>
          <div style={{ ...styles.metricValue, color: '#BA7517' }}>
            {despachos.filter(d => d.estado === 'Programado').length}
          </div>
        </div>
        <div style={styles.metric}>
          <div style={styles.metricLabel}>Aceptados</div>
          <div style={{ ...styles.metricValue, color: '#0F6E56' }}>
            {despachos.filter(d => d.estado === 'Aceptado').length}
          </div>
        </div>
        <div style={styles.metric}>
          <div style={styles.metricLabel}>Nominados</div>
          <div style={{ ...styles.metricValue, color: '#534AB7' }}>
            {despachos.filter(d => d.estado === 'Nominado').length}
          </div>
        </div>
      </div>

      <div style={styles.filtros}>
        {['todos', 'Programado', 'Aceptado', 'Nominado'].map(f => (
          <button key={f}
            style={{ ...styles.filtroBtnBase, ...(filtro === f ? styles.filtroBtnActive : {}) }}
            onClick={() => setFiltro(f)}>
            {f === 'todos' ? 'Todos' : pillLabel[f] || f}
          </button>
        ))}
      </div>

      {cargando && <div style={styles.empty}>Cargando despachos...</div>}
      {!cargando && filtrados.length === 0 && <div style={styles.empty}>Sin despachos para mostrar.</div>}

      {!cargando && filtrados.map(d => (
        <div key={d.uid} style={styles.card}>
          <div style={styles.cardHeader} onClick={() => setExpandido(expandido === d.uid ? null : d.uid)}>
            <span style={{ ...styles.pill, background: pillColors[d.estado]?.bg, color: pillColors[d.estado]?.color }}>
              {pillLabel[d.estado]}
            </span>
            <span style={styles.cardNro}>{d.pedidoId} · D{d.despachoNro}</span>
            <span style={styles.cardResumen}>{d.producto} {d.volumen} tn · {d.cliente}</span>
            <div style={styles.cardMeta}>
              <span style={styles.cardFechaLabel}>Carga</span>
              <span style={styles.cardFechaVal}>{d.fecha_carga}</span>
            </div>
            <span style={styles.chevron}>{expandido === d.uid ? '▲' : '▼'}</span>
          </div>

          {expandido === d.uid && (
            <div style={styles.cardBody}>
              <div style={styles.origen}>
                Programado por <strong>{d.programado_por}</strong> · {d.programado_en}
              </div>

              {d.volumenTotal > d.volumen && (
                <div style={styles.contextBanner}>
                  Este despacho es parte de un pedido de <strong>{d.volumenTotal} tn</strong> — tu asignación es <strong>{d.volumen} tn</strong>.
                </div>
              )}

              <div style={styles.detailGrid}>
                <div style={styles.field}><span style={styles.label}>Producto</span><span style={styles.hiVal}>{d.producto}</span></div>
                <div style={styles.field}><span style={styles.label}>Volumen</span><span style={styles.hiVal}>{d.volumen} tn</span></div>
                <div style={styles.field}><span style={styles.label}>Recipiente</span><span>{d.recipiente}</span></div>
                <div style={styles.field}><span style={styles.label}>OV / OC</span><span>{d.ov}</span></div>
                <div style={styles.field}><span style={styles.label}>Fecha de carga</span><span style={styles.hiVal}>{d.fecha_carga}</span></div>
                <div style={styles.field}><span style={styles.label}>Entrega comprometida</span><span>{d.fecha_entrega}</span></div>
                <div style={{ ...styles.field, gridColumn: '1/-1' }}><span style={styles.label}>Lugar</span><span>{d.lugar}</span></div>
                {d.obs && <div style={{ ...styles.field, gridColumn: '1/-1' }}><span style={styles.label}>Observaciones</span><span>{d.obs}</span></div>}
              </div>

              {d.estado !== 'Programado' && (
                <div style={styles.nomSection}>
                  <div style={styles.nomTitle}>🚛 Datos de la unidad</div>
                  <div style={styles.nomGrid}>
                    <div style={styles.formField}>
                      <label style={styles.formLabel}>Patente tractor *</label>
                      <input style={styles.input} type="text" placeholder="Ej: ABC 123"
                        defaultValue={d.patente_tractor}
                        disabled={d.estado === 'Nominado'}
                        onChange={e => setNomData({ ...nomData, [d.uid]: { ...nomData[d.uid], patente_tractor: e.target.value } })} />
                    </div>
                    <div style={styles.formField}>
                      <label style={styles.formLabel}>Patente semi</label>
                      <input style={styles.input} type="text" placeholder="Ej: XYZ 456"
                        defaultValue={d.patente_semi}
                        disabled={d.estado === 'Nominado'}
                        onChange={e => setNomData({ ...nomData, [d.uid]: { ...nomData[d.uid], patente_semi: e.target.value } })} />
                    </div>
                    <div style={styles.formField}>
                      <label style={styles.formLabel}>Nombre del chofer *</label>
                      <input style={styles.input} type="text" placeholder="Nombre completo"
                        defaultValue={d.chofer}
                        disabled={d.estado === 'Nominado'}
                        onChange={e => setNomData({ ...nomData, [d.uid]: { ...nomData[d.uid], chofer: e.target.value } })} />
                    </div>
                    <div style={styles.formField}>
                      <label style={styles.formLabel}>CUIT transportista *</label>
                      <input style={styles.input} type="text" placeholder="20-00000000-0"
                        defaultValue={d.cuit}
                        disabled={d.estado === 'Nominado'}
                        onChange={e => setNomData({ ...nomData, [d.uid]: { ...nomData[d.uid], cuit: e.target.value } })} />
                    </div>
                  </div>
                  {d.estado === 'Nominado' && (
                    <div style={styles.nomOk}>✓ Nominación confirmada. Portería fue notificada.</div>
                  )}
                </div>
              )}

              <div style={styles.cardActions}>
                {d.estado === 'Programado' && (
                  <>
                    <button style={styles.btnAceptar} onClick={() => aceptar(d)}>✓ Aceptar despacho</button>
                    <button style={styles.btnRechazar} onClick={() => rechazar(d)}>✕ Rechazar</button>
                  </>
                )}
                {d.estado === 'Aceptado' && (
                  <button style={{ ...styles.btnNominar, opacity: enviando ? 0.7 : 1 }}
                    disabled={enviando}
                    onClick={() => nominar(d)}>
                    {enviando ? 'Enviando...' : '✓ Confirmar nominación'}
                  </button>
                )}
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
  logoCircle: { width: 32, height: 32, borderRadius: '50%', background: '#D63B1F', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 800 },
  logoText: { fontSize: 15, fontWeight: 500, color: '#111827' },
  portalText: { fontSize: 13, color: '#9CA3AF', marginLeft: 4 },
  btnVolver: { padding: '6px 14px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 13, cursor: 'pointer' },
  intro: { padding: '10px 14px', borderRadius: 8, background: '#F9FAFB', border: '0.5px solid #E5E7EB', fontSize: 13, color: '#6B7280', marginBottom: '1.5rem' },
  metrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, marginBottom: '1.5rem' },
  metric: { background: '#F9FAFB', borderRadius: 8, padding: '12px 14px' },
  metricLabel: { fontSize: 11, color: '#9CA3AF', marginBottom: 4 },
  metricValue: { fontSize: 20, fontWeight: 500 },
  filtros: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: '1rem' },
  filtroBtnBase: { padding: '6px 14px', borderRadius: 20, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 12, cursor: 'pointer' },
  filtroBtnActive: { background: '#EEEDFE', borderColor: '#534AB7', color: '#3C3489', fontWeight: 500 },
  empty: { textAlign: 'center', padding: '2rem', color: '#9CA3AF', fontSize: 13 },
  card: { background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 12, overflow: 'hidden', marginBottom: 10 },
  cardHeader: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', cursor: 'pointer', flexWrap: 'wrap', background: '#F9FAFB' },
  pill: { fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 20, flexShrink: 0 },
  cardNro: { fontSize: 13, fontWeight: 500, color: '#111827', flexShrink: 0 },
  cardResumen: { fontSize: 12, color: '#6B7280', flex: 1 },
  cardMeta: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 },
  cardFechaLabel: { fontSize: 10, color: '#9CA3AF' },
  cardFechaVal: { fontSize: 11, color: '#6B7280' },
  chevron: { fontSize: 10, color: '#9CA3AF', flexShrink: 0 },
  cardBody: { padding: '12px 14px' },
  origen: { fontSize: 12, color: '#6B7280', padding: '8px 10px', background: '#F9FAFB', borderRadius: 8, marginBottom: 10 },
  contextBanner: { fontSize: 12, color: '#633806', padding: '8px 10px', background: '#FAEEDA', border: '0.5px solid #EF9F27', borderRadius: 8, marginBottom: 10 },
  detailGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginBottom: 10 },
  field: { display: 'flex', flexDirection: 'column', gap: 3 },
  label: { fontSize: 11, color: '#9CA3AF' },
  hiVal: { fontSize: 14, fontWeight: 500, color: '#3C3489' },
  nomSection: { marginTop: 12, paddingTop: 12, borderTop: '0.5px solid #E5E7EB' },
  nomTitle: { fontSize: 11, fontWeight: 500, color: '#534AB7', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 },
  nomGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 },
  formField: { display: 'flex', flexDirection: 'column', gap: 4 },
  formLabel: { fontSize: 12, color: '#6B7280' },
  input: { fontSize: 13, padding: '7px 9px', borderRadius: 8, border: '0.5px solid #E5E7EB', color: '#111827', width: '100%' },
  nomOk: { marginTop: 10, padding: '8px 12px', borderRadius: 8, background: '#E1F5EE', border: '0.5px solid #5DCAA5', fontSize: 12, color: '#085041' },
  cardActions: { display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  btnAceptar: { padding: '8px 16px', borderRadius: 8, border: 'none', background: '#0F6E56', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  btnNominar: { padding: '8px 16px', borderRadius: 8, border: 'none', background: '#534AB7', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  btnRechazar: { padding: '8px 16px', borderRadius: 8, border: '0.5px solid #A32D2D', background: '#fff', color: '#A32D2D', fontSize: 13, cursor: 'pointer' },
};

export default Transportista;