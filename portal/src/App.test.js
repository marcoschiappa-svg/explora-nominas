/* =============================================================================
 * App.test.js — Smoke test de arranque (Portal Explora)
 * =============================================================================
 *
 * v1.2.0 (Paso 0.3) — SE REEMPLAZA EL TEST POR DEFECTO DE CREATE REACT APP
 *
 * SÍNTOMA
 *   `CI=true npm test` fallaba desde antes de RF-01: el test que trae CRA por
 *   defecto busca el texto "learn react" (`getByText(/learn react/i)`), que
 *   es el link del template inicial de `App.js` — Portal Explora nunca tuvo
 *   ese texto, así que el test rompía en el primer render.
 *
 * CAUSA RAÍZ
 *   Nadie reemplazó el test placeholder que deja `create-react-app` al
 *   iniciar el proyecto. No prueba nada del portal real.
 *
 * ALCANCE
 *   1. Se saca el test de "learn react" (no aporta nada, y montar `<App />`
 *      completo exigiría mockear Firebase Auth/Firestore para llegar a
 *      cualquier pantalla — fuera de alcance de esta tarea).
 *   2. En su lugar, un smoke test sobre `modulos.js` (la tabla única de
 *      módulos del portal, ver su propio encabezado v1.2.0 (RF-07)): cada
 *      módulo declarado tiene `id`, `titulo` y `roles` no vacíos. Es barato,
 *      no depende de Firebase, y atrapa el error más común al agregar un
 *      módulo nuevo — olvidar alguno de esos tres campos.
 *
 * LIMITACIONES CONOCIDAS
 *   No es un test de `<App />` real: no verifica ruteo, ni que cada módulo
 *   efectivamente monte su pantalla. Eso queda para pruebas manuales (ver el
 *   informe final de esta tarea).
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm test` — en PowerShell, `$env:CI="true"` y después
 *   `npm test` en línea aparte — tiene que salir en verde.
 * ========================================================================== */

import { MODULOS } from './modulos';

// 1. Cada módulo de la tabla única tiene los tres campos que todas las
//    pantallas dan por sentado (`Home.js` arma los tiles con esto,
//    `App.js` rutea con esto): id para identificarlo, título para
//    mostrarlo, y roles no vacío -- un módulo con `roles: []` nunca sería
//    visible para nadie, casi siempre por un descuido al copiar la fila
//    de otro módulo.
test('cada módulo de modulos.js tiene id, titulo y roles no vacíos', () => {
  expect(MODULOS.length).toBeGreaterThan(0);

  MODULOS.forEach((modulo) => {
    expect(typeof modulo.id).toBe('string');
    expect(modulo.id.trim().length).toBeGreaterThan(0);

    expect(typeof modulo.titulo).toBe('string');
    expect(modulo.titulo.trim().length).toBeGreaterThan(0);

    expect(Array.isArray(modulo.roles)).toBe(true);
    expect(modulo.roles.length).toBeGreaterThan(0);
  });
});

// 2. Los IDs son únicos -- dos módulos con el mismo ID harían que
//    `moduloPorId()` (en `modulos.js`) devuelva siempre el primero, y el
//    segundo quedaría invisible para `rolesDe()`/`puedeVerModulo()`.
test('los IDs de los módulos son únicos', () => {
  const ids = MODULOS.map(m => m.id);
  expect(new Set(ids).size).toBe(ids.length);
});
