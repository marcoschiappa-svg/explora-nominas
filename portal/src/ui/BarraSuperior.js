/**
 * =============================================================================
 * BarraSuperior.js — B1: una sola barra para todo el portal
 * =============================================================================
 *
 * PROPÓSITO
 * Reemplaza al `Topbar` chico (logo + "← Volver") que hoy tiene cada pantalla
 * por separado, Y sube acá lo que hoy SOLO existe en `Home.js`: el toggle de
 * modo oscuro, cambiar contraseña, cerrar sesión.
 *
 * -----------------------------------------------------------------------------
 * FONDO ROJO FIJO — NO CAMBIA CON EL TEMA, A PROPÓSITO
 * -----------------------------------------------------------------------------
 * La primera versión usaba `colores.superficie` (blanco casi transparente en
 * modo oscuro, pensado para ir SOBRE un fondo oscuro). Como la barra es lo
 * primero de la página y no tiene nada oscuro detrás, se veía prácticamente
 * igual en los dos modos — el "no cambia" que se notó al probarla.
 *
 * Ahora el fondo es `marca` (`#C60000`) siempre, en los dos temas. Esto
 * además resuelve el problema de raíz sin parchear nada: una barra de marca
 * no necesita "adaptarse" al tema, es la identidad visual fija de Explora —
 * y de paso, el texto/iconos pueden ser blancos siempre, sin tener que
 * recalcular contraste según el modo.
 *
 * -----------------------------------------------------------------------------
 * EL LOGO
 * -----------------------------------------------------------------------------
 * `logo_explora_modo_oscuro.png` — la versión pensada para ir sobre un fondo
 * de color, no la del ícono chico ("e") que se usaba antes. Como el fondo ya
 * es siempre rojo, no hace falta el `filter: invert()` que tenía la versión
 * anterior para simular el cambio: es el mismo logo siempre.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ESTE ARCHIVO NO TIENE SU PROPIO `position: sticky`
 * -----------------------------------------------------------------------------
 * Antes lo tenía, y por eso se superponía mal con `FranjaEntorno` al hacer
 * scroll: los dos elementos peleaban por el mismo `top: 0` como si fueran
 * dos cosas independientes, en vez de una sola franja fija arriba de todo.
 * Ahora el `sticky` lo pone `App.js`, envolviendo `FranjaEntorno` y esta
 * barra juntas en un solo contenedor — así se mueven como una unidad.
 *
 * -----------------------------------------------------------------------------
 * DÓNDE SE ENGANCHA
 * -----------------------------------------------------------------------------
 * `App.js`, dentro del contenedor sticky compartido con `FranjaEntorno`. El
 * logo, al clickearse, llama a `onIrAInicio`.
 *
 * -----------------------------------------------------------------------------
 * QUÉ SE SACA DE CADA PANTALLA
 * -----------------------------------------------------------------------------
 * El `Topbar` local de `Pedidos.js`, `Programacion.js`, `MisDespachos.js`,
 * `MisViajes.js`, `Usuarios.js` (y el resto, a medida que se migren) queda
 * redundante y se saca — esta barra ya lo cubre.
 *
 * -----------------------------------------------------------------------------
 * CONSECUENCIA DEL MODO OSCURO QUE HAY QUE TENER PRESENTE
 * -----------------------------------------------------------------------------
 * Esta barra ya no cambia de color con el toggle —a propósito, ver arriba—,
 * pero `Pie.js` sí. El CONTENIDO de cada pantalla todavía no cambia, hasta
 * que se migre a `tokens.js`/`TemaContext`. No es un error: es el estado
 * intermedio esperable mientras dura la migración pantalla por pantalla.
 *
 * -----------------------------------------------------------------------------
 * CAMBIAR CONTRASEÑA — MIGRADO DESDE `Home.js`, MISMA LÓGICA
 * -----------------------------------------------------------------------------
 * El formulario y la validación son los mismos tres campos que ya tenía
 * `Home.js` (actual, nueva, confirmar), con la misma llamada a
 * `reauthenticateWithCredential` + `updatePassword` de Firebase Auth.
 *
 * USO
 *   <BarraSuperior usuario={usuario} onIrAInicio={() => setModulo('home')}
 *                  onLogout={handleLogout} />
 * ========================================================================== */

