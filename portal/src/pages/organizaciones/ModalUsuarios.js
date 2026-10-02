/**
 * =============================================================================
 * organizaciones/ModalUsuarios.js — v1.2.0 (rediseño Organizaciones)
 * =============================================================================
 *
 * SÍNTOMA
 *   El Paso 3 del rediseño pide un modal "Usuarios — <razón social>" en vez
 *   de la sub-vista de pantalla completa que tenía RF-03
 *   (`UsuariosDeOrganizacion`), y que el alta permita elegir entre
 *   Transportista y Chofer (como el admin ya puede en `Usuarios.js`), no
 *   solo Transportista como hacía RF-03.
 *
 * CAUSA RAÍZ
 *   RF-03 solo necesitaba resolver "quién entra al portal por esta
 *   organización transportista", así que fijaba `roles: ['transportista']`
 *   sin ofrecer elegir. Esta tarea amplía ese alcance (decisión tomada con
 *   el usuario al planificar): el admin puede dar de alta también un
 *   chofer de esa organización desde acá, mismo criterio de roles que
 *   `Usuarios.js` (el admin elige, el coordinador sigue fijo en
 *   Transportista).
 *
 * ALCANCE
 *   Reusa `validarAltaUsuario()`/`darDeAltaUsuario()`/`traducirErrorAuth()`
 *   de `alta-usuarios.js` (RF-03) y `emailDeChofer()`/`normalizarCuit()`
 *   para el camino chofer -- mismos campos y mismas reglas que
 *   `Usuarios.js`: Nombre+DNI+CUIT+Teléfono (sin correo, se deriva con
 *   `emailDeChofer`) para chofer; Nombre+Correo+Teléfono para transportista.
 *   `organizacion_id` siempre fijo en `org.id` -- acá no se elige
 *   organización, a diferencia de `Usuarios.js`.
 *
 *   El chequeo de DNI repetido de `validarAltaUsuario()` necesita ver TODOS
 *   los usuarios, no solo los de esta organización -- se agrega un segundo
 *   `onSnapshot(usuarios)` sin filtro, SOLO cuando `soyAdmin` (mismo acceso
 *   que ya tiene ese rol en `Usuarios.js`), usado nada más como insumo de
 *   validación. La lista que se MUESTRA sigue siendo solo la de esta
 *   organización.
 *
 *   Si `org.es_transportista` es falso: lista de usuarios en solo lectura,
 *   sin alta -- mantiene el alcance original de RF-03 (esta pantalla no da
 *   de alta usuarios de un cliente).
 *
 * LIMITACIONES CONOCIDAS
 *   El botón "+ Nuevo usuario" ya no se oculta cuando la organización ya
 *   tiene un usuario transportista activo (RF-03 lo ocultaba, pensado para
 *   un único punto de contacto) -- con el alta de chofer sumada, una
 *   organización transportista puede necesitar varios choferes, así que esa
 *   regla dejó de tener sentido como estaba. Editar/desactivar un usuario
 *   siguen en `Usuarios.js`, sin cambios.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Admin: crea un chofer (pide DNI,
 *   la clave se muestra una vez) y un transportista (pide correo) para la
 *   misma organización. Coordinador: solo ve la opción Transportista (sin
 *   selector). Organización no transportista: lista de solo lectura, sin
 *   "+ Nuevo usuario".
 * ========================================================================== */

import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { darDeAltaUsuario, validarAltaUsuario, traducirErrorAuth, emailDeChofer } from '../../alta-usuarios';
import { normalizarCuit } from '../../mapa-normalizacion';
import Modal from '../../ui/Modal';
import Boton from '../../ui/Boton';
import Pastilla from '../../ui/Pastilla';
import Campo from '../../ui/Campo';
import Vacio from '../../ui/Vacio';
import { colorEstado } from '../../ui/tokens';
import { useEstilos } from './estilos';

const FORM_VACIO = { nombre: '', email: '', telefono: '', dni: '', cuit: '', rol: 'transportista' };

