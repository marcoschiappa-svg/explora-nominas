/* =============================================================================
 * tipos-pedido.js — Los tipos de operación, sin dependencias
 * =============================================================================
 *
 * v1.2.0 (RF-09, Paso 0) — SE ROMPE LA DEPENDENCIA CIRCULAR DE RF-10
 *
 *   SÍNTOMA
 *     Desde RF-10 existe el ciclo de imports
 *
 *         logica-despachos.js → logica-calendario.js → logica-pedidos.js
 *                             → logica-despachos.js
 *
 *     Hoy funciona de casualidad: ninguno de los tres evalúa nada al cargar
 *     el módulo (solo declara funciones y constantes), así que para cuando
 *     alguien llama a una función el ciclo ya se resolvió. Cualquier código
 *     de inicialización a nivel de módulo —una constante derivada, un
 *     `Object.freeze` sobre algo importado— rompería el ciclo con un
 *     `undefined` imposible de diagnosticar.
 *
 *   CAUSA RAÍZ
 *     `logica-calendario.js` necesita UNA sola cosa de `logica-pedidos.js`:
 *     la constante `TIPOS`, para saber si un pedido es "Entrega al cliente"
 *     (ver `evaluarFechaCarga()`). Pero importar esa constante arrastra el
 *     módulo entero, y con él su import de `logica-despachos.js`, que a su
 *     vez importa `logica-calendario.js`.
 *
 *   ALCANCE
 *     `TIPOS` se muda acá, a un módulo que NO importa nada del proyecto
 *     —ni Firestore, ni `datos.js`, ni ningún otro `logica-*`—, así que no
 *     puede participar de ningún ciclo.
 *
 *       · `logica-calendario.js` importa desde acá.
 *       · `logica-pedidos.js` lo RE-EXPORTA (`export { TIPOS }`), para que
 *         todo lo que ya hacía `import { TIPOS } from './logica-pedidos'`
 *         siga funcionando sin tocarse.
 *
 *     No cambia ningún valor ni ninguna forma: es una mudanza de lugar.
 *
 *   LIMITACIONES CONOCIDAS
 *     El ciclo `logica-despachos → logica-calendario` y
 *     `logica-pedidos → logica-despachos` sigue existiendo como grafo, pero
 *     ya no es un CICLO: `logica-calendario.js` deja de apuntar a
 *     `logica-pedidos.js`, que era la arista que lo cerraba.
 *
 *     `RECIPIENTES` y `BANDAS_HORARIAS` se quedan en `logica-pedidos.js`:
 *     nadie fuera de las pantallas de pedidos las usa, y moverlas sería
 *     ruido sin beneficio.
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm test` en verde (los 157 tests existentes incluidos), y
 *     `CI=true npm run build` sin warnings. En `logica-calendario.js` no
 *     queda ninguna referencia a `logica-pedidos`.
 * ========================================================================== */

/**
 * 1. Los tres tipos de operación, y de dónde sale cada punta. Copiado tal
 *    cual de `logica-pedidos.js` — mismo objeto, mismas claves, mismos
 *    valores. La única diferencia es el archivo donde vive.
 *
 * Hoy el pedido tiene un solo lugar, y cuando el tipo es "Entrega en planta"
 * se escribe la dirección de Explora hardcodeada en el código. Con las dos
 * puntas explícitas los tres casos quedan uniformes, y el modelo queda listo
 * para las órdenes de compra sin tocarlo.
 */
export const TIPOS = {
  'Entrega al cliente': {
    origen: 'propia',    // la planta de Explora
    destino: 'cliente',
  },
  'Entrega en planta': {
    origen: 'cliente',
    destino: 'propia',
  },
  'Retiro de Proveedores': {
    origen: 'cliente',   // el proveedor, que en el modelo es una organización
    destino: 'propia',
  },
};
