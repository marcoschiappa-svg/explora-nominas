/**
 * =============================================================================
 * Domicilios.js — Direcciones de una organización (Portal Explora)
 * =============================================================================
 *
 * PROPÓSITO
 * Gestionar las direcciones que se le ofrecen a una organización cuando se le
 * carga un pedido.
 *
 * -----------------------------------------------------------------------------
 * DOS ENTIDADES, NO UNA
 * -----------------------------------------------------------------------------
 * El DOMICILIO existe por sí solo: "Yrigoyen 2933, Puerto General San Martín"
 * es una dirección y no le pertenece a nadie.
 *
 * El VÍNCULO (`organizacion_domicilios`) dice quién la usa. Es lo que responde
 * "qué direcciones le aparecen a este cliente al cargarle un pedido".
 *
 * No son lo mismo que el destino de un pedido: la planta de Explora es destino
 * de 18 pedidos de 8 clientes distintos y **no está en la lista de ninguno de
 * ellos**. Es de Explora. Esos pedidos apuntan al domicilio directamente.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ SE ENTRA POR LA ORGANIZACIÓN
 * -----------------------------------------------------------------------------
 * De los 34 domicilios relevados, ninguno tiene dos organizaciones. El caso real
 * es "este cliente entrega acá", no "esta dirección la usan varios".
 *
 * Y es el flujo natural: cuando el comercial está cargando un pedido y la
 * dirección no está, lo que quiere hacer es agregarle una dirección a ese
 * cliente — no dar de alta un domicilio suelto y después acordarse de
 * vincularlo.
 *
 * -----------------------------------------------------------------------------
 * UN SOLO CAMINO PARA AGREGAR
 * -----------------------------------------------------------------------------
 * No hay "buscar existente" y "crear nueva" como opciones separadas: es donde la
 * gente elige mal y termina duplicando. Hay un formulario, y mientras se escribe
 * la calle van apareciendo las direcciones parecidas que ya existen.
 *
 * Si se elige una, se crea solo el vínculo. Si no, se crea la dirección y el
 * vínculo en la misma transacción.
 *
 * Y si lo que se escribió se parece mucho a una existente pero no fue la
 * elegida, se pregunta antes de crear. Ese es el momento —el único— en que se
 * pueden evitar los duplicados: los 50 registros para 34 lugares reales no
 * salieron de que alguien eligiera mal, sino de que escribieron y guardaron.
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (rediseño Organizaciones) -- LA GESTIÓN SE MUDA A UN COMPONENTE REUSABLE
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     El nuevo modal "Domicilios — <razón social>" de `Organizaciones.js`
 *     necesita la MISMA gestión que esta pantalla, para no implementarla
 *     dos veces (alta con sugerencias, vincular, desvincular, marcar
 *     principal).
 *
 *   CAUSA RAÍZ
 *     Esa gestión vivía entera acá adentro, mezclada con el `Topbar` propio
 *     de esta pantalla.
 *
 *   ALCANCE
 *     1. Todo el cuerpo (carga, sugerencias, alta, vincular, desvincular,
 *        marcar principal) se extrae TAL CUAL a
 *        `organizaciones/GestionDomiciliosOrganizacion.js` -- ninguna
 *        función nueva, ningún comportamiento distinto.
 *     2. Esta pantalla queda como el `Topbar` + el banner de `sinAcceso` +
 *        ese componente, con `puedeEditar={esComercial(usuario)}`. Hoy
 *        nada la invoca por ruta (`Organizaciones.js` pasó a abrir un
 *        modal en vez de reemplazar la pantalla), pero el comportamiento
 *        visible, si algo la vuelve a invocar con las mismas props, es
 *        idéntico al de antes.
 *
 *   LIMITACIONES CONOCIDAS
 *     Ninguna nueva.
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm run build` sin warnings. Si se monta `<Domicilios
 *     usuario={u} organizacion={o} onVolver={fn} />` a mano, se comporta
 *     igual que antes de la extracción.
 * ========================================================================== */

import React from 'react';
import { esComercial, motivoSinAcceso } from '../sesion';
import GestionDomiciliosOrganizacion from './organizaciones/GestionDomiciliosOrganizacion';

export default function Domicilios({ usuario, organizacion, onVolver }) {
  const puedeEditar = esComercial(usuario);
  const sinAcceso = motivoSinAcceso(usuario, ['admin', 'comercial']);

  if (sinAcceso) {
    return (
      <div style={styles.wrap}>
        <Topbar onVolver={onVolver} />
        <div style={styles.bannerError}>{sinAcceso}</div>
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
      <Topbar onVolver={onVolver} />

      <div style={styles.panelHeader}>
        <div>
          <div style={styles.titulo}>Domicilios</div>
          <div style={styles.subtitulo}>{organizacion.razon_social}</div>
        </div>
      </div>

      <GestionDomiciliosOrganizacion
        usuario={usuario}
        organizacion={organizacion}
        puedeEditar={puedeEditar}
      />
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

/* -----------------------------------------------------------------------------
 * Estilos -- propios de esta pantalla (Topbar/banner), no migrados a B1: el
 * resto del contenido vive ahora en `GestionDomiciliosOrganizacion`, que sí
 * usa tokens/useTema.
 * -------------------------------------------------------------------------- */

const styles = {
  wrap: { maxWidth: 900, margin: '0 auto', padding: '1.5rem 1rem' },
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '1rem', borderBottom: '0.5px solid #E5E7EB', marginBottom: '1.5rem' },
  logoArea: { display: 'flex', alignItems: 'center' },
  logoImg: { height: 36, objectFit: 'contain' },
  btnVolver: { padding: '6px 14px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 13, cursor: 'pointer' },
  panelHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem' },
  titulo: { fontSize: 18, fontWeight: 500, color: '#111827' },
  subtitulo: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  bannerError: { padding: '10px 14px', borderRadius: 8, background: '#FEF2F2', border: '0.5px solid #FCA5A5', fontSize: 13, color: '#B91C1C', marginBottom: 12, whiteSpace: 'pre-line' },
};
