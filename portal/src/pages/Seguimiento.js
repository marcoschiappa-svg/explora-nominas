/**
 * =============================================================================
 * Seguimiento.js — Mapa de seguimiento de viajes (Portal Explora)
 * =============================================================================
 *
 * PROPÓSITO
 * Muestra sobre un mapa de Google dónde están los camiones y por dónde
 * pasaron. Tiene dos modos:
 *   - EN VIVO: posición actual de cada viaje en curso (`viajes.ultima_lat/lng`),
 *     con alertas por demora o falta de señal.
 *   - HISTORIAL: recorrido completo de viajes finalizados, leyendo la
 *     subcolección `viajes/{id}/gps_puntos` al seleccionar uno.
 *
 * -----------------------------------------------------------------------------
 * REDISENO -- MODELO NUEVO, ACCESO, LAYOUT
 * -----------------------------------------------------------------------------
 *   ANTES leia `pedidos_portal` (modelo legacy) con `despachos[]` y
 *   `gps_track_{i}` embebidos. AHORA lee la coleccion `viajes` (modelo
 *   nuevo) y su subcoleccion `gps_puntos` -- los pedidos viejos no tienen
 *   seguimiento, decision explicita: se dejan de mostrar.
 *
 *   Lo que el modelo nuevo NO trae, a diferencia del viejo (y las
 *   simplificaciones que eso obligo, ver el archivo entero para el detalle
 *   de cada una): sin flecha de rumbo (necesitaria el punto anterior), sin
 *   OV/OC en la busqueda (no esta denormalizado en `viajes`, vive en
 *   `despachos`). La traza parcial al centrar un viaje en vivo se habia
 *   sacado aca y VOLVIO en la v1.2.6 (ver "v1.2.6 — Traza en vivo y estado
 *   del seguimiento"): al seleccionar un viaje EN_VIAJE se dibuja su
 *   recorrido hasta el momento.
 *
 *   La demora pasa a mostrarse como badge aparte, no como estado exclusivo
 *   -- `logica-viajes.js` ya lo dice: "la demora es un atributo, no un
 *   estado". Los nombres de chofer/transportista se resuelven con dos
 *   lookups chicos (`usuarios` filtrado por rol chofer, `organizaciones`
 *   filtrado por es_transportista) porque `viajes` solo denormaliza IDs
 *   (`chofer_uid`, `chofer_dni`, `transportista_org_id`), no nombres.
 *
 *   ACCESO: `motivoSinAcceso` adentro del componente (admin/coordinador/
 *   transportista), en vez de solo en la linea de ruteo de App.js.
 *
 *   FILTRO POR ORGANIZACION: un transportista solo consulta SUS PROPIOS
 *   viajes -- el `where('transportista_org_id','==',miOrg)` va en la
 *   consulta misma, no como filtro de UI despues. Las reglas de Firestore
 *   (`firestore.rules.produccion`, revisado) ya restringen tanto `viajes`
 *   como su subcoleccion `gps_puntos` por `transportista_org_id` -- el
 *   agujero que existia en una revision anterior (`gps_puntos` como
 *   coleccion suelta sin filtro) esta cerrado: ahora es subcoleccion con su
 *   propia regla que llama a `viajePadre()`.
 *
 *   LAYOUT: `wrap`/`layout` pasan a `flex: 1, minHeight: 0` en vez de
 *   `minHeight: 100vh` / `calc(100vh - Npx)` a mano -- ver el comentario en
 *   App.js (`Pagina`) para el por que completo. Antes la pagina entera
 *   scrolleaba (dificultando usar el mapa) y el mapa ni se dibujaba (un
 *   contenedor de Google Maps con alto 0 no renderiza nada).
 *
 *   BUSQUEDA: sigue el campo de texto libre agregado en la vuelta anterior
 *   (chofer, cliente, patente), sin OV por lo dicho arriba.
 *
 *   B1: `crearEstilos(colores, oscuro)` + `useEstilos()`, paleta rojo/azul,
 *   sin topbar propio (BarraSuperior ya cubre logo/volver).
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (RF-02) -- CIERRE MANUAL DESDE ACÁ TAMBIÉN
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     Un viaje abierto vencido solo se podía cerrar a mano desde
 *     Programación -- si el coordinador lo veía primero en el mapa de
 *     Seguimiento (por ejemplo, por una alerta de "sin señal"), tenía que
 *     ir a buscar el mismo pedido en la otra pantalla.
 *
 *   CAUSA RAÍZ
 *     `ModalCierreManual.js` no existía todavía; esta pantalla no tenía
 *     ninguna acción de escritura, solo lectura.
 *
 *   ALCANCE
 *     Botón "Cerrar viaje a mano" en la tarjeta de un viaje vivo (tab "En
 *     vivo"), visible solo para admin y coordinador -- nunca para el
 *     transportista, aunque esté viendo el mismo viaje. Abre el MISMO
 *     `ModalCierreManual` que Programación; después de cerrar, mismo
 *     comportamiento (nada más que refrescar -- confirmado en las
 *     verificaciones previas, V4).
 *
 *   LIMITACIONES CONOCIDAS
 *     Esta pantalla no lee `despachos` (para no sumar una consulta nueva a
 *     Firestore -- fuera del alcance de esta tarea), así que el modal no
 *     puede mostrar el NÚMERO de despacho en su encabezado, solo
 *     chofer/patente (que sí están denormalizados en el viaje). El modal ya
 *     contempla esto: esa línea del encabezado simplemente no aparece si
 *     falta.
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm run build` sin warnings. Como admin o coordinador, un
 *     viaje vivo muestra "Cerrar viaje a mano"; como transportista (viendo
 *     los suyos), no. Cerrarlo saca el viaje de "En vivo" y lo muestra en
 *     "Historial".
 *
 * -----------------------------------------------------------------------------
 * v1.2.5 -- LEAFLET + OPENSTREETMAP, ALTO FIJO, CENTRADO EN ARGENTINA
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     (a) El mapa salía con la marca de agua "For development purposes only"
 *     de Google. (b) La página entera scrolleaba: el alto del mapa dependía
 *     del largo de la lista, y scrollear la lista movía el mapa. (c) Al abrir,
 *     el mapa no mostraba Argentina completa (centro en la planta, zoom 4).
 *
 *   CAUSA RAÍZ
 *     (a) La marca de agua la pone Google cuando la clave (`MAPS_KEY`) no
 *     tiene facturación habilitada: no era un problema de código.
 *     (b) La cadena de alto se cortaba en `App.js` (`Pagina`): ver su
 *     encabezado v1.2.5. Lo de acá (`wrap`/`layout` con `flex: 1, minHeight:
 *     0`) era correcto, pero quedó sin efecto cuando `Pagina` pasó a sticky
 *     footer con un wrapper que no es flex.
 *     (c) `PLANTA_EXPLORA` + `ZOOM_ARGENTINA` fijos, sin ajustarse al tamaño
 *     real del contenedor.
 *
 *   ALCANCE
 *     1. Google Maps -> Leaflet 1.9.4 (manejo imperativo con refs, sin
 *        react-leaflet) con teselas de OpenStreetMap y la atribución que
 *        exige su licencia. Sale `MAPS_KEY` y la inyección del script.
 *     2. Equivalencias: `circleMarker` (mismo relleno/borde) para los viajes
 *        vivos, `marker` + `divIcon` para "A"/"B", `bindPopup`/`openPopup`
 *        por `InfoWindow`, `polyline`, `remove()`/`addTo()`, `setView`.
 *        Mismos colores y semántica (`COLOR_GPS`, `colorEstado`, `marca`).
 *     3. El mapa se crea UNA vez en un `useEffect` y se destruye en el
 *        cleanup (`map.remove()`): el doble montaje de StrictMode tiraba
 *        "Map container is already initialized". El cleanup también vacía
 *        las refs de marcadores/traza para que el segundo montaje los recree.
 *     4. `ResizeObserver` sobre el contenedor -> `map.invalidateSize()`: sin
 *        esto Leaflet deja teselas grises cuando el contenedor cambia de
 *        tamaño después de crearse.
 *     5. Modo oscuro: clase `mapa-oscuro` en `mapaWrap` (`Seguimiento.css`
 *        invierte solo las teselas). Va en el contenedor y no en el div del
 *        mapa porque Leaflet le agrega clases propias a ese div y React las
 *        pisaría al re-renderizar.
 *     6. Layout: columna izquierda `minHeight: 0` + `overflowY: 'auto'`;
 *        columna del mapa `flex: 1`, `minHeight: 0`, `position: relative`, con
 *        el mapa ocupándola entera (`zIndex: 0` lo aísla, para que el aviso
 *        "Sin posición GPS" quede encima de los panes de Leaflet).
 *     7. `LIMITES_ARGENTINA` (SO, NE): `fitBounds` al crear el mapa, después
 *        del primer `invalidateSize` y en `volverAVivo()`. Salen
 *        `PLANTA_EXPLORA` y `ZOOM_ARGENTINA`.
 *
 *   LIMITACIONES CONOCIDAS
 *     - Sin selector de tipo de mapa (satélite) ni pantalla completa:
 *       `mapTypeControl`/`fullscreenControl` no tienen equivalente directo en
 *       Leaflet sin plugins.
 *     - La traza ya no es geodésica (`L.polyline` une puntos en línea recta
 *       en Mercator); con puntos GPS cercanos entre sí no se nota.
 *     - Las teselas de `tile.openstreetmap.org` tienen política de uso
 *       justo: sirven para el volumen de este portal, no para tráfico masivo.
 *     - El modo oscuro es un filtro sobre las teselas claras, no un estilo
 *       oscuro diseñado.
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm run build` sin warnings. Manual, en claro y en oscuro: sin
 *     marca de agua; al abrir se ve Argentina completa; la lista scrollea sin
 *     mover el mapa; no hay scroll de página; redimensionar la ventana no deja
 *     teselas grises; seleccionar un viaje acerca y abre su popup; el
 *     historial dibuja la traza con A/B; "En vivo" re-centra en Argentina.
 *
 * -----------------------------------------------------------------------------
 * v1.2.6 — Mapa de Seguimiento
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     (a) En pantallas chicas (notebooks) el mapa quedaba como un recuadro
 *     gris: Leaflet cargaba pero no dibujaba teselas, hasta que el usuario
 *     cambiaba el zoom del navegador o el tamaño de la ventana.
 *     (b) La vista inicial era Argentina entera con países limítrofes; se
 *     pide el área operativa alrededor de Rosario.
 *
 *   CAUSA RAÍZ
 *     (a) Leaflet mide el contenedor una vez, al crear el mapa. El
 *     ResizeObserver de v1.2.5 llamaba a `invalidateSize()` dentro del
 *     callback (sincrónico, sin filtrar medidas 0) y encuadraba SOLO en la
 *     primera medición; además `fitBounds` corría antes, en la creación, con
 *     el tamaño provisorio. Con la cadena de alto fijo, el contenedor puede
 *     no tener su tamaño final en ese momento (fuentes, BarraSuperior, tab,
 *     filtros) y el mapa quedaba con zoom y teselas de un tamaño viejo.
 *     (b) `LIMITES_ARGENTINA` + `fitBounds` en la creación, en el observer y
 *     en `volverAVivo()`.
 *     Van juntos: el zoom de la vista inicial sale del tamaño medido.
 *
 *   ALCANCE
 *     1. `CENTRO_ROSARIO` / `REGION_OBJETIVO` reemplazan a
 *        `LIMITES_ARGENTINA` (en `seguimiento-encuadre.js`, con su test).
 *     2. `L.map` con `zoomSnap: 0.25` (zoomDelta sigue en 1).
 *     3. Vista inicial = `setView(CENTRO_ROSARIO, getBoundsZoom(
 *        limitesSimetricos(...)))`, aplicada en la primera medida válida, no
 *        al crear el mapa.
 *     4. ResizeObserver -> un solo `requestAnimationFrame` pendiente ->
 *        `invalidateSize()`; medidas con ancho o alto 0 se ignoran. Sin
 *        ResizeObserver, `window` resize con la misma función.
 *     5. Mientras el usuario no interactúe (zoom, arrastre, seleccionar un
 *        viaje) cada medida válida re-aplica la vista inicial; después, no.
 *        Interacción = `zoomstart`/`movestart` que no vienen de
 *        `aplicarVistaInicial()`, más seleccionar un viaje (lista, alerta,
 *        marcador o historial).
 *     6. "Volver a vivo" aplica la vista inicial y re-habilita (5).
 *     7. Cleanup: desconecta el observer (o el listener) y cancela el rAF
 *        pendiente antes de `map.remove()`.
 *
 *   LIMITACIONES CONOCIDAS
 *     - Sin ResizeObserver (navegadores muy viejos) solo se re-mide en el
 *       resize de la ventana: un cambio de tamaño del contenedor sin cambio
 *       de ventana vuelve a dejar el problema de (a).
 *     - El popup de un marcador con autoPan cuenta como interacción (es
 *       consecuencia de seleccionar un viaje, así que es lo esperado).
 *     - El zoom queda en múltiplos de 0.25: en niveles intermedios las
 *       teselas se escalan y se ven apenas menos nítidas.
 *     - La simetría de los límites es en grados (ver seguimiento-encuadre.js).
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm test` (incluye `seguimiento-encuadre.test.js`) y
 *     `CI=true npm run build` sin warnings. Manual: notebook (1280x650,
 *     1366x768) sin gris y con Rosario al centro, Córdoba, Santa Fe, Paraná y
 *     Buenos Aires a la vista; 1920x1080 más cerca; zoom del navegador 125 %
 *     y 150 %; cambiar tabs y filtros sin franjas grises; con un viaje
 *     seleccionado, redimensionar no lo saca de la vista; "En vivo" vuelve a
 *     la vista de Rosario.
 *
 * -----------------------------------------------------------------------------
 * v1.2.6 — Traza en vivo y estado del seguimiento (acompaña a TrackEx v1.1.2)
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     (a) En la prueba real del 24/11/2026 el coordinador no vio ningún
 *     recorrido: ningún viaje llegó a finalizarse desde la app y la pantalla
 *     solo dibujaba trazas en "Historial" (viajes FINALIZADO).
 *     (b) Un viaje que solo registra con la app abierta ("seguimiento
 *     limitado") se veía igual que uno sin señal.
 *     (c) En el historial, los recorridos de la 1.1.1 tenían cada punto dos
 *     veces, y la tarjeta mostraba `puntos_registrados`, que no es confiable.
 *
 *   CAUSA RAÍZ
 *     (a) En el REDISENO (ver arriba) se sacó la traza parcial al centrar un
 *     viaje en vivo. Ese recorte se hizo SIN CONSULTARLO y era una
 *     funcionalidad pedida: con él, un viaje en curso no tenía forma de
 *     mostrar su recorrido.
 *     (b) La pantalla no leía el estado del seguimiento: hasta TrackEx 1.1.2
 *     no existía (`seguimiento_estado` lo escribe la app desde esa versión).
 *     (c) TrackEx 1.1.1 grababa cada lectura con dos fuentes (mismas
 *     coordenadas, ms de diferencia), y `puntos_registrados` es un
 *     `increment` que sube de más cuando la app reenvía un lote.
 *
 *   ALCANCE
 *     1. Al seleccionar un viaje EN_VIAJE en "En vivo" (tarjeta, alerta o
 *        marcador) se abre UNA suscripción (`trazaUnsubRef`) a
 *        `viajes/{id}/gps_puntos` con `orderBy('ts')` y se dibuja la traza
 *        (`prepararTraza`, misma `L.polyline`) con "A" en el primer punto; sin
 *        "B": la posición actual ya es el `circleMarker` del viaje. Un viaje
 *        RECIBIDO no abre suscripción.
 *     2. Cada actualización redibuja SIN re-encuadrar; el encuadre a la
 *        traza se hace solo con el primer snapshot que trae traza. Seleccionar
 *        ya cuenta como interacción (v1.2.6 (5)), así que el re-encuadre
 *        automático de la vista inicial no pisa este encuadre; el `fitBounds`
 *        se marca como programático (`aplicandoVistaRef`).
 *     3. Baja de la suscripción: al deseleccionar, al seleccionar otro viaje,
 *        al cambiar de pestaña, en `volverAVivo()`, si el viaje sale de la
 *        lista (se cerró o lo saca un filtro) y al desmontar.
 *     4. Historial: `seleccionarHistorial` usa `prepararTraza` (los
 *        duplicados de la 1.1.1 dejan de dibujarse), atrapa el error de
 *        `getDocs` (traza vacía y aviso "No se pudo cargar el recorrido") y la
 *        tarjeta muestra la cantidad REAL de puntos del viaje seleccionado
 *        (`resumenTraza`) una vez cargada, en vez de `puntos_registrados`.
 *     5. Estado del seguimiento: Pastilla en la tarjeta del viaje en vivo y
 *        alerta en `getAlertas()` (`alertaSeguimiento`), solo para
 *        `limitado` y `sin_ubicacion`. El popup no cambia.
 *
 *   LIMITACIONES CONOCIDAS
 *     - Costo: la primera lectura de la suscripción trae TODOS los puntos del
 *       viaje (hasta unos 3000 en un día, uno cada 30 s); después llegan solo
 *       los nuevos. Por eso se abre solo al seleccionar explícitamente un
 *       viaje, nunca para todos.
 *     - Un error del listener se registra con `console.error` y deja la traza
 *       vacía; no se reintenta hasta volver a seleccionar el viaje.
 *     - Un viaje sin posición todavía (`ultima_lat` vacío) no se puede
 *       seleccionar desde la tarjeta (igual que antes), así que tampoco
 *       muestra traza: no tiene puntos.
 *     - Los viajes iniciados con TrackEx ≤ 1.1.1 no tienen
 *       `seguimiento_estado`: no muestran Pastilla ni alerta de seguimiento.
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm test` (incluye `logica-seguimiento.test.js`) y
 *     `CI=true npm run build` sin warnings. Manual (claro y oscuro, con un
 *     viaje en curso de TrackEx 1.1.2): ver la entrada v1.2.6 de
 *     portal/CHANGELOG.md.
 * ========================================================================== */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { db } from '../firebase';
