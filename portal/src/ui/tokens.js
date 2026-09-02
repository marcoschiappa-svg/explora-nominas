/**
 * =============================================================================
 * tokens.js — B1: los valores, no repetidos por novena vez
 * =============================================================================
 *
 * PROPÓSITO
 * Un solo lugar para colores, espaciados, tipografía y radios. Hoy hay un
 * objeto `styles` con las mismas ~50 líneas al final de `Pedidos.js`,
 * `Programacion.js`, `MisDespachos.js`, `Usuarios.js`, `Organizaciones.js`,
 * `Domicilios.js`, `Productos.js`, `Camiones.js` y `MisViajes.js` — los mismos
 * colores, los mismos bordes, escritos nueve veces.
 *
 * -----------------------------------------------------------------------------
 * LA MARCA — ROJO MALBORO, `#C60000`
 * -----------------------------------------------------------------------------
 * Decisión explícita: unificar con el rojo que ya usa `estilos.css` (Control
 * Presupuestario), no el `#C8102E` que tenían hoy los botones del portal —son
 * tonos parecidos, de dos proyectos distintos, y se elige a propósito
 * quedarse con uno solo para toda la marca Explora.
 *
 * CONSECUENCIA QUE HAY QUE TENER PRESENTE MIENTRAS DURE LA MIGRACIÓN: las
 * pantallas que todavía no se migraron a `ui/` siguen con `#C8102E` escrito a
 * mano en su propio `styles` — van a convivir los dos rojos, uno en la barra
 * superior y el pie (ya migrados) y otro en el contenido de cada pantalla
 * vieja, hasta que se migre una por una. No es un error, es el estado
 * intermedio esperable.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ CLARO/OSCURO SON DOS OBJETOS, NO UNO CON UN FLAG
 * -----------------------------------------------------------------------------
 * `Home.js` ya tenía esta misma idea (`light`/`dark`), local y solo para esa
 * pantalla. Ahora que el modo oscuro lo va a manejar `TemaContext.js` para
 * TODO el portal —barra superior, pie de página, y cada componente de `ui/`
 * a medida que se migre—, el par claro/oscuro se muda acá, al lugar central.
 *
 * Lo que NO cambia con el tema son los colores de MARCA y de ESTADO
 * (`colorEstado`) — el rojo sigue siendo el rojo, y "peligro" sigue
 * significando lo mismo en los dos modos. Lo que sí cambia es dónde se
 * apoya ese color: superficies, bordes, texto.
 *
 * -----------------------------------------------------------------------------
 * CÓMO SE USA
 * -----------------------------------------------------------------------------
 *   import { useTema } from '../ui/TemaContext';
 *   import { marca, espacio, radio, tipografia } from '../ui/tokens';
 *
 *   const { colores } = useTema();   // superficie, texto, borde... del tema actual
 *   const estilo = { color: colores.texto, padding: espacio.md };
 *
 * Los componentes de `ui/` ya resuelven esto por dentro — la mayoría de las
 * pantallas no van a necesitar tocar `tokens.js` directo.
 * ========================================================================== */

export const marca = '#C60000';
export const marcaHover = '#9A0000';

/**
 * Colores de estado y de categoría. Fijos, no cambian con el tema — son
 * información de dominio (qué significa "éxito", qué categoría es
 * "programación"), no una decisión de diseño claro/oscuro.
 */
export const colorEstado = {
  exitoTexto: '#085041',
  exitoFondo: '#E1F5EE',
  exitoBorde: '#5DCAA5',

  advertenciaTexto: '#92400E',
  advertenciaTextoFuerte: '#633806',
  advertenciaFondo: '#FEF3C7',
  advertenciaFondoAlterno: '#FAEEDA',
  advertenciaBorde: '#F59E0B',
  advertenciaBordeAlterno: '#F0D9AE',

  peligroTexto: '#B91C1C',
  peligroTextoFuerte: '#791F1F',
  peligroBorde: '#A32D2D',
  peligroBordeAlterno: '#FCA5A5',
  peligroFondo: '#FEF2F2',
  peligroFondoAlterno: '#FCEBEB',

  // Acentos por categoría — los mismos que ya usan Home.js y los módulos
  // para diferenciar de un vistazo (pedidos, transporte, admin...).
  acentoPurpura: '#3C3489',
  acentoVerde: '#0F6E56',
  acentoAzul: '#0C447C',
  acentoAmbar: '#7C4A12',
  acentoAzulFuerte: '#1D4ED8',
};

