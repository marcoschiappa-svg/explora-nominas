/**
 * =============================================================================
 * NuevoTarifario.js — Registro maestro de rutas y tarifas (Portal Explora)
 * =============================================================================
 *
 * PROPÓSITO
 * Cuánto sale llevar un producto de un lugar a otro, con un registro MAESTRO
 * de rutas cuya tarifa solo cambia por un indicador (CATAMP/CATAC) aprobado
 * por el admin, y rutas DERIVADAS cuya tarifa se calcula siempre en vivo a
 * partir de la maestra de la que dependen — nunca se guarda como verdad.
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (rediseño NuevoTarifario) — ORQUESTADOR, PANTALLA PARTIDA EN `nuevo-tarifario/`
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     El archivo de 1193 líneas (RF-09/RF-09b) funcionaba, pero su interfaz
 *     no seguía el lenguaje visual que ya tienen Pedidos y Programación
 *     (tipografía Montserrat, `ui/tokens.js`, `PanelLista`, `BarraFiltros`,
 *     modales de dos columnas con panel cálido) — y superaba largamente las
 *     ~700 líneas que el resto del portal usa como techo por archivo.
 *
 *   CAUSA RAÍZ
 *     Esta pantalla nació (RF-09) antes de que existieran los componentes
 *     compartidos de `ui/` que hoy tienen Pedidos/Programación — nunca se
 *     migró.
 *
 *   ALCANCE
 *     Este archivo queda como ORQUESTADOR: suscripciones Firestore
 *     (`consultaRutas`, tabla CATAC), permisos por rol, estado de filtros/
 *     orden (`filtros-listado.js`, persistido con `leerPreferencias`/
 *     `guardarPreferencias('nuevo_tarifario', ...)`, igual patrón que
 *     `Programacion.js`), estado de qué modal está abierto, y arma las
 *     props de:
 *       - `nuevo-tarifario/RegistroVigente.js` (Paso 3)
 *       - `nuevo-tarifario/RutasDerivadas.js` (Paso 4)
 *       - `nuevo-tarifario/Historial.js` (Paso 5)
 *       - `nuevo-tarifario/Actualizaciones.js` (Paso 6, solo admin)
 *       - `nuevo-tarifario/ModalDetalleRuta.js` (Paso 3/4, `tipo`)
 *       - `nuevo-tarifario/ModalNuevaMaestra.js` / `ModalGenerarDerivada.js` (Paso 7)
 *       - `nuevo-tarifario/CampoConSugerencias.js` (mudado tal cual)
 *       - `nuevo-tarifario/estilos.js` (un solo `useEstilos()` compartido)
 *     "Generar ruta derivada" y "Nueva ruta maestra" dejan de ser pestañas:
 *     pasan a ser MODALES abiertos desde el encabezado (Paso 1). El viejo
 *     modal "Editar ruta derivada" se mantiene, ahora abierto desde el botón
 *     "Editar / reasignar maestra" de `ModalDetalleRuta` (`tipo="derivada"`)
 *     — se queda local a este archivo (no es uno de los 8 componentes que
 *     pide la tarea, y es chico: un solo formulario).
 *     NINGUNA llamada a `logica-tarifario.js`/`calculo-tarifario.js` cambia:
 *     esos dos módulos no se tocan.
 *
 *   DECISIONES DE DETALLE (no explícitas en la spec, tomadas acá)
 *     - Un único estado de `filtros`/`grupoActivo`/`ordenPor`/`ordenSentido`
 *       (`filtros-listado.js`) se comparte entre "Registro vigente" y "Rutas
 *       derivadas" (las dos pestañas con `BarraFiltros`) — los dos modelos
 *       comparten `categoria`/`producto`/`km`/`actualizacion`, así que una
 *       sola preferencia persistida alcanza; "Historial" tiene su propio
 *       panel de filtros simple (Paso 5 lo permite explícitamente).
 *     - El enlace "N rutas derivadas que dependen de esta" (detalle de una
 *       maestra) filtra Rutas derivadas por `ruta_maestra_id` con un estado
 *       LOCAL (`filtroMaestraId`), aparte de `filtros-listado.js` — ese
 *       archivo no tiene (ni se le agrega) un campo "por maestra".
 *     - El criterio de orden `'brecha'` ordena por el BALDE
 *       (`bajo`/`enRango`/`sobre`, alfabético) y no por el valor numérico:
 *       `valorDeOrden()`/`aplicarFiltros()` usan la MISMA clave `brecha`
 *       para filtrar (selección múltiple, necesita el balde) y para
 *       ordenar — no se puede tener las dos cosas con una sola función sin
 *       tocar `filtros-listado.js`, fuera del alcance de esta tarea.
 *
 *   LIMITACIONES CONOCIDAS
 *     Las heredadas del archivo original (ver las dos entradas de
 *     encabezado más abajo, RF-09 y RF-09b, que se conservan tal cual por
 *     prolijidad histórica) + las nuevas documentadas en cada componente de
 *     `nuevo-tarifario/`.
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm test` y `CI=true npm run build` sin warnings. Manual: ver
 *     la lista de pruebas de `NuevoTarifario` en el CHANGELOG v1.2.0.
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (RF-09) — PANTALLA NUEVA, EN PARALELO AL TARIFARIO LEGACY
 * -----------------------------------------------------------------------------
 *   Reutiliza toda la lógica de `logica-tarifario.js`/`calculo-tarifario.js`:
 *   esta pantalla SOLO LLAMA, ninguna regla de negocio vive acá. Pestañas por
 *   rol: Registro vigente e Historial (todos), Rutas derivadas (todos;
 *   coordinador edita/desactiva las suyas), Generar derivada y Actualizar por
 *   indicador según rol (ver más arriba). Solo LEE `portal/catac`.
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (RF-09b) — RUTAS DE TEXTO, SIN VÍNCULO A ORGANIZACIONES/DOMICILIOS/PRODUCTOS
 * -----------------------------------------------------------------------------
 *   `origen`, `destino` y `producto` son TRES CAMPOS DE TEXTO: se muestran tal
 *   como están guardados, sin resolver contra ninguna colección.
 *   `CampoConSugerencias` sugiere valores ya cargados en el registro maestro
 *   para ese campo, sin bloquear un valor nuevo.
 * ========================================================================== */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { db } from '../firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import * as XLSX from 'xlsx';

