import React, { useState } from 'react';

function Transportista({ usuario, onVolver }) {
  const [despachos, setDespachos] = useState([
    {
      uid: 'PED-260520-241-D1',
      pedidoId: 'PED-260520-241',
      despachoNro: 1,
      estado: 'asignado',
      producto: 'Biodiesel',
      volumen: 60,
      volumenTotal: 120,
      cliente: 'SINER',
      ov: 'OV 2630',
      fecha_carga: '2026-05-21',
      fecha_entrega: '2026-05-22',
      lugar: 'Ruta Nac. 9 km 1307,5 — Tucumán',
      recipiente: 'Granel',
      obs: 'Requiere escolta en el último tramo.',
      adjuntos: ['instrucciones_ingreso.pdf'],
      programado_por: 'Carlos López',
      programado_en: '20/05/2026 10:30',
      patente_tractor: '',
      patente_semi: '',
      chofer: '',
      cuit: '',
    },
    {
      uid: 'PED-260519-087-D1',
      pedidoId: 'PED-260519-087',
      despachoNro: 1,
      estado: 'aceptado',
      producto: 'EMAG',
      volumen: 60,
      volumenTotal: 90,
      cliente: 'FENDER',
      ov: 'OV 2623',
      fecha_carga: '2026-05-21',
      fecha_entrega: '2026-05-23',
      lugar: 'Gral. Rodríguez, Buenos Aires',
      recipiente: 'Granel',
      obs: '',
      adjuntos: [],
      programado_por: 'Carlos López',
      programado_en: '19/05/2026 14:00',
      patente_tractor: '',
      patente_semi: '',
      chofer: '',
      cuit: '',
    },
    {
      uid: 'PED-260518-334-D1',
      pedidoId: 'PED-260518-334',
      despachoNro: 1,
      estado: 'nominado',
      producto: 'Glicerina',
      volumen: 40,
      volumenTotal: 40,
      cliente: 'OLEOQUIM',
      ov: 'OC 1892',
      fecha_carga: '2026-05-20',
      fecha_entrega: '2026-05-24',
      lugar: 'Av. Industrial 1500, Rosario',
      recipiente: 'IBC',
      obs: '',
      adjuntos: ['remito_proveedor.pdf'],
      programado_por: 'Carlos López',
      programado_en: '19/05/2026 09:00',
      patente_tractor: 'ABC 123',
      patente_semi: 'XYZ 456',
      chofer: 'Roberto Díaz',
      cuit: '20-12345678-9',
    },
  ]);

  const [filtro, setFiltro] = useState('todos');
  const [expandido, setExpandido] = useState(null);
  const [nomData, setNomData] = useState({});

  const pillColors = {
    asignado: { bg: '#FAEEDA', color: '#633806' },
    aceptado: { bg: '#E1F5EE', color: '#085041' },
    nominado: { bg: '#EEEDFE', color: '#3C3489' },
  };

  const pillLabel = {
    asignado: 'Asignado',
    aceptado: 'Aceptado',
    nominado: 'Nominado',
  };

  function aceptar(uid) {
    setDespachos(despachos.map(d => d.uid === uid ? { ...d, estado: 'aceptado' } : d));
    alert('✓ Despacho aceptado. Completá los datos de la unidad para nominar.');
  }

  function rechazar(uid) {
    const motivo = prompt('Motivo del rechazo (requerido):');
    if (!motivo) return;
    setDespachos(despachos.filter(d => d.uid !== uid));
    alert('Despacho rechazado. Se notificó al coordinador.');
  }

  function nominar(uid) {
    const nd = nomData[uid] || {};
    const d = despachos.find(x => x.uid === uid);
    if (!nd.patente_tractor && !d.patente_tractor) {
      alert('Completá patente tractor, chofer y CUIT antes de nominar.');
      return;
    }
    setDespachos(despachos.map(x => x.uid === uid ? {
      ...x,
      estado: 'nominado',
      patente_tractor: nd.patente_tractor || x.patente_tractor,
      patente_semi: nd.patente_semi || x.patente_semi,
      chofer: nd.chofer || x.chofer,
      cuit: nd.cuit || x.cuit,
    } : x));
    alert('✓ Nominación confirmada. Se escribió en Mov Vehículos y se notificó a Portería.');
  }

  const filtrados = despachos.filter(d => filtro === 'todos' || d.estado === filtro);

  return (
    <div style={styles.wrap}>
      <div style={styles.topbar}>
        <div style={styles.logoArea}>
          <div style={styles.logoCircle}>e</div>
          <span style={styles.logoText}>XPLORA</span>
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
          <div style={{ ...styles.metricValue, color: '#BA7517' }}>{despachos.filter(d => d.estado === 'asignado').length}</div>
        </div>
        <div style={styles.metric}>
          <div style={styles.metricLabel}>Aceptados</div>
          <div style={{ ...styles.metricValue, color: '#0F6E56' }}>{despachos.filter(d => d.estado === 'aceptado').length}</div>
        </div>
        <div style={styles.metric}>
          <div style={styles.metricLabel}>Nominados</div>
          <div style={{ ...styles.metricValue, color: '#534AB7' }}>{despachos.filter(d => d.estado === 'nominado').length}</div>
        </div>
      </div>

      <div style={styles.filtros}>
        {['todos', 'asignado', 'aceptado', 'nominado'].map(f => (
          <button key={f} style={{ ...styles.filtroBtnBase, ...(filtro === f ? styles.filtroBtnActive : {}) }} onClick={() => setFiltro(f)}>
            {f === 'todos' ? 'Todos' : pillLabel[f]}
          </button>
        ))}
      </div>

      {filtrados.length === 0 && <div style={styles.empty}>Sin despachos para mostrar.</div>}

      {filtrados.map(d => (
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
                  Este despacho es parte de un pedido de <strong>{d.volumenTotal} tn</strong> en total — tu asignación es <strong>{d.volumen} tn</strong>.
                </div>
              )}

              <div style={styles.detailGrid}>
                <div style={styles.field}><span style={styles.label}>Producto</span><span style={styles.hiVal}>{d.producto}</span></div>
                <div style={styles.field}><span style={styles.label}>Tu volumen</span><span style={styles.hiVal}>{d.volumen} tn</span></div>
                <div style={styles.field}><span style={styles.label}>Recipiente</span><span>{d.recipiente}</span></div>
                <div style={styles.field}><span style={styles.label}>OV / OC</span><span>{d.ov}</span></div>
                <div style={styles.field}><span style={styles.label}>Fecha de carga</span><span style={styles.hiVal}>{d.fecha_carga}</span></div>
                <div style={styles.field}><span style={styles.label}>Entrega comprometida</span><span>{d.fecha_entrega}</span></div>
                <div style={{ ...styles.field, gridColumn: '1/-1' }}><span style={styles.label}>Lugar de entrega</span><span>{d.lugar}</span></div>
                {d.obs && <div style={{ ...styles.field, gridColumn: '1/-1' }}><span style={styles.label}>Observaciones</span><span>{d.obs}</span></div>}
              </div>

              {d.adjuntos.length > 0 && (
                <div style={styles.adjuntosRow}>
                  {d.adjuntos.map(a => <span key={a} style={styles.adjuntoChip}>📎 {a}</span>)}
                </div>
              )}

              {d.estado !== 'asignado' && (
                <div style={styles.nomSection}>
                  <div style={styles.nomTitle}>🚛 Datos de la unidad</div>
                  <div style={styles.nomGrid}>
                    <div style={styles.formField}>
                      <label style={styles.formLabel}>Patente tractor</label>
                      <input style={styles.input} type="text" placeholder="Ej: ABC 123"
                        defaultValue={d.patente_tractor}
                        disabled={d.estado === 'nominado'}
                        onChange={e => setNomData({ ...nomData, [d.uid]: { ...nomData[d.uid], patente_tractor: e.target.value } })} />
                    </div>
                    <div style={styles.formField}>
                      <label style={styles.formLabel}>Patente semi</label>
                      <input style={styles.input} type="text" placeholder="Ej: XYZ 456"
                        defaultValue={d.patente_semi}
                        disabled={d.estado === 'nominado'}
                        onChange={e => setNomData({ ...nomData, [d.uid]: { ...nomData[d.uid], patente_semi: e.target.value } })} />
                    </div>
                    <div style={styles.formField}>
                      <label style={styles.formLabel}>Nombre del chofer</label>
                      <input style={styles.input} type="text" placeholder="Nombre completo"
                        defaultValue={d.chofer}
                        disabled={d.estado === 'nominado'}
                        onChange={e => setNomData({ ...nomData, [d.uid]: { ...nomData[d.uid], chofer: e.target.value } })} />
                    </div>
                    <div style={styles.formField}>
                      <label style={styles.formLabel}>CUIT transportista</label>
                      <input style={styles.input} type="text" placeholder="20-00000000-0"
                        defaultValue={d.cuit}
                        disabled={d.estado === 'nominado'}
                        onChange={e => setNomData({ ...nomData, [d.uid]: { ...nomData[d.uid], cuit: e.target.value } })} />
                    </div>
                  </div>
                  {d.estado === 'nominado' && (
                    <div style={styles.nomOk}>✓ Nominación confirmada. Portería fue notificada.</div>
                  )}
                </div>
              )}

              <div style={styles.cardActions}>
                {d.estado === 'asignado' && (
                  <>
                    <button style={styles.btnAceptar} onClick={() => aceptar(d.uid)}>✓ Aceptar despacho</button>
                    <button style={styles.btnRechazar} onClick={() => rechazar(d.uid)}>✕ Rechazar</button>
                  </>
                )}
                {d.estado === 'aceptado' && (
                  <button style={styles.btnNominar} onClick={() => nominar(d.uid)}>✓ Confirmar nominación</button>
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
  adjuntosRow: { display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0' },
  adjuntoChip: { display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 8, background: '#F3F4F6', border: '0.5px solid #E5E7EB', fontSize: 11, color: '#6B7280' },
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