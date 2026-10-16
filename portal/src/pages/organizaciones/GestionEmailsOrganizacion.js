/**
 * =============================================================================
 * organizaciones/GestionEmailsOrganizacion.js — v1.2.2 (correos por organización)
 * =============================================================================
 *
 * SÍNTOMA
 *   Una organización solo podía tener un correo (campo `email`), sin alias ni
 *   forma de marcar cuál es el principal.
 *
 * CAUSA RAÍZ
 *   El modelo no tenía una colección de correos; ver el encabezado de
 *   `logica-organizacion-emails.js`.
 *
 * ALCANCE
 *   Gestión de `organizacion_emails` con la misma dinámica que
 *   `GestionDomiciliosOrganizacion.js`: lista (principal primero), agregar
 *   (correo + alias opcional + checkbox principal), quitar y hacer principal.
 *   Mismas props (`usuario`, `organizacion`, `puedeEditar`, `soloLectura`).
 *   Toda la lógica sale de `logica-organizacion-emails.js`. 2. Prop opcional
 *   `onCambio(mensaje)`: el modal rediseñado la usa para mostrar un toast tras
 *   cada alta, baja o cambio de principal (v1.2.2), y `renderVacio(abrirForm,
 *   editable)` para reemplazar el estado vacío. 1. Los teléfonos
 *   NO se gestionan acá: son de los usuarios y se ven en el modal Usuarios.
 *
 * LIMITACIONES CONOCIDAS
 *   No edita un correo existente: se quita y se vuelve a agregar (igual que
 *   los domicilios).
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Con `soloLectura` se ve la lista sin
 *   botones. Un duplicado en otra grafía de mayúsculas se rechaza.
 * ========================================================================== */

import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { agregarEmail, quitarEmail, marcarEmailPrincipal, validarEmail } from './logica-organizacion-emails';
import Boton from '../../ui/Boton';
import Pastilla from '../../ui/Pastilla';
import Vacio from '../../ui/Vacio';
import { colorEstado } from '../../shared/tokens';
import { useEstilos } from './estilos';

const FORM_VACIO = { email: '', alias: '', principal: false };

const PILLS = {
  principal: { bg: colorEstado.exitoFondo, color: colorEstado.exitoTexto },
};

/**
 * @param {Object} props
 * @param {Object} props.usuario
 * @param {Object} props.organizacion
 * @param {boolean} [props.puedeEditar]
 * @param {boolean} [props.soloLectura] manda sobre `puedeEditar`, igual que en
 *   `GestionDomiciliosOrganizacion`.
 */
