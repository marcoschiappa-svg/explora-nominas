/* =============================================================================
 * modulos.js — Tabla única de módulos del portal (Portal Explora)
 * =============================================================================
 *
 * v1.2.0 (RF-07) — VISIBILIDAD DE MÓDULOS POR ROL
 *
 * SÍNTOMA
 *   Quién ve y puede usar cada módulo estaba decidido en DOS lugares que no
 *   siempre coincidían: la lista de tiles de `Home.js` (con sus roles) y las
 *   condiciones de ruteo de `App.js` (con los suyos, a veces contra el `rol`
 *   legacy, a veces contra `tieneAlgunRol`). `tarifario` es el caso que lo
 *   mostraba: `Home.js` lo limitaba a admin/comercial/coordinador, pero
 *   `App.js` solo exigía `rol !== 'transportista'` — cualquier otro rol
 *   legacy entraba igual, aunque no tuviera el tile para llegar.
 *
 * CAUSA RAÍZ
 *   No había un único lugar que dijera "estos son los roles de este módulo".
 *   Cada archivo repetía su propia lista, y repetir invita a que diverjan.
 *
 * ALCANCE
 *   Este archivo es AHORA ese único lugar. `Home.js` arma sus tiles con
 *   `modulosVisibles()`, y `App.js` rutea con `puedeVerModulo()` — ninguno de
 *   los dos vuelve a declarar roles por su cuenta.
 *
 *   Cada módulo tiene `usaModeloViejo`: true para los cuatro módulos
 *   "anteriores" (`pedidos_legacy`, `coordinador`, `transportista`, `chofer`)
 *   y `admin` — las cinco pantallas que siguen escribiendo `usuarios_portal`/
 *   `pedidos_portal`/`transportistas_portal`. Para esos, no alcanza con el rol
 *   legacy: hace falta ADEMÁS tener documento en `usuarios_portal`
 *   (`!!usuario.rol`), porque sin ese documento las reglas viejas rechazan
 *   cualquier escritura. Motivo completo: un chofer dado de alta solo en el
 *   modelo nuevo (`usuarios`, sin `usuarios_portal`) no tiene forma de operar
 *   `Chofer.js` — así que no tiene que ver su tile tampoco.
 *
 *   El resto de los módulos (incluido `tarifario`, que HOY se filtraba con el
 *   `rol` legacy pese a no escribir nada de ese modelo) pasan a evaluarse
 *   siempre contra `perfil.roles`, con `tieneAlgunRol()`.
 *
 * LIMITACIONES CONOCIDAS
 *   Los módulos legacy (`legacy: true`) no cambian de roles en esta tarea:
 *   sus pantallas no se tocan, se preserva la matriz que ya tenían.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Cada rol ve en Home exactamente los
 *   tiles de la matriz de este archivo, y `App.js` rechaza (cae a Home) un
 *   intento de entrar a un módulo por URL/estado sin el rol correspondiente.
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (RF-10 y RF-05) — DOS MÓDULOS NUEVOS
 * -----------------------------------------------------------------------------
 *   `calendario` (RF-10, admin/coordinador) y `ciclo_vida` (RF-05,
 *   admin/coordinador/comercial) se suman a la tabla con el mismo criterio
 *   que el resto: `usaModeloViejo: false`, roles evaluados siempre contra
 *   `perfil.roles`. El transportista y el chofer no ven ninguno de los dos
 *   -- ninguno está en sus roles.
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (RF-09) — `nuevo_tarifario`, EN PARALELO A `tarifario`
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     `NuevoTarifario.js` (pantalla nueva, sobre la colección `rutas`) no
 *     tenía entrada en la tabla — sin eso, `puede('nuevo_tarifario')` de
 *     `App.js` siempre da `false` y nadie puede entrar.
 *
 *   CAUSA RAÍZ
 *     Módulo nuevo, corre en paralelo al Tarifario legacy mientras se decide
 *     cuál queda.
 *
 *   ALCANCE
 *     Misma categoría, mismos roles y mismo `usaModeloViejo: false` que
 *     `tarifario` — es una pantalla del modelo nuevo, sin ninguna escritura
 *     en `usuarios_portal`/`pedidos_portal`. El módulo `tarifario` no
 *     cambia.
 *
 *   LIMITACIONES CONOCIDAS
 *     Ninguna nueva.
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm run build` sin warnings. Admin, coordinador y comercial
 *     ven el tile "Nuevo Tarifario" en Home; transportista y chofer no.
 * ========================================================================== */

