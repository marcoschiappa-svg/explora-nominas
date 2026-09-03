/**
 * =============================================================================
 * Boton.js — B1
 * =============================================================================
 *
 * Los cuatro estilos de botón que ya existen, repetidos, en cada pantalla:
 * `btnPrimary`, `btnSecundario`, `btnSuspender`/`btnChicoRojo` (peligro), y la
 * variante `chico` (los botones pequeños dentro de una fila, tipo "Editar
 * fecha" o "Cancelar" en `Programacion.js`).
 *
 * Hoy `btnPrimary` mide `8px 16px` en unas pantallas y `7px 14px` en otras —
 * nadie lo decidió así, es lo que queda cuando se copia y pega el bloque de
 * estilos de otra pantalla y se lo edita un poco. Acá hay una sola medida por
 * variante.
 *
 * `secundario` es el único que depende del tema (usa `colores.superficie` /
 * `colores.borde` de `useTema()`) — `primario` y `peligro` son colores de
 * marca/estado, fijos en los dos modos.
 *
 * USO
 *   import Boton from '../ui/Boton';
 *   <Boton onClick={guardar}>Guardar</Boton>
 *   <Boton variante="secundario" onClick={cancelar}>Cancelar</Boton>
 *   <Boton variante="peligro" chico onClick={suspender}>Suspender</Boton>
 *   <Boton disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar'}</Boton>
 *
 * `disabled` ya baja la opacidad y saca el cursor solo — no hace falta
 * calcularlo a mano en cada pantalla como `opacity: guardando ? 0.6 : 1`.
 * ========================================================================== */

import React from 'react';
import { marca, colorEstado, radio, tipografia } from './tokens';
import { useTema } from './TemaContext';

const BASE = {
  border: 'none',
  borderRadius: radio.md,
  cursor: 'pointer',
  fontFamily: tipografia.familia,
  fontWeight: tipografia.peso.medio,
  transition: 'opacity 0.15s, filter 0.15s',
};

const TAMANOS = {
  normal: { padding: '8px 16px', fontSize: tipografia.tamano.lg },
  chico: { padding: '4px 10px', fontSize: tipografia.tamano.sm, borderRadius: radio.sm },
};

export default function Boton({
  variante = 'primario',
  chico = false,
  disabled = false,
  style,
  children,
  ...resto
}) {
  const { colores } = useTema();

  const variantes = {
    primario: {
      background: marca,
      color: '#fff',
    },
    secundario: {
      background: colores.superficie,
      color: colores.textoSecundario,
      border: `0.5px solid ${colores.borde}`,
    },
    peligro: {
      // Fijo en los dos temas -- igual que ya hacen los banners de error del
      // portal (peligroFondo/peligroBorde/peligroTexto). Antes usaba
      // colores.superficie + peligroBorde como texto: en modo oscuro ese
      // texto quedaba en 2.5:1 de contraste (ilegible). Con este trio fijo
      // da 5.9-6.5:1 en los dos modos.
      background: colorEstado.peligroFondo,
      color: colorEstado.peligroTexto,
      border: `0.5px solid ${colorEstado.peligroBorde}`,
    },
  };

  const estilo = {
    ...BASE,
    ...variantes[variante],
    ...(chico ? TAMANOS.chico : TAMANOS.normal),
    opacity: disabled ? 0.6 : 1,
    cursor: disabled ? 'default' : 'pointer',
    ...style,
  };

  return (
    <button style={estilo} disabled={disabled} {...resto}>
      {children}
    </button>
  );
}