export default function GestionEmailsOrganizacion({ usuario, organizacion, puedeEditar = true, soloLectura = false, onCambio, renderVacio }) {
  const styles = useEstilos();
  const editable = puedeEditar && !soloLectura;

  const [emails, setEmails] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [mostrandoForm, setMostrandoForm] = useState(false);
  const [form, setForm] = useState(FORM_VACIO);
  const [errores, setErrores] = useState([]);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'organizacion_emails'), where('organizacion_id', '==', organizacion.id)),
      (snap) => { setEmails(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setCargando(false); },
      (err) => { console.error('GestionEmailsOrganizacion:', err); setCargando(false); }
    );
    return unsub;
  }, [organizacion.id]);

  const ordenados = useMemo(() => [...emails].sort((a, b) => {
    if (!!a.principal !== !!b.principal) return a.principal ? -1 : 1;
    return (a.email || '').localeCompare(b.email || '', 'es');
  }), [emails]);

  function abrirForm() {
    setForm(FORM_VACIO);
    setErrores([]);
    setMostrandoForm(true);
  }

  function cerrarForm() {
    setMostrandoForm(false);
    setForm(FORM_VACIO);
  }

  async function guardar() {
    const problemas = validarEmail(form.email);
    if (problemas.length > 0) { setErrores(problemas); return; }

    setGuardando(true);
    setErrores([]);
    try {
      await agregarEmail({
        db, organizacion, usuario,
        email: form.email, alias: form.alias, principal: form.principal,
      });
      cerrarForm();
      if (onCambio) onCambio('Correo agregado');
    } catch (err) {
      console.error(err);
      setErrores([traducirError(err)]);
    } finally {
      setGuardando(false);
    }
  }

  async function quitar(e) {
    if (!window.confirm(`¿Sacar "${e.email}" de ${organizacion.razon_social}?\n\nDeja de recibir los avisos. Queda registrado en el historial.`)) return;
    setGuardando(true);
    try {
      await quitarEmail({ db, organizacion, emailDoc: e, usuario });
      if (onCambio) onCambio('Correo quitado');
    } catch (err) {
      console.error(err);
      window.alert(traducirError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function hacerPrincipal(e) {
    setGuardando(true);
    try {
      await marcarEmailPrincipal({ db, organizacion, emailDoc: e, usuario });
      if (onCambio) onCambio('Correo principal actualizado');
    } catch (err) {
      console.error(err);
      window.alert(traducirError(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      {editable && !mostrandoForm && !(renderVacio && !cargando && ordenados.length === 0) && (
        <div style={{ ...styles.cardActions, marginBottom: 12 }}>
          <Boton onClick={abrirForm}>+ Agregar</Boton>
        </div>
      )}

      {mostrandoForm && editable && (
        <div style={{ marginBottom: 16 }}>
          {errores.length > 0 && (
            <div style={styles.bannerError}>
              {errores.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}

          <div style={styles.grid2}>
            <div style={styles.formField}>
              <label style={styles.label}>Correo *</label>
              <input
                style={styles.input}
                type="email"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                placeholder="despacho@empresa.com"
                autoFocus
              />
            </div>
            <div style={styles.formField}>
              <label style={styles.label}>Alias</label>
              <input
                style={styles.input}
                value={form.alias}
                onChange={e => setForm({ ...form, alias: e.target.value })}
                placeholder="Logística"
              />
              <span style={styles.ayuda}>Para qué se usa. Opcional.</span>
            </div>
          </div>

          <div style={styles.formField}>
            <label style={styles.check}>
              <input
                type="checkbox"
                checked={form.principal}
                onChange={e => setForm({ ...form, principal: e.target.checked })}
              />
              <span>Es el correo principal</span>
            </label>
          </div>

          <div style={{ ...styles.cardActions, marginTop: 12 }}>
            <Boton disabled={guardando} onClick={guardar}>
              {guardando ? 'Guardando...' : 'Agregar'}
            </Boton>
            <Boton variante="secundario" onClick={cerrarForm}>Volver a la lista</Boton>
          </div>
        </div>
      )}

      {!mostrandoForm && (
        <>
          {cargando && <Vacio titulo="Cargando..." />}

          {!cargando && ordenados.length === 0 && renderVacio && renderVacio(abrirForm, editable)}

          {!cargando && ordenados.length === 0 && !renderVacio && (
            <Vacio
              titulo={`${organizacion.razon_social} no tiene correos cargados.`}
              nota={editable ? 'Agregá uno para que reciba los avisos.' : undefined}
            />
          )}

          {ordenados.map(e => (
            <div key={e.id} style={styles.domicilioCard}>
              <div style={styles.domicilioRow}>
                <span style={styles.domicilioDireccion}>
                  {e.email}
                  {e.alias && <span style={styles.domicilioAlias}> · {e.alias}</span>}
                </span>

                {e.principal && <Pastilla chico colores={PILLS.principal}>Principal</Pastilla>}

                {editable && (
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    {!e.principal && (
                      <Boton chico variante="secundario" disabled={guardando} onClick={() => hacerPrincipal(e)}>
                        Hacer principal
                      </Boton>
                    )}
                    <Boton chico variante="peligro" disabled={guardando} onClick={() => quitar(e)}>
                      Sacar
                    </Boton>
                  </span>
                )}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// Copia local de `traducirError` de `GestionDomiciliosOrganizacion.js` (no se
// refactoriza esa para compartirla: fuera del alcance de v1.2.2).
function traducirError(err) {
  if (err && err.code === 'permission-denied') {
    return 'Firestore rechazó la escritura. Puede ser que tu usuario no tenga '
         + 'permiso, o que falte su documento en el modelo nuevo. '
         + 'Revisá la consola del navegador para el detalle.';
  }
  if (err && err.code === 'failed-precondition') {
    return 'Falta un índice en Firestore. En la consola del navegador hay un '
         + 'link para crearlo con un clic.';
  }
  return (err && err.message) || 'Error desconocido.';
}
