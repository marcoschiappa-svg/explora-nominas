/**
 * =============================================================================
 * organizaciones/Organizaciones.js — v1.2.0 (rediseño Organizaciones)
 * =============================================================================
 *
 * PROPÓSITO
 * Alta, edición y baja de las empresas con las que opera Explora: los clientes
 * que compran, los transportes que llevan, y la propia Explora. Ver el
 * encabezado original (historia de RF-03/RF-07/RF-08/v1.1.3) en el archivo
 * que este orquestador reemplaza -- hoy un re-export en
 * `pages/Organizaciones.js` -- esa lógica de negocio NO cambió.
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (rediseño Organizaciones) -- DE PANTALLAS A MODALES
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     Clic en una organización llevaba a una "vista de formulario" a
 *     pantalla completa, y "Domicilios"/"Usuarios" reemplazaban la pantalla
 *     entera -- lenguaje visual viejo, distinto del ya migrado en
 *     Pedidos/Programación/NuevoTarifario.
 *
 *   CAUSA RAÍZ
 *     `Organizaciones.js` nunca se tocó desde B1: seguía con `vista` como
 *     máquina de estados de pantalla completa (`'lista'|'form'`) en vez de
 *     modales.
 *
 *   ALCANCE
 *     1. El archivo se parte: este orquestador mantiene TODA la lógica de
 *        datos de siempre (carga de `organizaciones`/`productos`, filtros,
 *        `puedeEditarOrg()`, `formVacioPorRol()`) y decide SOLO cuál de los
 *        cuatro modales está abierto (`modalAbierto: {tipo, org}|null` --
 *        nunca dos a la vez). `ModalOrganizacion`/`ModalDomicilios`/
 *        `ModalUsuarios`/`ModalProductos` tienen cada uno su propio
 *        encabezado con el detalle de su parte.
 *     2. Lista: `BarraFiltros` (`variante="compacta"`) + `PanelLista`, en
 *        vez del buscador+`<select>` y las `<Tarjeta>` sueltas de antes.
 *        Pastillas de tipo (Todas/Clientes/Transportes/Propias, con
 *        conteo) + "Mostrar inactivas" en la franja de pastillas
 *        (`piePastillas`), con persistencia en `filtros-listado.js`
 *        (`grupoActivo` para el tipo, `verInactivas` -- campo nuevo, ver el
 *        encabezado propio de ese archivo).
 *     3. Localidad del primer domicilio por fila: dato nuevo que la lista
 *        de antes no mostraba -- se agrega una suscripción más
 *        (`organizacion_domicilios`), mismo patrón sin índice que ya usan
 *        `productos`/`domicilios` en esta pantalla y en `Domicilios.js`.
 *     4. El botón "Domicilios" deja de ocultarse para el coordinador sin
 *        comercial (antes, porque `Domicilios.js` bloqueaba la pantalla
 *        entera para ese rol) -- ahora el modal decide solo lectura, lo que
 *        **resuelve** esa limitación que había dejado anotada RF-07.
 *
 *   LIMITACIONES CONOCIDAS
 *     Ninguna nueva más allá de las que ya traían RF-03/RF-07/RF-08 (ver
 *     cada modal).
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm run build` sin warnings. Clic en una fila abre el modal
 *     de edición; los botones de la fila no lo abren. Nunca hay dos
 *     modales abiertos. Filtros y "Mostrar inactivas" persisten entre
 *     sesiones.
 * ========================================================================== */

import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { esAdmin, tieneRol, motivoSinAcceso } from '../../sesion';
import { rolesDe } from '../../modulos';
import { claveNormalizada } from '../../mapa-normalizacion';
import { textoDomicilio } from '../../buscar-domicilios';
import { leerPreferencias, guardarPreferencias } from '../../filtros-listado';
import BarraFiltros from '../../ui/BarraFiltros';
import PanelLista from '../../ui/PanelLista';
import PastillaGrupo from '../../ui/PastillaGrupo';
import Pastilla from '../../ui/Pastilla';
import Boton from '../../ui/Boton';
import Vacio from '../../ui/Vacio';
import { colorEstado } from '../../ui/tokens';
import { useEstilos } from './estilos';
import ModalOrganizacion from './ModalOrganizacion';
import ModalDomicilios from './ModalDomicilios';
import ModalUsuarios from './ModalUsuarios';
import ModalProductos from './ModalProductos';