import { esAdmin, tieneRol, motivoSinAcceso } from '../sesion';
import { rolesDe } from '../modulos';

import { getCatacTabla, calcularTarifaDerivada, brechaContraCatac } from '../calculo-tarifario';
import {
  CATEGORIAS, consultaRutas, rutasParametro, rutasDerivadas, puedeEditarDerivada,
  leerTarifasDeRuta, desactivarRuta, editarRutaDerivada, calcularVariacion,
} from '../logica-tarifario';

import {
  filtrosVacios, aplicarFiltros, comparador, filtrosActivos,
  leerPreferencias, guardarPreferencias, timestampAFechaISO,
} from '../filtros-listado';

import { espacio } from '../shared/tokens';
import Boton from '../ui/Boton';
import Modal from '../ui/Modal';
import Segmentado from '../ui/Segmentado';
import BarraFiltros from '../ui/BarraFiltros';
import PastillaGrupo from '../ui/PastillaGrupo';
import AvisoClickeable, { FranjaAvisos } from '../ui/AvisoClickeable';

import { useEstilos } from './nuevo-tarifario/estilos';
import RegistroVigente, { bucketBrecha } from './nuevo-tarifario/RegistroVigente';
import RutasDerivadas from './nuevo-tarifario/RutasDerivadas';
import Historial from './nuevo-tarifario/Historial';
import Actualizaciones from './nuevo-tarifario/Actualizaciones';
import ModalDetalleRuta from './nuevo-tarifario/ModalDetalleRuta';
import ModalNuevaMaestra from './nuevo-tarifario/ModalNuevaMaestra';
import GenerarDerivada from './nuevo-tarifario/GenerarDerivada';

