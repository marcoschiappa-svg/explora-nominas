/**
 * =============================================================================
 * Usuarios.js — ABM de usuarios (Portal Explora)
 * =============================================================================
 *
 * PROPÓSITO
 * Dar de alta, editar y desactivar a las personas que usan el sistema.
 *
 * -----------------------------------------------------------------------------
 * QUIÉN PUEDE CREAR A QUIÉN
 * -----------------------------------------------------------------------------
 *   ADMIN            cualquier rol, cualquier organización
 *   TRANSPORTISTA    solo choferes, solo de SU organización
 *
 * El transportista todavía no tiene la pantalla propia, pero el modelo y las
 * reglas ya lo contemplan: cuando se haga, no hay que rehacer nada. Esta misma
 * pantalla le sirve, filtrada.
 *
 * -----------------------------------------------------------------------------
 * EL DNI ES INMUTABLE
 * -----------------------------------------------------------------------------
 * Es la identidad de la persona. La app y la pantalla del chofer filtran los
 * viajes por DNI, y el email de login se deriva de él. Si está mal cargado, se
 * desactiva el usuario y se crea de nuevo.
 *
 * -----------------------------------------------------------------------------
 * NADA SE BORRA, Y LA BAJA TIENE CONDICIONES
 * -----------------------------------------------------------------------------
 * Se desactiva. Un chofer inactivo no aparece al nominar, un transportista
 * inactivo no aparece al asignar, y ninguno de los dos puede entrar — el login
 * verifica el estado. Pero los despachos y viajes históricos lo siguen
 * referenciando.
 *
 * No se puede desactivar a un chofer con un viaje EN_VIAJE: el camión está en
 * la ruta, y sacarle el acceso lo dejaría sin poder cerrarlo.
 *
 * -----------------------------------------------------------------------------
 * LA CONTRASEÑA SE MUESTRA UNA SOLA VEZ
 * -----------------------------------------------------------------------------
 * No se guarda en ningún lado. Hoy `usuarios_portal` tiene `password_visible`
 * con la clave en texto plano, en una colección que cualquier autenticado puede
 * leer, choferes incluidos.
 *
 * -----------------------------------------------------------------------------
 * REDISENO -- MIGRACION A B1
 * -----------------------------------------------------------------------------
 *   Mismo patron que Pedidos.js/Programacion.js/MisDespachos.js/Camiones.js:
 *   `styles` pasa a `crearEstilos(colores, oscuro)` + `useEstilos()`, se usan
 *   los componentes de `ui/` (Boton, Tarjeta, Pastilla, Campo, Vacio) en vez
 *   de elementos crudos con estilos a mano, y se saca el Topbar propio
 *   (BarraSuperior ya cubre logo + volver).
 *
 *   `paletaTexto` (rojo/azul en vez de gris) ya no se duplica localmente --
 *   esta es la cuarta pantalla que la necesita, asi que se subio a
 *   tokens.js. Los otros tres archivos siguen con su copia local por ahora;
 *   es un candidato facil a limpiar despues, no urgente.
 *
 *   Ninguna funcion de negocio cambio (validar, guardar, crearInvitacion,
 *   crearUsuarioNuevo, darDeBaja, volverAActivar) -- solo la presentacion.
 * ========================================================================== */

import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, where, getDocs, limit, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { crear, actualizar, desactivar, reactivar } from '../datos';
import { esAdmin, tieneRol, miOrganizacion, motivoSinAcceso } from '../sesion';
import { claveNormalizada, normalizarCuit } from '../mapa-normalizacion';
import {
  crearCuenta,
  deshacerCuenta,
  generarClave,
  emailDeChofer,
  traducirErrorAuth,
} from '../alta-usuarios';
import { marca, colorEstado, espacio, radio, tipografia, paletaTexto } from '../ui/tokens';
import { useTema } from '../ui/TemaContext';
import Boton from '../ui/Boton';
import Tarjeta from '../ui/Tarjeta';
import Pastilla from '../ui/Pastilla';
import Campo from '../ui/Campo';
import Vacio from '../ui/Vacio';

/* -----------------------------------------------------------------------------
 * Constantes
 * -------------------------------------------------------------------------- */

const ROLES = [
  { id: 'admin',         label: 'Administrador', interno: true  },
  { id: 'coordinador',   label: 'Coordinador',   interno: true  },
  { id: 'comercial',     label: 'Comercial',     interno: true  },
  { id: 'transportista', label: 'Transportista', interno: false },
  { id: 'chofer',        label: 'Chofer',        interno: false },
];

