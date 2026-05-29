import React from 'react';

function Home({ usuario, onModulo, onLogout }) {
  const rol = usuario?.rol || '';

  const modulos = [
    {
      id: 'pedidos',
      emoji: '📋',
      titulo: 'Pedidos',
      desc: 'Crear y gestionar pedidos de entrega y retiro',
      roles: ['admin', 'comercial', 'coordinador'],
      color: '#C8102E',
    },
    {
      id: 'coordinador',
      emoji: '📅',
      titulo: 'Programación',
      desc: 'Programar despachos y gestionar transportistas',
      roles: ['admin', 'coordinador'],
      color: '#0F6E56',
    },
    {
      id: 'transportista',
      emoji: '🚛',
      titulo: 'Mis despachos',
      desc: 'Ver y gestionar los despachos asignados',
      roles: ['admin', 'transportista'],
      color: '#534AB7',
    },
    {
      id: 'admin',
      emoji: '⚙️',
      titulo: 'Administración',
      desc: 'Gestión de usuarios, roles y configuración',
      roles: ['admin'],
      color: '#374151',
    },
  ].filter(m => m.roles.includes(rol));

  return (
    <div style={styles.wrap}>
      <div style={styles.topbar}>
        <img src="/logo.png" alt="Explora" style={styles.logo} />
        <div style={styles.userArea}>
          <div style={styles.userName}>{usuario?.nombre || usuario?.email}</div>
          <div style={styles.userRol}>{rol}</div>
        </div>
        <button style={styles.btnLogout} onClick={onLogout}>Salir</button>
      </div>

      <div style={styles.bienvenida}>
        Bienvenido, <strong>{usuario?.nombre?.split(' ')[0] || 'usuario'}</strong>
      </div>

      <div style={styles.grid}>
        {modulos.map(m => (
          <button key={m.id} style={styles.card} onClick={() => onModulo(m.id)}>
            <div style={{ ...styles.cardIcon, background: m.color + '15', color: m.color }}>
              {m.emoji}
            </div>
            <div style={styles.cardTitulo}>{m.titulo}</div>
            <div style={styles.cardDesc}>{m.desc}</div>
            <div style={{ ...styles.cardArrow, color: m.color }}>→</div>
          </button>
        ))}
      </div>

      {usuario?.empresa && (
        <div style={styles.empresaTag}>
          🏢 {usuario.empresa}
        </div>
      )}
    </div>
  );
}

const styles = {
  wrap: { maxWidth: 720, margin: '0 auto', padding: '1.5rem 1rem' },
  topbar: { display: 'flex', alignItems: 'center', gap: 12, paddingBottom: '1rem', borderBottom: '0.5px solid #E5E7EB', marginBottom: '1.5rem' },
  logo: { height: 32, objectFit: 'contain' },
  userArea: { flex: 1 },
  userName: { fontSize: 13, fontWeight: 500, color: '#111827' },
  userRol: { fontSize: 11, color: '#9CA3AF', textTransform: 'capitalize' },
  btnLogout: { padding: '6px 14px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 13, cursor: 'pointer' },
  bienvenida: { fontSize: 20, color: '#111827', marginBottom: '1.5rem' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 },
  card: { display: 'flex', flexDirection: 'column', gap: 8, padding: '1.25rem', borderRadius: 12, border: '0.5px solid #E5E7EB', background: '#fff', cursor: 'pointer', textAlign: 'left', transition: 'box-shadow 0.2s' },
  cardIcon: { width: 44, height: 44, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 },
  cardTitulo: { fontSize: 15, fontWeight: 500, color: '#111827' },
  cardDesc: { fontSize: 12, color: '#9CA3AF', flex: 1 },
  cardArrow: { fontSize: 16, fontWeight: 500 },
  empresaTag: { marginTop: '1.5rem', padding: '8px 14px', borderRadius: 8, background: '#F9FAFB', border: '0.5px solid #E5E7EB', fontSize: 13, color: '#6B7280', textAlign: 'center' },
};

export default Home;