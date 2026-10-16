/**
 * =============================================================================
 * organizaciones/ModalEmails.js — v1.2.2 (correos por organización)
 * =============================================================================
 *
 * SÍNTOMA
 *   Hacía falta un modal "Correos — <razón social>" con la misma dinámica que
 *   el de Domicilios.
 *
 * CAUSA RAÍZ
 *   Los correos de una organización no tenían pantalla propia (ver
 *   `logica-organizacion-emails.js`).
 *
 * ALCANCE
 *   Wrapper fino: `<Modal>` + `GestionEmailsOrganizacion`. `puedeEditar` lo
 *   decide el orquestador con `puedeEditarOrg(org)` (admin siempre; comercial
 *   solo clientes; coordinador solo transportistas); quien no edita lo ve en
 *   solo lectura.
 *
 * LIMITACIONES CONOCIDAS
 *   Ninguna nueva.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Un comercial que abre un transporte
 *   ve la lista sin botones.
 * ========================================================================== */

import React from 'react';
import Modal from '../../ui/Modal';
import GestionEmailsOrganizacion from './GestionEmailsOrganizacion';

export default function ModalEmails({ org, usuario, puedeEditar, onCerrar }) {
  return (
    <Modal titulo={`Correos — ${org.razon_social}`} onCerrar={onCerrar}>
      <GestionEmailsOrganizacion
        usuario={usuario}
        organizacion={org}
        puedeEditar={puedeEditar}
        soloLectura={!puedeEditar}
      />
    </Modal>
  );
}
