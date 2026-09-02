/**
 * =============================================================================
 * Home.js — Punto de entrada del portal
 * =============================================================================
 *
 * PROPÓSITO
 * Elegir qué módulo abrir, según lo que el usuario puede usar.
 *
 * -----------------------------------------------------------------------------
 * B1 — SE FUE EL TOPBAR PROPIO, SE FUE EL MODO OSCURO LOCAL
 * -----------------------------------------------------------------------------
 * Esta pantalla tenía SU PROPIO topbar (logo, modo oscuro, cambiar
 * contraseña, cerrar sesión) porque era la única que los necesitaba. Ahora
 * que `BarraSuperior.js` los tiene para TODO el portal —enganchada una sola
 * vez en `App.js`—, tenerlos acá también sería mostrar dos barras
 * superpuestas. Se van los tres: el estado de `oscuro` (ahora vive en
 * `TemaContext`), el modal de cambiar contraseña (migrado tal cual a
 * `BarraSuperior.js`), y el propio topbar.
 *
 * Lo único que se queda son las SECCIONES y las CARDS de los módulos — eso
 * es lo que de verdad es específico de Home.
 *
 * -----------------------------------------------------------------------------
 * EL ROJO — AHORA `marca` DE `tokens.js`, NO `#C8102E` SUELTO
 * -----------------------------------------------------------------------------
 * Los dos lugares que tenían `#C8102E` escrito a mano (el acento del tile de
 * "Pedidos", y el color del saludo) pasan a usar `marca` (`#C60000`) de
 * `tokens.js` — es el mismo cambio de marca que ya se aplicó en `Boton.js` y
 * el resto de `ui/`.
 *
 * -----------------------------------------------------------------------------
 * REDISEÑO ANTERIOR — SIGUE VALIENDO
 * -----------------------------------------------------------------------------
 * El problema que resolvía el rediseño anterior no cambia: 16 tiles con el
 * mismo peso visual, mezclando módulos NUEVOS, SIN CAMBIOS y LEGACY. Eso
 * sigue exactamente igual — lo único que se movió es la barra de arriba.
 *
 * -----------------------------------------------------------------------------
 * CIERRE DE LA MIGRACIÓN B1 — TRES AJUSTES CHICOS
 * -----------------------------------------------------------------------------
 *   1. `wrap` tenía `minHeight: '100vh'` -- mismo bug que se encontró en
 *      Login.js y Seguimiento.js: sumaba una pantalla entera de más sobre
 *      la barra superior sticky. Sacado sin reemplazo: Home es una página
 *      normal (como Pedidos.js), no necesita ocupar un viewport exacto.
 *   2. Los acentos por módulo que ya existían como token de `tokens.js`
 *      (`colorEstado.acentoVerde/acentoAzul/acentoAzulFuerte/acentoAmbar/
 *      acentoPurpura`) dejan de repetirse en hex a mano. Los dos casos que
 *      SÍ se dejan en gris fijo (`#6B7280` para legacy, `#374151` para
 *      Administración) son a propósito -- son colores de categoría, no
 *      texto que haya que leer, y el gris ahí comunica "modelo viejo"/
 *      "neutral" correctamente.
 *   3. Los `colores.textoSuave` (subtítulo, descripciones de card, texto
 *      legacy) pasan a `pal.azul` de `paletaTexto()` -- mismo criterio de
 *      "nada de gris para texto que se lee" que ya se aplicó en
 *      Programacion.js/MisDespachos.js/Camiones.js/Usuarios.js/Login.js.
 *   4. El tile de "Seguimiento" suma `transportista` a sus roles y pasa a
 *      `nuevo: true` -- quedó pendiente de la vuelta anterior, cuando
 *      `App.js` empezó a chequear esa ruta con `tieneAlgunRol` en vez del
 *      `rol` viejo. Sin este cambio, un transportista podía entrar por la
 *      ruta pero no ver el tile para llegar ahí.
 * ========================================================================== */

import React, { useState, useMemo } from 'react';
import { tieneAlgunRol } from '../sesion';
import { marca, colorEstado, espacio, radio, tipografia, paletaTexto } from '../ui/tokens';
import { useTema } from '../ui/TemaContext';

