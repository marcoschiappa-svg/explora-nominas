/**
 * =============================================================================
 * ActualizarScreen.js — Pantalla de bloqueo por versión mínima
 * =============================================================================
 *
 * PROPÓSITO
 * Se muestra en lugar del login y de ChoferScreen cuando la versión instalada es
 * anterior a la mínima configurada en `configuracion_app/trackex` (ver
 * versionMinima.js y App.js). Explica qué versión se necesita y lleva al chofer
 * a Google Play.
 *
 * DECISIONES
 *   - SIN botón para cerrar ni para saltear: el motivo del bloqueo es que la
 *     lógica compartida de esta versión ya es incorrecta; dejar seguir
 *     reintroduciría el problema. La única salida es actualizar.
 *   - El botón abre `market://` (la app de Play Store) y, si no se puede, la URL
 *     web de la misma ficha. El package tiene que coincidir con `android.package`
 *     de app.json (`com.explora.trackex`).
 *   - Convenciones visuales de LoginScreen.js: tema vía `useTema()`, Montserrat
 *     con `fontFamily: fuente(peso)`, insets de área segura (edge-to-edge) y
 *     `ColumnaCentrada` para limitar el ancho en pantallas grandes. `PieVersion`
 *     va al pie, hermano del contenido.
 *   - Literal de color permitido: '#fff' para texto sobre el botón de acento
 *     (`marca`), legible en los dos temas (igual que el login).
 *
 * HISTORIAL (Frente E, ajuste): la primera versión de esta pantalla se mostraba
 * ANTES del login, y el comentario de `abrirPlayStore` decía que `logApp` no
 * podía escribir. Desde el ajuste (verificación después del login, lectura de
 * `configuracion_app` con sesión) solo se muestra con sesión iniciada; el
 * comentario se corrigió. El código no cambió.
 *
 * MODELO DE DATOS: no lee ni escribe nada; recibe las versiones por props.
 * =============================================================================
 */

import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTema } from '../tema/TemaContext';
import { fuente } from '../tema/fuentes';
import { TAMANO_TITULO_LOGIN } from '../tema/dimensiones';
import { marca, espacio, radio, tipografia } from '../compartido';
import ColumnaCentrada from '../componentes/ColumnaCentrada';
import PieVersion from '../componentes/PieVersion';

/** Package de Android de TrackEx; debe coincidir con `android.package` de app.json. */
const PACKAGE_ANDROID = 'com.explora.trackex';

/** Ficha en la app de Play Store. */
const URL_MARKET = `market://details?id=${PACKAGE_ANDROID}`;

/** Ficha en la web de Play Store: respaldo si no hay app de Play Store que resuelva `market://`. */
const URL_PLAY_WEB = `https://play.google.com/store/apps/details?id=${PACKAGE_ANDROID}`;

/**
 * Abre la ficha de TrackEx en Google Play: primero `market://` y, si falla, la
 * URL web. Si ambas fallan no hay nada más que ofrecer; el error se registra en
 * consola. Esta pantalla solo se muestra con sesión iniciada, así que `logApp`
 * podría escribir en `app_logs`; no se usa porque, sin forma de abrir Play,
 * no hay acción posible y alcanza con la consola.
 *
 * @returns {Promise<void>}
 */
async function abrirPlayStore() {
  try {
    await Linking.openURL(URL_MARKET);
  } catch (errMarket) {
    try {
      await Linking.openURL(URL_PLAY_WEB);
    } catch (errWeb) {
      console.warn('abrir Play Store:', errWeb?.code, errWeb?.message);
    }
  }
}

/**
 * Pantalla de actualización obligatoria.
 *
 * @param {Object} props
 * @param {string} props.instalada Versión instalada (por ejemplo '1.1.0').
 * @param {string} props.minima Versión mínima exigida (por ejemplo '1.1.1').
 */
export default function ActualizarScreen({ instalada, minima }) {
  const { colores: c } = useTema();
  const insets = useSafeAreaInsets();
  const s = useMemo(
    () => crearEstilos(c, insets),
    // Se depende de los números y no del objeto `insets`, que cambia de
    // identidad en cada render aunque los valores sean los mismos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c, insets.top, insets.bottom, insets.left, insets.right]
  );

  return (
    <View style={s.raiz}>
      {/* Contenido centrado: logo, título, explicación y botón. */}
      <View style={s.contenido}>
        <ColumnaCentrada>
          <Image source={require('../../assets/icon.png')} style={s.logo} resizeMode="contain" />
          <Text style={s.titulo}>Actualizá TrackEx</Text>
          <Text style={s.texto}>
            {`Tenés la versión ${instalada}. Para seguir usando la app necesitás la ${minima} o posterior, disponible en Google Play.`}
          </Text>
          <TouchableOpacity style={s.btnPrimary} onPress={abrirPlayStore}>
            <Text style={s.btnPrimaryTxt}>Actualizar en Google Play</Text>
          </TouchableOpacity>
        </ColumnaCentrada>
      </View>

      {/* Pie de versión: hermano del contenido, siempre al fondo. */}
      <PieVersion />
    </View>
  );
}

/**
 * Estilos de la pantalla, agrupados por sección. Colores del tema; `marca` es el
 * acento institucional.
 *
 * @param {Object} c Colores del tema.
 * @param {{top:number,bottom:number,left:number,right:number}} insets Insets seguros.
 * @returns {Object} Estilos de `StyleSheet.create`.
 */
function crearEstilos(c, insets) {
  const peso = tipografia.peso;
  const tam = tipografia.tamano;
  return StyleSheet.create({
    // --- Contenedores ---
    raiz: { flex: 1, backgroundColor: c.fondo },
    contenido: {
      flex: 1,
      justifyContent: 'center',
      paddingTop: insets.top + espacio.xl,
      paddingBottom: espacio.xl,
      paddingLeft: Math.max(insets.left, espacio.xl),
      paddingRight: Math.max(insets.right, espacio.xl),
    },

    // --- Encabezado de marca ---
    logo: { width: 80, height: 80, alignSelf: 'center', marginBottom: espacio.lg },
    titulo: { fontSize: TAMANO_TITULO_LOGIN, fontFamily: fuente(peso.fuerte), color: c.texto, textAlign: 'center', letterSpacing: -0.5, marginBottom: espacio.md },
    texto: { fontSize: tam.md, fontFamily: fuente(peso.normal), color: c.textoSuave, textAlign: 'center', lineHeight: 22, marginBottom: espacio.xl },

    // --- Botón ---
    // '#fff': texto sobre el fondo de acento (marca); legible en los dos temas.
    btnPrimary: { backgroundColor: marca, padding: 14, borderRadius: radio.lg, alignItems: 'center' },
    btnPrimaryTxt: { color: '#fff', fontSize: tam.xl, fontFamily: fuente(peso.negrita) },
  });
}
