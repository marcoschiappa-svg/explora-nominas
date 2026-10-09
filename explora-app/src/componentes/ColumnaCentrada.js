/**
 * =============================================================================
 * ColumnaCentrada.js — Contenido centrado con ancho máximo
 * =============================================================================
 *
 * PROPÓSITO
 * "Pantalla grande, nivel 1": en una tablet o con el teléfono en horizontal, el
 * mismo diseño del teléfono queda centrado con un ancho máximo de 600 en vez de
 * estirarse de borde a borde.
 *
 * USO
 * Se pone ADENTRO de los contenedores de ancho completo (fondo del encabezado,
 * cuerpo, bottom sheet), nunca como raíz: los fondos y el degradé tienen que
 * ocupar todo el ancho y solo el contenido se centra.
 * =============================================================================
 */

import React from 'react';
import { View } from 'react-native';
import { ANCHO_MAXIMO_COLUMNA } from '../tema/dimensiones';

const estiloBase = { width: '100%', maxWidth: ANCHO_MAXIMO_COLUMNA, alignSelf: 'center' };

/**
 * @param {Object} props
 * @param {Object} [props.style] Estilos extra (se aplican después de los base).
 * @param {React.ReactNode} props.children
 */
export default function ColumnaCentrada({ style, children }) {
  return <View style={[estiloBase, style]}>{children}</View>;
}
