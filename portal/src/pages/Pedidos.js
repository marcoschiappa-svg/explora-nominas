/**
 * =============================================================================
 * Pedidos.js — Pedidos (Portal Explora)
 * =============================================================================
 *
 * PROPOSITO
 * Cargar y consultar pedidos.
 *
 * -----------------------------------------------------------------------------
 * REDISENO -- MISMA LOGICA, OTRA FORMA DE VERLA
 * -----------------------------------------------------------------------------
 *   Ninguna funcion de logica-pedidos.js cambio su comportamiento aca: lo
 *   que cambio es COMO se llega a cada accion, no que hace la accion.
 *
 *   ANTES: una lista plana, cada pedido se expandia en el lugar. Todo el
 *   estado de "que se esta editando" vivia en este componente, para los N
 *   pedidos a la vez.
 *
 *   AHORA: clickear un pedido abre un MODAL con su detalle -- datos del
 *   pedido a la izquierda, entregas a la derecha. Como a lo sumo un pedido
 *   esta abierto a la vez, todo ese estado de edicion se mudo adentro de
 *   ModalDetallePedido, local a ese modal.
 *
 *   LA LISTA se agrupa por estado con pastillas clickeables, se puede
 *   ordenar por fecha de entrega / fecha de creacion / cliente / OV-OC, y
 *   tiene una vista de tabla como alternativa a las tarjetas.
 *
 *   LA BARRA DE PROGRESO pasa de una fraccion a tres tramos: cumplida
 *   (verde), programada sin cumplir todavia (ambar), pendiente (gris).
 *
 * -----------------------------------------------------------------------------
 * DIRECCION POR ENTREGA -- SOLO "Entrega al cliente"
 * -----------------------------------------------------------------------------
 *   Para ese tipo, cada entrega puede tener su propio destino
 *   (entrega.destino_domicilio_id). Por eso el destino ya no se muestra una
 *   sola vez del lado del pedido para ese tipo: se muestra por entrega, con
 *   su propio boton de editar (editarDestinoEntrega()). Los otros dos tipos
 *   siguen con un domicilio unico, del lado del pedido.
 *
 * -----------------------------------------------------------------------------
 * SE FUE EL TOPBAR PROPIO
 * -----------------------------------------------------------------------------
 *   BarraSuperior.js (B1) ya cubre logo + volver a inicio para todo el
 *   portal.
 *
 * LOS ADJUNTOS NO ESTAN ACA -- van en la ficha del pedido, pateado (A5).
 *
 * -----------------------------------------------------------------------------
 * REDISENO v2 -- AJUSTES DE ESTA VUELTA
 * -----------------------------------------------------------------------------
 *   - Mas contraste entre pastillas de estado y entre dato cargado / dato
 *     vacio (Dato ahora distingue "sin dato" de un valor real).
 *   - "Ver historial" dejo de superponerse con el modal de detalle: nunca se
 *     montan los dos <Modal> a la vez. Se guarda un solo pedidoAbiertoId y un
 *     flag mostrandoHistorial que alterna cual de los dos se ve. Cerrar el
 *     historial vuelve al detalle (no lo pisa).
 *   - Agregar una entrega cuando la suma de entregas activas ya llego al
 *     volumen del pedido ahora avisa (banner + confirmacion): hay que
 *     agrandar la orden y avisar a los coordinadores antes de sumar mas.
 *     Esto es aviso de interfaz nada mas -- agregarEntregas() de
 *     logica-pedidos.js no cambio.
 *   - Las entregas muestran un borde de color segun su estado (mismo criterio
 *     de la barra de progreso: cumplida verde, programada ambar, pendiente
 *     gris, suspendida atenuada) y el volumen siempre con su "tn".
 *   - "Editar fecha" y "Editar direccion" ya no son dos botones secundarios
 *     iguales: cada uno tiene su propio color de acento e icono.
 *   - Carga masiva vuelve a los dos pasos: paso 1 solo baja la planilla,
 *     paso 2 elegis y subis el archivo.
 *
 * -----------------------------------------------------------------------------
 * REDISENO v3 -- MIGRACION REAL A TemaContext/tokens.js
 * -----------------------------------------------------------------------------
 *   v2 dejaba el archivo a medias: los componentes de ui/ (Boton, Campo,
 *   Modal, Pastilla...) ya seguian el tema porque cada uno llama a
 *   useTema() por su cuenta -- por eso ALGUNOS textos cambiaban -- pero todo
 *   lo que este archivo dibujaba con su propio `styles` (fondo de la
 *   pagina, tarjetas de entrega, inputs sueltos, tablas, la vista de carga
 *   masiva) seguia con colores fijos en hexadecimal. El fondo de la pagina
 *   nunca cambiaba porque nadie se lo pedia.
 *
 *   Ahora `styles` ya no es un objeto estatico: es `crearEstilos(colores)`,
 *   una funcion que arma el mismo objeto de siempre pero con los neutros
 *   (fondo, superficie, borde, texto/textoSecundario/textoSuave/textoTenue)
 *   sacados de `useTema()` en vez de hardcodeados. `useEstilos()` es el
 *   hook que cada componente de este archivo llama para obtenerlo -- mismo
 *   patron que ya usan Tarjeta/Boton/Campo/Buscador/Pastilla/Vacio/Pie: cada
 *   uno lee el tema por su cuenta, nadie pasa `colores` a mano de padre a
 *   hijo.
 *
 *   LO QUE NO CAMBIA: `colorEstado.*`, `marca`, y los `COLOR_PEDIDO` /
 *   COLOR_ENTREGA (definidos mas abajo con el mismo criterio de
 *   estados.js) siguen fijos en los dos temas, a proposito -- son
 *   informacion de dominio, no de diseño claro/oscuro.
 *
 *   DE PASO SE SACO UN BUG DE v2: varios `<Pastilla style={...}>` no hacian
 *   nada, porque Pastilla.js no lee la prop `style` -- solo `colores`. Los
 *   que necesitaban un color puntual (el borde de cada entrega) ahora se
 *   pasan como `colores={{ bg, color }}`, que es lo unico que Pastilla
 *   respeta.
 *
 * -----------------------------------------------------------------------------
 * REDISEÑO v4 (2026-09-18) -- AUTORÍA DEL PEDIDO
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     El modal de detalle no dice quién creó el pedido ni quién lo modificó
 *     por última vez. `Coordinador.js`/`PedidosLegacy.js` sí lo muestran,
 *     pero leyendo `creado_por`, un string del modelo viejo que no existe
 *     en `pedidos` acá.
 *
 *   CAUSA RAÍZ
 *     El dato SÍ existe en el modelo nuevo, en dos lugares distintos:
 *     `pedido.creado_por_uid` (quién lo creó) y `historial` (cada cambio
 *     posterior) -- pero nada en esta pantalla los leía todavía.
 *
 *   ALCANCE
 *     Dos líneas en el modal de detalle, "Creado por" y "Última
 *     modificación". La primera resuelve `creado_por_uid` contra `usuarios`
 *     (colección que esta pantalla pasa a cargar completa, como ya hace
 *     `Programacion.js` -- los tres roles con acceso acá son internos, así
 *     que la regla de Firestore lo permite sin filtro). La segunda lee
 *     `historial` -- ver `ModalDetallePedido` para el porqué de descartar
 *     `derivado: true`.
 *
 *   LIMITACIONES CONOCIDAS
 *     Un pedido creado antes de que `crearPedido()` empezara a guardar
 *     `creado_por_uid` (si lo hubiera) mostraría "Sin identificar" -- no hay
 *     forma de reconstruir ese dato para atrás.
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm run build` sin warnings. Abrir el detalle de un pedido:
 *     tiene que decir "Creado por: <nombre> · <fecha>". Editarlo (cambiar
 *     domicilio, suspenderlo, etc.) y volver a abrirlo: "Última
 *     modificación" tiene que reflejar ese cambio, con el nombre de quien lo
 *     hizo -- no el de un transportista que aceptó un despacho suyo, eso es
 *     `derivado` y se descarta a propósito.
 *
 * -----------------------------------------------------------------------------
 * v1.1.3 (2026-09-18) -- "MIS PEDIDOS" / "TODOS"
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     Un comercial ve los pedidos de todos mezclados con los suyos, sin
 *     forma de aislarlos.
 *
 *   CAUSA RAÍZ
 *     El dato para filtrar (`creado_por_uid`) siempre estuvo en el pedido;
 *     la pantalla nunca ofreció el filtro.
 *
 *   ALCANCE
 *     Un conmutador de dos posiciones ("Mis pedidos" / "Todos"), en memoria,
 *     sobre `pedidosConEstado` -- el mismo array que ya arma la pantalla, sin
 *     una consulta nueva a Firestore. Arranca en "Mis pedidos" para el
 *     comercial PURO (tiene el rol `comercial` y ningún otro de
 *     `admin`/`coordinador`); cualquier otro perfil arranca en "Todos", el
 *     comportamiento de siempre. Es la posición inicial nada más -- el
 *     conmutador queda visible y usable para cualquiera.
 *
 *   LIMITACIONES CONOCIDAS
 *     No hay barra de filtros ni orden por autor, y la elección no se
 *     recuerda entre sesiones -- las dos cosas quedan para v1.2.0, junto con
 *     la barra de filtros equivalente de `Programacion.js`. Construir eso
 *     acá ahora y otra vez allá después es la clase de duplicación que este
 *     repo evita a propósito.
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm run build` sin warnings. Ver la sección de verificación
 *     manual al final de esta tarea, con los tres perfiles.
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (RF-01) -- BARRA DE FILTROS Y ORDEN, COMPARTIDA CON Programacion.js
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     El encabezado v1.1.3 de acá arriba lo dejaba escrito: sin barra de
 *     filtros ni orden persistido, y "construirla acá ahora y otra vez en
 *     Programacion.js después" era la duplicación que este repo evita.
 *
 *   CAUSA RAÍZ
 *     No existía todavía la lógica pura de filtro/orden combinados
 *     (`filtros-listado.js`) ni el componente de presentación genérico
 *     (`ui/BarraFiltros.js`) que las dos pantallas necesitaban por igual.
 *
 *   ALCANCE
 *     1. `comparadorDe()` -- que vivía acá, con los cuatro criterios de
 *        siempre -- se retira: ahora es `comparador()` de
 *        `filtros-listado.js`, con los mismos cuatro criterios EN SENTIDO
 *        ASCENDENTE (ver el encabezado de ese archivo para la única
 *        diferencia real: "sin dato al final" para "cliente" con una
 *        organización borrada, caso que hoy no ocurre en producción) más dos
 *        nuevos, "producto" y "creado por".
 *     2. Filtros nuevos, todos en memoria sobre `pedidosDeAlcance` (nunca una
 *        consulta nueva a Firestore): cliente, producto, tipo de operación,
 *        creado por (selección múltiple), fecha solicitada de entrega y
 *        fecha de creación (rango, con los atajos Hoy/Próximos 7
 *        días/Este mes/Personalizado). "Mis pedidos"/"Todos" no cambia:
 *        sigue siendo el `alcance` de siempre, por FUERA de `filtros` --
 *        acota la base antes de que la barra filtre nada.
 *     3. Persistencia por usuario en `localStorage`
 *        (`leerPreferencias`/`guardarPreferencias`), con debounce de 300ms.
 *        El texto del buscador NUNCA se persiste. La posición inicial de
 *        "Mis pedidos"/"Todos" por rol (v1.1.3) solo se aplica si no hay
 *        preferencia guardada -- se lee recién cuando los datos ya
 *        cargaron, así los IDs de la selección se pueden podar contra lo
 *        que existe hoy.
 *
 *   LIMITACIONES CONOCIDAS
 *     El filtro "fecha de creación" compara contra `creado_en` convertido a
 *     fecha LOCAL -- un pedido creado a las 23:50 y otro a las 00:10 del día
 *     siguiente, en el mismo minuto real de reloj de servidor, pueden caer
 *     en días distintos del filtro. Mismo criterio que el resto del portal
 *     (`hoyISO()`), no es nuevo de esta tarea.
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm test -- filtros-listado` y `CI=true npm run build` sin
 *     warnings. Pruebas manuales al pie del prompt de la tarea.
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (RF-10) -- CALENDARIO OPERATIVO: LA FECHA DE ENTREGA SOLO ADVIERTE
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     Nada avisaba que la fecha solicitada de una entrega cae en un día
 *     marcado del calendario operativo (feriado, parada de planta...), ni
 *     en el alta de un pedido ni en la carga masiva.
 *
 *   CAUSA RAÍZ
 *     No existía el calendario operativo (`logica-calendario.js`, nuevo).
 *
 *   ALCANCE
 *     Esta pantalla se suscribe a `calendario_operativo` (solo los días
 *     ACTIVOS) y a `calendario_reglas/semanal`, y las pasa: a `VistaCrear`
 *     (mensaje bajo la fecha de cada entrega, con `evaluarFechaEntrega()`) y
 *     a `interpretarPlanilla()`/`interpretarGrupo()` (`carga-masiva.js`, vía
 *     `catalogos.calendario`) para que la vista previa de la carga masiva
 *     muestre la misma advertencia por fila. En los dos casos es solo eso:
 *     un aviso. Nunca bloquea el guardado -- a diferencia de la fecha de
 *     carga en `Programacion.js`.
 *
 *   LIMITACIONES CONOCIDAS
 *     Ninguna nueva -- mismas que documenta `logica-calendario.js`.
 *
 *   CÓMO SE VERIFICA
 *     Manual: dar de alta un pedido con una entrega en un día marcado
 *     muestra el aviso bajo la fecha y deja guardar igual. En la carga
 *     masiva, una fila con esa misma fecha muestra la advertencia en la
 *     vista previa (separada de los errores) y el pedido se crea igual al
 *     confirmar.
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (rediseño Pedidos) — "Portal Pedidos" (Claude Design)
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     Ivan aprobó un diseño nuevo para esta pantalla (lista y detalle): otra
 *     paleta (cálida, no la gris del resto del portal), otro orden de datos
 *     en la lista (sin el número PED, sin fechas ni tipo/destino), una barra
 *     de progreso por pedido en vez de tres contadores en texto, un modal de
 *     detalle a dos columnas con panel de "Entregas" propio, y dos avisos
 *     clickeables (entregas vencidas / sin cubrir) que ahora filtran.
 *
 *   CAUSA RAÍZ
 *     Cambio de presentación pedido explícitamente -- no de lógica. El
 *     trabajo de v1.1.3/RF-01/RF-10 de más arriba sigue intacto: mismos
 *     permisos, mismas acciones, mismo `filtros-listado.js`, mismos
 *     `logica-pedidos.js`. Lo que cambia es CÓMO se ve.
 *
 *   ALCANCE
 *     1. `shared/tokens.js` -- `paletaPedidos(oscuro)` con los colores del
 *        diseño (fondo, panel, 5 estados de pedido, panel "Entregas", tres
 *        acentos de botón), con equivalente en modo oscuro. Ver el
 *        encabezado de ese archivo para el porqué de cada decisión.
 *     2. `progreso-pedido.js` (nuevo) -- el cálculo puro del progreso por
 *        entrega ponderado por cantidad. Ver su propio encabezado para el
 *        FRENO explícito del Paso 3 del prompt: esta pantalla no carga
 *        `despachos` ni `viajes`, así que las 5 etapas del diseño se
 *        colapsan a las 3 que `entrega.estado` puede distinguir sin leer
 *        nada nuevo.
 *     3. Avisos del encabezado -- "N entregas vencidas sin cubrir" (rojo) y
 *        "N entrega(s) sin cubrir" (ámbar) ya existían (`resumen`, más
 *        abajo); lo nuevo es que son CLICKEABLES: `avisoFiltro` (nuevo
 *        estado, 'vencidas' | 'sinCubrir' | null) prende un filtro en
 *        memoria sobre `filtrados`, se suma a "Limpiar filtros" y NO se
 *        persiste -- igual que pide el prompt. El tercer aviso que ya
 *        existía ("N programada(s) esta semana") no está en el diseño; se
 *        mantiene igual de visible pero sin color de alerta ni click,
 *        porque no hay una funcionalidad previa que perder ahí (regla 9).
 *     4. `BarraFiltros.js` -- ver su propio encabezado v1.2.0: panel único
 *        + slot `piePastillas`. El segmentado Mis/Todos + Tarjetas/Tabla
 *        sigue definido acá (no se movió adentro), dibujado con el mismo
 *        lenguaje visual pegado arriba del panel.
 *     5. Lista (`FilaPedido`/`TablaPedidos`) -- reordenada según el diseño:
 *        estado, cliente, producto, cantidad, barra de progreso, chip de
 *        orden OV/OC. El número PED YA NO se muestra en la lista (sigue
 *        siendo buscable por el buscador de texto, que no cambió). El
 *        criterio de borde por estado (pendiente/suspendido) se mantiene.
 *     6. Modal de detalle (`ModalDetallePedido`) -- reestructurado a dos
 *        columnas con el orden del diseño: título "Pedido <OV/OC>" + número
 *        chico, grilla de datos (Cliente/Producto/Tipo/Recipiente/Banda
 *        horaria/Destino), barra de progreso 8px + done/total, autoría con
 *        fallback "Sin registro", botones a ancho completo. Panel "Entregas"
 *        con la paleta cálida propia. NINGUNA acción se sacó -- ver el punto
 *        7 para dónde quedó cada una que el diseño no ubicaba.
 *     7. Acciones que el diseño no ubica (regla 9, ver también V1 en el
 *        reporte de la tarea):
 *          - "Editar domicilio" del pedido (tipos que no son "Entrega al
 *            cliente"): columna izquierda, debajo de "Ver historial".
 *          - "Suspender"/"Reactivar" de una entrega suelta: se quedan en la
 *            propia tarjeta de la entrega (columna derecha), junto a
 *            "Editar fecha"/"Editar dirección" -- son acciones DE esa
 *            entrega, no del pedido, así que no hay otro lugar razonable.
 *
 *   DISCREPANCIAS CON EL DISEÑO (frenadas, no resueltas a mano)
 *     - El diseño pide "Suspender pedido" con un toggle a "Reactivar
 *       pedido". `logica-pedidos.js` (línea ~521) documenta a propósito que
 *       suspender un PEDIDO es definitivo -- no existe `reactivarPedido()`,
 *       a diferencia de `reactivarEntrega()`, que sí existe y ya se usa acá.
 *       Inventar esa reactivación es un cambio de LÓGICA, prohibido por la
 *       tarea ("es un cambio de presentación"). Se mantiene "Suspender
 *       pedido" sin toggle.
 *     - El diseño pide un chip "Con camión"/"Sin camión" por entrega, según
 *       un campo tipo `requiere_transporte`. Ese campo existe en
 *       `despacho.requiere_transporte` (fijo en `true`, marcado "Reservado"
 *       en `logica-despachos.js`) -- NO en `entrega`, y esta pantalla no lee
 *       despachos (mismo freno que en `progreso-pedido.js`). Se mantiene el
 *       chip existente (la etiqueta del ESTADO de la entrega: "Sin
 *       cubrir"/"Con camión"/"Entregada"/"Suspendida"), que ya venía
 *       cumpliendo ese lugar visual.
 *     - Tipografía: el diseño usa Montserrat. Regla 3 DE ESA TAREA PUNTUAL
 *       decía no agregar fuentes nuevas, así que en ese momento se mantuvo
 *       `tipografia.familia` en 'DM Sans' -- **superado por el rediseño de
 *       Programación (v1.2.0), que sí la cambia a Montserrat para todo el
 *       portal, este archivo incluido** (Paso 0 de esa tarea, ver
 *       `shared/tokens.js`). Este párrafo queda para que se entienda por qué
 *       existió la duda -- ya no aplica.
 *     - Radio de panel: el diseño pide 18px para el panel y 14px para la
 *       fila de la lista -- agregado como `radioPedidos.panel`/`.fila` en
 *       `tokens.js` (el `radio` general no tenía esos dos valores).
 *
 *   LIMITACIONES CONOCIDAS
 *     Las de `progreso-pedido.js` (colapso de 5 a 3 etapas) y las de
 *     `BarraFiltros.js` (franja superior no soldada al panel).
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm test -- --watchAll=false` (incluye `progreso-pedido` y
 *     `filtros-listado`) y `CI=true npm run build` sin warnings. Pruebas
 *     manuales al pie del prompt de la tarea.
 * ========================================================================== */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { collection, onSnapshot, query, orderBy, where } from 'firebase/firestore';
