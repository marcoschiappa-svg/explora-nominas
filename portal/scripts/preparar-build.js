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
 * DE DÓNDE SALE LA VERSIÓN — línea `VERSION_ACTUAL:` en `CHANGELOG.md`
 * -----------------------------------------------------------------------------
 *   Se lee de la línea `VERSION_ACTUAL: X.Y.Z` al principio de
 *   `portal/CHANGELOG.md`. Hay que actualizar esa línea a mano en cada
 *   release, en el mismo momento en que se agrega la entrada nueva al
 *   changelog (Paso 7 del Procedimiento.md) — no es un paso aparte, es
 *   parte del mismo hábito de documentar qué cambió.
 *
 *   Antes se leía del campo "version" de `package.json`, pero eso era un
 *   archivo aparte del changelog y se podía desincronizar (actualizar uno
 *   y olvidarse del otro). Al leer del propio CHANGELOG.md, actualizar la
 *   versión es el mismo paso que ya existía de documentarla.
 *
 *   Antes de eso se probó con `git describe --tags` (y variantes: `git
 *   fetch --tags --unshallow`, `git ls-remote`, la API de GitHub) pero
 *   ninguna funcionó de forma confiable en el entorno de build de Vercel:
 *   el checkout que usa Vercel para build no expone un historial de git
 *   utilizable para esto, ni siquiera con "Deep Clone" activado en la
 *   configuración de Vercel.
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
const path = require('path');

function obtenerVersion() {
  try {
    const contenido = fs.readFileSync(
      path.join(__dirname, '..', 'CHANGELOG.md'),
      'utf8'
    );
    const match = contenido.match(/^VERSION_ACTUAL:\s*(.+)$/m);
    if (!match) return 'sin-version';
    return `v${match[1].trim()}`;
  } catch (err) {
    return 'sin-version';
  }
}

const version = obtenerVersion();
const fecha = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

fs.writeFileSync(
  '.env.production.local',
  `REACT_APP_VERSION=${version}\nREACT_APP_BUILD_DATE=${fecha}\n`
);

console.log(`preparar-build: sellado con ${version} (${fecha})`);