import { collection, onSnapshot, query, where, doc, getDocs, orderBy } from 'firebase/firestore';
import { esAdmin, tieneRol, miOrganizacion, motivoSinAcceso, tieneAlgunRol } from '../sesion';
import { claveNormalizada } from '../mapa-normalizacion';
import { VIAJE, ETIQUETA_VIAJE } from '../shared/estados';
import {
  saludGPS, ETIQUETA_GPS, COLOR_GPS,
  estadoSeguimiento, ETIQUETA_SEGUIMIENTO, COLOR_SEGUIMIENTO,
} from '../shared/logica-viajes';
// v1.2.6 — traza en vivo (1, 4) y estado del seguimiento (5).
import { prepararTraza, resumenTraza, alertaSeguimiento } from './logica-seguimiento';
import { marca, colorEstado, espacio, radio, tipografia, paletaTexto } from '../shared/tokens';
import { useTema } from '../ui/TemaContext';
import Tarjeta from '../ui/Tarjeta';
import Pastilla from '../ui/Pastilla';
import Boton from '../ui/Boton';
import Vacio from '../ui/Vacio';
import ModalCierreManual from './ModalCierreManual';
import './Seguimiento.css';
// v1.2.6 (1): reemplazan a `LIMITES_ARGENTINA`.
import { CENTRO_ROSARIO, REGION_OBJETIVO, limitesSimetricos } from './seguimiento-encuadre';