import { db } from '../firebase';
import { esInterno, motivoSinAcceso, tieneAlgunRol } from '../sesion';
import { claveNormalizada } from '../mapa-normalizacion';
import { textoDomicilio } from '../buscar-domicilios';
import {
  estadoPedido, ETIQUETA_PEDIDO, COLOR_PEDIDO, ETIQUETA_ENTREGA,
} from '../shared/estados';
import {
  aplicarFiltros, comparador, filtrosActivos, filtrosVacios,
  leerPreferencias, guardarPreferencias, timestampAFechaISO,
} from '../filtros-listado';
import BuscadorOrganizacion from './BuscadorOrganizacion';
import ModalOrganizacion from './ModalOrganizacion';
import ModalDomicilio from './ModalDomicilio';
import HistorialPedido from './HistorialPedido';
import * as XLSX from 'xlsx';
import {
  COLUMNAS, PRIMERA_FILA_DATOS, MAXIMO_FILAS,
  normalizarFecha, interpretarPlanilla,
} from '../carga-masiva';
import {
  TIPOS, RECIPIENTES, BANDAS_HORARIAS,
  validarPedido, crearPedido, suspenderPedido,
  editarDomicilioPedido, editarFechaEntrega, editarDestinoEntrega,
  agregarEntregas, suspenderEntregas, reactivarEntrega,
  armarPayloadNuevoPedido,
  hoyISO,
} from '../logica-pedidos';
import { llamarAppsScript, coordinadoresActivos, armarDestinatarios } from '../logica-despachos';
import { evaluarFechaEntrega } from '../logica-calendario';
import { proximaFechaPendiente, formatoFechaTs } from '../extractores-pedidos';
import { marca, colorEstado, espacio, radio, tipografia, paletaPedidos, radioPedidos } from '../shared/tokens';
import { progresoPedido } from '../progreso-pedido';
import { useTema } from '../ui/TemaContext';
import Boton from '../ui/Boton';
import Tarjeta from '../ui/Tarjeta';
import Pastilla from '../ui/Pastilla';
import Campo from '../ui/Campo';
import Modal from '../ui/Modal';
import Vacio from '../ui/Vacio';
import Tabla from '../ui/Tabla';
import BarraFiltros from '../ui/BarraFiltros';
import PastillaGrupo from '../ui/PastillaGrupo';
import Segmentado from '../ui/Segmentado';
import AvisoClickeable, { FranjaAvisos, AvisoNeutro } from '../ui/AvisoClickeable';

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzXOlu0PUTAVubDJCXh7WxjZp1ruCH5SMu9YmWbFCNF2ff7l5mn447nV8BIWbQ5-Mz-uQ/exec';

const FORM_VACIO = {
  cliente_org_id: '',
  producto_id: '',
  tipo: 'Entrega al cliente',
  recipiente: 'Granel',
  ov_tipo: 'OV',
  ov_numero: '',
  volumen: '',
  domicilio_cliente_id: '',
  banda_horaria: 'A confirmar',
  obs: '',
  entregas: [{ volumen: '', fecha_solicitada: '', destino_domicilio_id: '' }],
};

const ORDEN_GRUPOS = ['pendiente', 'programado_parcial', 'programado', 'cumplido', 'suspendido'];

// 1. Los cuatro primeros ya existían (ver el encabezado v1.2.0 (RF-01) más
//    arriba); "producto" y "creado por" son nuevos.
const ORDEN_OPCIONES = [
  { id: 'entrega', label: 'Fecha de entrega' },
  { id: 'creacion', label: 'Fecha de creacion' },
  { id: 'cliente', label: 'Cliente' },
  { id: 'ov', label: 'OV / OC' },
  { id: 'producto', label: 'Producto' },
  { id: 'creadoPor', label: 'Creado por' },
];

// Mismo criterio de color que BarraProgreso: cumplida verde, programada
// ambar, pendiente gris, suspendida atenuada. Es sobre el ESTADO DE LA
// ENTREGA (distinto del estado del pedido, que ya tiene COLOR_PEDIDO).
const COLOR_ENTREGA = {
  cumplida:    { borde: colorEstado.exitoBorde, fondo: colorEstado.exitoFondo, texto: colorEstado.exitoTexto },
  programada:  { borde: colorEstado.advertenciaBorde, fondo: colorEstado.advertenciaFondo, texto: colorEstado.advertenciaTexto },
  pendiente:   { borde: '#D1D5DB', fondo: '#F3F4F6', texto: '#6B7280' },
  suspendida:  { borde: colorEstado.peligroBordeAlterno, fondo: colorEstado.peligroFondo, texto: colorEstado.peligroTexto },
};

/* -----------------------------------------------------------------------------
 * Auxiliares de orden y resumen
 * -------------------------------------------------------------------------- */

// v1.2.0 (RF-05) -- `formatoFechaTs` y `proximaFechaPendiente` se mudaron a
// `extractores-pedidos.js` (import más arriba, sin cambiar su
// implementación) para que `CicloVida.js` las reuse. Ver el encabezado de
// ese archivo.

