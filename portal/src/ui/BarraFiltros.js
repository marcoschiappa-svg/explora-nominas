/**
 * =============================================================================
 * BarraFiltros.js — v1.2.0 (RF-01)
 * =============================================================================
 *
 * SÍNTOMA
 *   `Pedidos.js` y `Programacion.js` iban a necesitar, cada una, su propio
 *   desplegable de selección múltiple y su propio selector de rango de
 *   fecha -- la misma clase de duplicación que ya se evitó una vez con
 *   `ui/tokens.js` y compañía (B1).
 *
 * CAUSA RAÍZ
 *   No había un componente de presentación genérico para "una barra de
 *   filtros" -- lo más parecido, `FiltroMulti` en `Seguimiento.js`, es local
 *   a esa pantalla y no maneja rangos de fecha ni un panel de "más filtros".
 *
 * ALCANCE
 *   Componente de PRESENTACIÓN puro: no sabe qué es un pedido, un despacho
 *   ni un transportista. Recibe:
 *     - `texto`/`onCambiarTexto` -- el buscador libre.
 *     - `controles` -- qué filtros mostrar y con qué opciones (la pantalla
 *       arma esta lista con sus propios datos ya cargados).
 *     - `valores`/`onCambiarValor(campo, valor)` -- el objeto `filtros` de
 *       `filtros-listado.js` y cómo tocarlo.
 *     - `toggles` -- conmutadores sueltos ("Solo sin cubrir"...). Es la
 *       lista abierta que deja lista la barra para RF-02 ("Viajes abiertos
 *       vencidos"): agregar uno más es agregar un elemento a este array,
 *       sin tocar este archivo.
 *     - `orden` -- criterio + sentido + opciones.
 *     - `totalBase`/`totalVisible` -- el contador "N de M".
 *     - `hayFiltrosActivos`/`onLimpiar` -- "Limpiar filtros".
 *   Todo el cálculo (aplicar filtro, ordenar, qué cuenta como "activo") es
 *   de `filtros-listado.js`; este archivo solo dibuja.
 *
 *   Los controles con `enPanel: true` quedan detrás de "Más filtros" --
 *   pensado para que la fila principal no se desborde en ~1280px (tipo,
 *   creado por, fecha de creación son los candidatos según el prompt).
 *
 *   Mismo patrón que el resto de `ui/`: `crearEstilos(colores, oscuro)` +
 *   `useEstilos()`, con `paletaTexto()` de `tokens.js` (nada de grises para
 *   texto que se lee). Los desplegables (`ControlMulti`, `ControlRango`)
 *   siguen el mismo criterio de cierre-al-clickear-afuera que ya usan
 *   `FiltroMulti` (Seguimiento.js) y `SelectorTransportista`
 *   (Programacion.js) -- cada uno con su propio `useEffect` chico, en vez de
 *   compartir un hook: son tres casos, no justifica la indirección.
 *
 * LIMITACIONES CONOCIDAS
 *   No incluye las pastillas de estado (`PastillaGrupo`) ni el conmutador
 *   Mis/Todos: siguen definidos en cada pantalla porque llevan colores de
 *   dominio (`COLOR_PEDIDO`) que este componente no tiene por qué conocer.
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (rediseño Programación) — VARIANTE COMPACTA
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     El diseño aprobado para `Programacion.js` ("Portal Programación") pide
 *     un panel de filtros mucho más chico que el de siempre: solo el
 *     buscador a ancho completo y un botón "Filtros y orden" que despliega
 *     TODO lo demás (los seis controles de RF-01 más el selector de orden) --
 *     nada de eso queda visible de entrada, a diferencia de la variante de
 *     siempre (`principales` sueltos en la fila).
 *
 *   CAUSA RAÍZ
 *     Este componente solo tenía una forma de mostrarse -- la de Pedidos.js
 *     (algunos controles sueltos + "Más filtros" para el resto). El diseño de
 *     Programación pide una jerarquía distinta sin tocar la pantalla que ya
 *     funciona.
 *
 *   ALCANCE
 *     Prop nueva `variante` (`'completa'` por defecto, sin cambio de
 *     comportamiento para `Pedidos.js`; `'compacta'` para `Programacion.js`).
 *     En compacta:
 *       1. TODOS los `controles` (sin importar `enPanel`) y el `orden` caen
 *          detrás de un único botón "Filtros y orden" -- que muestra la
 *          cantidad de filtros activos ("Filtros y orden · 2") calculada acá
 *          mismo, contra `controles`/`valores` (selección no vacía o rango
 *          activo; el propio `orden` no cuenta -- siempre tiene un valor).
 *       2. La franja arranca abierta si esa cantidad es mayor a cero --
 *          UNA sola vez, al montar (con la preferencia ya leída y aplicada
 *          por la pantalla): si el usuario la cierra a mano después, no se
 *          vuelve a abrir sola.
 *       3. `toggles` NO se dibuja acá en compacta -- el diseño los pide como
 *          pastillas rojas al lado de las de estado, mezcladas con ellas;
 *          esa mezcla la arma la pantalla y la pasa entera por `piePastillas`
 *          (que ya existía). Pasar `toggles` en modo compacta no rompe nada,
 *          simplemente no se renderiza -- `Programacion.js` no los pasa.
 *       4. El pie cambia de layout: contador + `piePastillas` juntos a la
 *          izquierda (como pide "A la izquierda, 'N de M pedidos'" seguido
 *          de las pastillas), "Limpiar filtros" a la derecha.
 *
 *   LIMITACIONES CONOCIDAS
 *     La cuenta de "filtros activos" del botón es SOLO de los `controles`
 *     (los seis de RF-01) -- no incluye los toggles ("Solo sin cubrir",
 *     "Viajes abiertos vencidos"), que tienen su propia pastilla y ya se ven
 *     activos ahí mismo sin necesitar el contador del botón.
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm run build` sin warnings. `Programacion.js`: buscador a
 *     ancho completo, botón "Filtros y orden" (con contador si hay algo
 *     activo) que despliega los seis controles + el orden, pastillas de
 *     estado + "Solo sin cubrir" + "Viajes abiertos vencidos" en rojo cuando
 *     están activas. `Pedidos.js`: sin cambios, sigue en `variante="completa"`
 *     (el default).
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (rediseño Pedidos) — PANEL ÚNICO, Y POR QUÉ EL TOGGLE SUPERIOR SIGUE
 * AFUERA
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     El diseño aprobado pide "un panel blanco único (radio 18, borde,
 *     sombra suave) con tres franjas": arriba el segmentado Mis/Todos +
 *     Tarjetas/Tabla, al medio la barra de filtros de siempre, abajo el
 *     contador + las pastillas de estado.
 *
 *   CAUSA RAÍZ
 *     Este componente nunca tuvo chrome de panel propio (fondo, borde,
 *     sombra, radio) -- era solo `display:flex` con controles sueltos. Y el
 *     segmentado Mis/Todos + Tarjetas/Tabla es, a propósito, SOLO de
 *     `Pedidos.js`: `Programacion.js` y `CicloVida.js` no tienen "mis
 *     pedidos" ni una alternativa "tarjetas/tabla" -- meterlo ACÁ le daría a
 *     este componente conocimiento de una pantalla puntual, exactamente lo
 *     que el encabezado de arriba ya dice que no hace con `COLOR_PEDIDO`.
 *
 *   ALCANCE
 *     1. El panel (franjas 2 y 3: buscador+controles+orden, y
 *        contador+pastillas) SÍ se resuelve acá: `wrap` ahora lleva fondo,
 *        borde, radio 18 y sombra suave (tokens GENERALES del tema --
 *        `colores.superficie`/`colores.borde`, no la paleta cálida propia
 *        del rediseño de Pedidos, que es específica de esa pantalla y no
 *        tendría sentido en Programación/Ciclo de vida), con una línea
 *        divisoria entre la fila principal y el pie.
 *     2. Las pastillas de estado (franja inferior) se resuelven con un slot
 *        nuevo, `piePastillas` (un `ReactNode`, no un array con colores de
 *        dominio): la pantalla arma sus propias `<PastillaGrupo>` con
 *        `COLOR_PEDIDO` y se las pasa hechas. Este componente solo les hace
 *        lugar al lado del contador -- sigue sin saber qué es "programado
 *        parcial".
 *     3. El segmentado superior (franja 1: Mis/Todos + Tarjetas/Tabla) SE
 *        QUEDA AFUERA, en `Pedidos.js`, tal como ya estaba -- pero ahora
 *        dibujado con el mismo lenguaje visual (mismo radio, mismo borde,
 *        mismo fondo) pegado JUSTO ENCIMA de este panel, para que el
 *        conjunto se vea como una sola pieza aunque sean dos elementos del
 *        DOM. Es la opción que pide el prompt de la tarea por default: menos
 *        invasiva, no le agrega a este componente compartido una noción que
 *        Programación y Ciclo de vida no necesitan y no van a poder usar.
 *
 *   LIMITACIONES CONOCIDAS
 *     La franja superior no queda matemáticamente "soldada" al panel de acá
 *     abajo (son dos `<div>` con un espacio chico entre sí, no un único
 *     `border-radius` continuo) -- se ven como parte del mismo conjunto,
 *     pero un inspector de elementos sí encuentra el límite. Aceptado a
 *     cambio de no acoplar este componente a Pedidos.js.
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm run build` sin warnings. Pedidos.js: el toggle de arriba
 *     y el panel de filtros se leen como una sola tarjeta, en claro y en
 *     oscuro. Programación y Ciclo de vida: la barra sigue funcionando
 *     igual, ahora con el mismo panel blanco (sin el segmentado, que nunca
 *     tuvieron).
 * ========================================================================== */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { marca, colorEstado, espacio, radio, tipografia, paletaTexto } from '../shared/tokens';