const FORM_VACIO = {
  razon_social: '', nombre_corto: '', cuit: '', es_exterior: false,
  email: '', telefono: '', es_cliente: true, es_transportista: false, obs: '',
};

const PILLS = {
  propia:     { bg: '#EEEDFE', color: colorEstado.acentoPurpura },
  cliente:    { bg: colorEstado.exitoFondo, color: colorEstado.exitoTexto },
  transporte: { bg: colorEstado.advertenciaFondoAlterno, color: colorEstado.advertenciaTextoFuerte },
  inactiva:   { bg: colorEstado.peligroFondo, color: colorEstado.peligroTexto },
  producto:   { bg: '#DBEAFE', color: colorEstado.acentoAzul },
};

export default function Organizaciones({ usuario, onVolver }) {
  const styles = useEstilos();

  const soyAdmin = esAdmin(usuario);
  const soyComercial = tieneRol(usuario, 'comercial');
  const soyCoordinador = tieneRol(usuario, 'coordinador');
  const puedeEditar = soyAdmin || soyComercial || soyCoordinador;
  const puedeElegirBanderas = soyAdmin;
  const puedeElegirTipo = !soyAdmin && soyComercial && soyCoordinador;
  const sinAcceso = motivoSinAcceso(usuario, rolesDe('organizaciones'));

  function puedeEditarOrg(org) {
    if (soyAdmin) return true;
    if (soyComercial && org.es_cliente && !org.es_transportista && !org.es_propia) return true;
    if (soyCoordinador && org.es_transportista && !org.es_propia) return true;
    return false;
  }

  function formVacioPorRol() {
    if (soyAdmin || puedeElegirTipo) return FORM_VACIO;
    if (soyCoordinador) return { ...FORM_VACIO, es_cliente: false, es_transportista: true };
    return FORM_VACIO;
  }

  const [organizaciones, setOrganizaciones] = useState([]);
  const [productos, setProductos] = useState([]);
  const [vinculos, setVinculos] = useState([]);
  const [domicilios, setDomicilios] = useState([]);
  const [cargando, setCargando] = useState(true);

  const [filtro, setFiltro] = useState('');
  const [grupoActivo, setGrupoActivo] = useState(
    (!soyAdmin && !soyComercial && soyCoordinador) ? 'transportes' : 'todas'
  );
  const [verInactivas, setVerInactivas] = useState(false);

  // `modalAbierto: { tipo: 'organizacion'|'domicilios'|'usuarios'|'productos', org }`
  // -- `org: null` es el alta. Nunca hay dos modales a la vez.
  const [modalAbierto, setModalAbierto] = useState(null);

  useEffect(() => {
    if (sinAcceso) { setCargando(false); return; }

    const unsub = onSnapshot(collection(db, 'organizaciones'), (snap) => {
      setOrganizaciones(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setCargando(false);
    }, (err) => { console.error('Organizaciones:', err); setCargando(false); });

    const unsubProductos = onSnapshot(collection(db, 'productos'), (snap) => {
      setProductos(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error('Productos:', err));

    // 3. Localidad del primer domicilio por fila -- ver el encabezado.
    const unsubVinculos = onSnapshot(collection(db, 'organizacion_domicilios'), (snap) => {
      setVinculos(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error('Vínculos:', err));
    const unsubDomicilios = onSnapshot(collection(db, 'domicilios'), (snap) => {
      setDomicilios(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error('Domicilios:', err));

    return () => { unsub(); unsubProductos(); unsubVinculos(); unsubDomicilios(); };
  }, [sinAcceso]);

  // Preferencias -- ver el encabezado v1.2.0 (rediseño Organizaciones) de
  // `filtros-listado.js`. Se leen una vez al montar; si hay guardadas,
  // pisan el valor inicial por rol.
  useEffect(() => {
    if (!usuario || !usuario.uid) return;
    const prefs = leerPreferencias('organizaciones', usuario.uid);
    if (!prefs) return;
    if (prefs.grupoActivo) setGrupoActivo(prefs.grupoActivo);
    if (typeof prefs.verInactivas === 'boolean') setVerInactivas(prefs.verInactivas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!usuario || !usuario.uid) return;
    const id = setTimeout(() => {
      guardarPreferencias('organizaciones', usuario.uid, { grupoActivo, verInactivas });
    }, 300);
    return () => clearTimeout(id);
  }, [grupoActivo, verInactivas, usuario]);

  const prodsPorId = useMemo(() => new Map(productos.map(p => [p.id, p])), [productos]);

  /** Localidad del primer domicilio (por orden alfabético) de cada organización. */
  const localidadPorOrg = useMemo(() => {
    const domPorId = new Map(domicilios.map(d => [d.id, d]));
    const mapa = new Map();
    for (const v of vinculos) {
      const d = domPorId.get(v.domicilio_id);
      if (!d) continue;
      const actual = mapa.get(v.organizacion_id);
      if (!actual || (d.ciudad || '').localeCompare(actual, 'es') < 0) {
        mapa.set(v.organizacion_id, d.ciudad || textoDomicilio(d));
      }
    }
    return mapa;
  }, [vinculos, domicilios]);

  // Filtro texto+inactivas, ANTES de agrupar por tipo -- los conteos de las
  // pastillas de tipo salen de acá, mismo criterio que `conteosPorGrupo` en
  // Pedidos.js.
  const baseFiltrada = useMemo(() => {
    const texto = claveNormalizada(filtro);
    return organizaciones
      .filter(o => verInactivas || o.estado === 'activo')
      .filter(o => !texto
        || claveNormalizada(o.razon_social).includes(texto)
        || (o.cuit && claveNormalizada(o.cuit).includes(texto)))
      .sort((a, b) => a.razon_social.localeCompare(b.razon_social, 'es'));
  }, [organizaciones, filtro, verInactivas]);

  const conteos = useMemo(() => ({
    todas: baseFiltrada.length,
    clientes: baseFiltrada.filter(o => o.es_cliente).length,
    transportes: baseFiltrada.filter(o => o.es_transportista).length,
    propias: baseFiltrada.filter(o => o.es_propia).length,
  }), [baseFiltrada]);

  const visibles = useMemo(() => {
    if (grupoActivo === 'clientes') return baseFiltrada.filter(o => o.es_cliente);
    if (grupoActivo === 'transportes') return baseFiltrada.filter(o => o.es_transportista);
    if (grupoActivo === 'propias') return baseFiltrada.filter(o => o.es_propia);
    return baseFiltrada;
  }, [baseFiltrada, grupoActivo]);

  const hayFiltrosActivos = !!filtro || verInactivas || grupoActivo !== 'todas';
  function limpiarFiltros() {
    setFiltro('');
    setVerInactivas(false);
    setGrupoActivo((!soyAdmin && !soyComercial && soyCoordinador) ? 'transportes' : 'todas');
  }

  function abrirModal(tipo, org) {
    setModalAbierto({ tipo, org: org || null });
  }
  function cerrarModal() {
    setModalAbierto(null);
  }

  if (sinAcceso) {
    return <div style={styles.wrap}><div style={styles.bannerError}>{sinAcceso}</div></div>;
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.panelHeader}>
        <div style={styles.titulo}>Organizaciones</div>
        {puedeEditar && <Boton onClick={() => abrirModal('organizacion', null)}>+ Nueva organización</Boton>}
      </div>

      <BarraFiltros
        texto={filtro}
        onCambiarTexto={setFiltro}
        placeholderTexto="Buscar por razón social o CUIT…"
        controles={[]}
        valores={{}}
        onCambiarValor={() => {}}
        variante="compacta"
        totalBase={organizaciones.length}
        totalVisible={visibles.length}
        hayFiltrosActivos={hayFiltrosActivos}
        onLimpiar={limpiarFiltros}
        etiquetaItem="organizaciones"
        piePastillas={
          <>
            <PastillaGrupo activo={grupoActivo === 'todas'} onClick={() => setGrupoActivo('todas')} label={`Todas (${conteos.todas})`} />
            <PastillaGrupo activo={grupoActivo === 'clientes'} onClick={() => setGrupoActivo('clientes')} label={`Clientes (${conteos.clientes})`} colores={PILLS.cliente} />
            <PastillaGrupo activo={grupoActivo === 'transportes'} onClick={() => setGrupoActivo('transportes')} label={`Transportistas (${conteos.transportes})`} colores={PILLS.transporte} />
            <PastillaGrupo activo={grupoActivo === 'propias'} onClick={() => setGrupoActivo('propias')} label={`Propias (${conteos.propias})`} colores={PILLS.propia} />
            <PastillaGrupo activo={verInactivas} onClick={() => setVerInactivas(v => !v)} label="Mostrar inactivas" colores={PILLS.inactiva} />
          </>
        }
      />

      {cargando && <Vacio titulo="Cargando..." />}

      <PanelLista
        items={visibles}
        vacio={!cargando && <Vacio titulo="No hay organizaciones que coincidan con los filtros." />}
        render={(org, i, esUltima) => (
          <div
            key={org.id}
            style={{ ...styles.fila(esUltima), ...(org.estado !== 'activo' ? styles.filaInactiva : {}) }}
            onClick={() => abrirModal('organizacion', org)}
          >
            <div style={styles.filaPrincipal}>
              <div style={{ minWidth: 180, flex: 2 }}>
                <span style={styles.filaRazon}>{org.razon_social}</span>
                <span style={styles.filaIdentificador}>{org.cuit || 'Sin CUIT'}</span>
              </div>

              {org.es_propia && <Pastilla chico colores={PILLS.propia}>Propia</Pastilla>}
              {org.es_cliente && <Pastilla chico colores={PILLS.cliente}>Cliente</Pastilla>}
              {org.es_transportista && <Pastilla chico colores={PILLS.transporte}>Transportista</Pastilla>}
              {org.estado !== 'activo' && <Pastilla chico colores={PILLS.inactiva}>Inactiva</Pastilla>}

              <span style={styles.filaLocalidad}>{localidadPorOrg.get(org.id) || 'Sin domicilios'}</span>

              <span style={styles.filaAcciones} onClick={e => e.stopPropagation()}>
                <Boton chico variante="secundario" onClick={() => abrirModal('domicilios', org)}>Domicilios</Boton>

                {org.es_transportista && (soyAdmin || soyCoordinador) && (
                  <Boton chico variante="secundario" onClick={() => abrirModal('usuarios', org)}>Usuarios</Boton>
                )}

                {org.es_transportista && (
                  <Boton chico variante="secundario" onClick={() => abrirModal('productos', org)}>
                    Productos ({(org.productos_ids || []).length})
                  </Boton>
                )}
              </span>
            </div>

            {org.es_transportista && (
              <div style={styles.filaProductos}>
                {(org.productos_ids || []).length > 0 ? (
                  org.productos_ids.map(id => {
                    const p = prodsPorId.get(id);
                    return p ? <Pastilla key={id} chico colores={PILLS.producto}>{p.nombre}</Pastilla> : null;
                  })
                ) : (
                  <span style={styles.ayuda}>Sin productos declarados</span>
                )}
              </div>
            )}
          </div>
        )}
      />

      {modalAbierto && modalAbierto.tipo === 'organizacion' && (
        <ModalOrganizacion
          org={modalAbierto.org}
          usuario={usuario}
          puedeElegirBanderas={puedeElegirBanderas}
          puedeElegirTipo={puedeElegirTipo}
          puedeEditarOrg={puedeEditarOrg}
          formVacioPorRol={formVacioPorRol}
          onCerrar={cerrarModal}
          onCambiarModal={({ tipo, org }) => abrirModal(tipo, org)}
        />
      )}

      {modalAbierto && modalAbierto.tipo === 'domicilios' && (
        <ModalDomicilios
          org={modalAbierto.org}
          usuario={usuario}
          soyAdmin={soyAdmin}
          soyComercial={soyComercial}
          onCerrar={cerrarModal}
        />
      )}

      {modalAbierto && modalAbierto.tipo === 'usuarios' && (
        <ModalUsuarios
          org={modalAbierto.org}
          usuario={usuario}
          soyAdmin={soyAdmin}
          onCerrar={cerrarModal}
        />
      )}

      {modalAbierto && modalAbierto.tipo === 'productos' && (
        <ModalProductos
          org={modalAbierto.org}
          productos={productos}
          puedeEditar={puedeEditarOrg(modalAbierto.org)}
          usuario={usuario}
          onCerrar={cerrarModal}
        />
      )}
    </div>
  );
}
