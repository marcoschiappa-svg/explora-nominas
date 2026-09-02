/**
 * =============================================================================
 * Productos.js — ABM de productos (Portal Explora)
 * =============================================================================
 *
 * PROPÓSITO
 * La lista de productos que se pueden cargar en un pedido.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ DEJA DE SER UNA CONSTANTE
 * -----------------------------------------------------------------------------
 * Hoy la lista está hardcodeada en `Pedidos.js`:
 *
 *     const PRODUCTOS_VALIDOS = ['Biodiesel','EMAG','Glicerina','Sebo',
 *                                'HFFA Vegetal','Aceite','Otro'];
 *
 * Agregar un producto requiere tocar el código y desplegar. Y mientras tanto,
 * lo que no está en la lista se carga como "Otro": Laruso compra aceite
 * reesterificado, un producto real, y en los 215 pedidos figura como "Otro" sin
 * que nadie sepa qué es.
 *
 * -----------------------------------------------------------------------------
 * "OTRO" SE QUEDA, Y ES ESPECIAL
 * -----------------------------------------------------------------------------
 * Es la válvula de escape: sirve para las pruebas de la app y para cuando
 * aparece algo que todavía no se dio de alta.
 *
 * Los pedidos con producto genérico NO se escriben en el Plan de Producción. El
 * Apps Script rutea comparando el nombre del producto contra una lista fija que
 * vive del lado del script, y "Otro" no está en esa lista. Por eso los pedidos
 * de prueba nunca ensuciaron el plan.
 *
 * Se marca con `es_generico` para que eso sea explícito en vez de un efecto
 * secundario de cómo está escrito el script.
 *
 * -----------------------------------------------------------------------------
 * EL NOMBRE NO SE EDITA SI HAY PEDIDOS VIVOS
 * -----------------------------------------------------------------------------
 * El despacho lleva `producto_nombre` denormalizado —el transportista y el
 * chofer no leen `pedidos`— y el Apps Script rutea por ese nombre. Cambiarlo
 * dejaría los despachos existentes apuntando a un producto que ya no se llama
 * así, y las filas del plan caerían en la columna equivocada.
 * ========================================================================== */

import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { crear, actualizar, desactivar, reactivar } from '../datos';
import { esAdmin, motivoSinAcceso } from '../sesion';
import { claveNormalizada } from '../mapa-normalizacion';

const FORM_VACIO = { nombre: '', codigo: '', obs: '' };

