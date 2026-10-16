/**
 * =============================================================================
 * organizaciones/PestanaUsuarios.js — v1.2.2 (rediseño del modal)
 * =============================================================================
 *
 * SÍNTOMA
 *   El resumen del modal mostraba "Usuarios (7)" pero listaba solo 4 nombres.
 *
 * CAUSA RAÍZ
 *   `PanelResumen` hacía `usuarios.slice(0, 4)`.
 *
 * ALCANCE
 *   Lista de SOLO LECTURA con TODOS los usuarios de la organización (scroll
 *   del cuerpo del modal, nunca "+N más"): avatar con iniciales, nombre, chip
 *   de rol, teléfono(s) (`telefonos` unidos con " · ", "—" si no tiene) y chip
 *   "Inactivo" si corresponde. Marca "Posible duplicado" (mismo nombre
 *   normalizado o mismo DNI) sin ocultar ni deduplicar nada. El enlace
 *   "Gestionar usuarios →" abre el `ModalUsuarios` actual.
 *
 * LIMITACIONES CONOCIDAS
 *   Alta, edición y baja de usuarios siguen en `ModalUsuarios.js` y
 *   `Usuarios.js`.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Con 7 usuarios se ven los 7; dos
 *   "Vargas German" se marcan los dos como posible duplicado.
 * ========================================================================== */

import React, { useMemo } from 'react';
import { tipografia } from '../../shared/tokens';
import { detectarDuplicados, iniciales } from './logica-ficha-organizacion';
import { Chip, Avatar, Icono, EstadoVacio, useTonos } from './piezas-modal-organizacion';

export default function PestanaUsuarios({ usuarios, cargando, onGestionar }) {
  const { colores, pal, tonos } = useTonos();

  const duplicados = useMemo(() => detectarDuplicados(usuarios), [usuarios]);
  const ordenados = useMemo(() => [...usuarios].sort((a, b) => {
    if ((a.estado === 'activo') !== (b.estado === 'activo')) return a.estado === 'activo' ? -1 : 1;
    return (a.nombre || '').localeCompare(b.nombre || '', 'es');
  }), [usuarios]);
  const nombresDuplicados = useMemo(
    () => [...new Set(usuarios.filter(u => duplicados.has(u.id)).map(u => u.nombre))],
    [usuarios, duplicados]
  );

  if (cargando) return <EstadoVacio titulo="Cargando..." />;

  if (usuarios.length === 0) {
    return (
      <EstadoVacio icono="alerta" titulo="Sin usuarios" texto="Esta organización todavía no tiene ningún usuario para entrar al portal.">
        <button type="button" onClick={onGestionar} style={enlace(pal)}>Gestionar usuarios →</button>
      </EstadoVacio>
    );
  }

  return (
    <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760 }}>
      {nombresDuplicados.length > 0 && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: tonos.aviso.color, background: tonos.aviso.bg, border: `1px solid ${tonos.aviso.borde}`, borderRadius: 12, padding: '10px 14px' }}>
          <Icono nombre="alerta" tamano={18} />
          <span>
            <b style={{ fontWeight: tipografia.peso.negrita }}>{nombresDuplicados.join(', ')}</b>{' '}
            {nombresDuplicados.length === 1 ? 'aparece más de una vez' : 'aparecen más de una vez'}. Revisá si hay usuarios duplicados.
          </span>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {ordenados.map(u => {
          const dup = duplicados.has(u.id);
          const tels = (u.telefonos || []).filter(Boolean);
          return (
            <div
              key={u.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 12, flexWrap: 'wrap',
                border: `1.5px solid ${dup ? tonos.aviso.borde : colores.borde}`, background: colores.superficie,
                opacity: u.estado === 'activo' ? 1 : 0.7, fontFamily: tipografia.familia,
              }}
            >
              <Avatar texto={iniciales(u.nombre)} />
              <span style={{ flexGrow: 1, minWidth: 160, fontSize: 14, color: colores.texto }}>{u.nombre}</span>
              {(u.roles || []).map(r => <Chip key={r} tono="neutro">{r}</Chip>)}
              <span style={{ fontSize: 12.5, color: colores.textoSuave }}>Tel.: {tels.length > 0 ? tels.join(' · ') : '—'}</span>
              {u.estado !== 'activo' && <Chip tono="peligro">Inactivo</Chip>}
              {dup && <Chip tono="aviso">Posible duplicado</Chip>}
            </div>
          );
        })}
      </div>

      <button type="button" onClick={onGestionar} style={{ ...enlace(pal), alignSelf: 'flex-start' }}>Gestionar usuarios →</button>
    </div>
  );
}

function enlace(pal) {
  return { border: 'none', background: 'transparent', color: pal.azul, font: 'inherit', fontFamily: tipografia.familia, fontSize: 13.5, fontWeight: tipografia.peso.medio, cursor: 'pointer', padding: 0, textDecoration: 'underline' };
}
