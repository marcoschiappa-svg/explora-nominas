/**
 * =============================================================================
 * organizaciones/estilos.js — v1.2.0 (rediseño Organizaciones)
 * =============================================================================
 *
 * SÍNTOMA
 *   `Organizaciones.js` (1325 líneas, lista + formulario a pantalla completa +
 *   sub-vista de usuarios) se parte en varios archivos dentro de
 *   `pages/organizaciones/` para que el clic en una fila abra un modal en vez
 *   de reemplazar la pantalla (Domicilios/Usuarios/Productos, igual). Cada
 *   pieza nueva necesita el mismo `crearEstilos(colores, oscuro)` +
 *   `useEstilos()`.
 *
 * CAUSA RAÍZ
 *   No había un lugar único, scoped a esta pantalla, para los estilos que
 *   comparten el orquestador y sus modales (lista en filas, modal de dos
 *   columnas, panel cálido "RESUMEN", formularios).
 *
 * ALCANCE
 *   Un solo `useEstilos()` para todo `pages/organizaciones/` -- mismo
 *   criterio que ya usa `pages/nuevo-tarifario/estilos.js`. Sin paleta cálida
 *   propia (a diferencia de `paletaTarifario`): el panel "RESUMEN" usa
 *   `colores.fondoAlterno`/`colores.borde`, tokens generales del tema, porque
 *   esta pantalla no tiene una paleta de marca propia como Pedidos o el
 *   Tarifario.
 *
 * LIMITACIONES CONOCIDAS
 *   Ninguna -- es el traslado de `crearEstilos`/`useEstilos` que ya tenía
 *   `Organizaciones.js`, ampliado con las piezas nuevas del rediseño (fila de
 *   `PanelLista`, modal de dos columnas, panel cálido).
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Cualquier modal de Organizaciones
 *   en claro y oscuro: ningún color hexadecimal debería aparecer fuera de
 *   `ui/tokens.js`.
 * ========================================================================== */

import { useMemo } from 'react';
import { useTema } from '../../ui/TemaContext';
import { espacio, radio, tipografia, colorEstado, paletaTexto } from '../../shared/tokens';

