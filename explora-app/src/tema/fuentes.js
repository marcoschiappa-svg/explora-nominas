/**
 * =============================================================================
 * fuentes.js — Tipografía Montserrat de la app
 * =============================================================================
 *
 * PROPÓSITO
 * Declara las fuentes que la app carga (`useFonts(FUENTES)` en App.js) y
 * traduce un peso numérico (`tipografia.peso` de los tokens compartidos) al
 * nombre de familia nativo que hay que poner en `fontFamily`.
 *
 * DECISIONES DE DISEÑO
 *   - Montserrat, pesos 400, 500, 600, 700 y 800: los mismos de
 *     `tipografia.peso` (normal, medio, negrita, fuerte, extra) del portal.
 *   - Se importa cada peso por SUBRUTA (`@expo-google-fonts/montserrat/400Regular`)
 *     y no del índice del paquete. El índice reexporta los 18 archivos .ttf
 *     (9 pesos x normal/itálica) y Metro los empaquetaría todos en el APK.
 *   - Los nombres de fuente nativos viven ACÁ y no en `shared/tokens.js`: son un
 *     detalle de React Native; el portal usa CSS y no los necesita.
 *
 * -----------------------------------------------------------------------------
 * IMPORTANTE PARA ESCRIBIR ESTILOS
 * -----------------------------------------------------------------------------
 * En React Native cada peso de una fuente propia es una FAMILIA distinta
 * (`Montserrat_700Bold` no es "Montserrat con peso 700"). Por eso los
 * estilos tienen que usar `fontFamily: fuente(peso)` y NO la propiedad de peso (font-weight): usar
 * los dos a la vez puede producir negrita simulada en Android (el sistema
 * engorda una fuente que ya es gruesa).
 *
 * Si useFonts falla, la app sigue con la fuente del sistema (ver App.js).
 * =============================================================================
 */

import { Montserrat_400Regular } from '@expo-google-fonts/montserrat/400Regular';
import { Montserrat_500Medium } from '@expo-google-fonts/montserrat/500Medium';
import { Montserrat_600SemiBold } from '@expo-google-fonts/montserrat/600SemiBold';
import { Montserrat_700Bold } from '@expo-google-fonts/montserrat/700Bold';
import { Montserrat_800ExtraBold } from '@expo-google-fonts/montserrat/800ExtraBold';

/** Objeto para `useFonts`: nombre de familia → archivo. */
export const FUENTES = {
  Montserrat_400Regular,
  Montserrat_500Medium,
  Montserrat_600SemiBold,
  Montserrat_700Bold,
  Montserrat_800ExtraBold,
};

/** Peso numérico → familia nativa. */
const FAMILIA_POR_PESO = {
  400: 'Montserrat_400Regular',
  500: 'Montserrat_500Medium',
  600: 'Montserrat_600SemiBold',
  700: 'Montserrat_700Bold',
  800: 'Montserrat_800ExtraBold',
};

/**
 * Devuelve la familia nativa para un peso.
 *
 * Un peso desconocido (por ejemplo 300 o `undefined`) cae a 400: es preferible
 * un texto con peso normal a un `fontFamily` inexistente, que en Android
 * hace caer el texto a la fuente del sistema sin avisar.
 *
 * @param {number} peso Uno de `tipografia.peso` (400..800).
 * @returns {string} Nombre de familia, p. ej. 'Montserrat_700Bold'.
 */
export function fuente(peso) {
  return FAMILIA_POR_PESO[peso] || FAMILIA_POR_PESO[400];
}
