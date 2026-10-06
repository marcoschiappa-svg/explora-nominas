/**
 * =============================================================================
 * Programacion.js — Programación de despachos (Portal Explora)
 * =============================================================================
 *
 * PROPÓSITO
 * Donde el coordinador convierte un pedido en camiones concretos: acepta cada
 * entrega, define fecha de carga, asigna el transportista y cancela lo que no
 * va a suceder.
 *
 * -----------------------------------------------------------------------------
 * LA ENTREGA ES LA UNIDAD
 * -----------------------------------------------------------------------------
 * La pantalla se organiza por ENTREGA, no por despacho. Cada entrega es algo
 * que el cliente pidió —"1 tn el 20 de agosto"— y el despacho es el camión que
 * la cubre.
 *
 * No siempre coinciden: una entrega puede quedar sin cubrir, o cubrirse y
 * después el transportista rechazar. Por eso la entrega muestra su estado y,
 * debajo, los despachos que se le intentaron asignar —incluidos los rechazados
 * y cancelados, que son la historia de lo que se probó.
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (rediseño Programación) — "Portal Programación" (Claude Design)
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     Ivan aprobó un diseño nuevo para esta pantalla (lista y detalle), hecho
 *     en Claude Design: lista con un único panel blanco (radio 16) en vez de
 *     tarjetas sueltas, con solo estado/cliente/producto/cantidad/chip "N sin
 *     cubrir"/OV-OC (sin número PED, sin fechas, sin entregas ni despachos);
 *     una barra de filtros COMPACTA (buscador a ancho completo + botón
 *     "Filtros y orden" que despliega todo lo de RF-01); y un modal de
 *     detalle con panel "ENTREGAS" donde cada despacho vivo es su propia
 *     línea, con sus propios botones. Corre DESPUÉS del rediseño de
 *     `Pedidos.js` (v1.2.0) -- reusa sus tokens (`paletaPedidos`,
 *     `radioPedidos`) y la `BarraFiltros` ya reestilizada a panel único.
 *
 *   CAUSA RAÍZ
 *     Cambio de presentación pedido explícitamente -- no de lógica. Todo el
 *     trabajo de RF-01/RF-02/Paso 0.2/RF-08/RF-10 de más abajo sigue intacto:
 *     mismos permisos, mismas acciones, mismos `logica-despachos.js`/
 *     `logica-viajes.js`/`logica-calendario.js`/`filtros-listado.js`. Lo que
 *     cambia es CÓMO se ve.
 *
 *   VERIFICACIONES PREVIAS DE LA TAREA (V1-V5, ver el reporte completo)
 *     V1. Acciones existentes de esta pantalla -- todas se conservan:
 *         · Entrega sin cubrir: crear despacho (`aceptarEntrega()`), con
 *           fecha/horario y `SelectorTransportista` (RF-08) opcional.
 *         · Despacho: Asignar/Reasignar (`asignarTransportista()`), Editar
 *           -reprograma- (`editarDespacho()`), Cancelar (`cancelarDespacho()`),
 *           Cerrar viaje a mano (RF-02, `ModalCierreManual`).
 *         · Pedido: "Ver historial" -- es la ÚNICA acción a nivel pedido que
 *           tenía esta pantalla (a diferencia de `Pedidos.js`, acá no hay
 *           "editar domicilio" ni "suspender": esos son de `Pedidos.js`).
 *         Ninguna quedó sin lugar en el diseño nuevo -- "Ver historial" sigue
 *         en la columna izquierda del modal; el resto vive en
 *         `programacion/ModalDetallePedido.js` (ver su propio encabezado).
 *     V2. Mapeo de estados de despacho -> los 3 estilos del diseño: ver
 *         `programacion/logica-vista.js` (`estiloEstadoDespacho()`).
 *     V3. Tipografía -- Paso 0: `ui/tokens.js` (`tipografia.familia`),
 *         `public/index.html` (Google Fonts + `<style>` del flash inicial),
 *         `src/index.css` (`body`, + `input/button/select/textarea{font-family:
 *         inherit}` nuevo), `src/App.css` (dead file, actualizado por las
 *         dudas), y `src/pages/Chofer.js` (única pantalla NO migrada a
 *         `ui/tokens.js` con una fuente fija hardcodeada -- pasó a `inherit`).
 *         El resto de los ~25 archivos que tenían `fontFamily`/`font-family`
 *         ya usaban `tipografia.familia` (cambia solo) o `monospace`/
 *         `'inherit'` para IDs y códigos (se conservan, ver el Paso 0 del
 *         prompt) -- `Tarifario.js` tiene los suyos fijos y NO se toca (regla
 *         explícita de la tarea).
 *     V4. Observaciones del pedido: campo `pedido.obs`, cargado en el alta de
 *         `Pedidos.js` (`form.obs`). Ya se mostraba acá como una caja roja
 *         (`obsBox`) antes de este rediseño -- ahora usa los colores exactos
 *         de la tabla del diseño (`paletaProgramacion().notaPedido`).
 *     V5. El detalle YA era un modal antes de este rediseño (`Modal.js`, dos
 *         columnas) -- no un árbol expandible. Lo que cambia es el diseño
 *         DENTRO del modal, no la naturaleza modal/no-modal.
 *
 *   ALCANCE
 *     1. `ui/tokens.js` -- `paletaProgramacion(oscuro)` + `radioProgramacion`,
 *        ver el encabezado de ese archivo.
 *     2. `ui/BarraFiltros.js` -- variante `'compacta'`, ver su propio
 *        encabezado v1.2.0 (rediseño Programación).
 *     3. `pages/programacion/logica-vista.js` (nuevo) -- lógica pura: cuenta
 *        de entregas sin cubrir, orden de entregas por número, mapeo de
 *        estado de despacho a estilo, formato de fecha larga.
 *     4. `pages/programacion/SelectorTransportista.js` (nuevo) -- el
 *        selector de RF-08, extraído tal cual (mismo comportamiento) para
 *        que este archivo no pase de las ~700 líneas que pide el prompt.
 *     5. `pages/programacion/ModalDetallePedido.js` (nuevo) -- el modal de
 *        detalle rediseñado, ver su propio encabezado.
 *     6. Este archivo -- se queda con la carga de datos, los índices, los
 *        extractores de RF-01/RF-02, las acciones (`confirmarAceptar`/
 *        `confirmarAsignar`/`confirmarEditar`/`confirmarCancelar`/
 *        `abrirCierreManual`, sin cambios) y la LISTA rediseñada (`FilaPedido`).
 *
 *   DISCREPANCIAS CON EL DISEÑO (frenadas, no resueltas a mano)
 *     - Igual que `Pedidos.js`: el chip "Con camión"/"Sin camión" por entrega
 *       que pide el diseño no tiene un campo binario real en el modelo -- se
 *       mantiene la etiqueta de `ETIQUETA_ENTREGA` (Sin cubrir/Con camión/
 *       Entregada/Suspendida), que ya cumplía ese lugar. Ver el encabezado de
 *       `programacion/ModalDetallePedido.js`.
 *     - El diseño trae un chip de PRIORIDAD por entrega -- el propio Paso 3
 *       del prompt lo descarta explícito ("No hay prioridad: las entregas se
 *       ordenan por número"), así que ni se buscó un campo para eso.
 *     - "Cantidad sin cubrir" PARCIAL (una entrega cubierta a medias, con una
 *       línea de despacho Y una línea de "sin cubrir" al mismo tiempo): este
 *       modelo no lo tiene -- cada despacho cubre el volumen COMPLETO de su
 *       entrega. Ver LIMITACIONES en `programacion/logica-vista.js` y
 *       `programacion/ModalDetallePedido.js`.
 *     - Las pastillas de estado y los dos conmutadores (RF-01/RF-02) del
 *       Paso 1 del prompt dicen "la activa va en rojo sólido" -- se aplicó
 *       ese criterio a las CINCO por igual (los tres estados + los dos
 *       conmutadores), en vez de mantener el color de dominio por estado
 *       (`COLOR_PEDIDO`) que tenían antes de este rediseño solo en la pastilla
 *       activa. El badge de estado DENTRO de cada fila y del modal SÍ sigue
 *       usando `COLOR_PEDIDO` -- ese es un dato, no un filtro.
 *
 *   LIMITACIONES CONOCIDAS
 *     Las de cada archivo nuevo (ver sus encabezados) -- ninguna nueva acá.
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm test -- --watchAll=false` (incluye `Programacion`,
 *     `filtros-listado`) y `CI=true npm run build` sin warnings. Pruebas
 *     manuales al pie del prompt de la tarea.
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (RF-01) -- BARRA DE FILTROS Y ORDEN, COMPARTIDA CON Pedidos.js
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     Esta pantalla no tenía orden elegible -- siempre por fecha de creación
 *     descendente, vía el `orderBy('creado_en', 'desc')` de la consulta -- y
 *     el único filtro además del texto era "Solo sin cubrir".
 *
 *   CAUSA RAÍZ
 *     Mismo motivo que en `Pedidos.js`: faltaba la lógica pura de
 *     filtro/orden (`filtros-listado.js`) y el componente genérico
 *     (`ui/BarraFiltros.js`) -- construidos ahí, se reusan acá sin
 *     duplicar nada.
 *
 *   ALCANCE
 *     1. Orden nuevo (no existía): `ordenPor` + `ordenSentido`, con "fecha
 *        de entrega más próxima" ascendente como default -- mismo criterio
 *        que ya trae `Pedidos.js`. Séis criterios: entrega, creación,
 *        cliente, OV/OC, producto y "fecha de carga más próxima" (la MENOR
 *        `fecha_carga` entre los despachos vivos del pedido).
 *     2. Filtros nuevos: cliente, producto, tipo, creado por (selección
 *        múltiple), fecha solicitada de entrega y fecha de carga (rango).
 *        Transportista (selección múltiple, con la opción extra "Sin
 *        asignar") -- el pedido pasa si algún despacho VIVO tiene el
 *        transportista elegido, o si alguna entrega está sin despacho vivo
 *        o con uno sin transportista.
 *     3. "Solo sin cubrir" se muda DENTRO de `filtros` (`soloSinCubrir`) en
 *        vez de ser un estado suelto -- mismo criterio de siempre
 *        (`entregaSinCubrir`), ahora expuesto como un `toggle` genérico de
 *        `BarraFiltros` (deja la barra lista para sumar "Viajes abiertos
 *        vencidos" de RF-02 sin reescribirla, como pide el prompt).
 *     4. Persistencia por usuario, con debounce de 300ms. Esta pantalla NO
 *        tiene "Mis pedidos"/"Todos" -- no hay nada análogo que guardar ahí.
 *
 *   LIMITACIONES CONOCIDAS
 *     Igual que `Pedidos.js`: el filtro de fecha compara contra fechas
 *     LOCALES `YYYY-MM-DD`, mismo criterio que `hoyISO()` en todo el portal.
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm test -- filtros-listado` y `CI=true npm run build` sin
 *     warnings. Pruebas manuales al pie del prompt de la tarea.
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (RF-02) -- CIERRE MANUAL CON MODAL, Y "VIAJES ABIERTOS VENCIDOS"
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     `confirmarCerrarManual` era un `window.prompt()` pidiendo el motivo
 *     como texto libre -- sin fecha de fin propia (quedaba "ahora"), sin
 *     validación, y sin forma de encontrar de un vistazo los viajes que
 *     llevan días abiertos.
 *
 *   CAUSA RAÍZ
 *     No existía el modal (`ModalCierreManual.js`, nuevo) ni un criterio de
 *     "vencido" (`viajeVencido()`, en `estados.js`).
 *
 *   ALCANCE
 *     1. `confirmarCerrarManual` se retira: el botón "Cerrar viaje a mano"
 *        ahora abre `ModalCierreManual`, con el mismo chequeo de rol que
 *        tenía (admin/coordinador) movido a `abrirCierreManual`. Después de
 *        cerrar, mismo comportamiento que había: nada más que refrescar --
 *        no hay llamada a Apps Script ni aviso especial para este cierre,
 *        ni antes ni ahora (confirmado en las verificaciones previas, V4).
 *     2. Conmutador nuevo "Viajes abiertos vencidos" en `BarraFiltros`,
 *        junto a "Solo sin cubrir". Un pedido pasa si alguno de sus
 *        despachos vivos tiene un viaje `viajeVencido()`. Participa de los
 *        conteos de las pastillas (se aplica antes) y de "Limpiar filtros".
 *     3. La tarjeta de un despacho con viaje vencido muestra la etiqueta
 *        "Vencido".
 *
 *   LIMITACIONES CONOCIDAS
 *     SUPERADO por el Paso 0.2 de v1.2.0 (ver el bloque de encabezado de ese
 *     nombre, más abajo): esta limitación describía la persistencia con
 *     clave propia de `localStorage`, que ya no existe -- el conmutador
 *     ahora se persiste dentro del mismo objeto de `filtros-listado.js` que
 *     el resto. Se deja este párrafo sin borrar para que quede registro de
 *     por qué nació así.
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm run build` sin warnings. Un despacho NOMINADO con
 *     `fecha_carga` de ayer y viaje `RECIBIDO` muestra "Vencido"; con el
 *     conmutador activo, solo esos pedidos quedan visibles, y sobrevive a
 *     recargar la página.
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (Paso 0.2) -- "VIAJES ABIERTOS VENCIDOS" SE UNIFICA CON EL RESTO
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     El conmutador "Viajes abiertos vencidos" se persistía en
 *     `explora:programacion:vencidos:v1:<uid>`, una clave de `localStorage`
 *     propia y distinta de `explora:listado:v1:programacion:<uid>` (la que
 *     usa el resto de los filtros, vía `filtros-listado.js`) -- limitación
 *     conocida y documentada del RF-02 original (ver más arriba).
 *
 *   CAUSA RAÍZ
 *     Cuando se hizo RF-02, `filtros-listado.js` estaba fuera de su
 *     alcance.
 *
 *   ALCANCE
 *     1. `claveVencidos`/`leerSoloVencidos`/`guardarSoloVencidos` se
 *        retiran. En su lugar, `soloVencidos` viaja dentro del mismo
 *        objeto que `guardarPreferencias('programacion', uid, {...})` ya
 *        guardaba (`filtros`, `grupoActivo`, `ordenPor`, `ordenSentido`) --
 *        ver el campo nuevo en `filtros-listado.js` (comentario 10 de
 *        `podarPreferencias()`).
 *     2. `migrarSoloVencidosLegacy(uid)` (nueva, exportada) lee la clave
 *        vieja UNA sola vez -- en el mismo efecto que aplica
 *        `leerPreferencias()`, al cargar la pantalla -- y la borra siempre,
 *        haya o no un valor. Si el objeto nuevo ya trae `soloVencidos` (la
 *        migración ya corrió antes y se volvió a guardar), ese valor gana;
 *        si no, se usa el legacy recién leído.
 *
 *   LIMITACIONES CONOCIDAS
 *     Ninguna nueva.
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm test -- Programacion` (test de `migrarSoloVencidosLegacy`
 *     en `Programacion.test.js`) y `CI=true npm run build` sin warnings.
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (RF-08) -- GRUPOS DE TRANSPORTISTA POR PRODUCTO DECLARADO
 * -----------------------------------------------------------------------------
 *   Ver el encabezado de `programacion/SelectorTransportista.js` -- este
 *   componente se extrajo tal cual a su propio archivo con este rediseño,
 *   sin cambio de comportamiento. `agruparTransportistasPorProducto` se
 *   re-exporta acá abajo para no romper el import de `Programacion.test.js`.
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (RF-10) -- CALENDARIO OPERATIVO: LA FECHA DE CARGA SE BLOQUEA
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     Nada impedía crear o reprogramar un despacho con fecha de carga en un
 *     feriado o una parada de planta -- eso se manejaba de palabra.
 *
 *   CAUSA RAÍZ
 *     No existía el calendario operativo (`logica-calendario.js`, nuevo).
 *
 *   ALCANCE
 *     Esta pantalla se suscribe a `calendario_operativo` (solo los días
 *     ACTIVOS) y a `calendario_reglas/semanal`. `evaluarFechaCarga()`
 *     (bloquea) se evalúa en `programacion/ModalDetallePedido.js`, en el
 *     alta de un despacho nuevo y en la edición de fecha de uno existente --
 *     el bloqueo REAL, el que no se puede saltear, está en
 *     `aceptarEntrega()`/`editarDespacho()` (`logica-despachos.js`): esto es
 *     solo para no dejar que el coordinador se entere recién por el error de
 *     Firestore. Con este rediseño se sumó `evaluarFechaEntrega()` (ADVIERTE,
 *     no bloquea) sobre la fecha SOLICITADA de cada entrega -- mismo
 *     criterio que ya usa `Pedidos.js`, ver el encabezado de
 *     `ModalDetallePedido.js`, punto 6.
 *
 *   LIMITACIONES CONOCIDAS
 *     Ninguna nueva -- mismas que documenta `logica-calendario.js`.
 *
 *   CÓMO SE VERIFICA
 *     Manual: con un día marcado "Sin despacho", crear un despacho de
 *     "Entrega al cliente" con fecha de carga ese día lo bloquea (mensaje
 *     bajo el campo, botón deshabilitado); uno de "Entrega en planta" el
 *     mismo día se permite. Con "Sin operación", los tres tipos se
 *     bloquean. Reprogramar (Editar) a esos días también se bloquea. Una
 *     entrega con fecha SOLICITADA en un día marcado muestra el aviso, sin
 *     impedir nada.
 * ========================================================================== */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { collection, onSnapshot, query, orderBy, where } from 'firebase/firestore';