import { tieneAlgunRol, tienePerfil } from './sesion';
import { marca, colorEstado } from './ui/tokens';

/**
 * 1. Roles/categoría/emoji/título/desc/acento: iguales a los que tenía cada
 *    tile en `Home.js` antes de esta tarea (ver el encabezado de este
 *    archivo), salvo los tres cambios de matriz que pide RF-07: `coordinador`
 *    se suma a `mis_despachos` y a `organizaciones`, y `comercial` se suma a
 *    `productos`.
 */
export const MODULOS = [
  { id: 'pedidos',        categoria: 'pedidos',     emoji: '📋', titulo: 'Pedidos',              desc: 'Crear y consultar pedidos',                            roles: ['admin', 'comercial', 'coordinador'], acento: marca, nuevo: true, usaModeloViejo: false },
  { id: 'pedidos_legacy', categoria: 'pedidos',     emoji: '🗄️', titulo: 'Pedidos anteriores',    desc: 'Los que quedaron del modelo viejo. Solo consulta',     roles: ['admin', 'comercial', 'coordinador'], acento: '#6B7280', legacy: true, usaModeloViejo: true },
  { id: 'programacion',   categoria: 'pedidos',     emoji: '📅', titulo: 'Programación',          desc: 'Convertir entregas en camiones concretos',             roles: ['admin', 'coordinador'],              acento: colorEstado.acentoVerde, nuevo: true, usaModeloViejo: false },
  { id: 'coordinador',    categoria: 'pedidos',     emoji: '🗄️', titulo: 'Programación anterior', desc: 'Los pedidos que quedaron del modelo viejo',            roles: ['admin', 'coordinador'],              acento: '#6B7280', legacy: true, usaModeloViejo: true },

  // 2. `mis_despachos` suma `coordinador`: RF-07 le agrega un modo consulta
  //    de solo lectura sobre todos los transportistas (ver MisDespachos.js).
  { id: 'mis_despachos',  categoria: 'transporte',  emoji: '🚛', titulo: 'Mis despachos',         desc: 'Aceptar, rechazar y nominar la unidad',                roles: ['admin', 'coordinador', 'transportista'], acento: colorEstado.acentoAzulFuerte, nuevo: true, usaModeloViejo: false },
  { id: 'transportista',  categoria: 'transporte',  emoji: '🗄️', titulo: 'Despachos anteriores',  desc: 'Los que quedaron del modelo viejo',                    roles: ['admin', 'transportista'],            acento: '#6B7280', legacy: true, usaModeloViejo: true },
  { id: 'mis_viajes',     categoria: 'transporte',  emoji: '🗺️', titulo: 'Mis viajes',            desc: 'Iniciá, reportá y finalizá tus viajes',                roles: ['chofer'],                            acento: colorEstado.acentoVerde, nuevo: true, usaModeloViejo: false },
  { id: 'chofer',         categoria: 'transporte',  emoji: '🗄️', titulo: 'Viajes anteriores',     desc: 'Los que quedaron del modelo viejo',                    roles: ['chofer'],                            acento: '#6B7280', legacy: true, usaModeloViejo: true },
  { id: 'camiones',       categoria: 'transporte',  emoji: '🚚', titulo: 'Mi Flota',              desc: 'Las unidades de cada empresa de transporte',           roles: ['admin', 'coordinador', 'transportista'], acento: colorEstado.acentoVerde, nuevo: true, usaModeloViejo: false },

  { id: 'seguimiento',    categoria: 'seguimiento', emoji: '📡', titulo: 'Seguimiento',           desc: 'Mapa en tiempo real de choferes activos',              roles: ['admin', 'coordinador', 'transportista'], acento: colorEstado.acentoAzul, nuevo: true, usaModeloViejo: false },
  // 3. `tarifario` deja de evaluarse contra el `rol` legacy (lo que hacía
  //    App.js hasta ahora, con `rol !== 'transportista'`, sin límite real de
  //    roles): pasa a `usaModeloViejo: false`, como cualquier módulo del
  //    modelo nuevo. Ver Tarifario.js para las pestañas por rol.
  { id: 'tarifario',      categoria: 'seguimiento', emoji: '💲', titulo: 'Tarifario',             desc: 'Consulta y gestión de tarifas de flete por ruta',      roles: ['admin', 'comercial', 'coordinador'], acento: colorEstado.acentoAmbar, usaModeloViejo: false },
  // 9. v1.2.0 (RF-09) -- registro maestro de rutas, en paralelo al Tarifario
  //    legacy. Ver `pages/NuevoTarifario.js`.
  { id: 'nuevo_tarifario', categoria: 'seguimiento', emoji: '🧾', titulo: 'Nuevo Tarifario',       desc: 'Registro maestro de rutas y tarifas, con historial',   roles: ['admin', 'comercial', 'coordinador'], acento: colorEstado.acentoAmbar, nuevo: true, usaModeloViejo: false },

  { id: 'admin',          categoria: 'admin',       emoji: '⚙️', titulo: 'Administración',        desc: 'Gestión de usuarios, roles y configuración',           roles: ['admin'],                             acento: '#374151', usaModeloViejo: true },
  // 4. `organizaciones` suma `coordinador`: da de alta transportes (ver
  //    Organizaciones.js y las reglas nuevas de esa colección).
  { id: 'organizaciones', categoria: 'admin',       emoji: '🏢', titulo: 'Organizaciones',        desc: 'Clientes, transportes y sus domicilios',               roles: ['admin', 'comercial', 'coordinador'], acento: colorEstado.acentoPurpura, nuevo: true, usaModeloViejo: false },
  { id: 'usuarios',       categoria: 'admin',       emoji: '👥', titulo: 'Usuarios',              desc: 'Altas, roles y bajas de las personas del sistema',     roles: ['admin', 'transportista'],            acento: colorEstado.acentoAzul, nuevo: true, usaModeloViejo: false },
  // 5. `productos` suma `comercial`: puede dar de alta, editar y desactivar
  //    (no eliminar) — ver Productos.js.
  { id: 'productos',      categoria: 'admin',       emoji: '🛢️', titulo: 'Productos',             desc: 'Lo que se transporta. Antes estaba fijo en el código', roles: ['admin', 'comercial'],                acento: colorEstado.acentoAmbar, nuevo: true, usaModeloViejo: false },

  // 7. v1.2.0 (RF-10) -- misma categoría que Organizaciones y Productos, solo
  //    admin y coordinador (el comercial no marca días del calendario). Ver
  //    `pages/CalendarioOperativo.js`.
  { id: 'calendario',     categoria: 'admin',       emoji: '📅', titulo: 'Calendario operativo',  desc: 'Días sin despacho o sin operación',                    roles: ['admin', 'coordinador'],              acento: colorEstado.acentoVerde, nuevo: true, usaModeloViejo: false },

  // 8. v1.2.0 (RF-05) -- junto a Pedidos y Programación, de solo lectura, con
  //    el comercial además de admin/coordinador. Ver `pages/CicloVida.js`.
  { id: 'ciclo_vida',     categoria: 'pedidos',     emoji: '🧭', titulo: 'Ciclo de vida',         desc: 'En qué etapa está cada entrega, y desde cuándo',       roles: ['admin', 'coordinador', 'comercial'], acento: colorEstado.acentoAzulFuerte, nuevo: true, usaModeloViejo: false },
];

