/* =============================================================================
 * ModalDetallePedido.js — v1.2.0 (rediseño Programación)
 * =============================================================================
 *
 * PROPÓSITO
 * El detalle de un pedido en Programación: datos del pedido a la izquierda,
 * panel "ENTREGAS" a la derecha -- una tarjeta por entrega, con una línea por
 * cada despacho vivo y los botones de siempre (asignar/reasignar, editar,
 * cancelar, cerrar viaje a mano).
 *
 * -----------------------------------------------------------------------------
 * DE `Programacion.js` A ACÁ -- MISMA LÓGICA, DISEÑO NUEVO
 * -----------------------------------------------------------------------------
 *   Este archivo reemplaza a `ModalDetallePrograma`/`BloqueEntregaPrograma`/
 *   `DespachoBloque`, que vivían dentro de `Programacion.js` (ver el
 *   encabezado de ese archivo, "V5" en el reporte de la tarea: el detalle YA
 *   era un modal antes de este rediseño -- lo que cambia es el diseño
 *   adentro, no si es modal o no). Ninguna función de `logica-despachos.js`/
 *   `logica-viajes.js` cambió: los mismos ocho props de acción
 *   (`onAceptar`/`onAsignar`/`onEditar`/`onCancelar`/`onCerrarManual`) siguen
 *   llegando desde `Programacion.js` igual que antes, con la misma firma.
 *
 *   LO QUE CAMBIA ES LA PRESENTACIÓN, según el diseño aprobado ("Portal
 *   Programación", Claude Design):
 *     1. Título "Pedido <OV/OC>" + el número PED chico y tenue debajo (antes:
 *        "Pedido <numero>" a secas).
 *     2. Grilla de datos con etiquetas en mayúsculas chicas, y la nota del
 *        pedido (`p.obs`) en caja roja -- mismos colores que la caja
 *        `notaPedido` de `paletaProgramacion()` (`ui/tokens.js`).
 *     3. El panel "ENTREGAS" separa las entregas vivas (arriba, ordenadas por
 *        número -- `ordenarEntregasPorNumero()`, `programacion/logica-vista.js`)
 *        de las cumplidas/suspendidas (abajo, atenuadas). El diseño trae un
 *        chip de PRIORIDAD por entrega que se descarta a propósito -- ver el
 *        Paso 3 del prompt ("No hay prioridad: las entregas se ordenan por
 *        número") y el encabezado de `logica-vista.js`.
 *     4. Cada despacho VIVO es una línea con su propio chip de estado (los
 *        TRES estilos del diseño -- `estiloEstadoDespacho()`, no los siete
 *        colores de `COLOR_DESPACHO`), "carga <fecha larga>" en verde si está
 *        confirmado, y el transportista en rojo marca. Los botones
 *        (Asignar/Reasignar/Editar/Cancelar/Cerrar viaje a mano) van DENTRO
 *        de la línea de CADA despacho -- el prompt lo pide explícito para
 *        cuando una entrega tiene más de uno.
 *     5. "Asignar transporte" (entrega sin cubrir) pasa de estar siempre
 *        visible a un botón primario que abre el mismo formulario de
 *        siempre -- mismos campos (fecha, horario, `SelectorTransportista`
 *        con RF-08), mismo bloqueo de calendario (RF-10, `evaluarFechaCarga`).
 *     6. La fecha SOLICITADA de la entrega ahora también pasa por
 *        `evaluarFechaEntrega()` (RF-10, la versión que SOLO ADVIERTE, igual
 *        que ya hace `Pedidos.js`) -- antes esta pantalla solo evaluaba la
 *        fecha de CARGA del despacho (`evaluarFechaCarga()`, que sí bloquea).
 *        Las dos conviven: la solicitada avisa, la de carga bloquea, mismo
 *        criterio que el resto del portal.
 *     7. Despachos rechazados/cancelados: plegados bajo "Ver N anteriores",
 *        atenuados, con su motivo -- antes era una sola línea de texto
 *        ("N despachos anteriores -- ver historial arriba") sin poder verlos
 *        sin salir al historial completo.
 *
 * DISCREPANCIA CON EL DISEÑO (frenada, no resuelta a mano)
 *   El diseño pide un chip "Con camión"/"Sin camión" por entrega, según un
 *   campo binario que esta pantalla no tiene (mismo caso ya resuelto en
 *   `Pedidos.js`, ver su propio encabezado v1.2.0 (rediseño Pedidos)): se
 *   mantiene el chip existente, la etiqueta de `ETIQUETA_ENTREGA` ("Sin
 *   cubrir"/"Con camión"/"Entregada"/"Suspendida"), que ya cumple ese lugar
 *   visual.
 *
 * LIMITACIONES CONOCIDAS
 *   Este modelo no tiene cobertura PARCIAL de una entrega (ver el
 *   encabezado de `logica-vista.js`): la línea "Sin cubrir" que pide el
 *   Paso 3 del prompt ("además" de las líneas de despacho) nunca convive acá
 *   con líneas de despacho reales, porque si hay algún despacho vivo la
 *   entrega ya no está "sin cubrir" -- se muestra una cosa o la otra, nunca
 *   las dos para la misma entrega.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Ver las pruebas manuales al pie del
 *   prompt de la tarea, sección "Detalle, datos" y "Detalle, acciones".
 * ========================================================================== */

