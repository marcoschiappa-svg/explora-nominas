/**
 * =============================================================================
 * Organizaciones.js — ABM de clientes y transportes (Portal Explora)
 * =============================================================================
 *
 * PROPÓSITO
 * Alta, edición y baja de las empresas con las que opera Explora: los clientes
 * que compran, los transportes que llevan, y la propia Explora.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ UNA SOLA COLECCIÓN Y NO DOS
 * -----------------------------------------------------------------------------
 * Hoy hay `transportistas_portal` con las empresas de transporte, y aparte
 * usuarios con `rol: 'transportista'`. Las dos se relacionan por el string
 * `empresa` — y los strings no coinciden: la ficha de empresa dice `"RAD"` y el
 * chofer dice `"Transporte RAD"`.
 *
 * Eso no es cosmético. `nominar()` compara los dos con `!==` para verificar que
 * el chofer sea del transporte asignado, así que **rechaza nominaciones
 * válidas** con un mensaje que no tiene sentido para quien la está haciendo.
 *
 * Acá hay una sola colección y dos banderas. El vínculo pasa a ser
 * `organizacion_id`, un ID, y la comparación deja de ser entre textos.
 *
 * -----------------------------------------------------------------------------
 * CLIENTE Y TRANSPORTE A LA VEZ
 * -----------------------------------------------------------------------------
 * Una empresa puede ser las dos cosas: el cliente que pone su propio camión para
 * llevarse el producto. Hoy no pasa, pero con colecciones separadas esa empresa
 * estaría cargada dos veces sin que nada indique que es la misma.
 *
 * El comercial NO elige las banderas: siempre crea clientes. Solo el admin ve la
 * pregunta y puede marcar las dos.
 *
 * -----------------------------------------------------------------------------
 * NADA SE BORRA
 * -----------------------------------------------------------------------------
 * Se desactiva. Borrar dejaría pedidos, despachos e historial apuntando a
 * documentos inexistentes — y Firestore no valida referencias: no fallaría,
 * simplemente quedarían huecos.
 *
 * Una organización inactiva no aparece en los selectores y sigue visible en todo
 * lo histórico.
 *
 * -----------------------------------------------------------------------------
 * REDISEÑO -- CORREO Y TELÉFONO, MIGRACIÓN A B1
 * -----------------------------------------------------------------------------
 *   CORREO Y TELÉFONO: no se pedían -- no había una razón de fondo, quedaron
 *   afuera sin que nadie lo decidiera. Se agregan como dos campos simples
 *   (`email`, `telefono`), sin condicionar por `es_cliente`/`es_transportista`:
 *   aplican igual para los dos, y por ahora es lo único que se pide más allá
 *   de razón social/nombre corto/CUIT. Quedan como valores únicos, no arrays
 *   -- si más adelante hace falta más de un contacto por organización, ese
 *   es el momento de revisar la forma, no ahora.
 *
 *   OJO: esto es el contacto de la EMPRESA, no de una persona -- no
 *   contradice la decisión ya tomada de que el teléfono de un chofer vive en
 *   `usuarios`, no en la organización. Son dos cosas distintas: el teléfono
 *   de la empresa para contactarla en general, y el de cada persona.
 *
 *   B1: `crearEstilos(colores, oscuro)` + `useEstilos()`, componentes de
 *   `ui/` (Boton, Tarjeta, Pastilla, Campo, Vacio), sin Topbar propio
 *   (BarraSuperior ya cubre logo/volver), paleta rojo/azul en vez de gris --
 *   mismo patrón que el resto de las pantallas migradas.
 * ========================================================================== */

import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { crear, actualizar, desactivar, reactivar } from '../datos';
import { esComercial, esAdmin, motivoSinAcceso } from '../sesion';
// `mapa-normalizacion.js` es CommonJS porque los scripts de Node lo necesitan
// así. Webpack resuelve la interoperabilidad: el import con nombres funciona.
import { claveNormalizada, normalizarCuit } from '../mapa-normalizacion';
import Domicilios from './Domicilios';
import { marca, colorEstado, espacio, radio, tipografia, paletaTexto } from '../ui/tokens';
import { useTema } from '../ui/TemaContext';
import Boton from '../ui/Boton';
import Tarjeta from '../ui/Tarjeta';
import Pastilla from '../ui/Pastilla';
import Campo from '../ui/Campo';
import Vacio from '../ui/Vacio';