const ROLES_INTERNOS = ROLES.filter(r => r.interno).map(r => r.id);

// Colores de dominio (uno por rol) -- fijos en los dos temas, mismo criterio
// que COLOR_PEDIDO/COLOR_DESPACHO en estados.js: no es una decision de
// diseño claro/oscuro, es "que significa este rol".
const PILLS = {
  admin:         { bg: '#F3F4F6', color: '#374151' },
  coordinador:   { bg: colorEstado.exitoFondo, color: colorEstado.exitoTexto },
  comercial:     { bg: colorEstado.peligroFondoAlterno, color: colorEstado.peligroTextoFuerte },
  transportista: { bg: colorEstado.advertenciaFondoAlterno, color: colorEstado.advertenciaTextoFuerte },
  chofer:        { bg: '#EEEDFE', color: colorEstado.acentoPurpura },
  otro:          { bg: '#F3F4F6', color: '#6B7280' },
};

const FORM_VACIO = {
  nombre: '',
  email: '',
  roles: ['chofer'],
  organizacion_id: '',
  telefono: '',
  dni: '',
  cuit: '',
};

/* -----------------------------------------------------------------------------
 * Componente
 * -------------------------------------------------------------------------- */

export default function Usuarios({ usuario, onVolver }) {
  const styles = useEstilos();
  const [usuarios, setUsuarios] = useState([]);
  const [organizaciones, setOrganizaciones] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [vista, setVista] = useState('lista');
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState(FORM_VACIO);
  const [errores, setErrores] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [claveGenerada, setClaveGenerada] = useState(null);
  const [invitaciones, setInvitaciones] = useState([]);
  const [invitacionCreada, setInvitacionCreada] = useState(null);
  const [filtro, setFiltro] = useState('');
  const [rolFiltro, setRolFiltro] = useState('todos');
  const [verInactivos, setVerInactivos] = useState(false);

  const soyAdmin = esAdmin(usuario);
  const soyTransportista = tieneRol(usuario, 'transportista');
  const miOrg = miOrganizacion(usuario);
  const sinAcceso = motivoSinAcceso(usuario, ['admin', 'transportista']);

  /* ── Carga ──────────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (sinAcceso) { setCargando(false); return; }

    // El transportista solo ve los suyos, y la consulta TIENE que venir
    // filtrada: las reglas rechazan la lectura de la colección entera.
    const consulta = soyAdmin
      ? collection(db, 'usuarios')
      : query(collection(db, 'usuarios'), where('organizacion_id', '==', miOrg));

    const unsubUsuarios = onSnapshot(consulta, (snap) => {
      setUsuarios(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setCargando(false);
    }, (err) => { console.error('Usuarios:', err); setCargando(false); });

    const unsubOrgs = onSnapshot(collection(db, 'organizaciones'), (snap) => {
      setOrganizaciones(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error('Organizaciones:', err));

    // Solo el admin invita —el transportista da de alta choferes, que nunca
    // pasan por invitación—, y las reglas solo dejan leer la colección
    // entera a un interno. `soyAdmin` alcanza: el único rol interno que entra
    // a esta pantalla es admin (`sinAcceso` ya filtró el resto).
    let unsubInvitaciones = () => {};
    if (soyAdmin) {
      unsubInvitaciones = onSnapshot(collection(db, 'invitaciones'), (snap) => {
        setInvitaciones(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }, (err) => console.error('Invitaciones:', err));
    }

    return () => { unsubUsuarios(); unsubOrgs(); unsubInvitaciones(); };
  }, [sinAcceso, soyAdmin, miOrg]);

  const orgsPorId = useMemo(
    () => new Map(organizaciones.map(o => [o.id, o])),
    [organizaciones]
  );

  const orgPropia = useMemo(
    () => organizaciones.find(o => o.es_propia) || null,
    [organizaciones]
  );

  const visibles = useMemo(() => {
    const texto = claveNormalizada(filtro);
    return usuarios
      .filter(u => verInactivos || u.estado === 'activo')
      .filter(u => rolFiltro === 'todos' || (u.roles || []).includes(rolFiltro))
      .filter(u => {
        if (!texto) return true;
        const dni = (u.datos_chofer && u.datos_chofer.dni) || '';
        return claveNormalizada(u.nombre).includes(texto)
            || claveNormalizada(u.email).includes(texto)
            || dni.includes(filtro.trim());
      })
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
  }, [usuarios, filtro, rolFiltro, verInactivos]);

  /* ── Formulario ─────────────────────────────────────────────────────────── */

  const esChofer = form.roles.includes('chofer');
  const esInterno = form.roles.some(r => ROLES_INTERNOS.includes(r));

  // Decide el camino del alta. Los roles internos son cuentas corporativas
  // @explora.com.ar que entran con Google — esas cuentas de Auth las crea
  // Firebase la primera vez que esa persona hace `signInWithPopup`, no antes,
  // así que no se puede usar `crearCuenta` (email + contraseña) como con
  // choferes y transportistas. Un alta MIXTA (ej. admin + chofer a la vez) no
  // tiene sentido en este formulario y cae por el camino de siempre, con
  // email y contraseña —no debería pasar en la práctica, `alternarRol` ya
  // fija la organización de Explora en cuanto los roles son solo internos.
  const soloInternos = form.roles.length > 0 && form.roles.every(r => ROLES_INTERNOS.includes(r));

  // El DNI es inmutable solo si YA existe. Si se le está agregando el rol
  // chofer a alguien que no lo tenía, todavía no hay nada que proteger: recién
  // ahí se está creando.
  const dniBloqueado = !!(editando && editando.datos_chofer && editando.datos_chofer.dni);

  function abrirAlta() {
    setEditando(null);
    setClaveGenerada(null);
    setErrores([]);
    setForm({
      ...FORM_VACIO,
      // El transportista solo crea choferes de su organización: no se le
      // pregunta ninguna de las dos cosas.
      roles: soyTransportista ? ['chofer'] : ['chofer'],
      organizacion_id: soyTransportista ? miOrg : '',
    });
    setVista('form');
  }

  function abrirEdicion(u) {
    setEditando(u);
    setClaveGenerada(null);
    setErrores([]);
    setForm({
      nombre: u.nombre || '',
      email: u.email || '',
      roles: u.roles || [],
      organizacion_id: u.organizacion_id || '',
      telefono: (u.telefonos || [])[0] || '',
      dni: (u.datos_chofer && u.datos_chofer.dni) || '',
      cuit: (u.datos_chofer && u.datos_chofer.cuit) || '',
    });
    setVista('form');
  }

  function alternarRol(rolId) {
    const tiene = form.roles.includes(rolId);
    const nuevos = tiene
      ? form.roles.filter(r => r !== rolId)
      : [...form.roles, rolId];

    // Los roles internos llevan la organización de Explora, siempre. Elegirla a
    // mano sería una decisión que no existe.
    const soloInternos = nuevos.length > 0 && nuevos.every(r => ROLES_INTERNOS.includes(r));

    setForm({
      ...form,
      roles: nuevos,
      organizacion_id: soloInternos && orgPropia ? orgPropia.id : form.organizacion_id,
    });
  }

  function validar() {
    const problemas = [];

    if (!form.nombre.trim()) problemas.push('El nombre es obligatorio.');
    if (form.roles.length === 0) problemas.push('Elegí al menos un rol.');

    if (esChofer) {
      const dni = form.dni.replace(/\D/g, '');
      if (!dni) {
        problemas.push(editando
          ? 'Para agregarle el rol chofer hay que cargarle el DNI.'
          : 'El DNI es obligatorio para un chofer.');
      }
      else if (dni.length < 7 || dni.length > 8) problemas.push('El DNI tiene que tener 7 u 8 dígitos.');
      if (form.cuit.trim() && !normalizarCuit(form.cuit)) {
        problemas.push('El CUIT tiene que tener 11 dígitos.');
      }
    } else if (!editando && !form.email.trim()) {
      problemas.push('El correo es obligatorio.');
    }

    if (!form.organizacion_id) {
      problemas.push('Elegí la organización.');
    }

    // Un DNI repetido rompe la app: los viajes se filtran por DNI, así que dos
    // choferes con el mismo se verían los viajes del otro.
    if (esChofer) {
      const dni = form.dni.replace(/\D/g, '');
      const repetido = usuarios.find(u =>
        u.id !== (editando && editando.id)
        && u.datos_chofer && u.datos_chofer.dni === dni
      );
      if (repetido) problemas.push(`Ya hay un usuario con ese DNI: ${repetido.nombre}.`);
    }

    // Una invitación por Google no crea cuenta de Auth en el momento, así que
    // no hay ningún `auth/email-already-in-use` que la frene sola si el email
    // ya está usado. Se chequea acá, a mano, contra lo que sí se puede ver.
    if (soloInternos && !editando) {
      const emailNorm = form.email.trim().toLowerCase();
      if (invitaciones.some(i => i.id === emailNorm)) {
        problemas.push(`Ya hay una invitación pendiente para ${emailNorm}.`);
      }
      const yaExiste = usuarios.some(u => (u.email || '').toLowerCase() === emailNorm);
      if (yaExiste) problemas.push(`Ya existe un usuario con ese email: ${emailNorm}.`);
    }

    return problemas;
  }

  /**
   * Guarda. Al crear son dos sistemas: primero la cuenta de Auth, después el
   * perfil. Si el segundo falla, se borra la cuenta.
   */
  async function guardar() {
    const problemas = validar();
    if (problemas.length > 0) { setErrores(problemas); return; }

    setGuardando(true);
    setErrores([]);

    const dni = form.dni.replace(/\D/g, '');
    const email = esChofer ? emailDeChofer(dni) : form.email.trim().toLowerCase();

    const datosPerfil = {
      nombre: form.nombre.trim(),
      email,
      roles: form.roles,
      organizacion_id: form.organizacion_id,
      telefonos: form.telefono.trim() ? [form.telefono.trim()] : [],
      emails_extra: [],
      datos_chofer: esChofer
        ? { dni, cuit: normalizarCuit(form.cuit) || '', licencia_venc: null }
        : null,
    };

    try {
      if (editando) {
        // El DNI no se manda nunca: las reglas rechazan la escritura si aparece
        // entre los campos modificados.
        const cambios = { ...datosPerfil };
        // Si YA tenía DNI, se conserva el anterior: las reglas rechazan la
        // escritura si `datos_chofer.dni` aparece entre los campos modificados.
        // Si no lo tenía —se le está agregando el rol chofer— el DNI nuevo se
        // escribe como cualquier otro campo.
        if (dniBloqueado && cambios.datos_chofer) {
          cambios.datos_chofer = {
            ...cambios.datos_chofer,
            dni: editando.datos_chofer.dni,
          };
        }
        // El rol y la organización solo los cambia el admin.
        if (!soyAdmin) {
          delete cambios.roles;
          delete cambios.organizacion_id;
        }

        await actualizar({
          coleccion: 'usuarios',
          id: editando.id,
          cambios,
          accion: 'editar_usuario',
          entidadTipo: 'usuario',
          usuario,
        });

        setVista('lista');
      } else if (soloInternos) {
        await crearInvitacion(email, datosPerfil);
      } else {
        await crearUsuarioNuevo(email, datosPerfil);
      }
    } catch (err) {
      console.error(err);
      setErrores([traducirError(err)]);
    } finally {
      setGuardando(false);
    }
  }

  /**
   * Deja una invitación esperando, para alguien que va a entrar con cuenta de
   * Google. No crea ninguna cuenta de Auth: no se puede, sin conocer el UID
   * que todavía no existe —lo crea Firebase Auth recién en el primer
   * `signInWithPopup` de esa persona—.
   *
   * `cargarSesion` (en `sesion.js`) es quien la consume: en ese primer login
   * real, crea `usuarios/{uid}` con exactamente estos roles y organización, y
   * borra la invitación.
   */
  async function crearInvitacion(email, datosPerfil) {
    await crear({
      coleccion: 'invitaciones',
      id: email,                 // el ID es el email: así se lee sin consultar nada más
      datos: {
        email,
        nombre: datosPerfil.nombre,
        roles: datosPerfil.roles,
        organizacion_id: datosPerfil.organizacion_id,
        telefonos: datosPerfil.telefonos,
      },
      accion: 'crear_invitacion',
      entidadTipo: 'invitacion',
      usuario,
    });
    setInvitacionCreada({ nombre: datosPerfil.nombre, email });
    setVista('invitacion');
  }

  /**
   * Cancela una invitación que todavía no fue aceptada. No hay nada más que
   * deshacer: sin invitación no hay cuenta de Auth ni documento en `usuarios`
   * —a diferencia de `crearUsuarioNuevo`, acá nunca llegó a existir nada de
   * eso—.
   */
  async function cancelarInvitacion(inv) {
    if (!window.confirm(`¿Cancelar la invitación para ${inv.email}?`)) return;
    setGuardando(true);
    try {
      await deleteDoc(doc(db, 'invitaciones', inv.id));
    } catch (err) {
      console.error(err);
      window.alert(traducirError(err));
    } finally {
      setGuardando(false);
    }
  }

  /**
   * Crea la cuenta de Auth y el perfil.
   *
   * El orden importa: primero Auth, porque el ID del documento de `usuarios`
   * TIENE que ser el UID de la cuenta. Las reglas resuelven todo con
   * `get(/usuarios/{request.auth.uid})`, así que un perfil con otro ID sería
   * invisible para el sistema.
   */
  async function crearUsuarioNuevo(email, datosPerfil) {
    const clave = generarClave();
    let uid = null;

    try {
      uid = await crearCuenta(email, clave);
    } catch (err) {
      setErrores([traducirErrorAuth(err)]);
      return;
    }

    try {
      await crear({
        coleccion: 'usuarios',
        id: uid,                       // el ID ES el UID de Auth
        datos: { ...datosPerfil, estado: 'activo' },
        accion: 'crear_usuario',
        entidadTipo: 'usuario',
        usuario,
      });

      // La clave se muestra UNA sola vez. No se guarda.
      setClaveGenerada({ nombre: datosPerfil.nombre, email, clave });
      setVista('clave');
    } catch (err) {
      console.error('Falló el perfil, se borra la cuenta:', err);
      const borrada = await deshacerCuenta(email, clave);
      setErrores([
        borrada
          ? `No se pudo crear el perfil: ${traducirError(err)}. La cuenta se borró, no quedó nada a medias.`
          : `No se pudo crear el perfil: ${traducirError(err)}. ATENCIÓN: la cuenta de ${email} quedó creada sin perfil y hay que borrarla desde la consola de Firebase.`,
      ]);
    }
  }

  /**
   * Desactiva un usuario, si no tiene un viaje en curso.
   *
   * `RECIBIDO` no bloquea: el chofer todavía no arrancó. `EN_VIAJE` sí — el
   * camión está en la ruta y sacarle el acceso lo dejaría sin poder cerrar el
   * viaje.
   */
  async function darDeBaja(u) {
    const motivo = window.prompt(`¿Por qué se da de baja a ${u.nombre}?`);
    if (motivo === null) return;
    if (!motivo.trim()) { window.alert('El motivo es obligatorio.'); return; }

    setGuardando(true);
    try {
      if ((u.roles || []).includes('chofer') && u.datos_chofer) {
        const q = query(
          collection(db, 'viajes'),
          where('chofer_dni', '==', u.datos_chofer.dni),
          where('estado', '==', 'EN_VIAJE'),
          limit(1)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          window.alert(`${u.nombre} tiene un viaje en curso. Esperá a que lo cierre, o cerralo a mano desde Programación.`);
          return;
        }
      }

      // No se puede dar de baja al último admin activo: el sistema quedaría sin
      // nadie que pueda administrar usuarios, y no habría forma de revertirlo
      // desde el portal — habría que tocar Firestore a mano.
      if ((u.roles || []).includes('admin')) {
        const otrosAdmins = usuarios.filter(o =>
          o.id !== u.id
          && o.estado === 'activo'
          && (o.roles || []).includes('admin')
        );
        if (otrosAdmins.length === 0) {
          window.alert('No se puede dar de baja al único administrador activo. Creá otro admin primero.');
          return;
        }
      }

      await desactivar({
        coleccion: 'usuarios',
        id: u.id,
        accion: 'desactivar_usuario',
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

  async function volverAActivar(u) {
    setGuardando(true);
    try {
      await reactivar({ coleccion: 'usuarios', id: u.id, usuario });
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

  // Pantalla de la clave: aparece una sola vez, después de crear.
  if (vista === 'clave' && claveGenerada) {
    return (
      <div style={styles.wrap}>
        <div style={styles.panelHeader}>
          <div style={styles.titulo}>Usuario creado</div>
          <Boton variante="secundario" onClick={() => { setClaveGenerada(null); setVista('lista'); }}>Listo</Boton>
        </div>

        <div style={styles.bannerAviso}>
          <strong>Anotá estos datos ahora.</strong> La contraseña no se guarda en
          ningún lado y no se puede volver a ver. Si se pierde, hay que generar
          una nueva.
        </div>

        <Tarjeta style={{ padding: '1.5rem' }}>
          <div style={styles.claveField}>
            <span style={styles.label}>Usuario</span>
            <span style={styles.claveValor}>{claveGenerada.nombre}</span>
          </div>
          <div style={styles.claveField}>
            <span style={styles.label}>Correo de acceso</span>
            <span style={styles.claveValorMono}>{claveGenerada.email}</span>
          </div>
          <div style={styles.claveField}>
            <span style={styles.label}>Contraseña</span>
            <span style={styles.claveValorMono}>{claveGenerada.clave}</span>
          </div>

          <div style={{ ...styles.cardActions, marginTop: 16 }}>
            <Boton
              onClick={() => {
                navigator.clipboard.writeText(
                  `Usuario: ${claveGenerada.nombre}\nCorreo: ${claveGenerada.email}\nContraseña: ${claveGenerada.clave}`
                );
              }}
            >
              Copiar
            </Boton>
            <Boton variante="secundario" onClick={() => { setClaveGenerada(null); setVista('lista'); }}>
              Listo
            </Boton>
          </div>
        </Tarjeta>
      </div>
    );
  }

  // Confirmación tras invitar por Google: no hay contraseña que mostrar, pero
  // sí hay que dejar claro que todavía no puede entrar — falta que acepte.
  if (vista === 'invitacion' && invitacionCreada) {
    return (
      <div style={styles.wrap}>
        <div style={styles.panelHeader}>
          <div style={styles.titulo}>Invitación creada</div>
          <Boton variante="secundario" onClick={() => { setInvitacionCreada(null); setVista('lista'); }}>Listo</Boton>
        </div>

        <div style={styles.bannerAviso}>
          Todavía no puede entrar. Va a poder hacerlo la primera vez que
          inicie sesión con Google usando <strong>{invitacionCreada.email}</strong> —
          ahí se le va a asignar el rol automáticamente. Hasta entonces, la
          invitación queda pendiente en la lista de abajo.
        </div>

        <Tarjeta style={{ padding: '1.5rem' }}>
          <div style={styles.claveField}>
            <span style={styles.label}>Usuario</span>
            <span style={styles.claveValor}>{invitacionCreada.nombre}</span>
          </div>
          <div style={styles.claveField}>
            <span style={styles.label}>Correo de acceso (Google)</span>
            <span style={styles.claveValorMono}>{invitacionCreada.email}</span>
          </div>

          <div style={{ ...styles.cardActions, marginTop: 16 }}>
            <Boton variante="secundario" onClick={() => { setInvitacionCreada(null); setVista('lista'); }}>
              Listo
            </Boton>
          </div>
        </Tarjeta>
      </div>
    );
  }

  if (vista === 'form') {
    const orgsElegibles = organizaciones
      .filter(o => o.estado === 'activo')
      .filter(o => esInterno ? o.es_propia : true)
      .sort((a, b) => a.razon_social.localeCompare(b.razon_social, 'es'));

    return (
      <div style={styles.wrap}>
        <div style={styles.panelHeader}>
          <div style={styles.titulo}>
            {editando ? `Editar ${editando.nombre}` : 'Nuevo usuario'}
          </div>
          <Boton variante="secundario" onClick={() => setVista('lista')}>Cancelar</Boton>
        </div>

        {errores.length > 0 && (
          <div style={styles.bannerError}>
            {errores.map((e, i) => <div key={i}>{e}</div>)}
          </div>
        )}

        <Tarjeta style={{ padding: '1.5rem' }}>
          {soyAdmin && (
            <div style={styles.seccion}>
              <div style={styles.seccionTitulo}>Roles</div>
              {ROLES.map(r => (
                <label key={r.id} style={styles.check}>
                  <input
                    type="checkbox"
                    checked={form.roles.includes(r.id)}
                    onChange={() => alternarRol(r.id)}
                  />
                  <span>{r.label}</span>
                </label>
              ))}
              <div style={styles.ayuda}>
                Se puede tener más de uno. Hoy la misma persona necesita dos
                cuentas para ser chofer y admin a la vez.
              </div>
            </div>
          )}

          <div style={styles.grid2}>
            <Campo
              label="Nombre *"
              value={form.nombre}
              onChange={e => setForm({ ...form, nombre: e.target.value })}
              placeholder="CABALLERO, WALTER ROMAN"
            />

            {esChofer ? (
              <>
                <Campo
                  label="DNI *"
                  value={form.dni}
                  disabled={dniBloqueado}
                  onChange={e => setForm({ ...form, dni: e.target.value })}
                  placeholder="25505747"
                  ayuda={dniBloqueado
                    ? 'El DNI no se puede cambiar: es la identidad de la persona y los viajes se filtran por él. Si está mal, dala de baja y creala de nuevo.'
                    : 'Con el DNI se arma el correo de acceso a la app.'}
                />
                <Campo
                  label="CUIT"
                  value={form.cuit}
                  onChange={e => setForm({ ...form, cuit: e.target.value })}
                  placeholder="20-25505747-3"
                />
              </>
            ) : (
              <Campo
                label="Correo *"
                value={form.email}
                disabled={!!editando}
                onChange={e => setForm({ ...form, email: e.target.value })}
                placeholder="nombre@explora.com.ar"
                ayuda={editando ? 'El correo es la identidad de la cuenta y no se cambia desde acá.' : undefined}
              />
            )}

            <Campo
              label="Teléfono"
              value={form.telefono}
              onChange={e => setForm({ ...form, telefono: e.target.value })}
              placeholder="(3476) 562372"
            />

            {soyAdmin && (
              <Campo
                as="select" label="Organización *"
                value={form.organizacion_id}
                onChange={e => setForm({ ...form, organizacion_id: e.target.value })}
                disabled={esInterno}
                ayuda={esInterno ? 'Los roles internos pertenecen a Explora.' : undefined}
              >
                <option value="">Elegir...</option>
                {orgsElegibles.map(o => (
                  <option key={o.id} value={o.id}>{o.razon_social}</option>
                ))}
              </Campo>
            )}
          </div>

          <div style={styles.cardActions}>
            <Boton disabled={guardando} onClick={guardar}>
              {guardando ? 'Guardando...' : (editando ? 'Guardar cambios' : 'Crear usuario')}
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
        <div style={styles.titulo}>Usuarios</div>
        <Boton onClick={abrirAlta}>+ Nuevo</Boton>
      </div>

      {/* Invitaciones pendientes — cuentas de Google que todavía no entraron
          por primera vez. Solo el admin las ve: es el único que las crea. */}
      {soyAdmin && invitaciones.length > 0 && (
        <div style={styles.invitacionesWrap}>
          <div style={styles.invitacionesTitulo}>
            Invitaciones pendientes ({invitaciones.length})
          </div>
          {invitaciones.map(inv => (
            <div key={inv.id} style={styles.invitacionItem}>
              <span style={styles.invitacionEmail}>{inv.email}</span>
              <span style={styles.invitacionRoles}>
                {(inv.roles || []).map(r => (ROLES.find(x => x.id === r) || {}).label || r).join(', ')}
              </span>
              <Boton chico variante="secundario" style={styles.btnCancelarInvitacion} disabled={guardando} onClick={() => cancelarInvitacion(inv)}>
                Cancelar
              </Boton>
            </div>
          ))}
        </div>
      )}

      <div style={styles.filtrosGrid}>
        <Campo
          label="Buscar"
          value={filtro}
          onChange={e => setFiltro(e.target.value)}
          placeholder="Nombre, correo o DNI"
        />
        <Campo
          as="select" label="Rol"
          value={rolFiltro}
          onChange={e => setRolFiltro(e.target.value)}
        >
          <option value="todos">Todos</option>
          {ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
        </Campo>
      </div>

      <div style={styles.filtrosResumen}>
        <span>{visibles.length} usuario(s)</span>
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
      {!cargando && visibles.length === 0 && <Vacio titulo="No hay usuarios que coincidan." />}

      {visibles.map(u => {
        const org = orgsPorId.get(u.organizacion_id);
        const dni = (u.datos_chofer && u.datos_chofer.dni) || null;
        return (
          <Tarjeta key={u.id} style={{ marginBottom: espacio.sm, padding: '10px 14px' }}>
            <div style={styles.cardRow}>
              <span style={styles.rowNombre}>{u.nombre}</span>

              {(u.roles || []).map(r => (
                <Pastilla key={r} chico colores={PILLS[r] || PILLS.otro}>
                  {(ROLES.find(x => x.id === r) || {}).label || r}
                </Pastilla>
              ))}
              {u.estado !== 'activo' && (
                <Pastilla chico colores={{ bg: colorEstado.peligroFondo, color: colorEstado.peligroTexto }}>Inactivo</Pastilla>
              )}

              <span style={styles.rowOrg}>{org ? org.razon_social : '—'}</span>
              <span style={styles.rowDni}>{dni || u.email}</span>

              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <Boton chico variante="secundario" onClick={() => abrirEdicion(u)}>
                  Editar
                </Boton>
                {/* El propio usuario no se puede desactivar: quedarías
                    afuera en la próxima recarga, sin forma de revertirlo.
                    Es distinto de la protección del último admin, que está en
                    `darDeBaja`. */}
                {u.id !== usuario.uid && (
                  u.estado === 'activo' ? (
                    <Boton chico variante="peligro" disabled={guardando} onClick={() => darDeBaja(u)}>
                      Dar de baja
                    </Boton>
                  ) : (
                    <Boton chico variante="secundario" disabled={guardando} onClick={() => volverAActivar(u)}>
                      Reactivar
                    </Boton>
                  )
                )}
              </span>
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
    return 'Firestore rechazó la escritura. Puede ser que tu usuario no tenga '
         + 'permiso, o que la escritura toque un campo que las reglas protegen '
         + '—el DNI, por ejemplo—. Revisá la consola del navegador.';
  }
  if (err && err.code === 'failed-precondition') {
    return 'Falta un índice en Firestore. En la consola del navegador hay un '
         + 'link para crearlo con un clic.';
  }
  return (err && err.message) || 'Error desconocido.';
}

/* -----------------------------------------------------------------------------
 * Estilos -- crearEstilos(colores, oscuro) + useEstilos(), mismo patron que
 * el resto de las pantallas migradas.
 * -------------------------------------------------------------------------- */

function crearEstilos(colores, oscuro) {
  const pal = paletaTexto(oscuro);

  return {
    wrap: { maxWidth: 900, margin: '0 auto', padding: '1.5rem 1rem', background: colores.fondo, color: colores.texto },
    panelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' },
    titulo: { fontSize: 18, fontWeight: 500, color: colores.texto },

    filtrosGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginBottom: 10 },
    filtrosResumen: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: pal.azul, marginBottom: 10 },
    checkInline: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: pal.azul, cursor: 'pointer' },

    invitacionesWrap: { background: colorEstado.advertenciaFondoAlterno, border: `0.5px solid ${colorEstado.advertenciaBordeAlterno}`, borderRadius: 10, padding: '10px 14px', marginBottom: 14 },
    invitacionesTitulo: { fontSize: 11, fontWeight: tipografia.peso.negrita, color: colorEstado.advertenciaTextoFuerte, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 },
    invitacionItem: { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: `0.5px solid ${colorEstado.advertenciaBordeAlterno}`, flexWrap: 'wrap' },
    invitacionEmail: { fontSize: 13, color: colorEstado.advertenciaTextoFuerte, fontWeight: tipografia.peso.medio, flex: 1, minWidth: 160 },
    invitacionRoles: { fontSize: 12, color: colorEstado.advertenciaTexto },
    btnCancelarInvitacion: { borderColor: colorEstado.advertenciaTextoFuerte, color: colorEstado.advertenciaTextoFuerte },

    cardRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    cardActions: { display: 'flex', gap: 8, marginTop: 12 },
    rowNombre: { fontSize: 13, fontWeight: tipografia.peso.medio, color: colores.texto, flex: 2, minWidth: 140 },
    rowOrg: { fontSize: 12, color: pal.rojo, flex: 1, minWidth: 90 },
    rowDni: { fontSize: 11, color: pal.azul, fontFamily: 'monospace', flexShrink: 0 },

    grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 },
    label: { fontSize: 11, color: pal.azul },
    ayuda: { fontSize: 11, color: pal.azul, lineHeight: 1.4 },
    check: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: colores.texto, marginBottom: 6, cursor: 'pointer' },
    seccion: { marginBottom: '1.5rem' },
    seccionTitulo: { fontSize: 12, fontWeight: tipografia.peso.medio, color: pal.azul, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, paddingBottom: 6, borderBottom: `0.5px solid ${colores.borde}` },

    claveField: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 },
    claveValor: { fontSize: 15, color: colores.texto },
    claveValorMono: { fontSize: 15, color: colores.texto, fontFamily: 'monospace', letterSpacing: '0.03em' },

    bannerAviso: { padding: '10px 14px', borderRadius: 8, background: colorEstado.advertenciaFondo, border: `0.5px solid ${colorEstado.advertenciaBorde}`, fontSize: 13, color: colorEstado.advertenciaTexto, marginBottom: 12, lineHeight: 1.5 },
    bannerError: { padding: '10px 14px', borderRadius: 8, background: colorEstado.peligroFondo, border: `0.5px solid ${colorEstado.peligroBordeAlterno}`, fontSize: 13, color: colorEstado.peligroTexto, marginBottom: 12, whiteSpace: 'pre-line' },
  };
}

function useEstilos() {
  const { colores, oscuro } = useTema();
  return useMemo(() => crearEstilos(colores, oscuro), [colores, oscuro]);
}
