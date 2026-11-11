/**
 * =============================================================================
 * ModalCambiarClave.js — Bottom sheet para cambiar la contraseña (Frente F)
 * =============================================================================
 *
 * PROPÓSITO
 * Formulario con tres campos (contraseña actual, nueva y repetida) que el chofer
 * abre desde el botón 🔑 del encabezado de ChoferScreen. La validación del
 * formulario vive acá; el cambio en sí lo hace `cambiarClave` (cuenta.js).
 *
 * MODELO DE DATOS
 * No lee ni escribe Firestore. Las contraseñas viven solo en el estado del
 * componente, mientras el modal está abierto: se limpian al cerrar y nunca se
 * guardan ni se registran.
 *
 * ARQUITECTURA / DECISIONES DE DISEÑO
 *   - ASPECTO Y TECLADO: copia el del modal de "Reportar demora" de
 *     ChoferScreen (bottom sheet sobre scrim, `ColumnaCentrada`, tema con
 *     `useTema()`, Montserrat con `fuente()`, insets de `useSafeAreaInsets()`)
 *     y, como él, va dentro de un `KeyboardAvoidingView` con
 *     `behavior="padding"` para que los campos y los botones no queden bajo el
 *     teclado. Los estilos se repiten en vez de importarse porque en
 *     ChoferScreen están dentro de `crearEstilos` y no se exportan; tocar esa
 *     pantalla más de lo necesario queda fuera del alcance de este frente.
 *   - LARGO MÍNIMO 6 (`LARGO_MINIMO_CLAVE`): es el mínimo de Firebase Auth. El
 *     portal pide 8 (portal/src/ui/BarraSuperior.js). Acá se usan 6 A
 *     PROPÓSITO: los choferes la tipean en el teléfono y la contraseña
 *     inicial (`<nombre>2026`) ya puede tener 6 caracteres.
 *   - EL CAMBIO ES OPCIONAL: el modal siempre se puede cerrar y nada obliga a
 *     abrirlo.
 *   - MIENTRAS GUARDA no se puede cerrar (ni con el botón ni con "atrás"):
 *     cerrar en el medio dejaría al chofer sin saber si la contraseña cambió.
 *
 * HISTORIAL DE CORRECCIONES
 * Ninguno todavía: componente nuevo.
 *
 * DEPENDENCIAS Y ENTORNO
 * React Native (`Modal` con `statusBarTranslucent`/`navigationBarTranslucent`,
 * como los demás modales de la app; a verificar en dispositivo, igual que ellos).
 *
 * USO
 *   <ModalCambiarClave visible={modalClave} onCerrar={() => setModalClave(false)} />
 * =============================================================================
 */

import React, { useState, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, Modal, TextInput, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTema } from '../tema/TemaContext';
import { fuente } from '../tema/fuentes';
import { TAMANO_ICONO_MODAL } from '../tema/dimensiones';
import { colorEstado, espacio, radio, tipografia } from '../compartido';
import { cambiarClave, mensajeErrorClave } from '../cuenta';
import ColumnaCentrada from './ColumnaCentrada';

/**
 * Largo mínimo de la contraseña nueva. Es el mínimo de Firebase Auth; el portal
 * pide 8 y acá se usan 6 a propósito (ver la cabecera del archivo).
 */
const LARGO_MINIMO_CLAVE = 6;

/**
 * Valida el formulario antes de llamar a Firebase, para no gastar un intento de
 * reautenticación (Firebase bloquea con `auth/too-many-requests` tras varios
 * fallidos) en errores que se detectan localmente.
 *
 * @param {string} actual Contraseña actual.
 * @param {string} nueva Contraseña nueva.
 * @param {string} repetida Repetición de la contraseña nueva.
 * @returns {string} Mensaje del primer problema, o '' si el formulario es válido.
 */
function validarFormulario(actual, nueva, repetida) {
  if (!actual) return 'Ingresá tu contraseña actual.';
  if (nueva.length < LARGO_MINIMO_CLAVE) return `La contraseña nueva debe tener al menos ${LARGO_MINIMO_CLAVE} caracteres.`;
  if (nueva !== repetida) return 'Las contraseñas nuevas no coinciden.';
  if (nueva === actual) return 'La contraseña nueva tiene que ser distinta de la actual.';
  return '';
}

/**
 * @param {Object} props
 * @param {boolean} props.visible Si el modal está abierto.
 * @param {function(): void} props.onCerrar Se llama al cerrar (cancelar, "atrás" o éxito).
 */