export function crearEstilos(colores, oscuro) {
  const pal = paletaTexto(oscuro);

  return {
    wrap: { maxWidth: 1040, margin: '0 auto', padding: '1.5rem 1rem', background: colores.fondo, color: colores.texto },
    panelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', gap: espacio.sm, flexWrap: 'wrap' },
    titulo: { fontSize: 18, fontWeight: tipografia.peso.medio, color: colores.texto },

    // Fila de un PanelLista -- borde inferior salvo la última.
    fila: (esUltima) => ({
      display: 'flex', alignItems: 'center', gap: espacio.sm, padding: `10px ${espacio.md}px`,
      borderBottom: esUltima ? 'none' : `0.5px solid ${colores.borde}`, flexWrap: 'wrap', cursor: 'pointer',
    }),
    filaInactiva: { opacity: 0.6 },
    filaPrincipal: { display: 'flex', alignItems: 'center', gap: espacio.sm, flexWrap: 'wrap', width: '100%' },
    filaRazon: { fontSize: tipografia.tamano.md, fontWeight: tipografia.peso.medio, color: colores.texto },
    filaIdentificador: { fontSize: tipografia.tamano.xs, color: pal.azul, display: 'block' },
    filaLocalidad: { fontSize: tipografia.tamano.sm, color: pal.azul },
    filaAcciones: { marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' },
    filaProductos: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 8, paddingTop: 8, borderTop: `0.5px solid ${colores.borde}`, width: '100%' },

    grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 },
    ayuda: { fontSize: 11, color: pal.azul, lineHeight: 1.4 },
    check: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: colores.texto, marginBottom: 6, cursor: 'pointer' },
    seccion: { marginBottom: '1.5rem' },
    seccionTitulo: { fontSize: 12, fontWeight: tipografia.peso.medio, color: pal.azul, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, paddingBottom: 6, borderBottom: `0.5px solid ${colores.borde}` },
    cardActions: { display: 'flex', gap: 8 },

    soloLectura: { padding: '8px 12px', borderRadius: radio.md, background: colores.fondoAlterno, color: pal.azul, fontSize: tipografia.tamano.sm, marginBottom: 12 },
    editandoBanner: { padding: '10px 14px', borderRadius: 8, background: colorEstado.advertenciaFondo, border: `0.5px solid ${colorEstado.advertenciaBorde}`, fontSize: 13, color: colorEstado.advertenciaTexto, marginBottom: 16 },
    bannerAviso: { padding: '10px 14px', borderRadius: 8, background: colorEstado.advertenciaFondo, border: `0.5px solid ${colorEstado.advertenciaBorde}`, fontSize: 13, color: colorEstado.advertenciaTexto, marginBottom: 12, lineHeight: 1.5 },
    bannerError: { padding: '10px 14px', borderRadius: 8, background: colorEstado.peligroFondo, border: `0.5px solid ${colorEstado.peligroBordeAlterno}`, fontSize: 13, color: colorEstado.peligroTexto, marginBottom: 12, whiteSpace: 'pre-line' },

    // Modal de dos columnas -- mismo patrón que `nuevo-tarifario/ModalDetalleRuta.js`.
    modalDosColumnas: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 },
    modalColumna: { display: 'flex', flexDirection: 'column' },

    // Panel "RESUMEN" -- cálido pero con tokens generales (sin paleta propia).
    panelResumen: { background: colores.fondoAlterno, border: `1px solid ${colores.borde}`, borderRadius: radio.lg, padding: espacio.md },
    panelResumenTitulo: { fontSize: 11, color: pal.azul, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: espacio.sm, fontWeight: tipografia.peso.negrita },
    panelResumenBloque: { marginBottom: espacio.md },
    panelResumenBloqueTitulo: { fontSize: tipografia.tamano.xs, color: pal.azul, marginBottom: 4 },
    panelResumenValor: { fontSize: tipografia.tamano.sm, color: colores.texto },
    panelResumenEnlace: { border: 'none', background: 'none', color: colorEstado.acentoAzulFuerte, cursor: 'pointer', padding: 0, font: 'inherit', textDecoration: 'underline', fontSize: tipografia.tamano.xs },

    claveField: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 },
    label: { fontSize: 11, color: pal.azul },
    claveValor: { fontSize: 15, color: colores.texto },
    claveValorMono: { fontSize: 15, color: colores.texto, fontFamily: 'monospace', letterSpacing: '0.03em' },

    // Domicilios -- extraído de Domicilios.js (hoy con colores fijos).
    formField: { display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 },
    input: { fontSize: 13, padding: '8px 10px', borderRadius: radio.md, border: `0.5px solid ${colores.borde}`, color: colores.texto, background: colores.superficie, width: '100%', boxSizing: 'border-box' },
    sugerencias: { background: colores.fondoAlterno, border: `0.5px solid ${colores.borde}`, borderRadius: radio.md, padding: '8px 10px', marginBottom: 12 },
    sugerenciasTitulo: { fontSize: 11, color: pal.azul, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 },
    sugerencia: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', textAlign: 'left', padding: '6px 8px', borderRadius: 6, border: 'none', background: colores.superficie, fontSize: 12, color: colores.texto, cursor: 'pointer', marginBottom: 4 },
    sugerenciaNota: { fontSize: 11, color: pal.azul, flexShrink: 0 },
    bannerOk: { padding: '10px 14px', borderRadius: 8, background: colorEstado.exitoFondo, border: `0.5px solid ${colorEstado.exitoBorde}`, fontSize: 13, color: colorEstado.exitoTexto, marginBottom: 12 },
    domicilioCard: { background: colores.superficie, border: `0.5px solid ${colores.borde}`, borderRadius: radio.md, overflow: 'hidden', marginBottom: 8 },
    domicilioRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: colores.fondoAlterno, flexWrap: 'wrap' },
    domicilioDireccion: { fontSize: 13, color: colores.texto, flex: 2, minWidth: 200 },
    domicilioAlias: { fontSize: 12, color: pal.azul },

    empty: { textAlign: 'center', padding: '2rem', color: pal.azul, fontSize: 13, lineHeight: 1.6 },
  };
}

export function useEstilos() {
  const { colores, oscuro } = useTema();
  return useMemo(() => crearEstilos(colores, oscuro), [colores, oscuro]);
}
