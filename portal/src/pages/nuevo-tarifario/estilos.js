/**
 * =============================================================================
 * nuevo-tarifario/estilos.js — v1.2.0 (rediseño NuevoTarifario)
 * =============================================================================
 *
 * SÍNTOMA
 *   Al partir `NuevoTarifario.js` (1193 líneas) en varios componentes dentro
 *   de `pages/nuevo-tarifario/`, cada uno iba a necesitar el mismo
 *   `crearEstilos(colores, oscuro)` + `useEstilos()` que ya tenía el archivo
 *   original — repetirlo en ocho archivos sería la misma duplicación que B1
 *   ya evitó una vez con `ui/tokens.js`.
 *
 * CAUSA RAÍZ
 *   No había un lugar único, scoped a esta pantalla, para los estilos que
 *   comparten el orquestador y sus piezas (encabezado, tabla, fila, modal de
 *   dos columnas, panel cálido, formularios).
 *
 * ALCANCE
 *   Un solo `useEstilos()` para todo `pages/nuevo-tarifario/`, en vez de uno
 *   por archivo — mismo criterio que ya usa `ui/BarraFiltros.js` (un solo
 *   `crearEstilos` para un componente con varias piezas internas). Usa
 *   `paletaTarifario(oscuro)` (`ui/tokens.js`, ya agregada por este equipo)
 *   para categoría/brecha/pendiente/panel cálido, y los tokens generales
 *   (`espacio`, `radio`, `tipografia`, `colorEstado`, `paletaTexto`) para todo
 *   lo demás — nada de colores fijos.
 *
 * LIMITACIONES CONOCIDAS
 *   Ninguna — es solo el traslado de `crearEstilos`/`useEstilos` del archivo
 *   original, ampliado con las piezas nuevas del rediseño (fila de
 *   `PanelLista`, modal de dos columnas, panel cálido, caja "Cómo se
 *   calcula").
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Ver cualquier pantalla de
 *   `NuevoTarifario` en claro y oscuro: ningún color hexadecimal debería
 *   aparecer fuera de `ui/tokens.js`.
 * ========================================================================== */

import { useMemo } from 'react';
import { useTema } from '../../ui/TemaContext';
import { espacio, radio, tipografia, colorEstado, paletaTexto, paletaTarifario } from '../../ui/tokens';