/* -----------------------------------------------------------------------------
 * Validación
 * -------------------------------------------------------------------------- */

/**
 * Valida el formulario. Devuelve un array de mensajes; vacío si está bien.
 *
 * El CUIT es opcional —hoy ninguna organización lo tiene cargado— pero si se
 * carga tiene que tener 11 dígitos. `normalizarCuit` los extrae ignorando
 * guiones y espacios: en la base de hoy conviven `"20-25505747-3"`,
 * `"20438430122"` y uno que arranca con un espacio.
 *
 * El correo tampoco es obligatorio, pero si se carga tiene que tener al menos
 * la forma de un email -- sin esto, un typo queda invisible hasta que alguien
 * intenta escribirle y rebota.
 */
function validarFormulario(form) {
  const errores = [];

  if (!form.razon_social.trim()) {
    errores.push('La razón social es obligatoria.');
  }
  if (!form.es_cliente && !form.es_transportista) {
    errores.push('Marcá al menos una: cliente o transporte.');
  }
  if (form.cuit.trim() && !normalizarCuit(form.cuit)) {
    errores.push('El CUIT tiene que tener 11 dígitos.');
  }
  if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    errores.push('El correo no parece válido.');
  }

  return errores;
}

/* -----------------------------------------------------------------------------
 * Componente
 * -------------------------------------------------------------------------- */

const FORM_VACIO = {
  razon_social: '',
  nombre_corto: '',
  cuit: '',
  email: '',
  telefono: '',
  es_cliente: true,
  es_transportista: false,
  obs: '',
};

