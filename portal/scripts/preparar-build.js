/* =============================================================================
 * scripts/preparar-build.js — Sella el build con la versión real del repo
 * =============================================================================
 *
 * QUÉ HACE
 *   Corre ANTES de `react-scripts build` (ver el script "build" en
 *   `package.json`) y escribe `.env.production.local` con la versión y la
 *   fecha. React lee esas variables al compilar y las deja fijas en el
 *   bundle — es lo que `Pie.js` termina mostrando.
 *
 * DE DÓNDE SALE LA VERSIÓN — `git describe --tags`
 * -----------------------------------------------------------------------------
 *   Busca el tag de versión más cercano (`git tag v1.2.0`, por ejemplo) y
 *   devuelve:
 *
 *     - "v1.2.0"              si el commit actual ES exactamente ese tag
 *     - "v1.2.0-5-ga3f92c1"   si hay 5 commits DESPUÉS de v1.2.0 sin taggear
 *                             todavía — el "5-ga3f92c1" es información real:
 *                             dice que esto no es exactamente v1.2.0, es
 *                             cinco commits más adelante
 *     - el hash pelado        si el repo no tiene ningún tag todavía
 *
 *   No hace falta que alguien edite un número en un archivo: mientras se
 *   sigan poniendo tags al cortar una versión (`git tag v1.3.0` +
 *   `git push origin v1.3.0`), el build siempre va a mostrar la que
 *   corresponda, sin mantenimiento.
 *
 *   ESTO SÍ REQUIERE UN PASO MANUAL, Y NO HAY VUELTA: decidir CUÁNDO cortar
 *   una versión y con qué número es un criterio humano (¿esto es un patch,
 *   un minor, algo que rompe compatibilidad?) — no hay forma de que el
 *   código lo adivine solo sin adoptar convenciones de mensajes de commit y
 *   una herramienta que los interprete, que es más infraestructura de la
 *   que hace falta para esto. El único paso es taggear; todo lo demás
 *   (que se vea, que no se desactualice) es automático.
 *
 * POR QUÉ `.env.production.local` Y NO PISAR `.env` A SECAS
 *   El sufijo `.production.local` es justamente para esto: React solo lo lee
 *   al compilar para producción (`react-scripts build`), nunca en
 *   `npm start`, y el `.local` ya viene ignorado por git en el
 *   `.gitignore` que trae Create React App de fábrica — este archivo se
 *   genera de nuevo en cada build y nunca se commitea. Si tu `.gitignore` no
 *   tiene esa línea por algún motivo, agregala.
 * ========================================================================== */

const fs = require('fs');
const { execSync } = require('child_process');

function obtenerVersion() {
  try {
    return execSync('git describe --tags --always').toString().trim();
  } catch (err) {
    return 'sin-git';
  }
}

const version = obtenerVersion();
const fecha = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

fs.writeFileSync(
  '.env.production.local',
  `REACT_APP_VERSION=${version}\nREACT_APP_BUILD_DATE=${fecha}\n`
);

console.log(`preparar-build: sellado con ${version} (${fecha})`);