function fechaSumarDias(fechaISO, dias) {
  const d = new Date(fechaISO + 'T00:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

// v1.2.0 (rediseño Pedidos) -- "Lunes 28 de Septiembre", como pide el diseño
// para la fecha de cada entrega en el panel del modal. `toLocaleDateString`
// ya da los nombres en español (locale del navegador es 'es-*' en todo el
// portal); solo hace falta capitalizar el día, que sale en minúscula.
function formatoFechaLarga(fechaISO) {
  if (!fechaISO) return '';
  const d = new Date(fechaISO + 'T00:00:00');
  const texto = d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function traducirError(err) {
  if (err && err.code === 'permission-denied') {
    return 'Firestore rechazo la escritura. Revisa la consola del navegador.';
  }
  if (err && err.code === 'failed-precondition') {
    return 'Falta un indice en Firestore. En la consola del navegador hay un '
         + 'link para crearlo con un clic.';
  }
  return (err && err.message) || 'Error desconocido.';
}

/* =============================================================================
 * Componente principal
 * ========================================================================== */

export default function Pedidos({ usuario, onVolver }) {
  const styles = useEstilos();
  const [pedidos, setPedidos] = useState([]);
  const [entregasPorPedido, setEntregasPorPedido] = useState(new Map());
  const [organizaciones, setOrganizaciones] = useState([]);
  const [productos, setProductos] = useState([]);
  const [domicilios, setDomicilios] = useState([]);
  const [vinculos, setVinculos] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [cargando, setCargando] = useState(true);
  // v1.2.0 (RF-10) -- calendario operativo, solo para ADVERTIR (nunca
  // bloquea acá, a diferencia de la fecha de carga en Programación). Mismo
  // criterio que ahí: Map<fechaISO, {...}> de los días ACTIVOS + la regla
  // semanal.
  const [calendarioDias, setCalendarioDias] = useState(new Map());
  const [calendarioReglas, setCalendarioReglas] = useState(null);

  const [vista, setVista] = useState('lista');
  const [vistaLista, setVistaLista] = useState('tarjetas');
  const [grupoActivo, setGrupoActivo] = useState('todos');
  const [ordenPor, setOrdenPor] = useState('entrega');
  // 2. Sentido del orden -- nuevo en RF-01. "entrega" ascendente (fecha más
  //    próxima primero) sigue siendo el default de siempre.
  const [ordenSentido, setOrdenSentido] = useState('asc');
  const [filtro, setFiltro] = useState('');
  // 2. Filtros de la barra (RF-01) -- cliente/producto/tipo/creado por
  //    (selección múltiple) y entrega/creación (rango). Ver
  //    `filtros-listado.js`. El texto del buscador (`filtro`, arriba) queda
  //    AFUERA a propósito -- nunca se persiste.
  const [filtros, setFiltros] = useState(filtrosVacios());
  // 1. "Mis pedidos" / "Todos" -- arranca en "mios" solo para el comercial
  //    PURO (comercial y ningún otro rol de admin/coordinador): a un
  //    admin-comercial el filtro le estorbaría, porque su trabajo es ver
  //    todo. Ver el encabezado v1.1.3 más arriba. Con RF-01, esta posición
  //    inicial por rol solo se usa si no hay preferencia guardada -- ver el
  //    efecto de "leer preferencias" más abajo.
  const [alcance, setAlcance] = useState(
    tieneAlgunRol(usuario, ['comercial']) && !tieneAlgunRol(usuario, ['admin', 'coordinador'])
      ? 'mios'
      : 'todos'
  );
  const [pedidoAbiertoId, setPedidoAbiertoId] = useState(null);
  const [mostrandoHistorial, setMostrandoHistorial] = useState(false);
  // 3. Aviso clickeable del encabezado (v1.2.0 rediseño) -- 'vencidas' |
  //    'sinCubrir' | null. En memoria, no se persiste, "Limpiar filtros" lo
  //    apaga.
  const [avisoFiltro, setAvisoFiltro] = useState(null);

  const [form, setForm] = useState(FORM_VACIO);
  const [errores, setErrores] = useState([]);
  const [guardando, setGuardando] = useState(false);

  const [modalOrg, setModalOrg] = useState(null);
  const [modalDomicilio, setModalDomicilio] = useState(false);

  const [interpretados, setInterpretados] = useState([]);
  const [nombreArchivo, setNombreArchivo] = useState('');
  const [errorArchivo, setErrorArchivo] = useState('');
  const [progreso, setProgreso] = useState(null);

  const sinAcceso = motivoSinAcceso(usuario, ['admin', 'comercial', 'coordinador']);

  useEffect(() => {
    if (sinAcceso) { setCargando(false); return; }

    const unsubs = [
      onSnapshot(query(collection(db, 'pedidos'), orderBy('creado_en', 'desc')), (snap) => {
        setPedidos(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setCargando(false);
      }, (err) => { console.error('Pedidos:', err); setCargando(false); }),

      onSnapshot(collection(db, 'entregas'), (snap) => {
        const mapa = new Map();
        snap.docs.forEach(d => {
          const e = { id: d.id, ...d.data() };
          const lista = mapa.get(e.pedido_id) || [];
          lista.push(e);
          mapa.set(e.pedido_id, lista);
        });
        for (const lista of mapa.values()) lista.sort((a, b) => a.numero - b.numero);
        setEntregasPorPedido(mapa);
      }, (err) => console.error('Entregas:', err)),

      onSnapshot(collection(db, 'organizaciones'), (snap) =>
        setOrganizaciones(snap.docs.map(d => ({ id: d.id, ...d.data() })))),

      onSnapshot(collection(db, 'productos'), (snap) =>
        setProductos(snap.docs.map(d => ({ id: d.id, ...d.data() })))),

      onSnapshot(collection(db, 'domicilios'), (snap) =>
        setDomicilios(snap.docs.map(d => ({ id: d.id, ...d.data() })))),

      onSnapshot(collection(db, 'organizacion_domicilios'), (snap) =>
        setVinculos(snap.docs.map(d => ({ id: d.id, ...d.data() })))),

      // Para "Creado por" en el detalle del pedido -- resuelve
      // `creado_por_uid` contra el nombre. Sin filtro: los tres roles con
      // acceso a esta pantalla (admin/comercial/coordinador) son internos, y
      // las reglas de `usuarios` les permiten leer la colección entera.
      onSnapshot(collection(db, 'usuarios'), (snap) =>
        setUsuarios(snap.docs.map(d => ({ id: d.id, ...d.data() })))),

      // v1.2.0 (RF-10) -- ver el estado más arriba.
      onSnapshot(query(collection(db, 'calendario_operativo'), where('estado', '==', 'activo')), (snap) => {
        setCalendarioDias(new Map(snap.docs.map(d => [d.id, d.data()])));
      }),
      onSnapshot(collection(db, 'calendario_reglas'), (snap) => {
        const semanal = snap.docs.find(d => d.id === 'semanal');
        setCalendarioReglas(semanal ? semanal.data() : null);
      }),
    ];

    return () => unsubs.forEach(u => u());
  }, [sinAcceso]);

  const orgsPorId = useMemo(() => new Map(organizaciones.map(o => [o.id, o])), [organizaciones]);
  const prodsPorId = useMemo(() => new Map(productos.map(p => [p.id, p])), [productos]);
  const domsPorId = useMemo(() => new Map(domicilios.map(d => [d.id, d])), [domicilios]);
  const usuariosPorId = useMemo(() => new Map(usuarios.map(u => [u.id, u])), [usuarios]);

  const clientes = useMemo(
    () => organizaciones
      .filter(o => o.es_cliente && o.estado === 'activo')
      .sort((a, b) => a.razon_social.localeCompare(b.razon_social, 'es')),
    [organizaciones]
  );

  const productosActivos = useMemo(
    () => productos
      .filter(p => p.activo !== false)
      .sort((a, b) => {
        if (!!a.es_generico !== !!b.es_generico) return a.es_generico ? 1 : -1;
        return a.nombre.localeCompare(b.nombre, 'es');
      }),
    [productos]
  );

  const orgPropia = useMemo(() => organizaciones.find(o => o.es_propia), [organizaciones]);

  const domicilioPlanta = useMemo(() => {
    if (!orgPropia) return null;
    const delaPropia = vinculos.filter(v => v.organizacion_id === orgPropia.id);
    const principal = delaPropia.find(v => v.principal) || delaPropia[0];
    return principal ? domsPorId.get(principal.domicilio_id) || null : null;
  }, [orgPropia, vinculos, domsPorId]);

  const domiciliosDeCliente = useCallback((clienteOrgId) => {
    if (!clienteOrgId) return [];
    return vinculos
      .filter(v => v.organizacion_id === clienteOrgId)
      .map(v => ({ ...domsPorId.get(v.domicilio_id), alias: v.alias, principal: v.principal }))
      .filter(d => d.id && d.estado !== 'inactivo')
      .sort((a, b) => {
        if (!!a.principal !== !!b.principal) return a.principal ? -1 : 1;
        return textoDomicilio(a).localeCompare(textoDomicilio(b), 'es');
      });
  }, [vinculos, domsPorId]);

  const domiciliosDelCliente = useMemo(
    () => domiciliosDeCliente(form.cliente_org_id),
    [form.cliente_org_id, domiciliosDeCliente]
  );

  const pedidosConEstado = useMemo(
    () => pedidos.map(p => ({ ...p, estado: estadoPedido(p) })),
    [pedidos]
  );

  // 2. En memoria, sobre lo que la pantalla ya trajo -- NO es un `where` nuevo
  //    a Firestore. Uno por `creado_por_uid` obligaría a un índice compuesto
  //    (la consulta de arriba ya tiene `orderBy('creado_en')`) y a recargar
  //    cada vez que se toca el conmutador, por un filtro que en memoria es
  //    instantáneo.
  const pedidosDeAlcance = useMemo(() => {
    if (alcance !== 'mios') return pedidosConEstado;
    return pedidosConEstado.filter(p => p.creado_por_uid === usuario.uid);
  }, [pedidosConEstado, alcance, usuario.uid]);

  // 3. Extractores para `filtros-listado.js` -- lo único que esta pantalla
  //    le enseña a la lógica genérica sobre qué es "un pedido". `entrega`
  //    (orden) reusa `proximaFechaPendiente()` -- misma función que ya usaba
  //    `comparadorDe()`, así el sentido ascendente de ese criterio no cambia
  //    (ver el encabezado v1.2.0 (RF-01) más arriba). `fechasEntrega`
  //    (FILTRO, no orden) es distinta a propósito: considera TODA entrega no
  //    suspendida, no solo las pendientes -- así lo pide la tabla de
  //    filtros del prompt.
  const extractoresPedidos = useMemo(() => ({
    clienteId: p => p.cliente_org_id || null,
    productoId: p => p.producto_id || null,
    tipo: p => p.tipo || null,
    creadoPorUid: p => p.creado_por_uid || null,
    fechasEntrega: p => (entregasPorPedido.get(p.id) || [])
      .filter(e => e.estado !== 'suspendida')
      .map(e => e.fecha_solicitada)
      .filter(Boolean),
    fechaCreacion: p => timestampAFechaISO(p.creado_en),
    numero: p => p.numero || '',
    clienteNombre: p => { const o = orgsPorId.get(p.cliente_org_id); return o ? o.razon_social : null; },
    ov: p => p.ov || null,
    fechaEntregaProxima: p => proximaFechaPendiente(entregasPorPedido.get(p.id)) || null,
    fechaCreacionMillis: p => (p.creado_en && p.creado_en.toMillis) ? p.creado_en.toMillis() : null,
    productoNombre: p => { const pr = prodsPorId.get(p.producto_id); return pr ? pr.nombre : null; },
    creadoPorNombre: p => { const u = usuariosPorId.get(p.creado_por_uid); return u ? (u.nombre || u.email || null) : null; },
  }), [entregasPorPedido, orgsPorId, prodsPorId, usuariosPorId]);

  // 4. Opciones de cada selector -- salen de `pedidosDeAlcance` (la base de
  //    la pantalla, antes de que la barra filtre nada), ordenadas
  //    alfabéticamente. Un cliente sin pedidos en esa base no se ofrece.
  const opcionesClientes = useMemo(() => {
    const ids = new Set(pedidosDeAlcance.map(p => p.cliente_org_id).filter(Boolean));
    return organizaciones
      .filter(o => ids.has(o.id))
      .map(o => ({ id: o.id, label: o.razon_social }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }, [pedidosDeAlcance, organizaciones]);

  const opcionesProductos = useMemo(() => {
    const ids = new Set(pedidosDeAlcance.map(p => p.producto_id).filter(Boolean));
    return productos
      .filter(p => ids.has(p.id))
      .map(p => ({ id: p.id, label: p.nombre }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }, [pedidosDeAlcance, productos]);

  const opcionesTipos = useMemo(() => {
    const ids = new Set(pedidosDeAlcance.map(p => p.tipo).filter(Boolean));
    return Object.keys(TIPOS)
      .filter(t => ids.has(t))
      .map(t => ({ id: t, label: t }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }, [pedidosDeAlcance]);

  const opcionesCreadoPor = useMemo(() => {
    const ids = new Set(pedidosDeAlcance.map(p => p.creado_por_uid).filter(Boolean));
    return usuarios
      .filter(u => ids.has(u.id))
      .map(u => ({ id: u.id, label: u.nombre || u.email || 'Sin identificar' }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }, [pedidosDeAlcance, usuarios]);

  const controlesBarra = useMemo(() => [
    { campo: 'clientes', tipo: 'multi', etiqueta: 'Cliente', opciones: opcionesClientes, vacio: 'Sin clientes con pedidos' },
    { campo: 'productos', tipo: 'multi', etiqueta: 'Producto', opciones: opcionesProductos, vacio: 'Sin productos con pedidos' },
    { campo: 'entrega', tipo: 'rango', etiqueta: 'Fecha de entrega' },
    { campo: 'tipos', tipo: 'multi', etiqueta: 'Tipo', opciones: opcionesTipos, enPanel: true },
    { campo: 'creadoPor', tipo: 'multi', etiqueta: 'Creado por', opciones: opcionesCreadoPor, enPanel: true },
    { campo: 'creacion', tipo: 'rango', etiqueta: 'Fecha de creación', enPanel: true },
  ], [opcionesClientes, opcionesProductos, opcionesTipos, opcionesCreadoPor]);

  // 5. Persistencia (RF-01) -- se lee UNA vez, recién cuando los datos ya
  //    cargaron (así los IDs de la selección se pueden podar contra lo que
  //    existe hoy), y se guarda con debounce en cada cambio posterior.
  //    `prefsAplicadasRef` evita: (a) guardar los valores por defecto ANTES
  //    de haber leído lo guardado -- eso pisaría la preferencia real con el
  //    default de la primera renderización -- y (b) volver a aplicar la
  //    preferencia leída si el usuario ya la cambió a mano.
  const prefsAplicadasRef = useRef(false);

  useEffect(() => {
    if (prefsAplicadasRef.current || cargando) return;
    prefsAplicadasRef.current = true;

    const validos = {
      clientes: new Set(organizaciones.map(o => o.id)),
      productos: new Set(productos.map(p => p.id)),
      tipos: new Set(Object.keys(TIPOS)),
      creadoPor: new Set(usuarios.map(u => u.id)),
    };
    const prefs = leerPreferencias('pedidos', usuario.uid, validos);
    if (!prefs) return;

    if (prefs.filtros) setFiltros(f => ({ ...f, ...prefs.filtros }));
    if (prefs.grupoActivo) setGrupoActivo(prefs.grupoActivo);
    if (prefs.ordenPor) setOrdenPor(prefs.ordenPor);
    if (prefs.ordenSentido) setOrdenSentido(prefs.ordenSentido);
    // "Mis pedidos"/"Todos": el default por rol (arriba) solo se usa si no
    // hay preferencia guardada -- acá se sobreescribe si la hay.
    if (prefs.alcance) setAlcance(prefs.alcance);
  }, [cargando, organizaciones, productos, usuarios, usuario.uid]);

  useEffect(() => {
    if (!prefsAplicadasRef.current) return; // no guardar antes de leer lo guardado
    const id = setTimeout(() => {
      guardarPreferencias('pedidos', usuario.uid, { filtros, grupoActivo, ordenPor, ordenSentido, alcance });
    }, 300);
    return () => clearTimeout(id);
  }, [filtros, grupoActivo, ordenPor, ordenSentido, alcance, usuario.uid]);

  // 3. `filtradosGenerales` -- texto + RF-01, SIN el aviso clickeable. Es la
  //    base de `resumen` (para que los dos avisos no se apaguen entre sí al
  //    clickear uno) y de `filtrados`, que le suma encima el aviso activo.
  const filtradosGenerales = useMemo(() => {
    const texto = claveNormalizada(filtro);
    const porTexto = !texto ? pedidosDeAlcance : pedidosDeAlcance.filter(p => {
      const org = orgsPorId.get(p.cliente_org_id);
      return claveNormalizada(p.numero).includes(texto)
          || claveNormalizada(p.ov).includes(texto)
          || (org && claveNormalizada(org.razon_social).includes(texto));
    });
    return aplicarFiltros(porTexto, filtros, extractoresPedidos);
  }, [pedidosDeAlcance, filtro, orgsPorId, filtros, extractoresPedidos]);

  // 3. Aviso clickeable (v1.2.0 rediseño) -- filtro EN MEMORIA adicional:
  //    solo pedidos con alguna entrega en la situación del aviso activo.
  //    Mismo criterio que `resumen`, más abajo.
  const filtrados = useMemo(() => {
    if (!avisoFiltro) return filtradosGenerales;
    const hoy = hoyISO();
    return filtradosGenerales.filter(p => {
      if (p.estado === 'suspendido' || p.estado === 'cumplido') return false;
      return (entregasPorPedido.get(p.id) || []).some(e => {
        if (e.estado !== 'pendiente') return false; // "sin cubrir"
        const vencida = !!e.fecha_solicitada && e.fecha_solicitada < hoy;
        return avisoFiltro === 'vencidas' ? vencida : !vencida;
      });
    });
  }, [filtradosGenerales, avisoFiltro, entregasPorPedido]);

  const conteosPorGrupo = useMemo(() => {
    const c = {};
    ORDEN_GRUPOS.forEach(g => { c[g] = 0; });
    filtrados.forEach(p => { c[p.estado] = (c[p.estado] || 0) + 1; });
    return c;
  }, [filtrados]);

  const visibles = useMemo(() => {
    const base = grupoActivo === 'todos' ? filtrados : filtrados.filter(p => p.estado === grupoActivo);
    return [...base].sort(comparador(ordenPor, ordenSentido, extractoresPedidos));
  }, [filtrados, grupoActivo, ordenPor, ordenSentido, extractoresPedidos]);

  // 6. "Limpiar filtros" -- limpia filtros, texto y pastilla de estado, pero
  //    NO el orden ni "Mis pedidos"/"Todos" (regla explícita del prompt).
  const hayFiltrosActivosBarra = filtrosActivos(filtros) || !!filtro || grupoActivo !== 'todos' || !!avisoFiltro;

  function limpiarFiltrosBarra() {
    setFiltros(filtrosVacios());
    setFiltro('');
    setGrupoActivo('todos');
    setAvisoFiltro(null);
  }

  // 3. Los avisos se calculan sobre `filtradosGenerales` (RF-01, SIN el
  //    aviso clickeable) -- así los dos conteos se mantienen estables aunque
  //    uno de los dos esté activo como filtro. `sinCubrir` acá es la
  //    cantidad AMBAR (de hoy en adelante): `vencidas` ya se cuenta aparte
  //    para no contarla dos veces, tal como pide el prompt.
  const resumen = useMemo(() => {
    const hoy = hoyISO();
    const en7dias = fechaSumarDias(hoy, 7);
    let sinCubrir = 0, vencidas = 0, programadasEstaSemana = 0;

    filtradosGenerales.forEach(p => {
      if (p.estado === 'suspendido' || p.estado === 'cumplido') return;
      (entregasPorPedido.get(p.id) || []).forEach(e => {
        if (e.estado === 'pendiente') {
          if (e.fecha_solicitada && e.fecha_solicitada < hoy) vencidas++;
          else sinCubrir++;
        }
        if (e.estado === 'programada' && e.fecha_solicitada >= hoy && e.fecha_solicitada <= en7dias) {
          programadasEstaSemana++;
        }
      });
    });

    return { sinCubrir, vencidas, programadasEstaSemana };
  }, [filtradosGenerales, entregasPorPedido]);

  const pedidoAbierto = pedidoAbiertoId ? pedidosConEstado.find(p => p.id === pedidoAbiertoId) : null;

  function abrirAlta() {
    setForm({ ...FORM_VACIO, entregas: [{ volumen: '', fecha_solicitada: '', destino_domicilio_id: '' }] });
    setErrores([]);
    setVista('form');
  }

  function cambiarCliente(id) {
    setForm({ ...form, cliente_org_id: id, domicilio_cliente_id: '' });
  }

  function agregarEntrega() {
    setForm({ ...form, entregas: [...form.entregas, { volumen: '', fecha_solicitada: '', destino_domicilio_id: '' }] });
  }

  function quitarEntrega(i) {
    if (form.entregas.length === 1) return;
    setForm({ ...form, entregas: form.entregas.filter((_, x) => x !== i) });
  }

  function cambiarEntrega(i, campo, valor) {
    const nuevas = form.entregas.map((e, x) => x === i ? { ...e, [campo]: valor } : e);
    setForm({ ...form, entregas: nuevas });
  }

  function repartirVolumen() {
    const total = Number(form.volumen);
    const n = form.entregas.length;
    if (!total || !n) return;
    const porEntrega = Math.floor((total / n) * 100) / 100;
    const resto = Math.round((total - porEntrega * n) * 100) / 100;
    setForm({
      ...form,
      entregas: form.entregas.map((e, i) => ({
        ...e,
        volumen: String(i === 0 ? porEntrega + resto : porEntrega),
      })),
    });
  }

  const sumaEntregas = useMemo(
    () => form.entregas.reduce((s, e) => s + (Number(e.volumen) || 0), 0),
    [form.entregas]
  );

  const config = TIPOS[form.tipo];

  function armarPedido() {
    const idCliente = form.domicilio_cliente_id;
    const idPlanta = domicilioPlanta ? domicilioPlanta.id : '';

    return {
      cliente_org_id: form.cliente_org_id,
      producto_id: form.producto_id,
      tipo: form.tipo,
      recipiente: form.recipiente,
      ov_tipo: form.ov_tipo,
      ov_numero: form.ov_numero.trim(),
      ov: `${form.ov_tipo}-${form.ov_numero.trim()}`,
      volumen: Number(form.volumen),
      origen_domicilio_id: config.origen === 'propia' ? idPlanta : idCliente,
      destino_domicilio_id: config.destino === 'propia' ? idPlanta : idCliente,
      banda_horaria: form.banda_horaria,
      obs: form.obs.trim(),
      entregas: form.entregas.map(e => ({
        volumen: Number(e.volumen),
        fecha_solicitada: e.fecha_solicitada,
        destino_domicilio_id: e.destino_domicilio_id || undefined,
      })),
    };
  }

  async function guardar() {
    const pedido = armarPedido();

    const problemas = validarPedido(pedido, { organizaciones, productos, domiciliosDelCliente });
    if (!domicilioPlanta) {
      problemas.push('No esta cargado el domicilio de la planta de Explora. Cargalo desde Organizaciones.');
    }
    if (problemas.length > 0) { setErrores(problemas); return; }

    setGuardando(true);
    setErrores([]);

    try {
      // Un solo `new Date()`, capturado ANTES de llamar a `crearPedido()`
      // (que guarda `serverTimestamp()`): es lo que usa el mail para
      // `creado_en`, así que tiene que ser el instante más cercano posible
      // al de la escritura real, no uno tomado después de esperar la
      // respuesta de Firestore. Ver el encabezado de `armarPayloadNuevoPedido()`.
      const ahora = new Date();
      const { numero } = await crearPedido({ pedido, entregas: pedido.entregas, usuario, origenCarga: 'manual' });

      const org = orgsPorId.get(pedido.cliente_org_id);
      const prod = prodsPorId.get(pedido.producto_id);
      const destino = domsPorId.get(pedido.destino_domicilio_id);
      const destinatarios = armarDestinatarios({ coordinadores: await coordinadoresActivos() });

      const rAviso = await llamarAppsScript(APPS_SCRIPT_URL, 'nuevo_pedido',
        armarPayloadNuevoPedido(pedido, numero, org, prod, destino, pedido.entregas, usuario, ahora, destinatarios));

      setVista('lista');
      window.alert(
        rAviso.ok
          ? `Pedido ${numero} registrado. Se notifico al coordinador.`
          : `Pedido ${numero} registrado. No se pudo avisar al coordinador por mail -- avisale a mano.`
      );
    } catch (err) {
      console.error(err);
      setErrores([traducirError(err)]);
    } finally {
      setGuardando(false);
    }
  }

  function leerArchivo(archivo) {
    setErrorArchivo('');
    setInterpretados([]);
    setNombreArchivo(archivo.name);

    const lector = new FileReader();

    lector.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'binary', cellDates: true });
        const hoja = wb.Sheets[wb.SheetNames[0]];
        const matriz = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: false, defval: '' });

        const filas = matriz
          .slice(PRIMERA_FILA_DATOS - 1)
          .map(fila => {
            const obj = {};
            COLUMNAS.forEach((col, i) => {
              const bruto = fila[i];
              obj[col] = (col === 'fecha_entrega' || col === 'fecha_solicitada_entrega')
                ? normalizarFecha(bruto)
                : String(bruto == null ? '' : bruto).trim();
            });
            return obj;
          })
          .filter(f => Object.values(f).some(v => v !== ''));

        if (filas.length === 0) {
          setErrorArchivo('La planilla no tiene ninguna fila con datos a partir de la fila 5.');
          return;
        }
        if (filas.length > MAXIMO_FILAS) {
          setErrorArchivo(`La planilla tiene ${filas.length} filas y el maximo es ${MAXIMO_FILAS}. Partila en varias.`);
          return;
        }

        setInterpretados(interpretarPlanilla(filas, {
          organizaciones, productos, vinculos, domicilios, domicilioPlanta,
          // v1.2.0 (RF-10) -- llega por `catalogos`, ver el encabezado de
          // `carga-masiva.js`.
          calendario: { dias: calendarioDias, reglas: calendarioReglas },
        }));
      } catch (err) {
        console.error(err);
        setErrorArchivo('No se pudo leer el archivo. Es la plantilla de pedidos?');
      }
    };

    lector.readAsBinaryString(archivo);
  }

  const hayErrores = useMemo(() => interpretados.some(x => x.errores.length > 0), [interpretados]);

  const hayResueltosPorParecido = useMemo(
    () => interpretados.some(x =>
      (x.resuelto.cliente && x.resuelto.cliente.encontrado && !x.resuelto.cliente.exacto)
      || (x.resuelto.producto && x.resuelto.producto.encontrado && !x.resuelto.producto.exacto)
      || (x.resuelto.domicilio && x.resuelto.domicilio.encontrado && !x.resuelto.domicilio.exacto)),
    [interpretados]
  );

  async function confirmarMasiva() {
    if (hayErrores) return;

    setGuardando(true);
    setProgreso({ hechos: 0, total: interpretados.length, creados: [], fallidos: [] });

    const creados = [];
    const fallidos = [];

    // Una sola consulta para todo el lote: los coordinadores activos no
    // cambian entre filas de la misma carga masiva, y consultarlos una vez
    // por fila multiplicaría las lecturas por nada.
    const destinatarios = armarDestinatarios({ coordinadores: await coordinadoresActivos() });

    for (let i = 0; i < interpretados.length; i++) {
      const x = interpretados[i];
      try {
        // Igual que en `guardar()`: el reloj se captura antes de escribir,
        // no después.
        const ahora = new Date();
        const { numero } = await crearPedido({
          pedido: x.pedido, entregas: x.entregas, usuario, origenCarga: 'carga_masiva',
        });

        creados.push({ clave: x.clave, numero });

        const org = orgsPorId.get(x.pedido.cliente_org_id);
        const prod = prodsPorId.get(x.pedido.producto_id);
        const destino = domsPorId.get(x.pedido.destino_domicilio_id);

        const rAviso = await llamarAppsScript(APPS_SCRIPT_URL, 'nuevo_pedido',
          armarPayloadNuevoPedido(x.pedido, numero, org, prod, destino, x.pedido.entregas, usuario, ahora, destinatarios));
        if (!rAviso.ok) console.warn(`Pedido ${numero} creado, pero no se pudo avisar al coordinador:`, rAviso.mensaje);
      } catch (err) {
        console.error('Fallo', x.clave, err);
        fallidos.push({ clave: x.clave, motivo: traducirError(err) });
      }

      setProgreso({ hechos: i + 1, total: interpretados.length, creados, fallidos });
    }

    setGuardando(false);
  }

  function cerrarMasiva() {
    setInterpretados([]);
    setNombreArchivo('');
    setErrorArchivo('');
    setProgreso(null);
    setVista('lista');
  }

  if (sinAcceso) {
    return <div style={styles.wrap}><div style={styles.bannerError}>{sinAcceso}</div></div>;
  }

  if (vista === 'masiva') {
    return (
      <VistaMasiva
        interpretados={interpretados} nombreArchivo={nombreArchivo} errorArchivo={errorArchivo}
        progreso={progreso} guardando={guardando} hayErrores={hayErrores}
        hayResueltosPorParecido={hayResueltosPorParecido}
        onElegirArchivo={leerArchivo} onOtroArchivo={() => { setInterpretados([]); setNombreArchivo(''); }}
        onConfirmar={confirmarMasiva} onCerrar={cerrarMasiva}
      />
    );
  }

  if (vista === 'form') {
    return (
      <VistaCrear
        form={form} setForm={setForm} config={config} errores={errores} guardando={guardando}
        clientes={clientes} productosActivos={productosActivos} domiciliosDelCliente={domiciliosDelCliente}
        domicilioPlanta={domicilioPlanta} domsPorId={domsPorId}
        sumaEntregas={sumaEntregas}
        calendarioDias={calendarioDias} calendarioReglas={calendarioReglas}
        onCambiarCliente={cambiarCliente} onAgregarEntrega={agregarEntrega} onQuitarEntrega={quitarEntrega}
        onCambiarEntrega={cambiarEntrega} onRepartirVolumen={repartirVolumen}
        onGuardar={guardar} onCancelar={() => setVista('lista')}
        modalOrg={modalOrg} setModalOrg={setModalOrg} modalDomicilio={modalDomicilio} setModalDomicilio={setModalDomicilio}
        organizaciones={organizaciones} domicilios={domicilios} usuario={usuario}
      />
    );
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.panelHeader}>
        <div style={styles.titulo}>Pedidos</div>
        {esInterno(usuario) && (
          <div style={{ display: 'flex', gap: espacio.sm }}>
            <Boton variante="secundario" onClick={() => setVista('masiva')}>Carga masiva</Boton>
            <Boton onClick={abrirAlta}>+ Nuevo pedido</Boton>
          </div>
        )}
      </div>

      {/* Paso 1 (rediseño v1.2.0) -- avisos clickeables. Rojo (vencidas) y
          ámbar (sin cubrir, de hoy en adelante) prenden `avisoFiltro`; el
          tercero ("programadas esta semana") es una funcionalidad previa que
          el diseño no contempla -- se mantiene visible, sin color de alerta
          ni click, para no perderla (regla 9 del prompt). */}
      {(resumen.vencidas > 0 || resumen.sinCubrir > 0 || resumen.programadasEstaSemana > 0) && (
        <FranjaAvisos>
          {resumen.vencidas > 0 && (
            <AvisoClickeable
              tipo="peligro"
              activo={avisoFiltro === 'vencidas'}
              onClick={() => setAvisoFiltro(f => (f === 'vencidas' ? null : 'vencidas'))}
            >
              ⚠ {resumen.vencidas} entrega{resumen.vencidas > 1 ? 's' : ''} vencida{resumen.vencidas > 1 ? 's' : ''} sin cubrir
            </AvisoClickeable>
          )}
          {resumen.sinCubrir > 0 && (
            <AvisoClickeable
              tipo="advertencia"
              activo={avisoFiltro === 'sinCubrir'}
              onClick={() => setAvisoFiltro(f => (f === 'sinCubrir' ? null : 'sinCubrir'))}
            >
              🕐 {resumen.sinCubrir} entrega(s) sin cubrir
            </AvisoClickeable>
          )}
          {resumen.programadasEstaSemana > 0 && (
            <AvisoNeutro>{resumen.programadasEstaSemana} programada(s) esta semana</AvisoNeutro>
          )}
        </FranjaAvisos>
      )}

      {/* Paso 2 (rediseño v1.2.0) -- franja superior (Mis/Todos + Tarjetas/
          Tabla), dibujada con el mismo lenguaje visual del panel de
          BarraFiltros y pegada justo encima -- ver el encabezado v1.2.0 de
          `ui/BarraFiltros.js` para el porqué de que siga afuera de ese
          componente compartido. "Limpiar filtros" no la toca. */}
      <div style={styles.controlesFila}>
        <Segmentado
          opciones={[{ id: 'mios', label: 'Mis pedidos' }, { id: 'todos', label: 'Todos' }]}
          valor={alcance}
          onCambiar={setAlcance}
        />
        <Segmentado
          opciones={[{ id: 'tarjetas', label: '▦ Tarjetas' }, { id: 'tabla', label: '☰ Tabla' }]}
          valor={vistaLista}
          onCambiar={setVistaLista}
        />
      </div>

      {/* RF-01: la barra única de filtros y orden -- ver `ui/BarraFiltros.js`.
          `piePastillas` (v1.2.0) -- las pastillas de estado, con su color de
          dominio (`COLOR_PEDIDO`), armadas acá y encajadas en la franja
          inferior del panel compartido. */}
      <BarraFiltros
        texto={filtro}
        onCambiarTexto={setFiltro}
        placeholderTexto="Buscar por número, cliente u orden"
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
        totalBase={pedidosDeAlcance.length}
        totalVisible={filtrados.length}
        hayFiltrosActivos={hayFiltrosActivosBarra}
        onLimpiar={limpiarFiltrosBarra}
        etiquetaItem="pedidos"
        piePastillas={
          <>
            <PastillaGrupo
              activo={grupoActivo === 'todos'}
              onClick={() => setGrupoActivo('todos')}
              label={`Todos (${filtrados.length})`}
            />
            {ORDEN_GRUPOS.map(g => (
              <PastillaGrupo
                key={g}
                activo={grupoActivo === g}
                onClick={() => setGrupoActivo(g)}
                label={`${ETIQUETA_PEDIDO[g]} (${conteosPorGrupo[g] || 0})`}
                colores={COLOR_PEDIDO[g]}
              />
            ))}
          </>
        }
      />

      {cargando && <Vacio titulo="Cargando..." />}
      {!cargando && visibles.length === 0 && <Vacio titulo="No hay pedidos que coincidan con los filtros." />}

      {!cargando && visibles.length > 0 && vistaLista === 'tarjetas' && (
        <div>
          {visibles.map(p => (
            <FilaPedido
              key={p.id}
              pedido={p}
              org={orgsPorId.get(p.cliente_org_id)}
              prod={prodsPorId.get(p.producto_id)}
              entregas={entregasPorPedido.get(p.id) || []}
              onClick={() => setPedidoAbiertoId(p.id)}
            />
          ))}
        </div>
      )}

      {!cargando && visibles.length > 0 && vistaLista === 'tabla' && (
        <TablaPedidos
          pedidos={visibles} orgsPorId={orgsPorId} prodsPorId={prodsPorId}
          entregasPorPedido={entregasPorPedido} onFilaClick={p => setPedidoAbiertoId(p.id)}
        />
      )}

      {/* Nunca se montan los dos modales juntos: el historial reemplaza al
          detalle mientras esta abierto, no se le superpone. Cerrar el
          historial vuelve al detalle; cerrar el detalle limpia los dos. */}
      {pedidoAbierto && !mostrandoHistorial && (
        <ModalDetallePedido
          pedido={pedidoAbierto}
          entregas={entregasPorPedido.get(pedidoAbierto.id) || []}
          org={orgsPorId.get(pedidoAbierto.cliente_org_id)}
          prod={prodsPorId.get(pedidoAbierto.producto_id)}
          domsPorId={domsPorId}
          usuariosPorId={usuariosPorId}
          domiciliosDeCliente={domiciliosDeCliente}
          calendarioDias={calendarioDias} calendarioReglas={calendarioReglas}
          usuario={usuario}
          onCerrar={() => { setPedidoAbiertoId(null); setMostrandoHistorial(false); }}
          onVerHistorial={() => setMostrandoHistorial(true)}
        />
      )}

      {pedidoAbierto && mostrandoHistorial && (
        <HistorialPedido pedidoId={pedidoAbierto.id} onCerrar={() => setMostrandoHistorial(false)} />
      )}
    </div>
  );
}

/**
 * Barra de progreso del pedido (v1.2.0 rediseño) -- reemplaza a la vieja
 * `BarraProgreso` de 3 tramos (cumplida/programada/pendiente): el diseño
 * pide UN solo relleno, del color del estado del pedido, largo según
 * `progresoPedido()` (`../progreso-pedido.js`, ver ese archivo para el freno
 * de las 5 etapas del diseño original a las 3 que se pueden calcular sin
 * leer despachos ni viajes).
 *
 * @param {Array} entregas
 * @param {string} estado clave de PEDIDO (`estados.js`) -- define el color.
 * @param {number} [alto] 6px en la lista, 8px en el modal (spec del diseño).
 */
function BarraProgresoPedido({ entregas, estado, alto = 6 }) {
  const styles = useEstilos();
  const { oscuro } = useTema();
  const paleta = paletaPedidos(oscuro);
  const { porcentaje, done, total } = progresoPedido(entregas);
  if (!total) return null;
  const colorRelleno = (paleta.estados[estado] || paleta.estados.pendiente).texto;

  return (
    <div style={styles.progresoWrap}>
      <div style={{ ...styles.progresoBarra, height: alto, background: paleta.separador }}>
        <div style={{ width: `${porcentaje}%`, background: colorRelleno, borderRadius: alto }} />
      </div>
      <span style={styles.progresoTexto}>{done}/{total}</span>
    </div>
  );
}

function PasoIndicador({ numero, label, activo, hecho }) {
  const styles = useEstilos();
  const { colores } = useTema();
  const color = hecho ? colorEstado.exitoTexto : activo ? marca : colores.textoTenue;
  // El chip "activo, no hecho" usa un rosa palido fijo (tono de marca, no
  // del tema) -- mismo criterio que el resto de los acentos de este
  // archivo. El "inactivo" si sale del tema (fondoAlterno).
  const fondo = hecho ? colorEstado.exitoFondo : activo ? '#FDECEA' : colores.fondoAlterno;
  return (
    <div style={styles.pasoItem}>
      <span style={{ ...styles.pasoNumero, background: fondo, color, borderColor: color }}>
        {hecho ? '✓' : numero}
      </span>
      <span style={{ ...styles.pasoLabel, color, fontWeight: activo ? tipografia.peso.medio : tipografia.peso.normal }}>
        {label}
      </span>
    </div>
  );
}

/**
 * Fila de la vista Tarjetas (v1.2.0 rediseño) -- orden fijado por el diseño:
 * (1) badge de estado, (2) cliente en negrita, (3) producto secundario,
 * (4) cantidad total, (5) barra de progreso, (6) chip de orden OV/OC. El
 * número PED YA NO se muestra acá (sigue siendo buscable por texto -- ver
 * `filtro`, en el componente principal). Borde de color si el pedido está
 * Pendiente o Suspendido; sombra que sube al pasar el mouse.
 */
function FilaPedido({ pedido: p, org, prod, entregas, onClick }) {
  const styles = useEstilos();
  const { oscuro } = useTema();
  const paleta = paletaPedidos(oscuro);
  const [conMouse, setConMouse] = useState(false);
  const colorEst = paleta.estados[p.estado] || paleta.estados.pendiente;
  const conBorde = p.estado === 'pendiente' || p.estado === 'suspendido';

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setConMouse(true)}
      onMouseLeave={() => setConMouse(false)}
      style={{
        ...styles.filaPedido,
        border: `1px solid ${conBorde ? colorEst.borde : paleta.borde}`,
        boxShadow: conMouse ? paleta.sombraFilaHover : paleta.sombraFila,
      }}
    >
      <div style={styles.filaBadge}>
        <Pastilla colores={{ bg: colorEst.fondo, color: colorEst.texto }}>
          {ETIQUETA_PEDIDO[p.estado] || p.estado}
        </Pastilla>
      </div>
      <span style={styles.filaCliente}>{org ? org.razon_social : '-'}</span>
      <span style={styles.filaProducto}>{prod ? prod.nombre : '-'}</span>
      <span style={styles.filaVolumen}>{p.volumen} tn</span>
      <div style={styles.filaProgresoWrap}>
        <BarraProgresoPedido entregas={entregas} estado={p.estado} alto={6} />
      </div>
      <span style={styles.filaOvChip}>{p.ov}</span>
    </div>
  );
}

/**
 * Vista Tabla (v1.2.0 rediseño) -- columnas: Estado, Cliente, Producto,
 * Cantidad, Orden y Progreso. Ya no lleva la columna "N" (número PED) -- el
 * diseño no la contempla en la lista.
 */
function TablaPedidos({ pedidos, orgsPorId, prodsPorId, entregasPorPedido, onFilaClick }) {
  const { oscuro } = useTema();
  const paleta = paletaPedidos(oscuro);
  const columnas = [
    {
      clave: 'estado', titulo: 'Estado',
      render: p => {
        const c = paleta.estados[p.estado] || paleta.estados.pendiente;
        return <Pastilla chico colores={{ bg: c.fondo, color: c.texto }}>{ETIQUETA_PEDIDO[p.estado] || p.estado}</Pastilla>;
      },
    },
    { clave: 'cliente', titulo: 'Cliente', render: p => (orgsPorId.get(p.cliente_org_id) || {}).razon_social || '-' },
    { clave: 'producto', titulo: 'Producto', render: p => (prodsPorId.get(p.producto_id) || {}).nombre || '-' },
    { clave: 'volumen', titulo: 'Cantidad', numerica: true, render: p => `${p.volumen} tn` },
    { clave: 'ov', titulo: 'Orden', render: p => p.ov },
    {
      clave: 'progreso', titulo: 'Progreso',
      render: p => (
        <div style={{ width: 110 }}>
          <BarraProgresoPedido entregas={entregasPorPedido.get(p.id) || []} estado={p.estado} alto={6} />
        </div>
      ),
    },
  ];

  return <Tabla columnas={columnas} filas={pedidos} obtenerId={p => p.id} onFilaClick={onFilaClick} />;
}

function ModalDetallePedido({
  pedido: p, entregas, org, prod, domsPorId, usuariosPorId, domiciliosDeCliente,
  calendarioDias, calendarioReglas,
  usuario, onCerrar, onVerHistorial,
}) {
  const styles = useEstilos();
  const { oscuro } = useTema();
  const paleta = paletaPedidos(oscuro);
  const [ultimaModificacion, setUltimaModificacion] = useState(null);
  const [suspendiendo, setSuspendiendo] = useState(false);
  const [editandoDomicilio, setEditandoDomicilio] = useState(false);
  const [nuevoDomicilioElegido, setNuevoDomicilioElegido] = useState(p.destino_domicilio_id || '');
  const [guardandoDomicilio, setGuardandoDomicilio] = useState(false);

  const [editandoFechaId, setEditandoFechaId] = useState(null);
  const [nuevaFecha, setNuevaFecha] = useState('');
  const [guardandoFechaId, setGuardandoFechaId] = useState(null);

  const [editandoDestinoId, setEditandoDestinoId] = useState(null);
  const [nuevoDestinoEntrega, setNuevoDestinoEntrega] = useState('');
  const [guardandoDestinoId, setGuardandoDestinoId] = useState(null);

  const [agregandoEntregas, setAgregandoEntregas] = useState(false);
  const [filasNuevas, setFilasNuevas] = useState([{ volumen: '', fecha_solicitada: '' }]);
  const [guardandoEntregasNuevas, setGuardandoEntregasNuevas] = useState(false);

  const [suspendiendoEntregaId, setSuspendiendoEntregaId] = useState(null);
  const [reactivandoEntregaId, setReactivandoEntregaId] = useState(null);

  const esInternoUsuario = esInterno(usuario);
  const pedidoActivo = p.estado !== 'suspendido' && p.estado !== 'cumplido';
  const esEntregaAlCliente = p.tipo === 'Entrega al cliente';
  const destinoPedido = domsPorId.get(p.destino_domicilio_id);
  const domiciliosCliente = domiciliosDeCliente(p.cliente_org_id);
  const colorEstadoDiseno = paleta.estados[p.estado] || paleta.estados.pendiente;

  // v1.2.0 (rediseño Pedidos) -- "Destino" del diseño: domicilio único si
  // TODAS las entregas activas van al mismo, "Varía por entrega ->" si no.
  // Más literal al prompt que el criterio viejo (que asumía "varía" para
  // cualquier pedido de tipo "Entrega al cliente", aunque todas sus entregas
  // compartieran domicilio) -- se compara el domicilio REAL de cada entrega
  // (el propio si lo tiene, si no el del pedido).
  const destinosEntregas = Array.from(new Set(
    entregas
      .filter(e => e.estado !== 'suspendida')
      .map(e => e.destino_domicilio_id || p.destino_domicilio_id)
      .filter(Boolean)
  ));
  const varioPorEntrega = destinosEntregas.length > 1;
  const destinoUnico = destinosEntregas.length === 1 ? domsPorId.get(destinosEntregas[0]) : destinoPedido;

  // "Creado por": `creado_por_uid` resuelto contra `usuarios`. Mismo fallback
  // que `armarHistorial()` en datos.js -- nombre, si no email, si no un
  // texto fijo -- para no mostrar un UID pelado si el usuario se borró.
  // v1.2.0 (rediseño Pedidos) -- el diseño pide "Sin registro" cuando no hay
  // dato, en vez de "Sin identificar" (que sigue usándose para "Última
  // modificación" de un `historial` sin `usuario_nombre`, un caso interno
  // distinto: ahí SÍ hay registro, solo no tiene nombre).
  const creadoPorUsuario = usuariosPorId.get(p.creado_por_uid);
  const creadoPorNombre = creadoPorUsuario
    ? (creadoPorUsuario.nombre || creadoPorUsuario.email)
    : 'Sin registro';

  // "Última modificación": el registro de `historial` más reciente que NO
  // sea `derivado`. `historial` ya trae `usuario_nombre` denormalizado, así
  // que no hace falta resolver ningún UID acá -- a diferencia de "Creado
  // por", que solo tiene el UID en el propio pedido.
  useEffect(() => {
    const q = query(
      collection(db, 'historial'),
      where('pedido_id', '==', p.id),
      orderBy('ts', 'desc')
    );

    const unsub = onSnapshot(q, (snap) => {
      const noDerivado = snap.docs.find(d => !d.data().derivado);
      setUltimaModificacion(noDerivado ? { id: noDerivado.id, ...noDerivado.data() } : null);
    }, (err) => console.error('Historial (última modificación):', err));

    return () => unsub();
  }, [p.id]);

  // Volumen de las entregas activas (todo lo que no esta suspendido). Si ya
  // llega al volumen nominal del pedido, agregar una entrega mas implica
  // superar la orden -- hay que agrandarla y avisar a los coordinadores, no
  // es algo que se resuelva solo clickeando "+ Agregar entrega".
  const volumenEntregasActivas = entregas
    .filter(e => e.estado !== 'suspendida')
    .reduce((s, e) => s + (Number(e.volumen) || 0), 0);
  const limiteDeVolumenAlcanzado = !!p.volumen && volumenEntregasActivas >= Number(p.volumen);

  async function handleSuspender() {
    const motivo = window.prompt(
      `Vas a suspender el pedido ${p.numero}. Es definitivo: no se puede reactivar, `
      + 'y cancela todos los despachos vivos que tenga. Conta el motivo:'
    );
    if (motivo === null) return;
    if (!motivo.trim()) { window.alert('El motivo es obligatorio.'); return; }

    setSuspendiendo(true);
    try {
      const ahora = new Date();
      const { yaEstaba, avisosApps, despachosCancelados, fechaCarga } = await suspenderPedido({
        pedidoId: p.id, motivo, usuario, appsScriptUrl: APPS_SCRIPT_URL,
      });
      if (!yaEstaba) {
        // El mail a coordinadores de "pedido suspendido" -- quedó afuera al
        // partir la lógica en funciones chicas.
        //
        // NO se manda `destinatarios.transportista`: `suspenderPedido()`
        // cancela un despacho por cada transportista que tuviera algo vivo,
        // y pueden ser varios y distintos entre sí -- no hay un único
        // "el transportista" para este mail, que es singular por diseño
        // (una sola `fecha_carga`, un solo destinatario). El aviso a cada
        // transportista afectado ya sale por separado, in-app, dentro de
        // `cancelarDespacho()` (que `suspenderPedido()` llama una vez por
        // despacho vivo) -- así que no queda sin avisar, solo no es por mail
        // acá. Si algún día hiciera falta el mail, la solución es mandar un
        // `suspender_pedido` por transportista afectado, no uno solo con una
        // lista -- cambio de alcance mayor a esta tarea.
        await llamarAppsScript(APPS_SCRIPT_URL, 'suspender_pedido', {
          id: p.numero,
          producto: prod ? prod.nombre : '',
          volumen: p.volumen,
          cliente: org ? org.razon_social : '',
          ov: p.ov,
          fecha_entrega: proximaFechaPendiente(entregas) || '',
          suspendido_por: usuario.nombre || usuario.email,
          suspendido_en: ahora.toLocaleString('es-AR'),
          motivo,
          despachos_cancelados: despachosCancelados || 0,
          fecha_carga: fechaCarga || '',
          destinatarios: armarDestinatarios({ coordinadores: await coordinadoresActivos() }),
        });
      }
      if (yaEstaba) {
        window.alert('Ese pedido ya estaba suspendido.');
      } else if (avisosApps && avisosApps.length > 0) {
        window.alert(
          `Pedido ${p.numero} suspendido. ${avisosApps.length} de sus despachos no se `
          + 'pudieron reflejar en el Plan de Produccion -- revisalo a mano.'
        );
      } else {
        window.alert(`Pedido ${p.numero} suspendido.`);
      }
    } catch (err) {
      console.error(err);
      window.alert(traducirError(err));
    } finally {
      setSuspendiendo(false);
    }
  }

  async function confirmarNuevoDomicilio() {
    if (!nuevoDomicilioElegido) { window.alert('Elegi un domicilio.'); return; }
    if (nuevoDomicilioElegido === p.destino_domicilio_id) { setEditandoDomicilio(false); return; }
    const nuevoDom = domsPorId.get(nuevoDomicilioElegido);
    if (!nuevoDom) { window.alert('Ese domicilio ya no existe. Actualiza la pagina.'); return; }

    setGuardandoDomicilio(true);
    try {
      const { cambio } = await editarDomicilioPedido({
        pedidoId: p.id, nuevoDomicilioId: nuevoDomicilioElegido,
        nuevoDestinoTexto: textoDomicilio(nuevoDom), usuario,
      });
      setEditandoDomicilio(false);
      window.alert(cambio ? 'Domicilio actualizado.' : 'No hubo cambios.');
    } catch (err) {
      console.error(err);
      window.alert(traducirError(err));
    } finally {
      setGuardandoDomicilio(false);
    }
  }

  function abrirEdicionFecha(e) {
    setEditandoFechaId(e.id);
    setNuevaFecha(e.fecha_solicitada || '');
  }

  async function confirmarNuevaFecha(e) {
    if (!nuevaFecha) { window.alert('Elegi una fecha.'); return; }
    if (nuevaFecha === e.fecha_solicitada) { setEditandoFechaId(null); return; }

    setGuardandoFechaId(e.id);
    try {
      const { cambio, despachoCancelado, avisoApps } = await editarFechaEntrega({
        pedidoId: p.id, entregaId: e.id, nuevaFecha, usuario, appsScriptUrl: APPS_SCRIPT_URL,
      });
      setEditandoFechaId(null);
      if (!cambio) {
        window.alert('No hubo cambios.');
      } else if (despachoCancelado) {
        window.alert(
          `Fecha actualizada. La entrega ${e.numero} tenia un despacho asignado: `
          + 'se cancelo y volvio a "Sin cubrir" -- hay que programarla de nuevo.'
          + (avisoApps ? `\n\n${avisoApps}` : '')
        );
      } else {
        window.alert('Fecha actualizada.');
      }
    } catch (err) {
      console.error(err);
      window.alert(traducirError(err));
    } finally {
      setGuardandoFechaId(null);
    }
  }

  function abrirEdicionDestino(e) {
    setEditandoDestinoId(e.id);
    setNuevoDestinoEntrega(e.destino_domicilio_id || p.destino_domicilio_id || '');
  }

  async function confirmarNuevoDestinoEntrega(e) {
    if (!nuevoDestinoEntrega) { window.alert('Elegi un domicilio.'); return; }
    const actual = e.destino_domicilio_id || p.destino_domicilio_id;
    if (nuevoDestinoEntrega === actual) { setEditandoDestinoId(null); return; }
    const nuevoDom = domsPorId.get(nuevoDestinoEntrega);
    if (!nuevoDom) { window.alert('Ese domicilio ya no existe. Actualiza la pagina.'); return; }

    setGuardandoDestinoId(e.id);
    try {
      const { cambio } = await editarDestinoEntrega({
        pedidoId: p.id, entregaId: e.id, nuevoDomicilioId: nuevoDestinoEntrega,
        nuevoDestinoTexto: textoDomicilio(nuevoDom), usuario,
      });
      setEditandoDestinoId(null);
      window.alert(cambio ? 'Domicilio de la entrega actualizado.' : 'No hubo cambios.');
    } catch (err) {
      console.error(err);
      window.alert(traducirError(err));
    } finally {
      setGuardandoDestinoId(null);
    }
  }

  function abrirAgregarEntregas() {
    if (limiteDeVolumenAlcanzado) {
      const seguir = window.confirm(
        `Este pedido ya tiene programado su volumen total (${p.volumen} tn). `
        + 'Agregar otra entrega hace que la suma supere el volumen de la orden.\n\n'
        + 'Antes de sumarla hay que agrandar la orden y avisar a los coordinadores '
        + '-- esto no lo hace solo. Continuar de todos modos?'
      );
      if (!seguir) return;
    }
    setAgregandoEntregas(true);
  }

  function agregarFilaNueva() {
    setFilasNuevas(f => [...f, { volumen: '', fecha_solicitada: '' }]);
  }
  function quitarFilaNueva(i) {
    setFilasNuevas(f => f.length === 1 ? f : f.filter((_, idx) => idx !== i));
  }
  function cambiarFilaNueva(i, campo, valor) {
    setFilasNuevas(f => f.map((fila, idx) => idx === i ? { ...fila, [campo]: valor } : fila));
  }

  async function confirmarEntregasNuevas() {
    const entregasNuevas = filasNuevas
      .filter(f => f.volumen || f.fecha_solicitada)
      .map(f => ({ volumen: f.volumen, fecha_solicitada: f.fecha_solicitada }));

    setGuardandoEntregasNuevas(true);
    try {
      const { agregadas, volumenAgregado } = await agregarEntregas({ pedidoId: p.id, entregasNuevas, usuario });
      setAgregandoEntregas(false);
      window.alert(`Se agregaron ${agregadas} entrega(s) por ${volumenAgregado} en total.`);
    } catch (err) {
      console.error(err);
      window.alert(traducirError(err));
    } finally {
      setGuardandoEntregasNuevas(false);
    }
  }

  async function suspenderEntregaSuelta(e) {
    const motivo = window.prompt(
      `Vas a suspender la entrega ${e.numero} (${e.volumen}), del ${e.fecha_solicitada}. `
      + 'El volumen del pedido baja esa cantidad. Conta el motivo:'
    );
    if (motivo === null) return;
    if (!motivo.trim()) { window.alert('El motivo es obligatorio.'); return; }

    setSuspendiendoEntregaId(e.id);
    try {
      await suspenderEntregas({ pedidoId: p.id, entregaIds: [e.id], motivo, usuario });
      window.alert(`Entrega ${e.numero} suspendida.`);
    } catch (err) {
      console.error(err);
      window.alert(traducirError(err));
    } finally {
      setSuspendiendoEntregaId(null);
    }
  }

  async function reactivar(e) {
    setReactivandoEntregaId(e.id);
    try {
      const { cambio } = await reactivarEntrega({ pedidoId: p.id, entregaId: e.id, usuario });
      window.alert(cambio ? `Entrega ${e.numero} reactivada.` : 'Esa entrega ya no estaba suspendida.');
    } catch (err) {
      console.error(err);
      window.alert(traducirError(err));
    } finally {
      setReactivandoEntregaId(null);
    }
  }

  return (
    <Modal
      titulo={
        <span style={styles.tituloModalWrap}>
          <span>Pedido {p.ov}</span>
          <span style={styles.tituloModalNumero}>{p.numero}</span>
        </span>
      }
      onCerrar={onCerrar}
      ancho={920}
      alto="88vh"
    >
      <div style={{ ...styles.franjaEstadoModal, background: colorEstadoDiseno.texto }} />
      <div style={styles.modalDosColumnas}>

        <div style={styles.modalColumna}>
          <div style={styles.estadoModalFila}>
            <Pastilla colores={{ bg: colorEstadoDiseno.fondo, color: colorEstadoDiseno.texto }}>
              {ETIQUETA_PEDIDO[p.estado] || p.estado}
            </Pastilla>
            <span style={styles.volumenModal}>{p.volumen} tn</span>
          </div>

          <div style={styles.modalGrid}>
            <Dato label="Cliente" valor={org ? org.razon_social : ''} />
            <Dato label="Producto" valor={prod ? prod.nombre : ''} />
            <Dato label="Tipo" valor={p.tipo} />
            <Dato label="Recipiente" valor={p.recipiente} />
            <Dato label="Banda horaria" valor={p.banda_horaria} />
            {varioPorEntrega ? (
              <Dato label="Destino" valor="Varía por entrega →" completo />
            ) : (
              <Dato label="Destino" valor={destinoUnico ? textoDomicilio(destinoUnico) : ''} completo />
            )}
          </div>

          {p.obs && <div style={styles.obsBox}>{p.obs}</div>}

          <div style={styles.progresoModalWrap}>
            <BarraProgresoPedido entregas={entregas} estado={p.estado} alto={8} />
          </div>

          <div style={styles.autoriaBox}>
            <div style={styles.autoriaLinea}>
              Creado por: {creadoPorNombre} · {formatoFechaTs(p.creado_en) || 'Sin registro'}
            </div>
            {/* Si no hay ningún registro de historial no derivado, el pedido
                nunca se editó -- no mostrar la línea es más claro que un
                "Sin registro" -- lo distingue de "hubo una edición pero sin
                autor identificado" (esa sí muestra la línea, con "Sin
                identificar"). */}
            {ultimaModificacion && (
              <div style={styles.autoriaLinea}>
                Última modificación: {ultimaModificacion.usuario_nombre || 'Sin identificar'}
                {' · '}{formatoFechaTs(ultimaModificacion.ts) || 'Sin registro'}
              </div>
            )}
          </div>

          <div style={styles.accionesColumna}>
            {esInternoUsuario && pedidoActivo && (
              <Boton
                variante="peligro"
                disabled={suspendiendo}
                style={{ width: '100%', borderColor: paleta.botonSuspender, color: paleta.botonSuspender }}
                onClick={handleSuspender}
              >
                {suspendiendo ? 'Suspendiendo...' : 'Suspender pedido'}
              </Boton>
            )}

            <Boton variante="secundario" style={{ width: '100%' }} onClick={onVerHistorial}>
              Ver historial
            </Boton>

            {/* 7. Acciones que el diseño no ubica -- ver el encabezado
                v1.2.0 de este archivo, punto 7: "Editar domicilio" del
                pedido (solo para tipos que NO son "Entrega al cliente", que
                llevan un domicilio único del lado del pedido) va acá, con el
                mismo estilo secundario que "Ver historial". */}
            {esInternoUsuario && pedidoActivo && !esEntregaAlCliente && (
              editandoDomicilio ? (
                <div style={styles.editWrap}>
                  <Campo
                    as="select" label="Nuevo domicilio de destino"
                    value={nuevoDomicilioElegido} onChange={e => setNuevoDomicilioElegido(e.target.value)}
                  >
                    <option value="">Elegir...</option>
                    {domiciliosCliente.map(d => (
                      <option key={d.id} value={d.id}>{d.alias ? `${d.alias} -- ` : ''}{textoDomicilio(d)}</option>
                    ))}
                  </Campo>
                  <div style={styles.avisoChico}>
                    No cancela los despachos vivos: se les actualiza la direccion y se
                    avisa al transportista y al chofer que todavia no arranco. Se
                    bloquea si algun chofer ya salio.
                  </div>
                  <div style={styles.accionesFila}>
                    <Boton disabled={guardandoDomicilio} onClick={confirmarNuevoDomicilio}>
                      {guardandoDomicilio ? 'Guardando...' : 'Guardar'}
                    </Boton>
                    <Boton variante="secundario" onClick={() => setEditandoDomicilio(false)}>Cancelar</Boton>
                  </div>
                </div>
              ) : (
                <Boton variante="secundario" style={{ width: '100%' }} onClick={() => setEditandoDomicilio(true)}>
                  Editar domicilio
                </Boton>
              )
            )}
          </div>
        </div>

        <div style={{ ...styles.modalColumna, ...styles.panelEntregas }}>
          <div style={styles.entregasTitulo}>Entregas</div>

          {entregas.map(e => {
            const puedeEditarFecha = esInternoUsuario && pedidoActivo && e.estado !== 'cumplida' && e.estado !== 'suspendida';
            const puedeSuspender = puedeEditarFecha && e.estado === 'pendiente';
            const puedeReactivar = esInternoUsuario && pedidoActivo && e.estado === 'suspendida';
            const puedeEditarDestino = puedeEditarFecha && esEntregaAlCliente;
            const destinoEntrega = esEntregaAlCliente
              ? domsPorId.get(e.destino_domicilio_id || p.destino_domicilio_id)
              : destinoPedido;

            const colorBordeEntrega = COLOR_ENTREGA[e.estado] || COLOR_ENTREGA.pendiente;
            const atenuada = e.estado === 'suspendida' || e.estado === 'cumplida';
            // v1.2.0 (rediseño Pedidos) -- el diseño pide "borde izquierdo
            // rojo de 5px" fijo en la tarjeta de entrega; se mantiene en
            // cambio el borde CON COLOR POR ESTADO que ya tenía esta
            // pantalla (cumplida/programada/pendiente/suspendida, ver
            // `COLOR_ENTREGA` más arriba) -- perderlo sería perder
            // funcionalidad (regla 9: distinguir de un vistazo el estado de
            // cada entrega), y no hay otro lugar en la tarjeta que lo
            // reemplace. Discrepancia informada en el reporte de la tarea.
            const avisoCalFecha = evaluarFechaEntrega(e.fecha_solicitada, calendarioDias, calendarioReglas);

            return (
              <div
                key={e.id}
                style={{
                  ...styles.entregaCard,
                  borderLeft: `5px solid ${colorBordeEntrega.borde}`,
                  opacity: atenuada ? 0.65 : 1,
                }}
              >
                <div style={styles.entregaHeader}>
                  <span style={styles.entregaNroChico}>#{e.numero}</span>
                  <span style={styles.entregaVol}>{e.volumen} tn</span>
                  <span style={styles.entregaFecha}>{formatoFechaLarga(e.fecha_solicitada)}</span>
                  <Pastilla chico colores={{ bg: colorBordeEntrega.fondo, color: colorBordeEntrega.texto }}>
                    {ETIQUETA_ENTREGA[e.estado] || e.estado}
                  </Pastilla>
                </div>

                <div style={styles.entregaDestino}>
                  {destinoEntrega ? textoDomicilio(destinoEntrega) : 'Sin domicilio cargado'}
                </div>

                {/* v1.2.0 (RF-10), sobre la fecha YA guardada (no solo al
                    editar): solo ADVIERTE, nunca bloquea. */}
                {avisoCalFecha.advierte && (
                  <div style={styles.avisoCalendario}>⚠ {avisoCalFecha.motivo}</div>
                )}

                {!atenuada && (
                  <div style={styles.entregaAcciones}>
                    {puedeEditarFecha && (
                      <Boton chico variante="secundario" style={{ borderColor: paleta.botonFecha, color: paleta.botonFecha }} onClick={() => abrirEdicionFecha(e)}>
                        Editar fecha
                      </Boton>
                    )}
                    {puedeEditarDestino && (
                      <Boton chico variante="secundario" style={{ borderColor: paleta.botonDireccion, color: paleta.botonDireccion }} onClick={() => abrirEdicionDestino(e)}>
                        Editar dirección
                      </Boton>
                    )}
                    {puedeSuspender && (
                      <Boton chico variante="secundario" disabled={suspendiendoEntregaId === e.id} onClick={() => suspenderEntregaSuelta(e)}>
                        {suspendiendoEntregaId === e.id ? 'Suspendiendo...' : 'Suspender'}
                      </Boton>
                    )}
                  </div>
                )}
                {puedeReactivar && (
                  <div style={styles.entregaAcciones}>
                    <Boton chico variante="secundario" disabled={reactivandoEntregaId === e.id} onClick={() => reactivar(e)}>
                      {reactivandoEntregaId === e.id ? 'Reactivando...' : 'Reactivar'}
                    </Boton>
                  </div>
                )}

                {editandoFechaId === e.id && (
                  <div style={styles.editWrap}>
                    <Campo
                      label={`Nueva fecha -- entrega ${e.numero}`} type="date" min={hoyISO()}
                      value={nuevaFecha} onChange={ev => setNuevaFecha(ev.target.value)}
                    />
                    <div style={styles.avisoChico}>
                      Si esta entrega ya tiene un despacho asignado, cambiar la fecha
                      lo cancela: vuelve a "Sin cubrir" y hay que programarla de nuevo.
                    </div>
                    {/* v1.2.0 (RF-10) -- advierte, no bloquea. */}
                    {evaluarFechaEntrega(nuevaFecha, calendarioDias, calendarioReglas).advierte && (
                      <div style={styles.avisoCalendario}>
                        ⚠ {evaluarFechaEntrega(nuevaFecha, calendarioDias, calendarioReglas).motivo}
                      </div>
                    )}
                    <div style={styles.accionesFila}>
                      <Boton disabled={guardandoFechaId === e.id} onClick={() => confirmarNuevaFecha(e)}>
                        {guardandoFechaId === e.id ? 'Guardando...' : 'Guardar'}
                      </Boton>
                      <Boton variante="secundario" onClick={() => setEditandoFechaId(null)}>Cancelar</Boton>
                    </div>
                  </div>
                )}

                {editandoDestinoId === e.id && (
                  <div style={styles.editWrap}>
                    <Campo
                      as="select" label={`Nuevo domicilio -- entrega ${e.numero}`}
                      value={nuevoDestinoEntrega} onChange={ev => setNuevoDestinoEntrega(ev.target.value)}
                    >
                      <option value="">Elegir...</option>
                      {domiciliosCliente.map(d => (
                        <option key={d.id} value={d.id}>{d.alias ? `${d.alias} -- ` : ''}{textoDomicilio(d)}</option>
                      ))}
                    </Campo>
                    <div style={styles.accionesFila}>
                      <Boton disabled={guardandoDestinoId === e.id} onClick={() => confirmarNuevoDestinoEntrega(e)}>
                        {guardandoDestinoId === e.id ? 'Guardando...' : 'Guardar'}
                      </Boton>
                      <Boton variante="secundario" onClick={() => setEditandoDestinoId(null)}>Cancelar</Boton>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {esInternoUsuario && pedidoActivo && (
            agregandoEntregas ? (
              <div style={styles.editWrap}>
                {limiteDeVolumenAlcanzado && (
                  <div style={styles.avisoChicoPeligro}>
                    Vas a superar el volumen de la orden ({p.volumen} tn). Confirma que ya
                    se aviso a los coordinadores para agrandarla.
                  </div>
                )}
                <div style={styles.label}>Entregas nuevas</div>
                {filasNuevas.map((fila, i) => {
                  // v1.2.0 (RF-10) -- advierte, no bloquea.
                  const avisoCalNueva = evaluarFechaEntrega(fila.fecha_solicitada, calendarioDias, calendarioReglas);
                  return (
                  <div key={i}>
                    <div style={styles.entregaFilaForm}>
                      <input
                        type="number" style={{ ...styles.inputChico, flex: 1 }} placeholder="Volumen (tn)"
                        value={fila.volumen} onChange={ev => cambiarFilaNueva(i, 'volumen', ev.target.value)}
                      />
                      <input
                        type="date" style={{ ...styles.inputChico, flex: 1 }} min={hoyISO()}
                        value={fila.fecha_solicitada} onChange={ev => cambiarFilaNueva(i, 'fecha_solicitada', ev.target.value)}
                      />
                      <button style={styles.btnQuitar} onClick={() => quitarFilaNueva(i)}>x</button>
                    </div>
                    {avisoCalNueva.advierte && (
                      <div style={styles.avisoCalendario}>⚠ {avisoCalNueva.motivo}</div>
                    )}
                  </div>
                  );
                })}
                <div style={styles.avisoChico}>
                  Se agregan como entregas nuevas -- nunca se aumenta el volumen de
                  una entrega existente. El volumen del pedido sube por la suma de estas.
                </div>
                <div style={styles.accionesFila}>
                  <Boton variante="secundario" onClick={agregarFilaNueva}>+ Otra entrega</Boton>
                  <Boton disabled={guardandoEntregasNuevas} onClick={confirmarEntregasNuevas}>
                    {guardandoEntregasNuevas ? 'Guardando...' : 'Agregar'}
                  </Boton>
                  <Boton variante="secundario" onClick={() => setAgregandoEntregas(false)}>Cancelar</Boton>
                </div>
              </div>
            ) : (
              // v1.2.0 (rediseño Pedidos) -- botón primario a ancho completo,
              // como pide el diseño. El texto "(supera la orden)" del
              // diseño se usa SOLO cuando la acción realmente agrega
              // volumen por encima de la orden (`limiteDeVolumenAlcanzado`,
              // misma condición que ya disparaba el aviso/confirmación de
              // v2 más arriba) -- si no, queda "+ Agregar entrega" a secas.
              <Boton
                onClick={abrirAgregarEntregas}
                style={{
                  width: '100%',
                  marginTop: espacio.sm,
                  ...(limiteDeVolumenAlcanzado ? { background: colorEstado.advertenciaBorde } : {}),
                }}
              >
                {limiteDeVolumenAlcanzado ? '+ Agregar entrega (supera la orden)' : '+ Agregar entrega'}
              </Boton>
            )
          )}
        </div>
      </div>
    </Modal>
  );
}

function VistaCrear({
  form, setForm, config, errores, guardando, clientes, productosActivos, domiciliosDelCliente,
  domicilioPlanta, domsPorId, sumaEntregas, calendarioDias, calendarioReglas,
  onCambiarCliente, onAgregarEntrega, onQuitarEntrega, onCambiarEntrega, onRepartirVolumen,
  onGuardar, onCancelar,
  modalOrg, setModalOrg, modalDomicilio, setModalDomicilio, organizaciones, domicilios, usuario,
}) {
  const styles = useEstilos();
  const puedeElegirDomicilio = !!form.cliente_org_id;
  const domicilioElegido = domsPorId.get(form.domicilio_cliente_id);
  const etiquetaDomicilio = config.destino === 'cliente' ? 'Domicilio de entrega' : 'Domicilio de origen';

  return (
    <div style={styles.wrap}>
      <div style={styles.panelHeader}>
        <div style={styles.titulo}>Nuevo pedido</div>
        <Boton variante="secundario" onClick={onCancelar}>Cancelar</Boton>
      </div>

      {errores.length > 0 && (
        <div style={styles.bannerError}>{errores.map((e, i) => <div key={i}>{e}</div>)}</div>
      )}

      <Tarjeta style={{ padding: '1.5rem' }}>
        <div style={styles.seccion}>
          <div style={styles.seccionTitulo}>Que y para quien</div>
          <div style={styles.grid2}>
            <div style={styles.formField}>
              <label style={styles.label}>Cliente *</label>
              <BuscadorOrganizacion
                organizaciones={clientes}
                valor={form.cliente_org_id}
                onElegir={onCambiarCliente}
                onCrear={(texto) => setModalOrg({ nombreInicial: texto })}
                placeholder="Escribi para buscar..."
                etiquetaCrear="+ Crear cliente"
              />
            </div>

            <Campo
              as="select" label="Producto *" value={form.producto_id}
              onChange={e => setForm({ ...form, producto_id: e.target.value })}
            >
              <option value="">Elegir...</option>
              {productosActivos.map(p => (
                <option key={p.id} value={p.id}>
                  {p.nombre}{p.es_generico ? ' -- no va al Plan de Produccion' : ''}
                </option>
              ))}
            </Campo>

            <Campo
              label="Volumen total * (tn)" type="number" value={form.volumen} placeholder="20"
              onChange={e => setForm({ ...form, volumen: e.target.value })}
            />

            <Campo
              as="select" label="Recipiente" value={form.recipiente}
              onChange={e => setForm({ ...form, recipiente: e.target.value })}
            >
              {RECIPIENTES.map(r => <option key={r} value={r}>{r}</option>)}
            </Campo>

            <div style={styles.formField}>
              <label style={styles.label}>Orden *</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <select
                  style={{ ...styles.input, width: 80 }} value={form.ov_tipo}
                  onChange={e => setForm({ ...form, ov_tipo: e.target.value })}
                >
                  <option value="OV">OV</option>
                  <option value="OC">OC</option>
                </select>
                <input
                  style={styles.input} value={form.ov_numero}
                  onChange={e => setForm({ ...form, ov_numero: e.target.value })}
                  placeholder={form.ov_tipo === 'OV' ? '1126' : '11260'}
                />
              </div>
              <span style={styles.ayuda}>{form.ov_tipo === 'OV' ? '4 digitos.' : '5 digitos.'}</span>
            </div>
          </div>
        </div>

        <div style={styles.seccion}>
          <div style={styles.seccionTitulo}>Donde</div>
          <div style={styles.grid2}>
            <Campo
              as="select" label="Tipo de operacion *" value={form.tipo}
              onChange={e => setForm({ ...form, tipo: e.target.value })}
            >
              {Object.keys(TIPOS).map(t => <option key={t} value={t}>{t}</option>)}
            </Campo>

            <div style={styles.formField}>
              <label style={styles.label}>{etiquetaDomicilio} *</label>
              <select
                style={styles.input} value={form.domicilio_cliente_id} disabled={!puedeElegirDomicilio}
                onChange={e => setForm({ ...form, domicilio_cliente_id: e.target.value })}
              >
                <option value="">{puedeElegirDomicilio ? 'Elegir...' : 'Elegi primero el cliente'}</option>
                {domiciliosDelCliente.map(d => (
                  <option key={d.id} value={d.id}>{textoDomicilio(d)}{d.alias ? ` - ${d.alias}` : ''}</option>
                ))}
              </select>
              {puedeElegirDomicilio && (
                <button type="button" style={styles.btnAgregarDireccion} onClick={() => setModalDomicilio(true)}>
                  {domiciliosDelCliente.length === 0 ? '+ Este cliente no tiene direcciones. Agregar una' : '+ Agregar otra direccion'}
                </button>
              )}
            </div>

            <div style={styles.formField}>
              <label style={styles.label}>{config.origen === 'propia' ? 'Sale de' : 'Llega a'}</label>
              <div style={styles.valorFijo}>
                {domicilioPlanta ? textoDomicilio(domicilioPlanta) : 'Falta cargar el domicilio de la planta'}
              </div>
              <span style={styles.ayuda}>La planta de Explora. Sale del domicilio principal de la organizacion propia.</span>
            </div>

            <Campo
              as="select" label="Banda horaria" value={form.banda_horaria}
              onChange={e => setForm({ ...form, banda_horaria: e.target.value })}
            >
              {BANDAS_HORARIAS.map(b => <option key={b} value={b}>{b}</option>)}
            </Campo>
          </div>
        </div>

        <div style={styles.seccion}>
          <div style={styles.seccionTitulo}>Entregas</div>
          <div style={styles.instruccion}>
            Cuantos camiones y para cuando. Si es una sola entrega, carga una con el volumen total.
          </div>

          {form.entregas.map((e, i) => {
            // v1.2.0 (RF-10) -- solo ADVIERTE, nunca bloquea el guardado
            // (a diferencia de la fecha de carga en Programación).
            const avisoCalendario = evaluarFechaEntrega(e.fecha_solicitada, calendarioDias, calendarioReglas);
            return (
            <div key={i} style={styles.entregaBloque}>
              <div style={styles.entregaFila}>
                <span style={styles.entregaNro}>{i + 1}</span>
                <input
                  style={{ ...styles.input, flex: 1 }} type="number" value={e.volumen}
                  onChange={ev => onCambiarEntrega(i, 'volumen', ev.target.value)} placeholder="Volumen (tn)"
                />
                <input
                  style={{ ...styles.input, flex: 1 }} type="date" min={hoyISO()} value={e.fecha_solicitada}
                  onChange={ev => onCambiarEntrega(i, 'fecha_solicitada', ev.target.value)}
                />
                <button
                  style={styles.btnQuitar} disabled={form.entregas.length === 1} onClick={() => onQuitarEntrega(i)}
                  title={form.entregas.length === 1 ? 'Tiene que haber al menos una' : 'Quitar'}
                >
                  x
                </button>
              </div>

              {avisoCalendario.advierte && (
                <div style={styles.avisoCalendario}>⚠ {avisoCalendario.motivo}</div>
              )}

              {config.destino === 'cliente' && puedeElegirDomicilio && (
                <div style={styles.entregaDomicilioFila}>
                  <span style={styles.entregaDomicilioIcono}>-</span>
                  <select
                    style={{ ...styles.input, flex: 1, fontSize: 12 }} value={e.destino_domicilio_id || ''}
                    onChange={ev => onCambiarEntrega(i, 'destino_domicilio_id', ev.target.value)}
                  >
                    <option value="">
                      Mismo domicilio que arriba{domicilioElegido ? ` (${textoDomicilio(domicilioElegido)})` : ''}
                    </option>
                    {domiciliosDelCliente.map(d => (
                      <option key={d.id} value={d.id}>{textoDomicilio(d)}{d.alias ? ` - ${d.alias}` : ''}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            );
          })}

          <div style={styles.entregasPie}>
            <div style={{ display: 'flex', gap: 8 }}>
              <Boton variante="secundario" onClick={onAgregarEntrega}>+ Otra entrega</Boton>
              <Boton variante="secundario" disabled={!form.volumen} onClick={onRepartirVolumen}>
                Repartir en partes iguales
              </Boton>
            </div>
            <span style={{
              ...styles.suma,
              color: !form.volumen || Math.abs(sumaEntregas - Number(form.volumen)) < 0.001
                ? colorEstado.exitoTexto : colorEstado.peligroTexto,
            }}>
              Suman {sumaEntregas} tn{form.volumen ? ` de ${form.volumen} tn` : ''}
            </span>
          </div>
        </div>

        <Campo
          as="textarea" label="Observaciones" value={form.obs} style={{ minHeight: 60, resize: 'vertical' }}
          onChange={e => setForm({ ...form, obs: e.target.value })}
        />

        <div style={styles.accionesFila}>
          <Boton disabled={guardando} onClick={onGuardar}>{guardando ? 'Guardando...' : 'Crear pedido'}</Boton>
          <Boton variante="secundario" onClick={onCancelar}>Cancelar</Boton>
        </div>
      </Tarjeta>

      {modalOrg && (
        <ModalOrganizacion
          usuario={usuario} organizaciones={organizaciones} domicilios={domicilios}
          nombreInicial={modalOrg.nombreInicial} onCancelar={() => setModalOrg(null)}
          onCreada={(orgId, domicilioId) => {
            setModalOrg(null);
            setForm(f => ({ ...f, cliente_org_id: orgId, domicilio_cliente_id: domicilioId || '' }));
          }}
        />
      )}

      {modalDomicilio && (
        <ModalDomicilio
          usuario={usuario} organizacionId={form.cliente_org_id}
          organizacionNombre={(clientes.find(c => c.id === form.cliente_org_id) || {}).razon_social || ''}
          domicilios={domicilios} yaVinculados={new Set(domiciliosDelCliente.map(d => d.id))}
          onCancelar={() => setModalDomicilio(false)}
          onCreado={(domicilioId) => { setModalDomicilio(false); setForm(f => ({ ...f, domicilio_cliente_id: domicilioId })); }}
        />
      )}
    </div>
  );
}

function VistaMasiva({
  interpretados, nombreArchivo, errorArchivo, progreso, guardando, hayErrores, hayResueltosPorParecido,
  onElegirArchivo, onOtroArchivo, onConfirmar, onCerrar,
}) {
  const styles = useEstilos();
  // Paso 1: bajar la plantilla y completarla afuera del portal.
  // Paso 2: elegir esa planilla ya completa y subirla.
  // Una vez que se sube y se interpreta (interpretados.length > 0) pasamos
  // directo a la pantalla de previsualizacion, mas abajo.
  const [paso, setPaso] = useState('descargar');

  return (
    <div style={styles.wrap}>
      <div style={styles.panelHeader}>
        <div style={styles.titulo}>Carga masiva</div>
        <Boton variante="secundario" onClick={onCerrar}>Volver</Boton>
      </div>

      {progreso && progreso.hechos === progreso.total && (
        <div style={progreso.fallidos.length ? styles.bannerError : styles.bannerOk}>
          <div style={{ fontWeight: tipografia.peso.medio, marginBottom: 6 }}>
            {progreso.creados.length} pedido(s) creado(s)
            {progreso.fallidos.length > 0 && `, ${progreso.fallidos.length} con error`}
          </div>
          {progreso.creados.map(c => <div key={c.clave} style={styles.resultadoItem}>{c.clave} -&gt; {c.numero}</div>)}
          {progreso.fallidos.map(f => <div key={f.clave} style={styles.resultadoItem}>{f.clave} -&gt; {f.motivo}</div>)}
          <Boton variante="secundario" style={{ marginTop: 10 }} onClick={onCerrar}>Listo</Boton>
        </div>
      )}

      {!progreso && interpretados.length === 0 && (
        <>
          <div style={styles.pasosIndicador}>
            <PasoIndicador numero={1} label="Descargar planilla" activo={paso === 'descargar'} hecho={paso === 'subir'} />
            <div style={styles.pasosLinea} />
            <PasoIndicador numero={2} label="Subir planilla" activo={paso === 'subir'} hecho={false} />
          </div>

          {paso === 'descargar' && (
            <Tarjeta style={{ padding: '1.5rem' }}>
              <div style={styles.seccionTitulo}>Paso 1 de 2 -- Descargar la planilla</div>
              <div style={styles.instruccion}>
                Descargate esta planilla de Excel y completala con los pedidos. Se leen
                las filas desde la 5 en adelante, y las que comparten numero de orden se
                agrupan como un solo pedido con varias entregas.
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                <Boton onClick={() => window.open('/plantilla_pedidos_explora.xlsx', '_blank')}>
                  Descargar plantilla
                </Boton>
              </div>

              <div style={styles.aclaracion}>
                El cliente, el producto y la direccion se buscan entre los que ya estan
                cargados en el portal. Se toleran diferencias de escritura -- en el
                proximo paso vas a ver exactamente que resolvio cada fila antes de que
                se cree nada.
              </div>

              <div style={styles.accionesFila}>
                <Boton onClick={() => setPaso('subir')}>Ya la complete, continuar</Boton>
              </div>
            </Tarjeta>
          )}

          {paso === 'subir' && (
            <Tarjeta style={{ padding: '1.5rem' }}>
              <div style={styles.seccionTitulo}>Paso 2 de 2 -- Subir la planilla completa</div>
              <div style={styles.instruccion}>
                Elegi el archivo que acabas de completar. Antes de crear ningun pedido
                vas a poder revisar como se interpreto cada fila.
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                <label style={styles.btnPrimaryLabel}>
                  Elegir archivo
                  <input
                    type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
                    onChange={e => e.target.files[0] && onElegirArchivo(e.target.files[0])}
                  />
                </label>
                <Boton variante="secundario" onClick={() => setPaso('descargar')}>Volver al paso 1</Boton>
              </div>

              {errorArchivo && <div style={styles.bannerError}>{errorArchivo}</div>}
            </Tarjeta>
          )}
        </>
      )}

      {!progreso && interpretados.length > 0 && (
        <>
          <div style={styles.resumenMasiva}>
            <span><strong>{nombreArchivo}</strong> - {interpretados.length} pedido(s)</span>
            <button style={styles.btnLink} onClick={onOtroArchivo}>Elegir otro archivo</button>
          </div>

          {hayErrores && (
            <div style={styles.bannerError}>
              Hay pedidos con errores. Corregi la planilla y volve a subirla: no se
              crea ninguno hasta que esten todos bien.
            </div>
          )}

          {!hayErrores && hayResueltosPorParecido && (
            <div style={styles.bannerAviso}>
              Algunas filas se resolvieron por parecido, no por coincidencia exacta.
              Estan marcadas abajo -- revisalas antes de confirmar.
            </div>
          )}

          {interpretados.map(x => {
            const conError = x.errores.length > 0;
            return (
              <Tarjeta key={x.clave} style={{ padding: '10px 14px', marginBottom: 8, borderColor: conError ? colorEstado.peligroBordeAlterno : undefined }}>
                <div style={styles.cardMasivaHeader}>
                  <span style={styles.masivaClave}>{x.clave}</span>
                  <span style={styles.masivaFilas}>fila{x.numerosFila.length > 1 ? 's' : ''} {x.numerosFila.join(', ')}</span>
                  <span style={styles.masivaEntregas}>{x.entregas.length} entrega{x.entregas.length > 1 ? 's' : ''} - {x.pedido.volumen} tn</span>
                </div>

                <div style={styles.resueltoGrid}>
                  <Resuelto etiqueta="Cliente" dato={x.resuelto.cliente} />
                  <Resuelto etiqueta="Producto" dato={x.resuelto.producto} />
                  <Resuelto etiqueta="Domicilio" dato={x.resuelto.domicilio} />
                </div>

                {conError && (
                  <ul style={styles.erroresLista}>{x.errores.map((e, i) => <li key={i}>{e}</li>)}</ul>
                )}

                {/* v1.2.0 (RF-10) -- advertencia de calendario: NO es un
                    error, la fila se carga igual. Separada de `erroresLista`
                    a propósito -- ver el encabezado de `carga-masiva.js`. */}
                {(x.advertencias || []).length > 0 && (
                  <ul style={styles.advertenciasLista}>{x.advertencias.map((a, i) => <li key={i}>⚠ {a}</li>)}</ul>
                )}
              </Tarjeta>
            );
          })}

          <div style={{ ...styles.accionesFila, marginTop: 16 }}>
            <Boton disabled={guardando || hayErrores} onClick={onConfirmar}>
              {guardando ? `Creando ${progreso ? progreso.hechos : 0} de ${interpretados.length}...` : `Crear ${interpretados.length} pedido(s)`}
            </Boton>
            <Boton variante="secundario" disabled={guardando} onClick={onCerrar}>Cancelar</Boton>
          </div>
        </>
      )}
    </div>
  );
}

// v1.2.0 (rediseño Pedidos) -- `completo` ahora también ocupa el ancho
// entero de la grilla (`gridColumn: '1 / -1'`), como pide el diseño para
// "Destino" -- antes solo cambiaba si se mostraba "Sin dato" o no.
function Dato({ label, valor, completo }) {
  const styles = useEstilos();
  const tieneValor = completo || (valor !== undefined && valor !== null && valor !== '');
  return (
    <div style={{ ...styles.field, ...(completo ? { gridColumn: '1 / -1' } : {}) }}>
      <span style={styles.labelGrilla}>{label}</span>
      <span style={tieneValor ? styles.valorCompleto : styles.valorVacio}>
        {tieneValor ? valor : 'Sin dato'}
      </span>
    </div>
  );
}

function Resuelto({ etiqueta, dato }) {
  const styles = useEstilos();
  const { colores } = useTema();
  if (!dato) return null;
  const estado = !dato.encontrado && !dato.omitido ? 'falta' : dato.exacto ? 'exacto' : 'parecido';
  // Renombrado a "estiloEstado" -- "colores" ya es el del tema (useTema),
  // no hay que taparlo con este mapa chico de 3 casos.
  const estiloEstado = {
    exacto:   { color: colores.textoSuave, marca: '' },
    parecido: { color: colorEstado.advertenciaTexto, marca: '~' },
    falta:    { color: colorEstado.peligroTexto, marca: 'x' },
  }[estado];

  return (
    <div style={styles.resuelto}>
      <span style={styles.resueltoEtiqueta}>{etiqueta}</span>
      <span style={styles.resueltoTexto}>{dato.texto || '-'}</span>
      <span style={{ ...styles.resueltoFlecha, color: estiloEstado.color }}>{estiloEstado.marca} -&gt;</span>
      <span style={{ ...styles.resueltoValor, color: estiloEstado.color }}>
        {dato.omitido ? 'la planta de Explora' : (dato.encontrado || 'sin resolver')}
      </span>
    </div>
  );
}

function crearEstilos(colores, oscuro) {
  // v1.2.0 (rediseño Pedidos) -- paleta cálida del diseño "Portal Pedidos",
  // ver el encabezado de `shared/tokens.js`.
  const paleta = paletaPedidos(oscuro);

  return {
    wrap: { maxWidth: 1100, margin: '0 auto', padding: '1.5rem 1rem', background: paleta.fondo, color: paleta.texto },
    panelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' },
    titulo: { fontSize: 18, fontWeight: 500, color: paleta.textoFuerte },

    // Paso 1 -- avisos clickeables: extraídos a `ui/AvisoClickeable.js`
    // (`FranjaAvisos`/`AvisoClickeable`/`AvisoNeutro`), con los mismos
    // estilos que tenía esta franja acá.

    // Paso 2 -- franja superior (Mis/Todos + Tarjetas/Tabla): el segmentado
    // en sí se extrajo a `ui/Segmentado.js` (mismos `toggleVista`/
    // `toggleBtn`/`toggleBtnActivo` de siempre); `controlesFila` se queda
    // acá porque es el layout propio de esta pantalla (fondo/borde/radio del
    // panel, mismo lenguaje visual que `ui/BarraFiltros.js`, pegada justo
    // encima).
    controlesFila: {
      display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center', justifyContent: 'space-between',
      background: paleta.superficie, border: `1px solid ${paleta.borde}`, borderRadius: radioPedidos.panel,
      padding: `${espacio.sm}px ${espacio.md}px`,
    },
    buscador: { flex: '2 1 220px', fontSize: 13, padding: '8px 12px', borderRadius: 8, border: `0.5px solid ${colores.borde}`, color: colores.texto, background: colores.superficie },
    selectOrden: { flex: '1 1 180px', fontSize: 12, padding: '8px 10px', borderRadius: 8, border: `0.5px solid ${colores.borde}`, color: colores.textoSecundario, background: colores.superficie },

    pastillasGrupo: { display: 'flex', gap: 6, flexWrap: 'wrap' },

    progresoWrap: { display: 'flex', alignItems: 'center', gap: 8 },
    progresoBarra: { flex: 1, height: 6, borderRadius: 4, overflow: 'hidden', display: 'flex', background: paleta.separador },
    progresoTexto: { fontSize: 11, color: paleta.textoTenue, flexShrink: 0, fontVariantNumeric: 'tabular-nums' },
    progresoModalWrap: { margin: '14px 0' },

    // Paso 3 -- fila de la lista (vista Tarjetas). Orden: badge / cliente /
    // producto / cantidad / progreso / chip de orden.
    filaPedido: {
      display: 'flex', alignItems: 'center', gap: espacio.lg, padding: '14px 20px',
      borderRadius: radioPedidos.fila, marginBottom: espacio.sm, background: paleta.superficie,
      cursor: 'pointer', transition: 'box-shadow 0.15s',
    },
    filaBadge: { width: 130, flexShrink: 0 },
    filaCliente: { fontSize: tipografia.tamano.xl, fontWeight: tipografia.peso.negrita, color: paleta.textoFuerte, flex: '1.4 1 140px', minWidth: 110 },
    filaProducto: { fontSize: tipografia.tamano.md, color: paleta.textoSecundario, flex: '1 1 100px', minWidth: 80 },
    filaVolumen: { fontSize: tipografia.tamano.md, color: paleta.texto, flexShrink: 0, minWidth: 56 },
    filaProgresoWrap: { width: 120, flexShrink: 0 },
    filaOvChip: {
      fontSize: tipografia.tamano.sm, fontWeight: tipografia.peso.negrita, color: paleta.textoFuerte,
      background: paleta.fondo, borderRadius: radio.md, padding: '5px 12px', textAlign: 'center',
      flexShrink: 0, minWidth: 84, fontFamily: 'monospace',
    },

    modalDosColumnas: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 },
    modalColumna: { display: 'flex', flexDirection: 'column' },
    // Paso 4 -- grilla de datos: etiqueta en mayúsculas chicas, valor en
    // negrita (ver `Dato`, más abajo en este archivo).
    modalGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 10 },
    field: { display: 'flex', flexDirection: 'column', gap: 3 },
    label: { fontSize: 11, color: colores.textoTenue },
    labelGrilla: { fontSize: tipografia.tamano.xs, color: paleta.textoTenue, textTransform: 'uppercase', letterSpacing: '0.05em' },
    valor: { fontSize: 13, color: colores.texto },
    tituloModalWrap: { display: 'flex', alignItems: 'baseline', gap: 8 },
    tituloModalNumero: { fontSize: tipografia.tamano.sm, color: colores.textoTenue, fontWeight: tipografia.peso.normal, fontFamily: 'monospace' },
    obsBox: { fontSize: 12, color: colores.textoSuave, padding: '8px 10px', background: colores.fondoAlterno, borderRadius: 8, marginBottom: 10 },
    autoriaBox: { display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 4 },
    autoriaLinea: { fontSize: 11, color: colores.textoTenue },
    accionesColumna: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 },

    // Panel "Entregas" -- columna derecha del modal, paleta cálida propia.
    panelEntregas: {
      background: paleta.panelEntregas.fondo, border: `1px solid ${paleta.panelEntregas.borde}`,
      borderRadius: radio.lg, padding: espacio.md,
    },
    entregasTitulo: {
      fontSize: 11, color: paleta.panelEntregas.titulo, textTransform: 'uppercase',
      letterSpacing: '0.05em', marginBottom: 8, fontWeight: tipografia.peso.negrita,
    },
    entregaCard: { border: `0.5px solid ${colores.borde}`, background: colores.superficie, borderRadius: 10, padding: '10px 12px', marginBottom: 8 },
    entregaHeader: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 },
    entregaNroChico: { color: colores.textoTenue, width: 24, fontFamily: 'monospace', fontSize: 12 },
    entregaVol: { color: colores.texto, fontSize: 12, fontWeight: tipografia.peso.negrita, width: 60 },
    entregaFecha: { color: colores.textoSuave, fontSize: 12 },
    entregaDestino: { fontSize: 11, color: colores.textoSuave, marginBottom: 6 },
    entregaAcciones: { display: 'flex', gap: 6, flexWrap: 'wrap' },

    editWrap: { marginTop: 10, padding: 12, background: colores.fondoAlterno, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 8 },
    avisoChico: { fontSize: 11, color: colorEstado.advertenciaTexto, lineHeight: 1.4 },
    accionesFila: { display: 'flex', gap: 8 },

    entregaFilaForm: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 },
    inputChico: { fontSize: 12, padding: '7px 9px', borderRadius: 8, border: `0.5px solid ${colores.borde}`, color: colores.texto, background: colores.superficie },
    btnQuitar: { width: 30, height: 34, borderRadius: 8, border: `0.5px solid ${colores.borde}`, background: colores.superficie, color: colores.textoTenue, fontSize: 16, cursor: 'pointer', flexShrink: 0 },

    seccion: { marginBottom: '1.5rem' },
    seccionTitulo: { fontSize: 12, fontWeight: 500, color: colores.textoTenue, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, paddingBottom: 6, borderBottom: `0.5px solid ${colores.borde}` },
    instruccion: { fontSize: 12, color: colores.textoSuave, marginBottom: 10, lineHeight: 1.5 },
    grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 },
    formField: { display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 },
    input: { fontSize: 13, padding: '8px 10px', borderRadius: 8, border: `0.5px solid ${colores.borde}`, color: colores.texto, background: colores.superficie, width: '100%', boxSizing: 'border-box' },
    valorFijo: { fontSize: 13, padding: '8px 10px', borderRadius: 8, background: colores.fondoAlterno, border: `0.5px solid ${colores.borde}`, color: colores.textoSuave },
    ayuda: { fontSize: 11, color: colores.textoTenue, lineHeight: 1.4 },
    btnAgregarDireccion: { border: 'none', background: 'none', color: marca, fontSize: 11, cursor: 'pointer', padding: 0, textAlign: 'left' },

    entregaFila: { display: 'flex', alignItems: 'center', gap: 8 },
    entregaBloque: { marginBottom: 8 },
    entregaDomicilioFila: { display: 'flex', alignItems: 'center', gap: 6, marginLeft: 26, marginTop: 4, marginBottom: 4 },
    entregaDomicilioIcono: { fontSize: 11, flexShrink: 0 },
    entregaNro: { fontSize: 12, color: colores.textoTenue, width: 18, fontFamily: 'monospace', flexShrink: 0 },
    // v1.2.0 (RF-10) -- aviso de calendario bajo la fecha de una entrega:
    // mismo color que `bannerAviso`, pero chico e inline (no un banner de
    // ancho completo, uno por entrega sería demasiado ruido).
    avisoCalendario: { fontSize: 11, color: colorEstado.advertenciaTexto, marginLeft: 26, marginBottom: 4 },
    entregasPie: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10, flexWrap: 'wrap' },
    suma: { fontSize: 12, fontWeight: 500 },

    // Los cuatro banners de abajo son semanticos (error/ok/aviso) -- fijos
    // en los dos temas a proposito, mismo criterio que colorEstado.
    bannerError: { padding: '10px 14px', borderRadius: 8, background: colorEstado.peligroFondo, border: `0.5px solid ${colorEstado.peligroBordeAlterno}`, fontSize: 13, color: colorEstado.peligroTexto, marginBottom: 12, whiteSpace: 'pre-line' },
    bannerOk: { padding: '10px 14px', borderRadius: 8, background: colorEstado.exitoFondo, border: `0.5px solid ${colorEstado.exitoBorde}`, fontSize: 13, color: colorEstado.exitoTexto, marginBottom: 12 },
    bannerAviso: { padding: '10px 14px', borderRadius: 8, background: colorEstado.advertenciaFondo, border: `0.5px solid ${colorEstado.advertenciaBorde}`, fontSize: 13, color: colorEstado.advertenciaTexto, marginBottom: 12 },
    btnPrimaryLabel: { display: 'inline-block', padding: '8px 16px', borderRadius: 8, background: marca, color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
    btnLink: { border: 'none', background: 'none', color: marca, fontSize: 12, cursor: 'pointer', padding: 0 },
    aclaracion: { fontSize: 12, color: colores.textoSuave, lineHeight: 1.6, padding: '10px 12px', background: colores.fondoAlterno, borderRadius: 8 },
    resumenMasiva: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 13, color: colores.textoSecundario, marginBottom: 12, flexWrap: 'wrap' },
    cardMasivaHeader: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' },
    masivaClave: { fontSize: 13, fontWeight: 500, color: colores.texto, fontFamily: 'monospace' },
    masivaFilas: { fontSize: 11, color: colores.textoTenue },
    masivaEntregas: { fontSize: 11, color: colores.textoSuave, marginLeft: 'auto' },
    resueltoGrid: { display: 'flex', flexDirection: 'column', gap: 3 },
    resuelto: { display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 12, flexWrap: 'wrap' },
    resueltoEtiqueta: { color: colores.textoTenue, width: 66, flexShrink: 0 },
    resueltoTexto: { color: colores.textoSuave },
    resueltoFlecha: { flexShrink: 0 },
    resueltoValor: { fontWeight: 500 },
    erroresLista: { margin: '8px 0 0 16px', padding: 0, fontSize: 12, color: colorEstado.peligroTexto },
    // v1.2.0 (RF-10)
    advertenciasLista: { margin: '8px 0 0 16px', padding: 0, fontSize: 12, color: colorEstado.advertenciaTexto },
    resultadoItem: { fontSize: 12, fontFamily: 'monospace', marginBottom: 2 },

    /* --- Rediseno v2: contraste de pastillas y campos --- */
    franjaEstadoModal: { height: 4, borderRadius: '10px 10px 0 0', margin: '-1.5rem -1.5rem 1rem' },
    estadoModalFila: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
    volumenModal: { fontSize: 15, fontWeight: tipografia.peso.negrita, color: colores.texto },
    valorCompleto: { fontSize: 13, color: paleta.textoFuerte, fontWeight: tipografia.peso.negrita },
    valorVacio: { fontSize: 13, color: colores.textoTenue, fontStyle: 'italic' },

    /* --- Aviso de limite de volumen al agregar entregas (fijo, semantico) --- */
    avisoLimiteVolumen: {
      fontSize: 12, color: colorEstado.advertenciaTexto, background: colorEstado.advertenciaFondo,
      border: `0.5px solid ${colorEstado.advertenciaBorde}`, borderRadius: 8, padding: '8px 10px', marginBottom: 8,
    },
    avisoChicoPeligro: { fontSize: 11, color: colorEstado.peligroTexto, lineHeight: 1.4, fontWeight: tipografia.peso.medio },
    btnAcentoAdvertencia: { borderColor: colorEstado.advertenciaBorde, color: colorEstado.advertenciaTexto },

    /* --- Editar fecha / Editar direccion: acentos propios, fijos en los dos temas --- */
    btnEditarFecha: { borderColor: '#3B82F6', color: '#3B82F6' },
    btnEditarDireccion: { borderColor: '#7C3AED', color: '#7C3AED' },

    /* --- Wizard de carga masiva (2 pasos) --- */
    pasosIndicador: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 },
    pasosLinea: { flex: '0 0 32px', height: 1, background: colores.borde },
    pasoItem: { display: 'flex', alignItems: 'center', gap: 8 },
    pasoNumero: {
      width: 24, height: 24, borderRadius: '50%', border: '1.5px solid', display: 'flex',
      alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: tipografia.peso.negrita, flexShrink: 0,
    },
    pasoLabel: { fontSize: 12 },
  };
}

/**
 * Mismo patron que ya usan Tarjeta/Boton/Campo/Buscador/Pastilla/Vacio/Pie:
 * cada componente de este archivo llama a este hook y listo, sin que nadie
 * tenga que pasar `colores` a mano de padre a hijo. `useMemo` evita rearmar
 * el objeto entero en cada render si el tema no cambio.
 */
function useEstilos() {
  const { colores, oscuro } = useTema();
  return useMemo(() => crearEstilos(colores, oscuro), [colores, oscuro]);
}