export default function Organizaciones({ usuario, onVolver }) {
  const styles = useEstilos();
  const [organizaciones, setOrganizaciones] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [vista, setVista] = useState('lista');     // lista | form
  const [editando, setEditando] = useState(null);  // el documento, o null si es alta
  const [form, setForm] = useState(FORM_VACIO);
  const [errores, setErrores] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [filtro, setFiltro] = useState('');
  const [verInactivas, setVerInactivas] = useState(false);
  const [tipoFiltro, setTipoFiltro] = useState('todas'); // todas | clientes | transportes
  const [viendoDomicilios, setViendoDomicilios] = useState(null);

  const puedeEditar = esComercial(usuario);
  const puedeElegirBanderas = esAdmin(usuario);
  const sinAcceso = motivoSinAcceso(usuario, ['admin', 'comercial']);

  /* ── Carga ──────────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (sinAcceso) { setCargando(false); return; }

    const unsub = onSnapshot(
      collection(db, 'organizaciones'),
      (snap) => {
        setOrganizaciones(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setCargando(false);
      },
      (err) => {
        console.error('Organizaciones:', err);
        setCargando(false);
      }
    );
    return () => unsub();
  }, [sinAcceso]);

  const visibles = useMemo(() => {
    const texto = claveNormalizada(filtro);
    return organizaciones
      .filter(o => verInactivas || o.estado === 'activo')
      .filter(o => {
        if (tipoFiltro === 'clientes') return o.es_cliente;
        if (tipoFiltro === 'transportes') return o.es_transportista;
        return true;
      })
      .filter(o => !texto || claveNormalizada(o.razon_social).includes(texto))
      .sort((a, b) => a.razon_social.localeCompare(b.razon_social, 'es'));
  }, [organizaciones, filtro, verInactivas, tipoFiltro]);

  /* ── Acciones ───────────────────────────────────────────────────────────── */

  function abrirAlta() {
    setEditando(null);
    setForm(FORM_VACIO);
    setErrores([]);
    setVista('form');
  }

  function abrirEdicion(org) {
    setEditando(org);
    setForm({
      razon_social: org.razon_social || '',
      nombre_corto: org.nombre_corto || '',
      cuit: org.cuit || '',
      email: org.email || '',
      telefono: org.telefono || '',
      es_cliente: !!org.es_cliente,
      es_transportista: !!org.es_transportista,
      obs: org.obs || '',
    });
    setErrores([]);
    setVista('form');
  }

  /**
   * Busca si ya existe otra organización con la misma clave normalizada.
   *
   * Se consulta contra Firestore y no contra el estado local: entre que se
   * cargó la lista y se aprieta guardar, otro usuario pudo haber creado la
   * misma. No es una garantía —dos altas simultáneas se cuelan igual— pero
   * atrapa el caso frecuente, que es cargar un cliente que ya estaba con otra
   * mayúscula.
   */
  async function buscarDuplicado(clave, idPropio) {
    const q = query(
      collection(db, 'organizaciones'),
      where('clave_normalizada', '==', clave),
      limit(2)
    );
    const snap = await getDocs(q);
    return snap.docs.find(d => d.id !== idPropio) || null;
  }

  async function guardar() {
    const problemas = validarFormulario(form);
    if (problemas.length > 0) { setErrores(problemas); return; }

    setGuardando(true);
    setErrores([]);

    try {
      const razon = form.razon_social.trim();
      const clave = claveNormalizada(razon);

      const duplicado = await buscarDuplicado(clave, editando ? editando.id : null);
      if (duplicado) {
        setErrores([`Ya existe una organización con ese nombre: "${duplicado.razon_social}".`]);
        setGuardando(false);
        return;
      }

      const datos = {
        razon_social: razon,
        nombre_corto: form.nombre_corto.trim() || razon,
        cuit: form.cuit.trim() ? normalizarCuit(form.cuit) : null,
        email: form.email.trim() || null,
        telefono: form.telefono.trim() || null,
        obs: form.obs.trim(),
        clave_normalizada: clave,
        // Solo el admin elige las banderas. El comercial siempre crea clientes:
        // es lo que hace el 100% de las veces, y preguntárselo sería ofrecerle
        // una decisión que no le corresponde.
        es_cliente: puedeElegirBanderas ? form.es_cliente : true,
        es_transportista: puedeElegirBanderas ? form.es_transportista : false,
      };

      if (editando) {
        // `es_propia` no se manda nunca: Explora es Explora, y las reglas
        // rechazan la escritura si aparece en los campos modificados.
        await actualizar({
          coleccion: 'organizaciones',
          id: editando.id,
          cambios: datos,
          accion: 'editar_organizacion',
          entidadTipo: 'organizacion',
          usuario,
        });
      } else {
        await crear({
          coleccion: 'organizaciones',
          datos: { ...datos, estado: 'activo', es_propia: false },
          accion: 'crear_organizacion',
          entidadTipo: 'organizacion',
          usuario,
        });
      }

      setVista('lista');
      setEditando(null);
      setForm(FORM_VACIO);
    } catch (err) {
      console.error(err);
      setErrores([traducirError(err)]);
    } finally {
      setGuardando(false);
    }
  }

  /**
   * Desactiva una organización, si no tiene nada vivo colgando.
   *
   * La verificación no la puede hacer una regla de Firestore: exigiría contar
   * documentos de otra colección, y las reglas no consultan. Se hace acá, con
   * la limitación conocida — entre la consulta y la escritura alguien podría
   * crear un pedido. Es un riesgo aceptable para una baja, que es una acción
   * deliberada y poco frecuente.
   */
  async function darDeBaja(org) {
    const motivo = window.prompt(`¿Por qué se da de baja a ${org.razon_social}?`);
    if (motivo === null) return;
    if (!motivo.trim()) { window.alert('El motivo es obligatorio.'); return; }

    setGuardando(true);
    try {
      const bloqueo = await buscarDependenciasVivas(org);
      if (bloqueo) { window.alert(bloqueo); return; }

      await desactivar({
        coleccion: 'organizaciones',
        id: org.id,
        accion: 'desactivar_organizacion',
        usuario,
        razon: motivo.trim(),
      });
    } catch (err) {
      console.error(err);
      window.alert(traducirError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function volverAActivar(org) {
    setGuardando(true);
    try {
      await reactivar({ coleccion: 'organizaciones', id: org.id, usuario });
    } catch (err) {
      console.error(err);
      window.alert(traducirError(err));
    } finally {
      setGuardando(false);
    }
  }

  if (sinAcceso) {
    return <div style={styles.wrap}><div style={styles.bannerError}>{sinAcceso}</div></div>;
  }

  // Los domicilios se gestionan desde la ficha de cada organización: el caso
  // real es "este cliente entrega acá", no "esta dirección la usan varios". De
  // los 34 domicilios relevados, ninguno tiene dos organizaciones.
  if (viendoDomicilios) {
    return (
      <Domicilios
        usuario={usuario}
        organizacion={viendoDomicilios}
        onVolver={() => setViendoDomicilios(null)}
      />
    );
  }

  /* ── Formulario ─────────────────────────────────────────────────────────── */

  if (vista === 'form') {
    return (
      <div style={styles.wrap}>
        <div style={styles.panelHeader}>
          <div style={styles.titulo}>
            {editando ? `Editar ${editando.razon_social}` : 'Nueva organización'}
          </div>
          <Boton variante="secundario" onClick={() => setVista('lista')}>Cancelar</Boton>
        </div>

        {editando && editando.es_propia && (
          <div style={styles.editandoBanner}>
            Esta es la organización propia de Explora. Su razón social y sus
            domicilios se usan como origen o destino de todos los pedidos.
          </div>
        )}

        {errores.length > 0 && (
          <div style={styles.bannerError}>
            {errores.map((e, i) => <div key={i}>{e}</div>)}
          </div>
        )}

        <Tarjeta style={{ padding: '1.5rem' }}>
          <div style={styles.grid2}>
            <Campo
              label="Razón social *"
              value={form.razon_social}
              onChange={e => setForm({ ...form, razon_social: e.target.value })}
              placeholder="PAN AMERICAN ENERGY"
            />

            <Campo
              label="Nombre corto"
              value={form.nombre_corto}
              onChange={e => setForm({ ...form, nombre_corto: e.target.value })}
              placeholder="PAE"
              ayuda="Para mostrar en listados. Si se deja vacío, se usa la razón social."
            />

            <Campo
              label="CUIT"
              value={form.cuit}
              onChange={e => setForm({ ...form, cuit: e.target.value })}
              placeholder="30-60561644-1"
              ayuda="Con o sin guiones. Se guarda normalizado."
            />

            <Campo
              label="Correo"
              type="email"
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              placeholder="contacto@empresa.com"
            />

            <Campo
              label="Teléfono"
              value={form.telefono}
              onChange={e => setForm({ ...form, telefono: e.target.value })}
              placeholder="(0341) 456-7890"
            />
          </div>

          {puedeElegirBanderas && (
            <div style={styles.seccion}>
              <div style={styles.seccionTitulo}>Qué es</div>
              <label style={styles.check}>
                <input
                  type="checkbox"
                  checked={form.es_cliente}
                  onChange={e => setForm({ ...form, es_cliente: e.target.checked })}
                />
                <span>Cliente — se le cargan pedidos</span>
              </label>
              <label style={styles.check}>
                <input
                  type="checkbox"
                  checked={form.es_transportista}
                  onChange={e => setForm({ ...form, es_transportista: e.target.checked })}
                />
                <span>Transporte — se le asignan despachos</span>
              </label>
              <div style={styles.ayuda}>
                Puede ser las dos cosas: un cliente que pone su propio camión
                para llevarse el producto.
              </div>
            </div>
          )}

          <Campo
            as="textarea" label="Observaciones"
            style={{ minHeight: 60, resize: 'vertical' }}
            value={form.obs}
            onChange={e => setForm({ ...form, obs: e.target.value })}
          />

          <div style={{ ...styles.cardActions, marginTop: 16 }}>
            <Boton disabled={guardando} onClick={guardar}>
              {guardando ? 'Guardando...' : (editando ? 'Guardar cambios' : 'Crear organización')}
            </Boton>
            <Boton variante="secundario" onClick={() => setVista('lista')}>
              Cancelar
            </Boton>
          </div>
        </Tarjeta>
      </div>
    );
  }

  /* ── Lista ──────────────────────────────────────────────────────────────── */

  return (
    <div style={styles.wrap}>
      <div style={styles.panelHeader}>
        <div style={styles.titulo}>Organizaciones</div>
        {puedeEditar && (
          <Boton onClick={abrirAlta}>+ Nueva</Boton>
        )}
      </div>

      <div style={styles.filtrosGrid}>
        <Campo
          label="Buscar"
          value={filtro}
          onChange={e => setFiltro(e.target.value)}
          placeholder="Razón social"
        />
        <Campo
          as="select" label="Tipo"
          value={tipoFiltro}
          onChange={e => setTipoFiltro(e.target.value)}
        >
          <option value="todas">Todas</option>
          <option value="clientes">Clientes</option>
          <option value="transportes">Transportes</option>
        </Campo>
      </div>

      <div style={styles.filtrosResumen}>
        <span>{visibles.length} organización(es)</span>
        <label style={styles.check}>
          <input
            type="checkbox"
            checked={verInactivas}
            onChange={e => setVerInactivas(e.target.checked)}
          />
          <span>Ver inactivas</span>
        </label>
      </div>

      {cargando && <Vacio titulo="Cargando..." />}
      {!cargando && visibles.length === 0 && <Vacio titulo="No hay organizaciones que coincidan." />}

      {visibles.map(org => (
        <Tarjeta key={org.id} style={{ marginBottom: espacio.sm, padding: '10px 14px' }}>
          <div style={styles.cardRow}>
            <span style={styles.rowCliente}>
              {org.razon_social}
              {org.nombre_corto && org.nombre_corto !== org.razon_social && (
                <span style={styles.rowCorto}> · {org.nombre_corto}</span>
              )}
            </span>

            {org.es_propia && <Pastilla chico colores={PILLS.propia}>Explora</Pastilla>}
            {org.es_cliente && <Pastilla chico colores={PILLS.cliente}>Cliente</Pastilla>}
            {org.es_transportista && <Pastilla chico colores={PILLS.transporte}>Transporte</Pastilla>}
            {org.estado !== 'activo' && <Pastilla chico colores={PILLS.inactiva}>Inactiva</Pastilla>}

            <span style={styles.rowNro}>{org.cuit || '—'}</span>

            {puedeEditar && (
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <Boton chico variante="secundario" onClick={() => setViendoDomicilios(org)}>
                  Domicilios
                </Boton>
                <Boton chico variante="secundario" onClick={() => abrirEdicion(org)}>
                  Editar
                </Boton>
                {org.estado === 'activo' ? (
                  !org.es_propia && (
                    <Boton chico variante="peligro" disabled={guardando} onClick={() => darDeBaja(org)}>
                      Dar de baja
                    </Boton>
                  )
                ) : (
                  <Boton chico variante="secundario" disabled={guardando} onClick={() => volverAActivar(org)}>
                    Reactivar
                  </Boton>
                )}
              </span>
            )}
          </div>
        </Tarjeta>
      ))}
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Auxiliares
 * -------------------------------------------------------------------------- */

/**
 * Verifica que no quede nada vivo colgando de la organización antes de darla de
 * baja. Devuelve un mensaje si hay bloqueo, o null.
 *
 * Se consultan solo las colecciones del modelo nuevo. Los pedidos viejos de
 * `pedidos_portal` no cuentan: no referencian organizaciones, guardan el nombre
 * del cliente como texto.
 */
async function buscarDependenciasVivas(org) {
  if (org.es_cliente) {
    const q = query(
      collection(db, 'pedidos'),
      where('cliente_org_id', '==', org.id),
      where('estado', 'in', ['pendiente', 'programado_parcial', 'programado']),
      limit(1)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      return `${org.razon_social} tiene pedidos sin cumplir. Cerralos o suspendelos antes de darla de baja.`;
    }
  }

  if (org.es_transportista) {
    const q = query(
      collection(db, 'despachos'),
      where('transportista_org_id', '==', org.id),
      where('estado', 'in', ['ASIGNADO', 'ACEPTADO', 'NOMINADO']),
      limit(1)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      return `${org.razon_social} tiene despachos en curso. Cancelalos antes de darla de baja.`;
    }
  }

  return null;
}

/**
 * Traduce los errores de Firestore a algo que se entienda.
 *
 * `permission-denied` es el que más aparece y el que menos dice: puede ser que
 * el usuario no tenga el rol, que el documento nuevo de `usuarios` no exista, o
 * que la escritura toque un campo que las reglas no permiten.
 */
function traducirError(err) {
  if (err && err.code === 'permission-denied') {
    return 'Firestore rechazó la escritura. Puede ser que tu usuario no tenga '
         + 'permiso, o que falte su documento en el modelo nuevo. '
         + 'Revisá la consola del navegador para el detalle.';
  }
  return (err && err.message) || 'Error desconocido.';
}

/* -----------------------------------------------------------------------------
 * Colores de dominio -- fijos en los dos temas, mismo criterio que
 * COLOR_PEDIDO/PILLS de Usuarios.js. "Inactiva" usa el mismo rojo tenue que
 * "Inactivo" en Usuarios.js/Camiones.js, no gris -- consistencia entre
 * pantallas para el mismo significado.
 * -------------------------------------------------------------------------- */

const PILLS = {
  propia:     { bg: '#EEEDFE', color: colorEstado.acentoPurpura },
  cliente:    { bg: colorEstado.exitoFondo, color: colorEstado.exitoTexto },
  transporte: { bg: colorEstado.advertenciaFondoAlterno, color: colorEstado.advertenciaTextoFuerte },
  inactiva:   { bg: colorEstado.peligroFondo, color: colorEstado.peligroTexto },
};

/* -----------------------------------------------------------------------------
 * Estilos -- crearEstilos(colores, oscuro) + useEstilos(), mismo patrón que
 * el resto de las pantallas migradas.
 * -------------------------------------------------------------------------- */

function crearEstilos(colores, oscuro) {
  const pal = paletaTexto(oscuro);

  return {
    wrap: { maxWidth: 900, margin: '0 auto', padding: '1.5rem 1rem', background: colores.fondo, color: colores.texto },
    panelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' },
    titulo: { fontSize: 18, fontWeight: 500, color: colores.texto },

    filtrosGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 10 },
    filtrosResumen: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: pal.azul, marginBottom: 10 },

    cardRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    cardActions: { display: 'flex', gap: 8 },
    rowCliente: { fontSize: 13, fontWeight: tipografia.peso.medio, color: colores.texto, flex: 2, minWidth: 140 },
    rowCorto: { fontSize: 12, color: pal.azul, fontWeight: tipografia.peso.normal },
    rowNro: { fontSize: 11, color: pal.azul, fontFamily: 'monospace', flexShrink: 0 },

    grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 },
    ayuda: { fontSize: 11, color: pal.azul, lineHeight: 1.4 },
    check: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: colores.texto, marginBottom: 6, cursor: 'pointer' },
    seccion: { marginBottom: '1.5rem' },
    seccionTitulo: { fontSize: 12, fontWeight: tipografia.peso.medio, color: pal.azul, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, paddingBottom: 6, borderBottom: `0.5px solid ${colores.borde}` },

    editandoBanner: { padding: '10px 14px', borderRadius: 8, background: colorEstado.advertenciaFondo, border: `0.5px solid ${colorEstado.advertenciaBorde}`, fontSize: 13, color: colorEstado.advertenciaTexto, marginBottom: 16 },
    bannerError: { padding: '10px 14px', borderRadius: 8, background: colorEstado.peligroFondo, border: `0.5px solid ${colorEstado.peligroBordeAlterno}`, fontSize: 13, color: colorEstado.peligroTexto, marginBottom: 12, whiteSpace: 'pre-line' },
  };
}

function useEstilos() {
  const { colores, oscuro } = useTema();
  return useMemo(() => crearEstilos(colores, oscuro), [colores, oscuro]);
}
