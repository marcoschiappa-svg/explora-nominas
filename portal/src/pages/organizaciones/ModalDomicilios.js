/**
 * =============================================================================
 * organizaciones/ModalDomicilios.js — v1.2.0 (rediseño Organizaciones)
 * =============================================================================
 *
 * SÍNTOMA
 *   El Paso 4 del rediseño pide un modal "Domicilios — <razón social>" en
 *   vez de la vista interna a pantalla completa que abría
 *   `Organizaciones.js` (`<Domicilios organizacion={org} />` reemplazando
 *   toda la pantalla).
 *
 * CAUSA RAÍZ
 *   La gestión de domicilios de una organización vivía atada a esa vista de
 *   pantalla completa.
 *
 * ALCANCE
 *   Wrapper fino: `<Modal>` + `GestionDomiciliosOrganizacion` (extraída de
 *   `Domicilios.js`, ver su propio encabezado). `soloLectura` cuando el
 *   usuario es coordinador sin comercial (ni admin) -- resuelve la
 *   limitación que RF-07 dejó anotada (antes la pantalla entera quedaba
 *   bloqueada para ese rol).
 *
 * LIMITACIONES CONOCIDAS
 *   Ninguna nueva.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Comercial: alta/vincular/
 *   desvincular funcionan dentro del modal. Coordinador sin comercial: ve
 *   la lista sin acciones.
 * ========================================================================== */

import React from 'react';
import Modal from '../../ui/Modal';
import GestionDomiciliosOrganizacion from './GestionDomiciliosOrganizacion';

export default function ModalDomicilios({ org, usuario, soyAdmin, soyComercial, onCerrar }) {
  const soloLectura = !soyAdmin && !soyComercial;

  return (
    <Modal titulo={`Domicilios — ${org.razon_social}`} onCerrar={onCerrar}>
      <GestionDomiciliosOrganizacion
        usuario={usuario}
        organizacion={org}
        puedeEditar={soyAdmin || soyComercial}
        soloLectura={soloLectura}
      />
    </Modal>
  );
}
