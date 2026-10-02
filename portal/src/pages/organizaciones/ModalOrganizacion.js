/**
 * =============================================================================
 * organizaciones/ModalOrganizacion.js — v1.2.0 (rediseño Organizaciones)
 * =============================================================================
 *
 * SÍNTOMA
 *   El Paso 2 del rediseño pide que el alta/edición de una organización sea
 *   un modal (hasta 920px, dos columnas), con un panel "RESUMEN" a la
 *   derecha y enlaces que reemplazan el contenido del modal por el de
 *   Domicilios/Usuarios/Productos -- en vez de la "vista de formulario" a
 *   pantalla completa que tenía `Organizaciones.js`.
 *
 * CAUSA RAÍZ
 *   Esa vista vivía integrada al archivo monolítico, sin forma de abrirse
 *   como modal ni de ofrecer el panel de resumen.
 *
 * ALCANCE
 *   MISMA lógica de datos que tenía `Organizaciones.js` -- `validarFormulario`,
 *   `buscarDuplicado` (razón social y CUIT/identificación), `guardar()`
 *   (alta/edición), `darDeBaja()` (con `buscarDependenciasVivas`),
 *   `volverAActivar()` -- relocalizadas acá tal cual, sin tocar ninguna
 *   regla de RF-07 (banderas por rol) ni RF-03 (alta de transportista).
 *
 *   El checklist de productos (RF-08) SALE del formulario -- ahora vive en
 *   `ModalProductos.js` (Paso 5); acá solo queda el resto de los campos.
 *
 *   Columna derecha "RESUMEN" (solo al editar, no en el alta: todavía no
 *   hay domicilios/usuarios que resumir): domicilios cortos, usuarios
 *   (cantidad y nombres), productos si transportista, auditoría si el
 *   documento trae `creado_por`/`actualizado_en` (no se inventan campos que
 *   no existen hoy). Cada bloque tiene un enlace que llama a
 *   `onCambiarModal({tipo, org})` -- el orquestador reemplaza el modal
 *   abierto, nunca abre uno nuevo encima. Si hay cambios sin guardar, se
 *   confirma antes (mismo patrón `window.confirm` que ya usa el archivo
 *   para desvincular un domicilio).
 *
 *   RF-03: al guardar el ALTA de una organización `es_transportista`, el
 *   modal no se cierra -- pasa a un sub-paso interno "Crear usuario
 *   transportista" (mismo formulario/clave-una-vez que ya tenía
 *   `UsuariosDeOrganizacion`), con "Omitir". Ese paso sigue fijo en
 *   `roles:['transportista']` -- la opción de elegir Chofer es exclusiva
 *   del modal de Usuarios (`ModalUsuarios.js`), no de este atajo posterior
 *   al alta.
 *
 *   Solo lectura: si `!puedeEditarOrg(org)` para una organización existente,
 *   los campos quedan `disabled`, sin botón "Guardar", con la leyenda
 *   "Solo lectura".
 *
 * LIMITACIONES CONOCIDAS
 *   Mismas que ya tenía RF-03/RF-07/RF-08 -- ninguna nueva.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Alta de un transporte: el modal
 *   pasa a "Crear usuario transportista"; "Omitir" cierra el modal. Un
 *   comercial que abre un transporte lo ve en solo lectura. Cerrar con
 *   cambios sin guardar pide confirmación.
 * ========================================================================== */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { collection, onSnapshot, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from '../../firebase';
import { crear, actualizar, desactivar, reactivar } from '../../datos';
import { claveNormalizada, normalizarCuit } from '../../mapa-normalizacion';
import { darDeAltaUsuario, validarAltaUsuario, traducirErrorAuth } from '../../alta-usuarios';
import { textoDomicilio } from '../../buscar-domicilios';
import Modal from '../../ui/Modal';
import Boton from '../../ui/Boton';
import Campo from '../../ui/Campo';
import { useEstilos } from './estilos';

function validarFormulario(form) {
  const errores = [];
  if (!form.razon_social.trim()) errores.push('La razón social es obligatoria.');
  if (!form.es_cliente && !form.es_transportista) errores.push('Marcá al menos una: cliente o transporte.');
  if (!form.es_exterior && form.cuit.trim() && !normalizarCuit(form.cuit)) {
    errores.push('El CUIT tiene que tener 11 dígitos.');
  }
  if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    errores.push('El correo no parece válido.');
  }
  return errores;
}

