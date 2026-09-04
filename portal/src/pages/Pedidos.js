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
 * ========================================================================== */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { esInterno, motivoSinAcceso } from '../sesion';
import { claveNormalizada } from '../mapa-normalizacion';
import { textoDomicilio } from '../buscar-domicilios';
import {
  estadoPedido, ETIQUETA_PEDIDO, COLOR_PEDIDO, ETIQUETA_ENTREGA,
} from '../estados';
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
  hoyISO,
} from '../logica-pedidos';
import { llamarAppsScript } from '../logica-despachos';
import { marca, colorEstado, espacio, radio, tipografia } from '../ui/tokens';
import { useTema } from '../ui/TemaContext';
import Boton from '../ui/Boton';
import Tarjeta from '../ui/Tarjeta';
import Pastilla from '../ui/Pastilla';
import Campo from '../ui/Campo';
import Modal from '../ui/Modal';
import Vacio from '../ui/Vacio';
import Tabla from '../ui/Tabla';

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

const ORDEN_OPCIONES = [
  { id: 'entrega', label: 'Fecha de entrega' },
  { id: 'creacion', label: 'Fecha de creacion' },
  { id: 'cliente', label: 'Cliente' },
  { id: 'ov', label: 'OV / OC' },
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

function proximaFechaPendiente(entregas) {
  const fechas = (entregas || [])
    .filter(e => e.estado === 'pendiente')
    .map(e => e.fecha_solicitada)
    .filter(Boolean)
    .sort();
  return fechas[0] || null;
}

function fechaSumarDias(fechaISO, dias) {
  const d = new Date(fechaISO + 'T00:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

function comparadorDe(ordenPor, entregasPorPedido, orgsPorId) {
  return (a, b) => {
    if (ordenPor === 'entrega') {
      const fa = proximaFechaPendiente(entregasPorPedido.get(a.id)) || '9999-12-31';
      const fb = proximaFechaPendiente(entregasPorPedido.get(b.id)) || '9999-12-31';
      return fa.localeCompare(fb);
    }
    if (ordenPor === 'cliente') {
      const oa = orgsPorId.get(a.cliente_org_id);
      const ob = orgsPorId.get(b.cliente_org_id);
      return (oa ? oa.razon_social : '').localeCompare(ob ? ob.razon_social : '', 'es');
    }
    if (ordenPor === 'ov') {
      return String(a.ov || '').localeCompare(String(b.ov || ''), 'es', { numeric: true });
    }
    const ta = a.creado_en && a.creado_en.toMillis ? a.creado_en.toMillis() : 0;
    const tb = b.creado_en && b.creado_en.toMillis ? b.creado_en.toMillis() : 0;
    return tb - ta;
  };
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
  const [cargando, setCargando] = useState(true);

  const [vista, setVista] = useState('lista');
  const [vistaLista, setVistaLista] = useState('tarjetas');
  const [grupoActivo, setGrupoActivo] = useState('todos');
  const [ordenPor, setOrdenPor] = useState('entrega');
  const [filtro, setFiltro] = useState('');
  const [pedidoAbiertoId, setPedidoAbiertoId] = useState(null);
  const [mostrandoHistorial, setMostrandoHistorial] = useState(false);

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
    ];

    return () => unsubs.forEach(u => u());
  }, [sinAcceso]);

  const orgsPorId = useMemo(() => new Map(organizaciones.map(o => [o.id, o])), [organizaciones]);
  const prodsPorId = useMemo(() => new Map(productos.map(p => [p.id, p])), [productos]);
  const domsPorId = useMemo(() => new Map(domicilios.map(d => [d.id, d])), [domicilios]);

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

  const filtrados = useMemo(() => {
    const texto = claveNormalizada(filtro);
    if (!texto) return pedidosConEstado;
    return pedidosConEstado.filter(p => {
      const org = orgsPorId.get(p.cliente_org_id);
      return claveNormalizada(p.numero).includes(texto)
          || claveNormalizada(p.ov).includes(texto)
          || (org && claveNormalizada(org.razon_social).includes(texto));
    });
  }, [pedidosConEstado, filtro, orgsPorId]);

  const conteosPorGrupo = useMemo(() => {
    const c = {};
    ORDEN_GRUPOS.forEach(g => { c[g] = 0; });
    filtrados.forEach(p => { c[p.estado] = (c[p.estado] || 0) + 1; });
    return c;
  }, [filtrados]);

  const visibles = useMemo(() => {
    const base = grupoActivo === 'todos' ? filtrados : filtrados.filter(p => p.estado === grupoActivo);
    return [...base].sort(comparadorDe(ordenPor, entregasPorPedido, orgsPorId));
  }, [filtrados, grupoActivo, ordenPor, entregasPorPedido, orgsPorId]);

  const resumen = useMemo(() => {
    const hoy = hoyISO();
    const en7dias = fechaSumarDias(hoy, 7);
    let sinCubrir = 0, vencidas = 0, programadasEstaSemana = 0;

    filtrados.forEach(p => {
      if (p.estado === 'suspendido' || p.estado === 'cumplido') return;
      (entregasPorPedido.get(p.id) || []).forEach(e => {
        if (e.estado === 'pendiente') {
          sinCubrir++;
          if (e.fecha_solicitada && e.fecha_solicitada < hoy) vencidas++;
        }
        if (e.estado === 'programada' && e.fecha_solicitada >= hoy && e.fecha_solicitada <= en7dias) {
          programadasEstaSemana++;
        }
      });
    });

    return { sinCubrir, vencidas, programadasEstaSemana };
  }, [filtrados, entregasPorPedido]);

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
      const { numero } = await crearPedido({ pedido, entregas: pedido.entregas, usuario, origenCarga: 'manual' });

      const org = orgsPorId.get(pedido.cliente_org_id);
      const prod = prodsPorId.get(pedido.producto_id);
      const destino = domsPorId.get(pedido.destino_domicilio_id);

      const rAviso = await llamarAppsScript(APPS_SCRIPT_URL, 'nuevo_pedido', {
        pedido_id: numero,
        cliente: org ? org.razon_social : '',
        producto: prod ? prod.nombre : '',
        tipo: pedido.tipo,
        volumen: pedido.volumen,
        ov: pedido.ov,
        lugar: destino ? textoDomicilio(destino) : '',
        banda_horaria: pedido.banda_horaria,
        obs: pedido.obs,
        creado_por: usuario.nombre || usuario.email,
      });

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

    for (let i = 0; i < interpretados.length; i++) {
      const x = interpretados[i];
      try {
        const { numero } = await crearPedido({
          pedido: x.pedido, entregas: x.entregas, usuario, origenCarga: 'carga_masiva',
        });

        creados.push({ clave: x.clave, numero });

        const org = orgsPorId.get(x.pedido.cliente_org_id);
        const prod = prodsPorId.get(x.pedido.producto_id);
        const destino = domsPorId.get(x.pedido.destino_domicilio_id);

        const rAviso = await llamarAppsScript(APPS_SCRIPT_URL, 'nuevo_pedido', {
          pedido_id: numero,
          cliente: org ? org.razon_social : '',
          producto: prod ? prod.nombre : '',
          tipo: x.pedido.tipo,
          volumen: x.pedido.volumen,
          ov: x.pedido.ov,
          lugar: destino ? textoDomicilio(destino) : '',
          banda_horaria: x.pedido.banda_horaria,
          obs: x.pedido.obs,
          creado_por: usuario.nombre || usuario.email,
        });
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

      {(resumen.vencidas > 0 || resumen.sinCubrir > 0 || resumen.programadasEstaSemana > 0) && (
        <div style={styles.franjaResumen}>
          {resumen.vencidas > 0 && (
            <span style={{ color: colorEstado.peligroTexto, fontWeight: tipografia.peso.medio }}>
              {resumen.vencidas} entrega{resumen.vencidas > 1 ? 's' : ''} vencida{resumen.vencidas > 1 ? 's' : ''} sin cubrir
            </span>
          )}
          {resumen.sinCubrir > 0 && <span>{resumen.sinCubrir} entrega(s) sin cubrir</span>}
          {resumen.programadasEstaSemana > 0 && <span>{resumen.programadasEstaSemana} programada(s) esta semana</span>}
        </div>
      )}

      <div style={styles.controlesFila}>
        <input
          style={styles.buscador}
          value={filtro}
          onChange={e => setFiltro(e.target.value)}
          placeholder="Buscar por numero, cliente u orden..."
        />
        <select
          style={styles.selectOrden}
          value={ordenPor}
          onChange={e => setOrdenPor(e.target.value)}
        >
          {ORDEN_OPCIONES.map(o => <option key={o.id} value={o.id}>Ordenar: {o.label}</option>)}
        </select>
        <div style={styles.toggleVista}>
          <button
            style={{ ...styles.toggleBtn, ...(vistaLista === 'tarjetas' ? styles.toggleBtnActivo : {}) }}
            onClick={() => setVistaLista('tarjetas')}
          >
            Tarjetas
          </button>
          <button
            style={{ ...styles.toggleBtn, ...(vistaLista === 'tabla' ? styles.toggleBtnActivo : {}) }}
            onClick={() => setVistaLista('tabla')}
          >
            Tabla
          </button>
        </div>
      </div>

      <div style={styles.pastillasGrupo}>
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
      </div>

      {cargando && <Vacio titulo="Cargando..." />}
      {!cargando && visibles.length === 0 && <Vacio titulo="No hay pedidos que coincidan." />}

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
          domiciliosDeCliente={domiciliosDeCliente}
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

// Version mas oscura que colorEstado.advertenciaBorde (#F59E0B) para el
// segmento "programado" de la barra: sobre colores.fondoAlterno (#F3F4F6)
// el ambar base da un contraste demasiado bajo (~1.9:1) y el segmento se
// pierde contra el fondo de la barra. Este tono (ambar-600) sube el
// contraste a ~3:1 sin tocar el token global (que sigue usandose para
// bordes/texto de advertencia en otros lados).
const COLOR_PROGRAMADA_BARRA = '#D97706';

function BarraProgreso({ total, cubiertas, cumplidas }) {
  const styles = useEstilos();
  if (!total) return null;
  const pctCumplidas = Math.max(0, Math.min(100, (cumplidas / total) * 100));
  const pctProgramadas = Math.max(0, Math.min(100 - pctCumplidas, ((cubiertas - cumplidas) / total) * 100));

  return (
    <div style={styles.progresoWrap}>
      <div style={styles.progresoBarra}>
        {pctCumplidas > 0 && <div style={{ width: `${pctCumplidas}%`, background: colorEstado.exitoBorde }} />}
        {pctProgramadas > 0 && <div style={{ width: `${pctProgramadas}%`, background: COLOR_PROGRAMADA_BARRA }} />}
      </div>
      <span style={styles.progresoTexto}>{cumplidas}/{total}</span>
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

function PastillaGrupo({ activo, onClick, label, colores }) {
  const { colores: coloresTema } = useTema();
  const bg = activo ? (colores ? colores.bg : marca) : coloresTema.fondoAlterno;
  const color = activo ? (colores ? colores.color : '#fff') : coloresTema.textoSuave;
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

function FilaPedido({ pedido: p, org, prod, entregas, onClick }) {
  const styles = useEstilos();
  const { colores } = useTema();
  const cumplidas = p.entregas_cumplidas || 0;
  const cubiertas = p.entregas_cubiertas || 0;
  const total = p.entregas_total || 0;
  const colorEst = COLOR_PEDIDO[p.estado] || COLOR_PEDIDO.pendiente;

  return (
    <Tarjeta
      onClick={onClick}
      style={{ marginBottom: espacio.sm, padding: '12px 16px', borderLeft: `3px solid ${colorEst ? colorEst.bg : colores.borde}` }}
    >
      <div style={styles.filaContenido}>
        <Pastilla colores={colorEst}>{ETIQUETA_PEDIDO[p.estado] || p.estado}</Pastilla>
        <span style={styles.filaCliente}>{org ? org.razon_social : '-'}</span>
        <span style={styles.filaProducto}>{prod ? prod.nombre : '-'}</span>
        <span style={styles.filaVolumen}>{p.volumen} tn</span>
        <span style={styles.filaOv}>{p.ov}</span>
        <div style={{ width: 110, flexShrink: 0 }}>
          <BarraProgreso total={total} cubiertas={cubiertas} cumplidas={cumplidas} />
        </div>
        <span style={styles.filaNumero}>{p.numero}</span>
      </div>
    </Tarjeta>
  );
}

function TablaPedidos({ pedidos, orgsPorId, prodsPorId, entregasPorPedido, onFilaClick }) {
  const columnas = [
    {
      clave: 'estado', titulo: 'Estado',
      render: p => <Pastilla chico colores={COLOR_PEDIDO[p.estado]}>{ETIQUETA_PEDIDO[p.estado] || p.estado}</Pastilla>,
    },
    { clave: 'cliente', titulo: 'Cliente', render: p => (orgsPorId.get(p.cliente_org_id) || {}).razon_social || '-' },
    { clave: 'producto', titulo: 'Producto', render: p => (prodsPorId.get(p.producto_id) || {}).nombre || '-' },
    { clave: 'volumen', titulo: 'Volumen', numerica: true, render: p => `${p.volumen} tn` },
    { clave: 'ov', titulo: 'OV / OC', render: p => p.ov },
    {
      clave: 'progreso', titulo: 'Avance',
      render: p => (
        <div style={{ width: 110 }}>
          <BarraProgreso total={p.entregas_total || 0} cubiertas={p.entregas_cubiertas || 0} cumplidas={p.entregas_cumplidas || 0} />
        </div>
      ),
    },
    { clave: 'numero', titulo: 'N', render: p => p.numero },
  ];

  return <Tabla columnas={columnas} filas={pedidos} obtenerId={p => p.id} onFilaClick={onFilaClick} />;
}

function ModalDetallePedido({
  pedido: p, entregas, org, prod, domsPorId, domiciliosDeCliente, usuario, onCerrar, onVerHistorial,
}) {
  const styles = useEstilos();
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
  const colorEstadoPedido = COLOR_PEDIDO[p.estado] || COLOR_PEDIDO.pendiente;

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
      const { yaEstaba, avisosApps } = await suspenderPedido({ pedidoId: p.id, motivo, usuario, appsScriptUrl: APPS_SCRIPT_URL });
      if (!yaEstaba) {
        // El mail a coordinadores de "pedido suspendido" -- quedó afuera al
        // partir la lógica en funciones chicas. El aviso al transportista NO
        // se duplica acá: ya sale, uno por despacho afectado, como `aviso`
        // in-app dentro de `cancelarDespacho()` (que `suspenderPedido()` ya
        // llama por cada despacho vivo).
        await llamarAppsScript(APPS_SCRIPT_URL, 'suspender_pedido', {
          id: p.numero,
          producto: prod ? prod.nombre : '',
          volumen: p.volumen,
          cliente: org ? org.razon_social : '',
          ov: p.ov,
          fecha_entrega: proximaFechaPendiente(entregas) || '',
          suspendido_por: usuario.nombre || usuario.email,
          motivo,
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
    <Modal titulo={`Pedido ${p.numero}`} onCerrar={onCerrar} ancho={880}>
      <div style={{ ...styles.franjaEstadoModal, background: colorEstadoPedido.bg }} />
      <div style={styles.modalDosColumnas}>

        <div style={styles.modalColumna}>
          <div style={styles.estadoModalFila}>
            <Pastilla colores={colorEstadoPedido}>
              {ETIQUETA_PEDIDO[p.estado] || p.estado}
            </Pastilla>
            <span style={styles.volumenModal}>{p.volumen} tn</span>
          </div>

          <div style={styles.modalGrid}>
            <Dato label="Cliente" valor={org ? org.razon_social : ''} />
            <Dato label="Producto" valor={prod ? prod.nombre : ''} />
            <Dato label="Orden" valor={p.ov} />
            <Dato label="Tipo" valor={p.tipo} />
            <Dato label="Recipiente" valor={p.recipiente} />
            <Dato label="Banda horaria" valor={p.banda_horaria} />
            {!esEntregaAlCliente && (
              <Dato label="Destino" valor={destinoPedido ? textoDomicilio(destinoPedido) : ''} />
            )}
            {esEntregaAlCliente && (
              <Dato label="Destino" valor="Varia por entrega ->" completo />
            )}
          </div>

          {p.obs && <div style={styles.obsBox}>{p.obs}</div>}

          <div style={styles.progresoModalWrap}>
            <BarraProgreso total={p.entregas_total || 0} cubiertas={p.entregas_cubiertas || 0} cumplidas={p.entregas_cumplidas || 0} />
          </div>

          <div style={styles.accionesColumna}>
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
                <Boton variante="secundario" onClick={() => setEditandoDomicilio(true)}>Editar domicilio</Boton>
              )
            )}

            {esInternoUsuario && pedidoActivo && (
              <Boton variante="peligro" disabled={suspendiendo} onClick={handleSuspender}>
                {suspendiendo ? 'Suspendiendo...' : 'Suspender pedido'}
              </Boton>
            )}

            <Boton variante="secundario" onClick={onVerHistorial}>Ver historial</Boton>
          </div>
        </div>

        <div style={styles.modalColumna}>
          <div style={styles.entregasTitulo}>Entregas</div>

          {entregas.map(e => {
            const puedeEditarFecha = esInternoUsuario && pedidoActivo && e.estado !== 'cumplida' && e.estado !== 'suspendida';
            const puedeSuspender = puedeEditarFecha && e.estado === 'pendiente';
            const puedeReactivar = esInternoUsuario && pedidoActivo && e.estado === 'suspendida';
            const puedeEditarDestino = puedeEditarFecha && esEntregaAlCliente;
            const destinoEntrega = esEntregaAlCliente
              ? domsPorId.get(e.destino_domicilio_id || p.destino_domicilio_id)
              : null;

            const colorBordeEntrega = COLOR_ENTREGA[e.estado] || COLOR_ENTREGA.pendiente;

            return (
              <div
                key={e.id}
                style={{
                  ...styles.entregaCard,
                  borderLeft: `3px solid ${colorBordeEntrega.borde}`,
                  opacity: e.estado === 'suspendida' ? 0.65 : 1,
                }}
              >
                <div style={styles.entregaHeader}>
                  <span style={styles.entregaNroChico}>#{e.numero}</span>
                  <span style={styles.entregaVol}>{e.volumen} tn</span>
                  <span style={styles.entregaFecha}>{e.fecha_solicitada}</span>
                  <Pastilla chico colores={{ bg: colorBordeEntrega.fondo, color: colorBordeEntrega.texto }}>
                    {ETIQUETA_ENTREGA[e.estado] || e.estado}
                  </Pastilla>
                </div>

                {esEntregaAlCliente && (
                  <div style={styles.entregaDestino}>
                    {destinoEntrega ? textoDomicilio(destinoEntrega) : 'Sin domicilio cargado'}
                  </div>
                )}

                <div style={styles.entregaAcciones}>
                  {puedeEditarFecha && (
                    <Boton chico variante="secundario" style={styles.btnEditarFecha} onClick={() => abrirEdicionFecha(e)}>
                      Editar fecha
                    </Boton>
                  )}
                  {puedeEditarDestino && (
                    <Boton chico variante="secundario" style={styles.btnEditarDireccion} onClick={() => abrirEdicionDestino(e)}>
                      Editar direccion
                    </Boton>
                  )}
                  {puedeSuspender && (
                    <Boton chico variante="secundario" disabled={suspendiendoEntregaId === e.id} onClick={() => suspenderEntregaSuelta(e)}>
                      {suspendiendoEntregaId === e.id ? 'Suspendiendo...' : 'Suspender'}
                    </Boton>
                  )}
                  {puedeReactivar && (
                    <Boton chico variante="secundario" disabled={reactivandoEntregaId === e.id} onClick={() => reactivar(e)}>
                      {reactivandoEntregaId === e.id ? 'Reactivando...' : 'Reactivar'}
                    </Boton>
                  )}
                </div>

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
                {filasNuevas.map((fila, i) => (
                  <div key={i} style={styles.entregaFilaForm}>
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
                ))}
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
              <Boton
                variante="secundario"
                onClick={abrirAgregarEntregas}
                style={{
                  marginTop: espacio.sm,
                  ...(limiteDeVolumenAlcanzado ? styles.btnAcentoAdvertencia : {}),
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
  domicilioPlanta, domsPorId, sumaEntregas,
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

          {form.entregas.map((e, i) => (
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
          ))}

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

function Dato({ label, valor, completo }) {
  const styles = useEstilos();
  const tieneValor = completo || (valor !== undefined && valor !== null && valor !== '');
  return (
    <div style={styles.field}>
      <span style={styles.label}>{label}</span>
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

function crearEstilos(colores) {
  return {
    wrap: { maxWidth: 960, margin: '0 auto', padding: '1.5rem 1rem', background: colores.fondo, color: colores.texto },
    panelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' },
    titulo: { fontSize: 18, fontWeight: 500, color: colores.texto },

    franjaResumen: { display: 'flex', gap: 16, flexWrap: 'wrap', padding: '8px 2px', fontSize: 12, color: colores.textoSuave, marginBottom: 10 },

    controlesFila: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' },
    buscador: { flex: '2 1 220px', fontSize: 13, padding: '8px 12px', borderRadius: 8, border: `0.5px solid ${colores.borde}`, color: colores.texto, background: colores.superficie },
    selectOrden: { flex: '1 1 180px', fontSize: 12, padding: '8px 10px', borderRadius: 8, border: `0.5px solid ${colores.borde}`, color: colores.textoSecundario, background: colores.superficie },
    toggleVista: { display: 'flex', border: `0.5px solid ${colores.borde}`, borderRadius: 8, overflow: 'hidden', flexShrink: 0 },
    toggleBtn: { padding: '7px 14px', fontSize: 12, background: colores.superficie, color: colores.textoSuave, border: 'none', cursor: 'pointer' },
    // Texto siempre blanco -- es sobre el rojo de marca, fijo en los dos temas.
    toggleBtnActivo: { background: marca, color: '#fff' },

    pastillasGrupo: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 },

    progresoWrap: { display: 'flex', alignItems: 'center', gap: 8 },
    progresoBarra: { flex: 1, height: 6, borderRadius: 4, overflow: 'hidden', display: 'flex', background: colores.fondoAlterno },
    progresoTexto: { fontSize: 11, color: colores.textoTenue, flexShrink: 0, fontVariantNumeric: 'tabular-nums' },
    progresoModalWrap: { margin: '14px 0' },

    filaContenido: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
    filaCliente: { fontSize: 13, fontWeight: 500, color: colores.texto, flex: 2, minWidth: 110 },
    filaProducto: { fontSize: 12, color: colores.textoSuave, flex: 1, minWidth: 70 },
    filaVolumen: { fontSize: 12, color: colores.textoSuave, flexShrink: 0 },
    filaOv: { fontSize: 12, color: colores.textoSuave, fontFamily: 'monospace', flexShrink: 0 },
    filaNumero: { fontSize: 11, color: colores.textoTenue, fontFamily: 'monospace', flexShrink: 0, marginLeft: 'auto' },

    modalDosColumnas: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 },
    modalColumna: { display: 'flex', flexDirection: 'column' },
    modalGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 10 },
    field: { display: 'flex', flexDirection: 'column', gap: 3 },
    label: { fontSize: 11, color: colores.textoTenue },
    valor: { fontSize: 13, color: colores.texto },
    obsBox: { fontSize: 12, color: colores.textoSuave, padding: '8px 10px', background: colores.fondoAlterno, borderRadius: 8, marginBottom: 10 },
    accionesColumna: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 },

    entregasTitulo: { fontSize: 11, color: colores.textoTenue, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 },
    entregaCard: { border: `0.5px solid ${colores.borde}`, borderRadius: 10, padding: '10px 12px', marginBottom: 8 },
    entregaHeader: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 },
    entregaNroChico: { color: colores.textoTenue, width: 24, fontFamily: 'monospace', fontSize: 12 },
    entregaVol: { color: colores.texto, fontSize: 12, width: 60 },
    entregaFecha: { color: colores.textoSuave, fontSize: 12, width: 90 },
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
    resultadoItem: { fontSize: 12, fontFamily: 'monospace', marginBottom: 2 },

    /* --- Rediseno v2: contraste de pastillas y campos --- */
    franjaEstadoModal: { height: 4, borderRadius: '10px 10px 0 0', margin: '-1.5rem -1.5rem 1rem' },
    estadoModalFila: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
    volumenModal: { fontSize: 15, fontWeight: tipografia.peso.negrita, color: colores.texto },
    valorCompleto: { fontSize: 13, color: colores.texto, fontWeight: tipografia.peso.medio },
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
  const { colores } = useTema();
  return useMemo(() => crearEstilos(colores), [colores]);
}
