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
 * REDISENO -- MISMO PATRON QUE Pedidos.js
 * -----------------------------------------------------------------------------
 *   ANTES: una lista plana con acordeon -- clickear un pedido lo expandia en
 *   el lugar, mezclando la fila de la lista con todo su detalle.
 *
 *   AHORA: clickear un pedido abre un MODAL -- datos del pedido a la
 *   izquierda (tipo, recipiente, producto, cliente, OV/OC, banda horaria,
 *   volumen total), entregas a la derecha. Ninguna funcion de
 *   logica-despachos.js/logica-viajes.js cambio de comportamiento: lo que
 *   cambio es como se llega a cada accion, no que hace la accion.
 *
 *   LA LISTA se filtra con pastillas de estado (mismo patron que Pedidos.js),
 *   ademas del buscador y el toggle "solo sin cubrir" que ya existia.
 *
 *   CADA ENTREGA, adentro del modal, muestra dia de la semana + fecha y la
 *   banda horaria del pedido como contexto (la entrega en si no tiene una
 *   hora propia -- eso lo define el despacho, con su propio horario_carga),
 *   y el volumen ("la carga que se le indica"). Si esta sin cubrir, el
 *   formulario para crear el despacho queda siempre visible ahi mismo (fecha
 *   de carga, horario, y el selector de transportista) en vez de esconderse
 *   detras de un boton "Programar".
 *
 *   SELECTOR DE TRANSPORTISTA: reemplaza a BuscadorOrganizacion para este
 *   campo puntual por components de chips con un avatar de iniciales (color
 *   sacado de los acentos que ya existen en tokens.js, ninguno nuevo) --
 *   ver SelectorTransportista() mas abajo.
 *
 *   SE FUE EL TOPBAR PROPIO: igual que en Pedidos.js, BarraSuperior.js ya
 *   cubre logo + volver a inicio para todo el portal.
 *
 *   MIGRADO A TemaContext/tokens.js desde el arranque (la leccion de
 *   Pedidos.js): `styles` es `crearEstilos(colores)` + el hook
 *   `useEstilos()`, no un objeto fijo.
 * ========================================================================== */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { motivoSinAcceso } from '../sesion';
import { claveNormalizada } from '../mapa-normalizacion';
import { textoDomicilio } from '../buscar-domicilios';
import { hoyISO } from '../logica-pedidos';
import {
  DESPACHO, VIAJE, ETIQUETA_DESPACHO, COLOR_DESPACHO,
  ETIQUETA_ENTREGA, ETIQUETA_PEDIDO, COLOR_PEDIDO,
  despachoVivo, entregaSinCubrir, estadoPedido,
  puedeAsignar, puedeReasignar, puedeEditar, puedeCancelar,
} from '../estados';
import {
  aceptarEntrega, asignarTransportista, editarDespacho, cancelarDespacho,
  correosDeOrganizacion, llamarAppsScript,
} from '../logica-despachos';
import { finalizarViaje } from '../logica-viajes';
import HistorialPedido from './HistorialPedido';
import { marca, marcaHover, colorEstado, espacio, radio, tipografia } from '../ui/tokens';
import { useTema } from '../ui/TemaContext';
import Boton from '../ui/Boton';
import Tarjeta from '../ui/Tarjeta';
import Pastilla from '../ui/Pastilla';
import Campo from '../ui/Campo';
import Modal from '../ui/Modal';
import Vacio from '../ui/Vacio';

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzXOlu0PUTAVubDJCXh7WxjZp1ruCH5SMu9YmWbFCNF2ff7l5mn447nV8BIWbQ5-Mz-uQ/exec';

// Los cumplidos y suspendidos no se programan (regla de negocio existente,
// ver el filtro de `visibles` mas abajo) -- por eso las pastillas de estado
// de esta pantalla son un subconjunto de las de Pedidos.js.
const GRUPOS_PROGRAMACION = ['pendiente', 'programado_parcial', 'programado'];

// Mismo criterio que en Pedidos.js: colores de estado de ENTREGA fijos en
// los dos temas, no estan en estados.js (que solo expone COLOR_PEDIDO /
// COLOR_DESPACHO), asi que se arman aca con el mismo esquema de la barra de
// progreso: cumplida verde, programada ambar, pendiente gris, suspendida
// atenuada.
const COLOR_ENTREGA = {
  cumplida:   { borde: colorEstado.exitoBorde, fondo: colorEstado.exitoFondo, texto: colorEstado.exitoTexto },
  programada: { borde: colorEstado.advertenciaBorde, fondo: colorEstado.advertenciaFondo, texto: colorEstado.advertenciaTexto },
  pendiente:  { borde: '#D1D5DB', fondo: '#F3F4F6', texto: '#6B7280' },
  suspendida: { borde: colorEstado.peligroBordeAlterno, fondo: colorEstado.peligroFondo, texto: colorEstado.peligroTexto },
};