export default function ModalOrganizacion({
  org, usuario,
  puedeElegirBanderas, puedeElegirTipo, puedeEditarOrg,
  formVacioPorRol,
  onCerrar, onCambiarModal,
}) {
  const styles = useEstilos();
  const editando = org || null;
  const soloLectura = !!editando && !puedeEditarOrg(editando);

  const [form, setForm] = useState(() => editando ? {
    razon_social: editando.razon_social || '',
    nombre_corto: editando.nombre_corto || '',
    cuit: editando.cuit || '',
    es_exterior: !!editando.es_exterior,
    email: editando.email || '',
    telefono: editando.telefono || '',
    es_cliente: !!editando.es_cliente,
    es_transportista: !!editando.es_transportista,
    obs: editando.obs || '',
  } : formVacioPorRol());
  const formInicial = useRef(JSON.stringify(form));
  const hayCambiosSinGuardar = JSON.stringify(form) !== formInicial.current;

  const [errores, setErrores] = useState([]);
  const [guardando, setGuardando] = useState(false);

  // RF-03: organización recién creada, esperando el alta de su usuario
  // transportista (o "Omitir"). `null` mientras no se llegó a ese paso.
  const [orgRecienCreada, setOrgRecienCreada] = useState(null);

  function pedirConfirmacionSiHaceFalta(accion) {
    if (!hayCambiosSinGuardar || window.confirm('Hay cambios sin guardar. ¿Descartarlos?')) accion();
  }

  async function buscarDuplicado(campo, valor, idPropio) {
    const q = query(collection(db, 'organizaciones'), where(campo, '==', valor), limit(2));
    const snap = await getDocs(q);
    return snap.docs.find(d => d.id !== idPropio) || null;
  }

  async function guardar() {
    const problemas = validarFormulario(form);
    if (problemas.length > 0) { setErrores(problemas); return; }

    setGuardando(true);
    setErrores([]);
    try {
      const razon = form.razon_social.trim();
      const clave = claveNormalizada(razon);

      const duplicado = await buscarDuplicado('clave_normalizada', clave, editando ? editando.id : null);
      if (duplicado) {
        setErrores([`Ya existe una organización con ese nombre: "${duplicado.data().razon_social}".`]);
        setGuardando(false);
        return;
      }

      const cuit = form.es_exterior
        ? (form.cuit.trim() || null)
        : (form.cuit.trim() ? normalizarCuit(form.cuit) : null);
      const cuitNormalizado = cuit ? claveNormalizada(cuit) : null;

      if (cuitNormalizado) {
        const duplicadoCuit = await buscarDuplicado('cuit_normalizado', cuitNormalizado, editando ? editando.id : null);
        if (duplicadoCuit) {
          setErrores([`Ya existe una organización con esa identificación fiscal: "${duplicadoCuit.data().razon_social}".`]);
          setGuardando(false);
          return;
        }
      }

      const datos = {
        razon_social: razon,
        nombre_corto: form.nombre_corto.trim() || razon,
        cuit,
        cuit_normalizado: cuitNormalizado,
        es_exterior: form.es_exterior,
        email: form.email.trim() || null,
        telefono: form.telefono.trim() || null,
        obs: form.obs.trim(),
        clave_normalizada: clave,
        es_cliente: form.es_cliente,
        es_transportista: form.es_transportista,
      };

      if (editando) {
        await actualizar({
          coleccion: 'organizaciones',
          id: editando.id,
          cambios: datos,
          accion: 'editar_organizacion',
          entidadTipo: 'organizacion',
          usuario,
        });
        onCerrar();
      } else {
        const nuevoId = await crear({
          coleccion: 'organizaciones',
          datos: { ...datos, estado: 'activo', es_propia: false, productos_ids: [] },
          accion: 'crear_organizacion',
          entidadTipo: 'organizacion',
          usuario,
        });

        // RF-03.
        if (datos.es_transportista) {
          setOrgRecienCreada({ id: nuevoId, razon_social: datos.razon_social });
        } else {
          onCerrar();
        }
      }
    } catch (err) {
      console.error(err);
      setErrores([traducirError(err)]);
    } finally {
      setGuardando(false);
    }
  }

  async function darDeBaja() {
    const motivo = window.prompt(`¿Por qué se da de baja a ${editando.razon_social}?`);
    if (motivo === null) return;
    if (!motivo.trim()) { window.alert('El motivo es obligatorio.'); return; }

    setGuardando(true);
    try {
      const bloqueo = await buscarDependenciasVivas(editando);
      if (bloqueo) { window.alert(bloqueo); return; }
      await desactivar({
        coleccion: 'organizaciones', id: editando.id,
        accion: 'desactivar_organizacion', usuario, razon: motivo.trim(),
      });
      onCerrar();
    } catch (err) {
      console.error(err);
      window.alert(traducirError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function volverAActivar() {
    setGuardando(true);
    try {
      await reactivar({ coleccion: 'organizaciones', id: editando.id, usuario });
      onCerrar();
    } catch (err) {
      console.error(err);
      window.alert(traducirError(err));
    } finally {
      setGuardando(false);
    }
  }

  if (orgRecienCreada) {
    return (
      <PasoUsuarioTransportista
        org={orgRecienCreada}
        usuario={usuario}
        onTerminar={onCerrar}
      />
    );
  }

  const titulo = editando ? editando.razon_social : 'Nueva organización';

  return (
    <Modal
      titulo={titulo}
      onCerrar={() => pedirConfirmacionSiHaceFalta(onCerrar)}
      ancho={editando ? 920 : 560}
    >
      {soloLectura && <div style={styles.soloLectura}>Solo lectura — tu rol no puede editar esta organización.</div>}

      {editando && editando.es_propia && (
        <div style={styles.editandoBanner}>
          Esta es la organización propia de Explora. Su razón social y sus
          domicilios se usan como origen o destino de todos los pedidos.
        </div>
      )}

      {errores.length > 0 && (
        <div style={styles.bannerError}>
          {errores.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}

      <div style={editando ? styles.modalDosColumnas : undefined}>
        <div style={styles.modalColumna}>
          <div style={styles.grid2}>
            <Campo
              label="Razón social *" disabled={soloLectura}
              value={form.razon_social}
              onChange={e => setForm({ ...form, razon_social: e.target.value })}
              placeholder="PAN AMERICAN ENERGY"
            />
            <Campo
              label="Nombre corto" disabled={soloLectura}
              value={form.nombre_corto}
              onChange={e => setForm({ ...form, nombre_corto: e.target.value })}
              placeholder="PAE"
              ayuda="Para mostrar en listados. Si se deja vacío, se usa la razón social."
            />
            <Campo
              label={form.es_exterior ? 'Identificación fiscal' : 'CUIT'} disabled={soloLectura}
              value={form.cuit}
              onChange={e => setForm({ ...form, cuit: e.target.value })}
              placeholder={form.es_exterior ? 'VAT, RUT, EIN...' : '30-60561644-1'}
              ayuda={form.es_exterior ? 'Cliente del exterior: sin formato fijo.' : 'Con o sin guiones. Se guarda normalizado.'}
            />
            <Campo
              label="Correo" type="email" disabled={soloLectura}
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              placeholder="contacto@empresa.com"
            />
            <Campo
              label="Teléfono" disabled={soloLectura}
              value={form.telefono}
              onChange={e => setForm({ ...form, telefono: e.target.value })}
              placeholder="(0341) 456-7890"
            />
          </div>

          <label style={{ ...styles.check, marginBottom: 16 }}>
            <input
              type="checkbox" disabled={soloLectura}
              checked={form.es_exterior}
              onChange={e => setForm({ ...form, es_exterior: e.target.checked })}
            />
            <span>Cliente del exterior — sin CUIT argentino</span>
          </label>

          {puedeElegirBanderas && (
            <div style={styles.seccion}>
              <div style={styles.seccionTitulo}>Qué es</div>
              <label style={styles.check}>
                <input type="checkbox" disabled={soloLectura} checked={form.es_cliente}
                  onChange={e => setForm({ ...form, es_cliente: e.target.checked })} />
                <span>Cliente — se le cargan pedidos</span>
              </label>
              <label style={styles.check}>
                <input type="checkbox" disabled={soloLectura} checked={form.es_transportista}
                  onChange={e => setForm({ ...form, es_transportista: e.target.checked })} />
                <span>Transporte — se le asignan despachos</span>
              </label>
              <div style={styles.ayuda}>
                Puede ser las dos cosas: un cliente que pone su propio camión
                para llevarse el producto.
              </div>
            </div>
          )}

          {puedeElegirTipo && (
            <div style={styles.seccion}>
              <div style={styles.seccionTitulo}>Qué es</div>
              <label style={styles.check}>
                <input type="radio" name="tipo_organizacion" disabled={soloLectura}
                  checked={form.es_cliente}
                  onChange={() => setForm({ ...form, es_cliente: true, es_transportista: false })} />
                <span>Cliente — se le cargan pedidos</span>
              </label>
              <label style={styles.check}>
                <input type="radio" name="tipo_organizacion" disabled={soloLectura}
                  checked={form.es_transportista}
                  onChange={() => setForm({ ...form, es_cliente: false, es_transportista: true })} />
                <span>Transporte — se le asignan despachos</span>
              </label>
              <div style={styles.ayuda}>
                Solo un admin puede cargar una organización que sea las dos
                cosas a la vez.
              </div>
            </div>
          )}

          <Campo
            as="textarea" label="Observaciones" disabled={soloLectura}
            style={{ minHeight: 60, resize: 'vertical' }}
            value={form.obs}
            onChange={e => setForm({ ...form, obs: e.target.value })}
          />

          <div style={{ ...styles.cardActions, marginTop: 16, flexWrap: 'wrap' }}>
            {!soloLectura && (
              <Boton disabled={guardando} onClick={guardar}>
                {guardando ? 'Guardando...' : (editando ? 'Guardar' : 'Crear organización')}
              </Boton>
            )}
            <Boton variante="secundario" onClick={() => pedirConfirmacionSiHaceFalta(onCerrar)}>Cancelar</Boton>

            {editando && puedeEditarOrg(editando) && !editando.es_propia && (
              editando.estado === 'activo' ? (
                <Boton variante="peligro" disabled={guardando} onClick={darDeBaja} style={{ marginLeft: 'auto' }}>
                  Dar de baja
                </Boton>
              ) : (
                <Boton variante="secundario" disabled={guardando} onClick={volverAActivar} style={{ marginLeft: 'auto' }}>
                  Reactivar
                </Boton>
              )
            )}
          </div>
        </div>

        {editando && (
          <PanelResumen
            styles={styles}
            org={editando}
            onCambiarModal={(tipo) => pedirConfirmacionSiHaceFalta(() => onCambiarModal({ tipo, org: editando }))}
          />
        )}
      </div>
    </Modal>
  );
}

/* -----------------------------------------------------------------------------
 * Panel "RESUMEN" -- columna derecha, solo al editar.
 * -------------------------------------------------------------------------- */

function PanelResumen({ styles, org, onCambiarModal }) {
  const [vinculos, setVinculos] = useState([]);
  const [domicilios, setDomicilios] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [productos, setProductos] = useState([]);

  useEffect(() => {
    const unsubVin = onSnapshot(
      query(collection(db, 'organizacion_domicilios'), where('organizacion_id', '==', org.id)),
      snap => setVinculos(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    const unsubDom = onSnapshot(collection(db, 'domicilios'), snap => setDomicilios(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const unsubUsu = onSnapshot(
      query(collection(db, 'usuarios'), where('organizacion_id', '==', org.id)),
      snap => setUsuarios(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    const unsubProd = org.es_transportista
      ? onSnapshot(collection(db, 'productos'), snap => setProductos(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      : () => {};
    return () => { unsubVin(); unsubDom(); unsubUsu(); unsubProd(); };
  }, [org.id, org.es_transportista]);

  const domiciliosOrg = useMemo(() => {
    const porId = new Map(domicilios.map(d => [d.id, d]));
    return vinculos.map(v => porId.get(v.domicilio_id)).filter(Boolean);
  }, [vinculos, domicilios]);

  const prodsPorId = useMemo(() => new Map(productos.map(p => [p.id, p])), [productos]);

  return (
    <div style={{ ...styles.modalColumna, ...styles.panelResumen }}>
      <div style={styles.panelResumenTitulo}>Resumen</div>

      <div style={styles.panelResumenBloque}>
        <div style={styles.panelResumenBloqueTitulo}>Domicilios ({domiciliosOrg.length})</div>
        {domiciliosOrg.length === 0 ? (
          <div style={styles.panelResumenValor}>Sin domicilios.</div>
        ) : (
          domiciliosOrg.slice(0, 4).map(d => (
            <div key={d.id} style={styles.panelResumenValor}>{textoDomicilio(d)}</div>
          ))
        )}
        <button type="button" style={styles.panelResumenEnlace} onClick={() => onCambiarModal('domicilios')}>
          Gestionar domicilios →
        </button>
      </div>

      <div style={styles.panelResumenBloque}>
        <div style={styles.panelResumenBloqueTitulo}>Usuarios ({usuarios.length})</div>
        {usuarios.length === 0 ? (
          <div style={styles.panelResumenValor}>Sin usuarios.</div>
        ) : (
          usuarios.slice(0, 4).map(u => (
            <div key={u.id} style={styles.panelResumenValor}>{u.nombre}</div>
          ))
        )}
        <button type="button" style={styles.panelResumenEnlace} onClick={() => onCambiarModal('usuarios')}>
          Gestionar usuarios →
        </button>
      </div>

      {org.es_transportista && (
        <div style={styles.panelResumenBloque}>
          <div style={styles.panelResumenBloqueTitulo}>Productos</div>
          {(org.productos_ids || []).length === 0 ? (
            <div style={styles.panelResumenValor}>Sin declarar.</div>
          ) : (
            <div style={styles.panelResumenValor}>
              {org.productos_ids.map(id => (prodsPorId.get(id) || {}).nombre).filter(Boolean).join(', ')}
            </div>
          )}
          <button type="button" style={styles.panelResumenEnlace} onClick={() => onCambiarModal('productos')}>
            Gestionar productos →
          </button>
        </div>
      )}

      {(org.creado_por || org.actualizado_en) && (
        <div style={styles.panelResumenBloque}>
          <div style={styles.panelResumenBloqueTitulo}>Auditoría</div>
          {org.creado_por && <div style={styles.panelResumenValor}>Creada por {org.creado_por}</div>}
          {org.actualizado_en && <div style={styles.panelResumenValor}>Última modificación: {String(org.actualizado_en)}</div>}
        </div>
      )}
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * RF-03 -- paso "Crear usuario transportista", fijo a ese rol (ver el
 * encabezado del archivo).
 * -------------------------------------------------------------------------- */

function PasoUsuarioTransportista({ org, usuario, onTerminar }) {
  const styles = useEstilos();
  const [vista, setVista] = useState('form'); // form | clave
  const [form, setForm] = useState({ nombre: '', email: '', telefono: '' });
  const [errores, setErrores] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [claveGenerada, setClaveGenerada] = useState(null);

  async function guardar() {
    const datos = { nombre: form.nombre, email: form.email, roles: ['transportista'], organizacion_id: org.id };
    const problemas = validarAltaUsuario(datos, { usuarios: [], soloInternos: false });
    if (problemas.length > 0) { setErrores(problemas); return; }

    setGuardando(true);
    setErrores([]);
    try {
      const email = form.email.trim().toLowerCase();
      const { clave } = await darDeAltaUsuario({
        datos: {
          nombre: form.nombre.trim(),
          email,
          roles: ['transportista'],
          organizacion_id: org.id,
          telefonos: form.telefono.trim() ? [form.telefono.trim()] : [],
          emails_extra: [],
          datos_chofer: null,
        },
        usuario,
      });
      setClaveGenerada({ nombre: form.nombre.trim(), email, clave });
      setVista('clave');
    } catch (err) {
      console.error(err);
      setErrores([err.fase === 'auth' ? traducirErrorAuth(err) : traducirError(err)]);
    } finally {
      setGuardando(false);
    }
  }

  if (vista === 'clave' && claveGenerada) {
    return (
      <Modal titulo="Usuario creado" onCerrar={onTerminar}>
        <div style={styles.bannerAviso}>
          <strong>Anotá estos datos ahora.</strong> La contraseña no se guarda en
          ningún lado y no se puede volver a ver.
        </div>
        <div style={styles.claveField}>
          <span style={styles.label}>Usuario</span>
          <span style={styles.claveValor}>{claveGenerada.nombre}</span>
        </div>
        <div style={styles.claveField}>
          <span style={styles.label}>Correo de acceso</span>
          <span style={styles.claveValorMono}>{claveGenerada.email}</span>
        </div>
        <div style={styles.claveField}>
          <span style={styles.label}>Contraseña</span>
          <span style={styles.claveValorMono}>{claveGenerada.clave}</span>
        </div>
        <div style={{ ...styles.cardActions, marginTop: 16 }}>
          <Boton
            onClick={() => navigator.clipboard.writeText(
              `Usuario: ${claveGenerada.nombre}\nCorreo: ${claveGenerada.email}\nContraseña: ${claveGenerada.clave}`
            )}
          >
            Copiar
          </Boton>
          <Boton variante="secundario" onClick={onTerminar}>Listo</Boton>
        </div>
      </Modal>
    );
  }

  return (
    <Modal titulo={`Crear usuario transportista — ${org.razon_social}`} onCerrar={onTerminar}>
      {errores.length > 0 && (
        <div style={styles.bannerError}>
          {errores.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}
      <div style={styles.grid2}>
        <Campo
          label="Nombre *"
          value={form.nombre}
          onChange={e => setForm({ ...form, nombre: e.target.value })}
          placeholder="Nombre de la persona de contacto"
        />
        <Campo
          label="Correo *"
          value={form.email}
          onChange={e => setForm({ ...form, email: e.target.value })}
          placeholder="nombre@empresa.com"
        />
        <Campo
          label="Teléfono"
          value={form.telefono}
          onChange={e => setForm({ ...form, telefono: e.target.value })}
          placeholder="(3476) 562372"
        />
      </div>
      <div style={{ ...styles.cardActions, marginTop: 16 }}>
        <Boton disabled={guardando} onClick={guardar}>
          {guardando ? 'Guardando...' : 'Crear usuario'}
        </Boton>
        <Boton variante="secundario" onClick={onTerminar}>Omitir</Boton>
      </div>
    </Modal>
  );
}

/* -----------------------------------------------------------------------------
 * Auxiliares
 * -------------------------------------------------------------------------- */

async function buscarDependenciasVivas(org) {
  if (org.es_cliente) {
    const q = query(
      collection(db, 'pedidos'),
      where('cliente_org_id', '==', org.id),
      where('estado', 'in', ['pendiente', 'programado_parcial', 'programado']),
      limit(1)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      return `${org.razon_social} tiene pedidos sin cumplir. Cerralos o suspendelos antes de darla de baja.`;
    }
  }
  if (org.es_transportista) {
    const q = query(
      collection(db, 'despachos'),
      where('transportista_org_id', '==', org.id),
      where('estado', 'in', ['ASIGNADO', 'ACEPTADO', 'NOMINADO']),
      limit(1)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      return `${org.razon_social} tiene despachos en curso. Cancelalos antes de darla de baja.`;
    }
  }
  return null;
}

function traducirError(err) {
  if (err && err.code === 'permission-denied') {
    return 'Firestore rechazó la escritura. Puede ser que tu usuario no tenga '
         + 'permiso, o que falte su documento en el modelo nuevo. '
         + 'Revisá la consola del navegador para el detalle.';
  }
  return (err && err.message) || 'Error desconocido.';
}
