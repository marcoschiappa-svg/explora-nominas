/**
 * =============================================================================
 * Camiones.js — ABM de tractores y acoplados (Portal Explora)
 * =============================================================================
 *
 * PROPÓSITO
 * Las unidades de cada empresa de transporte. Al nominar un despacho se
 * eligen el chofer, el tractor y el acoplado por separado.
 *
 * -----------------------------------------------------------------------------
 * REDISENO -- TRACTOR Y ACOPLADO SON DOS ENTIDADES, NO UNA
 * -----------------------------------------------------------------------------
 *   ANTES: un documento de `camiones` combinaba `patente_tractor` (obligatoria)
 *   y `patente_semi` (opcional) en una sola unidad fija. Nominar un despacho
 *   elegia esa pareja entera -- no se podia combinar un tractor con distintos
 *   acoplados segun el viaje.
 *
 *   AHORA: cada documento es UNA sola unidad -- un tractor O un acoplado,
 *   nunca los dos -- distinguidos por `tipo`. Se combinan libremente al
 *   nominar (ver MisDespachos.js).
 *
 *   POR QUE LA MISMA COLECCION Y NO DOS: separarlas en colecciones distintas
 *   hubiera necesitado reglas de Firestore nuevas para la coleccion nueva.
 *   Con un campo `tipo` en `camiones`, el transportista sigue escribiendo
 *   exactamente donde ya podia escribir -- cero reglas nuevas, mismo
 *   `crear/actualizar/desactivar/reactivar` de `datos.js` de siempre.
 *
 *   MIGRACION DE LO QUE YA HABIA CARGADO: los documentos viejos (con
 *   `patente_tractor` + `patente_semi` combinados) necesitan un script de
 *   migracion aparte que los parta en dos -- no es parte de este archivo.
 *
 *   DOS PESTAÑAS, NO DOS PANTALLAS: "Tractores" y "Acoplados" son dos
 *   secciones de esta misma pantalla (mismo patron que las pestañas de
 *   MisDespachos.js), no dos entradas nuevas en el menu. Si en realidad
 *   hacian falta dos paginas separadas, hay que tocar Home.js/App.js
 *   ademas de esto.
 *
 * -----------------------------------------------------------------------------
 * LAS PATENTES SE CONGELAN EN EL DESPACHO
 * -----------------------------------------------------------------------------
 * Al nominar, las patentes se copian al despacho como `patente_tractor` /
 * `patente_semi` (esos nombres de campo no cambiaron, los sigue leyendo el
 * Apps Script). Si la unidad se rematricula después, los despachos viejos
 * conservan la que llevaba ese día — que es lo correcto para un registro
 * histórico.
 *
 * -----------------------------------------------------------------------------
 * QUIÉN LOS CARGA
 * -----------------------------------------------------------------------------
 * El transportista, sobre su propia organización. `organizacion_id` no se
 * elige: es siempre la de quien lo crea, y no puede cambiar después.
 *
 * El admin también puede, y ahí sí elige la organización — para poder cargar
 * las unidades de una empresa que todavía no entró al portal.
 * ========================================================================== */

import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { crear, actualizar, desactivar, reactivar } from '../datos';
import { esAdmin, tieneRol, miOrganizacion, motivoSinAcceso } from '../sesion';
import { marca, marcaHover, colorEstado, espacio, radio, tipografia } from '../ui/tokens';
import { useTema } from '../ui/TemaContext';
import Boton from '../ui/Boton';
import Tarjeta from '../ui/Tarjeta';
import Pastilla from '../ui/Pastilla';
import Campo from '../ui/Campo';
import Vacio from '../ui/Vacio';

/* -----------------------------------------------------------------------------
 * Patentes
 * -------------------------------------------------------------------------- */

/**
 * Normaliza una patente: mayúsculas, sin espacios ni guiones.
 *
 * "aa 123 aa" y "AA-123-AA" son la misma unidad. Sin esto, la misma patente
 * escrita de dos formas serían dos unidades distintas, que es exactamente el
 * problema que tienen hoy los domicilios.
 */