const DIAS_SEMANA_COMPLETOS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MESES_COMPLETOS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/** "2026-09-03" -> "Jueves 03 de Septiembre del 2026". */
function formatearFechaCompleta(fechaISO) {
  if (!fechaISO) return '';
  const d = new Date(fechaISO + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return fechaISO;
  const dia = String(d.getDate()).padStart(2, '0');
  return `${DIAS_SEMANA_COMPLETOS[d.getDay()]} ${dia} de ${MESES_COMPLETOS[d.getMonth()]} del ${d.getFullYear()}`;
}

/** Iniciales para el avatar del selector: "Transportes ABC" -> "TA". */
function inicialesDe(nombre) {
  const palabras = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return '?';
  if (palabras.length === 1) return palabras[0].slice(0, 2).toUpperCase();
  return (palabras[0][0] + palabras[1][0]).toUpperCase();
}

// Reparte los acentos que YA existen en tokens.js entre los avatares --
// ningun color nuevo entra a la paleta. Se usan a pleno color de fondo con
// texto blanco (mismo criterio que los botones sobre `marca`), asi el
// contraste da bien sin necesitar un tono "Fondo" pastel para cada acento.
const PALETA_AVATARES = [
  colorEstado.acentoPurpura, colorEstado.acentoVerde, colorEstado.acentoAzul,
  colorEstado.acentoAmbar, colorEstado.acentoAzulFuerte, marca,
];

function colorAvatarDe(nombre) {
  const texto = String(nombre || '');
  let hash = 0;
  for (let i = 0; i < texto.length; i++) hash = (hash * 31 + texto.charCodeAt(i)) >>> 0;
  return PALETA_AVATARES[hash % PALETA_AVATARES.length];
}

/**
 * Reemplaza la escala de grises (textoSecundario/textoSuave/textoTenue) por
 * tonos de rojo -- protagonista, familia de `marca` -- y de azul, como
 * acento para numeros de referencia y texto "de chrome" (labels, ayuda).
 * Pedido explicito: nada de gris, rojo primero.
 *
 * `marcaHover` y `colorEstado.acentoAzul` ya existen en tokens.js y andan
 * bien en modo claro (8.85:1 y 9.84:1 contra blanco, medido) -- pero los dos
 * son demasiado oscuros para leerse sobre una superficie oscura, asi que en
 * oscuro se usan variantes mas claras: `colorEstado.peligroBordeAlterno`
 * (ya existe, 9.05:1) para el rojo, y un celeste nuevo (`#93C5FD`, 9.53:1)
 * para el azul -- no hay un tono claro de acentoAzul ya definido en
 * tokens.js para reusar.
 */
function paletaTexto(oscuro) {
  return {
    rojo: oscuro ? colorEstado.peligroBordeAlterno : marcaHover,
    azul: oscuro ? '#93C5FD' : colorEstado.acentoAzul,
  };
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

  const [pedidoAbiertoId, setPedidoAbiertoId] = useState(null);
  const [mostrandoHistorial, setMostrandoHistorial] = useState(false);
  // "aceptando" (crear despacho para una entrega sin cubrir) ya no es un
  // estado compartido: cada BloqueEntregaPrograma tiene su propio formulario
  // local, siempre visible. "asignando"/"editando" (sobre un despacho que ya
  // existe) siguen siendo compartidos -- son acciones puntuales sobre UN
  // despacho a la vez, no un formulario que este siempre a la vista.
  const [asignando, setAsignando] = useState(null);   // { despachoId, transportistaId }
  const [editando, setEditando] = useState(null);     // { despachoId, fecha, horario }
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');

  const [filtro, setFiltro] = useState('');
  const [grupoActivo, setGrupoActivo] = useState('todos');
  const [soloSinCubrir, setSoloSinCubrir] = useState(false);

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
        // El estado NO es un campo del documento: se deriva de los tres
        // contadores. Se calcula acá, una vez, para no repetirlo en cada
        // lugar de la pantalla que necesita mostrarlo o filtrar por él.
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

  /** Base para las pastillas de estado: solo texto + "solo sin cubrir",
   * antes de aplicar el filtro de estado. Los conteos de cada pastilla
   * salen de esta misma lista, igual que en Pedidos.js. */
  const baseFiltrada = useMemo(() => {
    const texto = claveNormalizada(filtro);
    return arbol
      .filter(x => x.pedido.estado !== 'cumplido' && x.pedido.estado !== 'suspendido')
      .filter(x => {
        if (!soloSinCubrir) return true;
        return x.entregas.some(e => entregaSinCubrir(e.entrega, e.despachos));
      })
      .filter(x => {
        if (!texto) return true;
        const org = orgsPorId.get(x.pedido.cliente_org_id);
        return claveNormalizada(x.pedido.numero).includes(texto)
            || claveNormalizada(x.pedido.ov).includes(texto)
            || (org && claveNormalizada(org.razon_social).includes(texto));
      });
  }, [arbol, filtro, soloSinCubrir, orgsPorId]);

  const conteosPorGrupo = useMemo(() => {
    const c = {};
    GRUPOS_PROGRAMACION.forEach(g => { c[g] = 0; });
    baseFiltrada.forEach(x => { c[x.pedido.estado] = (c[x.pedido.estado] || 0) + 1; });
    return c;
  }, [baseFiltrada]);

  const visibles = useMemo(() => {
    if (grupoActivo === 'todos') return baseFiltrada;
    return baseFiltrada.filter(x => x.pedido.estado === grupoActivo);
  }, [baseFiltrada, grupoActivo]);

  const abierto = pedidoAbiertoId ? arbol.find(x => x.pedido.id === pedidoAbiertoId) : null;

  /* ── Denormalizados del despacho ────────────────────────────────────────── */

  /**
   * Lo que se copia al despacho. El transportista NO lee `pedidos` —las reglas
   * lo dejan afuera y no habría forma de expresarlo: "los pedidos donde tengo un
   * despacho" es un join— así que todo lo que su pantalla muestra tiene que
   * estar acá. Y el Apps Script rutea al Plan de Producción por nombre.
   *
   * `entrega` es opcional a propósito: los lugares donde hoy no hay una
   * entrega puntual a mano siguen funcionando igual, cayendo al domicilio
   * del pedido. Cuando SÍ hay una entrega y el tipo es "Entrega al cliente",
   * su propio `destino_domicilio_id` gana — es la dirección real por la que
   * se preguntó al cargar esa entrega, no la del pedido en general.
   */
  function denormalizadosDe(pedido, entrega = null) {
    const org = orgsPorId.get(pedido.cliente_org_id);
    const prod = prodsPorId.get(pedido.producto_id);
    const idDestino = (entrega && entrega.destino_domicilio_id) || pedido.destino_domicilio_id;
    const destino = domsPorId.get(idDestino);

    return {
      cliente_org_id: pedido.cliente_org_id,
      cliente_razon_social: org ? org.razon_social : '',
      producto_nombre: prod ? prod.nombre : '',
      ov: pedido.ov || '',
      destino_texto: destino ? textoDomicilio(destino) : '',
    };
  }

  /* ── Acciones ───────────────────────────────────────────────────────────── */

  async function confirmarAceptar(x, entregaItem, f) {
    if (!f || !f.fecha) { setError('Elegí la fecha de carga.'); return; }

    const transportista = f.transportistaId ? orgsPorId.get(f.transportistaId) : null;

    // Sin correo, el transportista no se entera del despacho y no puede
    // aceptarlo. Es el arreglo que ya existe hoy y hay que conservarlo.
    if (transportista) {
      const correos = correosDeOrganizacion(usuarios, transportista.id);
      if (correos.length === 0) {
        setError(
          `${transportista.razon_social} no tiene ningún usuario activo con correo. `
          + 'Cargalo desde Usuarios antes de asignarle despachos.'
        );
        return;
      }
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
        denormalizados: denormalizadosDe(x.pedido, entregaItem.entrega),
        usuario,
      });
      creado = true;

      // Después del commit. ESTO sí escribe en el Plan de Producción.
      const rPlan = await llamarAppsScript(APPS_SCRIPT_URL, 'programar_despacho', {
        pedido_id: x.pedido.numero,
        despacho_id: numero,
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
        usuario,
      });

      if (cambio && despacho.transportista_org_id) {
        const correos = correosDeOrganizacion(usuarios, despacho.transportista_org_id);
        const entrega = entregas.find(e => e.id === despacho.entrega_id);
        const rEdit = await llamarAppsScript(APPS_SCRIPT_URL, 'editar_despacho', {
          pedido_id: x.pedido.numero,
          despacho_id: despacho.numero,
          email_transportista: correos.join(','),
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
      // `cancelarDespacho()` ya hace todo lo que antes se armaba acá a mano:
      // cancela el despacho y el viaje, recalcula la entrega y el pedido dentro
      // de su transacción, deja el aviso para el transportista en `avisos`
      // (reemplaza al mail de `cancelar_despacho`), y DESPUÉS del commit llama
      // sola a `borrar_despacho` con el payload que la función realmente
      // necesita — antes se le mandaba `{pedido_id, despacho_id, motivo}`
      // desde acá, que no le alcanza a `resolverColumna()` para encontrar la
      // celda correcta en el Plan.
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
   * Cierra a mano un viaje que quedó en EN_VIAJE sin que el chofer lo haya
   * cerrado — teléfono roto, se olvidó, lo que sea. Es más urgente de lo que
   * parece: sin esto, el viaje queda abierto para siempre y eso bloquea la
   * ficha del chofer en el ABM de usuarios (no se puede desactivar a alguien
   * con un viaje en curso).
   *
   * `finalizarViaje` con `cerradoPor: 'manual'` no guarda posición de fin —el
   * coordinador no sabe dónde estaba el camión, y poner la última conocida
   * como si fuera la de entrega sería inventar un dato que no se tiene.
   */
  async function confirmarCerrarManual(despacho, viaje) {
    const motivo = window.prompt(
      `Vas a cerrar el viaje del despacho ${despacho.numero} a mano. `
      + 'Contá por qué (el chofer no lo cerró, se le rompió el teléfono, etc.):'
    );
    if (motivo === null) return;
    if (!motivo.trim()) { window.alert('El motivo es obligatorio.'); return; }

    setOcupado(true);
    setError('');

    try {
      await finalizarViaje({
        viaje,
        despacho: { id: despacho.id },
        posicion: null,
        cerradoPor: 'manual',
        motivo: motivo.trim(),
        usuario,
      });
    } catch (err) {
      console.error(err);
      setError(traducirError(err));
    } finally {
      setOcupado(false);
    }
  }

  /**
   * El payload que espera el Apps Script, con los nombres resueltos.
   *
   * Mismo criterio que `denormalizadosDe()`: si hay una `entrega` con su
   * propio `destino_domicilio_id` (solo pasa con "Entrega al cliente"), esa
   * dirección gana sobre la del pedido — así el mail y la nota del Plan de
   * Producción muestran la dirección real de ESA entrega, no una genérica.
   */
  function payloadDe(pedido, entrega, form, transportista) {
    const org = orgsPorId.get(pedido.cliente_org_id);
    const prod = prodsPorId.get(pedido.producto_id);
    const idDestino = (entrega && entrega.destino_domicilio_id) || pedido.destino_domicilio_id;
    const destino = domsPorId.get(idDestino);

    return {
      cliente: org ? org.razon_social : '',
      producto: prod ? prod.nombre : '',
      volumen: entrega ? entrega.volumen : '',
      ov: pedido.ov || '',
      lugar: destino ? textoDomicilio(destino) : '',
      tipo: pedido.tipo,
      fecha_carga: form.fecha || '',
      horario_carga: form.horario || '',
      fecha_entrega: entrega ? entrega.fecha_solicitada : '',
      banda_horaria: pedido.banda_horaria || '',
      obs: pedido.obs || '',
      transporte: transportista ? transportista.razon_social : '',
      programado_por: usuario.nombre || usuario.email,
    };
  }

  /* ── Render ─────────────────────────────────────────────────────────────── */

  if (sinAcceso) {
    return <div style={styles.wrap}><div style={styles.bannerError}>{sinAcceso}</div></div>;
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.panelHeader}>
        <div style={styles.titulo}>Programación</div>
      </div>

      {error && <div style={styles.bannerError}>{error}</div>}

      <div style={styles.controlesFila}>
        <input
          style={styles.buscador}
          value={filtro}
          onChange={e => setFiltro(e.target.value)}
          placeholder="Buscar por número, cliente u orden..."
        />
      </div>

      <div style={styles.pastillasGrupo}>
        <PastillaGrupo
          activo={grupoActivo === 'todos'}
          onClick={() => setGrupoActivo('todos')}
          label={`Todos (${baseFiltrada.length})`}
        />
        {GRUPOS_PROGRAMACION.map(g => (
          <PastillaGrupo
            key={g}
            activo={grupoActivo === g}
            onClick={() => setGrupoActivo(g)}
            label={`${ETIQUETA_PEDIDO[g]} (${conteosPorGrupo[g] || 0})`}
            colores={COLOR_PEDIDO[g]}
          />
        ))}
        <PastillaToggle
          activo={soloSinCubrir}
          onClick={() => setSoloSinCubrir(v => !v)}
          label="Solo sin cubrir"
        />
      </div>

      {cargando && <Vacio titulo="Cargando..." />}
      {!cargando && visibles.length === 0 && <Vacio titulo="No hay pedidos para programar." />}

      {!cargando && visibles.length > 0 && (
        <div>
          {visibles.map(x => (
            <FilaPrograma
              key={x.pedido.id}
              x={x}
              org={orgsPorId.get(x.pedido.cliente_org_id)}
              prod={prodsPorId.get(x.pedido.producto_id)}
              onClick={() => setPedidoAbiertoId(x.pedido.id)}
            />
          ))}
        </div>
      )}

      {/* Mismo patron que Pedidos.js: nunca se montan los dos modales juntos.
          El historial reemplaza al detalle mientras esta abierto. */}
      {abierto && !mostrandoHistorial && (
        <ModalDetallePrograma
          x={abierto}
          org={orgsPorId.get(abierto.pedido.cliente_org_id)}
          prod={prodsPorId.get(abierto.pedido.producto_id)}
          domsPorId={domsPorId}
          orgsPorId={orgsPorId}
          transportistas={transportistas}
          viajePorDespacho={viajePorDespacho}
          asignando={asignando}
          setAsignando={setAsignando}
          editando={editando}
          setEditando={setEditando}
          ocupado={ocupado}
          onAceptar={(item, form) => confirmarAceptar(abierto, item, form)}
          onAsignar={(d) => confirmarAsignar(abierto, d)}
          onEditar={(d) => confirmarEditar(abierto, d)}
          onCancelar={(d) => confirmarCancelar(abierto, d)}
          onCerrarManual={(d, v) => confirmarCerrarManual(d, v)}
          setError={setError}
          onCerrar={() => { setPedidoAbiertoId(null); setMostrandoHistorial(false); setAsignando(null); setEditando(null); }}
          onVerHistorial={() => setMostrandoHistorial(true)}
        />
      )}

      {abierto && mostrandoHistorial && (
        <HistorialPedido pedidoId={abierto.pedido.id} onCerrar={() => setMostrandoHistorial(false)} />
      )}
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Fila de la lista
 * -------------------------------------------------------------------------- */

function FilaPrograma({ x, org, prod, onClick }) {
  const styles = useEstilos();
  const { colores } = useTema();
  const p = x.pedido;
  const col = COLOR_PEDIDO[p.estado] || COLOR_PEDIDO.pendiente;
  const sinCubrir = x.entregas.filter(e => entregaSinCubrir(e.entrega, e.despachos)).length;

  return (
    <Tarjeta
      onClick={onClick}
      style={{ marginBottom: espacio.sm, padding: '12px 16px', borderLeft: `3px solid ${col ? col.bg : colores.borde}` }}
    >
      <div style={styles.filaContenido}>
        <Pastilla colores={col}>{ETIQUETA_PEDIDO[p.estado] || p.estado}</Pastilla>
        <span style={styles.filaCliente}>{org ? org.razon_social : '—'}</span>
        <span style={styles.filaProducto}>{prod ? prod.nombre : '—'}</span>
        <span style={styles.filaVolumen}>{p.volumen} tn</span>
        {sinCubrir > 0 && (
          <Pastilla chico colores={{ bg: colorEstado.advertenciaFondo, color: colorEstado.advertenciaTexto }}>
            {sinCubrir} sin cubrir
          </Pastilla>
        )}
        <span style={styles.filaNumero}>{p.numero}</span>
      </div>
    </Tarjeta>
  );
}

function PastillaGrupo({ activo, onClick, label, colores }) {
  const { colores: coloresTema, oscuro } = useTema();
  const pal = paletaTexto(oscuro);
  const bg = activo ? (colores ? colores.bg : marca) : coloresTema.fondoAlterno;
  const color = activo ? (colores ? colores.color : '#fff') : pal.azul;
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px', borderRadius: radio.pastilla, border: 'none', cursor: 'pointer',
        fontSize: tipografia.tamano.sm, fontWeight: activo ? tipografia.peso.negrita : tipografia.peso.normal,
        background: bg, color, whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

/** Pastilla-toggle para "Solo sin cubrir" -- mismo look que PastillaGrupo,
 * pero es un on/off en vez de un grupo excluyente, asi que usa el color de
 * advertencia (mismo que la banda-horaria/aviso) en vez de `marca` cuando
 * esta activa, para no confundirla con un filtro de estado. */
function PastillaToggle({ activo, onClick, label }) {
  const { colores, oscuro } = useTema();
  const pal = paletaTexto(oscuro);
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px', borderRadius: radio.pastilla, cursor: 'pointer',
        fontSize: tipografia.tamano.sm, fontWeight: activo ? tipografia.peso.negrita : tipografia.peso.normal,
        background: activo ? colorEstado.advertenciaFondo : colores.fondoAlterno,
        color: activo ? colorEstado.advertenciaTexto : pal.azul,
        border: activo ? `1px solid ${colorEstado.advertenciaBorde}` : '1px solid transparent',
        whiteSpace: 'nowrap',
      }}
    >
      {activo ? '✓ ' : ''}{label}
    </button>
  );
}

/* -----------------------------------------------------------------------------
 * Modal de detalle -- izquierda datos del pedido, derecha entregas
 * -------------------------------------------------------------------------- */

function ModalDetallePrograma({
  x, org, prod, domsPorId, orgsPorId, transportistas, viajePorDespacho,
  asignando, setAsignando, editando, setEditando,
  ocupado, onAceptar, onAsignar, onEditar, onCancelar, onCerrarManual, setError,
  onCerrar, onVerHistorial,
}) {
  const styles = useEstilos();
  const p = x.pedido;
  const colEstado = COLOR_PEDIDO[p.estado] || COLOR_PEDIDO.pendiente;
  // Mismo criterio que Pedidos.js: para "Entrega al cliente" cada entrega
  // puede tener su propio destino, asi que ahi la direccion se muestra POR
  // ENTREGA (mas abajo, en BloqueEntregaPrograma), no una sola vez del lado
  // del pedido -- mostrarla ahi seria mostrar la de una sola entrega como si
  // fuera la de todo el pedido. Para los demas tipos el destino es unico y
  // sigue del lado del pedido.
  const esEntregaAlCliente = p.tipo === 'Entrega al cliente';
  const destinoPedido = domsPorId.get(p.destino_domicilio_id);

  return (
    <Modal titulo={`Pedido ${p.numero}`} onCerrar={onCerrar} ancho={960}>
      <div style={{ ...styles.franjaEstadoModal, background: colEstado.bg }} />
      <div style={styles.modalDosColumnas}>

        <div style={styles.modalColumna}>
          <div style={styles.estadoModalFila}>
            <Pastilla colores={colEstado}>{ETIQUETA_PEDIDO[p.estado] || p.estado}</Pastilla>
            <span style={styles.volumenModal}>{p.volumen} tn</span>
          </div>

          <div style={styles.modalGrid}>
            <Dato label="Tipo" valor={p.tipo} />
            <Dato label="Recipiente" valor={p.recipiente} />
            <Dato label="Producto" valor={prod ? prod.nombre : ''} />
            <Dato label="Cliente" valor={org ? org.razon_social : ''} />
            <Dato label="OV / OC" valor={p.ov} />
            <Dato label="Banda horaria" valor={p.banda_horaria} />
            {!esEntregaAlCliente && (
              <Dato label="Destino" valor={destinoPedido ? textoDomicilio(destinoPedido) : ''} />
            )}
            {esEntregaAlCliente && (
              <Dato label="Destino" valor="Varía por entrega ->" />
            )}
          </div>

          {p.obs && <div style={styles.obsBox}>{p.obs}</div>}

          <div style={styles.accionesColumna}>
            <Boton variante="secundario" onClick={onVerHistorial}>Ver historial</Boton>
          </div>
        </div>

        <div style={styles.modalColumna}>
          <div style={styles.entregasTitulo}>Entregas</div>

          {x.entregas.map(item => (
            <BloqueEntregaPrograma
              key={item.entrega.id}
              x={x}
              item={item}
              pedido={p}
              esEntregaAlCliente={esEntregaAlCliente}
              domsPorId={domsPorId}
              orgsPorId={orgsPorId}
              transportistas={transportistas}
              viajePorDespacho={viajePorDespacho}
              asignando={asignando}
              setAsignando={setAsignando}
              editando={editando}
              setEditando={setEditando}
              ocupado={ocupado}
              onAceptar={(form) => onAceptar(item, form)}
              onAsignar={onAsignar}
              onEditar={onEditar}
              onCancelar={onCancelar}
              onCerrarManual={onCerrarManual}
              setError={setError}
            />
          ))}
        </div>
      </div>
    </Modal>
  );
}

function Dato({ label, valor }) {
  const styles = useEstilos();
  const tieneValor = valor !== undefined && valor !== null && valor !== '';
  return (
    <div style={styles.field}>
      <span style={styles.label}>{label}</span>
      <span style={tieneValor ? styles.valorCompleto : styles.valorVacio}>
        {tieneValor ? valor : 'Sin dato'}
      </span>
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Bloque de una entrega -- dia/hora/carga, sus despachos, y el alta si esta
 * sin cubrir
 * -------------------------------------------------------------------------- */

function BloqueEntregaPrograma({
  x, item, pedido, esEntregaAlCliente, domsPorId, orgsPorId, transportistas, viajePorDespacho,
  asignando, setAsignando, editando, setEditando,
  ocupado, onAceptar, onAsignar, onEditar, onCancelar, onCerrarManual, setError,
}) {
  const styles = useEstilos();
  const { entrega, despachos } = item;
  const sinCubrir = entregaSinCubrir(entrega, despachos);
  const colEntrega = COLOR_ENTREGA[entrega.estado] || COLOR_ENTREGA.pendiente;

  // Solo los despachos VIVOS ocupan lugar aca -- los rechazados/cancelados
  // son historia, no algo con lo que haya que hacer nada ahora, y competian
  // por el mismo espacio que hace falta para crear el despacho nuevo. Se
  // siguen pudiendo ver, pero desde "Ver historial" (arriba, en la columna
  // del pedido), no clavados en el medio de esta lista.
  const despachosVivos = despachos.filter(despachoVivo);
  const despachosMuertos = despachos.length - despachosVivos.length;

  // Direccion de esta entrega puntual -- solo aplica a "Entrega al cliente"
  // (ver el comentario en ModalDetallePrograma). Cae al domicilio del
  // pedido si la entrega no tiene uno propio cargado.
  const destinoEntrega = esEntregaAlCliente
    ? domsPorId.get(entrega.destino_domicilio_id || pedido.destino_domicilio_id)
    : null;

  // Formulario para crear el despacho de esta entrega, LOCAL a este bloque
  // -- cada entrega sin cubrir tiene el suyo, siempre visible, sin pisarse
  // entre si. La fecha de carga arranca en la de la entrega (lo mas
  // frecuente); si hay que adelantarla, se cambia aca mismo.
  const [form, setForm] = useState({ fecha: entrega.fecha_solicitada, horario: '', transportistaId: '' });

  function crear() {
    setError('');
    onAceptar(form);
  }

  return (
    <div style={{ ...styles.entregaCard, borderLeft: `3px solid ${colEntrega.borde}` }}>
      <div style={styles.entregaHeader}>
        <span style={styles.entregaNroChico}>#{entrega.numero}</span>
        <Pastilla chico colores={{ bg: colEntrega.fondo, color: colEntrega.texto }}>
          {ETIQUETA_ENTREGA[entrega.estado] || entrega.estado}
        </Pastilla>
      </div>
      <div style={styles.entregaFechaCompleta}>{formatearFechaCompleta(entrega.fecha_solicitada)}</div>
      <div style={styles.entregaVolFila}>
        <span style={styles.entregaVol}>{entrega.volumen} tn</span>
        {destinoEntrega && <span style={styles.entregaDestino}>{textoDomicilio(destinoEntrega)}</span>}
      </div>

      {/* Solo el/los despacho(s) vivos -- ver arriba por que. */}
      {despachosVivos.map(d => (
        <DespachoBloque
          key={d.id}
          despacho={d}
          orgsPorId={orgsPorId}
          transportistas={transportistas}
          viaje={viajePorDespacho.get(d.id) || null}
          asignando={asignando}
          setAsignando={setAsignando}
          editando={editando}
          setEditando={setEditando}
          ocupado={ocupado}
          onAsignar={onAsignar}
          onEditar={onEditar}
          onCancelar={onCancelar}
          onCerrarManual={onCerrarManual}
          setError={setError}
        />
      ))}

      {despachosMuertos > 0 && (
        <div style={styles.notaHistorial}>
          {despachosMuertos} despacho{despachosMuertos > 1 ? 's' : ''} anterior{despachosMuertos > 1 ? 'es' : ''} (rechazado o cancelado) -- ver historial arriba.
        </div>
      )}

      {/* Sin cubrir: el alta queda siempre a la vista, no escondida detras
          de un boton. Fecha y horario a la izquierda, el selector de
          transportista a la derecha. */}
      {sinCubrir && (
        <div style={styles.altaDespachoWrap}>
          <div style={styles.altaDespachoGrid}>
            <div style={styles.altaDespachoColumna}>
              <Campo
                label="Fecha de carga *" type="date" min={hoyISO()} max={entrega.fecha_solicitada}
                value={form.fecha}
                onChange={e => setForm({ ...form, fecha: e.target.value })}
                ayuda={`Entre hoy y el ${entrega.fecha_solicitada}.`}
              />
              <Campo
                // Input nativo de hora: el valor siempre queda en formato
                // 24hs (HH:MM), sin AM/PM que puedan confundirse -- antes
                // era texto libre tipo "08:00hs".
                label="Horario" type="time"
                value={form.horario}
                onChange={e => setForm({ ...form, horario: e.target.value })}
              />
              <Boton disabled={ocupado || !form.fecha} onClick={crear} style={{ alignSelf: 'flex-start' }}>
                {ocupado ? 'Guardando...' : 'Crear despacho'}
              </Boton>
            </div>

            <div style={styles.altaDespachoColumna}>
              <SelectorTransportista
                transportistas={transportistas}
                valor={form.transportistaId}
                onElegir={(id) => setForm({ ...form, transportistaId: id })}
                permitirVacio
                notaVacio="Opcional. Sin transportista, el despacho queda esperando."
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Un despacho existente -- asignar / reasignar / editar / cancelar
 * -------------------------------------------------------------------------- */

function DespachoBloque({
  despacho: d, orgsPorId, transportistas, viaje,
  asignando, setAsignando, editando, setEditando,
  ocupado, onAsignar, onEditar, onCancelar, onCerrarManual, setError,
}) {
  const styles = useEstilos();
  const col = COLOR_DESPACHO[d.estado] || COLOR_DESPACHO.CANCELADO;
  const org = d.transportista_org_id ? orgsPorId.get(d.transportista_org_id) : null;
  const vivo = despachoVivo(d);
  // El viaje quedó EN_VIAJE sin que nadie lo haya cerrado. No depende de
  // `puedeCancelar` ni de las otras acciones -- es su propio caso.
  const puedeCerrarManual = d.estado === DESPACHO.NOMINADO && viaje && viaje.estado === VIAJE.EN_VIAJE;

  const asignandoEste = asignando && asignando.despachoId === d.id;
  const editandoEste = editando && editando.despachoId === d.id;

  return (
    <div style={{ ...styles.despacho, opacity: vivo ? 1 : 0.6 }}>
      <div style={styles.despachoFila}>
        <span style={styles.despachoNro}>{d.numero}</span>
        <Pastilla chico colores={col}>{ETIQUETA_DESPACHO[d.estado] || d.estado}</Pastilla>
        <span style={styles.despachoDato}>carga {d.fecha_carga}</span>
        {d.horario_carga && <span style={styles.despachoDato}>{d.horario_carga}</span>}
        <span style={styles.despachoTransporte}>
          {org ? org.razon_social : (vivo ? 'sin transportista' : '')}
        </span>
      </div>

      {vivo && !asignandoEste && !editandoEste && (
        <div style={styles.despachoAcciones}>
          {(puedeAsignar(d) || puedeReasignar(d)) && (
            <Boton
              chico variante="secundario"
              onClick={() => { setError(''); setAsignando({ despachoId: d.id, transportistaId: d.transportista_org_id || '' }); }}
            >
              {puedeAsignar(d) ? 'Asignar' : 'Reasignar'}
            </Boton>
          )}
          {puedeEditar(d) && (
            <Boton
              chico variante="secundario"
              style={styles.btnEditarFecha}
              onClick={() => { setError(''); setEditando({ despachoId: d.id, fecha: d.fecha_carga, horario: d.horario_carga || '' }); }}
            >
              Editar
            </Boton>
          )}
          {puedeCancelar(d, viaje) && (
            <Boton chico variante="peligro" onClick={() => onCancelar(d)}>Cancelar</Boton>
          )}
          {puedeCerrarManual && (
            <Boton chico variante="peligro" onClick={() => onCerrarManual(d, viaje)}>Cerrar viaje a mano</Boton>
          )}
        </div>
      )}

      {/* El chofer y el camión, cuando está nominado */}
      {d.chofer_dni && (
        <div style={styles.despachoDetalle}>
          Chofer {d.chofer_dni}
          {d.patente_tractor && <> · {d.patente_tractor}</>}
          {d.patente_semi && <> + {d.patente_semi}</>}
          {viaje && <> · viaje {viaje.estado}</>}
        </div>
      )}

      {d.rechazo_motivo && (
        <div style={styles.motivo}>Rechazado: {d.rechazo_motivo}</div>
      )}
      {d.cancelacion_motivo && (
        <div style={styles.motivo}>Cancelado: {d.cancelacion_motivo}</div>
      )}

      {/* Asignar / reasignar */}
      {asignandoEste && (
        <div style={styles.formInline}>
          <SelectorTransportista
            transportistas={transportistas}
            valor={asignando.transportistaId}
            onElegir={(id) => setAsignando({ ...asignando, transportistaId: id })}
            permitirVacio={false}
            notaVacio={puedeReasignar(d) ? 'Se puede cambiar hasta que el transportista responde. Después, el camino es que rechace o pida la baja.' : ''}
          />
          <div style={styles.accionesFila}>
            <Boton disabled={ocupado} onClick={() => onAsignar(d)}>
              {ocupado ? 'Guardando...' : 'Confirmar'}
            </Boton>
            <Boton variante="secundario" onClick={() => setAsignando(null)}>Cancelar</Boton>
          </div>
        </div>
      )}

      {/* Editar fecha y horario */}
      {editandoEste && (
        <div style={styles.formInline}>
          <div style={styles.altaDespachoGrid}>
            <Campo
              label="Fecha de carga *" type="date" min={hoyISO()}
              value={editando.fecha}
              onChange={e => setEditando({ ...editando, fecha: e.target.value })}
            />
            <Campo
              label="Horario" type="time"
              value={editando.horario}
              onChange={e => setEditando({ ...editando, horario: e.target.value })}
            />
          </div>
          <div style={styles.accionesFila}>
            <Boton disabled={ocupado} onClick={() => onEditar(d)}>
              {ocupado ? 'Guardando...' : 'Guardar'}
            </Boton>
            <Boton variante="secundario" onClick={() => setEditando(null)}>Cancelar</Boton>
          </div>
        </div>
      )}
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Selector de transportista -- desplegable buscable, no una nube de chips
 * (esa no escala con muchos transportistas) ni el <select> de siempre.
 * Mismo patron de posicionamiento y cierre-al-clickear-afuera que
 * Buscador.js, pero con el avatar de iniciales para que tenga onda.
 * -------------------------------------------------------------------------- */

function SelectorTransportista({ transportistas, valor, onElegir, permitirVacio = true, notaVacio }) {
  const styles = useEstilos();
  const { colores } = useTema();
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const contenedorRef = useRef(null);

  const elegido = transportistas.find(t => t.id === valor) || null;

  const filtrados = useMemo(() => {
    const texto = claveNormalizada(busqueda);
    if (!texto) return transportistas;
    return transportistas.filter(t => claveNormalizada(t.razon_social).includes(texto));
  }, [busqueda, transportistas]);

  useEffect(() => {
    function alClickearFuera(e) {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target)) {
        setAbierto(false);
        setBusqueda('');
      }
    }
    document.addEventListener('mousedown', alClickearFuera);
    return () => document.removeEventListener('mousedown', alClickearFuera);
  }, []);

  function elegir(id) {
    onElegir(id);
    setAbierto(false);
    setBusqueda('');
  }

  return (
    <div ref={contenedorRef} style={styles.selectorTransportista}>
      <label style={styles.label}>Transportista{permitirVacio ? '' : ' *'}</label>

      {/* El panel se posiciona relativo a ESTE div, no al bloque entero --
          antes `selectorTransportista` era el contenedor posicionado, y como
          "notaVacio" (el texto de ayuda de abajo) tambien vivia ahi adentro,
          el `top: 100%` del panel se calculaba contra la altura de TODO el
          bloque (boton + ayuda), no solo contra el boton -- por eso el
          desplegable aparecia pegado debajo del texto en vez de debajo del
          boton. */}
      <div style={styles.selectorAncla}>
        {/* El control cerrado muestra SIEMPRE lo que hay elegido de verdad --
            nada de "parece que sin transportista sigue marcado": si `valor`
            tiene un id, se ve el avatar y el nombre de ESE transportista, no
            una pastilla generica. */}
        <button type="button" style={styles.selectorControl} onClick={() => setAbierto(v => !v)}>
          {elegido ? (
            <>
              <span style={{ ...styles.selectorAvatar, background: colorAvatarDe(elegido.razon_social) }}>
                {inicialesDe(elegido.razon_social)}
              </span>
              <span style={styles.selectorTexto}>{elegido.razon_social}</span>
            </>
          ) : (
            <span style={styles.selectorPlaceholder}>Sin transportista</span>
          )}
          <span style={styles.selectorFlecha}>{abierto ? '▲' : '▼'}</span>
        </button>

        {abierto && (
          <div style={styles.selectorPanel}>
            <input
              autoFocus
              style={styles.selectorBusqueda}
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar transportista..."
            />
            <div style={styles.selectorLista}>
              {permitirVacio && (
                <button
                  type="button" onClick={() => elegir('')}
                  style={{ ...styles.selectorFila, ...(!valor ? styles.selectorFilaActiva : {}) }}
                  onMouseEnter={e => { if (valor) e.currentTarget.style.background = colores.fondo; }}
                  onMouseLeave={e => { e.currentTarget.style.background = !valor ? colores.fondoAlterno : 'transparent'; }}
                >
                  <span style={{ ...styles.selectorAvatarChico, background: colores.fondoAlterno, color: colores.textoTenue }}>—</span>
                  <span style={styles.selectorFilaTexto}>Sin transportista</span>
                  {!valor && <span style={styles.selectorCheck}>✓</span>}
                </button>
              )}
              {filtrados.map(t => {
                const activo = t.id === valor;
                return (
                  <button
                    key={t.id} type="button" onClick={() => elegir(t.id)}
                    style={{ ...styles.selectorFila, ...(activo ? styles.selectorFilaActiva : {}) }}
                    onMouseEnter={e => { if (!activo) e.currentTarget.style.background = colores.fondo; }}
                    onMouseLeave={e => { e.currentTarget.style.background = activo ? colores.fondoAlterno : 'transparent'; }}
                  >
                    <span style={{ ...styles.selectorAvatarChico, background: colorAvatarDe(t.razon_social), color: '#fff' }}>
                      {inicialesDe(t.razon_social)}
                    </span>
                    <span style={styles.selectorFilaTexto}>{t.razon_social}</span>
                    {activo && <span style={styles.selectorCheck}>✓</span>}
                  </button>
                );
              })}
              {filtrados.length === 0 && <div style={styles.selectorVacio}>Sin resultados.</div>}
            </div>
          </div>
        )}
      </div>

      {notaVacio && <span style={styles.ayuda}>{notaVacio}</span>}
    </div>
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
 * Estilos -- crearEstilos(colores) + useEstilos(), mismo patron que
 * Pedidos.js (ver el comentario de REDISENO ahi arriba de por que ya no es
 * un objeto fijo).
 * -------------------------------------------------------------------------- */

function crearEstilos(colores, oscuro) {
  const pal = paletaTexto(oscuro);

  return {
    wrap: { maxWidth: 960, margin: '0 auto', padding: '1.5rem 1rem', background: colores.fondo, color: colores.texto },
    panelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' },
    titulo: { fontSize: 18, fontWeight: 500, color: colores.texto },

    controlesFila: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' },
    buscador: { flex: '1 1 260px', fontSize: 13, padding: '8px 12px', borderRadius: 8, border: `0.5px solid ${colores.borde}`, color: colores.texto, background: colores.superficie },

    pastillasGrupo: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' },

    filaContenido: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
    filaCliente: { fontSize: 13, fontWeight: 500, color: colores.texto, flex: 2, minWidth: 110 },
    // Nada de gris: datos reales en tonos de rojo, referencias (numero de
    // pedido) en azul.
    filaProducto: { fontSize: 12, color: pal.rojo, flex: 1, minWidth: 70 },
    filaVolumen: { fontSize: 12, color: pal.rojo, fontWeight: tipografia.peso.medio, flexShrink: 0 },
    filaNumero: { fontSize: 11, color: pal.azul, fontFamily: 'monospace', flexShrink: 0, marginLeft: 'auto' },

    modalDosColumnas: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 24 },
    modalColumna: { display: 'flex', flexDirection: 'column' },
    modalGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 10 },
    franjaEstadoModal: { height: 4, borderRadius: '10px 10px 0 0', margin: '-1.5rem -1.5rem 1rem' },
    estadoModalFila: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
    volumenModal: { fontSize: 15, fontWeight: tipografia.peso.negrita, color: colores.texto },
    field: { display: 'flex', flexDirection: 'column', gap: 3 },
    // Labels de campo: azul -- son "chrome" (identifican un dato), no el
    // dato en si.
    label: { fontSize: 11, color: pal.azul, fontWeight: tipografia.peso.medio },
    valorCompleto: { fontSize: 13, color: colores.texto, fontWeight: tipografia.peso.medio },
    // "Sin dato": rojo -- es una falta, tiene sentido que llame la atencion
    // un poco mas que un gris apagado.
    valorVacio: { fontSize: 13, color: pal.rojo, fontStyle: 'italic' },
    obsBox: { fontSize: 12, color: pal.rojo, padding: '8px 10px', background: colores.fondoAlterno, borderRadius: 8, marginBottom: 10 },
    accionesColumna: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 },

    entregasTitulo: { fontSize: 11, color: pal.azul, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: tipografia.peso.medio, marginBottom: 8 },
    entregaCard: { border: `0.5px solid ${colores.borde}`, borderRadius: 10, padding: '12px 14px', marginBottom: 10 },
    entregaHeader: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 },
    entregaNroChico: { color: pal.azul, fontFamily: 'monospace', fontSize: 12, fontWeight: tipografia.peso.medio },
    // La fecha completa es el dato mas importante del bloque -- va en texto
    // pleno, ni gris ni de color, y un toque mas grande que el resto.
    entregaFechaCompleta: { color: colores.texto, fontSize: 14, fontWeight: tipografia.peso.medio, marginBottom: 6 },
    entregaVolFila: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 },
    entregaVol: { color: colores.texto, fontSize: 13, fontWeight: tipografia.peso.negrita },
    entregaDestino: { color: pal.rojo, fontSize: 12 },

    despacho: { marginTop: 10, paddingTop: 10, borderTop: `0.5px solid ${colores.borde}` },
    despachoFila: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    despachoNro: { fontSize: 12, fontWeight: 500, color: colores.texto, fontFamily: 'monospace' },
    // Fecha/horario del despacho: dato operativo central de esta pantalla,
    // texto pleno.
    despachoDato: { fontSize: 12, color: colores.texto },
    despachoTransporte: { fontSize: 12, color: pal.rojo, fontWeight: tipografia.peso.medio },
    despachoAcciones: { display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' },
    despachoDetalle: { fontSize: 12, color: pal.rojo, marginTop: 4 },
    motivo: { fontSize: 12, color: colorEstado.advertenciaTexto, marginTop: 4, fontWeight: tipografia.peso.medio },
    // Aviso de que hay despachos viejos: azul -- es un puntero a otro lado
    // (el historial), no un dato en si, mismo criterio que las labels.
    notaHistorial: { fontSize: 11, color: pal.azul, marginTop: 8, fontStyle: 'italic' },

    formInline: { marginTop: 10, padding: 12, background: colores.fondoAlterno, borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 10 },
    altaDespachoWrap: { marginTop: 10, padding: 12, background: colores.fondoAlterno, borderRadius: 10 },
    // Dos columnas de verdad: izquierda fecha/horario/boton, derecha el
    // selector de transportista -- no una grilla que fluye sola.
    altaDespachoGrid: { display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(220px, 280px)', gap: 16, alignItems: 'start' },
    altaDespachoColumna: { display: 'flex', flexDirection: 'column', gap: 2 },
    accionesFila: { display: 'flex', gap: 8 },
    ayuda: { fontSize: 11, color: pal.azul, lineHeight: 1.4 },

    // Boton "Editar" del despacho, mismo acento que el de Pedidos.js para
    // "Editar fecha" -- consistencia entre pantallas para la misma accion.
    btnEditarFecha: { borderColor: '#3B82F6', color: '#3B82F6' },

    bannerError: { padding: '10px 14px', borderRadius: 8, background: colorEstado.peligroFondo, border: `0.5px solid ${colorEstado.peligroBordeAlterno}`, fontSize: 13, color: colorEstado.peligroTexto, marginBottom: 12, whiteSpace: 'pre-line' },

    /* --- Selector de transportista: desplegable, no chips --- */
    selectorTransportista: { display: 'flex', flexDirection: 'column', gap: 6 },
    selectorAncla: { position: 'relative' },
    selectorControl: {
      display: 'flex', alignItems: 'center', gap: 8, width: '100%', boxSizing: 'border-box',
      textAlign: 'left', padding: '9px 12px', borderRadius: radio.xl,
      border: `1px solid ${colores.borde}`, background: colores.superficie, cursor: 'pointer',
      fontSize: 13, color: colores.texto, fontFamily: tipografia.familia,
    },
    selectorAvatar: {
      width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 10, fontWeight: tipografia.peso.negrita, color: '#fff', flexShrink: 0,
    },
    selectorTexto: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: tipografia.peso.medio },
    // Placeholder "Sin transportista": rojo -- es una eleccion pendiente,
    // mismo criterio que "Sin dato" en valorVacio.
    selectorPlaceholder: { flex: 1, color: pal.rojo },
    selectorFlecha: { fontSize: 10, color: pal.azul, flexShrink: 0 },
    selectorPanel: {
      position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 30,
      background: colores.superficie, border: `1px solid ${colores.borde}`, borderRadius: radio.xl,
      boxShadow: '0 10px 30px rgba(0,0,0,0.18)', overflow: 'hidden',
    },
    selectorBusqueda: {
      width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 12, border: 'none',
      borderBottom: `1px solid ${colores.borde}`, background: 'transparent', color: colores.texto, outline: 'none',
      fontFamily: tipografia.familia,
    },
    selectorLista: { maxHeight: 220, overflowY: 'auto' },
    selectorFila: {
      display: 'flex', alignItems: 'center', gap: 8, width: '100%', boxSizing: 'border-box', textAlign: 'left',
      padding: '9px 12px', border: 'none', background: 'transparent', cursor: 'pointer',
      fontSize: 13, color: colores.texto, fontFamily: tipografia.familia,
    },
    selectorFilaActiva: { background: colores.fondoAlterno, fontWeight: tipografia.peso.medio },
    selectorAvatarChico: {
      width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 9, fontWeight: tipografia.peso.negrita, flexShrink: 0,
    },
    selectorFilaTexto: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    selectorCheck: { color: marca, fontWeight: tipografia.peso.negrita, flexShrink: 0 },
    selectorVacio: { padding: '10px 12px', fontSize: 12, color: pal.rojo },
  };
}

/**
 * Mismo patron que Pedidos.js y que ya usan Tarjeta/Boton/Campo/Pastilla:
 * cada componente de este archivo llama a este hook, sin pasar `colores` a
 * mano de padre a hijo.
 */
function useEstilos() {
  const { colores, oscuro } = useTema();
  return useMemo(() => crearEstilos(colores, oscuro), [colores, oscuro]);
}