import React, { useState } from 'react';
import { auth } from '../firebase';
import { updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { marca, colorEstado, espacio, radio, tipografia } from './tokens';
import { useTema } from './TemaContext';
import Modal from './Modal';
import Boton from './Boton';
import Campo from './Campo';

const ROL_LABEL = {
  admin: 'Administrador', coordinador: 'Coordinador', comercial: 'Comercial',
  transportista: 'Transportista', chofer: 'Chofer',
};

export default function BarraSuperior({ usuario, onIrAInicio, onLogout }) {
  const { oscuro, alternar } = useTema();
  const [modalPass, setModalPass] = useState(false);

  const rol = usuario?.rol || '';

  return (
    <>
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 20px', background: marca,
        }}
      >
        <button
          onClick={onIrAInicio}
          title="Ir al inicio"
          style={{
            display: 'flex', alignItems: 'center', gap: espacio.sm,
            background: 'transparent', border: 'none', cursor: 'pointer', padding: 4,
          }}
        >
          <img src="/logo_explora_modo_oscuro.png" alt="Explora" style={{ height: 26, objectFit: 'contain' }} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: espacio.sm }}>
          {usuario && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginRight: espacio.xs }}>
              <span style={{ fontSize: tipografia.tamano.md, fontWeight: tipografia.peso.medio, color: '#fff' }}>
                {usuario.nombre || usuario.email}
              </span>
              <span style={{ fontSize: tipografia.tamano.xs, color: 'rgba(255,255,255,0.75)' }}>
                {ROL_LABEL[rol] || rol}
              </span>
            </div>
          )}

          <BotonIcono onClick={alternar} titulo={oscuro ? 'Modo claro' : 'Modo oscuro'}>
            {oscuro ? '☀️' : '🌙'}
          </BotonIcono>

          {usuario && (
            <BotonIcono onClick={() => setModalPass(true)} titulo="Cambiar contraseña">
              🔑
            </BotonIcono>
          )}

          {usuario && (
            <BotonIcono onClick={onLogout} titulo="Cerrar sesión">
              🚪
            </BotonIcono>
          )}
        </div>
      </div>

      {modalPass && <ModalCambiarPassword onCerrar={() => setModalPass(false)} />}
    </>
  );
}

/** Botón chico, blanco sobre el fondo rojo de la barra — mismo tratamiento para tema, contraseña y salir. */
function BotonIcono({ onClick, titulo, children }) {
  return (
    <button
      onClick={onClick}
      title={titulo}
      style={{
        padding: '6px 10px', borderRadius: radio.md, fontSize: 14, cursor: 'pointer',
        background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.28)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; }}
    >
      {children}
    </button>
  );
}

/**
 * Migrado tal cual de `Home.js`: mismos tres campos, misma validación, misma
 * llamada a Firebase Auth. Separado en su propio componente acá adentro
 * porque solo lo usa `BarraSuperior` — no hace falta exportarlo aparte.
 */
function ModalCambiarPassword({ onCerrar }) {
  const [passActual, setPassActual] = useState('');
  const [passNueva, setPassNueva] = useState('');
  const [passConfirm, setPassConfirm] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);
  const [guardando, setGuardando] = useState(false);

  async function guardar(e) {
    e.preventDefault();
    setError('');
    if (!passActual || !passNueva || !passConfirm) { setError('Completá todos los campos.'); return; }
    if (passNueva !== passConfirm) { setError('Las contraseñas nuevas no coinciden.'); return; }
    if (passNueva.length < 8) { setError('La contraseña debe tener al menos 8 caracteres.'); return; }

    setGuardando(true);
    try {
      const user = auth.currentUser;
      const credential = EmailAuthProvider.credential(user.email, passActual);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, passNueva);
      setOk(true);
      setTimeout(onCerrar, 1500);
    } catch (err) {
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') setError('La contraseña actual es incorrecta.');
      else if (err.code === 'auth/requires-recent-login') setError('Por seguridad, cerrá sesión y volvé a ingresar antes de cambiar la contraseña.');
      else setError('Error al cambiar la contraseña. Intentá de nuevo.');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Cambiar contraseña" onCerrar={onCerrar}>
      {ok ? (
        <div style={{
          padding: '10px 13px', borderRadius: radio.md, textAlign: 'center',
          background: colorEstado.exitoFondo, color: colorEstado.exitoTexto, fontSize: tipografia.tamano.md,
        }}>
          ✓ Contraseña actualizada correctamente.
        </div>
      ) : (
        <form onSubmit={guardar} style={{ display: 'flex', flexDirection: 'column', gap: espacio.sm }}>
          {error && (
            <div style={{
              padding: '10px 13px', borderRadius: radio.md, fontSize: tipografia.tamano.sm,
              background: colorEstado.peligroFondo, border: `1px solid ${colorEstado.peligroBordeAlterno}`, color: marca,
            }}>
              {error}
            </div>
          )}

          <Campo
            label="Contraseña actual" type="password" autoComplete="current-password"
            value={passActual} onChange={e => setPassActual(e.target.value)} placeholder="••••••••"
          />
          <Campo
            label="Contraseña nueva" type="password" autoComplete="new-password"
            value={passNueva} onChange={e => setPassNueva(e.target.value)} placeholder="Mínimo 8 caracteres"
          />
          <Campo
            label="Confirmar contraseña nueva" type="password" autoComplete="new-password"
            value={passConfirm} onChange={e => setPassConfirm(e.target.value)} placeholder="Repetila"
          />

          <Boton type="submit" disabled={guardando} style={{ marginTop: espacio.xs }}>
            {guardando ? 'Guardando...' : 'Cambiar contraseña'}
          </Boton>
          <Boton type="button" variante="secundario" onClick={onCerrar}>
            Cancelar
          </Boton>
        </form>
      )}
    </Modal>
  );
}