import { useTema } from './TemaContext';
import Boton from './Boton';

const ATAJOS_FECHA = [
  { id: 'hoy', label: 'Hoy' },
  { id: '7dias', label: 'Próximos 7 días' },
  { id: 'mes', label: 'Este mes' },
  { id: 'personalizado', label: 'Personalizado' },
];

// v1.2.0 (rediseño Programación) -- duplica el criterio de `rangoActivo()`
// (privada de `filtros-listado.js`, no exportada) para que la variante
// compacta pueda contar un rango como "filtro activo" sin importar lógica de
// dominio en este componente de presentación -- mismo criterio que otras
// duplicaciones chicas ya aceptadas en el repo (`hoyISO()`, etc.).
function rangoActivoBF(filtroFecha) {
  if (!filtroFecha) return false;
  if (filtroFecha.atajo && filtroFecha.atajo !== 'personalizado') return true;
  return !!(filtroFecha.desde || filtroFecha.hasta);
}

function useCerrarAlClickearAfuera(abierto, cerrar) {
  const ref = useRef(null);
  useEffect(() => {
    if (!abierto) return;
    function alClick(e) {
      if (ref.current && !ref.current.contains(e.target)) cerrar();
    }
    document.addEventListener('mousedown', alClick);
    return () => document.removeEventListener('mousedown', alClick);
  }, [abierto, cerrar]);
  return ref;
}