export function crearEstilos(colores, oscuro) {
  const pal = paletaTexto(oscuro);
  const paleta = paletaTarifario(oscuro);

  return {
    wrap: { fontSize: tipografia.tamano.md, color: colores.texto, background: colores.fondo, minHeight: '100%', paddingBottom: espacio.xxl },
    contenido: { maxWidth: 1180, margin: '0 auto', padding: `${espacio.lg}px` },

    header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: espacio.sm, flexWrap: 'wrap', marginBottom: espacio.md },
    headerL: { display: 'flex', alignItems: 'center', gap: espacio.md },
    titulo: { fontSize: 18, fontWeight: tipografia.peso.medio, color: colores.texto },
    catacInfo: { fontSize: tipografia.tamano.xs, color: colores.textoTenue, fontFamily: 'monospace' },
    headerR: { display: 'flex', alignItems: 'center', gap: espacio.sm, flexWrap: 'wrap' },
    badgeRol: {
      borderRadius: radio.pastilla, padding: '4px 14px', fontSize: tipografia.tamano.xs,
      fontWeight: tipografia.peso.negrita, textTransform: 'uppercase', letterSpacing: '0.06em',
      background: colorEstado.acentoAmbar + '26', color: pal.rojo,
    },

    controlesFila: { display: 'flex', gap: espacio.sm, marginBottom: espacio.sm, flexWrap: 'wrap', alignItems: 'center' },

    panel: { padding: 0 },
    cardH: { fontSize: 11, fontWeight: tipografia.peso.negrita, color: colores.textoTenue, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: espacio.md },
    card: { padding: espacio.lg, marginBottom: espacio.md },
    fr: { marginBottom: espacio.md },

    label: { fontSize: tipografia.tamano.xs, fontWeight: tipografia.peso.negrita, color: colores.textoTenue, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 },
    input: { height: 34, padding: '0 10px', border: `0.5px solid ${colores.borde}`, borderRadius: radio.md, fontSize: tipografia.tamano.sm, background: colores.superficie, color: colores.texto, outline: 'none', minWidth: 160 },
    select: { height: 34, padding: '0 10px', border: `0.5px solid ${colores.borde}`, borderRadius: radio.md, fontSize: tipografia.tamano.sm, background: colores.superficie, color: colores.texto, outline: 'none', minWidth: 160 },

    // Fila de un PanelLista -- el padding/borde de cada fila; `esUltima` le
    // saca el borde inferior (PanelLista ya aporta el borde del panel).
    fila: (esUltima, clickeable = true) => ({
      display: 'flex', alignItems: 'center', gap: espacio.md, padding: `${espacio.md}px ${espacio.lg}px`,
      borderBottom: esUltima ? 'none' : `0.5px solid ${colores.borde}`,
      cursor: clickeable ? 'pointer' : 'default', flexWrap: 'wrap',
    }),
    filaTitulo: { fontWeight: tipografia.peso.negrita, color: colores.texto },
    filaProducto: { color: pal.rojo, fontSize: tipografia.tamano.sm },
    filaTenue: { color: colores.textoTenue, fontSize: tipografia.tamano.xs },
    filaDerecha: { marginLeft: 'auto', textAlign: 'right' },
    // Columna de ancho fijo y contenido centrado -- para que un chip de
    // ancho variable (p.ej. "General" vs "Peligroso") quede alineado con el
    // de la fila de abajo en vez de "flotar" donde lo deja el texto previo.
    filaColChip: { width: 96, display: 'flex', justifyContent: 'center', flexShrink: 0 },
    // Km con más peso visual que el resto de los datos tenues de la fila --
    // el pedido explícito fue "mostrar con mayor importancia la distancia
    // en km" en la vista de Filas.
    filaKm: { width: 72, flexShrink: 0, textAlign: 'center', fontSize: tipografia.tamano.md, fontWeight: tipografia.peso.negrita, color: colores.texto },

    tblWrap: { overflowX: 'auto', borderRadius: radio.lg, border: `0.5px solid ${colores.borde}`, background: colores.superficie },
    th: { padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: tipografia.peso.negrita, color: colores.textoTenue, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap', borderBottom: `0.5px solid ${colores.borde}`, background: colores.fondoAlterno },
    td: { padding: '8px 10px', borderBottom: `0.5px solid ${colores.borde}`, verticalAlign: 'middle', fontSize: tipografia.tamano.sm },
    mono: { fontFamily: 'monospace' },

    aviso: (tipo) => ({
      padding: '10px 14px', borderRadius: radio.md, fontSize: tipografia.tamano.sm, marginBottom: espacio.md,
      background: tipo === 'error' ? colorEstado.peligroFondo : tipo === 'ok' ? colorEstado.exitoFondo : colorEstado.advertenciaFondo,
      color: tipo === 'error' ? colorEstado.peligroTexto : tipo === 'ok' ? colorEstado.exitoTexto : colorEstado.advertenciaTextoFuerte,
      border: `0.5px solid ${tipo === 'error' ? colorEstado.peligroBorde : tipo === 'ok' ? colorEstado.exitoBorde : colorEstado.advertenciaBorde}`,
    }),

    // Modal de dos columnas -- mismo patrón que `Pedidos.js`.
    modalDosColumnas: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 },
    modalColumna: { display: 'flex', flexDirection: 'column' },
    modalGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: espacio.md },
    campo: { display: 'flex', flexDirection: 'column', gap: 3 },
    labelGrilla: { fontSize: tipografia.tamano.xs, color: colores.textoTenue, textTransform: 'uppercase', letterSpacing: '0.05em' },
    valor: { fontSize: tipografia.tamano.md, color: colores.texto },
    valorDestacado: { fontSize: tipografia.tamano.titulo, color: colores.texto, fontWeight: tipografia.peso.negrita },
    accionesColumna: { display: 'flex', flexDirection: 'column', gap: espacio.sm, marginTop: espacio.md },

    // Panel cálido -- "Historial de tarifas" / "Cómo se calcula".
    panelCalido: {
      background: paleta.panelCalido.fondo, border: `1px solid ${paleta.panelCalido.borde}`,
      borderRadius: radio.lg, padding: espacio.md,
    },
    panelCalidoTitulo: {
      fontSize: 11, color: paleta.panelCalido.titulo, textTransform: 'uppercase',
      letterSpacing: '0.05em', marginBottom: espacio.sm, fontWeight: tipografia.peso.negrita,
    },
    tarjetaHistorial: {
      borderLeft: `3px solid ${colorEstado.peligroTexto}`, background: colores.superficie,
      border: `0.5px solid ${colores.borde}`, borderRadius: radio.md, padding: espacio.md, marginBottom: espacio.sm,
    },

    calculoBox: { padding: espacio.md, background: colores.fondoAlterno, borderRadius: radio.md, fontSize: tipografia.tamano.sm, color: colores.textoSecundario, marginBottom: espacio.md, lineHeight: 1.6 },

    // Lista seleccionable (no desplegable) -- p.ej. las maestras sugeridas
    // de "Generar derivada": todas las opciones visibles una debajo de la
    // otra, en vez de un <select> que las esconde.
    listaSeleccionable: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: espacio.md, maxHeight: 260, overflowY: 'auto' },
    opcionLista: (activa) => ({
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: espacio.sm,
      padding: '8px 12px', borderRadius: radio.md, cursor: 'pointer', textAlign: 'left',
      border: `1px solid ${activa ? colorEstado.peligroBorde : colores.borde}`,
      background: activa ? colorEstado.peligroFondo : colores.superficie,
      color: activa ? colorEstado.peligroTexto : colores.texto,
      fontSize: tipografia.tamano.sm, fontWeight: activa ? tipografia.peso.negrita : tipografia.peso.normal,
    }),

    pasos: { display: 'flex', gap: espacio.sm, marginBottom: espacio.lg, flexWrap: 'wrap' },
    pasoItem: { display: 'flex', alignItems: 'center', gap: 6 },
    pasoNumero: (activo, hecho) => ({
      width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 11, fontWeight: tipografia.peso.negrita,
      background: hecho ? colorEstado.exitoFondo : activo ? colorEstado.peligroFondo : colores.fondoAlterno,
      color: hecho ? colorEstado.exitoTexto : activo ? colorEstado.peligroTexto : colores.textoTenue,
      border: `1px solid ${hecho ? colorEstado.exitoBorde : activo ? colorEstado.peligroBorde : colores.borde}`,
    }),
    pasoLabel: (activo) => ({ fontSize: tipografia.tamano.sm, color: activo ? colores.texto : colores.textoTenue, fontWeight: activo ? tipografia.peso.medio : tipografia.peso.normal }),

    grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: espacio.md },
  };
}

export function useEstilos() {
  const { colores, oscuro } = useTema();
  return useMemo(() => crearEstilos(colores, oscuro), [colores, oscuro]);
}