export default function ModalCambiarClave({ visible, onCerrar }) {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const { colores: c } = useTema();
  const insets = useSafeAreaInsets();
  const s = useMemo(
    () => crearEstilos(c, insets),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c, insets.top, insets.bottom, insets.left, insets.right]
  );

  /**
   * Limpia los campos y el error, y cierra el modal. Sin la guarda de
   * `guardando`: `guardar` la usa después de terminar, cuando el valor de
   * `guardando` que ve su closure sigue siendo `true`.
   */
  function limpiarYCerrar() {
    setActual('');
    setNueva('');
    setRepetida('');
    setError('');
    onCerrar();
  }

  /**
   * Cierre pedido por el chofer (Cancelar o "atrás"). No hace nada mientras
   * guarda (ver la cabecera del archivo).
   */
  function cerrar() {
    if (guardando) return;
    limpiarYCerrar();
  }

  /**
   * Valida, cambia la contraseña y muestra el resultado. Un error de
   * `cambiarClave` se traduce con `mensajeErrorClave` y se muestra dentro del
   * modal, sin cerrarlo, para que el chofer corrija y reintente.
   */
  async function guardar() {
    setError('');
    const problema = validarFormulario(actual, nueva, repetida);
    if (problema) { setError(problema); return; }

    setGuardando(true);
    try {
      await cambiarClave(actual, nueva);
    } catch (err) {
      setError(mensajeErrorClave(err?.code));
      setGuardando(false);
      return;
    }
    setGuardando(false);
    Alert.alert('Listo: tu contraseña quedó cambiada.');
    limpiarYCerrar();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={cerrar}>
      <KeyboardAvoidingView style={s.overlay} behavior="padding">
        <View style={s.modal}>
          <ColumnaCentrada style={s.modalContenido}>
            <Text style={s.modalIco}>🔑</Text>
            <Text style={s.modalTit}>Cambiar contraseña</Text>

            <TextInput style={s.campo} placeholder="Contraseña actual" placeholderTextColor={c.textoTenue}
              value={actual} onChangeText={setActual}
              secureTextEntry autoCapitalize="none" autoCorrect={false} editable={!guardando} />
            <TextInput style={s.campo} placeholder="Contraseña nueva" placeholderTextColor={c.textoTenue}
              value={nueva} onChangeText={setNueva}
              secureTextEntry autoCapitalize="none" autoCorrect={false} editable={!guardando} />
            <TextInput style={s.campo} placeholder="Repetí la contraseña nueva" placeholderTextColor={c.textoTenue}
              value={repetida} onChangeText={setRepetida}
              secureTextEntry autoCapitalize="none" autoCorrect={false} editable={!guardando} />

            {error ? <Text style={s.error}>{error}</Text> : null}

            <TouchableOpacity style={[s.btnVerde, guardando && s.btnDeshabilitado]} onPress={guardar} disabled={guardando}>
              <Text style={s.btnBlanco}>{guardando ? 'Guardando...' : 'Cambiar contraseña'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.btnGris} onPress={cerrar} disabled={guardando}>
              <Text style={s.btnGrisTxt}>Cancelar</Text>
            </TouchableOpacity>
          </ColumnaCentrada>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* =============================================================================
 * ESTILOS
 *
 * Copia de los del modal de "Reportar demora" de ChoferScreen (overlay, modal,
 * modalContenido, modalIco, modalTit, btnVerde, btnGris, btnBlanco, btnGrisTxt),
 * más `campo` (como `textarea`, de una línea) y `error` (colores de peligro de
 * los tokens compartidos).
 * ========================================================================== */

/**
 * Arma los estilos del modal.
 *
 * @param {Object} c Colores del tema (`temaClaro` o `temaOscuro`).
 * @param {{top:number,bottom:number,left:number,right:number}} insets Insets seguros.
 * @returns {Object} Estilos de `StyleSheet.create`.
 */
function crearEstilos(c, insets) {
  const peso = tipografia.peso;
  const tam = tipografia.tamano;

  return StyleSheet.create({
    // rgba(0,0,0,0.5): scrim del modal (no hay token), igual que en ChoferScreen.
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    modal: {
      backgroundColor: c.superficieModal,
      borderTopLeftRadius: radio.pastilla,
      borderTopRightRadius: radio.pastilla,
      paddingTop: espacio.xl,
      paddingBottom: insets.bottom + espacio.xl,
      paddingLeft: Math.max(insets.left, espacio.xl),
      paddingRight: Math.max(insets.right, espacio.xl),
    },
    modalContenido: { gap: 10 },
    modalIco: { fontSize: TAMANO_ICONO_MODAL, textAlign: 'center' },
    modalTit: { fontSize: tam.titulo, fontFamily: fuente(peso.fuerte), color: c.texto, textAlign: 'center' },
    campo: { borderWidth: 1, borderColor: c.borde, backgroundColor: c.fondoAlterno, color: c.texto, fontFamily: fuente(peso.normal), borderRadius: radio.lg, padding: espacio.md, fontSize: tam.lg },
    error: { fontSize: tam.md, fontFamily: fuente(peso.medio), color: colorEstado.peligroTexto, backgroundColor: colorEstado.peligroFondo, borderWidth: 1, borderColor: colorEstado.peligroBordeAlterno, borderRadius: radio.md, padding: espacio.md, textAlign: 'center' },
    btnVerde: { backgroundColor: colorEstado.acentoVerde, borderRadius: radio.lg, padding: 14, alignItems: 'center' },
    btnDeshabilitado: { opacity: 0.6 },
    btnGris: { backgroundColor: c.superficie, borderWidth: 1, borderColor: c.borde, borderRadius: radio.lg, padding: espacio.md, alignItems: 'center' },
    btnBlanco: { color: '#fff', fontSize: tam.xl, fontFamily: fuente(peso.negrita) },
    btnGrisTxt: { fontSize: tam.lg, fontFamily: fuente(peso.normal), color: c.textoSecundario },
  });
}