import { db } from '../firebase';
import { motivoSinAcceso, tieneAlgunRol } from '../sesion';
import { claveNormalizada } from '../mapa-normalizacion';
import { textoDomicilio } from '../buscar-domicilios';
import { hoyISO } from '../logica-pedidos';
import {
  ETIQUETA_PEDIDO, COLOR_PEDIDO,
  despachoVivo, entregaSinCubrir, estadoPedido, viajeVencido,
} from '../estados';
import {
  aceptarEntrega, asignarTransportista, editarDespacho, cancelarDespacho,
  correosDeOrganizacion, llamarAppsScript, coordinadoresActivos, armarDestinatarios,
} from '../logica-despachos';
import {
  SIN_ASIGNAR, aplicarFiltros, comparador, filtrosActivos, filtrosVacios,
  leerPreferencias, guardarPreferencias,
} from '../filtros-listado';
import HistorialPedido from './HistorialPedido';
import ModalCierreManual from './ModalCierreManual';
import ModalDetallePedido from './programacion/ModalDetallePedido';
import { agruparTransportistasPorProducto } from './programacion/SelectorTransportista';
import { contarEntregasSinCubrir } from './programacion/logica-vista';
import { marca, espacio, radio, tipografia, paletaProgramacion } from '../ui/tokens';
import { useTema } from '../ui/TemaContext';
import Vacio from '../ui/Vacio';
import Pastilla from '../ui/Pastilla';
import BarraFiltros from '../ui/BarraFiltros';
import PanelLista from '../ui/PanelLista';