export default function Productos({ usuario, onVolver }) {
  const [productos, setProductos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [vista, setVista] = useState('lista');
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState(FORM_VACIO);
  const [errores, setErrores] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [verInactivos, setVerInactivos] = useState(false);
  const [conPedidosVivos, setConPedidosVivos] = useState(new Set());

  const sinAcceso = motivoSinAcceso(usuario, ['admin']);
  const puedeEditar = esAdmin(usuario);

  /* ── Carga ──────────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (sinAcceso) { setCargando(false); return; }

    const unsub = onSnapshot(collection(db, 'productos'), (snap) => {
      setProductos(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setCargando(false);
    }, (err) => { console.error('Productos:', err); setCargando(false); });

    return () => unsub();
  }, [sinAcceso]);

  const visibles = useMemo(
    () => productos
      .filter(p => verInactivos || p.activo !== false)
      .sort((a, b) => {
        // "Otro" al final: es la excepción, no una opción más.
        if (!!a.es_generico !== !!b.es_generico) return a.es_generico ? 1 : -1;
        return (a.nombre || '').localeCompare(b.nombre || '', 'es');
      }),
    [productos, verInactivos]
  );

  /* ── Acciones ───────────────────────────────────────────────────────────── */

  function abrirAlta() {
    setEditando(null);
    setForm(FORM_VACIO);
    setErrores([]);
    setVista('form');
  }

  async function abrirEdicion(p) {
    setEditando(p);
    setForm({ nombre: p.nombre || '', codigo: p.codigo || '', obs: p.obs || '' });
    setErrores([]);
    setVista('form');

    // Se consulta al abrir, no al guardar: el usuario tiene que ver el campo
    // deshabilitado con el motivo, en vez de escribir un nombre nuevo y que se
    // lo rechacen al final.
    const hay = await tienePedidosVivos(p.id);
    if (hay) setConPedidosVivos(prev => new Set(prev).add(p.id));
  }

  const nombreBloqueado = !!(editando && conPedidosVivos.has(editando.id));

  function validar() {
    const problemas = [];
    const nombre = form.nombre.trim();

    if (!nombre) {
      problemas.push('El nombre es obligatorio.');
    } else {
      const clave = claveNormalizada(nombre);
      const repetido = productos.find(p =>
        p.id !== (editando && editando.id) && claveNormalizada(p.nombre) === clave
      );
      if (repetido) problemas.push(`Ya existe un producto con ese nombre: "${repetido.nombre}".`);
    }

    return problemas;
  }

  async function guardar() {
    const problemas = validar();
    if (problemas.length > 0) { setErrores(problemas); return; }

    setGuardando(true);
    setErrores([]);

    try {
      const nombre = form.nombre.trim();
      const datos = {
        codigo: form.codigo.trim() || null,
        obs: form.obs.trim(),
      };

      if (editando) {
        // El nombre solo se manda si se puede cambiar. Si hay pedidos vivos, no
        // entra en los campos modificados.
        if (!nombreBloqueado) {
          datos.nombre = nombre;
          datos.clave_normalizada = claveNormalizada(nombre);
        }

        await actualizar({
          coleccion: 'productos',
          id: editando.id,
          cambios: datos,
          accion: 'editar_producto',
          entidadTipo: 'producto',
          usuario,
        });
      } else {
        await crear({
          coleccion: 'productos',
          datos: {
            ...datos,
            nombre,
            clave_normalizada: claveNormalizada(nombre),
            activo: true,
            // Solo "Otro" es genérico, y viene de la carga inicial. Desde acá no
            // se puede crear otro producto genérico: dos válvulas de escape
            // serían dos formas de no decir qué se está cargando.
            es_generico: false,
          },
          accion: 'crear_producto',
          entidadTipo: 'producto',
          usuario,
        });
      }

      setVista('lista');
    } catch (err) {
      console.error(err);
      setErrores([traducirError(err)]);
    } finally {
      setGuardando(false);
    }
  }

  /**
   * Desactiva un producto. No aparece más al cargar un pedido; los pedidos
   * viejos lo siguen mostrando.
   */
  async function darDeBaja(p) {
    if (p.es_generico) {
      window.alert('"Otro" no se puede desactivar: es la opción de escape para cuando aparece un producto que todavía no está dado de alta.');
      return;
    }

    if (!window.confirm(`¿Desactivar "${p.nombre}"?\n\nDeja de aparecer al cargar un pedido. Los pedidos que ya lo usan no cambian.`)) return;

    setGuardando(true);
    try {
      if (await tienePedidosVivos(p.id)) {
        window.alert(`Hay pedidos sin cumplir con "${p.nombre}". Cerralos o suspendelos antes de desactivarlo.`);
        return;
      }

      await desactivar({
        coleccion: 'productos',
        id: p.id,
        accion: 'desactivar_producto',
        usuario,
      });
    } catch (err) {
      console.error(err);
      window.alert(traducirError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function volverAActivar(p) {
    setGuardando(true);
    try {
      await reactivar({ coleccion: 'productos', id: p.id, usuario });
    } catch (err) {
      console.error(err);
      window.alert(traducirError(err));
    } finally {
      setGuardando(false);
    }
  }

  /* ── Render ─────────────────────────────────────────────────────────────── */

  if (sinAcceso) {
    return (
      <div style={styles.wrap}>
        <Topbar onVolver={onVolver} />
        <div style={styles.bannerError}>{sinAcceso}</div>
      </div>
    );
  }

  if (vista === 'form') {
    return (
      <div style={styles.wrap}>
        <Topbar onVolver={() => setVista('lista')} textoVolver="← Cancelar" />

        <div style={styles.panelHeader}>
          <div style={styles.titulo}>
            {editando ? `Editar ${editando.nombre}` : 'Nuevo producto'}
          </div>
        </div>

        {errores.length > 0 && (
          <div style={styles.bannerError}>
            {errores.map((e, i) => <div key={i}>{e}</div>)}
          </div>
        )}

        <div style={styles.form}>
          <div style={styles.grid2}>
            <div style={styles.formField}>
              <label style={styles.label}>Nombre *</label>
              <input
                style={{ ...styles.input, background: nombreBloqueado ? '#F3F4F6' : '#fff' }}
                value={form.nombre}
                disabled={nombreBloqueado}
                onChange={e => setForm({ ...form, nombre: e.target.value })}
                placeholder="Biodiesel"
                autoFocus
              />
              {nombreBloqueado && (
                <span style={styles.ayuda}>
                  Hay pedidos sin cumplir con este producto. El nombre viaja
                  copiado en cada despacho y el Plan de Producción rutea por él,
                  así que cambiarlo ahora dejaría esas filas en la columna
                  equivocada.
                </span>
              )}
            </div>

            <div style={styles.formField}>
              <label style={styles.label}>Código</label>
              <input
                style={styles.input}
                value={form.codigo}
                onChange={e => setForm({ ...form, codigo: e.target.value })}
              />
              <span style={styles.ayuda}>Opcional. Para uso interno.</span>
            </div>
          </div>

          <div style={styles.formField}>
            <label style={styles.label}>Observaciones</label>
            <input
              style={styles.input}
              value={form.obs}
              onChange={e => setForm({ ...form, obs: e.target.value })}
            />
          </div>

          <div style={styles.cardActions}>
            <button
              style={{ ...styles.btnPrimary, opacity: guardando ? 0.6 : 1 }}
              disabled={guardando}
              onClick={guardar}
            >
              {guardando ? 'Guardando...' : (editando ? 'Guardar cambios' : 'Crear producto')}
            </button>
            <button style={styles.btnSecundario} onClick={() => setVista('lista')}>
              Cancelar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
      <Topbar onVolver={onVolver} />

      <div style={styles.panelHeader}>
        <div style={styles.titulo}>Productos</div>
        {puedeEditar && (
          <button style={styles.btnPrimary} onClick={abrirAlta}>+ Nuevo</button>
        )}
      </div>

      <div style={styles.filtrosResumen}>
        <span>{visibles.length} producto(s)</span>
        <label style={styles.checkInline}>
          <input
            type="checkbox"
            checked={verInactivos}
            onChange={e => setVerInactivos(e.target.checked)}
          />
          <span>Ver inactivos</span>
        </label>
      </div>

      {cargando && <div style={styles.empty}>Cargando...</div>}
      {!cargando && visibles.length === 0 && (
        <div style={styles.empty}>No hay productos cargados.</div>
      )}

      {visibles.map(p => (
        <div key={p.id} style={styles.card}>
          <div style={styles.cardRow}>
            <span style={styles.rowNombre}>{p.nombre}</span>

            {p.es_generico && (
              <span style={{ ...styles.pill, ...PILLS.generico }}>
                No va al Plan de Producción
              </span>
            )}
            {p.activo === false && (
              <span style={{ ...styles.pill, ...PILLS.inactivo }}>Inactivo</span>
            )}

            <span style={styles.rowCodigo}>{p.codigo || ''}</span>

            {puedeEditar && (
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button style={styles.btnEditar} onClick={() => abrirEdicion(p)}>
                  Editar
                </button>
                {p.activo !== false ? (
                  !p.es_generico && (
                    <button
                      style={styles.btnSuspender}
                      disabled={guardando}
                      onClick={() => darDeBaja(p)}
                    >
                      Desactivar
                    </button>
                  )
                ) : (
                  <button
                    style={styles.btnSecundario}
                    disabled={guardando}
                    onClick={() => volverAActivar(p)}
                  >
                    Reactivar
                  </button>
                )}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Auxiliares
 * -------------------------------------------------------------------------- */

function Topbar({ onVolver, textoVolver = '← Volver' }) {
  return (
    <div style={styles.topbar}>
      <div style={styles.logoArea}>
        <img src="/logo.png" alt="Explora" style={styles.logoImg} />
      </div>
      <button style={styles.btnVolver} onClick={onVolver}>{textoVolver}</button>
    </div>
  );
}

async function tienePedidosVivos(productoId) {
  const q = query(
    collection(db, 'pedidos'),
    where('producto_id', '==', productoId),
    where('estado', 'in', ['pendiente', 'programado_parcial', 'programado']),
    limit(1)
  );
  const snap = await getDocs(q);
  return !snap.empty;
}

function traducirError(err) {
  if (err && err.code === 'permission-denied') {
    return 'Firestore rechazó la escritura. Los productos solo los edita un '
         + 'administrador. Revisá la consola del navegador para el detalle.';
  }
  if (err && err.code === 'failed-precondition') {
    return 'Falta un índice en Firestore. En la consola del navegador hay un '
         + 'link para crearlo con un clic.';
  }
  return (err && err.message) || 'Error desconocido.';
}

/* -----------------------------------------------------------------------------
 * Estilos
 * -------------------------------------------------------------------------- */

const PILLS = {
  generico: { background: '#FEF3C7', color: '#92400E' },
  inactivo: { background: '#F3F4F6', color: '#9CA3AF' },
};

const styles = {
  wrap: { maxWidth: 900, margin: '0 auto', padding: '1.5rem 1rem' },
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '1rem', borderBottom: '0.5px solid #E5E7EB', marginBottom: '1.5rem' },
  logoArea: { display: 'flex', alignItems: 'center' },
  logoImg: { height: 36, objectFit: 'contain' },
  btnVolver: { padding: '6px 14px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 13, cursor: 'pointer' },
  panelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' },
  titulo: { fontSize: 18, fontWeight: 500, color: '#111827' },
  btnPrimary: { padding: '8px 16px', borderRadius: 8, border: 'none', background: '#C8102E', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  btnSecundario: { padding: '6px 14px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#374151', fontSize: 12, cursor: 'pointer' },
  btnEditar: { padding: '6px 14px', borderRadius: 8, border: '0.5px solid #C8102E', background: '#fff', color: '#C8102E', fontSize: 12, cursor: 'pointer' },
  btnSuspender: { padding: '6px 14px', borderRadius: 8, border: '0.5px solid #A32D2D', background: '#fff', color: '#A32D2D', fontSize: 12, cursor: 'pointer' },
  filtrosResumen: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: '#6B7280', marginBottom: 10 },
  checkInline: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6B7280', cursor: 'pointer' },
  empty: { textAlign: 'center', padding: '2rem', color: '#9CA3AF', fontSize: 13 },
  card: { background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 12, overflow: 'hidden', marginBottom: 8 },
  cardRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#F9FAFB', flexWrap: 'wrap' },
  cardActions: { display: 'flex', gap: 8, marginTop: 12 },
  pill: { fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 20, flexShrink: 0 },
  rowNombre: { fontSize: 13, fontWeight: 500, color: '#111827', flex: 2, minWidth: 140 },
  rowCodigo: { fontSize: 11, color: '#9CA3AF', fontFamily: 'monospace', flexShrink: 0 },
  form: { background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 12, padding: '1.5rem' },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 },
  formField: { display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 },
  label: { fontSize: 11, color: '#9CA3AF' },
  input: { fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '0.5px solid #E5E7EB', color: '#111827', width: '100%', boxSizing: 'border-box' },
  ayuda: { fontSize: 11, color: '#9CA3AF', lineHeight: 1.4 },
  bannerError: { padding: '10px 14px', borderRadius: 8, background: '#FEF2F2', border: '0.5px solid #FCA5A5', fontSize: 13, color: '#B91C1C', marginBottom: 12, whiteSpace: 'pre-line' },
};