// v1.2.6 (3): límites simétricos alrededor de Rosario que contienen la región
// objetivo -- de acá sale el zoom con `getBoundsZoom`.
const LIMITES_VISTA_INICIAL = limitesSimetricos(CENTRO_ROSARIO, REGION_OBJETIVO);

// v1.2.5 (1): la atribución es obligatoria por la licencia de OSM.
const TESELAS_OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATRIBUCION_OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** v1.2.5 (2): el contenido del popup de un viaje vivo (antes, el InfoWindow). */
function popupViaje(c) {
  return `
    <div style="font-family:sans-serif;padding:2px 0;min-width:200px">
      <div style="font-weight:600;font-size:13px;margin-bottom:4px">🚛 ${c.chofer}</div>
      <div style="font-size:12px;color:#6B7280">${c.producto_nombre || ''} · ${c.cliente_razon_social || ''}</div>
      <div style="font-size:12px;color:#6B7280;margin-top:2px">${c.patente_tractor || ''}${c.patente_semi ? ' / ' + c.patente_semi : ''}</div>
      <div style="font-size:11px;color:#9CA3AF;margin-top:4px">${ETIQUETA_VIAJE[c.estado] || c.estado}${c.demorado ? ' · demorado' : ''}</div>
    </div>
  `;
}

/**
 * v1.2.6 (3): vista inicial -- Rosario al centro con el zoom que hace entrar
 * la región objetivo en el tamaño actual del contenedor. `aplicandoRef`
 * marca el cambio como programático para que no cuente como interacción (5).
 */
function aplicarVistaInicial(map, aplicandoRef) {
  aplicandoRef.current = true;
  try {
    map.setView(CENTRO_ROSARIO, map.getBoundsZoom(LIMITES_VISTA_INICIAL), { animate: false });
  } finally {
    aplicandoRef.current = false;
  }
}