// v1.2.0 (rediseño Programación) -- re-exportada tal cual para que
// `Programacion.test.js` no tenga que cambiar de dónde importa: la función
// se mudó a `programacion/SelectorTransportista.js` (ver su encabezado), pero
// el nombre público sigue siendo el mismo.
export { agruparTransportistasPorProducto };

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzXOlu0PUTAVubDJCXh7WxjZp1ruCH5SMu9YmWbFCNF2ff7l5mn447nV8BIWbQ5-Mz-uQ/exec';

// Los cumplidos y suspendidos no se programan (regla de negocio existente,
// ver el filtro de `visibles` mas abajo) -- por eso las pastillas de estado
// de esta pantalla son un subconjunto de las de Pedidos.js.
const GRUPOS_PROGRAMACION = ['pendiente', 'programado_parcial', 'programado'];

// RF-01: no existía orden elegible en esta pantalla -- "entrega" ascendente
// (fecha más próxima primero) es el default, mismo criterio que Pedidos.js.
const ORDEN_OPCIONES = [
  { id: 'entrega', label: 'Fecha de entrega' },
  { id: 'creacion', label: 'Fecha de creacion' },
  { id: 'cliente', label: 'Cliente' },
  { id: 'ov', label: 'OV / OC' },
  { id: 'producto', label: 'Producto' },
  { id: 'carga', label: 'Fecha de carga' },
];

/* -----------------------------------------------------------------------------
 * v1.2.0 (Paso 0.2 de RF-02) -- "Viajes abiertos vencidos" pasa a vivir en
 * el mismo objeto de preferencias que el resto de los filtros
 * (`filtros-listado.js`, campo `soloVencidos`) en vez de su propia clave de
 * `localStorage`. Ver el encabezado v1.2.0 (Paso 0.2) de ese archivo.
 *
 * `migrarSoloVencidosLegacy` se corre UNA sola vez, en el mismo efecto que
 * aplica `leerPreferencias()` (más abajo): lee la clave vieja si existe, la
 * borra siempre -- exista o no un valor -- y devuelve lo que encontró, o
 * `null`. Se exporta para poder testearla sin montar el componente entero.
 * -------------------------------------------------------------------------- */
function claveVencidosLegacy(uid) {
  return `explora:programacion:vencidos:v1:${uid}`;
}