import React, { useState, useMemo } from 'react';
import { textoDomicilio } from '../../buscar-domicilios';
import { hoyISO } from '../../logica-pedidos';
import {
  DESPACHO, ETIQUETA_DESPACHO, ETIQUETA_ENTREGA, ETIQUETA_PEDIDO, COLOR_PEDIDO,
  despachoVivo, entregaSinCubrir, viajeAbierto, viajeVencido,
  puedeAsignar, puedeReasignar, puedeEditar, puedeCancelar,
} from '../../shared/estados';
import { evaluarFechaCarga, evaluarFechaEntrega } from '../../logica-calendario';
import {
  ordenarEntregasPorNumero, estiloEstadoDespacho, separarDespachosPorVida, formatearFechaLarga,
} from './logica-vista';
import SelectorTransportista from './SelectorTransportista';
import {
  marca, colorEstado, espacio, radio, tipografia, paletaProgramacion, radioProgramacion,
} from '../../shared/tokens';
import { useTema } from '../../ui/TemaContext';
import Boton from '../../ui/Boton';
import Pastilla from '../../ui/Pastilla';
import Campo from '../../ui/Campo';
import Modal from '../../ui/Modal';

/* -----------------------------------------------------------------------------
 * Componente principal
 * -------------------------------------------------------------------------- */