/** Superficies, bordes y texto — el par que sí cambia con el tema. */
export const temaClaro = {
  fondo: '#F8F8F8',
  fondoAlterno: '#F3F4F6',
  superficie: '#FFFFFF',
  // Solido en los dos temas, a diferencia de "superficie". Modal.js se apoya
  // sobre su propio scrim semitransparente, no sobre el fondo de la pagina
  // -- si usara "superficie" (translucido en oscuro) se transparentaria
  // dos veces (scrim + panel) y dejaria ver lo que hay detras. Mismo valor
  // que ya tenia el "modalBg" local de Home.js antes de esta migracion.
  superficieModal: '#FFFFFF',
  borde: '#E5E7EB',
  texto: '#111827',
  textoSecundario: '#374151',
  textoSuave: '#6B7280',
  textoTenue: '#9CA3AF',
};

export const temaOscuro = {
  fondo: '#0D0D0F',
  fondoAlterno: 'rgba(255,255,255,0.06)',
  // Antes 0.05 / 0.10 -- casi no se distinguian del fondo (1.11:1 / 1.27:1
  // de contraste, medido). Subido a 0.08 / 0.22 (1.20:1 / 1.94:1): se nota
  // el boton, el input y el borde de la tarjeta sin que el modo oscuro deje
  // de ser plano. Como Boton/Campo/Buscador/Tarjeta leen esto de aca, el
  // arreglo es unico y no hace falta tocar esos archivos.
  superficie: 'rgba(255,255,255,0.08)',
  superficieModal: '#18181B',
  borde: 'rgba(255,255,255,0.22)',
  texto: '#F9FAFB',
  textoSecundario: 'rgba(255,255,255,0.75)',
  textoSuave: 'rgba(255,255,255,0.5)',
  textoTenue: 'rgba(255,255,255,0.35)',
};

export const espacio = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radio = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 14,
  pastilla: 20,
};

export const tipografia = {
  familia: "'DM Sans', system-ui, sans-serif",
  tamano: {
    xs: 11,
    sm: 12,
    md: 13,
    lg: 14,
    xl: 15,
    titulo: 18,
  },
  peso: {
    normal: 400,
    medio: 500,
    negrita: 600,
  },
};

export const sombra = {
  card: '0 1px 3px rgba(0,0,0,0.06)',
  modal: '0 10px 30px rgba(0,0,0,0.18)',
};

/**
 * Reemplaza la escala de grises (textoSecundario/textoSuave/textoTenue) por
 * tonos de rojo (protagonista, familia de `marca`) y de azul (acento) --
 * decisión explícita: nada de gris, rojo primero. Nació duplicada a mano en
 * Programacion.js, MisDespachos.js y Camiones.js; se sube acá para que
 * Usuarios.js (y lo que siga) la importe en vez de copiarla una cuarta vez.
 * Los otros tres archivos siguen con su copia local por ahora -- no hace
 * falta tocarlos para que esto funcione, pero es un candidato fácil a
 * limpiar más adelante.
 *
 * `marcaHover` y `colorEstado.acentoAzul` ya andaban bien en modo claro
 * (8.85:1 y 9.84:1 contra blanco, medido). En oscuro son demasiado oscuros
 * para leerse sobre una superficie oscura, así que ahí se usan variantes más
 * claras: `colorEstado.peligroBordeAlterno` (9.05:1) para el rojo, y un
 * celeste (`#93C5FD`, 9.53:1) para el azul -- no había un tono claro de
 * acentoAzul ya definido para reusar.
 */
export function paletaTexto(oscuro) {
  return {
    rojo: oscuro ? colorEstado.peligroBordeAlterno : marcaHover,
    azul: oscuro ? '#93C5FD' : colorEstado.acentoAzul,
  };
}