export function migrarSoloVencidosLegacy(uid) {
  const clave = claveVencidosLegacy(uid);
  try {
    const crudo = window.localStorage.getItem(clave);
    window.localStorage.removeItem(clave);
    return crudo === null ? null : crudo === '1';
  } catch (err) {
    // Mismo criterio de "nunca rompe" que `filtros-listado.js`: un
    // `localStorage` deshabilitado (modo privado) no puede tumbar la carga
    // de la pantalla.
    return null;
  }
}

/* =============================================================================
 * Componente principal
 * ========================================================================== */

export default function Programacion({ usuario, onVolver }) {
  const styles = useEstilos();
  const [pedidos, setPedidos] = useState([]);
  const [entregas, setEntregas] = useState([]);
  const [despachos, setDespachos] = useState([]);
  const [viajes, setViajes] = useState([]);
  const [organizaciones, setOrganizaciones] = useState([]);
  const [productos, setProductos] = useState([]);
  const [domicilios, setDomicilios] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [cargando, setCargando] = useState(true);
  // v1.2.0 (RF-10) -- el calendario operativo, para bloquear/advertir en
  // `ModalDetallePedido.js`. `calendarioDias` es un Map<fechaISO, {tipo,
  // motivo, estado}> de los días ACTIVOS.
  const [calendarioDias, setCalendarioDias] = useState(new Map());
  const [calendarioReglas, setCalendarioReglas] = useState(null);

  const [pedidoAbiertoId, setPedidoAbiertoId] = useState(null);
  const [mostrandoHistorial, setMostrandoHistorial] = useState(false);
  // "asignando"/"editando" son acciones puntuales sobre UN despacho a la vez
  // dentro del modal -- se comparten entre las líneas de despacho porque solo
  // una puede estar en edición simultáneamente.
  const [asignando, setAsignando] = useState(null);   // { despachoId, transportistaId }
  const [editando, setEditando] = useState(null);     // { despachoId, fecha, horario }
  // RF-02: el despacho + viaje sobre el que está abierto ModalCierreManual,
  // o null si está cerrado.
  const [cerrandoManual, setCerrandoManual] = useState(null); // { despacho, viaje }
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');

  const [filtro, setFiltro] = useState('');
  const [grupoActivo, setGrupoActivo] = useState('todos');
  // RF-01: "Solo sin cubrir" pasa a vivir dentro de `filtros.soloSinCubrir`.
  const [filtros, setFiltros] = useState(filtrosVacios());
  const [ordenPor, setOrdenPor] = useState('entrega');
  const [ordenSentido, setOrdenSentido] = useState('asc');
  // RF-02: "Viajes abiertos vencidos".
  const [soloVencidos, setSoloVencidos] = useState(false);

  const sinAcceso = motivoSinAcceso(usuario, ['admin', 'coordinador']);

  /* ── Carga ──────────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (sinAcceso) { setCargando(false); return; }

    const unsubs = [
      onSnapshot(query(collection(db, 'pedidos'), orderBy('creado_en', 'desc')), (s) => {
        setPedidos(s.docs.map(d => ({ id: d.id, ...d.data() })));
        setCargando(false);
      }, (e) => { console.error(e); setCargando(false); }),
      onSnapshot(collection(db, 'entregas'), (s) => setEntregas(s.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'despachos'), (s) => setDespachos(s.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'viajes'), (s) => setViajes(s.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'organizaciones'), (s) => setOrganizaciones(s.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'productos'), (s) => setProductos(s.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'domicilios'), (s) => setDomicilios(s.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'usuarios'), (s) => setUsuarios(s.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(query(collection(db, 'calendario_operativo'), where('estado', '==', 'activo')), (s) => {
        setCalendarioDias(new Map(s.docs.map(d => [d.id, d.data()])));
      }),
      onSnapshot(collection(db, 'calendario_reglas'), (s) => {
        const semanal = s.docs.find(d => d.id === 'semanal');
        setCalendarioReglas(semanal ? semanal.data() : null);
      }),
    ];
    return () => unsubs.forEach(u => u());
  }, [sinAcceso]);

  /* ── Índices ────────────────────────────────────────────────────────────── */

  const orgsPorId = useMemo(() => new Map(organizaciones.map(o => [o.id, o])), [organizaciones]);
  const prodsPorId = useMemo(() => new Map(productos.map(p => [p.id, p])), [productos]);
  const domsPorId = useMemo(() => new Map(domicilios.map(d => [d.id, d])), [domicilios]);

  const viajePorDespacho = useMemo(
    () => new Map(viajes.map(v => [v.despacho_id, v])),
    [viajes]
  );

  const transportistas = useMemo(
    () => organizaciones
      .filter(o => o.es_transportista && o.estado === 'activo')
      .sort((a, b) => a.razon_social.localeCompare(b.razon_social, 'es')),
    [organizaciones]
  );

  /** Cada pedido con sus entregas y los despachos de cada una. */
  const arbol = useMemo(() => {
    const entregasPorPedido = new Map();
    entregas.forEach(e => {
      const l = entregasPorPedido.get(e.pedido_id) || [];
      l.push(e);
      entregasPorPedido.set(e.pedido_id, l);
    });

    const despachosPorEntrega = new Map();
    despachos.forEach(d => {
      const l = despachosPorEntrega.get(d.entrega_id) || [];
      l.push(d);
      despachosPorEntrega.set(d.entrega_id, l);
    });

    return pedidos.map(p => {
      const suyas = (entregasPorPedido.get(p.id) || []).sort((a, b) => a.numero - b.numero);
      return {
        pedido: { ...p, estado: estadoPedido(p) },
        entregas: suyas.map(e => ({
          entrega: e,
          despachos: (despachosPorEntrega.get(e.id) || [])
            .sort((a, b) => (a.numero || '').localeCompare(b.numero || '')),
        })),
        todosLosDespachos: despachos.filter(d => d.pedido_id === p.id),
      };
    });
  }, [pedidos, entregas, despachos]);

  /** La base ESTRUCTURAL de la pantalla: nunca cumplido ni suspendido (regla
   * de negocio existente, no un filtro de la barra). */
  const baseEstructural = useMemo(
    () => arbol.filter(x => x.pedido.estado !== 'cumplido' && x.pedido.estado !== 'suspendido'),
    [arbol]
  );

  // RF-01: extractores para `filtros-listado.js`.
  const extractoresPrograma = useMemo(() => ({
    clienteId: x => x.pedido.cliente_org_id || null,
    productoId: x => x.pedido.producto_id || null,
    tipo: x => x.pedido.tipo || null,
    creadoPorUid: x => x.pedido.creado_por_uid || null,
    fechasEntrega: x => x.entregas
      .filter(e => e.entrega.estado !== 'suspendida')
      .map(e => e.entrega.fecha_solicitada)
      .filter(Boolean),
    transportistaIdsVivos: x => x.todosLosDespachos.filter(despachoVivo).map(d => d.transportista_org_id).filter(Boolean),
    tieneEntregaSinAsignar: x => x.entregas.some(e =>
      entregaSinCubrir(e.entrega, e.despachos)
      || e.despachos.some(d => despachoVivo(d) && !d.transportista_org_id)
    ),
    fechasCarga: x => x.todosLosDespachos.filter(despachoVivo).map(d => d.fecha_carga).filter(Boolean),
    tieneSinCubrir: x => x.entregas.some(e => entregaSinCubrir(e.entrega, e.despachos)),
    numero: x => x.pedido.numero || '',
    clienteNombre: x => { const o = orgsPorId.get(x.pedido.cliente_org_id); return o ? o.razon_social : null; },
    ov: x => x.pedido.ov || null,
    fechaEntregaProxima: x => {
      const fechas = x.entregas.map(e => e.entrega).filter(e => e.estado === 'pendiente').map(e => e.fecha_solicitada).filter(Boolean).sort();
      return fechas[0] || null;
    },
    fechaCreacionMillis: x => (x.pedido.creado_en && x.pedido.creado_en.toMillis) ? x.pedido.creado_en.toMillis() : null,
    productoNombre: x => { const p = prodsPorId.get(x.pedido.producto_id); return p ? p.nombre : null; },
    fechaCargaProxima: x => {
      const fechas = x.todosLosDespachos.filter(despachoVivo).map(d => d.fecha_carga).filter(Boolean).sort();
      return fechas[0] || null;
    },
  }), [orgsPorId, prodsPorId]);

  // Opciones de cada selector -- de `baseEstructural`, ordenadas alfabéticamente.
  const opcionesClientes = useMemo(() => {
    const ids = new Set(baseEstructural.map(x => x.pedido.cliente_org_id).filter(Boolean));
    return organizaciones.filter(o => ids.has(o.id)).map(o => ({ id: o.id, label: o.razon_social }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }, [baseEstructural, organizaciones]);

  const opcionesProductos = useMemo(() => {
    const ids = new Set(baseEstructural.map(x => x.pedido.producto_id).filter(Boolean));
    return productos.filter(p => ids.has(p.id)).map(p => ({ id: p.id, label: p.nombre }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }, [baseEstructural, productos]);

  const opcionesTipos = useMemo(() => {
    const ids = new Set(baseEstructural.map(x => x.pedido.tipo).filter(Boolean));
    return [...ids].map(t => ({ id: t, label: t })).sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }, [baseEstructural]);

  const opcionesCreadoPor = useMemo(() => {
    const ids = new Set(baseEstructural.map(x => x.pedido.creado_por_uid).filter(Boolean));
    return usuarios.filter(u => ids.has(u.id)).map(u => ({ id: u.id, label: u.nombre || u.email || 'Sin identificar' }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }, [baseEstructural, usuarios]);

  const opcionesTransportistas = useMemo(() => {
    const opciones = transportistas.map(t => ({ id: t.id, label: t.razon_social }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'));
    return [{ id: SIN_ASIGNAR, label: 'Sin asignar' }, ...opciones];
  }, [transportistas]);

  // v1.2.0 (rediseño Programación) -- `enPanel` ya no tiene efecto en la
  // variante compacta de `BarraFiltros` (TODOS los controles caen detrás de
  // "Filtros y orden" ahí, ver su encabezado); se deja igual para no
  // reescribir esta lista sin necesidad -- es inocuo.
  const controlesBarra = useMemo(() => [
    { campo: 'clientes', tipo: 'multi', etiqueta: 'Cliente', opciones: opcionesClientes, vacio: 'Sin clientes con pedidos' },
    { campo: 'productos', tipo: 'multi', etiqueta: 'Producto', opciones: opcionesProductos, vacio: 'Sin productos con pedidos' },
    { campo: 'entrega', tipo: 'rango', etiqueta: 'Fecha de entrega' },
    { campo: 'transportistas', tipo: 'multi', etiqueta: 'Transportista', opciones: opcionesTransportistas },
    { campo: 'carga', tipo: 'rango', etiqueta: 'Fecha de carga' },
    { campo: 'tipos', tipo: 'multi', etiqueta: 'Tipo', opciones: opcionesTipos, enPanel: true },
    { campo: 'creadoPor', tipo: 'multi', etiqueta: 'Creado por', opciones: opcionesCreadoPor, enPanel: true },
  ], [opcionesClientes, opcionesProductos, opcionesTransportistas, opcionesTipos, opcionesCreadoPor]);

  // Persistencia (RF-01) -- se lee una sola vez cuando los datos ya
  // cargaron, se guarda con debounce.
  const prefsAplicadasRef = useRef(false);

  useEffect(() => {
    if (prefsAplicadasRef.current || cargando) return;
    prefsAplicadasRef.current = true;

    const validos = {
      clientes: new Set(organizaciones.map(o => o.id)),
      productos: new Set(productos.map(p => p.id)),
      creadoPor: new Set(usuarios.map(u => u.id)),
      transportistas: new Set(transportistas.map(t => t.id)),
    };
    const prefs = leerPreferencias('programacion', usuario.uid, validos);
    const legacy = migrarSoloVencidosLegacy(usuario.uid);

    if (prefs) {
      if (prefs.filtros) setFiltros(f => ({ ...f, ...prefs.filtros }));
      if (prefs.grupoActivo) setGrupoActivo(prefs.grupoActivo);
      if (prefs.ordenPor) setOrdenPor(prefs.ordenPor);
      if (prefs.ordenSentido) setOrdenSentido(prefs.ordenSentido);
    }

    if (prefs && typeof prefs.soloVencidos === 'boolean') {
      setSoloVencidos(prefs.soloVencidos);
    } else if (legacy !== null) {
      setSoloVencidos(legacy);
    }
  }, [cargando, organizaciones, productos, usuarios, transportistas, usuario.uid]);

  useEffect(() => {
    if (!prefsAplicadasRef.current) return;
    const id = setTimeout(() => {
      guardarPreferencias('programacion', usuario.uid, { filtros, grupoActivo, ordenPor, ordenSentido, soloVencidos });
    }, 300);
    return () => clearTimeout(id);
  }, [filtros, grupoActivo, ordenPor, ordenSentido, soloVencidos, usuario.uid]);

  // RF-02: ¿alguno de los despachos VIVOS de este pedido tiene un viaje
  // vencido?
  const pedidoTieneVencido = useCallback((x) => {
    const hoy = hoyISO();
    return x.todosLosDespachos.some(d =>
      despachoVivo(d) && viajeVencido(viajePorDespacho.get(d.id) || null, d, hoy));
  }, [viajePorDespacho]);

  /** Base para las pastillas de estado: texto + filtros de la barra, antes
   * de aplicar el filtro de estado. */
  const baseFiltrada = useMemo(() => {
    const texto = claveNormalizada(filtro);
    const porTexto = !texto ? baseEstructural : baseEstructural.filter(x => {
      const org = orgsPorId.get(x.pedido.cliente_org_id);
      return claveNormalizada(x.pedido.numero).includes(texto)
          || claveNormalizada(x.pedido.ov).includes(texto)
          || (org && claveNormalizada(org.razon_social).includes(texto));
    });
    const filtradas = aplicarFiltros(porTexto, filtros, extractoresPrograma);
    return soloVencidos ? filtradas.filter(pedidoTieneVencido) : filtradas;
  }, [baseEstructural, filtro, orgsPorId, filtros, extractoresPrograma, soloVencidos, pedidoTieneVencido]);

  const conteosPorGrupo = useMemo(() => {
    const c = {};
    GRUPOS_PROGRAMACION.forEach(g => { c[g] = 0; });
    baseFiltrada.forEach(x => { c[x.pedido.estado] = (c[x.pedido.estado] || 0) + 1; });
    return c;
  }, [baseFiltrada]);

  const visibles = useMemo(() => {
    const base = grupoActivo === 'todos' ? baseFiltrada : baseFiltrada.filter(x => x.pedido.estado === grupoActivo);
    return [...base].sort(comparador(ordenPor, ordenSentido, extractoresPrograma));
  }, [baseFiltrada, grupoActivo, ordenPor, ordenSentido, extractoresPrograma]);

  // "Limpiar filtros" -- limpia filtros (incluido "Solo sin cubrir"), texto,
  // pastilla de estado y "Viajes abiertos vencidos" (RF-02); no toca el orden.
  const hayFiltrosActivosBarra = filtrosActivos(filtros) || !!filtro || grupoActivo !== 'todos' || soloVencidos;

  function limpiarFiltrosBarra() {
    setFiltros(filtrosVacios());
    setFiltro('');
    setGrupoActivo('todos');
    setSoloVencidos(false);
  }

  const abierto = pedidoAbiertoId ? arbol.find(x => x.pedido.id === pedidoAbiertoId) : null;

  /* ── Denormalizados del despacho ────────────────────────────────────────── */

  /**
   * Lo que se copia al despacho. El transportista NO lee `pedidos` —las reglas
   * lo dejan afuera y no habría forma de expresarlo: "los pedidos donde tengo un
   * despacho" es un join— así que todo lo que su pantalla muestra tiene que
   * estar acá. Y el Apps Script rutea al Plan de Producción por nombre.
   */
  async function denormalizadosDe(pedido, entrega = null) {
    const org = orgsPorId.get(pedido.cliente_org_id);
    const prod = prodsPorId.get(pedido.producto_id);
    const idDestino = (entrega && entrega.destino_domicilio_id) || pedido.destino_domicilio_id;
    const destino = domsPorId.get(idDestino);
    const comercial = usuarios.find(u => u.id === pedido.creado_por_uid);

    return {
      cliente_org_id: pedido.cliente_org_id,
      cliente_razon_social: org ? org.razon_social : '',
      producto_nombre: prod ? prod.nombre : '',
      ov: pedido.ov || '',
      destino_texto: destino ? textoDomicilio(destino) : '',
      entrega_numero: entrega ? entrega.numero : null,
      entregas_total: pedido.entregas_total || 0,
      coordinadores_email: await coordinadoresActivos(),
      comercial_email: comercial && comercial.email ? comercial.email.trim().toLowerCase() : '',
    };
  }

  /* ── Acciones ───────────────────────────────────────────────────────────── */

  async function confirmarAceptar(x, entregaItem, f) {
    if (!f || !f.fecha) { setError('Elegí la fecha de carga.'); return; }

    const transportista = f.transportistaId ? orgsPorId.get(f.transportistaId) : null;
    const correosTransportista = transportista ? correosDeOrganizacion(usuarios, transportista.id) : [];

    if (transportista && correosTransportista.length === 0) {
      setError(
        `${transportista.razon_social} no tiene ningún usuario activo con correo. `
        + 'Cargalo desde Usuarios antes de asignarle despachos.'
      );
      return;
    }

    setOcupado(true);
    setError('');

    let creado = false;
    try {
      const { numero } = await aceptarEntrega({
        pedido: x.pedido,
        entrega: entregaItem.entrega,
        entregas: x.entregas.map(e => e.entrega),
        despachos: x.todosLosDespachos,
        fechaCarga: f.fecha,
        horarioCarga: f.horario,
        transportista,
        denormalizados: await denormalizadosDe(x.pedido, entregaItem.entrega),
        usuario,
      });
      creado = true;

      const rPlan = await llamarAppsScript(APPS_SCRIPT_URL, 'programar_despacho', {
        pedido_id: x.pedido.numero,
        despacho_id: numero,
        ...(transportista ? {
          email_transportista: correosTransportista.join(','),
          destinatarios: armarDestinatarios({ coordinadores: await coordinadoresActivos(), transportista: correosTransportista }),
        } : {}),
        ...payloadDe(x.pedido, entregaItem.entrega, f, transportista),
      });
      if (!rPlan.ok) {
        setError(
          `El despacho ${numero} se creó bien, pero no se pudo escribir en el `
          + 'Plan de Producción ni avisar al transportista. Revisalo a mano: ' + rPlan.mensaje
        );
      }
    } catch (err) {
      console.error(err);
      setError(traducirError(err));
    } finally {
      setOcupado(false);
    }
    return creado;
  }

  async function confirmarAsignar(x, despacho) {
    const f = asignando;
    if (!f || !f.transportistaId) { setError('Elegí el transportista.'); return; }

    const transportista = orgsPorId.get(f.transportistaId);
    const correos = correosDeOrganizacion(usuarios, transportista.id);

    if (correos.length === 0) {
      setError(
        `${transportista.razon_social} no tiene ningún usuario activo con correo. `
        + 'Cargalo desde Usuarios antes de asignarle despachos.'
      );
      return;
    }

    setOcupado(true);
    setError('');

    try {
      const { reasignacion } = await asignarTransportista({
        pedido: x.pedido,
        despacho,
        entregas: x.entregas.map(e => e.entrega),
        despachos: x.todosLosDespachos,
        transportista,
        usuario,
      });

      const entrega = entregas.find(e => e.id === despacho.entrega_id);

      const rAsig = await llamarAppsScript(APPS_SCRIPT_URL, 'asignar_transportista', {
        pedido_id: x.pedido.numero,
        despacho_id: despacho.numero,
        email_transportista: correos.join(','),
        reasignacion,
        destinatarios: armarDestinatarios({ coordinadores: await coordinadoresActivos(), transportista: correos }),
        ...payloadDe(x.pedido, entrega, {
          fecha: despacho.fecha_carga,
          horario: despacho.horario_carga,
        }, transportista),
      });
      if (!rAsig.ok) {
        setError(`El despacho ${despacho.numero} se asignó bien, pero no se pudo avisar al transportista por mail: ` + rAsig.mensaje);
      }

      setAsignando(null);
    } catch (err) {
      console.error(err);
      setError(traducirError(err));
    } finally {
      setOcupado(false);
    }
  }

  async function confirmarEditar(x, despacho) {
    const f = editando;
    if (!f || !f.fecha) { setError('Elegí la fecha de carga.'); return; }

    setOcupado(true);
    setError('');

    try {
      const { cambio } = await editarDespacho({
        despacho,
        fechaCarga: f.fecha,
        horarioCarga: f.horario,
        tipoPedido: x.pedido.tipo,
        usuario,
      });

      if (cambio && despacho.transportista_org_id) {
        const correos = correosDeOrganizacion(usuarios, despacho.transportista_org_id);
        const entrega = entregas.find(e => e.id === despacho.entrega_id);
        const rEdit = await llamarAppsScript(APPS_SCRIPT_URL, 'editar_despacho', {
          pedido_id: x.pedido.numero,
          despacho_id: despacho.numero,
          email_transportista: correos.join(','),
          fecha_carga_anterior: despacho.fecha_carga,
          ...payloadDe(x.pedido, entrega, f, orgsPorId.get(despacho.transportista_org_id)),
        });
        if (!rEdit.ok) {
          setError(`El despacho ${despacho.numero} se editó bien, pero no se pudo avisar al transportista: ` + rEdit.mensaje);
        }
      }

      setEditando(null);
    } catch (err) {
      console.error(err);
      setError(traducirError(err));
    } finally {
      setOcupado(false);
    }
  }

  async function confirmarCancelar(x, despacho) {
    const motivo = window.prompt(`¿Por qué se cancela el despacho ${despacho.numero}?`);
    if (motivo === null) return;
    if (!motivo.trim()) { window.alert('El motivo es obligatorio.'); return; }

    setOcupado(true);
    setError('');

    try {
      const rCancel = await cancelarDespacho({
        pedido: x.pedido,
        despacho,
        viaje: viajePorDespacho.get(despacho.id) || null,
        entregas: x.entregas.map(e => e.entrega),
        despachos: x.todosLosDespachos,
        motivo: motivo.trim(),
        usuario,
        appsScriptUrl: APPS_SCRIPT_URL,
      });
      if (rCancel.avisoApps) setError(rCancel.avisoApps);
    } catch (err) {
      console.error(err);
      setError(traducirError(err));
    } finally {
      setOcupado(false);
    }
  }

  /**
   * v1.2.0 (RF-02) -- Abre `ModalCierreManual` sobre un viaje que quedó
   * abierto sin que el chofer lo haya cerrado. Solo admin y coordinador.
   */
  function abrirCierreManual(despacho, viaje) {
    if (!tieneAlgunRol(usuario, ['admin', 'coordinador'])) {
      setError('No tenés permiso para cerrar un viaje a mano.');
      return;
    }
    setError('');
    setCerrandoManual({ despacho, viaje });
  }

  /**
   * El payload que espera el Apps Script, con los nombres resueltos.
   */
  function payloadDe(pedido, entrega, form, transportista) {
    const org = orgsPorId.get(pedido.cliente_org_id);
    const prod = prodsPorId.get(pedido.producto_id);
    const idDestino = (entrega && entrega.destino_domicilio_id) || pedido.destino_domicilio_id;
    const destino = domsPorId.get(idDestino);
    const origen = domsPorId.get(pedido.origen_domicilio_id);

    return {
      cliente: org ? org.razon_social : '',
      producto: prod ? prod.nombre : '',
      volumen: entrega ? entrega.volumen : '',
      ov: pedido.ov || '',
      lugar: destino ? textoDomicilio(destino) : '',
      lugar_carga: origen ? textoDomicilio(origen) : '',
      recipiente: pedido.recipiente || 'Granel',
      tipo: pedido.tipo,
      fecha_carga: form.fecha || '',
      horario_carga: form.horario || '',
      fecha_entrega: entrega ? entrega.fecha_solicitada : '',
      banda_horaria: pedido.banda_horaria || '',
      obs: pedido.obs || '',
      transporte: transportista ? transportista.razon_social : '',
      programado_por: usuario.nombre || usuario.email,
      entrega_numero: entrega ? entrega.numero : null,
      entregas_total: pedido.entregas_total || 0,
    };
  }

  /* ── Render ─────────────────────────────────────────────────────────────── */

  if (sinAcceso) {
    return <div style={styles.wrap}><div style={styles.bannerError}>{sinAcceso}</div></div>;
  }

  // v1.2.0 (rediseño Programación) -- las pastillas de estado + los dos
  // conmutadores (RF-01/RF-02) se arman ACÁ (conocen `COLOR_PEDIDO`,
  // `GRUPOS_PROGRAMACION`...) y se le pasan a `BarraFiltros` por el slot
  // `piePastillas`, como ya hacía `Pedidos.js` -- ver el encabezado de
  // `ui/BarraFiltros.js`. Las cinco (3 estados + 2 conmutadores) usan el
  // mismo estilo "activa en rojo sólido" -- Paso 1 del prompt.
  const pastillasFiltro = (
    <>
      <PastillaFiltro activo={grupoActivo === 'todos'} onClick={() => setGrupoActivo('todos')} label={`Todos (${baseFiltrada.length})`} />
      {GRUPOS_PROGRAMACION.map(g => (
        <PastillaFiltro
          key={g}
          activo={grupoActivo === g}
          onClick={() => setGrupoActivo(g)}
          label={`${ETIQUETA_PEDIDO[g]} (${conteosPorGrupo[g] || 0})`}
        />
      ))}
      <PastillaFiltro
        activo={filtros.soloSinCubrir}
        onClick={() => setFiltros(f => ({ ...f, soloSinCubrir: !f.soloSinCubrir }))}
        label="Solo sin cubrir"
      />
      <PastillaFiltro
        activo={soloVencidos}
        onClick={() => setSoloVencidos(v => !v)}
        label="Viajes abiertos vencidos"
      />
    </>
  );

  return (
    <div style={styles.wrap}>
      <div style={styles.panelHeader}>
        <div style={styles.titulo}>Programación</div>
      </div>

      {error && <div style={styles.bannerError}>{error}</div>}

      {/* Paso 1 del prompt: variante compacta -- buscador a ancho completo +
          "Filtros y orden" (RF-01 entero) + pastillas (estado + RF-01
          "Solo sin cubrir" + RF-02 "Viajes abiertos vencidos"). */}
      <BarraFiltros
        variante="compacta"
        texto={filtro}
        onCambiarTexto={setFiltro}
        placeholderTexto="Buscar por número, cliente u orden..."
        controles={controlesBarra}
        valores={filtros}
        onCambiarValor={(campo, valor) => setFiltros(f => ({ ...f, [campo]: valor }))}
        orden={{
          opciones: ORDEN_OPCIONES,
          valor: ordenPor,
          sentido: ordenSentido,
          onCambiarValor: setOrdenPor,
          onCambiarSentido: () => setOrdenSentido(s => (s === 'asc' ? 'desc' : 'asc')),
        }}
        totalBase={baseEstructural.length}
        totalVisible={baseFiltrada.length}
        hayFiltrosActivos={hayFiltrosActivosBarra}
        onLimpiar={limpiarFiltrosBarra}
        etiquetaItem="pedidos"
        piePastillas={pastillasFiltro}
      />

      {cargando && <Vacio titulo="Cargando..." />}
      {!cargando && visibles.length === 0 && <Vacio titulo="No hay pedidos que coincidan con los filtros." />}

      {/* Paso 2: un único panel blanco (radio 16), filas separadas por una
          línea fina -- no tarjetas sueltas. */}
      {!cargando && visibles.length > 0 && (
        <PanelLista
          items={visibles}
          render={(x, i, esUltima) => (
            <FilaPedido
              key={x.pedido.id}
              x={x}
              org={orgsPorId.get(x.pedido.cliente_org_id)}
              prod={prodsPorId.get(x.pedido.producto_id)}
              vencido={pedidoTieneVencido(x)}
              esUltima={esUltima}
              onClick={() => setPedidoAbiertoId(x.pedido.id)}
            />
          )}
        />
      )}

      {/* Nunca se montan los dos modales juntos -- el historial reemplaza al
          detalle mientras está abierto. */}
      {abierto && !mostrandoHistorial && (
        <ModalDetallePedido
          x={abierto}
          org={orgsPorId.get(abierto.pedido.cliente_org_id)}
          prod={prodsPorId.get(abierto.pedido.producto_id)}
          domsPorId={domsPorId}
          orgsPorId={orgsPorId}
          transportistas={transportistas}
          viajePorDespacho={viajePorDespacho}
          calendarioDias={calendarioDias}
          calendarioReglas={calendarioReglas}
          asignando={asignando}
          setAsignando={setAsignando}
          editando={editando}
          setEditando={setEditando}
          ocupado={ocupado}
          onAceptar={(item, form) => confirmarAceptar(abierto, item, form)}
          onAsignar={(d) => confirmarAsignar(abierto, d)}
          onEditar={(d) => confirmarEditar(abierto, d)}
          onCancelar={(d) => confirmarCancelar(abierto, d)}
          onCerrarManual={(d, v) => abrirCierreManual(d, v)}
          setError={setError}
          onCerrar={() => { setPedidoAbiertoId(null); setMostrandoHistorial(false); setAsignando(null); setEditando(null); }}
          onVerHistorial={() => setMostrandoHistorial(true)}
        />
      )}

      {abierto && mostrandoHistorial && (
        <HistorialPedido pedidoId={abierto.pedido.id} onCerrar={() => setMostrandoHistorial(false)} />
      )}

      {/* RF-02: mismo modal que Seguimiento.js. */}
      {cerrandoManual && (
        <ModalCierreManual
          viaje={cerrandoManual.viaje}
          despacho={{
            id: cerrandoManual.despacho.id,
            numero: cerrandoManual.despacho.numero,
            fecha_carga: cerrandoManual.despacho.fecha_carga,
          }}
          usuario={usuario}
          onCerrado={() => setCerrandoManual(null)}
          onCancelar={() => setCerrandoManual(null)}
        />
      )}
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Fila de la lista -- Paso 2 del prompt: estado, cliente, producto, cantidad,
 * chip "N sin cubrir", OV/OC. Sin número PED, sin fechas, sin entregas ni
 * despachos -- eso queda para el modal.
 * -------------------------------------------------------------------------- */

function FilaPedido({ x, org, prod, vencido, esUltima, onClick }) {
  const styles = useEstilos();
  const { oscuro } = useTema();
  const paleta = paletaProgramacion(oscuro);
  const p = x.pedido;
  const col = COLOR_PEDIDO[p.estado] || COLOR_PEDIDO.pendiente;
  const sinCubrir = contarEntregasSinCubrir(x.entregas);

  return (
    <div
      onClick={onClick}
      style={{ ...styles.fila, ...(esUltima ? { borderBottom: 'none' } : {}) }}
    >
      <span style={styles.filaEstado}><Pastilla colores={col}>{ETIQUETA_PEDIDO[p.estado] || p.estado}</Pastilla></span>
      <span style={styles.filaCliente}>{org ? org.razon_social : '—'}</span>
      <span style={styles.filaProducto}>{prod ? prod.nombre : '—'}</span>
      <span style={styles.filaCantidad}>{p.volumen} tn</span>
      {sinCubrir > 0 && (
        <Pastilla chico colores={{ bg: paleta.chipSinCubrir.fondo, color: paleta.chipSinCubrir.texto }}>
          {sinCubrir} sin cubrir
        </Pastilla>
      )}
      {vencido && (
        <Pastilla chico colores={{ bg: paleta.estadoDespacho.sinCubrir.fondo, color: paleta.estadoDespacho.sinCubrir.texto }}>Vencido</Pastilla>
      )}
      <span style={styles.filaOv}>{p.ov}</span>
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Pastilla de filtro -- estado / "Solo sin cubrir" / "Viajes abiertos
 * vencidos". Las cinco con el mismo criterio: activa en rojo sólido, mismo
 * texto que pide el Paso 1 del prompt.
 * -------------------------------------------------------------------------- */

function PastillaFiltro({ activo, onClick, label }) {
  const { colores } = useTema();
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 14px', borderRadius: radio.pastilla, border: 'none', cursor: 'pointer',
        fontSize: tipografia.tamano.sm, fontWeight: activo ? tipografia.peso.negrita : tipografia.peso.normal,
        background: activo ? marca : colores.fondoAlterno,
        color: activo ? '#fff' : colores.textoSecundario,
        whiteSpace: 'nowrap', fontFamily: tipografia.familia,
      }}
    >
      {label}
    </button>
  );
}

/* -----------------------------------------------------------------------------
 * Auxiliares
 * -------------------------------------------------------------------------- */

function traducirError(err) {
  if (err && err.code === 'permission-denied') {
    return 'Firestore rechazó la escritura. Revisá la consola del navegador.';
  }
  if (err && err.code === 'failed-precondition') {
    return 'Falta un índice en Firestore. En la consola del navegador hay un '
         + 'link para crearlo con un clic.';
  }
  return (err && err.message) || 'Error desconocido.';
}

/* -----------------------------------------------------------------------------
 * Estilos -- crearEstilos(colores, oscuro) + useEstilos(), mismo patrón que
 * el resto del portal. Este archivo ya solo necesita los estilos de la
 * página y de la lista -- el modal tiene los suyos propios en
 * `programacion/ModalDetallePedido.js`.
 * -------------------------------------------------------------------------- */

function crearEstilos(colores, oscuro) {
  const paleta = paletaProgramacion(oscuro);

  return {
    wrap: { maxWidth: 960, margin: '0 auto', padding: '1.5rem 1rem', background: colores.fondo, color: colores.texto },
    panelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: espacio.lg },
    titulo: { fontSize: tipografia.tamano.titulo, fontWeight: tipografia.peso.fuerte, color: colores.texto },

    bannerError: {
      padding: '10px 14px', borderRadius: radio.md, background: '#FEF2F2', border: '0.5px solid #FCA5A5',
      fontSize: tipografia.tamano.md, color: '#B91C1C', marginBottom: espacio.md, whiteSpace: 'pre-line',
    },

    // Paso 2: el panel en sí (fondo blanco, borde, radio 16, overflow
    // hidden) se extrajo a `ui/PanelLista.js` -- mismos valores de siempre,
    // ahora vía `radioProgramacion.panel` (también 16). Acá se queda el
    // estilo de cada fila (`fila`/`filaEstado`/...), que PanelLista no
    // conoce.
    fila: {
      display: 'flex', alignItems: 'center', gap: espacio.lg, padding: '16px 20px',
      borderBottom: `1px solid ${colores.borde}`, cursor: 'pointer',
    },
    filaEstado: { minWidth: 120, flexShrink: 0 },
    // Cliente: bold -- tabla del diseño.
    filaCliente: { fontSize: tipografia.tamano.md, fontWeight: tipografia.peso.negrita, color: colores.texto, flex: 2, minWidth: 120 },
    // Producto: rojo marca, semibold -- tabla del diseño.
    filaProducto: { fontSize: tipografia.tamano.md, fontWeight: tipografia.peso.negrita, color: paleta.producto, flex: 1, minWidth: 90 },
    filaCantidad: { fontSize: tipografia.tamano.md, color: colores.texto, flexShrink: 0 },
    // OV/OC: rojo marca, bold, alineada a la derecha -- tabla del diseño.
    filaOv: { fontSize: tipografia.tamano.md, fontWeight: tipografia.peso.fuerte, color: paleta.ovOc, marginLeft: 'auto', textAlign: 'right', flexShrink: 0 },
  };
}

function useEstilos() {
  const { colores, oscuro } = useTema();
  return useMemo(() => crearEstilos(colores, oscuro), [colores, oscuro]);
}
