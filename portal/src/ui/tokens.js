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
  fondo: '#dedfe7',
  fondoAlterno: '#F3F4F6',
  superficie: '#f9faeb',
  // Solido en los dos temas, a diferencia de "superficie". Modal.js se apoya
  // sobre su propio scrim semitransparente, no sobre el fondo de la pagina
  // -- si usara "superficie" (translucido en oscuro) se transparentaria
  // dos veces (scrim + panel) y dejaria ver lo que hay detras. Mismo valor
  // que ya tenia el "modalBg" local de Home.js antes de esta migracion.
  superficieModal: '#e9e9e9',
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

// v1.2.0 (rediseño Programación) -- Paso 0: toda la tipografía del portal
// pasa de DM Sans a Montserrat. Decisión de diseño de Ivan, con la única
// fuente que hoy tenía cada pantalla ya migrada a `ui/`: cambiar este UN
// valor alcanza para todo lo que ya usa `tipografia.familia` (la enorme
// mayoría, ver el reporte de la tarea para el detalle de V3). Los pesos que
// pide el diseño (500/600/700/800) están cargados en `index.html`.
export const tipografia = {
  familia: "'Montserrat', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
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
    // v1.2.0 (rediseño Programación) -- el diseño pide 700 para cliente/
    // títulos/badges y 800 para el título del modal, el número de entrega y
    // la fecha larga. Los pesos anteriores (400/500/600) no alcanzaban.
    fuerte: 700,
    extra: 800,
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

/**
 * =============================================================================
 * v1.2.0 (rediseño Pedidos) — TOKENS DEL DISEÑO "Portal Pedidos"
 * =============================================================================
 *
 * SÍNTOMA
 *   El diseño aprobado ("Portal Pedidos", Claude Design) usa una paleta cálida
 *   propia (fondo hueso, bordes tostados, panel de entregas color manteca) que
 *   no tenía equivalente en `temaClaro`/`temaOscuro` — esos son los neutros
 *   GENERALES del portal (grises), compartidos por todas las pantallas ya
 *   migradas a `ui/`.
 *
 * CAUSA RAÍZ
 *   No existía ningún token para: los 5 colores de estado del pedido en su
 *   versión "badge suave" (texto/fondo/borde, distinta de `COLOR_PEDIDO` de
 *   `estados.js`, que es la pastilla sólida de siempre), el panel cálido de
 *   "Entregas" del modal, ni los tres acentos de botón (fecha/dirección/
 *   suspender) que el diseño pide en un tono cada uno.
 *
 * ALCANCE
 *   `paletaPedidos(oscuro)` — un objeto scoped a la pantalla de Pedidos (no
 *   pisa `temaClaro.fondo`/`temaOscuro.fondo` ni ningún otro token general:
 *   así Programación, Ciclo de vida y el resto del portal no cambian de
 *   aspecto por este trabajo, que es solo del rediseño de Pedidos). Con
 *   equivalente en modo oscuro para cada valor, pensado para mantener
 *   contraste legible (no es una simple inversión de luminosidad).
 *
 *   `marcaHover` (`#9A0000`) ya existía y se sigue usando tal cual -- el
 *   diseño pide `#A30000` para el hover de marca, un tono muy cercano (mismo
 *   rojo, ~4% más oscuro que el existente); se decidió NO agregar un segundo
 *   token de hover casi idéntico y reusar `marcaHover`, que ya cumple la
 *   misma función en todo el portal. Diferencia informada en el reporte de
 *   la tarea, no en el producto.
 *
 * LIMITACIONES CONOCIDAS
 *   Los estados de ENTREGA (distintos de los de PEDIDO) siguen usando
 *   `COLOR_ENTREGA`, definido en `Pedidos.js` con el mismo criterio de
 *   siempre (cumplida/programada/pendiente/suspendida) -- el diseño no define
 *   una paleta propia para ese nivel, así que no se tocó.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Ver Pedidos.js en claro y oscuro:
 *   ningún color de la tabla del diseño debería aparecer como literal
 *   hexadecimal fuera de este archivo.
 * ========================================================================== */
export const radioPedidos = {
  panel: 18,
  fila: 14,
};

const ESTADOS_PEDIDO_CLARO = {
  pendiente:          { texto: '#B8720A', fondo: '#FBF0DE', borde: '#F0DCB0' },
  programado_parcial: { texto: '#6B5FB0', fondo: '#F0EDFA', borde: '#DCD5F2' },
  programado:         { texto: '#1F7A4D', fondo: '#E8F5EE', borde: '#CDEBDB' },
  cumplido:           { texto: '#1D5FA6', fondo: '#EAF1FB', borde: '#CFE0F5' },
  suspendido:         { texto: '#A13D3D', fondo: '#FBEAEA', borde: '#F0C9C9' },
};

// Modo oscuro: mismo matiz que el claro, con el fondo llevado a una
// transparencia baja sobre `temaOscuro.superficie` (en vez de un sólido
// pastel, que en oscuro se ve "flotado") y el texto aclarado para mantener
// >= 4.5:1 de contraste sobre esa superficie.
const ESTADOS_PEDIDO_OSCURO = {
  pendiente:          { texto: '#F0B84C', fondo: 'rgba(184,114,10,0.22)', borde: 'rgba(240,184,76,0.35)' },
  programado_parcial: { texto: '#B3A6EC', fondo: 'rgba(107,95,176,0.24)', borde: 'rgba(179,166,236,0.35)' },
  programado:         { texto: '#5FCB93', fondo: 'rgba(31,122,77,0.24)',  borde: 'rgba(95,203,147,0.35)' },
  cumplido:           { texto: '#7FB1E8', fondo: 'rgba(29,95,166,0.24)',  borde: 'rgba(127,177,232,0.35)' },
  suspendido:         { texto: '#E19393', fondo: 'rgba(161,61,61,0.26)',  borde: 'rgba(225,147,147,0.35)' },
};

export function paletaPedidos(oscuro) {
  return oscuro
    ? {
        fondo: '#17140F',
        superficie: temaOscuro.superficie,
        borde: temaOscuro.borde,
        separador: 'rgba(255,255,255,0.10)',
        texto: temaOscuro.texto,
        textoFuerte: '#FFFFFF',
        textoSecundario: temaOscuro.textoSecundario,
        textoTenue: temaOscuro.textoTenue,
        estados: ESTADOS_PEDIDO_OSCURO,
        panelEntregas: { fondo: 'rgba(138,90,18,0.16)', borde: 'rgba(239,223,196,0.22)', titulo: '#E3B872' },
        botonFecha: '#6FA8E0',
        botonDireccion: '#AF98E5',
        botonSuspender: '#E19393',
        sombraFila: '0 1px 2px rgba(0,0,0,.35)',
        sombraFilaHover: '0 4px 14px rgba(0,0,0,.5)',
      }
    : {
        fondo: '#F6F4F1',
        superficie: '#FFFFFF',
        borde: '#E5E1DB',
        separador: '#EFEBE7',
        texto: '#22201D',
        textoFuerte: '#151311',
        textoSecundario: '#6B625C',
        textoTenue: '#9A9188',
        estados: ESTADOS_PEDIDO_CLARO,
        panelEntregas: { fondo: '#FDF3E8', borde: '#EFDFC4', titulo: '#8A5A12' },
        botonFecha: '#1D5FA6',
        botonDireccion: '#6B4FA0',
        botonSuspender: '#A13D3D',
        sombraFila: '0 1px 2px rgba(34,32,29,.04)',
        sombraFilaHover: '0 4px 14px rgba(34,32,29,.09)',
      };
}

/**
 * =============================================================================
 * v1.2.0 (rediseño Programación) — TOKENS DEL DISEÑO "Portal Programación"
 * =============================================================================
 *
 * SÍNTOMA
 *   El diseño aprobado para `Programacion.js` pide tres colores de estado de
 *   DESPACHO ("Esperando respuesta" ámbar, "Confirmada" verde, "Sin cubrir"
 *   rojo -- ver V2 en el reporte de la tarea) y una nota de pedido roja, que
 *   no tenían token propio: no son los mismos matices que `paletaPedidos`
 *   (esa es la paleta de PEDIDO, no de DESPACHO) ni los grises fijos de
 *   `COLOR_DESPACHO` en `estados.js`.
 *
 * CAUSA RAÍZ
 *   `COLOR_DESPACHO` (`estados.js`) tiene un color POR CADA estado de
 *   despacho (siete), fijo en los dos temas -- lo que pide el diseño es
 *   distinto: agrupar esos siete en TRES estilos visuales, con equivalente en
 *   modo oscuro. Ninguno de los dos objetos podía reusarse tal cual para el
 *   otro propósito.
 *
 * ALCANCE
 *   `paletaProgramacion(oscuro)` -- scoped a esta pantalla, mismo patrón que
 *   `paletaPedidos()`: no pisa ningún token general. `estadoDespacho` trae
 *   los tres estilos (`esperando`/`confirmada`/`sinCubrir`); `chipSinCubrir`
 *   es el mismo estilo que `esperando` (mismo par de colores que pide la
 *   tabla del diseño para el chip "N sin cubrir" de la lista); `notaPedido`
 *   es la caja roja de observaciones; `fechaCargaConfirmada` y `producto` /
 *   `ovOc` / `transportista` son los acentos de texto sueltos de la tabla del
 *   diseño (los tres en rojo marca -- en oscuro, la variante clara de ese
 *   rojo que ya usa el resto del portal para texto sobre fondo oscuro).
 *
 * LIMITACIONES CONOCIDAS
 *   El mapeo de los SIETE estados de `DESPACHO` (`estados.js`) a estos TRES
 *   estilos vive en `pages/programacion/logica-vista.js`
 *   (`estiloEstadoDespacho()`), no acá -- este archivo solo define los
 *   colores, no sabe qué es un despacho `NOMINADO`. Ver el encabezado de ese
 *   archivo para el caso de `PENDIENTE_ASIGNACION` (un despacho vivo sin
 *   transportista), que el diseño no contempla explícitamente.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Ver `Programacion.js` en claro y
 *   oscuro: ningún color de esta tabla debería aparecer como literal
 *   hexadecimal fuera de este archivo.
 * ========================================================================== */
const ESTADO_DESPACHO_CLARO = {
  esperando:  { texto: '#8A5A12', fondo: '#FBF0DE', borde: '#F0DCB0' },
  confirmada: { texto: '#1F7A4D', fondo: '#E8F5EE', borde: '#CDEBDB' },
  sinCubrir:  { texto: '#A13D3D', fondo: '#FBEAEA', borde: '#F0C9C9' },
};

// Mismo criterio que ESTADOS_PEDIDO_OSCURO más arriba: matiz igual, fondo a
// baja opacidad sobre la superficie oscura, texto aclarado para >= 4.5:1.
const ESTADO_DESPACHO_OSCURO = {
  esperando:  { texto: '#E3B872', fondo: 'rgba(138,90,18,0.22)', borde: 'rgba(227,184,114,0.35)' },
  confirmada: { texto: '#5FCB93', fondo: 'rgba(31,122,77,0.24)', borde: 'rgba(95,203,147,0.35)' },
  sinCubrir:  { texto: '#E19393', fondo: 'rgba(161,61,61,0.26)', borde: 'rgba(225,147,147,0.35)' },
};

export const radioProgramacion = {
  panel: 16,
  nota: 10,
};

/**
 * =============================================================================
 * v1.2.0 (rediseño NuevoTarifario) — TOKENS DEL DISEÑO "Portal NuevoTarifario"
 * =============================================================================
 *
 * SÍNTOMA
 *   `NuevoTarifario.js` calculaba sus propios colores de categoría y de
 *   brecha (`COLOR_CATEGORIA`, `colorBrecha()`) sin pasar por `tokens.js`,
 *   mismo problema que ya resolvieron `paletaPedidos`/`paletaProgramacion`
 *   para sus pantallas: cero equivalente en modo oscuro declarado acá, y el
 *   panel cálido de "Entregas" de Pedidos no tenía forma reusable para el
 *   panel cálido de "Historial de tarifas"/"Cómo se calcula" de esta pantalla.
 *
 * CAUSA RAÍZ
 *   No existía ningún token para: los dos colores de categoría (General/
 *   Peligroso), los tres rangos de brecha contra CATAC (bajo/en rango/sobre),
 *   el chip ámbar de "pendiente de aprobación" ni el panel cálido.
 *
 * ALCANCE
 *   `paletaTarifario(oscuro)` -- scoped a esta pantalla, mismo patrón que
 *   `paletaPedidos()`/`paletaProgramacion()`: no pisa ningún token general.
 *   `panelCalido` repite a propósito los mismos valores que
 *   `paletaPedidos(oscuro).panelEntregas` (incluidas sus variantes oscuras)
 *   en vez de importarlos -- mismo criterio que ya usa `paletaProgramacion`
 *   para no acoplar la paleta de una pantalla a la de otra.
 *
 * LIMITACIONES CONOCIDAS
 *   `brecha` son colores de TEXTO (se usan también en `Pastilla`, pasando
 *   `{bg: colorEstado.*Fondo, color: brecha.*.texto}` desde donde se arme el
 *   chip) -- este objeto no decide el `bg`, lo decide quien lo usa, mismo
 *   criterio que `Pastilla.js` (no define colores de estado, los recibe).
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Ver `NuevoTarifario.js` en claro y
 *   oscuro: ningún color de esta tabla debería aparecer como literal
 *   hexadecimal fuera de este archivo.
 * ========================================================================== */
export function paletaTarifario(oscuro) {
  return {
    categoria: oscuro
      ? {
          General: { bg: 'rgba(31,122,77,0.24)', color: '#5FCB93' },
          Peligroso: { bg: 'rgba(161,61,61,0.26)', color: '#E19393' },
        }
      : {
          General: { bg: colorEstado.exitoFondo, color: colorEstado.exitoTexto },
          Peligroso: { bg: colorEstado.peligroFondo, color: colorEstado.peligroTexto },
        },
    brecha: {
      bajo: { texto: colorEstado.exitoTexto },
      enRango: { texto: colorEstado.advertenciaTextoFuerte },
      sobre: { texto: colorEstado.peligroTexto },
    },
    pendiente: oscuro
      ? { bg: 'rgba(138,90,18,0.22)', color: '#E3B872' }
      : { bg: colorEstado.advertenciaFondo, color: colorEstado.advertenciaTextoFuerte },
    panelCalido: oscuro
      ? { fondo: 'rgba(138,90,18,0.16)', borde: 'rgba(239,223,196,0.22)', titulo: '#E3B872' }
      : { fondo: '#FDF3E8', borde: '#EFDFC4', titulo: '#8A5A12' },
  };
}

export function paletaProgramacion(oscuro) {
  const estadoDespacho = oscuro ? ESTADO_DESPACHO_OSCURO : ESTADO_DESPACHO_CLARO;
  // Texto sobre fondo -- ver `paletaTexto()`: en oscuro, `marca` (#C60000)
  // sobre una superficie oscura da poco contraste, así que se usa la misma
  // variante clara que ya usa el resto del portal para "rojo, pero legible
  // en oscuro".
  const rojoTexto = oscuro ? colorEstado.peligroBordeAlterno : marca;

  return {
    estadoDespacho,
    chipSinCubrir: estadoDespacho.esperando,
    notaPedido: oscuro
      ? { texto: '#E19393', fondo: 'rgba(161,61,61,0.18)', borde: 'rgba(225,147,147,0.3)' }
      : { texto: '#A13D3D', fondo: '#FBEAEA', borde: '#F0C9C9' },
    fechaCargaConfirmada: oscuro ? '#5FCB93' : '#1F7A4D',
    producto: rojoTexto,
    ovOc: rojoTexto,
    transportista: rojoTexto,
  };
}