function tsMillis(valor) {
  if (!valor) return 0;
  if (typeof valor.toMillis === 'function') return valor.toMillis();
  const d = new Date(valor);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

const BRECHA_OPCIONES = [
  { id: 'bajo', label: 'Bajo CATAC' },
  { id: 'enRango', label: 'En rango' },
  { id: 'sobre', label: 'Sobre CATAC' },
];

const ORDEN_OPCIONES_REGISTRO = [
  { id: 'origen', label: 'Origen' },
  { id: 'destino', label: 'Destino' },
  { id: 'producto', label: 'Producto' },
  { id: 'km', label: 'Km' },
  { id: 'tarifa', label: 'Tarifa vigente' },
  { id: 'brecha', label: 'Brecha' },
  { id: 'actualizacion', label: 'Fecha de actualización' },
];

const ORDEN_OPCIONES_DERIVADAS = [
  { id: 'origen', label: 'Origen' },
  { id: 'destino', label: 'Destino' },
  { id: 'producto', label: 'Producto' },
  { id: 'km', label: 'Km' },
  { id: 'tarifa', label: 'Tarifa al día' },
  { id: 'actualizacion', label: 'Fecha de alta' },
  { id: 'creadoPor', label: 'Creador' },
];

export default function NuevoTarifario({ usuario, onVolver }) {
  const S = useEstilos();

  const isAdmin = esAdmin(usuario);
  const soyCoordinador = tieneRol(usuario, 'coordinador');
  const sinAcceso = motivoSinAcceso(usuario, rolesDe('nuevo_tarifario'));

  const [tab, setTab] = useState('registro'); // 'registro' | 'derivadas' | 'historial' | 'actualizaciones'
  const [rutas, setRutas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [catacTabla, setCatacTabla] = useState(null);
  const [catacVer, setCatacVer] = useState(null);

  useEffect(() => {
    if (sinAcceso) { setLoading(false); return; }
    const unsub = onSnapshot(consultaRutas(usuario), snap => {
      setRutas(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinAcceso]);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'portal', 'catac'), snap => {
      if (snap.exists()) {
        const d = snap.data();
        setCatacTabla(d.datos || null);
        setCatacVer(d.ver || null);
      }
    });
    return unsub;
  }, []);

  const maestras = useMemo(() => rutasParametro(rutas), [rutas]);
  const derivadas = useMemo(() => rutasDerivadas(rutas), [rutas]);
  const maestraPorId = useMemo(() => new Map(maestras.map(m => [m.id, m])), [maestras]);
  const getCatac = useCallback(km => getCatacTabla(catacTabla, km), [catacTabla]);

  const sugerenciasDe = useCallback(campo => {
    const set = new Set(maestras.map(m => m[campo]).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
  }, [maestras]);
  const sugOrigenes = useMemo(() => sugerenciasDe('origen'), [sugerenciasDe]);
  const sugDestinos = useMemo(() => sugerenciasDe('destino'), [sugerenciasDe]);
  const sugProductos = useMemo(() => sugerenciasDe('producto'), [sugerenciasDe]);
  const maestrasConProducto = useMemo(() => maestras.map(m => ({ ...m, producto_nombre: m.producto })), [maestras]);

  /* ── Datos derivados: maestras con brecha/CATAC, derivadas con cálculo ── */

  const maestrasConCalc = useMemo(() => maestras.map(m => {
    const catacRef = getCatac(m.km);
    const brecha = brechaContraCatac(m.tarifa_vigente, catacRef);
    return { ...m, catacRef, brecha, _bucketBrecha: bucketBrecha(brecha) };
  }), [maestras, getCatac]);

  const derivadasConCalc = useMemo(() => derivadas.map(d => {
    const maestra = maestraPorId.get(d.ruta_maestra_id) || null;
    const calc = calcularTarifaDerivada(d, maestra, catacTabla);
    const variacionDesdeCreacion = calc.tarifa != null ? calcularVariacion(d.tarifa_al_crear, calc.tarifa) : null;
    return {
      ...d, calc, variacionDesdeCreacion,
      maestraTxt: maestra ? `${maestra.origen} → ${maestra.destino}` : 'Sin maestra',
      _calc: calc,
    };
  }), [derivadas, maestraPorId, catacTabla]);

  /* ── Filtros/orden compartidos (Registro vigente + Rutas derivadas) ──── */

  const [textoFiltro, setTextoFiltro] = useState('');
  const [filtros, setFiltros] = useState(filtrosVacios());
  const [grupoActivo, setGrupoActivo] = useState('todas');
  const [ordenPor, setOrdenPor] = useState('origen');
  const [ordenSentido, setOrdenSentido] = useState('asc');
  const [filtroMaestraId, setFiltroMaestraId] = useState(null);

  const prefsAplicadasRef = useRef(false);
  useEffect(() => {
    if (prefsAplicadasRef.current || loading || !usuario || !usuario.uid) return;
    prefsAplicadasRef.current = true;
    const validos = {
      productos: new Set([...maestras, ...derivadas].map(r => r.producto).filter(Boolean)),
      creadoPor: new Set(derivadas.map(d => d.creado_por_uid).filter(Boolean)),
      brecha: new Set(['bajo', 'enRango', 'sobre']),
    };
    const prefs = leerPreferencias('nuevo_tarifario', usuario.uid, validos);
    if (prefs) {
      if (prefs.filtros) setFiltros(f => ({ ...f, ...prefs.filtros }));
      if (prefs.grupoActivo) setGrupoActivo(prefs.grupoActivo);
      if (prefs.ordenPor) setOrdenPor(prefs.ordenPor);
      if (prefs.ordenSentido) setOrdenSentido(prefs.ordenSentido);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, usuario && usuario.uid]);

  useEffect(() => {
    if (!prefsAplicadasRef.current || !usuario || !usuario.uid) return;
    const id = setTimeout(() => {
      guardarPreferencias('nuevo_tarifario', usuario.uid, { filtros, grupoActivo, ordenPor, ordenSentido });
    }, 300);
    return () => clearTimeout(id);
  }, [filtros, grupoActivo, ordenPor, ordenSentido, usuario]);

  const extractoresRegistro = useMemo(() => ({
    productoId: r => r.producto,
    km: r => Number(r.km),
    brecha: r => r._bucketBrecha,
    fechaActualizacion: r => timestampAFechaISO(r.tarifa_actualizada_en),
    actualizacion: r => timestampAFechaISO(r.tarifa_actualizada_en),
    origen: r => r.origen,
    destino: r => r.destino,
    productoNombre: r => r.producto,
    tarifa: r => Number(r.tarifa_vigente),
  }), []);

  const extractoresDerivadas = useMemo(() => ({
    productoId: d => d.producto,
    creadoPorUid: d => d.creado_por_uid,
    km: d => Number(d.km),
    fechaActualizacion: d => timestampAFechaISO(d.fecha_calculo),
    actualizacion: d => timestampAFechaISO(d.fecha_calculo),
    tieneMaestraInactiva: d => d._calc.maestraInactiva,
    origen: d => d.origen,
    destino: d => d.destino,
    productoNombre: d => d.producto,
    tarifa: d => d._calc.tarifa,
    creadoPorNombre: d => d.creado_por_uid,
  }), []);

  const textoFiltroL = textoFiltro.trim().toLowerCase();
  function pasaTexto(r) {
    if (!textoFiltroL) return true;
    return (r.origen || '').toLowerCase().includes(textoFiltroL)
      || (r.destino || '').toLowerCase().includes(textoFiltroL)
      || (r.producto || '').toLowerCase().includes(textoFiltroL);
  }

  const registroBaseFiltrado = useMemo(
    () => aplicarFiltros(maestrasConCalc.filter(pasaTexto), filtros, extractoresRegistro),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [maestrasConCalc, textoFiltroL, filtros, extractoresRegistro]
  );
  const conteosPorCategoria = useMemo(() => {
    const c = {};
    CATEGORIAS.forEach(cat => { c[cat] = 0; });
    registroBaseFiltrado.forEach(r => { c[r.categoria] = (c[r.categoria] || 0) + 1; });
    return c;
  }, [registroBaseFiltrado]);
  const filasRegistroVisibles = useMemo(() => {
    const base = grupoActivo === 'todas' ? registroBaseFiltrado : registroBaseFiltrado.filter(r => r.categoria === grupoActivo);
    return [...base].sort(comparador(ordenPor, ordenSentido, extractoresRegistro));
  }, [registroBaseFiltrado, grupoActivo, ordenPor, ordenSentido, extractoresRegistro]);

  const derivadasBaseFiltrado = useMemo(() => {
    let base = aplicarFiltros(derivadasConCalc.filter(pasaTexto), filtros, extractoresDerivadas);
    if (filtroMaestraId) base = base.filter(d => d.ruta_maestra_id === filtroMaestraId);
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivadasConCalc, textoFiltroL, filtros, extractoresDerivadas, filtroMaestraId]);
  const conteosPorCategoriaDerivadas = useMemo(() => {
    const c = {};
    CATEGORIAS.forEach(cat => { c[cat] = 0; });
    derivadasBaseFiltrado.forEach(d => { c[d.categoria] = (c[d.categoria] || 0) + 1; });
    return c;
  }, [derivadasBaseFiltrado]);
  const filasDerivadasVisibles = useMemo(() => {
    const base = grupoActivo === 'todas' ? derivadasBaseFiltrado : derivadasBaseFiltrado.filter(d => d.categoria === grupoActivo);
    return [...base].sort(comparador(ordenPor, ordenSentido, extractoresDerivadas));
  }, [derivadasBaseFiltrado, grupoActivo, ordenPor, ordenSentido, extractoresDerivadas]);

  const opcionesProductos = useMemo(() => {
    const set = new Set([...maestras, ...derivadas].map(r => r.producto).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es')).map(p => ({ id: p, label: p }));
  }, [maestras, derivadas]);

  const opcionesCreadores = useMemo(() => {
    const set = new Set(derivadas.map(d => d.creado_por_uid).filter(Boolean));
    return Array.from(set).map(uid => ({ id: uid, label: uid === (usuario && usuario.uid) ? 'Vos' : uid }));
  }, [derivadas, usuario]);

  const controlesRegistro = useMemo(() => [
    { campo: 'productos', tipo: 'multi', etiqueta: 'Producto', opciones: opcionesProductos },
    { campo: 'km', tipo: 'rangoNumero', etiqueta: 'Km' },
    { campo: 'brecha', tipo: 'multi', etiqueta: 'Brecha', opciones: BRECHA_OPCIONES },
    { campo: 'actualizacion', tipo: 'rango', etiqueta: 'Fecha de actualización' },
  ], [opcionesProductos]);

  const controlesDerivadas = useMemo(() => [
    { campo: 'productos', tipo: 'multi', etiqueta: 'Producto', opciones: opcionesProductos },
    { campo: 'km', tipo: 'rangoNumero', etiqueta: 'Km' },
    { campo: 'actualizacion', tipo: 'rango', etiqueta: 'Fecha de alta' },
    { campo: 'creadoPor', tipo: 'multi', etiqueta: 'Creador', opciones: opcionesCreadores },
  ], [opcionesProductos, opcionesCreadores]);

  const hayFiltrosActivosRegistro = filtrosActivos(filtros) || grupoActivo !== 'todas' || !!textoFiltro;
  const hayFiltrosActivosDerivadas = hayFiltrosActivosRegistro || !!filtroMaestraId;

  function limpiarFiltros() {
    setFiltros(filtrosVacios());
    setGrupoActivo('todas');
    setTextoFiltro('');
    setFiltroMaestraId(null);
  }

  const piePastillasCategoria = (total) => (
    <>
      <PastillaGrupo activo={grupoActivo === 'todas'} onClick={() => setGrupoActivo('todas')} label={`Todas (${total})`} />
      {CATEGORIAS.map(c => (
        <PastillaGrupo
          key={c}
          activo={grupoActivo === c}
          onClick={() => setGrupoActivo(c)}
          label={`${c} (${tab === 'derivadas' ? conteosPorCategoriaDerivadas[c] || 0 : conteosPorCategoria[c] || 0})`}
        />
      ))}
    </>
  );

  /* ── Vista (Filas/Tabla) de Registro vigente ─────────────────────────── */
  // 'tabla' por defecto -- feedback de revisión: la tabla es la vista
  // preferente acá (más datos de un vistazo que las filas).
  const [vistaRegistro, setVistaRegistro] = useState('tabla');

  /* ── Avisos clickeables ───────────────────────────────────────────────── */
  const pendientesCount = useMemo(() => maestras.filter(m => m.pendiente).length, [maestras]);
  const derivadasInactivasCount = useMemo(() => derivadasConCalc.filter(d => d.calc.maestraInactiva).length, [derivadasConCalc]);

  /* ── Modales ──────────────────────────────────────────────────────────── */
  const [modalNuevaMaestra, setModalNuevaMaestra] = useState(false);
  const [modalDetalle, setModalDetalle] = useState(null); // { tipo: 'maestra'|'derivada', id } | null
  const [detalleHistorial, setDetalleHistorial] = useState(null);
  const [modalEditarDerivada, setModalEditarDerivada] = useState(null); // ruta | null

  const rutaDetalle = useMemo(() => {
    if (!modalDetalle) return null;
    return modalDetalle.tipo === 'maestra'
      ? maestrasConCalc.find(m => m.id === modalDetalle.id) || null
      : derivadasConCalc.find(d => d.id === modalDetalle.id) || null;
  }, [modalDetalle, maestrasConCalc, derivadasConCalc]);

  const abrirDetalleMaestra = useCallback(async (ruta) => {
    setModalDetalle({ tipo: 'maestra', id: ruta.id });
    setDetalleHistorial(null);
    try {
      setDetalleHistorial(await leerTarifasDeRuta(ruta.id));
    } catch (e) {
      console.error('NuevoTarifario: error leyendo historial de la ruta', e);
      setDetalleHistorial([]);
    }
  }, []);
  const abrirDetalleDerivada = useCallback((ruta) => setModalDetalle({ tipo: 'derivada', id: ruta.id }), []);
  const cerrarDetalle = useCallback(() => { setModalDetalle(null); setDetalleHistorial(null); }, []);

  const verDerivadasDeMaestra = useCallback((maestra) => {
    setFiltroMaestraId(maestra.id);
    setTab('derivadas');
    cerrarDetalle();
  }, [cerrarDetalle]);

  const desactivarMaestraClick = async () => {
    if (!rutaDetalle) return;
    if (!window.confirm(`¿Desactivar la ruta maestra ${rutaDetalle.origen} → ${rutaDetalle.destino}?`)) return;
    try {
      await desactivarRuta({ ruta: rutaDetalle, usuario });
      cerrarDetalle();
    } catch (e) {
      alert(e.message || 'No se pudo desactivar la ruta.');
    }
  };

  const desactivarDerivadaClick = async () => {
    if (!rutaDetalle) return;
    if (!window.confirm(`¿Desactivar la derivada ${rutaDetalle.origen} → ${rutaDetalle.destino}?`)) return;
    try {
      await desactivarRuta({ ruta: rutaDetalle, usuario });
      cerrarDetalle();
    } catch (e) {
      alert(e.message || 'No se pudo desactivar la ruta.');
    }
  };

  /* ── Historial general (pestaña Historial) ───────────────────────────── */
  const [histCargando, setHistCargando] = useState(false);
  const [histFilas, setHistFilas] = useState(null);

  const cargarHistorialGeneral = useCallback(async () => {
    if (maestras.length === 0) { setHistFilas([]); return; }
    setHistCargando(true);
    try {
      const porRuta = await Promise.all(maestras.map(async m => {
        const cambios = await leerTarifasDeRuta(m.id);
        return cambios.map(c => ({ ...c, ruta: m }));
      }));
      setHistFilas(porRuta.flat().sort((a, b) => tsMillis(b.ts) - tsMillis(a.ts)));
    } catch (e) {
      console.error('NuevoTarifario: error cargando el historial general', e);
      setHistFilas([]);
    }
    setHistCargando(false);
  }, [maestras]);

  useEffect(() => {
    if (tab === 'historial' && histFilas === null && !loading) cargarHistorialGeneral();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, loading]);

  /* ── Excel ────────────────────────────────────────────────────────────── */
  const exportarExcelRegistro = () => {
    const wb = XLSX.utils.book_new();
    const fecha = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
    const filas = [
      ['EXPLORA S.A. — Registro maestro de rutas (NuevoTarifario)', '', '', '', '', '', '', ''],
      ['Confidencial — Uso interno', '', '', '', '', '', '', fecha],
      [],
      ['Origen', 'Destino', 'Producto', 'km', 'Categoría', 'Tarifa vigente ($/Tn)', 'CATAC ref. ($/Tn)', 'Brecha %', 'Actualizada'],
      ...filasRegistroVisibles.map(r => [
        r.origen, r.destino, r.producto, r.km, r.categoria, r.tarifa_vigente,
        r.catacRef ? Math.round(r.catacRef) : '', r.brecha != null ? Math.round(r.brecha * 10) / 10 : '',
        r.tarifa_actualizada_en && typeof r.tarifa_actualizada_en.toDate === 'function'
          ? r.tarifa_actualizada_en.toDate().toLocaleDateString('es-AR') : '',
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(filas);
    ws['!cols'] = [{ wch: 32 }, { wch: 32 }, { wch: 16 }, { wch: 8 }, { wch: 12 }, { wch: 18 }, { wch: 16 }, { wch: 10 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Registro maestro');
    XLSX.writeFile(wb, `NuevoTarifario_registro_${new Date().toLocaleDateString('es-AR').replace(/\//g, '-')}.xlsx`);
  };

  /* ── Pestañas (Segmentado) ───────────────────────────────────────────── */
  // "Generar derivada" y "Actualizaciones" ya son pestañas acá -- el
  // encabezado NO repite un botón para cada una (feedback de revisión: no
  // duplicar navegación entre el encabezado y el segmentado).
  const puedeGenerarDerivada = isAdmin || soyCoordinador;
  const pestanas = [
    { id: 'registro', label: 'Registro vigente' },
    { id: 'derivadas', label: 'Rutas derivadas' },
    ...(puedeGenerarDerivada ? [{ id: 'generar', label: 'Generar derivada' }] : []),
    { id: 'historial', label: 'Historial' },
    ...(isAdmin ? [{ id: 'actualizaciones', label: 'Actualizaciones' }] : []),
  ];

  if (sinAcceso) return <div style={{ padding: 40, color: S.wrap.color }}>{sinAcceso}</div>;
  if (loading) return <div style={{ padding: 40, textAlign: 'center', opacity: 0.7 }}>Cargando…</div>;

  return (
    <div style={S.wrap}>
      <div style={S.contenido}>
        {/* Sin botón "Inicio" -- `BarraSuperior` (App.js) ya resuelve la
            vuelta a Home para todas las pantallas, Pedidos.js incluido. */}
        <div style={S.header}>
          <div style={S.headerL}>
            <div>
              <span style={S.titulo}>Nuevo Tarifario</span>
              <div style={S.catacInfo}>{catacVer && catacVer.desc ? catacVer.desc : 'CATAC de referencia'}</div>
            </div>
          </div>
          <div style={S.headerR}>
            <span style={S.badgeRol}>{isAdmin ? 'Administrador' : soyCoordinador ? 'Coordinador' : 'Comercial'}</span>
            <Boton variante="secundario" onClick={exportarExcelRegistro}>Exportar Excel</Boton>
            {isAdmin && <Boton onClick={() => setModalNuevaMaestra(true)}>+ Nueva ruta maestra</Boton>}
          </div>
        </div>

        {(pendientesCount > 0 && isAdmin) || derivadasInactivasCount > 0 ? (
          <FranjaAvisos>
            {isAdmin && pendientesCount > 0 && (
              <AvisoClickeable tipo="advertencia" activo={tab === 'actualizaciones'} onClick={() => setTab('actualizaciones')}>
                {pendientesCount} tarifa{pendientesCount === 1 ? '' : 's'} pendiente{pendientesCount === 1 ? '' : 's'} de aprobación
              </AvisoClickeable>
            )}
            {derivadasInactivasCount > 0 && (
              <AvisoClickeable
                tipo="peligro"
                activo={tab === 'derivadas' && filtros.soloMaestraInactiva}
                onClick={() => { setFiltros(f => ({ ...f, soloMaestraInactiva: true })); setTab('derivadas'); }}
              >
                {derivadasInactivasCount} ruta{derivadasInactivasCount === 1 ? '' : 's'} derivada{derivadasInactivasCount === 1 ? '' : 's'} con maestra inactiva
              </AvisoClickeable>
            )}
          </FranjaAvisos>
        ) : null}

        <div style={S.controlesFila}>
          <Segmentado opciones={pestanas.map(p => ({ id: p.id, label: p.label }))} valor={tab} onCambiar={setTab} />
        </div>

        {(tab === 'registro' || tab === 'derivadas') && (
          <BarraFiltros
            variante="compacta"
            texto={textoFiltro}
            onCambiarTexto={setTextoFiltro}
            placeholderTexto="Buscar por origen, destino o producto…"
            controles={tab === 'registro' ? controlesRegistro : controlesDerivadas}
            valores={filtros}
            onCambiarValor={(campo, valor) => setFiltros(f => ({ ...f, [campo]: valor }))}
            orden={{
              opciones: tab === 'registro' ? ORDEN_OPCIONES_REGISTRO : ORDEN_OPCIONES_DERIVADAS,
              valor: ordenPor,
              sentido: ordenSentido,
              onCambiarValor: setOrdenPor,
              onCambiarSentido: () => setOrdenSentido(s => (s === 'asc' ? 'desc' : 'asc')),
            }}
            totalBase={tab === 'registro' ? maestras.length : derivadas.length}
            totalVisible={tab === 'registro' ? filasRegistroVisibles.length : filasDerivadasVisibles.length}
            hayFiltrosActivos={tab === 'registro' ? hayFiltrosActivosRegistro : hayFiltrosActivosDerivadas}
            onLimpiar={limpiarFiltros}
            etiquetaItem="rutas"
            piePastillas={
              <>
                {piePastillasCategoria(tab === 'registro' ? registroBaseFiltrado.length : derivadasBaseFiltrado.length)}
                {tab === 'derivadas' && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={filtros.soloMaestraInactiva}
                      onChange={e => setFiltros(f => ({ ...f, soloMaestraInactiva: e.target.checked }))}
                    />
                    Solo con maestra inactiva
                  </label>
                )}
                {tab === 'derivadas' && filtroMaestraId && (
                  <Boton chico variante="secundario" onClick={() => setFiltroMaestraId(null)}>✕ Quitar filtro por maestra</Boton>
                )}
              </>
            }
          />
        )}

        {tab === 'registro' && (
          <RegistroVigente
            S={S}
            filas={filasRegistroVisibles}
            vista={vistaRegistro}
            onCambiarVista={setVistaRegistro}
            onAbrir={abrirDetalleMaestra}
            vacioRegistro={maestras.length === 0}
          />
        )}

        {tab === 'derivadas' && (
          <RutasDerivadas
            S={S}
            filas={filasDerivadasVisibles}
            onAbrir={abrirDetalleDerivada}
            vacioDerivadas={derivadas.length === 0}
          />
        )}

        {tab === 'generar' && puedeGenerarDerivada && (
          <GenerarDerivada
            S={S}
            usuario={usuario}
            rutas={rutas}
            maestraPorId={maestraPorId}
            maestrasConProducto={maestrasConProducto}
            catacTabla={catacTabla}
            sugOrigenes={sugOrigenes}
            sugDestinos={sugDestinos}
            sugProductos={sugProductos}
          />
        )}

        {tab === 'historial' && (
          <Historial S={S} histFilas={histFilas} histCargando={histCargando} />
        )}

        {tab === 'actualizaciones' && isAdmin && (
          <Actualizaciones S={S} rutas={rutas} maestras={maestras} usuario={usuario} />
        )}

        {rutaDetalle && modalDetalle.tipo === 'maestra' && (
          <ModalDetalleRuta
            S={S}
            tipo="maestra"
            ruta={rutaDetalle}
            onCerrar={cerrarDetalle}
            historial={detalleHistorial}
            derivadasDependientes={derivadasConCalc.filter(d => d.ruta_maestra_id === rutaDetalle.id).length}
            onVerDerivadas={() => verDerivadasDeMaestra(rutaDetalle)}
            isAdmin={isAdmin}
            onDesactivar={desactivarMaestraClick}
          />
        )}

        {rutaDetalle && modalDetalle.tipo === 'derivada' && (
          <ModalDetalleRuta
            S={S}
            tipo="derivada"
            ruta={rutaDetalle}
            onCerrar={cerrarDetalle}
            maestra={maestraPorId.get(rutaDetalle.ruta_maestra_id) || null}
            calc={rutaDetalle.calc}
            variacionDesdeCreacion={rutaDetalle.variacionDesdeCreacion}
            puedeEditar={puedeEditarDerivada(rutaDetalle, usuario)}
            soloLectura={!puedeEditarDerivada(rutaDetalle, usuario)}
            onEditar={() => { setModalEditarDerivada(rutaDetalle); cerrarDetalle(); }}
            onDesactivarDerivada={desactivarDerivadaClick}
          />
        )}

        {modalNuevaMaestra && (
          <ModalNuevaMaestra
            S={S}
            usuario={usuario}
            rutas={rutas}
            getCatac={getCatac}
            sugOrigenes={sugOrigenes}
            sugDestinos={sugDestinos}
            sugProductos={sugProductos}
            onCerrar={() => setModalNuevaMaestra(false)}
            onCreada={() => setModalNuevaMaestra(false)}
          />
        )}

        {modalEditarDerivada && (
          <ModalEditarDerivada
            S={S}
            ruta={modalEditarDerivada}
            maestras={maestras}
            usuario={usuario}
            onCerrar={() => setModalEditarDerivada(null)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Modal "Editar ruta derivada" (km / categoría / reasignar maestra) —
 * traslado 1:1 del que ya tenía el archivo original, ahora abierto desde
 * `ModalDetalleRuta` ("Editar / reasignar maestra") en vez de un botón en la
 * fila de la tabla. No es uno de los 8 componentes que pide la tarea (es un
 * solo formulario chico): se queda local a este orquestador.
 */
function ModalEditarDerivada({ S, ruta, maestras, usuario, onCerrar }) {
  const [km, setKm] = useState(String(ruta.km));
  const [categoria, setCategoria] = useState(ruta.categoria || 'General');
  const [maestraId, setMaestraId] = useState(ruta.ruta_maestra_id || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const guardar = async () => {
    setErr('');
    if (!maestraId) { setErr('Elegí de qué maestra depende.'); return; }
    setBusy(true);
    try {
      await editarRutaDerivada({ ruta, cambios: { km, categoria, ruta_maestra_id: maestraId }, usuario });
      onCerrar();
    } catch (e) {
      setErr(e.message || 'No se pudo guardar.');
    }
    setBusy(false);
  };

  return (
    <Modal titulo="Editar ruta derivada" onCerrar={onCerrar} ancho={480}>
      <div style={S.fr}>
        <label style={S.label}>Km</label>
        <input style={{ ...S.input, width: 120 }} type="number" min="1" value={km} onChange={e => setKm(e.target.value)} />
      </div>
      <div style={S.fr}>
        <label style={S.label}>Categoría</label>
        <select style={S.select} value={categoria} onChange={e => setCategoria(e.target.value)}>
          {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div style={S.fr}>
        <label style={S.label}>Ruta maestra de la que depende</label>
        <select style={{ ...S.select, width: '100%' }} value={maestraId} onChange={e => setMaestraId(e.target.value)}>
          <option value="">Elegir…</option>
          {maestras.map(m => (
            <option key={m.id} value={m.id}>
              {m.origen} → {m.destino}{m.estado !== 'activo' ? ' (inactiva)' : ''}
            </option>
          ))}
        </select>
      </div>
      {err && <div style={S.aviso('error')}>{err}</div>}
      <div style={{ display: 'flex', gap: espacio.sm, justifyContent: 'flex-end' }}>
        <Boton variante="secundario" onClick={onCerrar}>Cancelar</Boton>
        <Boton disabled={busy} onClick={guardar}>{busy ? 'Guardando…' : 'Guardar'}</Boton>
      </div>
    </Modal>
  );
}
