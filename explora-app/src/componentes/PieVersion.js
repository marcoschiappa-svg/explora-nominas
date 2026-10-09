/**
 * =============================================================================
 * PieVersion.js — Pie con la versión de la app
 * =============================================================================
 *
 * PROPÓSITO
 * Muestra "TrackEx · v{versión}" al pie de las dos pantallas, para que soporte
 * pueda saber en un vistazo qué build tiene el chofer.
 *
 * DECISIONES
 *   - La versión sale de `Constants.expoConfig?.version` (app.json). Si no está
 *     disponible se muestra solo "TrackEx".
 *   - Es HERMANO del ScrollView, nunca hijo: así queda siempre al fondo, sin
 *     scrollear con el contenido y sin quedar tapado por la barra de gestos.
 *   - El padding inferior suma el inset de la barra del sistema (edge-to-edge) y
 *     los laterales respetan notch o cámara en horizontal.
 * =============================================================================
 */

import React, { useMemo } from 'react';
import { View, Text } from 'react-native';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTema } from '../tema/TemaContext';
import { fuente } from '../tema/fuentes';
import { tipografia, espacio } from '../compartido';

/** Pie de versión. No recibe props: lee tema e insets por su cuenta. */
export default function PieVersion() {
  const { colores: c } = useTema();
  const insets = useSafeAreaInsets();

  const estilos = useMemo(() => ({
    pie: {
      alignItems: 'center',
      backgroundColor: c.fondo,
      borderTopWidth: 1,
      borderTopColor: c.borde,
      paddingTop: espacio.sm,
      paddingBottom: insets.bottom + espacio.sm,
      paddingLeft: Math.max(insets.left, espacio.lg),
      paddingRight: Math.max(insets.right, espacio.lg),
    },
    texto: {
      fontSize: tipografia.tamano.xs,
      color: c.textoSuave,
      fontFamily: fuente(tipografia.peso.normal),
      textAlign: 'center',
    },
  }), [c, insets.bottom, insets.left, insets.right]);

  const version = Constants.expoConfig?.version;

  return (
    <View style={estilos.pie}>
      <Text style={estilos.texto}>{version ? `TrackEx · v${version}` : 'TrackEx'}</Text>
    </View>
  );
}
