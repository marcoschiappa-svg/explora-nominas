import React, { useState } from 'react';

function Pedidos({ usuario, onVolver }) {
  const [vista, setVista] = useState('panel');
  const [pedidos, setPedidos] = useState([
    {
      id: 'PED-260520-241',
      estado: 'pendiente',
      tipo: 'Entrega al cliente',
      producto: 'Biodiesel',
      volumen: 120,
      cliente: 'SINER',
      ov: 'OV 2630',
      telefono: '+54 341 555-1234',
      fecha_entrega: '2026-05-24',
      lugar: 'Ruta Nac. 9 km 1307,5 — Tucumán',
      recipiente: 'Granel',
      obs: 'Requiere escolta.',
      creado_por: usuario?.nombre || 'Usuario',
      creado_en: new Date().toLocaleString('es-AR'),
      editado_en: null,
    },
  ]);

  const [form, setForm] = useState({
    tipo: 'Entrega al cliente',
    producto: '',
    volumen: '',
    recipiente: 'Granel',
    cliente: '',
    telefono: '',
    ov: '',
    fecha_entrega: '',
    lugar: '',
    obs: '',
  });

  function genNro() {
    const now = new Date();
    const y = String(now.getFullYear()).slice(-2);
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const r = String(Math.floor(Math.random() * 900) + 100);
    return `PED-${y}${m}${d}-${r}`;
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.producto || !form.volumen || !form.cliente || !form.ov || !form.fecha_entrega || !form.lugar) {
      alert('Completá todos los campos obligatorios');
      return;
    }
    const nuevo = {
      ...form,
      id: genNro(),
      estado: 'pendiente',
      creado_por: usuario?.nombre || 'Usuario',
      creado_en: new Date().toLocaleString('es-AR'),
      editado_en: null,
    };
    setPedidos([nuevo, ...pedidos]);
    setVista('panel');
    setForm({ tipo: 'Entrega al cliente', producto: '', volumen: '', recipiente: 'Granel', cliente: '', telefono: '', ov: '', fecha_entrega: '', lugar: '', obs: '' });
    alert(`✓ Pedido ${nuevo.id} registrado. Se notificó al coordinador.`);
  }

  function suspender(id) {
    const motivo = prompt('Motivo de la suspensión (requerido):');
    if (!motivo) return;
    setPedidos(pedidos.map(p => p.id === id ? { ...p, estado: 'suspendido' } : p));
  }

  const pillColors = {
    pendiente: { bg: '#EEEDFE', color: '#3C3489' },
    programado: { bg: '#E1F5EE', color: '#085041' },
    nominado: { bg: '#EEEDFE', color: '#3C3489' },
    cumplido: { bg: '#E1F5EE', color: '#085041' },
    suspendido: { bg: '#FCEBEB', color: '#791F1F' },
  };

  const pillLabel = {
    pendiente: 'Pendiente',
    programado: 'Programado',
    nominado: 'Nominado',
    cumplido: 'Cumplido',
    suspendido: 'Suspendido',
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.topbar}>
        <div style={styles.logoArea}>
          <div style={styles.logoCircle}>e</div>
          <span style={styles.logoText}>XPLORA</span>
          <span style={styles.portalText}>Pedidos</span>
        </div>
        <button style={styles.btnVolver} onClick={onVolver}>← Inicio</button>
      </div>

      {vista === 'panel' && (
        <div>
          <div style={styles.panelHeader}>
            <h2 style={styles.titulo}>Mis pedidos</h2>
            <button style={styles.btnNuevo} onClick={() => setVista('nuevo')}>
              + Nuevo pedido
            </button>
          </div>

          {pedidos.length === 0 && (
            <div style={styles.empty}>No tenés pedidos aún. Creá el primero.</div>
          )}

          {pedidos.map(p => (
            <div key={p.id} style={styles.card}>
              <div style={styles.cardHeader}>
                <span style={{ ...styles.pill, background: pillColors[p.estado]?.bg, color: pillColors[p.estado]?.color }}>
                  {pillLabel[p.estado]}
                </span>
                <span style={styles.cardNro}>{p.id}</span>
                <span style={styles.cardResumen}>{p.cliente} · {p.producto} {p.volumen} tn</span>
                <span style={styles.cardFecha}>{p.editado_en ? `Editado ${p.editado_en}` : `Creado ${p.creado_en}`}</span>
              </div>
              <div style={styles.cardBody}>
                <div style={styles.detailGrid}>
                  <div style={styles.field}><span style={styles.label}>Tipo</span><span>{p.tipo}</span></div>
                  <div style={styles.field}><span style={styles.label}>Producto</span><span>{p.producto}</span></div>
                  <div style={styles.field}><span style={styles.label}>Volumen</span><span>{p.volumen} tn</span></div>
                  <div style={styles.field}><span style={styles.label}>Recipiente</span><span>{p.recipiente}</span></div>
                  <div style={styles.field}><span style={styles.label}>Cliente / Proveedor</span><span>{p.cliente}</span></div>
                  <div style={styles.field}><span style={styles.label}>OV / OC</span><span>{p.ov}</span></div>
                  <div style={styles.field}><span style={styles.label}>Teléfono</span><span>{p.telefono}</span></div>
                  <div style={styles.field}><span style={styles.label}>Entrega comprometida</span><span>{p.fecha_entrega}</span></div>
                  <div style={{ ...styles.field, gridColumn: '1/-1' }}><span style={styles.label}>Lugar</span><span>{p.lugar}</span></div>
                  {p.obs && <div style={{ ...styles.field, gridColumn: '1/-1' }}><span style={styles.label}>Observaciones</span><span>{p.obs}</span></div>}
                </div>
                <div style={styles.origen}>
                  Creado por <strong>{p.creado_por}</strong> · {p.creado_en}
                </div>
                {p.estado !== 'cumplido' && p.estado !== 'suspendido' && (
                  <div style={styles.cardActions}>
                    <button style={styles.btnSuspender} onClick={() => suspender(p.id)}>Suspender</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {vista === 'nuevo' && (
        <div>
          <div style={styles.panelHeader}>
            <h2 style={styles.titulo}>Nuevo pedido</h2>
            <button style={styles.btnVolver} onClick={() => setVista('panel')}>← Volver</button>
          </div>

          <form onSubmit={handleSubmit} style={styles.form}>
            <div style={styles.seccion}>
              <div style={styles.seccionTitulo}>Tipo de operación</div>
              <div style={styles.tipoGrid}>
                <button type="button"
                  style={{ ...styles.tipoBtn, ...(form.tipo === 'Entrega al cliente' ? styles.tipoBtnActive : {}) }}
                  onClick={() => setForm({ ...form, tipo: 'Entrega al cliente' })}>
                  Entrega al cliente
                </button>
                <button type="button"
                  style={{ ...styles.tipoBtn, ...(form.tipo === 'Retiro de proveedor' ? styles.tipoBtnActive : {}) }}
                  onClick={() => setForm({ ...form, tipo: 'Retiro de proveedor' })}>
                  Retiro de proveedor
                </button>
              </div>
            </div>

            <div style={styles.seccion}>
              <div style={styles.seccionTitulo}>Producto y volumen</div>
              <div style={styles.grid2}>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Producto *</label>
                  <select style={styles.input} value={form.producto} onChange={e => setForm({ ...form, producto: e.target.value })}>
                    <option value="">Seleccionar...</option>
                    <option>Biodiesel</option>
                    <option>EMAG</option>
                    <option>Glicerina</option>
                    <option>Otro</option>
                  </select>
                </div>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Volumen (tn) *</label>
                  <input style={styles.input} type="number" placeholder="Ej: 60" value={form.volumen} onChange={e => setForm({ ...form, volumen: e.target.value })} />
                </div>
              </div>
              <div style={styles.formField}>
                <label style={styles.formLabel}>Tipo de recipiente</label>
                <div style={styles.tipoGrid}>
                  <button type="button"
                    style={{ ...styles.tipoBtn, ...(form.recipiente === 'Granel' ? styles.tipoBtnActive : {}) }}
                    onClick={() => setForm({ ...form, recipiente: 'Granel' })}>
                    🚛 Granel
                  </button>
                  <button type="button"
                    style={{ ...styles.tipoBtn, ...(form.recipiente === 'IBC' ? styles.tipoBtnActive : {}) }}
                    onClick={() => setForm({ ...form, recipiente: 'IBC' })}>
                    📦 IBC
                  </button>
                </div>
              </div>
            </div>

            <div style={styles.seccion}>
              <div style={styles.seccionTitulo}>Datos comerciales</div>
              <div style={styles.grid2}>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Cliente / Proveedor *</label>
                  <input style={styles.input} type="text" placeholder="Ej: SINER" value={form.cliente} onChange={e => setForm({ ...form, cliente: e.target.value })} />
                </div>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>OV / OC *</label>
                  <input style={styles.input} type="text" placeholder="Ej: OV 2630" value={form.ov} onChange={e => setForm({ ...form, ov: e.target.value })} />
                </div>
              </div>
              <div style={styles.formField}>
                <label style={styles.formLabel}>Teléfono de contacto</label>
                <input style={{ ...styles.input, maxWidth: 280 }} type="tel" placeholder="+54 341 555-0000" value={form.telefono} onChange={e => setForm({ ...form, telefono: e.target.value })} />
              </div>
            </div>

            <div style={styles.seccion}>
              <div style={styles.seccionTitulo}>Logística</div>
              <div style={styles.grid2}>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Fecha de entrega comprometida *</label>
                  <input style={styles.input} type="date" value={form.fecha_entrega} onChange={e => setForm({ ...form, fecha_entrega: e.target.value })} />
                </div>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Lugar de entrega / origen *</label>
                  <input style={styles.input} type="text" placeholder="Dirección completa" value={form.lugar} onChange={e => setForm({ ...form, lugar: e.target.value })} />
                </div>
              </div>
            </div>

            <div style={styles.seccion}>
              <div style={styles.seccionTitulo}>Observaciones y adjuntos</div>
              <div style={styles.formField}>
                <textarea style={styles.textarea} placeholder="Información adicional, requerimientos especiales..." value={form.obs} onChange={e => setForm({ ...form, obs: e.target.value })} />
              </div>
            </div>

            <div style={styles.formActions}>
              <button type="submit" style={styles.btnConfirmar}>Confirmar pedido</button>
              <button type="button" style={styles.btnCancelar} onClick={() => setVista('panel')}>Cancelar</button>
            </div>
          </form>
        </div>
      )}
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
  panelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' },
  titulo: { fontSize: 18, fontWeight: 500, color: '#111827' },
  btnNuevo: { padding: '8px 16px', borderRadius: 8, border: 'none', background: '#534AB7', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  empty: { textAlign: 'center', padding: '2rem', color: '#9CA3AF', fontSize: 13 },
  card: { background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 12, overflow: 'hidden', marginBottom: 10 },
  cardHeader: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: '#F9FAFB', flexWrap: 'wrap' },
  pill: { fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 20, flexShrink: 0 },
  cardNro: { fontSize: 13, fontWeight: 500, color: '#111827', flexShrink: 0 },
  cardResumen: { fontSize: 12, color: '#6B7280', flex: 1 },
  cardFecha: { fontSize: 11, color: '#9CA3AF', flexShrink: 0 },
  cardBody: { padding: '12px 14px' },
  detailGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginBottom: 10 },
  field: { display: 'flex', flexDirection: 'column', gap: 3 },
  label: { fontSize: 11, color: '#9CA3AF' },
  origen: { fontSize: 12, color: '#6B7280', padding: '8px 10px', background: '#F9FAFB', borderRadius: 8, marginBottom: 10 },
  cardActions: { display: 'flex', gap: 8 },
  btnSuspender: { padding: '6px 14px', borderRadius: 8, border: '0.5px solid #A32D2D', background: '#fff', color: '#A32D2D', fontSize: 12, cursor: 'pointer' },
  form: { background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 12, padding: '1.5rem' },
  seccion: { marginBottom: '1.5rem' },
  seccionTitulo: { fontSize: 12, fontWeight: 500, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, paddingBottom: 6, borderBottom: '0.5px solid #F3F4F6' },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 },
  formField: { display: 'flex', flexDirection: 'column', gap: 5 },
  formLabel: { fontSize: 13, color: '#6B7280', fontWeight: 500 },
  input: { fontSize: 14, padding: '8px 10px', borderRadius: 8, border: '0.5px solid #E5E7EB', color: '#111827', width: '100%' },
  textarea: { fontSize: 14, padding: '8px 10px', borderRadius: 8, border: '0.5px solid #E5E7EB', color: '#111827', width: '100%', minHeight: 80, resize: 'vertical' },
  tipoGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  tipoBtn: { padding: '10px 8px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 13, cursor: 'pointer' },
  tipoBtnActive: { border: '1.5px solid #534AB7', background: '#EEEDFE', color: '#3C3489' },
  formActions: { display: 'flex', flexDirection: 'column', gap: 10, marginTop: '1.5rem' },
  btnConfirmar: { padding: '11px', borderRadius: 8, border: 'none', background: '#534AB7', color: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer' },
  btnCancelar: { padding: '11px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#111827', fontSize: 14, cursor: 'pointer' },
};

export default Pedidos;