export function moduloPorId(id) {
  return MODULOS.find(m => m.id === id) || null;
}

/** Los roles de acceso de un módulo, para el `motivoSinAcceso` de cada pantalla. */
export function rolesDe(id) {
  const m = moduloPorId(id);
  return m ? m.roles : [];
}

/**
 * 6. Criterio de acceso. Un módulo normal se evalúa siempre contra
 *    `perfil.roles` (`tieneAlgunRol`). Uno `usaModeloViejo: true` necesita
 *    ADEMÁS el documento legacy (`!!usuario.rol`): sin él, las pantallas de
 *    esas cinco quedarían con el tile visible pero cualquier escritura
 *    rechazada por las reglas viejas. Con perfil nuevo, el rol se evalúa
 *    contra `perfil.roles`; sin perfil nuevo, contra el `rol` legacy — mismo
 *    criterio que usaba `App.js` para estos módulos antes de esta tarea.
 */
export function puedeVerModulo(usuario, modulo) {
  if (!modulo) return false;

  if (!modulo.usaModeloViejo) {
    return tieneAlgunRol(usuario, modulo.roles);
  }

  if (!usuario || !usuario.rol) return false;
  if (tienePerfil(usuario)) return tieneAlgunRol(usuario, modulo.roles);
  return modulo.roles.includes(usuario.rol);
}

export function modulosVisibles(usuario) {
  return MODULOS.filter(m => puedeVerModulo(usuario, m));
}
