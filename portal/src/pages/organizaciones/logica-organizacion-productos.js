/**
 * =============================================================================
 * organizaciones/logica-organizacion-productos.js — v1.2.2 (rediseño del modal)
 * =============================================================================
 *
 * SÍNTOMA
 *   En la pestaña Productos del modal rediseñado, agregar o quitar un producto
 *   tiene que escribirse al instante (chips con "x"), no con un "Guardar" como
 *   el checklist de `ModalProductos`.
 *
 * CAUSA RAÍZ
 *   `ModalProductos` reescribe `productos_ids` entero desde un estado local: dos
 *   clics rápidos, o un cambio hecho desde otra pestaña, se pisarían.
 *
 * ALCANCE
 *   `cambiarProductoDeclarado()` hace UN cambio por vez dentro de
 *   `enTransaccion`: lee la organización DENTRO de la transacción, agrega o saca
 *   solo ese ID y CONSERVA el resto (incluidos los IDs de productos
 *   desactivados, que el selector no ofrece pero no se deben perder). Una sola
 *   anotación de historial (`editar_organizacion`) por cambio. Escribe solo
 *   `productos_ids` y `actualizado_en`, así que cumple las reglas de
 *   `organizaciones` (`productosIdsValidos`, banderas sin cambios).
 *
 * LIMITACIONES CONOCIDAS
 *   No valida que el ID sea un producto que existe (lo hace el selector, que
 *   solo ofrece productos de la colección). Tope de 50 productos, igual que las
 *   reglas.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Dos altas seguidas dejan los dos IDs.
 *   Quitar uno no toca un ID de producto desactivado.
 * ========================================================================== */

import { doc, serverTimestamp } from 'firebase/firestore';
import { enTransaccion, calcularDiferencias } from '../../shared/datos';

const MAXIMO_PRODUCTOS = 50;

/**
 * @returns {Promise<boolean>} true si cambió algo
 */
export async function cambiarProductoDeclarado({ db, organizacionId, productoId, agregar, usuario }) {
  if (!db) throw new Error('cambiarProductoDeclarado: falta db');

  return enTransaccion(db, async (tx, anotar) => {
    const ref = doc(db, 'organizaciones', organizacionId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('La organización ya no existe. Actualizá la página.');

    const actual = snap.data();
    const ids = Array.isArray(actual.productos_ids) ? actual.productos_ids : [];

    let nuevos = ids;
    if (agregar && !ids.includes(productoId)) nuevos = [...ids, productoId];
    if (!agregar) nuevos = ids.filter(x => x !== productoId);

    if (nuevos.length > MAXIMO_PRODUCTOS) {
      throw new Error(`Una organización puede declarar hasta ${MAXIMO_PRODUCTOS} productos.`);
    }

    const diferencias = calcularDiferencias(actual, { productos_ids: nuevos });
    if (diferencias.campos.length === 0) return false;

    tx.update(ref, { productos_ids: nuevos, actualizado_en: serverTimestamp() });
    anotar({
      entidadTipo: 'organizacion',
      entidadId: organizacionId,
      accion: 'editar_organizacion',
      diferencias,
      usuario,
    });
    return true;
  }, 1);
}