const PILLS_ROL = {
  transportista: { bg: colorEstado.advertenciaFondoAlterno, color: colorEstado.advertenciaTextoFuerte },
  chofer:        { bg: '#EEEDFE', color: colorEstado.acentoPurpura },
  inactivo:      { bg: colorEstado.peligroFondo, color: colorEstado.peligroTexto },
};

export default function ModalUsuarios({ org, usuario, soyAdmin, onCerrar }) {
  const styles = useEstilos();
  const [usuarios, setUsuarios] = useState([]);
  const [usuariosTodos, setUsuariosTodos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [vista, setVista] = useState('lista');   // lista | form | clave
  const [form, setForm] = useState(FORM_VACIO);
  const [errores, setErrores] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [claveGenerada, setClaveGenerada] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'usuarios'), where('organizacion_id', '==', org.id)),
      (snap) => { setUsuarios(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setCargando(false); },
      (err) => { console.error('ModalUsuarios:', err); setCargando(false); }
    );
    // 1. Solo para el chequeo de DNI repetido -- ver el encabezado.
    let unsubTodos = () => {};
    if (soyAdmin) {
      unsubTodos = onSnapshot(
        collection(db, 'usuarios'),
        (snap) => setUsuariosTodos(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
        (err) => console.error('ModalUsuarios (todos):', err)
      );
    }
    return () => { unsub(); unsubTodos(); };
  }, [org.id, soyAdmin]);

  function abrirAlta() {
    setForm({ ...FORM_VACIO, rol: 'transportista' });
    setErrores([]);
    setVista('form');
  }

  const esChofer = form.rol === 'chofer';

  async function guardar() {
    const dniLimpio = form.dni.replace(/\D/g, '');
    const datosValidacion = {
      nombre: form.nombre,
      email: form.email,
      roles: [form.rol],
      organizacion_id: org.id,
      dni: form.dni,
      cuit: form.cuit,
    };
    const problemas = validarAltaUsuario(datosValidacion, {
      usuarios: soyAdmin ? usuariosTodos : usuarios,
      invitaciones: [],
      editando: null,
      soloInternos: false,
    });
    if (problemas.length > 0) { setErrores(problemas); return; }

    setGuardando(true);
    setErrores([]);
    try {
      const email = esChofer ? emailDeChofer(dniLimpio) : form.email.trim().toLowerCase();
      const { clave } = await darDeAltaUsuario({
        datos: {
          nombre: form.nombre.trim(),
          email,
          roles: [form.rol],
          organizacion_id: org.id,
          telefonos: form.telefono.trim() ? [form.telefono.trim()] : [],
          emails_extra: [],
          datos_chofer: esChofer
            ? { dni: dniLimpio, cuit: normalizarCuit(form.cuit) || '', licencia_venc: null }
            : null,
        },
        usuario,
      });
      setClaveGenerada({ nombre: form.nombre.trim(), email, clave });
      setVista('clave');
    } catch (err) {
      console.error(err);
      setErrores([err.fase === 'auth' ? traducirErrorAuth(err) : traducirError(err)]);
    } finally {
      setGuardando(false);
    }
  }

  if (vista === 'clave' && claveGenerada) {
    return (
      <Modal titulo="Usuario creado" onCerrar={() => { setClaveGenerada(null); setVista('lista'); onCerrar(); }}>
        <div style={styles.bannerAviso}>
          <strong>Anotá estos datos ahora.</strong> La contraseña no se guarda en
          ningún lado y no se puede volver a ver. Si se pierde, hay que generar
          una nueva desde Usuarios.
        </div>
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
            onClick={() => navigator.clipboard.writeText(
              `Usuario: ${claveGenerada.nombre}\nCorreo: ${claveGenerada.email}\nContraseña: ${claveGenerada.clave}`
            )}
          >
            Copiar
          </Boton>
          <Boton variante="secundario" onClick={() => { setClaveGenerada(null); setVista('lista'); }}>
            Volver a la lista
          </Boton>
        </div>
      </Modal>
    );
  }

  if (vista === 'form') {
    return (
      <Modal titulo={`Nuevo usuario — ${org.razon_social}`} onCerrar={onCerrar}>
        {errores.length > 0 && (
          <div style={styles.bannerError}>
            {errores.map((e, i) => <div key={i}>{e}</div>)}
          </div>
        )}

        {soyAdmin && (
          <div style={styles.seccion}>
            <div style={styles.seccionTitulo}>Rol</div>
            <label style={styles.check}>
              <input
                type="radio" name="rol_usuario_org"
                checked={form.rol === 'transportista'}
                onChange={() => setForm({ ...form, rol: 'transportista' })}
              />
              <span>Transportista</span>
            </label>
            <label style={styles.check}>
              <input
                type="radio" name="rol_usuario_org"
                checked={form.rol === 'chofer'}
                onChange={() => setForm({ ...form, rol: 'chofer' })}
              />
              <span>Chofer</span>
            </label>
          </div>
        )}

        <div style={styles.grid2}>
          <Campo
            label="Nombre *"
            value={form.nombre}
            onChange={e => setForm({ ...form, nombre: e.target.value })}
            placeholder={esChofer ? 'CABALLERO, WALTER ROMAN' : 'Nombre de la persona de contacto'}
          />

          {esChofer ? (
            <>
              <Campo
                label="DNI *"
                value={form.dni}
                onChange={e => setForm({ ...form, dni: e.target.value })}
                placeholder="25505747"
                ayuda="Con el DNI se arma el correo de acceso a la app."
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
              onChange={e => setForm({ ...form, email: e.target.value })}
              placeholder="nombre@empresa.com"
            />
          )}

          <Campo
            label="Teléfono"
            value={form.telefono}
            onChange={e => setForm({ ...form, telefono: e.target.value })}
            placeholder="(3476) 562372"
          />
        </div>

        <div style={{ ...styles.cardActions, marginTop: 16 }}>
          <Boton disabled={guardando} onClick={guardar}>
            {guardando ? 'Guardando...' : 'Crear usuario'}
          </Boton>
          <Boton variante="secundario" onClick={() => setVista('lista')}>Volver a la lista</Boton>
        </div>
      </Modal>
    );
  }

  return (
    <Modal titulo={`Usuarios — ${org.razon_social}`} onCerrar={onCerrar}>
      {/* 2. Editar/desactivar siguen en Usuarios.js -- ver el encabezado. */}
      {cargando && <Vacio titulo="Cargando..." />}

      {!cargando && usuarios.length === 0 && (
        <Vacio titulo="Sin usuarios" nota="Esta organización todavía no tiene ningún usuario para entrar al portal." />
      )}

      {!cargando && usuarios.map(u => (
        <div key={u.id} style={styles.domicilioCard}>
          <div style={styles.domicilioRow}>
            <span style={styles.domicilioDireccion}>{u.nombre}</span>
            {(u.roles || []).map(r => (
              <Pastilla key={r} chico colores={PILLS_ROL[r] || PILLS_ROL.transportista}>{r}</Pastilla>
            ))}
            {u.estado !== 'activo' && <Pastilla chico colores={PILLS_ROL.inactivo}>Inactivo</Pastilla>}
          </div>
        </div>
      ))}

      {!cargando && org.es_transportista && (
        <div style={{ ...styles.cardActions, marginTop: 12 }}>
          <Boton onClick={abrirAlta}>+ Nuevo usuario</Boton>
        </div>
      )}

      <div style={{ ...styles.cardActions, marginTop: 12 }}>
        <Boton variante="secundario" onClick={onCerrar}>Cerrar</Boton>
      </div>
    </Modal>
  );
}

function traducirError(err) {
  if (err && err.code === 'permission-denied') {
    return 'Firestore rechazó la escritura. Puede ser que tu usuario no tenga '
         + 'permiso, o que falte su documento en el modelo nuevo. '
         + 'Revisá la consola del navegador para el detalle.';
  }
  return (err && err.message) || 'Error desconocido.';
}