/* -----------------------------------------------------------------------------
 * Secciones — el orden en que aparecen en la pantalla
 * -------------------------------------------------------------------------- */

const SECCIONES = [
  { id: 'pedidos',      titulo: 'Pedidos y programación' },
  { id: 'transporte',   titulo: 'Transporte' },
  { id: 'seguimiento',  titulo: 'Seguimiento y tarifas' },
  { id: 'admin',        titulo: 'Administración' },
];

function saludo() {
  const h = new Date().getHours();
  if (h >= 6 && h < 12) return 'Buenos días';
  if (h >= 12 && h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

function Home({ usuario, onModulo }) {
  const rol = usuario?.rol || '';
  const { colores, oscuro } = useTema();
  const pal = paletaTexto(oscuro);
  const [focoId, setFocoId] = useState(null);

  // Mismos id, roles y `nuevo` que antes —eso es lo que decide permisos y
  // ruteo en `App.js`, y no se tocó—. `categoria` y `legacy` son campos
  // nuevos, solo para agrupar y pintar.
  const modulos = useMemo(() => [
    { id: 'pedidos',        categoria: 'pedidos',     emoji: '📋', titulo: 'Pedidos',              desc: 'Crear y consultar pedidos',                            roles: ['admin', 'comercial', 'coordinador'], acento: marca, nuevo: true },
    { id: 'pedidos_legacy', categoria: 'pedidos',     emoji: '🗄️', titulo: 'Pedidos anteriores',    desc: 'Los que quedaron del modelo viejo. Solo consulta',     roles: ['admin', 'comercial', 'coordinador'], acento: '#6B7280', legacy: true },
    { id: 'programacion',   categoria: 'pedidos',     emoji: '📅', titulo: 'Programación',          desc: 'Convertir entregas en camiones concretos',             roles: ['admin', 'coordinador'],              acento: colorEstado.acentoVerde, nuevo: true },
    { id: 'coordinador',    categoria: 'pedidos',     emoji: '🗄️', titulo: 'Programación anterior', desc: 'Los pedidos que quedaron del modelo viejo',            roles: ['admin', 'coordinador'],              acento: '#6B7280', legacy: true },

    { id: 'mis_despachos',  categoria: 'transporte',  emoji: '🚛', titulo: 'Mis despachos',         desc: 'Aceptar, rechazar y nominar la unidad',                roles: ['admin', 'transportista'],            acento: colorEstado.acentoAzulFuerte, nuevo: true },
    { id: 'transportista',  categoria: 'transporte',  emoji: '🗄️', titulo: 'Despachos anteriores',  desc: 'Los que quedaron del modelo viejo',                    roles: ['admin', 'transportista'],            acento: '#6B7280', legacy: true },
    { id: 'mis_viajes',     categoria: 'transporte',  emoji: '🗺️', titulo: 'Mis viajes',            desc: 'Iniciá, reportá y finalizá tus viajes',                roles: ['chofer'],                            acento: colorEstado.acentoVerde, nuevo: true },
    { id: 'chofer',         categoria: 'transporte',  emoji: '🗄️', titulo: 'Viajes anteriores',     desc: 'Los que quedaron del modelo viejo',                    roles: ['chofer'],                            acento: '#6B7280', legacy: true },
    { id: 'camiones',       categoria: 'transporte',  emoji: '🚚', titulo: 'Mi Flota',              desc: 'Las unidades de cada empresa de transporte',           roles: ['admin', 'coordinador', 'transportista'], acento: colorEstado.acentoVerde, nuevo: true },

    { id: 'seguimiento',    categoria: 'seguimiento', emoji: '📡', titulo: 'Seguimiento',           desc: 'Mapa en tiempo real de choferes activos',              roles: ['admin', 'coordinador', 'transportista'], acento: colorEstado.acentoAzul, nuevo: true },
    { id: 'tarifario',      categoria: 'seguimiento', emoji: '💲', titulo: 'Tarifario',             desc: 'Consulta y gestión de tarifas de flete por ruta',      roles: ['admin', 'comercial', 'coordinador'], acento: colorEstado.acentoAmbar },

    { id: 'admin',          categoria: 'admin',       emoji: '⚙️', titulo: 'Administración',        desc: 'Gestión de usuarios, roles y configuración',           roles: ['admin'],                             acento: '#374151' },
    { id: 'organizaciones', categoria: 'admin',       emoji: '🏢', titulo: 'Organizaciones',        desc: 'Clientes, transportes y sus domicilios',               roles: ['admin', 'comercial'],                acento: colorEstado.acentoPurpura, nuevo: true },
    { id: 'usuarios',       categoria: 'admin',       emoji: '👥', titulo: 'Usuarios',              desc: 'Altas, roles y bajas de las personas del sistema',     roles: ['admin', 'transportista'],            acento: colorEstado.acentoAzul, nuevo: true },
    { id: 'productos',      categoria: 'admin',       emoji: '🛢️', titulo: 'Productos',             desc: 'Lo que se transporta. Antes estaba fijo en el código', roles: ['admin'],                             acento: colorEstado.acentoAmbar, nuevo: true },
  ].filter(m => m.nuevo ? tieneAlgunRol(usuario, m.roles) : m.roles.includes(rol)), [usuario, rol]);

  // Agrupadas por sección, y dentro de cada una, separadas en "activas"
  // (la card grande) y "legacy" (la lista angosta debajo). Una sección que
  // quedó sin nada visible —ni activas ni legacy— no se muestra.
  const secciones = useMemo(() => SECCIONES
    .map(sec => ({
      ...sec,
      activos: modulos.filter(m => m.categoria === sec.id && !m.legacy),
      legacy: modulos.filter(m => m.categoria === sec.id && m.legacy),
    }))
    .filter(s => s.activos.length > 0 || s.legacy.length > 0),
    [modulos]
  );

  return (
    <div style={{ ...base.wrap, background: colores.fondo, color: colores.texto }}>

      {/* Hero */}
      <div style={{ ...base.hero, borderBottom: `1px solid ${colores.borde}` }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: marca, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            {saludo()}
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: colores.texto, letterSpacing: '-0.5px', marginBottom: 6 }}>
            {usuario?.nombre?.split(' ')[0] || 'Bienvenido'}
          </div>
          <div style={{ fontSize: 13, color: pal.azul }}>Portal Operativo · Complejo Industrial PGSM</div>
        </div>
        {usuario?.empresa && (
          <div style={{ ...base.empresaTag, background: colores.fondoAlterno, border: `1px solid ${colores.borde}`, color: pal.azul }}>
            🏢 {usuario.empresa}
          </div>
        )}
      </div>

      {/* Secciones */}
      <div style={base.contenido}>
        {secciones.length === 0 && (
          <div style={{ ...base.vacio, color: pal.azul }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🗂️</div>
            <div style={{ fontSize: 14, color: colores.texto, fontWeight: 500, marginBottom: 4 }}>
              Todavía no tenés módulos asignados
            </div>
            <div style={{ fontSize: 13, maxWidth: 360, margin: '0 auto' }}>
              Pedile a un administrador que te asigne un rol desde el módulo de Usuarios.
            </div>
          </div>
        )}

        {secciones.map(sec => (
          <div key={sec.id} style={base.seccion}>
            <div style={{ ...base.seccionTitulo, color: pal.azul, borderColor: colores.borde }}>{sec.titulo}</div>

            {sec.activos.length > 0 && (
              <div style={base.grid}>
                {sec.activos.map(m => (
                  <button key={m.id}
                    style={{
                      ...base.card,
                      background: colores.superficie,
                      border: `1px solid ${focoId === m.id ? m.acento : colores.borde}`,
                      boxShadow: focoId === m.id ? `0 0 0 3px ${m.acento}22` : 'none',
                    }}
                    onClick={() => onModulo(m.id)}
                    onFocus={() => setFocoId(m.id)}
                    onBlur={() => setFocoId(null)}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = m.acento; e.currentTarget.style.background = colores.fondoAlterno; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = focoId === m.id ? m.acento : colores.borde; e.currentTarget.style.background = colores.superficie; }}
                  >
                    <div style={{
                      ...base.cardBar,
                      background: m.nuevo
                        ? `repeating-linear-gradient(90deg, ${m.acento} 0 10px, transparent 10px 17px)`
                        : m.acento,
                    }} />
                    <div style={base.cardTop}>
                      <div style={base.cardIcono}>{m.emoji}</div>
                      {m.nuevo && (
                        <span style={{ ...base.pillNuevo, background: `${m.acento}18`, color: m.acento }}>Nuevo</span>
                      )}
                    </div>
                    <div style={{ ...base.cardTitulo, color: colores.texto }}>{m.titulo}</div>
                    <div style={{ ...base.cardDesc, color: pal.azul }}>{m.desc}</div>
                    <div style={{ ...base.cardFlecha, color: m.acento }}>→</div>
                  </button>
                ))}
              </div>
            )}

            {sec.legacy.length > 0 && (
              <div style={{ ...base.legacyWrap, border: `1px solid ${colores.borde}`, background: colores.fondoAlterno }}>
                <div style={{ ...base.legacyEtiqueta, color: pal.azul }}>Herramientas del modelo anterior</div>
                {sec.legacy.map((m, i) => (
                  <button key={m.id}
                    style={{
                      ...base.legacyItem,
                      borderTop: i === 0 ? 'none' : `1px solid ${colores.borde}`,
                      color: pal.azul,
                    }}
                    onClick={() => onModulo(m.id)}
                    onMouseEnter={e => { e.currentTarget.style.color = colores.texto; }}
                    onMouseLeave={e => { e.currentTarget.style.color = pal.azul; }}
                  >
                    <span style={base.legacyEmoji}>{m.emoji}</span>
                    <span style={base.legacyTitulo}>{m.titulo}</span>
                    <span style={base.legacyDesc}>{m.desc}</span>
                    <span style={base.legacyFlecha}>→</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const base = {
  // Sin "minHeight: 100vh" -- mismo bug que encontramos en Login.js y
  // Seguimiento.js: sumaba una pantalla entera DE MAS sobre la barra
  // superior sticky. A diferencia de esas dos, Home es una pagina normal
  // (como Pedidos.js) que puede scrollear si hay muchos modulos -- no
  // necesita ocupar ni un viewport exacto ni fijarse con `position:fixed`,
  // le alcanza con fluir.
  wrap: { fontFamily: tipografia.familia, transition: 'background 0.2s, color 0.2s' },
  hero: { padding: '2.5rem 1.5rem 2rem', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 },
  empresaTag: { padding: '6px 14px', borderRadius: 20, fontSize: 12 },

  contenido: { padding: '1.5rem 1.5rem 3rem', maxWidth: 1040, margin: '0 auto' },
  vacio: { textAlign: 'center', padding: '3rem 1rem' },

  seccion: { marginBottom: '2.25rem' },
  seccionTitulo: {
    fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em',
    marginBottom: 14, paddingBottom: 8, borderBottom: '1px solid', borderColor: 'inherit',
  },

  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 },
  card: {
    position: 'relative', display: 'flex', flexDirection: 'column', gap: 8,
    padding: '1.25rem 1.25rem 1.5rem', borderRadius: 14, cursor: 'pointer', textAlign: 'left',
    overflow: 'hidden', transition: 'border-color 0.15s, background 0.15s, box-shadow 0.15s',
    outline: 'none',
  },
  cardBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 4, borderRadius: '14px 14px 0 0' },
  cardTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginTop: 4 },
  cardIcono: { fontSize: 24 },
  pillNuevo: { fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: '0.04em' },
  cardTitulo: { fontSize: 15, fontWeight: 600, letterSpacing: '-0.2px' },
  cardDesc: { fontSize: 12, lineHeight: 1.5, flex: 1 },
  cardFlecha: { fontSize: 16, fontWeight: 600, alignSelf: 'flex-end' },

  legacyWrap: { borderRadius: 12, overflow: 'hidden', marginTop: 10 },
  legacyEtiqueta: { fontSize: 11, padding: '8px 14px', fontWeight: 500 },
  legacyItem: {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
    padding: '10px 14px', background: 'transparent', border: 'none', cursor: 'pointer',
    fontFamily: 'inherit', textAlign: 'left', transition: 'color 0.1s',
  },
  legacyEmoji: { fontSize: 14, flexShrink: 0 },
  legacyTitulo: { fontSize: 13, fontWeight: 500, flexShrink: 0 },
  legacyDesc: { fontSize: 12, flex: 1, minWidth: 100 },
  legacyFlecha: { fontSize: 13, flexShrink: 0 },
};

export default Home;
