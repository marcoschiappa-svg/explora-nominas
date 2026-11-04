/**
 * =============================================================================
 * versiones.js — Comparación de versiones "MAYOR.MENOR.PARCHE"
 * =============================================================================
 *
 * PROPÓSITO
 * Decide si una versión es anterior, igual o posterior a otra, para la versión
 * mínima obligatoria de TrackEx (ver versionMinima.js).
 *
 * DECISIONES
 *   - Lógica pura, SIN imports (ni Expo ni Firebase): así se puede probar con
 *     node directamente. La app no tiene suite de tests.
 *   - Solo acepta el formato estricto `N.N.N`. Nada de sufijos ("1.1.1-beta"),
 *     versiones cortas ("1.1") ni espacios: un valor mal escrito en el documento
 *     de configuración tiene que detectarse como inválido y NO bloquear a nadie,
 *     en vez de compararse "a medias".
 *   - Se compara NUMÉRICAMENTE por segmento: como texto, "1.9.0" > "1.10.0".
 *
 * MODELO DE DATOS: no lee ni escribe nada.
 * DEPENDENCIAS Y ENTORNO: ninguna.
 * =============================================================================
 */

/** Formato válido: tres números enteros separados por punto. */
const FORMATO_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * Compara dos versiones segmento por segmento (mayor, menor, parche).
 *
 * Devuelve `null` y no lanza ante un valor inválido: quien llama (versionMinima.js)
 * lo trata como "no se puede decidir" y no bloquea.
 *
 * @param {string} a Primera versión, por ejemplo '1.1.0'.
 * @param {string} b Segunda versión, por ejemplo '1.1.1'.
 * @returns {-1|0|1|null} -1 si `a` es anterior a `b`, 0 si son iguales, 1 si `a`
 *   es posterior; `null` si alguna de las dos no cumple el formato.
 */
export function compararVersiones(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return null;
  const ma = FORMATO_VERSION.exec(a);
  const mb = FORMATO_VERSION.exec(b);
  if (!ma || !mb) return null;

  for (let i = 1; i <= 3; i += 1) {
    const diferencia = Number(ma[i]) - Number(mb[i]);
    if (diferencia < 0) return -1;
    if (diferencia > 0) return 1;
  }
  return 0;
}