function normalizarPatente(p) {
  return String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Los dos formatos argentinos vigentes:
 *
 *   ABC123    hasta 2016
 *   AB123CD   Mercosur, desde 2016
 *
 * Se acepta cualquiera de los dos. No se valida contra un padrón —no hay forma
 * desde el navegador— así que esto solo atrapa errores de tipeo groseros.
 */
function patenteValida(p) {
  const limpia = normalizarPatente(p);
  return /^[A-Z]{3}\d{3}$/.test(limpia) || /^[A-Z]{2}\d{3}[A-Z]{2}$/.test(limpia);
}

/** Con guiones, para mostrar: "AB123CD" → "AB 123 CD". */
function mostrarPatente(p) {
  const limpia = normalizarPatente(p);
  if (/^[A-Z]{3}\d{3}$/.test(limpia)) return `${limpia.slice(0, 3)} ${limpia.slice(3)}`;
  if (/^[A-Z]{2}\d{3}[A-Z]{2}$/.test(limpia)) {
    return `${limpia.slice(0, 2)} ${limpia.slice(2, 5)} ${limpia.slice(5)}`;
  }
  return limpia;
}

/** Reemplaza la escala de grises por rojo (protagonista) y azul (acento) --
 * mismo criterio y mismos tonos que Programacion.js y MisDespachos.js. */
function paletaTexto(oscuro) {
  return {
    rojo: oscuro ? colorEstado.peligroBordeAlterno : marcaHover,
    azul: oscuro ? '#93C5FD' : colorEstado.acentoAzul,
  };
}

const SECCIONES = [
  { id: 'tractor', label: 'Tractores', nombreNuevo: 'Nuevo tractor', nombreEntidad: 'tractor' },
  { id: 'acoplado', label: 'Acoplados', nombreNuevo: 'Nuevo acoplado', nombreEntidad: 'acoplado' },
];

const FORM_VACIO = {
  patente: '',
  organizacion_id: '',
  obs: '',
};

/* -----------------------------------------------------------------------------
 * Componente
 * -------------------------------------------------------------------------- */

export default function Camiones({ usuario, onVolver }) {
  const styles = useEstilos();
  const [camiones, setCamiones] = useState([]);
  const [organizaciones, setOrganizaciones] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [seccion, setSeccion] = useState('tractor');
  const [vista, setVista] = useState('lista');
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState(FORM_VACIO);
  const [errores, setErrores] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [filtro, setFiltro] = useState('');
  const [verInactivos, setVerInactivos] = useState(false);

  const soyAdmin = esAdmin(usuario);
  const soyTransportista = tieneRol(usuario, 'transportista');
  const miOrg = miOrganizacion(usuario);
  const sinAcceso = motivoSinAcceso(usuario, ['admin', 'coordinador', 'transportista']);

  /* ── Carga ──────────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (sinAcceso) { setCargando(false); return; }

    // El transportista solo ve los suyos, y la consulta TIENE que venir
    // filtrada: las reglas rechazan la lectura de la colección entera.
    const consulta = soyTransportista && !soyAdmin
      ? query(collection(db, 'camiones'), where('organizacion_id', '==', miOrg))
      : collection(db, 'camiones');

    const unsubCam = onSnapshot(consulta, (snap) => {
      setCamiones(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setCargando(false);
    }, (err) => { console.error('Camiones:', err); setCargando(false); });

    const unsubOrgs = onSnapshot(
      query(collection(db, 'organizaciones'), where('es_transportista', '==', true)),
      (snap) => setOrganizaciones(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      (err) => console.error('Organizaciones:', err)
    );

    return () => { unsubCam(); unsubOrgs(); };
  }, [sinAcceso, soyAdmin, soyTransportista, miOrg]);

  const orgsPorId = useMemo(
    () => new Map(organizaciones.map(o => [o.id, o])),
    [organizaciones]
  );

  // Los que ya vienen del modelo VIEJO (documentos sin `tipo`, todavia no
  // migrados) no entran en ninguna de las dos secciones -- mejor que
  // aparecer mal clasificados en una de las dos. Se cuentan aparte para
  // avisar que falta correr la migracion.
  const sinMigrar = useMemo(() => camiones.filter(c => c.tipo !== 'tractor' && c.tipo !== 'acoplado').length, [camiones]);

  const deLaSeccion = useMemo(() => camiones.filter(c => c.tipo === seccion), [camiones, seccion]);

  const conteos = useMemo(() => {
    const c = {};
    SECCIONES.forEach(s => { c[s.id] = camiones.filter(x => x.tipo === s.id && x.estado === 'activo').length; });
    return c;
  }, [camiones]);

  const visibles = useMemo(() => {
    const texto = normalizarPatente(filtro);
    return deLaSeccion
      .filter(c => verInactivos || c.estado === 'activo')
      .filter(c => !texto || normalizarPatente(c.patente).includes(texto))
      .sort((a, b) => {
        const orgA = (orgsPorId.get(a.organizacion_id) || {}).razon_social || '';
        const orgB = (orgsPorId.get(b.organizacion_id) || {}).razon_social || '';
        if (orgA !== orgB) return orgA.localeCompare(orgB, 'es');
        return (a.patente || '').localeCompare(b.patente || '');
      });
  }, [deLaSeccion, filtro, verInactivos, orgsPorId]);

  const puedeEditar = soyAdmin || soyTransportista;
  const defSeccion = SECCIONES.find(s => s.id === seccion);

  /* ── Acciones ───────────────────────────────────────────────────────────── */

  function abrirAlta() {
    setEditando(null);
    setForm({
      ...FORM_VACIO,
      // El transportista no elige: es su organización, siempre.
      organizacion_id: soyTransportista && !soyAdmin ? miOrg : '',
    });
    setErrores([]);
    setVista('form');
  }

  function abrirEdicion(c) {
    setEditando(c);
    setForm({
      patente: c.patente || '',
      organizacion_id: c.organizacion_id || '',
      obs: c.obs || '',
    });
    setErrores([]);
    setVista('form');
  }

  function validar() {
    const problemas = [];
    const patente = normalizarPatente(form.patente);

    if (!patente) {
      problemas.push(`La patente del ${defSeccion.nombreEntidad} es obligatoria.`);
    } else if (!patenteValida(patente)) {
      problemas.push('La patente no tiene un formato válido. Se espera ABC123 o AB123CD.');
    }

    if (!form.organizacion_id) {
      problemas.push('Elegí la empresa de transporte.');
    }

    // La patente identifica a la unidad dentro de una empresa y un tipo. Dos
    // iguales harían que al nominar no se sepa cuál se está eligiendo.
    if (patente) {
      const repetido = camiones.find(c =>
        c.id !== (editando && editando.id)
        && c.tipo === seccion
        && c.organizacion_id === form.organizacion_id
        && normalizarPatente(c.patente) === patente
      );
      if (repetido) {
        problemas.push(
          repetido.estado === 'activo'
            ? `Esa empresa ya tiene un ${defSeccion.nombreEntidad} con esa patente.`
            : `Esa empresa tiene un ${defSeccion.nombreEntidad} inactivo con esa patente. Reactivalo en vez de crear otro.`
        );
      }
    }

    return problemas;
  }

  async function guardar() {
    const problemas = validar();
    if (problemas.length > 0) { setErrores(problemas); return; }

    setGuardando(true);
    setErrores([]);

    try {
      const patente = normalizarPatente(form.patente);

      const datos = {
        patente,
        obs: form.obs.trim(),
      };

      if (editando) {
        // `organizacion_id` ni `tipo` se mandan: una unidad no cambia de
        // empresa ni de tipo. Si se vendio, se desactiva y se da de alta en
        // la otra; si en realidad es del otro tipo, es un alta nueva.
        await actualizar({
          coleccion: 'camiones',
          id: editando.id,
          cambios: {
            ...datos,
            clave_normalizada: `${editando.organizacion_id}|${editando.tipo}|${patente}`,
          },
          accion: `editar_${defSeccion.nombreEntidad}`,
          entidadTipo: defSeccion.nombreEntidad,
          usuario,
        });
      } else {
        await crear({
          coleccion: 'camiones',
          datos: {
            ...datos,
            tipo: seccion,
            organizacion_id: form.organizacion_id,
            estado: 'activo',
            clave_normalizada: `${form.organizacion_id}|${seccion}|${patente}`,
          },
          accion: `crear_${defSeccion.nombreEntidad}`,
          entidadTipo: defSeccion.nombreEntidad,
          usuario,
        });
      }

      setVista('lista');
    } catch (err) {
      console.error(err);
      setErrores([traducirError(err)]);
    } finally {
      setGuardando(false);
    }
  }

  /**
   * Desactiva una unidad, si no está nominada en un despacho con viaje
   * abierto.
   *
   * A diferencia del chofer, acá bloquea también `NOMINADO`: el despacho ya
   * salió nominado con esta unidad, aunque todavía no haya arrancado. El
   * campo que se consulta depende del tipo -- un tractor se busca por
   * `tractor_id`, un acoplado por `acoplado_id`.
   */
  async function darDeBaja(c) {
    if (!window.confirm(`¿Desactivar el ${defSeccion.nombreEntidad} ${mostrarPatente(c.patente)}?\n\nDeja de aparecer al nominar. Los despachos que ya lo usan no cambian.`)) return;

    setGuardando(true);
    try {
      const campo = c.tipo === 'acoplado' ? 'acoplado_id' : 'tractor_id';
      const q = query(
        collection(db, 'despachos'),
        where(campo, '==', c.id),
        where('estado', '==', 'NOMINADO'),
        limit(1)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        window.alert(`Ese ${defSeccion.nombreEntidad} está nominado en un despacho que todavía no se entregó. Esperá a que cierre el viaje, o cancelá el despacho.`);
        return;
      }

      await desactivar({
        coleccion: 'camiones',
        id: c.id,
        accion: `desactivar_${c.tipo}`,
        usuario,
      });
    } catch (err) {
      console.error(err);
      window.alert(traducirError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function volverAActivar(c) {
    setGuardando(true);
    try {
      await reactivar({ coleccion: 'camiones', id: c.id, usuario });
    } catch (err) {
      console.error(err);
      window.alert(traducirError(err));
    } finally {
      setGuardando(false);
    }
  }

  /* ── Render ─────────────────────────────────────────────────────────────── */

  if (sinAcceso) {
    return <div style={styles.wrap}><div style={styles.bannerError}>{sinAcceso}</div></div>;
  }

  if (vista === 'form') {
    const orgsElegibles = organizaciones
      .filter(o => o.estado === 'activo')
      .sort((a, b) => a.razon_social.localeCompare(b.razon_social, 'es'));

    return (
      <div style={styles.wrap}>
        <div style={styles.panelHeader}>
          <div style={styles.titulo}>
            {editando ? `Editar ${mostrarPatente(editando.patente)}` : defSeccion.nombreNuevo}
          </div>
          <Boton variante="secundario" onClick={() => setVista('lista')}>Cancelar</Boton>
        </div>

        {errores.length > 0 && (
          <div style={styles.bannerError}>
            {errores.map((e, i) => <div key={i}>{e}</div>)}
          </div>
        )}

        <Tarjeta style={{ padding: '1.5rem' }}>
          <div style={styles.grid2}>
            <Campo
              label={`Patente del ${defSeccion.nombreEntidad} *`}
              style={styles.inputPatente}
              value={form.patente}
              onChange={e => setForm({ ...form, patente: e.target.value.toUpperCase() })}
              placeholder="AB123CD"
              maxLength={10}
              autoFocus
              ayuda="ABC123 o AB123CD. Los espacios y guiones se sacan solos."
            />

            {soyAdmin && (
              <Campo
                as="select" label="Empresa de transporte *"
                value={form.organizacion_id}
                disabled={!!editando}
                onChange={e => setForm({ ...form, organizacion_id: e.target.value })}
                ayuda={editando ? 'Una unidad no cambia de empresa. Si se vendió, desactivala y dala de alta en la otra.' : undefined}
              >
                <option value="">Elegir...</option>
                {orgsElegibles.map(o => (
                  <option key={o.id} value={o.id}>{o.razon_social}</option>
                ))}
              </Campo>
            )}
          </div>

          <Campo
            label="Observaciones"
            value={form.obs}
            onChange={e => setForm({ ...form, obs: e.target.value })}
          />

          <div style={styles.cardActions}>
            <Boton disabled={guardando} onClick={guardar}>
              {guardando ? 'Guardando...' : (editando ? 'Guardar cambios' : defSeccion.nombreNuevo)}
            </Boton>
            <Boton variante="secundario" onClick={() => setVista('lista')}>Cancelar</Boton>
          </div>
        </Tarjeta>
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.panelHeader}>
        <div style={styles.titulo}>Flota</div>
        {puedeEditar && (
          <Boton onClick={abrirAlta}>+ {defSeccion.nombreNuevo}</Boton>
        )}
      </div>

      {sinMigrar > 0 && (
        <div style={styles.bannerAviso}>
          Hay {sinMigrar} unidad(es) del modelo viejo (tractor+semi combinados)
          que todavía no se migraron al modelo nuevo -- no aparecen en ninguna
          de las dos secciones de abajo hasta que se corra la migración.
        </div>
      )}

      <div style={styles.solapas}>
        {SECCIONES.map(s => (
          <button
            key={s.id}
            style={{ ...styles.solapa, ...(seccion === s.id ? styles.solapaActiva : {}) }}
            onClick={() => { setSeccion(s.id); setFiltro(''); }}
          >
            {s.label}
            {conteos[s.id] > 0 && <span style={styles.solapaConteo}>{conteos[s.id]}</span>}
          </button>
        ))}
      </div>

      <div style={styles.filtrosGrid}>
        <Campo
          label="Buscar por patente"
          style={styles.filtroInput}
          value={filtro}
          onChange={e => setFiltro(e.target.value.toUpperCase())}
          placeholder="AB123CD"
        />
      </div>

      <div style={styles.filtrosResumen}>
        <span>{visibles.length} {defSeccion.label.toLowerCase()}</span>
        <label style={styles.checkInline}>
          <input
            type="checkbox"
            checked={verInactivos}
            onChange={e => setVerInactivos(e.target.checked)}
          />
          <span>Ver inactivos</span>
        </label>
      </div>

      {cargando && <Vacio titulo="Cargando..." />}
      {!cargando && visibles.length === 0 && (
        <Vacio
          titulo={`No hay ${defSeccion.label.toLowerCase()} cargados.`}
          nota={puedeEditar ? 'Agregá uno para poder nominar despachos.' : undefined}
        />
      )}

      {visibles.map(c => {
        const org = orgsPorId.get(c.organizacion_id);
        return (
          <Tarjeta key={c.id} style={{ marginBottom: espacio.sm, padding: '10px 14px' }}>
            <div style={styles.cardRow}>
              <span style={styles.rowPatente}>{mostrarPatente(c.patente)}</span>

              {c.estado !== 'activo' && (
                <Pastilla chico colores={{ bg: colorEstado.peligroFondo, color: colorEstado.peligroTexto }}>Inactivo</Pastilla>
              )}

              <span style={styles.rowOrg}>{org ? org.razon_social : '—'}</span>

              {puedeEditar && (
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <Boton chico variante="secundario" onClick={() => abrirEdicion(c)}>
                    Editar
                  </Boton>
                  {c.estado === 'activo' ? (
                    <Boton chico variante="peligro" disabled={guardando} onClick={() => darDeBaja(c)}>
                      Desactivar
                    </Boton>
                  ) : (
                    <Boton chico variante="secundario" disabled={guardando} onClick={() => volverAActivar(c)}>
                      Reactivar
                    </Boton>
                  )}
                </span>
              )}
            </div>
          </Tarjeta>
        );
      })}
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Auxiliares
 * -------------------------------------------------------------------------- */

function traducirError(err) {
  if (err && err.code === 'permission-denied') {
    return 'Firestore rechazó la escritura. Un transportista solo puede cargar '
         + 'unidades de su propia empresa. Revisá la consola del navegador.';
  }
  if (err && err.code === 'failed-precondition') {
    return 'Falta un índice en Firestore. En la consola del navegador hay un '
         + 'link para crearlo con un clic.';
  }
  return (err && err.message) || 'Error desconocido.';
}

/* -----------------------------------------------------------------------------
 * Estilos -- crearEstilos(colores, oscuro) + useEstilos(), mismo patron que
 * Pedidos.js/Programacion.js/MisDespachos.js.
 * -------------------------------------------------------------------------- */

function crearEstilos(colores, oscuro) {
  const pal = paletaTexto(oscuro);

  return {
    wrap: { maxWidth: 900, margin: '0 auto', padding: '1.5rem 1rem', background: colores.fondo, color: colores.texto },
    panelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' },
    titulo: { fontSize: 18, fontWeight: 500, color: colores.texto },

    bannerAviso: { padding: '10px 14px', borderRadius: 8, background: colorEstado.advertenciaFondo, border: `0.5px solid ${colorEstado.advertenciaBorde}`, fontSize: 12, color: colorEstado.advertenciaTexto, marginBottom: 12, lineHeight: 1.4 },

    solapas: { display: 'flex', gap: 4, marginBottom: 14, borderBottom: `0.5px solid ${colores.borde}`, flexWrap: 'wrap' },
    solapa: {
      display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: 'none', background: 'none',
      color: pal.azul, fontSize: 13, cursor: 'pointer', borderBottom: '2px solid transparent',
      fontFamily: tipografia.familia,
    },
    solapaActiva: { color: marca, borderBottomColor: marca, fontWeight: tipografia.peso.negrita },
    solapaConteo: { fontSize: 11, padding: '1px 7px', borderRadius: radio.pastilla, background: colores.fondoAlterno, color: pal.azul },

    filtrosGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 10 },
    filtroInput: { fontFamily: 'monospace' },
    filtrosResumen: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: pal.azul, marginBottom: 10 },
    checkInline: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: pal.azul, cursor: 'pointer' },

    cardRow: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
    cardActions: { display: 'flex', gap: 8, marginTop: 12 },
    rowPatente: { fontSize: 14, fontWeight: tipografia.peso.medio, color: colores.texto, fontFamily: 'monospace', letterSpacing: '0.05em', flexShrink: 0 },
    rowOrg: { fontSize: 12, color: pal.rojo, flex: 1, minWidth: 100 },

    grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 },
    inputPatente: { fontFamily: 'monospace', letterSpacing: '0.1em', textTransform: 'uppercase' },

    bannerError: { padding: '10px 14px', borderRadius: 8, background: colorEstado.peligroFondo, border: `0.5px solid ${colorEstado.peligroBordeAlterno}`, fontSize: 13, color: colorEstado.peligroTexto, marginBottom: 12, whiteSpace: 'pre-line' },
  };
}

function useEstilos() {
  const { colores, oscuro } = useTema();
  return useMemo(() => crearEstilos(colores, oscuro), [colores, oscuro]);
}
