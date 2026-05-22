import React from 'react';

function Home({ usuario, onModulo }) {
  const modulos = [
    {
      id: 'pedidos',
      icono: '📦',
      titulo: 'Pedidos',
      desc: 'Cargá y seguí el estado de entregas y retiros.',
      badge: 'Nuevo',
      badgeColor: '#EEEDFE',
      badgeText: '#3C3489',
    },
    {
      id: 'nominaciones',
      icono: '🚛',
      titulo: 'Nominaciones',
      desc: 'Registrá el ingreso de camiones a planta.',
      badge: 'En producción',
      badgeColor: '#E1F5EE',
      badgeText: '#085041',
    },
    {
      id: 'acreditacion',
      icono: '📋',
      titulo: 'Acreditación',
      desc: 'Gestioná la documentación de transportistas.',
      badge: 'En producción',
      badgeColor: '#E1F5EE',
      badgeText: '#085041',
    },
  ];

  return (
    <div style={styles.wrap}>
      <div style={styles.topbar}>
        <div style={styles.logoArea}>
          <div style={styles.logoCircle}>e</div>
          <span style={styles.logoText}>XPLORA</span>
          <span style={styles.portalText}>Portal operativo</span>
        </div>
        <div style={styles.userArea}>
          <div style={styles.avatar}>
            {usuario?.nombre?.charAt(0) || 'U'}
          </div>
          <span style={styles.userName}>{usuario?.nombre || 'Usuario'}</span>
        </div>
      </div>

      <div style={styles.greeting}>
        <h2 style={styles.greetingTitle}>
          Buenos días, {usuario?.nombre?.split(' ')[0] || 'Usuario'}
        </h2>
        <p style={styles.greetingSub}>¿A qué módulo querés acceder hoy?</p>
      </div>

      <div style={styles.grid}>
        {modulos.map(m => (
          <div
            key={m.id}
            style={styles.card}
            onClick={() => onModulo(m.id)}
            onMouseEnter={e => e.currentTarget.style.borderColor = '#9CA3AF'}
            onMouseLeave={e => e.currentTarget.style.borderColor = '#E5E7EB'}
          >
            <div style={styles.cardIcono}>{m.icono}</div>
            <div style={styles.cardTitulo}>{m.titulo}</div>
            <div style={styles.cardDesc}>{m.desc}</div>
            <span style={{
              ...styles.badge,
              background: m.badgeColor,
              color: m.badgeText,
            }}>
              {m.badge}
            </span>
          </div>
        ))}
      </div>

      <div style={styles.pie}>
        <span>portal.explora.com.ar</span>
        <span>v1.0 · 2026</span>
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    maxWidth: 720,
    margin: '0 auto',
    padding: '1.5rem 1rem',
  },
  topbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: '1rem',
    borderBottom: '0.5px solid #E5E7EB',
    marginBottom: '1.5rem',
  },
  logoArea: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  logoCircle: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    background: '#D63B1F',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 17,
    fontWeight: 800,
  },
  logoText: {
    fontSize: 15,
    fontWeight: 500,
    color: '#111827',
  },
  portalText: {
    fontSize: 13,
    color: '#9CA3AF',
    marginLeft: 4,
  },
  userArea: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    background: '#EEEDFE',
    color: '#3C3489',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    fontWeight: 500,
  },
  userName: {
    fontSize: 13,
    color: '#6B7280',
  },
  greeting: {
    marginBottom: '2rem',
  },
  greetingTitle: {
    fontSize: 20,
    fontWeight: 500,
    color: '#111827',
    marginBottom: 4,
  },
  greetingSub: {
    fontSize: 13,
    color: '#6B7280',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 12,
    marginBottom: '2rem',
  },
  card: {
    background: '#fff',
    border: '0.5px solid #E5E7EB',
    borderRadius: 12,
    padding: '1.25rem',
    cursor: 'pointer',
    transition: 'border-color 0.15s',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  cardIcono: {
    fontSize: 28,
    marginBottom: 4,
  },
  cardTitulo: {
    fontSize: 15,
    fontWeight: 500,
    color: '#111827',
  },
  cardDesc: {
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 1.5,
    flex: 1,
  },
  badge: {
    fontSize: 10,
    padding: '2px 8px',
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  pie: {
    paddingTop: '1rem',
    borderTop: '0.5px solid #E5E7EB',
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 11,
    color: '#9CA3AF',
  },
};

export default Home;