/** v1.2.5 (2): marcador "A"/"B" del historial -- círculo con la letra. */
function iconoLetra(letra, fondo) {
  return L.divIcon({
    className: 'seguimiento-marcador-letra',
    html: `<span style="background:${fondo}">${letra}</span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

const RANGOS_FECHA = [
  { id: 'todo', label: 'Todo' },
  { id: 'hoy', label: 'Hoy' },
  { id: '7dias', label: '7 días' },
  { id: 'mes', label: 'Este mes' },
];

function aFechaLocal(d) {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function fechaHoy() {
  return aFechaLocal(new Date());
}

function fechaHaceDias(dias) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return aFechaLocal(d);
}

function fechaInicioMes() {
  const d = new Date();
  return aFechaLocal(new Date(d.getFullYear(), d.getMonth(), 1));
}

/**
 * A diferencia del modelo viejo, ACA todos los timestamps son Firestore
 * Timestamp de verdad (`serverTimestamp()`) -- no hace falta el parseo
 * tolerante que existia para el `toLocaleString('es-AR')` sin AM/PM que
 * escribia el cierre manual del modelo legacy. Un solo camino.
 */
function aFecha(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

function FiltroMulti({ etiqueta, opciones, seleccion, onChange, vacio = 'Sin opciones', styles }) {
  const [abierto, setAbierto] = useState(false);
  const contenedorRef = useRef(null);

  useEffect(() => {
    if (!abierto) return;
    function alClickAfuera(e) {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target)) {
        setAbierto(false);
      }
    }
    document.addEventListener('mousedown', alClickAfuera);
    return () => document.removeEventListener('mousedown', alClickAfuera);
  }, [abierto]);

  function alternar(id) {
    if (seleccion.includes(id)) onChange(seleccion.filter(x => x !== id));
    else onChange([...seleccion, id]);
  }

  const hayFiltro = seleccion.length > 0;

  const textoBoton = !hayFiltro
    ? etiqueta
    : seleccion.length === 1
      ? (opciones.find(o => o.id === seleccion[0])?.label || etiqueta)
      : `${etiqueta} (${seleccion.length})`;

  return (
    <div ref={contenedorRef} style={styles.filtroWrap}>
      <button
        style={{ ...styles.filtroBtn, ...(hayFiltro ? styles.filtroBtnActivo : {}) }}
        onClick={() => setAbierto(a => !a)}
        title={hayFiltro ? seleccion.map(id => opciones.find(o => o.id === id)?.label).filter(Boolean).join(', ') : etiqueta}>
        <span style={styles.filtroBtnTxt}>{textoBoton}</span>
        <span style={{ fontSize: 9, opacity: 0.7 }}>{abierto ? '▲' : '▼'}</span>
      </button>

      {abierto && (
        <div style={styles.filtroPanel}>
          {opciones.length === 0 && <div style={styles.filtroVacio}>{vacio}</div>}

          {opciones.length > 0 && (
            <>
              <div style={styles.filtroAcciones}>
                <button style={styles.filtroAccionBtn} onClick={() => onChange(opciones.map(o => o.id))}>Todos</button>
                <button style={styles.filtroAccionBtn} onClick={() => onChange([])}>Ninguno</button>
              </div>
              {opciones.map(o => (
                <label key={o.id} style={styles.filtroOpcion}>
                  <input
                    type="checkbox"
                    checked={seleccion.includes(o.id)}
                    onChange={() => alternar(o.id)}
                    style={{ margin: 0, cursor: 'pointer' }}
                  />
                  <span style={styles.filtroOpcionTxt}>{o.label}</span>
                </label>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Seguimiento({ usuario, onVolver }) {
  const styles = useEstilos();
  const { oscuro } = useTema();
  const [tab, setTab] = useState('vivo');
  const [viajesVivos, setViajesVivos] = useState([]);
  const [viajesHistorial, setViajesHistorial] = useState([]);
  const [organizaciones, setOrganizaciones] = useState([]);
  const [choferesInfo, setChoferesInfo] = useState([]);
  const [seleccionado, setSeleccionado] = useState(null);
  const [seleccionadoHist, setSeleccionadoHist] = useState(null);
  const [cargando, setCargando] = useState(true);
  // v1.2.6 — traza en vivo (4): `{ id, cantidad }` del recorrido de historial
  // ya cargado, y el id del viaje cuyo recorrido no se pudo cargar.
  const [resumenHist, setResumenHist] = useState(null);
  const [errorHist, setErrorHist] = useState(null);
  // RF-02: el viaje sobre el que está abierto ModalCierreManual, o null.
  const [cerrandoManual, setCerrandoManual] = useState(null);

  const soyAdmin = esAdmin(usuario);
  const soyCoordinador = tieneRol(usuario, 'coordinador');
  const soyTransportista = tieneRol(usuario, 'transportista');
  const miOrg = miOrganizacion(usuario);
  const sinAcceso = motivoSinAcceso(usuario, ['admin', 'coordinador', 'transportista']);

  const soloVeSuEmpresa = soyTransportista && !soyAdmin && !soyCoordinador;
  // RF-02: mismo criterio que Programacion.js -- nunca el transportista,
  // aunque esté viendo sus propios viajes.
  const puedeCerrarManual = tieneAlgunRol(usuario, ['admin', 'coordinador']);

  function abrirCierreManual(viaje) {
    setCerrandoManual(viaje);
  }

  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroTransportistas, setFiltroTransportistas] = useState([]);
  const [filtroChoferes, setFiltroChoferes] = useState([]);
  const [filtroRango, setFiltroRango] = useState('todo');

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const polylineRef = useRef(null);
  const marcadoresHistRef = useRef([]);
  // v1.2.6 (5): si el usuario ya movió el mapa, y si el movimiento en curso es nuestro.
  const interactuoRef = useRef(false);
  const aplicandoVistaRef = useRef(false);
  // v1.2.6 — traza en vivo (1): la ÚNICA suscripción de traza abierta (su
  // `unsub`), el viaje al que pertenece, y si ya se encuadró (2).
  const trazaUnsubRef = useRef(null);
  const trazaViajeRef = useRef(null);
  const trazaEncuadradaRef = useRef(false);
  // v1.2.6 — traza en vivo (4): último recorrido de historial pedido, para
  // descartar la respuesta de un clic anterior que llega tarde.
  const histPedidoRef = useRef(null);
  // v1.2.6 — traza en vivo (1): lista vigente, para que el clic de un marcador
  // (cuyo handler se creó con el viaje de ese momento) use el estado actual.
  const vivosRef = useRef([]);

  useEffect(() => {
    if (sinAcceso) { setCargando(false); return; }

    const base = collection(db, 'viajes');
    const filtroOrg = soloVeSuEmpresa ? [where('transportista_org_id', '==', miOrg)] : [];

    const consultaVivos = query(base, ...filtroOrg, where('estado', 'in', [VIAJE.RECIBIDO, VIAJE.EN_VIAJE]));
    const consultaHist = query(base, ...filtroOrg, where('estado', '==', VIAJE.FINALIZADO));

    const unsubVivos = onSnapshot(consultaVivos, (snap) => {
      setViajesVivos(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setCargando(false);
    }, (err) => { console.error('Viajes en vivo:', err); setCargando(false); });

    const unsubHist = onSnapshot(consultaHist, (snap) => {
      setViajesHistorial(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error('Historial:', err));

    return () => { unsubVivos(); unsubHist(); };
  }, [sinAcceso, soloVeSuEmpresa, miOrg]);

  useEffect(() => {
    if (sinAcceso) return;

    const unsubOrgs = soloVeSuEmpresa
      ? onSnapshot(doc(db, 'organizaciones', miOrg), (snap) => {
          setOrganizaciones(snap.exists() ? [{ id: snap.id, ...snap.data() }] : []);
        })
      : onSnapshot(
          query(collection(db, 'organizaciones'), where('es_transportista', '==', true)),
          (snap) => setOrganizaciones(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        );

    const consultaChoferes = soloVeSuEmpresa
      ? query(collection(db, 'usuarios'), where('organizacion_id', '==', miOrg))
      : collection(db, 'usuarios');
    const unsubChoferes = onSnapshot(consultaChoferes, (snap) => {
      setChoferesInfo(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => (u.roles || []).includes('chofer')));
    });

    return () => { unsubOrgs(); unsubChoferes(); };
  }, [sinAcceso, soloVeSuEmpresa, miOrg]);

  const orgsPorId = useMemo(() => new Map(organizaciones.map(o => [o.id, o])), [organizaciones]);
  const choferesPorUid = useMemo(() => new Map(choferesInfo.map(c => [c.id, c])), [choferesInfo]);

  const enriquecer = useCallback((v) => {
    return {
      ...v,
      chofer: (choferesPorUid.get(v.chofer_uid) || {}).nombre || v.chofer_dni || 'Sin nombre',
      transporte: (orgsPorId.get(v.transportista_org_id) || {}).razon_social || 'Sin transportista',
      transporte_key: v.transportista_org_id || 'sin_transportista',
      chofer_key: v.chofer_dni || v.chofer_uid || 'sin_chofer',
    };
  }, [choferesPorUid, orgsPorId]);

  const vivosEnriquecidos = useMemo(() => viajesVivos.map(enriquecer), [viajesVivos, enriquecer]);
  const historialEnriquecido = useMemo(() => viajesHistorial.map(enriquecer), [viajesHistorial, enriquecer]);

  // v1.2.5 (3): el mapa se crea una sola vez y se destruye en el cleanup.
  // Tiene que declararse ANTES del efecto de marcadores, para que en el
  // segundo montaje de StrictMode el mapa ya exista cuando se recrean.
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return undefined;

    // v1.2.6 (2): zoom en niveles intermedios; los botones +/- siguen de a 1.
    // v1.2.6 (3): sin vista acá -- se aplica en la primera medida válida.
    const map = L.map(el, { zoomControl: true, zoomSnap: 0.25, zoomDelta: 1 });
    L.tileLayer(TESELAS_OSM, { maxZoom: 19, attribution: ATRIBUCION_OSM }).addTo(map);
    mapInstanceRef.current = map;
    aplicandoVistaRef.current = false;
    interactuoRef.current = false;

    // v1.2.6 (5): cualquier zoom/movimiento que no venga de
    // `aplicarVistaInicial()` es del usuario.
    const marcarInteraccion = () => { if (!aplicandoVistaRef.current) interactuoRef.current = true; };
    map.on('zoomstart movestart', marcarInteraccion);

    // v1.2.6 (4): un solo rAF pendiente; medidas 0 (contenedor oculto) se ignoran.
    let rafPendiente = null;
    const remedir = () => {
      if (rafPendiente !== null) return;
      rafPendiente = requestAnimationFrame(() => {
        rafPendiente = null;
        if (el.clientWidth === 0 || el.clientHeight === 0) return;
        map.invalidateSize();
        // v1.2.6 (5): re-encuadre automático hasta la primera interacción.
        if (!interactuoRef.current) aplicarVistaInicial(map, aplicandoVistaRef);
      });
    };

    // v1.2.6 (4): sin ResizeObserver, `window` resize (LIMITACIONES CONOCIDAS).
    const hayObserver = typeof ResizeObserver !== 'undefined';
    const observador = hayObserver ? new ResizeObserver(remedir) : null;
    if (observador) observador.observe(el);
    else { window.addEventListener('resize', remedir); remedir(); }

    return () => {
      // v1.2.6 (7): primero cortar mediciones, después destruir el mapa.
      if (observador) observador.disconnect();
      else window.removeEventListener('resize', remedir);
      if (rafPendiente !== null) cancelAnimationFrame(rafPendiente);
      map.off('zoomstart movestart', marcarInteraccion);
      map.remove();
      mapInstanceRef.current = null;
      markersRef.current = {};
      polylineRef.current = null;
      marcadoresHistRef.current = [];
    };
  }, []);

  const opcionesTransportistas = useMemo(() => {
    const mapa = new Map();
    [...vivosEnriquecidos, ...historialEnriquecido].forEach(r => {
      if (!mapa.has(r.transporte_key)) mapa.set(r.transporte_key, r.transporte);
    });
    return [...mapa.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [vivosEnriquecidos, historialEnriquecido]);

  const opcionesChoferes = useMemo(() => {
    const mapa = new Map();
    [...vivosEnriquecidos, ...historialEnriquecido].forEach(r => {
      if (filtroTransportistas.length > 0 && !filtroTransportistas.includes(r.transporte_key)) return;
      if (!mapa.has(r.chofer_key)) mapa.set(r.chofer_key, r.chofer);
    });
    return [...mapa.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [vivosEnriquecidos, historialEnriquecido, filtroTransportistas]);

  useEffect(() => {
    if (filtroChoferes.length === 0) return;
    const validos = new Set(opcionesChoferes.map(o => o.id));
    const podados = filtroChoferes.filter(id => validos.has(id));
    if (podados.length !== filtroChoferes.length) setFiltroChoferes(podados);
  }, [opcionesChoferes]); // eslint-disable-line react-hooks/exhaustive-deps

  const desdeFecha = useMemo(() => {
    if (filtroRango === 'hoy') return fechaHoy();
    if (filtroRango === '7dias') return fechaHaceDias(6);
    if (filtroRango === 'mes') return fechaInicioMes();
    return null;
  }, [filtroRango]);

  const textoFiltro = claveNormalizada(filtroTexto);

  function pasaFiltros(r) {
    if (textoFiltro) {
      const campo = claveNormalizada(`${r.chofer} ${r.cliente_razon_social} ${r.patente_tractor || ''} ${r.patente_semi || ''}`);
      if (!campo.includes(textoFiltro)) return false;
    }
    if (filtroTransportistas.length > 0 && !filtroTransportistas.includes(r.transporte_key)) return false;
    if (filtroChoferes.length > 0 && !filtroChoferes.includes(r.chofer_key)) return false;
    if (desdeFecha) {
      if (!r.fecha_carga) return false;
      if (filtroRango === 'hoy') { if (r.fecha_carga !== desdeFecha) return false; }
      else if (r.fecha_carga < desdeFecha) return false;
    }
    return true;
  }

  const choferesFiltrados = useMemo(
    () => vivosEnriquecidos.filter(pasaFiltros),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vivosEnriquecidos, textoFiltro, filtroTransportistas, filtroChoferes, filtroRango, desdeFecha]
  );

  const histFiltrado = useMemo(
    () => historialEnriquecido.filter(pasaFiltros),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [historialEnriquecido, textoFiltro, filtroTransportistas, filtroChoferes, filtroRango, desdeFecha]
  );

  const hayFiltrosActivos =
    !!filtroTexto || filtroTransportistas.length > 0 || filtroChoferes.length > 0 || filtroRango !== 'todo';

  function limpiarFiltros() {
    setFiltroTexto('');
    setFiltroTransportistas([]);
    setFiltroChoferes([]);
    setFiltroRango('todo');
  }

  // v1.2.5 (2): marcadores de viajes vivos como `circleMarker`, mismo
  // relleno (COLOR_GPS / demorado) y borde blanco que el círculo de Google.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const idsActuales = new Set(choferesFiltrados.map(c => c.id));
    Object.keys(markersRef.current).forEach(uid => {
      if (!idsActuales.has(uid)) {
        markersRef.current[uid].remove();
        delete markersRef.current[uid];
      }
    });

    choferesFiltrados.forEach(c => {
      if (!c.ultima_lat || !c.ultima_lng) return;
      const pos = [c.ultima_lat, c.ultima_lng];
      const salud = saludGPS(c);
      const color = c.demorado ? colorEstado.advertenciaBorde : (COLOR_GPS[salud] || COLOR_GPS.sin_datos);
      const estilo = { radius: 9, fillColor: color, fillOpacity: 1, color: '#fff', weight: 2 };

      if (markersRef.current[c.id]) {
        markersRef.current[c.id].setLatLng(pos);
        markersRef.current[c.id].setStyle(estilo);
        markersRef.current[c.id].setPopupContent(popupViaje(c));
      } else {
        const marker = L.circleMarker(pos, estilo).addTo(map);
        marker.bindTooltip(c.chofer);
        marker.bindPopup(popupViaje(c));
        marker.on('click', () => {
          interactuoRef.current = true; // v1.2.6 (5)
          setSeleccionado(c.id);
          map.panTo(marker.getLatLng());
          // v1.2.6 — traza en vivo (1): con el viaje VIGENTE, no el de la
          // creación del marcador (pudo pasar de RECIBIDO a EN_VIAJE).
          abrirTrazaVivo(vivosRef.current.find(x => x.id === c.id) || c);
        });
        markersRef.current[c.id] = marker;
      }
    });
  }, [choferesFiltrados]); // eslint-disable-line react-hooks/exhaustive-deps -- `abrirTrazaVivo` solo usa refs y setters estables

  // v1.2.6 — traza en vivo (3): si el viaje de la traza sale de la lista
  // (se cerró, pasó a FINALIZADO, o un filtro lo saca y con él su marcador),
  // o deja de estar EN_VIAJE, se da de baja la suscripción y se deselecciona.
  // Depende solo de `choferesFiltrados`: `cerrarTrazaVivo` solo usa refs.
  useEffect(() => {
    const id = trazaViajeRef.current;
    if (!id) return;
    const vigente = choferesFiltrados.find(c => c.id === id);
    if (!vigente || vigente.estado !== VIAJE.EN_VIAJE) {
      cerrarTrazaVivo();
      setSeleccionado(null);
    }
  }, [choferesFiltrados]); // eslint-disable-line react-hooks/exhaustive-deps

  // v1.2.6 — traza en vivo (3): al desmontar, baja la suscripción. Solo
  // desuscribe: el mapa (y la traza dibujada) lo destruye su propio cleanup.
  useEffect(() => () => bajarSuscripcionTraza(), []); // eslint-disable-line react-hooks/exhaustive-deps

  function limpiarPolyline() {
    if (polylineRef.current) { polylineRef.current.remove(); polylineRef.current = null; }
  }

  function limpiarMarcadoresHist() {
    marcadoresHistRef.current.forEach(m => m.remove());
    marcadoresHistRef.current = [];
  }

  /**
   * Dibuja la traza (`L.polyline`). `encuadrar` en false (v1.2.6 — traza en
   * vivo (2)) redibuja sin mover el mapa; el historial encuadra siempre.
   */
  function dibujarTraza(track, { encuadrar = true } = {}) {
    limpiarPolyline();
    const map = mapInstanceRef.current;
    if (!track || track.length < 2 || !map) return;
    const path = track.map(p => [p.lat, p.lng]);
    // v1.2.5 (2): sin `geodesic` -- ver LIMITACIONES CONOCIDAS.
    polylineRef.current = L.polyline(path, { color: marca, opacity: 0.75, weight: 3 }).addTo(map);
    if (encuadrar) map.fitBounds(polylineRef.current.getBounds());
  }

  /**
   * v1.2.6 — traza en vivo (3): da de baja la suscripción de traza, si hay.
   * No toca el mapa (sirve también al desmontar, cuando ya no existe).
   */
  function bajarSuscripcionTraza() {
    if (trazaUnsubRef.current) {
      trazaUnsubRef.current();
      trazaUnsubRef.current = null;
    }
    trazaViajeRef.current = null;
    trazaEncuadradaRef.current = false;
  }

  /** v1.2.6 — traza en vivo (3): baja la suscripción y borra la traza y la "A". */
  function cerrarTrazaVivo() {
    bajarSuscripcionTraza();
    limpiarPolyline();
    limpiarMarcadoresHist();
  }

  /**
   * v1.2.6 — traza en vivo (1, 2): redibuja la traza del viaje en curso con la
   * "A" en el primer punto. Encuadra solo la primera vez que hay traza; el
   * `fitBounds` se marca como programático (v1.2.6 (5)).
   */
  function dibujarTrazaVivo(traza) {
    const map = mapInstanceRef.current;
    if (!map) return;
    const encuadrar = !trazaEncuadradaRef.current && traza.length >= 2;
    dibujarTraza(traza, { encuadrar: false });
    limpiarMarcadoresHist();
    if (traza.length >= 1) {
      marcadoresHistRef.current.push(
        L.marker([traza[0].lat, traza[0].lng], { title: 'Inicio', icon: iconoLetra('A', colorEstado.exitoBorde) }).addTo(map)
      );
    }
    if (encuadrar && polylineRef.current) {
      trazaEncuadradaRef.current = true;
      aplicandoVistaRef.current = true;
      try {
        map.fitBounds(polylineRef.current.getBounds());
      } finally {
        aplicandoVistaRef.current = false;
      }
    }
  }

  /**
   * v1.2.6 — traza en vivo (1): abre la suscripción a la traza de un viaje en
   * curso. Una sola a la vez: cierra la anterior. RECIBIDO no tiene traza.
   * COSTO: el primer snapshot trae todos los puntos del viaje (hasta ~3000 en
   * un día), por eso solo se llama al seleccionar un viaje explícitamente.
   */
  function abrirTrazaVivo(c) {
    cerrarTrazaVivo();
    if (!c || c.estado !== VIAJE.EN_VIAJE) return;

    const id = c.id;
    trazaViajeRef.current = id;
    trazaUnsubRef.current = onSnapshot(
      query(collection(db, 'viajes', id, 'gps_puntos'), orderBy('ts')),
      (snap) => {
        if (trazaViajeRef.current !== id) return; // llegó tarde, ya se cambió de viaje
        dibujarTrazaVivo(prepararTraza(snap.docs.map(d => d.data())));
      },
      (err) => {
        console.error('Traza en vivo:', err);
        if (trazaViajeRef.current !== id) return;
        limpiarPolyline();
        limpiarMarcadoresHist();
      }
    );
  }

  function centrarEnChofer(c) {
    const map = mapInstanceRef.current;
    if (!c.ultima_lat || !c.ultima_lng || !map) return;
    interactuoRef.current = true; // v1.2.6 (5)
    map.setView([c.ultima_lat, c.ultima_lng], 13);
    setSeleccionado(c.id);
    if (markersRef.current[c.id]) markersRef.current[c.id].openPopup();
    abrirTrazaVivo(c); // v1.2.6 — traza en vivo (1)
  }

  async function seleccionarHistorial(h) {
    setSeleccionadoHist(h.id);
    interactuoRef.current = true; // v1.2.6 (5)
    // v1.2.6 — traza en vivo (4): sin número hasta que cargue; sin aviso viejo.
    histPedidoRef.current = h.id;
    setResumenHist(null);
    setErrorHist(null);

    Object.keys(markersRef.current).forEach(uid => markersRef.current[uid].remove());
    cerrarTrazaVivo();

    // v1.2.6 — traza en vivo (4): un error deja la traza vacía con aviso.
    let track = [];
    let fallo = false;
    try {
      const snap = await getDocs(query(collection(db, 'viajes', h.id, 'gps_puntos'), orderBy('ts')));
      track = prepararTraza(snap.docs.map(d => d.data()));
    } catch (err) {
      console.error('Recorrido del historial:', err);
      fallo = true;
    }
    // Un clic en otro viaje (o un cambio de pestaña) mientras se cargaba este:
    // se descarta.
    if (histPedidoRef.current !== h.id) return;
    if (fallo) setErrorHist(h.id);
    else setResumenHist({ id: h.id, cantidad: resumenTraza(track).cantidad });

    dibujarTraza(track);

    const map = mapInstanceRef.current;
    if (map && track.length >= 2) {
      const inicio = track[0];
      const fin = track[track.length - 1];
      // v1.2.5 (2): "A"/"B" como `marker` + `divIcon`, mismos colores.
      marcadoresHistRef.current.push(
        L.marker([inicio.lat, inicio.lng], { title: 'Inicio', icon: iconoLetra('A', colorEstado.exitoBorde) }).addTo(map)
      );
      marcadoresHistRef.current.push(
        L.marker([fin.lat, fin.lng], { title: 'Fin', icon: iconoLetra('B', marca) }).addTo(map)
      );
    }
  }

  function volverAVivo() {
    // v1.2.6 — traza en vivo (3): baja la suscripción y deselecciona (la
    // tarjeta no puede quedar marcada sin su traza).
    cerrarTrazaVivo();
    setSeleccionado(null);
    histPedidoRef.current = null;
    setSeleccionadoHist(null);
    const map = mapInstanceRef.current;
    if (!map) return;
    choferesFiltrados.forEach(c => {
      if (!c.ultima_lat || !c.ultima_lng) return;
      if (markersRef.current[c.id]) markersRef.current[c.id].addTo(map);
    });
    // v1.2.6 (6): vuelve a la vista inicial y re-habilita el re-encuadre.
    interactuoRef.current = false;
    aplicarVistaInicial(map, aplicandoVistaRef);
  }

  function tiempoDesde(ts) {
    const d = aFecha(ts);
    if (!d) return '—';
    const diff = Date.now() - d.getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (h > 0) return `hace ${h} h ${m} min`;
    return `hace ${m} min`;
  }

  function formatFecha(str) {
    if (!str) return '—';
    const partes = str.split('-');
    return partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : str;
  }

  function formatTs(ts) {
    const d = aFecha(ts);
    if (!d) return '—';
    return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function getAlertas() {
    const alertas = [];
    choferesFiltrados.forEach(c => {
      if (c.demorado) {
        alertas.push({ id: c.id, chofer: c.chofer, msg: 'Viaje demorado', tipo: 'amber' });
      }
      const salud = saludGPS(c);
      if (salud === 'intermitente') {
        alertas.push({ id: c.id, chofer: c.chofer, msg: ETIQUETA_GPS.intermitente, tipo: 'amber' });
      }
      if (salud === 'sin_senal') {
        alertas.push({ id: c.id, chofer: c.chofer, msg: ETIQUETA_GPS.sin_senal, tipo: 'red' });
      }
      // v1.2.6 — traza en vivo (5): "seguimiento limitado" / "sin permiso de
      // ubicación", separado de "sin señal".
      const alertaSeg = alertaSeguimiento(c);
      if (alertaSeg) alertas.push({ id: c.id, chofer: c.chofer, ...alertaSeg });
    });
    return alertas;
  }

  const alertas = getAlertas();
  // v1.2.6 — traza en vivo (1): ver `vivosRef`.
  vivosRef.current = choferesFiltrados;

  if (sinAcceso) {
    return <div style={styles.wrap}><div style={styles.bannerError}>{sinAcceso}</div></div>;
  }

  return (
    <div style={styles.wrap}>

      <div style={styles.topbar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={styles.topbarTit}>Seguimiento</span>
          {tab === 'vivo' && (
            <span style={styles.topbarSub}>
              {choferesFiltrados.length} activo{choferesFiltrados.length !== 1 ? 's' : ''}
              {hayFiltrosActivos && vivosEnriquecidos.length !== choferesFiltrados.length ? ` de ${vivosEnriquecidos.length}` : ''}
            </span>
          )}
          {tab === 'historial' && (
            <span style={styles.topbarSub}>
              {histFiltrado.length} viaje{histFiltrado.length !== 1 ? 's' : ''}
              {hayFiltrosActivos && historialEnriquecido.length !== histFiltrado.length ? ` de ${historialEnriquecido.length}` : ''}
            </span>
          )}
        </div>
        <div style={styles.tabs}>
          <button style={{ ...styles.tabBtn, ...(tab === 'vivo' ? styles.tabBtnActive : {}) }}
            onClick={() => { setTab('vivo'); volverAVivo(); }}>🔴 En vivo</button>
          <button style={{ ...styles.tabBtn, ...(tab === 'historial' ? styles.tabBtnActive : {}) }}
            onClick={() => {
              // v1.2.6 — traza en vivo (3): cambiar de pestaña baja la suscripción.
              setTab('historial'); cerrarTrazaVivo(); setSeleccionado(null);
              histPedidoRef.current = null; setSeleccionadoHist(null);
            }}>📂 Historial</button>
        </div>
      </div>

      <div style={styles.layout}>
        <div style={styles.panel}>

          <div style={styles.filtrosBloque}>
            <input
              style={styles.buscador}
              value={filtroTexto}
              onChange={e => setFiltroTexto(e.target.value)}
              placeholder="Buscar chofer, cliente o patente..."
            />

            <div style={styles.filtrosFila}>
              <FiltroMulti
                etiqueta="Transportista"
                opciones={opcionesTransportistas}
                seleccion={filtroTransportistas}
                onChange={setFiltroTransportistas}
                vacio="Sin transportistas con viajes"
                styles={styles}
              />
              <FiltroMulti
                etiqueta="Chofer"
                opciones={opcionesChoferes}
                seleccion={filtroChoferes}
                onChange={setFiltroChoferes}
                vacio="Sin choferes para esta selección"
                styles={styles}
              />
            </div>

            <div style={styles.filtrosFila}>
              {RANGOS_FECHA.map(r => (
                <button key={r.id}
                  style={{ ...styles.chipFecha, ...(filtroRango === r.id ? styles.chipFechaActivo : {}) }}
                  onClick={() => setFiltroRango(r.id)}>
                  {r.label}
                </button>
              ))}
            </div>

            {hayFiltrosActivos && (
              <button style={styles.btnLimpiarFiltros} onClick={limpiarFiltros}>
                ✕ Limpiar filtros
              </button>
            )}
          </div>

          {tab === 'vivo' && (
            <>
              {alertas.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  {alertas.map((a, i) => (
                    <div key={i}
                      style={{
                        ...styles.alerta,
                        background: a.tipo === 'red' ? colorEstado.peligroFondoAlterno : colorEstado.advertenciaFondoAlterno,
                        borderColor: a.tipo === 'red' ? colorEstado.peligroBordeAlterno : colorEstado.advertenciaBordeAlterno,
                      }}
                      onClick={() => { const c = choferesFiltrados.find(x => x.id === a.id); if (c) centrarEnChofer(c); }}>
                      <span>{a.tipo === 'red' ? '🔴' : '🟠'}</span>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: tipografia.peso.medio, color: a.tipo === 'red' ? colorEstado.peligroTextoFuerte : colorEstado.advertenciaTextoFuerte }}>{a.chofer}</div>
                        <div style={{ fontSize: 11, color: a.tipo === 'red' ? colorEstado.peligroTextoFuerte : colorEstado.advertenciaTextoFuerte }}>{a.msg}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {cargando && <Vacio titulo="Cargando..." />}
              {!cargando && choferesFiltrados.length === 0 && (
                <Vacio titulo={
                  hayFiltrosActivos && vivosEnriquecidos.length > 0
                    ? 'Ningún viaje activo coincide con los filtros.'
                    : 'No hay viajes activos en este momento.'
                } />
              )}

              {choferesFiltrados.map(c => {
                const salud = saludGPS(c);
                const activo = seleccionado === c.id;
                const colorEstadoViaje = c.demorado ? colorEstado.advertenciaBorde : (COLOR_GPS[salud] || COLOR_GPS.sin_datos);
                return (
                  <Tarjeta
                    key={c.id}
                    onClick={() => { if (seleccionado === c.id) { cerrarTrazaVivo(); setSeleccionado(null); } else { centrarEnChofer(c); } }}
                    style={{ marginBottom: espacio.sm, padding: '10px 12px', borderColor: activo ? colorEstadoViaje : undefined }}
                  >
                    <div style={styles.choferHeader}>
                      <span style={{ ...styles.dot, background: colorEstadoViaje }} />
                      <span style={styles.choferNombre}>{c.chofer}</span>
                      <Pastilla chico colores={{ bg: colorEstadoViaje + '22', color: colorEstadoViaje }}>{ETIQUETA_VIAJE[c.estado] || c.estado}</Pastilla>
                      {c.demorado && <Pastilla chico colores={{ bg: colorEstado.advertenciaFondo, color: colorEstado.advertenciaTexto }}>Demorado</Pastilla>}
                      {/* v1.2.6 — traza en vivo (5): solo limitado / sin_ubicacion. */}
                      {['limitado', 'sin_ubicacion'].includes(estadoSeguimiento(c)) && (
                        <Pastilla chico colores={{ bg: COLOR_SEGUIMIENTO[estadoSeguimiento(c)] + '22', color: COLOR_SEGUIMIENTO[estadoSeguimiento(c)] }}>
                          {ETIQUETA_SEGUIMIENTO[estadoSeguimiento(c)]}
                        </Pastilla>
                      )}
                    </div>
                    {c.transporte && <div style={styles.choferTransporte}>🚚 {c.transporte}</div>}
                    <div style={styles.choferGrid}>
                      <div style={styles.cf}><span style={styles.cl}>Cliente</span><span style={styles.cv}>{c.cliente_razon_social}</span></div>
                      <div style={styles.cf}><span style={styles.cl}>Destino</span><span style={styles.cv}>{c.destino_texto}</span></div>
                      <div style={styles.cf}><span style={styles.cl}>Producto</span><span style={styles.cv}>{c.producto_nombre}</span></div>
                      <div style={styles.cf}><span style={styles.cl}>Unidad</span><span style={styles.cv}>{c.patente_tractor}{c.patente_semi ? ' / ' + c.patente_semi : ''}</span></div>
                      <div style={styles.cf}><span style={styles.cl}>Carga</span><span style={styles.cv}>{formatFecha(c.fecha_carga)}</span></div>
                      <div style={styles.cf}>
                        <span style={styles.cl}>GPS</span>
                        <span style={{ ...styles.cv, color: colorEstadoViaje }}>{c.ultima_ts ? tiempoDesde(c.ultima_ts) : ETIQUETA_GPS.sin_datos}</span>
                      </div>
                    </div>
                    {/* RF-02: nunca para el transportista -- ver el
                        encabezado v1.2.0 (RF-02) más arriba. */}
                    {puedeCerrarManual && (
                      <div style={styles.cerrarManualFila}>
                        <Boton
                          chico variante="peligro"
                          onClick={(e) => { e.stopPropagation(); abrirCierreManual(c); }}
                        >
                          Cerrar viaje a mano
                        </Boton>
                      </div>
                    )}
                  </Tarjeta>
                );
              })}
            </>
          )}

          {tab === 'historial' && (
            <>
              {cargando && <Vacio titulo="Cargando..." />}
              {!cargando && histFiltrado.length === 0 && (
                <Vacio titulo={
                  hayFiltrosActivos && historialEnriquecido.length > 0
                    ? 'Ningún viaje coincide con los filtros.'
                    : 'Todavía no hay viajes finalizados.'
                } />
              )}

              {histFiltrado.map(h => {
                const activo = seleccionadoHist === h.id;
                return (
                  <Tarjeta
                    key={h.id}
                    onClick={() => seleccionarHistorial(h)}
                    style={{ marginBottom: espacio.sm, padding: '10px 12px', borderColor: activo ? marca : undefined }}
                  >
                    <div style={styles.choferHeader}>
                      <span style={{ ...styles.dot, background: marca }} />
                      <span style={styles.choferNombre}>{h.chofer}</span>
                      <Pastilla chico colores={{ bg: colorEstado.peligroFondo, color: marca }}>Finalizado</Pastilla>
                    </div>
                    {h.transporte && <div style={styles.choferTransporte}>🚚 {h.transporte}</div>}
                    <div style={styles.choferGrid}>
                      <div style={styles.cf}><span style={styles.cl}>Cliente</span><span style={styles.cv}>{h.cliente_razon_social}</span></div>
                      <div style={styles.cf}><span style={styles.cl}>Producto</span><span style={styles.cv}>{h.producto_nombre}</span></div>
                      <div style={styles.cf}><span style={styles.cl}>Fecha carga</span><span style={styles.cv}>{formatFecha(h.fecha_carga)}</span></div>
                      <div style={styles.cf}><span style={styles.cl}>Inicio</span><span style={styles.cv}>{formatTs(h.inicio_ts)}</span></div>
                      <div style={styles.cf}><span style={styles.cl}>Fin</span><span style={styles.cv}>{formatTs(h.fin_ts)}</span></div>
                      <div style={styles.cf}><span style={styles.cl}>Unidad</span><span style={styles.cv}>{h.patente_tractor}{h.patente_semi ? ' / ' + h.patente_semi : ''}</span></div>
                    </div>
                    {/* v1.2.6 — traza en vivo (4): cantidad REAL (deduplicada) del
                        viaje seleccionado, una vez cargada; `puntos_registrados`
                        no es confiable. Sin número mientras no esté cargada. */}
                    {resumenHist && resumenHist.id === h.id && (
                      <div style={styles.puntosGps}>📍 {resumenHist.cantidad} puntos GPS</div>
                    )}
                  </Tarjeta>
                );
              })}
            </>
          )}
        </div>

        {/* v1.2.5 (5): la clase va acá, no en el div del mapa. */}
        <div style={styles.mapaWrap} className={oscuro ? 'mapa-oscuro' : undefined}>
          <div ref={mapRef} style={styles.mapa} />
          {tab === 'vivo' && !cargando && choferesFiltrados.filter(c => c.ultima_lat).length === 0 && (
            <div style={styles.sinGps}>
              Sin posición GPS disponible todavía.<br />
              <span style={{ fontSize: 12, color: styles.cl.color }}>Los viajes aparecen en el mapa al iniciar.</span>
            </div>
          )}
          {tab === 'historial' && !seleccionadoHist && (
            <div style={styles.sinGps}>
              Seleccioná un viaje del panel para ver el recorrido.
            </div>
          )}
          {/* v1.2.6 — traza en vivo (4): el `getDocs` del recorrido falló. */}
          {tab === 'historial' && seleccionadoHist && errorHist === seleccionadoHist && (
            <div style={styles.sinGps}>
              No se pudo cargar el recorrido.
            </div>
          )}
        </div>
      </div>

      {/* RF-02: mismo modal que Programacion.js -- `despacho.numero` no está
          disponible acá (ver LIMITACIONES CONOCIDAS del encabezado v1.2.0
          (RF-02)), el modal lo contempla. */}
      {cerrandoManual && (
        <ModalCierreManual
          viaje={cerrandoManual}
          despacho={{ id: cerrandoManual.despacho_id, numero: null, fecha_carga: cerrandoManual.fecha_carga }}
          usuario={usuario}
          onCerrado={() => setCerrandoManual(null)}
          onCancelar={() => setCerrandoManual(null)}
        />
      )}
    </div>
  );
}

function crearEstilos(colores, oscuro) {
  const pal = paletaTexto(oscuro);

  return {
    wrap: { flex: 1, minHeight: 0, fontFamily: tipografia.familia, background: colores.fondo, color: colores.texto, display: 'flex', flexDirection: 'column' },
    layout: { display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' },
    // v1.2.5 (6): `minHeight: 0` para que scrollee adentro y no estire la página.
    panel: { width: 320, flexShrink: 0, minHeight: 0, overflowY: 'auto', padding: 12, borderRight: `0.5px solid ${colores.borde}`, background: colores.superficie },

    topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: colores.superficie, borderBottom: `0.5px solid ${colores.borde}`, position: 'sticky', top: 0, zIndex: 100 },
    topbarTit: { fontSize: 15, fontWeight: tipografia.peso.negrita, color: colores.texto },
    topbarSub: { fontSize: 12, color: pal.azul, marginLeft: 4 },
    tabs: { display: 'flex', background: colores.fondoAlterno, borderRadius: radio.md, padding: 3, gap: 2 },
    tabBtn: { padding: '5px 12px', borderRadius: radio.sm, border: 'none', background: 'transparent', color: pal.azul, fontSize: 12, fontWeight: tipografia.peso.medio, cursor: 'pointer' },
    tabBtnActive: { background: colores.superficie, color: colores.texto, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },

    filtrosBloque: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12, paddingBottom: 10, borderBottom: `0.5px solid ${colores.borde}` },
    buscador: { fontSize: 13, padding: '8px 10px', borderRadius: radio.md, border: `0.5px solid ${colores.borde}`, color: colores.texto, background: colores.superficie, width: '100%', boxSizing: 'border-box', fontFamily: tipografia.familia },
    filtrosFila: { display: 'flex', gap: 6 },
    filtroWrap: { position: 'relative', flex: 1, minWidth: 0 },
    filtroBtn: { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, padding: '6px 9px', borderRadius: radio.md, border: `0.5px solid ${colores.borde}`, background: colores.superficie, color: pal.azul, fontSize: 12, cursor: 'pointer', boxSizing: 'border-box' },
    filtroBtnActivo: { borderColor: marca, background: colores.fondoAlterno, color: marca, fontWeight: tipografia.peso.medio },
    filtroBtnTxt: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    filtroPanel: { position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, maxHeight: 240, overflowY: 'auto', background: colores.superficieModal, border: `0.5px solid ${colores.borde}`, borderRadius: radio.md, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 200, padding: 4 },
    filtroAcciones: { display: 'flex', gap: 4, padding: '2px 4px 6px', borderBottom: `0.5px solid ${colores.borde}`, marginBottom: 4 },
    filtroAccionBtn: { flex: 1, padding: '3px 6px', borderRadius: radio.sm, border: `0.5px solid ${colores.borde}`, background: colores.superficie, color: pal.azul, fontSize: 11, cursor: 'pointer' },
    filtroOpcion: { display: 'flex', alignItems: 'center', gap: 7, padding: '5px 6px', borderRadius: radio.sm, cursor: 'pointer', fontSize: 12, color: colores.texto },
    filtroOpcionTxt: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    filtroVacio: { padding: '10px 8px', fontSize: 11, color: pal.azul, textAlign: 'center' },
    chipFecha: { flex: 1, padding: '5px 4px', borderRadius: radio.pastilla, border: `0.5px solid ${colores.borde}`, background: colores.superficie, color: pal.azul, fontSize: 11, cursor: 'pointer' },
    chipFechaActivo: { borderColor: marca, background: colores.fondoAlterno, color: marca, fontWeight: tipografia.peso.medio },
    btnLimpiarFiltros: { padding: '4px 8px', borderRadius: radio.sm, border: 'none', background: 'none', color: pal.rojo, fontSize: 11, cursor: 'pointer', textAlign: 'left' },

    alerta: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: radio.md, border: '0.5px solid', marginBottom: 6, cursor: 'pointer' },

    choferHeader: { display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, flexWrap: 'wrap' },
    choferTransporte: { fontSize: 11, color: pal.rojo, marginBottom: 8, marginTop: -4 },
    dot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
    choferNombre: { fontSize: 13, fontWeight: tipografia.peso.negrita, color: colores.texto, flex: 1 },
    choferGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 10px', marginBottom: 4 },
    cerrarManualFila: { marginTop: 8, paddingTop: 8, borderTop: `0.5px solid ${colores.borde}` },
    cf: { display: 'flex', flexDirection: 'column', gap: 1 },
    cl: { fontSize: 10, color: pal.azul },
    cv: { fontSize: 12, color: colores.texto, fontWeight: tipografia.peso.medio },
    puntosGps: { fontSize: 10, color: pal.azul, marginTop: 6 },

    // v1.2.5 (6): columna del mapa con alto acotado; el mapa la ocupa entera
    // y `zIndex: 0` aísla los panes de Leaflet debajo del aviso `sinGps`.
    mapaWrap: { flex: 1, minHeight: 0, position: 'relative' },
    mapa: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 0 },
    sinGps: {
      position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center',
      fontSize: 14, color: colores.texto, lineHeight: 1.7, background: colores.superficieModal, padding: '16px 20px', borderRadius: radio.lg,
      boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
    },

    bannerError: { padding: '10px 14px', borderRadius: 8, background: colorEstado.peligroFondo, border: `0.5px solid ${colorEstado.peligroBordeAlterno}`, fontSize: 13, color: colorEstado.peligroTexto, margin: espacio.lg, whiteSpace: 'pre-line' },
  };
}

function useEstilos() {
  const { colores, oscuro } = useTema();
  return useMemo(() => crearEstilos(colores, oscuro), [colores, oscuro]);
}

export default Seguimiento;