/* -----------------------------------------------------------------------------
 * Control de selección múltiple -- checkboxes en un desplegable.
 * -------------------------------------------------------------------------- */

function ControlMulti({ etiqueta, opciones, seleccion, onCambiar, vacio }) {
  const styles = useEstilos();
  const [abierto, setAbierto] = useState(false);
  const ref = useCerrarAlClickearAfuera(abierto, () => setAbierto(false));

  const hayFiltro = (seleccion || []).length > 0;
  const textoBoton = !hayFiltro
    ? etiqueta
    : seleccion.length === 1
      ? (opciones.find(o => o.id === seleccion[0]) || {}).label || etiqueta
      : `${etiqueta} (${seleccion.length})`;

  function alternar(id) {
    if (seleccion.includes(id)) onCambiar(seleccion.filter(x => x !== id));
    else onCambiar([...seleccion, id]);
  }

  return (
    <div ref={ref} style={styles.controlWrap}>
      <button
        type="button"
        style={{ ...styles.controlBtn, ...(hayFiltro ? styles.controlBtnActivo : {}) }}
        onClick={() => setAbierto(a => !a)}
        title={hayFiltro ? seleccion.map(id => (opciones.find(o => o.id === id) || {}).label).filter(Boolean).join(', ') : etiqueta}
      >
        <span style={styles.controlBtnTxt}>{textoBoton}</span>
        <span style={styles.controlFlecha}>{abierto ? '▲' : '▼'}</span>
      </button>

      {abierto && (
        <div style={styles.panel}>
          {opciones.length === 0 && <div style={styles.panelVacio}>{vacio || 'Sin opciones'}</div>}
          {opciones.length > 0 && (
            <>
              <div style={styles.panelAcciones}>
                <button type="button" style={styles.panelAccionBtn} onClick={() => onCambiar(opciones.map(o => o.id))}>Todos</button>
                <button type="button" style={styles.panelAccionBtn} onClick={() => onCambiar([])}>Ninguno</button>
              </div>
              <div style={styles.panelLista}>
                {opciones.map(o => (
                  <label key={o.id} style={styles.panelOpcion}>
                    <input
                      type="checkbox"
                      checked={seleccion.includes(o.id)}
                      onChange={() => alternar(o.id)}
                      style={{ margin: 0, cursor: 'pointer' }}
                    />
                    <span style={styles.panelOpcionTxt}>{o.label}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Control de rango de fecha -- atajos + desde/hasta cuando es "Personalizado".
 * -------------------------------------------------------------------------- */

function ControlRango({ etiqueta, valor, onCambiar }) {
  const styles = useEstilos();
  const [abierto, setAbierto] = useState(false);
  const ref = useCerrarAlClickearAfuera(abierto, () => setAbierto(false));

  const v = valor || { atajo: null, desde: null, hasta: null };
  const activo = !!(v.atajo || v.desde || v.hasta);
  const atajoActivo = ATAJOS_FECHA.find(a => a.id === v.atajo);
  const textoBoton = !activo ? etiqueta : atajoActivo ? `${etiqueta}: ${atajoActivo.label}` : `${etiqueta}: rango`;

  function elegirAtajo(id) {
    if (id === 'personalizado') {
      onCambiar({ atajo: 'personalizado', desde: v.desde, hasta: v.hasta });
    } else {
      onCambiar({ atajo: id, desde: null, hasta: null });
    }
  }

  function cambiarFecha(campo, val) {
    onCambiar({ atajo: 'personalizado', desde: v.desde, hasta: v.hasta, [campo]: val || null });
  }

  return (
    <div ref={ref} style={styles.controlWrap}>
      <button
        type="button"
        style={{ ...styles.controlBtn, ...(activo ? styles.controlBtnActivo : {}) }}
        onClick={() => setAbierto(a => !a)}
      >
        <span style={styles.controlBtnTxt}>{textoBoton}</span>
        <span style={styles.controlFlecha}>{abierto ? '▲' : '▼'}</span>
      </button>

      {abierto && (
        <div style={{ ...styles.panel, minWidth: 220 }}>
          <div style={styles.panelAtajos}>
            {ATAJOS_FECHA.map(a => (
              <button
                key={a.id}
                type="button"
                style={{ ...styles.panelAtajoBtn, ...(v.atajo === a.id ? styles.panelAtajoBtnActivo : {}) }}
                onClick={() => elegirAtajo(a.id)}
              >
                {a.label}
              </button>
            ))}
          </div>

          {v.atajo === 'personalizado' && (
            <div style={styles.panelFechas}>
              <label style={styles.panelFechaLabel}>
                Desde
                <input
                  type="date" style={styles.panelFechaInput}
                  value={v.desde || ''} onChange={e => cambiarFecha('desde', e.target.value)}
                />
              </label>
              <label style={styles.panelFechaLabel}>
                Hasta
                <input
                  type="date" style={styles.panelFechaInput}
                  value={v.hasta || ''} onChange={e => cambiarFecha('hasta', e.target.value)}
                />
              </label>
            </div>
          )}

          {activo && (
            <button
              type="button" style={styles.panelLimpiarBtn}
              onClick={() => onCambiar({ atajo: null, desde: null, hasta: null })}
            >
              ✕ Quitar este filtro
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * v1.2.0 (nuevo_tarifario) -- Control de rango NUMÉRICO: dos <input
 * type="number"> (desde/hasta), sin atajos -- a diferencia de `ControlRango`
 * (fecha), acá no hay "Hoy"/"7 días"/"Mes" que tengan sentido para, por
 * ejemplo, un rango de km. Mismo hook de cierre-al-clickear-afuera y mismo
 * estilo de botón/panel que los demás controles desplegables.
 * -------------------------------------------------------------------------- */

function ControlRangoNumero({ etiqueta, valor, onCambiar }) {
  const styles = useEstilos();
  const [abierto, setAbierto] = useState(false);
  const ref = useCerrarAlClickearAfuera(abierto, () => setAbierto(false));

  const v = valor || { desde: null, hasta: null };
  const activo = (v.desde !== null && v.desde !== undefined) || (v.hasta !== null && v.hasta !== undefined);
  const textoBoton = !activo ? etiqueta : `${etiqueta}: ${v.desde ?? ''}${v.desde != null || v.hasta != null ? ' - ' : ''}${v.hasta ?? ''}`;

  function cambiarNumero(campo, val) {
    const num = val === '' ? null : Number(val);
    onCambiar({ ...v, [campo]: num === null || Number.isNaN(num) ? null : num });
  }

  return (
    <div ref={ref} style={styles.controlWrap}>
      <button
        type="button"
        style={{ ...styles.controlBtn, ...(activo ? styles.controlBtnActivo : {}) }}
        onClick={() => setAbierto(a => !a)}
      >
        <span style={styles.controlBtnTxt}>{textoBoton}</span>
        <span style={styles.controlFlecha}>{abierto ? '▲' : '▼'}</span>
      </button>

      {abierto && (
        <div style={{ ...styles.panel, minWidth: 180 }}>
          <div style={styles.panelFechas}>
            <label style={styles.panelFechaLabel}>
              Desde
              <input
                type="number" style={styles.panelFechaInput}
                value={v.desde ?? ''} onChange={e => cambiarNumero('desde', e.target.value)}
              />
            </label>
            <label style={styles.panelFechaLabel}>
              Hasta
              <input
                type="number" style={styles.panelFechaInput}
                value={v.hasta ?? ''} onChange={e => cambiarNumero('hasta', e.target.value)}
              />
            </label>
          </div>

          {activo && (
            <button
              type="button" style={styles.panelLimpiarBtn}
              onClick={() => onCambiar({ desde: null, hasta: null })}
            >
              ✕ Quitar este filtro
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Componente principal
 * -------------------------------------------------------------------------- */

/**
 * @param {Object} props
 * @param {string} props.texto
 * @param {(t: string) => void} props.onCambiarTexto
 * @param {string} [props.placeholderTexto]
 * @param {Array<{campo:string, tipo:'multi'|'rango'|'rangoNumero', etiqueta:string, opciones?:Array<{id,label}>, vacio?:string, enPanel?:boolean}>} props.controles
 *   `'rangoNumero'` (v1.2.0, nuevo_tarifario) -- rango numérico sin atajos
 *   (desde/hasta), sin `opciones`. Ver `ControlRangoNumero`.
 * @param {Object} props.valores El objeto `filtros` (ver `filtros-listado.js`)
 * @param {(campo: string, valor: any) => void} props.onCambiarValor
 * @param {Array<{id:string, label:string, activo:boolean, onClick:()=>void}>} [props.toggles]
 * @param {{opciones:Array<{id,label}>, valor:string, sentido:'asc'|'desc', onCambiarValor:(id)=>void, onCambiarSentido:()=>void}} [props.orden]
 * @param {number} props.totalBase
 * @param {number} props.totalVisible
 * @param {boolean} props.hayFiltrosActivos
 * @param {() => void} props.onLimpiar
 * @param {string} [props.etiquetaItem] plural del ítem para el contador -- "pedidos" por defecto
 * @param {React.ReactNode} [props.piePastillas] v1.2.0 (rediseño Pedidos) --
 *   slot libre en la franja inferior, al lado del contador (pastillas de
 *   estado con su color de dominio, armadas por la pantalla que llama).
 * @param {'completa'|'compacta'} [props.variante] v1.2.0 (rediseño
 *   Programación) -- ver el encabezado de ese nombre más arriba. Default
 *   `'completa'`, el comportamiento de siempre (`Pedidos.js`).
 */
export default function BarraFiltros({
  texto, onCambiarTexto, placeholderTexto = 'Buscar...',
  controles = [], valores = {}, onCambiarValor,
  toggles = [],
  orden,
  totalBase, totalVisible,
  hayFiltrosActivos, onLimpiar,
  etiquetaItem = 'pedidos',
  piePastillas = null,
  variante = 'completa',
}) {
  const styles = useEstilos();
  const compacta = variante === 'compacta';
  const [masFiltros, setMasFiltros] = useState(false);

  // v1.2.0 (rediseño Programación) -- en compacta, TODO cae detrás del botón
  // "Filtros y orden" (sin importar `enPanel`, que en esta variante no se
  // usa). Ver el encabezado.
  const principales = useMemo(() => (compacta ? [] : controles.filter(c => !c.enPanel)), [controles, compacta]);
  const enPanel = useMemo(() => (compacta ? controles : controles.filter(c => c.enPanel)), [controles, compacta]);

  const cantidadFiltrosActivos = useMemo(() => {
    if (!compacta) return 0;
    return controles.reduce((n, c) => {
      const v = valores[c.campo];
      // v1.2.0 (nuevo_tarifario) -- `rangoNumero` cuenta como activo con el
      // mismo criterio que `rangoActivoBF()` (fecha), pero sin atajos.
      const activo = c.tipo === 'rango'
        ? rangoActivoBF(v)
        : c.tipo === 'rangoNumero'
          ? !!(v && ((v.desde !== null && v.desde !== undefined) || (v.hasta !== null && v.hasta !== undefined)))
          : (v || []).length > 0;
      return n + (activo ? 1 : 0);
    }, 0);
  }, [compacta, controles, valores]);

  // Arranca abierta si hay algo activo -- UNA sola vez, al montar (o cuando
  // la pantalla termina de aplicar la preferencia guardada y `valores`
  // cambia por primera vez con algo activo). Después, si el usuario la
  // cierra a mano, se queda cerrada aunque `cantidadFiltrosActivos` no
  // cambie.
  const seAbrioSolaRef = useRef(false);
  useEffect(() => {
    if (compacta && !seAbrioSolaRef.current && cantidadFiltrosActivos > 0) {
      setMasFiltros(true);
      seAbrioSolaRef.current = true;
    }
  }, [compacta, cantidadFiltrosActivos]);

  function renderControl(c) {
    if (c.tipo === 'rango') {
      return (
        <ControlRango
          key={c.campo}
          etiqueta={c.etiqueta}
          valor={valores[c.campo]}
          onCambiar={v => onCambiarValor(c.campo, v)}
        />
      );
    }
    // v1.2.0 (nuevo_tarifario) -- rango NUMÉRICO (p.ej. "km"), sin atajos.
    if (c.tipo === 'rangoNumero') {
      return (
        <ControlRangoNumero
          key={c.campo}
          etiqueta={c.etiqueta}
          valor={valores[c.campo]}
          onCambiar={v => onCambiarValor(c.campo, v)}
        />
      );
    }
    return (
      <ControlMulti
        key={c.campo}
        etiqueta={c.etiqueta}
        opciones={c.opciones || []}
        vacio={c.vacio}
        seleccion={valores[c.campo] || []}
        onCambiar={sel => onCambiarValor(c.campo, sel)}
      />
    );
  }

  // v1.2.0 (rediseño Programación) -- en compacta, el `orden` viaja adentro
  // de la franja desplegable junto con los controles (no en la fila
  // principal, que solo tiene buscador + botón). En completa, sigue en la
  // fila principal como siempre.
  const ordenControl = orden && (
    <div style={styles.ordenWrap}>
      <select
        style={styles.selectOrden}
        value={orden.valor}
        onChange={e => orden.onCambiarValor(e.target.value)}
      >
        {orden.opciones.map(o => <option key={o.id} value={o.id}>Ordenar: {o.label}</option>)}
      </select>
      <button
        type="button"
        style={styles.sentidoBtn}
        onClick={orden.onCambiarSentido}
        title={orden.sentido === 'desc' ? 'Descendente -- click para ascendente' : 'Ascendente -- click para descendente'}
      >
        {orden.sentido === 'desc' ? '↓' : '↑'}
      </button>
    </div>
  );

  return (
    <div style={styles.wrap}>
      <div style={styles.filaPrincipal}>
        <input
          style={{ ...styles.buscador, ...(compacta ? styles.buscadorCompacto : {}) }}
          value={texto}
          onChange={e => onCambiarTexto(e.target.value)}
          placeholder={placeholderTexto}
        />

        {principales.map(renderControl)}

        {!compacta && toggles.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={t.onClick}
            style={{ ...styles.toggleBtn, ...(t.activo ? styles.toggleBtnActivo : {}) }}
          >
            {t.activo ? '✓ ' : ''}{t.label}
          </button>
        ))}

        {/* v1.2.0 (rediseño Programación) -- en compacta, un único botón
            "Filtros y orden" reemplaza a "Más filtros": existe siempre que
            haya controles (no solo los `enPanel`, que acá es la lista
            entera) y muestra la cantidad activa. */}
        {compacta && controles.length > 0 && (
          <button
            type="button"
            style={{ ...styles.controlBtn, ...(masFiltros || cantidadFiltrosActivos > 0 ? styles.controlBtnActivo : {}) }}
            onClick={() => setMasFiltros(v => !v)}
          >
            <span style={styles.controlBtnTxt}>
              Filtros y orden{cantidadFiltrosActivos > 0 ? ` · ${cantidadFiltrosActivos}` : ''}
            </span>
            <span style={styles.controlFlecha}>{masFiltros ? '▲' : '▼'}</span>
          </button>
        )}

        {!compacta && enPanel.length > 0 && (
          <button
            type="button"
            style={{ ...styles.controlBtn, ...(masFiltros ? styles.controlBtnActivo : {}) }}
            onClick={() => setMasFiltros(v => !v)}
          >
            <span style={styles.controlBtnTxt}>Más filtros</span>
            <span style={styles.controlFlecha}>{masFiltros ? '▲' : '▼'}</span>
          </button>
        )}

        {!compacta && ordenControl}
      </div>

      {masFiltros && enPanel.length > 0 && (
        <div style={styles.filaPanel}>
          {enPanel.map(renderControl)}
          {compacta && ordenControl}
        </div>
      )}

      {!compacta && (
        <div style={styles.filaPie}>
          <div style={styles.filaPieIzquierda}>
            <span style={styles.contador}>
              {totalVisible} de {totalBase} {etiquetaItem}
            </span>
            {hayFiltrosActivos && (
              <Boton variante="secundario" chico onClick={onLimpiar}>✕ Limpiar filtros</Boton>
            )}
          </div>
          {piePastillas && <div style={styles.filaPieDerecha}>{piePastillas}</div>}
        </div>
      )}

      {/* v1.2.0 (rediseño Programación) -- pie compacto: contador +
          pastillas (estado + toggles, ya armadas por la pantalla) juntos a
          la izquierda, "Limpiar filtros" a la derecha. */}
      {compacta && (
        <div style={styles.filaPieCompacta}>
          <div style={styles.filaPieCompactaIzquierda}>
            <span style={styles.contador}>
              {totalVisible} de {totalBase} {etiquetaItem}
            </span>
            {piePastillas}
          </div>
          {hayFiltrosActivos && (
            <Boton variante="secundario" chico onClick={onLimpiar}>✕ Limpiar filtros</Boton>
          )}
        </div>
      )}
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Estilos
 * -------------------------------------------------------------------------- */

function crearEstilos(colores, oscuro) {
  const pal = paletaTexto(oscuro);

  return {
    // v1.2.0 (rediseño Pedidos) -- chrome de panel único, ver el encabezado
    // de este archivo. Tokens GENERALES del tema (no la paleta cálida de
    // Pedidos): este componente lo comparten pantallas sin esa paleta.
    wrap: {
      display: 'flex', flexDirection: 'column', gap: espacio.sm, marginBottom: espacio.md,
      background: colores.superficie, border: `1px solid ${colores.borde}`,
      borderRadius: 18, boxShadow: oscuro ? '0 1px 3px rgba(0,0,0,0.3)' : '0 1px 2px rgba(34,32,29,.06)',
      padding: espacio.md,
    },
    filaPrincipal: {
      display: 'flex', gap: espacio.sm, flexWrap: 'wrap', alignItems: 'center',
      paddingBottom: espacio.sm, borderBottom: `1px solid ${colores.borde}`,
    },
    filaPanel: {
      display: 'flex', gap: espacio.sm, flexWrap: 'wrap', alignItems: 'center',
      padding: espacio.sm, background: colores.fondoAlterno, borderRadius: radio.md,
    },
    filaPie: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: espacio.sm, flexWrap: 'wrap' },
    filaPieIzquierda: { display: 'flex', alignItems: 'center', gap: espacio.sm, flexWrap: 'wrap' },
    filaPieDerecha: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    contador: { fontSize: tipografia.tamano.sm, color: pal.azul },

    // v1.2.0 (rediseño Programación) -- pie de la variante compacta: mismo
    // criterio que `filaPie`/`filaPieIzquierda`, pero el contador y las
    // pastillas (`piePastillas`) van SIEMPRE juntos del lado izquierdo -- ver
    // el encabezado "VARIANTE COMPACTA" más arriba.
    filaPieCompacta: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: espacio.sm, flexWrap: 'wrap' },
    filaPieCompactaIzquierda: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },

    buscador: {
      flex: '2 1 220px', fontSize: tipografia.tamano.lg, padding: '8px 12px', borderRadius: radio.md,
      border: `0.5px solid ${colores.borde}`, color: colores.texto, background: colores.superficie,
      fontFamily: tipografia.familia,
    },
    // v1.2.0 (rediseño Programación) -- "Buscador a ancho completo" (Paso 1
    // del prompt): `flex: 1` en vez de `2 1 220px`, así no comparte la fila
    // con ningún otro control -- en compacta, al lado solo va el botón
    // "Filtros y orden" (ancho fijo, no flex).
    buscadorCompacto: { flex: 1 },

    controlWrap: { position: 'relative', flex: '0 1 auto' },
    controlBtn: {
      display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: radio.md,
      border: `0.5px solid ${colores.borde}`, background: colores.superficie, color: pal.azul,
      fontSize: tipografia.tamano.sm, cursor: 'pointer', fontFamily: tipografia.familia, whiteSpace: 'nowrap',
    },
    controlBtnActivo: { borderColor: marca, background: colores.fondoAlterno, color: marca, fontWeight: tipografia.peso.medio },
    controlBtnTxt: { maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    controlFlecha: { fontSize: 9, opacity: 0.7, flexShrink: 0 },

    panel: {
      position: 'absolute', top: 'calc(100% + 4px)', left: 0, minWidth: 200, maxWidth: 280,
      maxHeight: 280, overflowY: 'auto', background: colores.superficieModal,
      border: `0.5px solid ${colores.borde}`, borderRadius: radio.md,
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 200, padding: espacio.xs,
    },
    panelVacio: { padding: '10px 8px', fontSize: tipografia.tamano.sm, color: pal.azul, textAlign: 'center' },
    panelAcciones: { display: 'flex', gap: 4, padding: '2px 4px 6px', borderBottom: `0.5px solid ${colores.borde}`, marginBottom: 4 },
    panelAccionBtn: {
      flex: 1, padding: '3px 6px', borderRadius: radio.sm, border: `0.5px solid ${colores.borde}`,
      background: colores.superficie, color: pal.azul, fontSize: tipografia.tamano.xs, cursor: 'pointer',
    },
    panelLista: { display: 'flex', flexDirection: 'column' },
    panelOpcion: { display: 'flex', alignItems: 'center', gap: 7, padding: '5px 6px', borderRadius: radio.sm, cursor: 'pointer', fontSize: tipografia.tamano.sm, color: colores.texto },
    panelOpcionTxt: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },

    panelAtajos: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 },
    panelAtajoBtn: {
      textAlign: 'left', padding: '6px 8px', borderRadius: radio.sm, border: `0.5px solid ${colores.borde}`,
      background: colores.superficie, color: colores.texto, fontSize: tipografia.tamano.sm, cursor: 'pointer',
    },
    panelAtajoBtnActivo: { borderColor: marca, background: colores.fondoAlterno, color: marca, fontWeight: tipografia.peso.medio },
    panelFechas: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 6, paddingTop: 6, borderTop: `0.5px solid ${colores.borde}` },
    panelFechaLabel: { display: 'flex', flexDirection: 'column', gap: 2, fontSize: tipografia.tamano.xs, color: pal.azul },
    panelFechaInput: {
      fontSize: tipografia.tamano.sm, padding: '6px 8px', borderRadius: radio.sm,
      border: `0.5px solid ${colores.borde}`, color: colores.texto, background: colores.superficie,
      fontFamily: tipografia.familia,
    },
    panelLimpiarBtn: {
      width: '100%', padding: '5px 6px', border: 'none', background: 'none', color: pal.rojo,
      fontSize: tipografia.tamano.xs, cursor: 'pointer', textAlign: 'left',
    },

    toggleBtn: {
      padding: '7px 12px', borderRadius: radio.pastilla, cursor: 'pointer', whiteSpace: 'nowrap',
      fontSize: tipografia.tamano.sm, fontWeight: tipografia.peso.normal,
      background: colores.fondoAlterno, color: pal.azul,
      border: '1px solid transparent',
    },
    toggleBtnActivo: {
      background: colorEstado.advertenciaFondo, color: colorEstado.advertenciaTexto,
      border: `1px solid ${colorEstado.advertenciaBorde}`, fontWeight: tipografia.peso.medio,
    },

    ordenWrap: { display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' },
    selectOrden: {
      fontSize: tipografia.tamano.sm, padding: '7px 10px', borderRadius: radio.md,
      border: `0.5px solid ${colores.borde}`, color: colores.textoSecundario, background: colores.superficie,
      fontFamily: tipografia.familia,
    },
    sentidoBtn: {
      width: 30, height: 32, borderRadius: radio.md, border: `0.5px solid ${colores.borde}`,
      background: colores.superficie, color: pal.azul, cursor: 'pointer', fontSize: tipografia.tamano.lg,
      flexShrink: 0,
    },
  };
}

function useEstilos() {
  const { colores, oscuro } = useTema();
  return useMemo(() => crearEstilos(colores, oscuro), [colores, oscuro]);
}
