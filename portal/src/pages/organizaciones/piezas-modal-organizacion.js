/**
 * =============================================================================
 * organizaciones/piezas-modal-organizacion.js — v1.2.2 (rediseño del modal)
 * =============================================================================
 *
 * SÍNTOMA
 *   El modal de organización rediseñado repite las mismas piezas visuales
 *   (chips, tarjetas, estados vacíos, avatar, íconos) en el armazón, la ficha,
 *   la pestaña de usuarios y la de productos.
 *
 * CAUSA RAÍZ
 *   Sin un archivo común, cada pestaña copiaría su propio markup.
 *
 * ALCANCE
 *   `Chip`, `Tarjeta`, `EstadoVacio`, `Avatar`, `Icono` (SVG inline, sin
 *   librería) y `useTonos()`. Los colores salen SOLO de tokens: `colorEstado`
 *   para éxito / advertencia / peligro, el tema (`useTema`) para superficies,
 *   bordes y texto, y `paletaTexto(oscuro)` para el azul y el rojo de texto.
 *
 * LIMITACIONES CONOCIDAS
 *   Los tintes de `colorEstado` son fijos en los dos temas (igual que los
 *   banners de `estilos.js`).
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. En claro y oscuro no aparece ningún
 *   hexadecimal fuera de `shared/tokens.js`.
 * ========================================================================== */

import React from 'react';
import { useTema } from '../../ui/TemaContext';
import { colorEstado, paletaTexto, marca, radio, tipografia } from '../../shared/tokens';

/** Pares { bg, color, borde } por tono, resueltos contra el tema actual. */
export function useTonos() {
  const { colores, oscuro } = useTema();
  const pal = paletaTexto(oscuro);
  return {
    colores, oscuro, pal,
    tonos: {
      exito: { bg: colorEstado.exitoFondo, color: colorEstado.exitoTexto, borde: colorEstado.exitoBorde },
      aviso: { bg: colorEstado.advertenciaFondo, color: colorEstado.advertenciaTexto, borde: colorEstado.advertenciaBorde },
      peligro: { bg: colorEstado.peligroFondo, color: colorEstado.peligroTexto, borde: colorEstado.peligroBordeAlterno },
      neutro: { bg: colores.fondoAlterno, color: colores.textoSecundario, borde: colores.borde },
      info: { bg: colores.fondoAlterno, color: pal.azul, borde: colores.borde },
    },
  };
}

export function Chip({ tono = 'neutro', punto = false, children, style }) {
  const { tonos } = useTonos();
  const t = tonos[tono];
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px',
        borderRadius: radio.pastilla, background: t.bg, color: t.color, border: `1px solid ${t.borde}`,
        fontSize: tipografia.tamano.sm, fontWeight: tipografia.peso.negrita, fontFamily: tipografia.familia,
        whiteSpace: 'nowrap', ...style,
      }}
    >
      {punto && <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: t.color }} />}
      {children}
    </span>
  );
}

export function Tarjeta({ children, onClick, style, ...resto }) {
  const { colores } = useTema();
  const comun = {
    border: `1.5px solid ${colores.borde}`, borderRadius: 14, background: colores.superficie,
    color: colores.texto, fontFamily: tipografia.familia, boxSizing: 'border-box', ...style,
  };
  if (onClick) {
    return <button type="button" onClick={onClick} style={{ ...comun, cursor: 'pointer', textAlign: 'left', font: 'inherit', ...style }} {...resto}>{children}</button>;
  }
  return <div style={comun} {...resto}>{children}</div>;
}

export function Avatar({ texto, tamano = 36, redondo = true, fondo }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: tamano, height: tamano, borderRadius: redondo ? '50%' : 14, background: fondo || marca,
        color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: tipografia.peso.fuerte, fontSize: Math.round(tamano * 0.36), flexShrink: 0,
        fontFamily: tipografia.familia,
      }}
    >
      {texto}
    </span>
  );
}

export function EstadoVacio({ icono, titulo, texto, children }) {
  const { colores, tonos } = useTonos();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '64px 28px', textAlign: 'center', fontFamily: tipografia.familia }}>
      {icono && (
        <span aria-hidden="true" style={{ width: 64, height: 64, borderRadius: 18, background: tonos.aviso.bg, color: tonos.aviso.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icono nombre={icono} tamano={30} />
        </span>
      )}
      <div style={{ fontSize: 17, fontWeight: tipografia.peso.negrita, color: colores.texto }}>{titulo}</div>
      {texto && <div style={{ fontSize: 13.5, color: colores.textoSuave, maxWidth: 380 }}>{texto}</div>}
      {children}
    </div>
  );
}

const TRAZOS = {
  check: <path d="M5 12l5 5 9-10" />,
  cerrar: <path d="M6 6l12 12M18 6L6 18" />,
  alerta: <><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v5M12 18h.01" /></>,
  exclamar: <path d="M12 6v8M12 18h.01" />,
  caja: <path d="M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10" />,
  camion: <><path d="M2 6h11v10H2zM13 9h4l3 3v4h-7" /><circle cx="6" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></>,
  pin: <><path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
  reloj: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  flecha: <path d="M9 6l6 6-6 6" />,
  basura: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  correo: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
};

export function Icono({ nombre, tamano = 16, grosor = 2 }) {
  return (
    <svg aria-hidden="true" width={tamano} height={tamano} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={grosor} strokeLinecap="round" strokeLinejoin="round">
      {TRAZOS[nombre]}
    </svg>
  );
}
