/**
 * =============================================================================
 * Vacio.js — B1
 * =============================================================================
 *
 * El estado vacío que ya existe en varias pantallas y que `PENDIENTES.md`
 * explícitamente pide mantener tal como está al migrar: explica bien qué
 * hacer, no es solo un "no hay nada" seco.
 *
 * USO
 *   <Vacio titulo="No hay pedidos que coincidan." />
 *
 *   <Vacio
 *     emoji="🗂️"
 *     titulo="Todavía no tenés módulos asignados"
 *     nota="Pedile a un administrador que te asigne un rol desde el módulo de Usuarios."
 *   />
 * ========================================================================== */

import React from 'react';
import { espacio, tipografia } from './tokens';
import { useTema } from './TemaContext';

export default function Vacio({ emoji, titulo, nota }) {
  const { colores } = useTema();

  return (
    <div style={{ textAlign: 'center', padding: `${espacio.xxl}px ${espacio.lg}px`, color: colores.textoTenue }}>
      {emoji && <div style={{ fontSize: 28, marginBottom: espacio.sm }}>{emoji}</div>}
      <div style={{ fontSize: tipografia.tamano.lg, color: emoji ? colores.texto : colores.textoTenue, fontWeight: emoji ? tipografia.peso.medio : tipografia.peso.normal }}>
        {titulo}
      </div>
      {nota && (
        <div style={{ fontSize: tipografia.tamano.md, marginTop: espacio.xs, lineHeight: 1.5, maxWidth: 360, marginLeft: 'auto', marginRight: 'auto' }}>
          {nota}
        </div>
      )}
    </div>
  );
}
