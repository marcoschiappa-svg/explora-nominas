/**
 * =============================================================================
 * CicloVida.js — v1.2.0 (RF-05)
 * =============================================================================
 *
 * SÍNTOMA (v1.2.0)
 *   Al abrir el detalle de una entrega, la consulta de `historial` pedía
 *   `orderBy('ts')` ASCENDENTE mientras el índice compuesto declarado en
 *   `firestore.indexes.json` es `pedido_id ASC + ts DESC` -- no coincide, así
 *   que Firestore la rechaza y ofrece crear un índice nuevo. Además, ese
 *   mensaje de error (una URL larga sin espacios) desbordaba el panel en vez
 *   de cortar línea.
 *
 * CAUSA RAÍZ (v1.2.0)
 *   El índice de `historial` ya existe para `ts DESC` (lo usa
 *   `HistorialPedido.js`); acá se pedía el orden contrario en vez de
 *   reusarlo y dar vuelta el resultado en memoria. El banner de error
 *   (`bannerErrorChico`) tampoco tenía `overflow-wrap`.
 *
 * VERIFICACIÓN (v1.2.0)
 *   La consulta de `ModalDetalleCiclo` pide `orderBy('ts', 'desc')` (mismo
 *   orden que el índice) y arma `historial` con `.reverse()` en memoria antes
 *   de pasarlo a `armarCicloDeEntrega()`, que lo espera ascendente. Sin
 *   índices nuevos. `CI=true npm run build` y `npm test -- --watchAll=false`
 *   en verde.
 *
 * SÍNTOMA
 *   No había forma de ver, por entrega, en qué etapa está, cuándo pasó por
 *   cada una, quién la ejecutó y cuánto tardó -- `HistorialPedido.js` muestra
 *   todo lo de un pedido entero, mezclado y cronológico, útil para auditar,
 *   no para leer de un vistazo el camino de una entrega puntual.
 *
 * CAUSA RAÍZ
 *   El ciclo de vida está repartido en cuatro colecciones y nadie lo arma en
 *   un solo lugar (ver `logica-ciclo-vida.js`, que sí lo hace).
 *
 * ALCANCE
 *   Pantalla de SOLO LECTURA (con una única excepción: el cierre manual de
 *   un viaje abierto, que ya existía en Programación -- ver más abajo).
 *
 *   LISTA: una fila por ENTREGA (no por pedido), de TODOS los pedidos --
 *   incluidos los cumplidos y suspendidos: es una vista histórica, a
 *   diferencia de `Programacion.js` que oculta esos dos estados. Carga las
 *   mismas colecciones que `Programacion.js` (`pedidos`, `entregas`,
 *   `despachos`, `viajes`, `organizaciones`, `productos`, `usuarios`), sin
 *   ninguna consulta nueva por fila: la etapa actual y los días en ella se
 *   calculan con `armarCicloDeEntrega()` SIN historial (`historial: []`) --
 *   alcanza, porque las fechas de las 8 etapas salen de CAMPOS de
 *   `entregas`/`despachos`/`viajes`, no de `historial` (ver la tabla de
 *   fuentes en `logica-ciclo-vida.js`); lo único que necesita `historial` es
 *   "quién", que la lista no muestra.
 *
 *   DETALLE: al abrir una entrega, se lee `historial` con
 *   `where('pedido_id', '==', pedido.id)` + `orderBy('ts', 'desc')` -- mismo
 *   orden que el índice compuesto `pedido_id ASC + ts DESC` de
 *   `firestore.indexes.json` -- y se da vuelta el resultado en memoria antes
 *   de armar el ciclo COMPLETO con `armarCicloDeEntrega()` (que lo espera
 *   ascendente), mostrado como línea de tiempo vertical: las 8 etapas, las
 *   ramas cerradas y las marcas.
 *
 *   CIERRE MANUAL: si la entrega tiene un viaje abierto (`viajeAbierto()`,
 *   `estados.js`) y el usuario es admin o coordinador, un botón "Cerrar
 *   viaje a mano" abre `ModalCierreManual` -- el mismo componente de RF-02,
 *   sin reescribirlo. El comercial no lo ve: tiene acceso a este módulo
 *   (`modulos.js`) pero no a cerrar viajes.
 *
 * LIMITACIONES CONOCIDAS
 *   El orden por "días en la etapa actual" y por "número de pedido" es
 *   lógica LOCAL de este archivo, no de `filtros-listado.js`: son criterios
 *   propios de esta pantalla (ninguna otra los necesita), y `comparador()`
 *   ya cubre "fecha de entrega" y "cliente" sin tocarlo. Ver el comentario
 *   junto a `ordenarFilas()`.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Pruebas manuales al pie del
 *   reporte de la tarea.
 * ========================================================================== */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { collection, onSnapshot, query, orderBy, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { motivoSinAcceso, tieneAlgunRol } from '../sesion';
import { rolesDe } from '../modulos';
import { claveNormalizada } from '../mapa-normalizacion';
import { despachoVivo, viajeAbierto } from '../estados';
import { TIPOS } from '../logica-pedidos';
import { armarCicloDeEntrega, ETIQUETA_ETAPA, ORDEN_ETAPAS } from '../logica-ciclo-vida';
import { formatoFechaTs } from '../extractores-pedidos';
import {
  aplicarFiltros, filtrosActivos, filtrosVacios, leerPreferencias, guardarPreferencias,
} from '../filtros-listado';
import ModalCierreManual from './ModalCierreManual';
import BarraFiltros from '../ui/BarraFiltros';
import { marca, colorEstado, espacio, radio, tipografia, paletaTexto } from '../ui/tokens';
import { useTema } from '../ui/TemaContext';
import Boton from '../ui/Boton';
import Tarjeta from '../ui/Tarjeta';
import Pastilla from '../ui/Pastilla';
import Modal from '../ui/Modal';
import Vacio from '../ui/Vacio';

const ORDEN_OPCIONES = [
  { id: 'entrega', label: 'Fecha de entrega' },
  { id: 'cliente', label: 'Cliente' },
  { id: 'diasEtapa', label: 'Días en la etapa actual' },
  { id: 'pedido', label: 'Número de pedido' },
];

function traducirError(err) {
  if (err && err.code === 'permission-denied') {
    return 'Firestore rechazó la lectura. Revisá la consola del navegador.';
  }
  return (err && err.message) || 'Error desconocido.';
}

export default function CicloVida({ usuario, onVolver }) {
  const styles = useEstilos();
  const sinAcceso = motivoSinAcceso(usuario, rolesDe('ciclo_vida'));

  const [pedidos, setPedidos] = useState([]);
  const [entregas, setEntregas] = useState([]);
  const [despachos, setDespachos] = useState([]);
  const [viajes, setViajes] = useState([]);
  const [organizaciones, setOrganizaciones] = useState([]);
  const [productos, setProductos] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [cargando, setCargando] = useState(true);

  const [filtro, setFiltro] = useState('');
  const [filtros, setFiltros] = useState(filtrosVacios());
  const [etapaActiva, setEtapaActiva] = useState('todas');
  const [ordenPor, setOrdenPor] = useState('diasEtapa');
  const [ordenSentido, setOrdenSentido] = useState('desc');

  const [entregaAbiertaId, setEntregaAbiertaId] = useState(null);

  useEffect(() => {
    if (sinAcceso) { setCargando(false); return; }
    const unsubs = [
      onSnapshot(collection(db, 'pedidos'), (s) => {
        setPedidos(s.docs.map(d => ({ id: d.id, ...d.data() })));
        setCargando(false);
      }, (err) => { console.error(err); setCargando(false); }),
      onSnapshot(collection(db, 'entregas'), (s) => setEntregas(s.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'despachos'), (s) => setDespachos(s.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'viajes'), (s) => setViajes(s.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'organizaciones'), (s) => setOrganizaciones(s.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'productos'), (s) => setProductos(s.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'usuarios'), (s) => setUsuarios(s.docs.map(d => ({ id: d.id, ...d.data() })))),
    ];
    return () => unsubs.forEach(u => u());
  }, [sinAcceso]);

  const orgsPorId = useMemo(() => new Map(organizaciones.map(o => [o.id, o])), [organizaciones]);
  const prodsPorId = useMemo(() => new Map(productos.map(p => [p.id, p])), [productos]);

  const despachosPorPedido = useMemo(() => {
    const m = new Map();
    despachos.forEach(d => { const l = m.get(d.pedido_id) || []; l.push(d); m.set(d.pedido_id, l); });
    return m;
  }, [despachos]);

  const viajesPorPedido = useMemo(() => {
    const despachoAPedido = new Map(despachos.map(d => [d.id, d.pedido_id]));
    const m = new Map();
    viajes.forEach(v => {
      const pedidoId = despachoAPedido.get(v.despacho_id);
      if (!pedidoId) return;
      const l = m.get(pedidoId) || []; l.push(v); m.set(pedidoId, l);
    });
    return m;
  }, [viajes, despachos]);

  /* ── Una fila por ENTREGA, de TODOS los pedidos (vista histórica) ────── */

  const filas = useMemo(() => {
    return entregas.map(entrega => {
      const pedido = pedidos.find(p => p.id === entrega.pedido_id);
      if (!pedido) return null; // entrega huérfana -- no debería pasar, se descarta

      const despachosDelPedido = despachosPorPedido.get(pedido.id) || [];
      const viajesDelPedido = viajesPorPedido.get(pedido.id) || [];

      // Sin historial -- alcanza para etapa actual y días en ella. Ver el
      // encabezado de este archivo.
      const ciclo = armarCicloDeEntrega({
        entrega, pedido, despachos: despachosDelPedido, viajes: viajesDelPedido, historial: [],
      });

      return { entrega, pedido, ciclo };
    }).filter(Boolean);
  }, [entregas, pedidos, despachosPorPedido, viajesPorPedido]);

  /* ── Filtros (mismos criterios que Pedidos.js) ────────────────────────── */

  const extractores = useMemo(() => ({
    clienteId: f => f.pedido.cliente_org_id || null,
    productoId: f => f.pedido.producto_id || null,
    tipo: f => f.pedido.tipo || null,
    creadoPorUid: f => f.pedido.creado_por_uid || null,
    fechasEntrega: f => [f.entrega.fecha_solicitada].filter(Boolean),
  }), []);

  const opcionesClientes = useMemo(() => {
    const ids = new Set(filas.map(f => f.pedido.cliente_org_id).filter(Boolean));
    return organizaciones.filter(o => ids.has(o.id)).map(o => ({ id: o.id, label: o.razon_social }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }, [filas, organizaciones]);

  const opcionesProductos = useMemo(() => {
    const ids = new Set(filas.map(f => f.pedido.producto_id).filter(Boolean));
    return productos.filter(p => ids.has(p.id)).map(p => ({ id: p.id, label: p.nombre }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }, [filas, productos]);

  const opcionesTipos = useMemo(() => {
    const ids = new Set(filas.map(f => f.pedido.tipo).filter(Boolean));
    return Object.keys(TIPOS).filter(t => ids.has(t)).map(t => ({ id: t, label: t }));
  }, [filas]);

  const opcionesCreadoPor = useMemo(() => {
    const ids = new Set(filas.map(f => f.pedido.creado_por_uid).filter(Boolean));
    return usuarios.filter(u => ids.has(u.id)).map(u => ({ id: u.id, label: u.nombre || u.email || 'Sin identificar' }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }, [filas, usuarios]);

  const controlesBarra = useMemo(() => [
    { campo: 'clientes', tipo: 'multi', etiqueta: 'Cliente', opciones: opcionesClientes, vacio: 'Sin clientes' },
    { campo: 'productos', tipo: 'multi', etiqueta: 'Producto', opciones: opcionesProductos, vacio: 'Sin productos' },
    { campo: 'entrega', tipo: 'rango', etiqueta: 'Fecha de entrega' },
    { campo: 'tipos', tipo: 'multi', etiqueta: 'Tipo', opciones: opcionesTipos, enPanel: true },
    { campo: 'creadoPor', tipo: 'multi', etiqueta: 'Creado por', opciones: opcionesCreadoPor, enPanel: true },
  ], [opcionesClientes, opcionesProductos, opcionesTipos, opcionesCreadoPor]);

  // Persistencia -- mismo patrón que Pedidos.js/Programacion.js (con la
  // misma `prefsAplicadasRef` para leer una sola vez, recién cuando los
  // datos ya cargaron), con `pantalla = 'ciclo_vida'` (ver V5 del reporte de
  // la tarea: `filtros-listado.js` no tiene una lista cerrada de pantallas,
  // así que no hizo falta tocarlo para agregar esta).
  const prefsAplicadasRef = useRef(false);

  useEffect(() => {
    if (prefsAplicadasRef.current || cargando) return;
    prefsAplicadasRef.current = true;

    const prefs = leerPreferencias('ciclo_vida', usuario.uid, {
      clientes: new Set(organizaciones.map(o => o.id)),
      productos: new Set(productos.map(p => p.id)),
      creadoPor: new Set(usuarios.map(u => u.id)),
    });
    if (!prefs) return;
    if (prefs.filtros) setFiltros(f => ({ ...f, ...prefs.filtros }));
    if (prefs.ordenPor) setOrdenPor(prefs.ordenPor);
    if (prefs.ordenSentido) setOrdenSentido(prefs.ordenSentido);
    if (prefs.grupoActivo) setEtapaActiva(prefs.grupoActivo);
  }, [cargando, organizaciones, productos, usuarios, usuario.uid]);

  useEffect(() => {
    if (!prefsAplicadasRef.current) return;
    const id = setTimeout(() => {
      guardarPreferencias('ciclo_vida', usuario.uid, {
        filtros, ordenPor, ordenSentido, grupoActivo: etapaActiva,
      });
    }, 300);
    return () => clearTimeout(id);
  }, [filtros, ordenPor, ordenSentido, etapaActiva, usuario.uid]);

  const filtradas = useMemo(() => {
    const texto = claveNormalizada(filtro);
    const porTexto = !texto ? filas : filas.filter(f => {
      const org = orgsPorId.get(f.pedido.cliente_org_id);
      return claveNormalizada(f.pedido.numero).includes(texto)
        || (org && claveNormalizada(org.razon_social).includes(texto));
    });
    return aplicarFiltros(porTexto, filtros, extractores);
  }, [filas, filtro, orgsPorId, filtros, extractores]);

  // Pastillas por ETAPA ACTUAL, no por estado del pedido (a diferencia de
  // Pedidos.js/Programacion.js) -- pedido explícito de RF-05 (Paso 2.3).
  const conteosPorEtapa = useMemo(() => {
    const c = {};
    ORDEN_ETAPAS.forEach(id => { c[id] = 0; });
    filtradas.forEach(f => { c[f.ciclo.etapaActual.id] = (c[f.ciclo.etapaActual.id] || 0) + 1; });
    return c;
  }, [filtradas]);

  const porEtapa = useMemo(
    () => etapaActiva === 'todas' ? filtradas : filtradas.filter(f => f.ciclo.etapaActual.id === etapaActiva),
    [filtradas, etapaActiva]
  );

  /**
   * Orden LOCAL a esta pantalla -- ver el encabezado del archivo. "entrega"
   * y "cliente" son criterios genéricos, pero se comparan acá mismo (no vía
   * `comparador()` de `filtros-listado.js`) para no tener dos motores de
   * orden distintos en una sola función: "días en la etapa actual" y
   * "número de pedido" no existen en ese archivo (son propios de esta
   * pantalla), así que se completan los cuatro criterios juntos, con el
   * mismo criterio de "sin dato al final" que ya usa el resto del portal.
   */
  const ordenarFilas = useMemo(() => {
    const factor = ordenSentido === 'desc' ? -1 : 1;
    return (a, b) => {
      let cmp = 0;
      if (ordenPor === 'entrega') {
        const va = a.entrega.fecha_solicitada, vb = b.entrega.fecha_solicitada;
        if (!va && !vb) cmp = 0;
        else if (!va) cmp = 1;
        else if (!vb) cmp = -1;
        else cmp = (va < vb ? -1 : va > vb ? 1 : 0) * factor;
      } else if (ordenPor === 'cliente') {
        const oa = orgsPorId.get(a.pedido.cliente_org_id), ob = orgsPorId.get(b.pedido.cliente_org_id);
        const va = oa ? oa.razon_social : null, vb = ob ? ob.razon_social : null;
        if (!va && !vb) cmp = 0;
        else if (!va) cmp = 1;
        else if (!vb) cmp = -1;
        else cmp = va.localeCompare(vb, 'es') * factor;
      } else if (ordenPor === 'diasEtapa') {
        const va = a.ciclo.diasEnEtapaActual, vb = b.ciclo.diasEnEtapaActual;
        if (va === null && vb === null) cmp = 0;
        else if (va === null) cmp = 1;
        else if (vb === null) cmp = -1;
        else cmp = (va - vb) * factor;
      } else if (ordenPor === 'pedido') {
        cmp = (a.pedido.numero || '').localeCompare(b.pedido.numero || '', 'es', { numeric: true }) * factor;
      }
      if (cmp !== 0) return cmp;
      return (a.pedido.numero || '').localeCompare(b.pedido.numero || '', 'es', { numeric: true });
    };
  }, [ordenPor, ordenSentido, orgsPorId]);

  const visibles = useMemo(() => [...porEtapa].sort(ordenarFilas), [porEtapa, ordenarFilas]);

  const hayFiltrosActivos = filtrosActivos(filtros) || !!filtro || etapaActiva !== 'todas';
  function limpiarFiltros() {
    setFiltros(filtrosVacios());
    setFiltro('');
    setEtapaActiva('todas');
  }

  const entregaAbierta = entregaAbiertaId ? filas.find(f => f.entrega.id === entregaAbiertaId) : null;

  if (sinAcceso) {
    return <div style={styles.wrap}><div style={styles.bannerError}>{sinAcceso}</div></div>;
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.panelHeader}>
        <div style={styles.titulo}>Ciclo de vida</div>
      </div>

      <BarraFiltros
        texto={filtro}
        onCambiarTexto={setFiltro}
        placeholderTexto="Buscar por número o cliente..."
        controles={controlesBarra}
        valores={filtros}
        onCambiarValor={(campo, valor) => setFiltros(f => ({ ...f, [campo]: valor }))}
        orden={{
          opciones: ORDEN_OPCIONES, valor: ordenPor, sentido: ordenSentido,
          onCambiarValor: setOrdenPor, onCambiarSentido: () => setOrdenSentido(s => (s === 'asc' ? 'desc' : 'asc')),
        }}
        totalBase={filas.length}
        totalVisible={filtradas.length}
        hayFiltrosActivos={hayFiltrosActivos}
        onLimpiar={limpiarFiltros}
        etiquetaItem="entregas"
      />

      <div style={styles.pastillasGrupo}>
        <PastillaEtapa activo={etapaActiva === 'todas'} onClick={() => setEtapaActiva('todas')} label={`Todas (${filtradas.length})`} />
        {ORDEN_ETAPAS.map(id => (
          <PastillaEtapa
            key={id} activo={etapaActiva === id} onClick={() => setEtapaActiva(id)}
            label={`${ETIQUETA_ETAPA[id]} (${conteosPorEtapa[id] || 0})`}
          />
        ))}
      </div>

      {cargando && <Vacio titulo="Cargando..." />}
      {!cargando && visibles.length === 0 && <Vacio titulo="No hay entregas que coincidan." />}

      {!cargando && visibles.length > 0 && (
        <div>
          {visibles.map(f => (
            <FilaCiclo
              key={f.entrega.id}
              fila={f}
              org={orgsPorId.get(f.pedido.cliente_org_id)}
              prod={prodsPorId.get(f.pedido.producto_id)}
              onClick={() => setEntregaAbiertaId(f.entrega.id)}
            />
          ))}
        </div>
      )}

      {entregaAbierta && (
        <ModalDetalleCiclo
          fila={entregaAbierta}
          org={orgsPorId.get(entregaAbierta.pedido.cliente_org_id)}
          prod={prodsPorId.get(entregaAbierta.pedido.producto_id)}
          despachosDelPedido={despachosPorPedido.get(entregaAbierta.pedido.id) || []}
          viajesDelPedido={viajesPorPedido.get(entregaAbierta.pedido.id) || []}
          usuario={usuario}
          onCerrar={() => setEntregaAbiertaId(null)}
        />
      )}
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Fila de la lista
 * -------------------------------------------------------------------------- */

function FilaCiclo({ fila, org, prod, onClick }) {
  const styles = useEstilos();
  const { entrega, pedido, ciclo } = fila;
  return (
    <Tarjeta onClick={onClick} style={{ marginBottom: espacio.sm, padding: '12px 16px' }}>
      <div style={styles.filaContenido}>
        <Pastilla colores={{ bg: colorEstado.acentoAzulFuerte + '22', color: colorEstado.acentoAzulFuerte }}>
          {ETIQUETA_ETAPA[ciclo.etapaActual.id]}
        </Pastilla>
        <span style={styles.filaCliente}>{org ? org.razon_social : '—'}</span>
        <span style={styles.filaProducto}>{prod ? prod.nombre : '—'}</span>
        <span style={styles.filaEntregaN}>entrega {entrega.numero} de {pedido.entregas_total || '?'}</span>
        <span style={styles.filaDias}>
          {ciclo.diasEnEtapaActual === null ? 'sin registro' : `${ciclo.diasEnEtapaActual} día(s) en esta etapa`}
        </span>
        <span style={styles.filaNumero}>{pedido.numero}</span>
      </div>
    </Tarjeta>
  );
}

function PastillaEtapa({ activo, onClick, label }) {
  const { colores, oscuro } = useTema();
  const pal = paletaTexto(oscuro);
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px', borderRadius: radio.pastilla, border: 'none', cursor: 'pointer',
        fontSize: tipografia.tamano.sm, fontWeight: activo ? tipografia.peso.medio : tipografia.peso.normal,
        background: activo ? marca : colores.fondoAlterno, color: activo ? '#fff' : pal.azul,
        marginRight: 6, marginBottom: 6,
      }}
    >
      {label}
    </button>
  );
}

/* -----------------------------------------------------------------------------
 * Detalle: línea de tiempo vertical
 * -------------------------------------------------------------------------- */

function ModalDetalleCiclo({ fila, org, prod, despachosDelPedido, viajesDelPedido, usuario, onCerrar }) {
  const styles = useEstilos();
  const { entrega, pedido } = fila;

  const [historial, setHistorial] = useState([]);
  const [cargandoHist, setCargandoHist] = useState(true);
  const [errorHist, setErrorHist] = useState('');
  const [cerrandoManual, setCerrandoManual] = useState(null);

  useEffect(() => {
    let cancelado = false;
    setCargandoHist(true);
    getDocs(query(collection(db, 'historial'), where('pedido_id', '==', pedido.id), orderBy('ts', 'desc')))
      .then(snap => {
        if (!cancelado) {
          // El índice compuesto es pedido_id ASC + ts DESC; se pide en ese
          // orden para reusarlo tal cual y se da vuelta acá en memoria,
          // porque `armarCicloDeEntrega()` espera el historial ASCENDENTE.
          setHistorial(snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse());
          setCargandoHist(false);
        }
      })
      .catch(err => {
        console.error(err);
        if (!cancelado) { setErrorHist(traducirError(err)); setCargandoHist(false); }
      });
    return () => { cancelado = true; };
  }, [pedido.id]);

  const ciclo = useMemo(() => armarCicloDeEntrega({
    entrega, pedido, despachos: despachosDelPedido, viajes: viajesDelPedido, historial,
  }), [entrega, pedido, despachosDelPedido, viajesDelPedido, historial]);

  // El despacho/viaje "tronco" -- mismo criterio que `logica-ciclo-vida.js`,
  // recalculado acá (no expuesto por `armarCicloDeEntrega()`, que devuelve
  // solo lo documentado en su encabezado) para el botón de cierre manual.
  const despachoTronco = useMemo(() => {
    const dEntrega = despachosDelPedido.filter(d => d.entrega_id === entrega.id)
      .slice().sort((a, b) => (a.creado_en && a.creado_en.toMillis ? a.creado_en.toMillis() : 0) - (b.creado_en && b.creado_en.toMillis ? b.creado_en.toMillis() : 0));
    return dEntrega.find(despachoVivo) || dEntrega[dEntrega.length - 1] || null;
  }, [despachosDelPedido, entrega.id]);

  const viajeTronco = useMemo(
    () => despachoTronco ? (viajesDelPedido.find(v => v.despacho_id === despachoTronco.id) || null) : null,
    [despachoTronco, viajesDelPedido]
  );

  const puedeCerrarManual = tieneAlgunRol(usuario, ['admin', 'coordinador']) && viajeAbierto(viajeTronco);

  return (
    <>
      <Modal titulo={`Ciclo de la entrega ${entrega.numero} -- pedido ${pedido.numero}`} onCerrar={onCerrar} ancho={640}>
        <div style={styles.detalleResumen}>
          <span>{org ? org.razon_social : '—'}</span>
          <span>{prod ? prod.nombre : '—'}</span>
          <span>{entrega.volumen} tn</span>
          <span>entrega {entrega.numero} de {pedido.entregas_total || '?'}</span>
        </div>

        {errorHist && <div style={styles.bannerErrorChico}>{errorHist}</div>}
        {cargandoHist && <div style={styles.usoVacio}>Cargando historial...</div>}

        {puedeCerrarManual && (
          <div style={{ marginBottom: espacio.md }}>
            <Boton variante="peligro" chico onClick={() => setCerrandoManual({ despacho: despachoTronco, viaje: viajeTronco })}>
              Cerrar viaje a mano
            </Boton>
          </div>
        )}

        <div style={styles.marcasFila}>
          {ciclo.marcas.cierreManual && (
            <Pastilla chico colores={{ bg: colorEstado.advertenciaFondo, color: colorEstado.advertenciaTexto }}>
              Cierre manual{ciclo.marcas.cierreManual.quien ? ` -- ${ciclo.marcas.cierreManual.quien}` : ''}
            </Pastilla>
          )}
          {ciclo.marcas.sinInicio && (
            <Pastilla chico colores={{ bg: colorEstado.advertenciaFondo, color: colorEstado.advertenciaTexto }}>Sin inicio</Pastilla>
          )}
          {ciclo.marcas.demorado && (
            <Pastilla chico colores={{ bg: colorEstado.advertenciaFondo, color: colorEstado.advertenciaTexto }}>Demorado</Pastilla>
          )}
          {ciclo.marcas.fueraDeFecha && (
            <Pastilla chico colores={{ bg: colorEstado.peligroFondo, color: colorEstado.peligroTexto }}>Fuera de fecha</Pastilla>
          )}
          {ciclo.marcas.suspendida && (
            <Pastilla chico colores={{ bg: colorEstado.peligroFondo, color: colorEstado.peligroTexto }}>
              Suspendida{ciclo.marcas.suspendida.quien ? ` -- ${ciclo.marcas.suspendida.quien}` : ''}
            </Pastilla>
          )}
          {ciclo.marcas.reactivada && (
            <Pastilla chico colores={{ bg: colorEstado.exitoFondo, color: colorEstado.exitoTexto }}>
              Reactivada{ciclo.marcas.reactivada.quien ? ` -- ${ciclo.marcas.reactivada.quien}` : ''}
            </Pastilla>
          )}
        </div>

        <div style={styles.lineaTitulo}>Línea de tiempo</div>
        <LineaTiempo etapas={ciclo.etapas} etapaActualId={ciclo.etapaActual.id} />

        {ciclo.ramasCerradas.length > 0 && (
          <>
            <div style={styles.lineaTitulo}>Ramas cerradas</div>
            {ciclo.ramasCerradas.map(rama => (
              <div key={rama.despachoId} style={styles.ramaBloque}>
                <div style={styles.ramaHeader}>
                  Despacho {rama.numero || rama.despachoId} -- {rama.estado === 'RECHAZADO' ? 'Rechazado' : 'Cancelado'}
                  {rama.cerradoTs ? ` -- ${formatoFechaTs({ toDate: () => rama.cerradoTs })}` : ''}
                </div>
                {rama.motivo && <div style={styles.ramaMotivo}>Motivo: {rama.motivo}</div>}
                {rama.quien && <div style={styles.ramaMotivo}>Por: {rama.quien}</div>}
                <LineaTiempo etapas={rama.etapas} etapaActualId={null} chica />
              </div>
            ))}
          </>
        )}
      </Modal>

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
    </>
  );
}

function LineaTiempo({ etapas, etapaActualId, chica }) {
  const styles = useEstilos();
  return (
    <div style={styles.timeline}>
      {etapas.map(e => (
        <div key={e.id} style={styles.timelineItem}>
          <div style={{ ...styles.timelinePunto, ...(e.ts ? styles.timelinePuntoConDato : {}), ...(e.id === etapaActualId ? styles.timelinePuntoActual : {}) }} />
          <div style={styles.timelineContenido}>
            <div style={{ ...styles.timelineEtiqueta, fontSize: chica ? tipografia.tamano.sm : tipografia.tamano.md }}>
              {e.etiqueta}
            </div>
            <div style={styles.timelineDato}>
              {e.ts ? formatoFechaTs({ toDate: () => e.ts }) : 'Sin registro'}
              {e.quien ? ` -- ${e.quien}` : ''}
            </div>
            {e.duracionDesdeAnteriorMs !== null && e.duracionDesdeAnteriorMs !== undefined && (
              <div style={styles.timelineDuracion}>
                +{formatoDuracion(e.duracionDesdeAnteriorMs)}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function formatoDuracion(ms) {
  const minutos = Math.round(ms / 60000);
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 48) return `${horas} h`;
  return `${Math.floor(horas / 24)} día(s)`;
}

/* -----------------------------------------------------------------------------
 * Estilos -- crearEstilos(colores, oscuro) + useEstilos()
 * -------------------------------------------------------------------------- */

function crearEstilos(colores, oscuro) {
  const pal = paletaTexto(oscuro);
  return {
    wrap: { maxWidth: 1100, margin: '0 auto', padding: `${espacio.xl}px ${espacio.lg}px` },
    panelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: espacio.lg },
    titulo: { fontSize: tipografia.tamano.titulo, fontWeight: tipografia.peso.negrita, color: colores.texto },
    bannerError: {
      padding: '10px 14px', borderRadius: radio.md, background: colorEstado.peligroFondo,
      border: `0.5px solid ${colorEstado.peligroBordeAlterno}`, fontSize: tipografia.tamano.md,
      color: colorEstado.peligroTexto,
    },
    bannerErrorChico: {
      padding: '8px 10px', borderRadius: radio.sm, background: colorEstado.peligroFondo,
      fontSize: tipografia.tamano.sm, color: colorEstado.peligroTexto, marginBottom: espacio.sm,
      overflowWrap: 'anywhere', wordBreak: 'break-word',
    },

    pastillasGrupo: { marginBottom: espacio.md },

    filaContenido: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
    filaCliente: { fontSize: tipografia.tamano.md, color: colores.texto, fontWeight: tipografia.peso.medio },
    filaProducto: { fontSize: tipografia.tamano.sm, color: colores.textoSecundario },
    filaEntregaN: { fontSize: tipografia.tamano.sm, color: pal.azul },
    filaDias: { fontSize: tipografia.tamano.sm, color: colores.textoSuave },
    filaNumero: { fontSize: tipografia.tamano.sm, color: colores.textoTenue, marginLeft: 'auto', fontFamily: 'monospace' },

    detalleResumen: { display: 'flex', gap: espacio.md, flexWrap: 'wrap', fontSize: tipografia.tamano.sm, color: colores.textoSecundario, marginBottom: espacio.md },
    marcasFila: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: espacio.md },

    lineaTitulo: { fontSize: tipografia.tamano.md, fontWeight: tipografia.peso.medio, color: colores.texto, margin: `${espacio.md}px 0 ${espacio.sm}px` },

    timeline: { display: 'flex', flexDirection: 'column' },
    timelineItem: { display: 'flex', gap: espacio.sm, paddingBottom: espacio.md, position: 'relative' },
    timelinePunto: { width: 10, height: 10, borderRadius: '50%', background: colores.borde, marginTop: 4, flexShrink: 0 },
    timelinePuntoConDato: { background: colorEstado.acentoVerde },
    timelinePuntoActual: { boxShadow: `0 0 0 3px ${colorEstado.acentoAzulFuerte}33` },
    timelineContenido: { flex: 1 },
    timelineEtiqueta: { color: colores.texto, fontWeight: tipografia.peso.medio },
    timelineDato: { fontSize: tipografia.tamano.sm, color: colores.textoSuave },
    timelineDuracion: { fontSize: tipografia.tamano.xs, color: colores.textoTenue },

    ramaBloque: { padding: espacio.sm, background: colores.fondoAlterno, borderRadius: radio.md, marginBottom: espacio.sm },
    ramaHeader: { fontSize: tipografia.tamano.sm, fontWeight: tipografia.peso.medio, color: colores.texto },
    ramaMotivo: { fontSize: tipografia.tamano.sm, color: colorEstado.peligroTexto },

    usoVacio: { fontSize: tipografia.tamano.sm, color: colores.textoTenue },
  };
}

function useEstilos() {
  const { colores, oscuro } = useTema();
  return useMemo(() => crearEstilos(colores, oscuro), [colores, oscuro]);
}
