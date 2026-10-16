/**
 * =============================================================================
 * organizaciones/PasoUsuarioTransportista.js — v1.2.2 (rediseño del modal)
 * =============================================================================
 *
 * SÍNTOMA
 *   `ModalOrganizacion.js` se rehace con pestañas y este paso (RF-03: crear el
 *   usuario transportista justo después de dar de alta un transporte) ya no
 *   cabía en ese archivo sin volverlo enorme.
 *
 * CAUSA RAÍZ
 *   Vivía como componente interno de `ModalOrganizacion.js`.
 *
 * ALCANCE
 *   Mudanza 1:1, sin cambios de comportamiento: mismo formulario (Nombre,
 *   Correo, Teléfono), mismo `darDeAltaUsuario()` con `roles: ['transportista']`
 *   fijo, misma pantalla de "Usuario creado" con la clave que se muestra una
 *   sola vez, mismo "Omitir". Mismo `Modal` de siempre.
 *
 * LIMITACIONES CONOCIDAS
 *   Las de RF-03: ninguna nueva.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Alta de un transporte: el modal pasa
 *   a "Crear usuario transportista"; "Omitir" cierra.
 * ========================================================================== */

import React, { useState } from 'react';
import { darDeAltaUsuario, validarAltaUsuario, traducirErrorAuth } from '../../alta-usuarios';
import Modal from '../../ui/Modal';
import Boton from '../../ui/Boton';
import Campo from '../../ui/Campo';
import { useEstilos } from './estilos';

export default function PasoUsuarioTransportista({ org, usuario, onTerminar }) {
  const styles = useEstilos();
  const [vista, setVista] = useState('form'); // form | clave
  const [form, setForm] = useState({ nombre: '', email: '', telefono: '' });
  const [errores, setErrores] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [claveGenerada, setClaveGenerada] = useState(null);

  async function guardar() {
    const datos = { nombre: form.nombre, email: form.email, roles: ['transportista'], organizacion_id: org.id };
    const problemas = validarAltaUsuario(datos, { usuarios: [], soloInternos: false });
    if (problemas.length > 0) { setErrores(problemas); return; }

    setGuardando(true);
    setErrores([]);
    try {
      const email = form.email.trim().toLowerCase();
      const { clave } = await darDeAltaUsuario({
        datos: {
          nombre: form.nombre.trim(),
          email,
          roles: ['transportista'],
          organizacion_id: org.id,
          telefonos: form.telefono.trim() ? [form.telefono.trim()] : [],
          emails_extra: [],
          datos_chofer: null,
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
      <Modal titulo="Usuario creado" onCerrar={onTerminar}>
        <div style={styles.bannerAviso}>
          <strong>Anotá estos datos ahora.</strong> La contraseña no se guarda en
          ningún lado y no se puede volver a ver.
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
          <Boton variante="secundario" onClick={onTerminar}>Listo</Boton>
        </div>
      </Modal>
    );
  }

  return (
    <Modal titulo={`Crear usuario transportista — ${org.razon_social}`} onCerrar={onTerminar}>
      {errores.length > 0 && (
        <div style={styles.bannerError}>
          {errores.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}
      <div style={styles.grid2}>
        <Campo
          label="Nombre *"
          value={form.nombre}
          onChange={e => setForm({ ...form, nombre: e.target.value })}
          placeholder="Nombre de la persona de contacto"
        />
        <Campo
          label="Correo *"
          value={form.email}
          onChange={e => setForm({ ...form, email: e.target.value })}
          placeholder="nombre@empresa.com"
        />
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
        <Boton variante="secundario" onClick={onTerminar}>Omitir</Boton>
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