export default function ModalDetallePedido({
  x, org, prod, domsPorId, orgsPorId, transportistas, viajePorDespacho,
  calendarioDias, calendarioReglas,
  asignando, setAsignando, editando, setEditando,
  ocupado, onAceptar, onAsignar, onEditar, onCancelar, onCerrarManual, setError,
  onCerrar, onVerHistorial,
}) {
  const styles = useEstilos();
  const p = x.pedido;
  const colEstado = COLOR_PEDIDO[p.estado] || COLOR_PEDIDO.pendiente;

  // Mismo criterio que Pedidos.js: para "Entrega al cliente" cada entrega
  // puede tener su propio destino -- se muestra por entrega, no una vez del
  // lado del pedido.
  const esEntregaAlCliente = p.tipo === 'Entrega al cliente';
  const destinoPedido = domsPorId.get(p.destino_domicilio_id);

  // Paso 3: entregas cumplidas/suspendidas van al final, atenuadas -- el
  // resto, ordenadas por número (sin prioridad, ver el encabezado).
  const { activas, terminadas } = useMemo(() => {
    const ordenadas = ordenarEntregasPorNumero(x.entregas);
    return {
      activas: ordenadas.filter(it => it.entrega.estado !== 'cumplida' && it.entrega.estado !== 'suspendida'),
      terminadas: ordenadas.filter(it => it.entrega.estado === 'cumplida' || it.entrega.estado === 'suspendida'),
    };
  }, [x.entregas]);

  return (
    <Modal
      titulo={(
        <div style={styles.tituloModalWrap}>
          <span style={styles.tituloModal}>Pedido {p.ov || p.numero}</span>
          <span style={styles.tituloModalNumero}>{p.numero}</span>
        </div>
      )}
      onCerrar={onCerrar}
      ancho={960}
      alto="88vh"
    >
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
              <Dato ancho label="Destino" valor={destinoPedido ? textoDomicilio(destinoPedido) : ''} />
            )}
            {esEntregaAlCliente && (
              <Dato ancho label="Destino" valor="Varía por entrega ->" />
            )}
          </div>

          {/* Paso 3: nota del pedido -- solo si hay observaciones (V4). */}
          {p.obs && <div style={styles.notaPedido}>{p.obs}</div>}

          <div style={styles.accionesColumna}>
            <Boton variante="secundario" onClick={onVerHistorial}>Ver historial</Boton>
          </div>
          {/* No hay más acciones a nivel PEDIDO en esta pantalla -- ver V1 en
              el reporte de la tarea: todo lo demás es a nivel entrega o
              despacho, y va en la columna de "ENTREGAS". */}
        </div>

        <div style={styles.modalColumna}>
          <div style={styles.entregasTitulo}>Entregas</div>

          {activas.map(item => (
            <BloqueEntrega
              key={item.entrega.id}
              x={x}
              item={item}
              pedido={p}
              producto={prod}
              esEntregaAlCliente={esEntregaAlCliente}
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
              onAceptar={(form) => onAceptar(item, form)}
              onAsignar={onAsignar}
              onEditar={onEditar}
              onCancelar={onCancelar}
              onCerrarManual={onCerrarManual}
              setError={setError}
            />
          ))}

          {terminadas.map(item => (
            <div key={item.entrega.id} style={styles.entregaAtenuada}>
              <BloqueEntrega
                x={x}
                item={item}
                pedido={p}
                producto={prod}
                esEntregaAlCliente={esEntregaAlCliente}
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
                onAceptar={(form) => onAceptar(item, form)}
                onAsignar={onAsignar}
                onEditar={onEditar}
                onCancelar={onCancelar}
                onCerrarManual={onCerrarManual}
                setError={setError}
              />
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function Dato({ label, valor, ancho = false }) {
  const styles = useEstilos();
  const tieneValor = valor !== undefined && valor !== null && valor !== '';
  return (
    <div style={{ ...styles.field, ...(ancho ? { gridColumn: '1 / -1' } : {}) }}>
      <span style={styles.label}>{label}</span>
      <span style={tieneValor ? styles.valorCompleto : styles.valorVacio}>
        {tieneValor ? valor : 'Sin dato'}
      </span>
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Tarjeta de una entrega -- fecha, volumen, despachos vivos, alta si está sin
 * cubrir, despachos anteriores plegados.
 * -------------------------------------------------------------------------- */

function BloqueEntrega({
  x, item, pedido, producto, esEntregaAlCliente, domsPorId, orgsPorId, transportistas, viajePorDespacho,
  calendarioDias, calendarioReglas,
  asignando, setAsignando, editando, setEditando,
  ocupado, onAceptar, onAsignar, onEditar, onCancelar, onCerrarManual, setError,
}) {
  const styles = useEstilos();
  const { oscuro } = useTema();
  const paleta = paletaProgramacion(oscuro);
  const { entrega, despachos } = item;
  const sinCubrir = entregaSinCubrir(entrega, despachos);
  const { vivos: despachosVivos, muertos: despachosMuertos } = separarDespachosPorVida(despachos);

  const [formAbierto, setFormAbierto] = useState(false);
  const [verAnteriores, setVerAnteriores] = useState(false);

  // v1.2.0 (rediseño Programación) -- la fecha SOLICITADA solo ADVIERTE
  // (evaluarFechaEntrega, RF-10), nunca bloquea -- distinto de la fecha de
  // CARGA del formulario de abajo, que sí bloquea (evaluarFechaCarga). Ver
  // el encabezado, punto 6.
  const avisoFechaEntrega = evaluarFechaEntrega(entrega.fecha_solicitada, calendarioDias, calendarioReglas);

  const destinoEntrega = esEntregaAlCliente
    ? domsPorId.get(entrega.destino_domicilio_id || pedido.destino_domicilio_id)
    : null;

  const [form, setForm] = useState({ fecha: entrega.fecha_solicitada, horario: '', transportistaId: '' });
  const calendarioCarga = evaluarFechaCarga(form.fecha, pedido.tipo, calendarioDias, calendarioReglas);

  function crear() {
    if (calendarioCarga.bloquea) return;
    setError('');
    onAceptar(form);
  }

  return (
    <div style={styles.entregaCard}>
      <div style={styles.entregaHeader}>
        <span style={styles.entregaNro}>#{entrega.numero}</span>
        <Pastilla chico>{ETIQUETA_ENTREGA[entrega.estado] || entrega.estado}</Pastilla>
      </div>

      <div style={styles.entregaFecha}>{formatearFechaLarga(entrega.fecha_solicitada)}</div>
      {avisoFechaEntrega.advierte && (
        <div style={styles.avisoCalendario}>{avisoFechaEntrega.motivo}</div>
      )}

      <div style={styles.entregaVolFila}>
        <span style={styles.entregaVol}>{entrega.volumen} tn</span>
        {destinoEntrega && <span style={styles.entregaDestino}>{textoDomicilio(destinoEntrega)}</span>}
      </div>

      <div style={styles.divisor} />

      {/* Una línea por despacho VIVO -- con sus propios botones (el prompt
          pide explícito que, con más de un despacho, los botones vayan
          adentro de cada línea, no una sola vez por tarjeta). */}
      {despachosVivos.map(d => (
        <LineaDespacho
          key={d.id}
          despacho={d}
          producto={producto}
          tipoPedido={pedido.tipo}
          calendarioDias={calendarioDias}
          calendarioReglas={calendarioReglas}
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

      {/* Sin despacho vivo: la línea "Sin cubrir" + el botón primario que
          abre el formulario de siempre (fecha, horario, selector RF-08,
          bloqueo RF-10). Nunca convive con líneas de despacho -- ver
          LIMITACIONES en el encabezado del archivo. */}
      {sinCubrir && (
        <>
          <div style={styles.lineaSinCubrir}>
            <Pastilla chico colores={{ bg: paleta.chipSinCubrir.fondo, color: paleta.chipSinCubrir.texto }}>
              Sin cubrir
            </Pastilla>
            <span style={styles.sinCubrirVolumen}>{entrega.volumen} tn</span>
            <span style={styles.sinCubrirTransportista}>Sin asignar</span>
          </div>

          {!formAbierto && (
            <Boton onClick={() => setFormAbierto(true)} style={{ marginTop: espacio.sm }}>
              Asignar transporte
            </Boton>
          )}

          {formAbierto && (
            <div style={styles.altaDespachoWrap}>
              <div style={styles.altaDespachoGrid}>
                <div style={styles.altaDespachoColumna}>
                  <Campo
                    label="Fecha de carga *" type="date" min={hoyISO()} max={entrega.fecha_solicitada}
                    value={form.fecha}
                    onChange={e => setForm({ ...form, fecha: e.target.value })}
                    ayuda={calendarioCarga.bloquea ? undefined : `Entre hoy y el ${entrega.fecha_solicitada}.`}
                    error={calendarioCarga.bloquea ? calendarioCarga.motivo : undefined}
                  />
                  <Campo
                    label="Horario" type="time"
                    value={form.horario}
                    onChange={e => setForm({ ...form, horario: e.target.value })}
                  />
                  <div style={styles.accionesFila}>
                    <Boton disabled={ocupado || !form.fecha || calendarioCarga.bloquea} onClick={crear}>
                      {ocupado ? 'Guardando...' : 'Crear despacho'}
                    </Boton>
                    <Boton variante="secundario" onClick={() => setFormAbierto(false)}>Cancelar</Boton>
                  </div>
                </div>
                <div style={styles.altaDespachoColumna}>
                  <SelectorTransportista
                    transportistas={transportistas}
                    producto={producto}
                    valor={form.transportistaId}
                    onElegir={(id) => setForm({ ...form, transportistaId: id })}
                    permitirVacio
                    notaVacio="Opcional. Sin transportista, el despacho queda esperando."
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Despachos rechazados/cancelados: plegados, atenuados, con motivo. */}
      {despachosMuertos.length > 0 && (
        <div style={styles.anterioresWrap}>
          <button type="button" style={styles.verAnterioresBtn} onClick={() => setVerAnteriores(v => !v)}>
            {verAnteriores ? 'Ocultar' : `Ver ${despachosMuertos.length} anterior${despachosMuertos.length > 1 ? 'es' : ''}`}
          </button>
          {verAnteriores && despachosMuertos.map(d => (
            <div key={d.id} style={styles.despachoAnterior}>
              <span style={styles.despachoAnteriorNro}>{d.numero}</span>
              <Pastilla chico colores={{ bg: paleta.estadoDespacho.sinCubrir.fondo, color: paleta.estadoDespacho.sinCubrir.texto }}>
                {ETIQUETA_DESPACHO[d.estado] || d.estado}
              </Pastilla>
              <span style={styles.despachoAnteriorMotivo}>
                {d.rechazo_motivo || d.cancelacion_motivo || 'Sin motivo registrado.'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Una línea de despacho vivo -- estado, fecha de carga, transportista, y sus
 * propios botones.
 * -------------------------------------------------------------------------- */

function LineaDespacho({
  despacho: d, producto, tipoPedido, calendarioDias, calendarioReglas, orgsPorId, transportistas, viaje,
  asignando, setAsignando, editando, setEditando,
  ocupado, onAsignar, onEditar, onCancelar, onCerrarManual, setError,
}) {
  const styles = useEstilos();
  const { oscuro } = useTema();
  const paleta = paletaProgramacion(oscuro);

  const calendarioEditar = editando && editando.despachoId === d.id
    ? evaluarFechaCarga(editando.fecha, tipoPedido, calendarioDias, calendarioReglas)
    : { bloquea: false, motivo: null };

  const estiloEstado = estiloEstadoDespacho(d.estado);
  const colEstado = paleta.estadoDespacho[estiloEstado];
  const org = d.transportista_org_id ? orgsPorId.get(d.transportista_org_id) : null;
  const confirmado = estiloEstado === 'confirmada';

  const puedeCerrarManual = d.estado === DESPACHO.NOMINADO && viajeAbierto(viaje);
  const vencido = viajeVencido(viaje, d, hoyISO());

  const asignandoEste = asignando && asignando.despachoId === d.id;
  const editandoEste = editando && editando.despachoId === d.id;

  return (
    <div style={styles.despachoLinea}>
      <div style={styles.despachoFila}>
        <span style={styles.despachoId}>{d.numero}</span>
        <Pastilla chico colores={{ bg: colEstado.fondo, color: colEstado.texto }}>
          {ETIQUETA_DESPACHO[d.estado] || d.estado}
        </Pastilla>
        {vencido && (
          <Pastilla chico colores={{ bg: colorEstado.peligroFondo, color: colorEstado.peligroTexto }}>
            Vencido
          </Pastilla>
        )}
        <span style={{ ...styles.despachoCarga, ...(confirmado ? styles.despachoCargaConfirmada : {}) }}>
          carga {formatearFechaLarga(d.fecha_carga)}
        </span>
        <span style={styles.despachoTransportista}>
          {org ? org.razon_social : 'Sin asignar'}
        </span>
      </div>

      {despachoVivo(d) && !asignandoEste && !editandoEste && (
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
              style={styles.btnEditar}
              onClick={() => { setError(''); setEditando({ despachoId: d.id, fecha: d.fecha_carga, horario: d.horario_carga || '' }); }}
            >
              Editar
            </Boton>
          )}
          {puedeCancelar(d, viaje) && (
            <Boton chico variante="peligro" onClick={() => onCancelar(d)}>Cancelar</Boton>
          )}
          {puedeCerrarManual && (
            <Boton chico variante="secundario" style={styles.btnCerrarManual} onClick={() => onCerrarManual(d, viaje)}>
              Cerrar viaje a mano
            </Boton>
          )}
        </div>
      )}

      {d.chofer_dni && (
        <div style={styles.despachoDetalle}>
          Chofer {d.chofer_dni}
          {d.patente_tractor && <> · {d.patente_tractor}</>}
          {d.patente_semi && <> + {d.patente_semi}</>}
          {viaje && <> · viaje {viaje.estado}</>}
        </div>
      )}

      {asignandoEste && (
        <div style={styles.formInline}>
          <SelectorTransportista
            transportistas={transportistas}
            producto={producto}
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

      {editandoEste && (
        <div style={styles.formInline}>
          <div style={styles.altaDespachoGrid}>
            <Campo
              label="Fecha de carga *" type="date" min={hoyISO()}
              value={editando.fecha}
              onChange={e => setEditando({ ...editando, fecha: e.target.value })}
              error={calendarioEditar.bloquea ? calendarioEditar.motivo : undefined}
            />
            <Campo
              label="Horario" type="time"
              value={editando.horario}
              onChange={e => setEditando({ ...editando, horario: e.target.value })}
            />
          </div>
          <div style={styles.accionesFila}>
            <Boton disabled={ocupado || calendarioEditar.bloquea} onClick={() => onEditar(d)}>
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
 * Estilos -- crearEstilos(colores, oscuro) + useEstilos(), mismo patrón que
 * el resto del portal.
 * -------------------------------------------------------------------------- */

function crearEstilos(colores, oscuro) {
  const paleta = paletaProgramacion(oscuro);

  return {
    tituloModalWrap: { display: 'flex', flexDirection: 'column', gap: 2 },
    // v1.2.0 (rediseño Programación) -- el diseño pide 800 para el título
    // del modal.
    tituloModal: { fontSize: tipografia.tamano.titulo, fontWeight: tipografia.peso.extra, color: colores.texto },
    tituloModalNumero: { fontSize: tipografia.tamano.sm, color: colores.textoTenue, fontWeight: tipografia.peso.normal },

    modalDosColumnas: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: espacio.xl },
    modalColumna: { display: 'flex', flexDirection: 'column' },
    estadoModalFila: { display: 'flex', alignItems: 'center', gap: espacio.sm, marginBottom: espacio.md },
    volumenModal: { fontSize: tipografia.tamano.xl, fontWeight: tipografia.peso.fuerte, color: colores.texto },

    modalGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: espacio.md, marginBottom: espacio.md },
    field: { display: 'flex', flexDirection: 'column', gap: 3 },
    // Paso 3: "etiqueta en mayúsculas chicas".
    label: {
      fontSize: 10, color: colores.textoTenue, fontWeight: tipografia.peso.negrita,
      textTransform: 'uppercase', letterSpacing: '0.06em',
    },
    valorCompleto: { fontSize: tipografia.tamano.md, color: colores.texto, fontWeight: tipografia.peso.medio },
    valorVacio: { fontSize: tipografia.tamano.md, color: colores.textoTenue, fontStyle: 'italic' },

    // Paso 3 / tabla del diseño: nota del pedido, caja roja, radio 10.
    notaPedido: {
      fontSize: tipografia.tamano.sm, color: paleta.notaPedido.texto, background: paleta.notaPedido.fondo,
      border: `1px solid ${paleta.notaPedido.borde}`, borderRadius: radioProgramacion.nota,
      padding: '10px 12px', marginBottom: espacio.md, lineHeight: 1.5,
    },
    accionesColumna: { display: 'flex', flexDirection: 'column', gap: espacio.sm, marginTop: espacio.sm },

    entregasTitulo: {
      fontSize: 11, color: colores.textoTenue, textTransform: 'uppercase', letterSpacing: '0.06em',
      fontWeight: tipografia.peso.negrita, marginBottom: espacio.sm,
    },
    // Paso 3: "borde izquierdo rojo de 5 px" -- fijo, no depende del estado
    // de la entrega (a diferencia del diseño anterior a este rediseño).
    entregaCard: {
      border: `1px solid ${colores.borde}`, borderLeft: `5px solid ${marca}`, borderRadius: radio.lg,
      padding: '14px 16px', marginBottom: espacio.md, background: colores.superficie,
    },
    // Entregas cumplidas/suspendidas: atenuadas, al final -- ver el Paso 3.
    entregaAtenuada: { opacity: 0.55 },

    entregaHeader: { display: 'flex', alignItems: 'center', gap: espacio.sm, marginBottom: espacio.xs },
    entregaNro: { fontSize: tipografia.tamano.md, fontWeight: tipografia.peso.negrita, color: colores.texto },
    // Paso 3 / Pesos: 800 para la fecha larga de la entrega.
    entregaFecha: { fontSize: tipografia.tamano.xl, fontWeight: tipografia.peso.extra, color: colores.texto, marginBottom: 2 },
    avisoCalendario: {
      fontSize: tipografia.tamano.xs, color: colorEstado.advertenciaTextoFuerte, background: colorEstado.advertenciaFondo,
      border: `1px solid ${colorEstado.advertenciaBorde}`, borderRadius: radio.sm, padding: '4px 8px',
      marginBottom: espacio.sm, display: 'inline-block',
    },
    entregaVolFila: { display: 'flex', alignItems: 'center', gap: espacio.sm, flexWrap: 'wrap', marginBottom: espacio.sm },
    entregaVol: { fontSize: tipografia.tamano.md, fontWeight: tipografia.peso.negrita, color: colores.texto },
    entregaDestino: { fontSize: tipografia.tamano.sm, color: colores.textoSecundario },

    divisor: { height: 1, background: colores.borde, margin: `${espacio.sm}px 0` },

    despachoLinea: { padding: '8px 0', borderTop: `1px solid ${colores.borde}` },
    despachoFila: { display: 'flex', alignItems: 'center', gap: espacio.sm, flexWrap: 'wrap' },
    despachoId: { fontSize: tipografia.tamano.sm, fontWeight: tipografia.peso.negrita, color: colores.texto },
    despachoCarga: { fontSize: tipografia.tamano.sm, color: colores.texto },
    // Fecha de carga confirmada: verde, bold -- tabla del diseño.
    despachoCargaConfirmada: { color: paleta.fechaCargaConfirmada, fontWeight: tipografia.peso.negrita },
    // Transportista: rojo marca, extra bold -- tabla del diseño.
    despachoTransportista: { fontSize: tipografia.tamano.sm, color: paleta.transportista, fontWeight: tipografia.peso.extra, marginLeft: 'auto' },
    despachoAcciones: { display: 'flex', gap: 6, marginTop: espacio.xs, flexWrap: 'wrap' },
    despachoDetalle: { fontSize: tipografia.tamano.xs, color: colores.textoSecundario, marginTop: 4 },

    // Botón "Editar" con contorno azul, "Cerrar viaje a mano" secundario
    // (tabla del diseño: "Editar, que reprograma (contorno azul)").
    btnEditar: { borderColor: colorEstado.acentoAzulFuerte, color: colorEstado.acentoAzulFuerte },
    btnCerrarManual: {},

    lineaSinCubrir: { display: 'flex', alignItems: 'center', gap: espacio.sm, padding: '8px 0', borderTop: `1px solid ${colores.borde}` },
    sinCubrirVolumen: { fontSize: tipografia.tamano.sm, color: colores.texto, fontWeight: tipografia.peso.medio },
    sinCubrirTransportista: { fontSize: tipografia.tamano.sm, color: colores.textoTenue, marginLeft: 'auto' },

    formInline: { marginTop: espacio.sm, padding: espacio.md, background: colores.fondoAlterno, borderRadius: radio.lg, display: 'flex', flexDirection: 'column', gap: espacio.sm },
    altaDespachoWrap: { marginTop: espacio.sm, padding: espacio.md, background: colores.fondoAlterno, borderRadius: radio.lg },
    altaDespachoGrid: { display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(220px, 280px)', gap: espacio.lg, alignItems: 'start' },
    altaDespachoColumna: { display: 'flex', flexDirection: 'column', gap: espacio.xs },
    accionesFila: { display: 'flex', gap: espacio.sm },

    anterioresWrap: { marginTop: espacio.sm },
    verAnterioresBtn: {
      border: 'none', background: 'none', padding: 0, cursor: 'pointer',
      fontSize: tipografia.tamano.xs, color: colores.textoSuave, textDecoration: 'underline',
    },
    despachoAnterior: {
      display: 'flex', alignItems: 'center', gap: espacio.sm, flexWrap: 'wrap',
      opacity: 0.65, padding: '6px 0', borderTop: `1px solid ${colores.borde}`,
    },
    despachoAnteriorNro: { fontSize: tipografia.tamano.xs, color: colores.textoSecundario, fontWeight: tipografia.peso.medio },
    despachoAnteriorMotivo: { fontSize: tipografia.tamano.xs, color: colores.textoSecundario, fontStyle: 'italic' },
  };
}

function useEstilos() {
  const { colores, oscuro } = useTema();
  return useMemo(() => crearEstilos(colores, oscuro), [colores, oscuro]);
}
