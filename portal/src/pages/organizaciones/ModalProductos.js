/**
 * =============================================================================
 * organizaciones/ModalProductos.js — v1.2.0 (rediseño Organizaciones)
 * =============================================================================
 *
 * SÍNTOMA
 *   El Paso 5 del rediseño pide un modal propio "Productos — <razón
 *   social>" para RF-08, en vez del checklist que hoy vive adentro del
 *   formulario de edición de la organización (condicionado a
 *   `form.es_transportista`).
 *
 * CAUSA RAÍZ
 *   RF-08 nunca tuvo su propio modal -- ver el encabezado v1.2.0 (RF-08) de
 *   `Organizaciones.js` (ahora el orquestador de esta carpeta): el checklist
 *   vivía mezclado con el resto de los campos de la organización.
 *
 * ALCANCE
 *   Mismos datos y misma regla de guardado que ya tenía RF-08: "Guardar"
 *   escribe SOLO `productos_ids` con `actualizar()` (no reescribe el resto
 *   del documento), conservando los IDs de productos desactivados que no
 *   aparecen en el checklist -- nunca se reconstruye el array entero, solo
 *   se agrega/saca del subconjunto de `productosVisibles` (los activos y no
 *   genéricos) que pasa el orquestador.
 *
 *   Chips de los productos ya declarados arriba (resueltos contra TODOS los
 *   productos, igual que antes, para que uno desactivado siga mostrando su
 *   nombre); debajo, el checklist múltiple, con buscador si hay más de 10
 *   productos activos.
 *
 *   Permisos: `puedeEditar` (= `puedeEditarOrg(org)` del orquestador, mismo
 *   criterio de siempre: admin cualquiera, coordinador sobre un transporte
 *   puro) habilita el checklist y "Guardar"; sin eso, se ven los chips en
 *   solo lectura (el comercial).
 *
 * LIMITACIONES CONOCIDAS
 *   Mismas que RF-08 ya tenía -- ninguna nueva.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Un coordinador declara productos
 *   acá y los chips de la fila de la lista se actualizan. Un comercial ve
 *   los chips sin checklist ni "Guardar".
 * ========================================================================== */

import React, { useState, useMemo } from 'react';
import Modal from '../../ui/Modal';
import Boton from '../../ui/Boton';
import Pastilla from '../../ui/Pastilla';
import Vacio from '../../ui/Vacio';
import { actualizar } from '../../datos';
import { colorEstado } from '../../ui/tokens';
import { useEstilos } from './estilos';

export default function ModalProductos({ org, productos, puedeEditar, usuario, onCerrar }) {
  const styles = useEstilos();
  const [seleccion, setSeleccion] = useState(org.productos_ids || []);
  const [busqueda, setBusqueda] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const prodsPorId = useMemo(() => new Map(productos.map(p => [p.id, p])), [productos]);

  const productosVisibles = useMemo(
    () => productos
      .filter(p => p.activo !== false && !p.es_generico)
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es')),
    [productos]
  );

  const filtrados = useMemo(() => {
    if (productosVisibles.length <= 10 || !busqueda.trim()) return productosVisibles;
    const texto = busqueda.trim().toLowerCase();
    return productosVisibles.filter(p => (p.nombre || '').toLowerCase().includes(texto));
  }, [productosVisibles, busqueda]);

  function alternar(id) {
    setSeleccion(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      await actualizar({
        coleccion: 'organizaciones',
        id: org.id,
        cambios: { productos_ids: seleccion },
        accion: 'editar_organizacion',
        entidadTipo: 'organizacion',
        usuario,
      });
      onCerrar();
    } catch (err) {
      console.error(err);
      setError((err && err.message) || 'No se pudo guardar.');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={`Productos — ${org.razon_social}`} onCerrar={onCerrar}>
      {error && <div style={styles.bannerError}>{error}</div>}

      <div style={{ ...styles.seccion }}>
        <div style={styles.seccionTitulo}>Declarados</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(org.productos_ids || []).length === 0 ? (
            <span style={styles.ayuda}>Sin productos declarados.</span>
          ) : (
            org.productos_ids.map(id => {
              const p = prodsPorId.get(id);
              return p ? (
                <Pastilla key={id} colores={{ bg: '#DBEAFE', color: colorEstado.acentoAzul }}>
                  {p.nombre}
                </Pastilla>
              ) : null;
            })
          )}
        </div>
      </div>

      {puedeEditar ? (
        <div style={styles.seccion}>
          <div style={styles.seccionTitulo}>Qué productos transporta</div>
          {productosVisibles.length > 10 && (
            <input
              style={{ ...styles.input, marginBottom: 10 }}
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar producto..."
            />
          )}
          {productosVisibles.length === 0 && (
            <Vacio titulo="No hay productos activos cargados." />
          )}
          {filtrados.map(p => (
            <label key={p.id} style={styles.check}>
              <input
                type="checkbox"
                checked={seleccion.includes(p.id)}
                onChange={() => alternar(p.id)}
              />
              <span>{p.nombre}</span>
            </label>
          ))}
          <div style={styles.ayuda}>
            Programación lo usa para avisar si el transportista elegido no
            declaró el producto del pedido -- no bloquea la asignación. Sin
            nada tildado: "sin declarar".
          </div>

          <div style={{ ...styles.cardActions, marginTop: 16 }}>
            <Boton disabled={guardando} onClick={guardar}>
              {guardando ? 'Guardando...' : 'Guardar'}
            </Boton>
            <Boton variante="secundario" onClick={onCerrar}>Cancelar</Boton>
          </div>
        </div>
      ) : (
        <div style={{ ...styles.cardActions, marginTop: 16 }}>
          <Boton variante="secundario" onClick={onCerrar}>Cerrar</Boton>
        </div>
      )}
    </Modal>
  );
}
