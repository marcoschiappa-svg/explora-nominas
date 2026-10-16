/**
 * =============================================================================
 * organizaciones/ModalOrganizacion.js — v1.2.2 (rediseño del modal con pestañas)
 * =============================================================================
 *
 * SÍNTOMA
 *   El modal de organización era un formulario con un panel "RESUMEN" que
 *   cortaba la lista de usuarios en 4 nombres, mostraba el `Timestamp` de
 *   Firestore crudo en la auditoría y mandaba a un modal distinto por cada
 *   cosa (domicilios, correos, productos).
 *
 * CAUSA RAÍZ
 *   El formulario y el resumen vivían en un solo componente, y cada gestión
 *   (domicilios, correos, usuarios, productos) era un modal aparte.
 *
 * ALCANCE
 *   Orquestador del modal rediseñado: ARMAZÓN con pestañas
 *   (`ArmazonModalOrganizacion`) + `PestanaGeneral` (formulario y
 *   `PanelFichaCompleta`) + Domicilios y Correos (`GestionDomiciliosOrganizacion`
 *   y `GestionEmailsOrganizacion` embebidos) + `PestanaUsuarios` +
 *   `PestanaProductos`. La lógica de datos de siempre NO cambia:
 *   `validarFormulario`, `buscarDuplicado` (razón social y CUIT),
 *   `buscarDependenciasVivas`, `crear`/`actualizar`/`desactivar`/`reactivar`,
 *   el alta con correo opcional en una transacción, y el paso RF-03 de crear
 *   el usuario transportista (`PasoUsuarioTransportista`).
 *
 *   1. GUARDADO: "Cambios sin guardar" y "Guardar cambios" aplican SOLO a los
 *      campos de Datos generales. Correos, domicilios, productos y baja se
 *      escriben al instante y muestran un toast; no cuentan como pendientes.
 *   2. Tras guardar una edición el modal queda abierto (toast "Cambios
 *      guardados"); antes se cerraba.
 *   3. ALTA: las otras pestañas aparecen deshabilitadas ("Se habilitan después
 *      de crear la organización").
 *   4. BAJA: confirmación inline en el pie con motivo OBLIGATORIO (reemplaza
 *      al `window.prompt`) y el bloqueo de `buscarDependenciasVivas` se
 *      muestra ahí mismo. "Reactivar" aparece en el pie con la organización
 *      dada de baja.
 *   5. TIPO: Cliente / Transporte editables solo por admin
 *      (`puedeElegirBanderas`); en el alta, `puedeElegirTipo` elige UNA, y un
 *      rol único ve el tipo fijo deshabilitado. Las reglas prohíben cambiar
 *      las banderas a los demás (`banderasSinCambios`).
 *   6. Visibilidad: Usuarios = transporte y admin/coordinador; Productos =
 *      transporte (mismas reglas que los botones de la lista).
 *   7. Domicilios se edita con `soyAdmin || soyComercial`, como en
 *      `ModalDomicilios`: las reglas de `organizacion_domicilios` son de
 *      `esComercial()`, no dependen de `puedeEditarOrg`.
 *   8. Productos: escritura inmediata con `cambiarProductoDeclarado()`.
 *   9. `email` de la organización: solo existe el input en el ALTA (v1.2.2);
 *      `telefono` se mantiene tal cual.
 *
 * LIMITACIONES CONOCIDAS
 *   Los modales sueltos `ModalDomicilios`, `ModalEmails` y `ModalProductos`
 *   quedaron sin uso desde esta pantalla (no se borran). `ModalUsuarios` sigue
 *   en uso: es el destino de "Gestionar usuarios →".
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Editar un transporte: 5 pestañas con
 *   contadores; agregar un correo muestra el toast sin marcar cambios sin
 *   guardar; cambiar la razón social sí. Dar de baja exige motivo. Alta: solo
 *   "Datos generales" habilitada.
 * ========================================================================== */

import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from '../../firebase';
import { crear, actualizar, desactivar, reactivar } from '../../shared/datos';
import { claveNormalizada, normalizarCuit } from '../../mapa-normalizacion';
import { textoDomicilio } from '../../buscar-domicilios';
import Boton from '../../ui/Boton';
import { tipografia } from '../../shared/tokens';
import { validarEmail, crearOrganizacionConEmail } from './logica-organizacion-emails';
import { cambiarProductoDeclarado } from './logica-organizacion-productos';
import {
  iniciales, verificarCuit, formatearCuit, calcularFicha, formatearUltimaModificacion,
} from './logica-ficha-organizacion';
import ArmazonModalOrganizacion from './ArmazonModalOrganizacion';
import PestanaGeneral from './PestanaGeneral';
import PestanaUsuarios from './PestanaUsuarios';
import PestanaProductos from './PestanaProductos';
import PasoUsuarioTransportista from './PasoUsuarioTransportista';
import GestionDomiciliosOrganizacion from './GestionDomiciliosOrganizacion';
import GestionEmailsOrganizacion from './GestionEmailsOrganizacion';
import { EstadoVacio, Icono, useTonos } from './piezas-modal-organizacion';

function validarFormulario(form) {
  const errores = [];
  if (!form.razon_social.trim()) errores.push('La razón social es obligatoria.');
  if (!form.es_cliente && !form.es_transportista) errores.push('Marcá al menos una: cliente o transporte.');
  if (!form.es_exterior && form.cuit.trim() && !normalizarCuit(form.cuit)) {
    errores.push('El CUIT tiene que tener 11 dígitos.');
  }
  // Solo el alta tiene input de correo; en edición `form.email` va siempre vacío.
  if (form.email.trim()) errores.push(...validarEmail(form.email));
  return errores;
}

const AYUDA_PESTANA_ALTA = 'Se habilitan después de crear la organización';

export default function ModalOrganizacion({
  org, usuario, productos = [],
  soyAdmin, soyComercial, soyCoordinador,
  puedeElegirBanderas, puedeElegirTipo, puedeEditarOrg,
  formVacioPorRol,
  onCerrar, onCambiarModal,
}) {
  const { colores, pal, tonos } = useTonos();
  const editando = org || null;
  const esAlta = !editando;
  const soloLectura = !!editando && !puedeEditarOrg(editando);

  const [form, setForm] = useState(() => editando ? {
    razon_social: editando.razon_social || '',
    nombre_corto: editando.nombre_corto || '',
    cuit: editando.cuit || '',
    es_exterior: !!editando.es_exterior,
    email: '', // 9. ya no se copia `organizaciones.email`
    telefono: editando.telefono || '',
    es_cliente: !!editando.es_cliente,
    es_transportista: !!editando.es_transportista,
    obs: editando.obs || '',
  } : formVacioPorRol());
  const [baseline, setBaseline] = useState(() => JSON.stringify(form));
  const hayCambiosSinGuardar = JSON.stringify(form) !== baseline;

  const [pestana, setPestana] = useState('general');
  const [errores, setErrores] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [toast, setToast] = useState('');
  const [confirmandoBaja, setConfirmandoBaja] = useState(false);
  const [motivoBaja, setMotivoBaja] = useState('');
  const [errorBaja, setErrorBaja] = useState('');
  const [ocupadoProductos, setOcupadoProductos] = useState(false);

  // RF-03: organización recién creada, esperando el alta de su usuario
  // transportista (o "Omitir"). `null` mientras no se llegó a ese paso.
  const [orgRecienCreada, setOrgRecienCreada] = useState(null);

  // Datos vivos para los contadores y las vistas previas (solo al editar).
  const [emails, setEmails] = useState([]);
  const [vinculos, setVinculos] = useState([]);
  const [domicilios, setDomicilios] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [cargandoUsuarios, setCargandoUsuarios] = useState(true);

  const idOrg = editando ? editando.id : null;
  useEffect(() => {
    if (!idOrg) return undefined;
    const filtro = (col) => query(collection(db, col), where('organizacion_id', '==', idOrg));
    const lista = (snap) => snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const unsubEmails = onSnapshot(filtro('organizacion_emails'), s => setEmails(lista(s)), e => console.error('Modal (correos):', e));
    const unsubVin = onSnapshot(filtro('organizacion_domicilios'), s => setVinculos(lista(s)), e => console.error('Modal (vínculos):', e));
    const unsubDom = onSnapshot(collection(db, 'domicilios'), s => setDomicilios(lista(s)), e => console.error('Modal (domicilios):', e));
    const unsubUsu = onSnapshot(filtro('usuarios'), s => { setUsuarios(lista(s)); setCargandoUsuarios(false); }, e => { console.error('Modal (usuarios):', e); setCargandoUsuarios(false); });
    return () => { unsubEmails(); unsubVin(); unsubDom(); unsubUsu(); };
  }, [idOrg]);

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  function pedirConfirmacionSiHaceFalta(accion) {
    if (!hayCambiosSinGuardar || window.confirm('Hay cambios sin guardar. ¿Descartarlos?')) accion();
  }

  function cambiar(patch) { setForm(f => ({ ...f, ...patch })); }

  /* ── Guardado (solo Datos generales) ────────────────────────────────────── */

  async function buscarDuplicado(campo, valor, idPropio) {
    const q = query(collection(db, 'organizaciones'), where(campo, '==', valor), limit(2));
    const snap = await getDocs(q);
    return snap.docs.find(d => d.id !== idPropio) || null;
  }

  async function guardar() {
    const problemas = validarFormulario(form);
    if (problemas.length > 0) { setErrores(problemas); setPestana('general'); return; }

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
        // 9. `email` ya no se escribe: vive en `organizacion_emails`.
        telefono: form.telefono.trim() || null,
        obs: form.obs.trim(),
        clave_normalizada: clave,
        es_cliente: form.es_cliente,
        es_transportista: form.es_transportista,
      };

      if (editando) {
        await actualizar({
          db,
          coleccion: 'organizaciones',
          id: editando.id,
          cambios: datos,
          accion: 'editar_organizacion',
          entidadTipo: 'organizacion',
          usuario,
        });
        // 2. El modal queda abierto: lo guardado pasa a ser la nueva base.
        setBaseline(JSON.stringify(form));
        setToast('Cambios guardados');
      } else {
        const datosAlta = { ...datos, estado: 'activo', es_propia: false, productos_ids: [] };
        // Con correo: organización + correo principal en UNA transacción.
        const nuevoId = form.email.trim()
          ? await crearOrganizacionConEmail({ db, datosOrganizacion: datosAlta, email: form.email, usuario })
          : await crear({
            db,
            coleccion: 'organizaciones',
            datos: datosAlta,
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

  /* ── Baja y reactivación (al instante) ──────────────────────────────────── */

  async function darDeBaja() {
    if (!motivoBaja.trim()) return;
    setGuardando(true);
    setErrorBaja('');
    try {
      const bloqueo = await buscarDependenciasVivas(editando);
      if (bloqueo) { setErrorBaja(bloqueo); return; }
      await desactivar({
        db,
        coleccion: 'organizaciones', id: editando.id,
        accion: 'desactivar_organizacion', usuario, razon: motivoBaja.trim(),
      });
      setConfirmandoBaja(false);
      setMotivoBaja('');
      setToast('Organización dada de baja');
    } catch (err) {
      console.error(err);
      setErrorBaja(traducirError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function volverAActivar() {
    setGuardando(true);
    try {
      await reactivar({ db, coleccion: 'organizaciones', id: editando.id, usuario });
      setToast('Organización reactivada');
    } catch (err) {
      console.error(err);
      setErrores([traducirError(err)]);
      setPestana('general');
    } finally {
      setGuardando(false);
    }
  }

  /* ── Productos (al instante) ────────────────────────────────────────────── */

  async function cambiarProducto(productoId, agregar) {
    setOcupadoProductos(true);
    try {
      await cambiarProductoDeclarado({ db, organizacionId: editando.id, productoId, agregar, usuario });
      setToast(agregar ? 'Producto agregado' : 'Producto quitado');
    } catch (err) {
      console.error(err);
      setErrores([traducirError(err)]);
      setPestana('general');
    } finally {
      setOcupadoProductos(false);
    }
  }

  /* ── Derivados ──────────────────────────────────────────────────────────── */

  const tipoVigente = editando || form;
  const hayUsuarios = !!tipoVigente.es_transportista && !!(soyAdmin || soyCoordinador);
  const hayProductos = !!tipoVigente.es_transportista;
  const editaDomicilios = !!(soyAdmin || soyComercial);

  const cantidades = {
    domicilios: vinculos.length,
    correos: emails.length,
    usuarios: usuarios.length,
    productos: ((editando && editando.productos_ids) || []).length,
  };

  const pestanas = [
    { id: 'general', etiqueta: 'Datos generales' },
    { id: 'domicilios', etiqueta: 'Domicilios', cantidad: esAlta ? undefined : cantidades.domicilios },
    { id: 'correos', etiqueta: 'Correos', cantidad: esAlta ? undefined : cantidades.correos },
    ...(hayUsuarios ? [{ id: 'usuarios', etiqueta: 'Usuarios', cantidad: esAlta ? undefined : cantidades.usuarios }] : []),
    ...(hayProductos ? [{ id: 'productos', etiqueta: 'Productos', cantidad: esAlta ? undefined : cantidades.productos }] : []),
  ].map(p => (esAlta && p.id !== 'general' ? { ...p, deshabilitada: true, ayuda: AYUDA_PESTANA_ALTA } : p));

  const pestanaVigente = pestanas.some(p => p.id === pestana && !p.deshabilitada) ? pestana : 'general';

  const cuit = form.es_exterior ? { estado: 'vacio', digitos: '' } : verificarCuit(form.cuit);
  const ficha = useMemo(
    () => calcularFicha({ form, cantidades, aplican: { usuarios: hayUsuarios, productos: hayProductos } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form, cantidades.domicilios, cantidades.correos, cantidades.usuarios, cantidades.productos, hayUsuarios, hayProductos]
  );

  const vistas = useMemo(() => {
    const porId = new Map(domicilios.map(d => [d.id, d]));
    const primerDomicilio = vinculos
      .map(v => ({ v, d: porId.get(v.domicilio_id) }))
      .filter(x => x.d)
      .sort((a, b) => (a.v.principal === b.v.principal ? 0 : (a.v.principal ? -1 : 1)))[0];
    const principal = emails.find(e => e.principal) || emails[0];
    const prodsPorId = new Map(productos.map(p => [p.id, p]));
    const nombresUsuarios = usuarios.map(u => u.nombre).filter(Boolean);
    return {
      domicilios: primerDomicilio ? textoDomicilio(primerDomicilio.d) : '',
      correos: principal ? principal.email : '',
      usuarios: nombresUsuarios.slice(0, 3).join(', ') + (nombresUsuarios.length > 3 ? '…' : ''),
      productos: ((editando && editando.productos_ids) || []).map(id => (prodsPorId.get(id) || {}).nombre).filter(Boolean).join(', '),
    };
  }, [domicilios, vinculos, emails, usuarios, productos, editando]);

  const tarjetas = [
    { id: 'domicilios', etiqueta: 'Domicilios', cantidad: cantidades.domicilios, vista: vistas.domicilios },
    { id: 'correos', etiqueta: 'Correos', cantidad: cantidades.correos, vista: vistas.correos },
    ...(hayUsuarios ? [{ id: 'usuarios', etiqueta: 'Usuarios', cantidad: cantidades.usuarios, vista: vistas.usuarios }] : []),
    ...(hayProductos ? [{ id: 'productos', etiqueta: 'Productos', cantidad: cantidades.productos, vista: vistas.productos }] : []),
  ];

  const tipos = esAlta
    ? (puedeElegirBanderas
      ? { editable: true, unico: false }
      : (puedeElegirTipo
        ? { editable: true, unico: true }
        : { editable: false, unico: false, ayuda: 'Tu rol solo puede crear este tipo de organización.' }))
    : { editable: !!puedeElegirBanderas && !soloLectura, unico: false, ayuda: 'Solo un admin puede cambiar el tipo de una organización existente.' };

  const sinTipo = !form.es_cliente && !form.es_transportista;
  const nombreVisible = form.nombre_corto.trim() || form.razon_social.trim() || 'Nueva organización';
  const cuitCabecera = form.es_exterior
    ? `Exterior${form.cuit.trim() ? ` · ${form.cuit.trim()}` : ''}`
    : `CUIT ${formatearCuit(cuit.digitos)}`;

  /* ── Render ─────────────────────────────────────────────────────────────── */

  if (orgRecienCreada) {
    return <PasoUsuarioTransportista org={orgRecienCreada} usuario={usuario} onTerminar={onCerrar} />;
  }

  const puedeDarDeBaja = !!editando && puedeEditarOrg(editando) && !editando.es_propia;
  const estaDeBaja = !!editando && editando.estado !== 'activo';

  const pie = (
    <>
      {puedeDarDeBaja && !estaDeBaja && !confirmandoBaja && (
        <Boton variante="peligro" disabled={guardando} onClick={() => { setConfirmandoBaja(true); setErrorBaja(''); }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icono nombre="basura" tamano={16} />Dar de baja</span>
        </Boton>
      )}

      {puedeDarDeBaja && !estaDeBaja && confirmandoBaja && (
        <div
          role="group" aria-label="Confirmar baja"
          style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: tonos.peligro.bg, border: `1px solid ${tonos.peligro.borde}`, borderRadius: 12, padding: '6px 6px 6px 14px', maxWidth: '100%' }}
        >
          <span style={{ fontSize: 13.5, color: tonos.peligro.color }}>¿Dar de baja a <b>{nombreVisible}</b>?</span>
          <input
            aria-label="Motivo de la baja" value={motivoBaja} autoFocus
            onChange={e => setMotivoBaja(e.target.value)} placeholder="Motivo (obligatorio)"
            style={{ height: 36, padding: '0 10px', borderRadius: 8, border: `1px solid ${tonos.peligro.borde}`, background: colores.superficie, color: colores.texto, fontFamily: tipografia.familia, fontSize: 13, minWidth: 200 }}
          />
          <Boton variante="secundario" chico disabled={guardando} onClick={() => { setConfirmandoBaja(false); setMotivoBaja(''); setErrorBaja(''); }}>No</Boton>
          <Boton chico disabled={guardando || !motivoBaja.trim()} onClick={darDeBaja}>Sí, dar de baja</Boton>
          {errorBaja && <span role="alert" style={{ flexBasis: '100%', fontSize: 12.5, color: tonos.peligro.color, padding: '0 8px 6px 0' }}>{errorBaja}</span>}
        </div>
      )}

      {puedeDarDeBaja && estaDeBaja && (
        <Boton variante="secundario" disabled={guardando} onClick={volverAActivar}>Reactivar</Boton>
      )}

      <div style={{ flexGrow: 1 }} />

      {toast && (
        <span
          role="status"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: tonos.exito.color, background: tonos.exito.bg, border: `1px solid ${tonos.exito.borde}`, padding: '8px 12px', borderRadius: 10 }}
        >
          <Icono nombre="check" tamano={14} grosor={3} />{toast}
        </span>
      )}

      <Boton variante="secundario" onClick={() => pedirConfirmacionSiHaceFalta(onCerrar)}>
        {soloLectura ? 'Cerrar' : 'Cancelar'}
      </Boton>
      {!soloLectura && (
        <Boton disabled={guardando || sinTipo || (!esAlta && !hayCambiosSinGuardar)} onClick={guardar}>
          {guardando ? 'Guardando...' : (esAlta ? 'Crear organización' : 'Guardar cambios')}
        </Boton>
      )}
    </>
  );

  const compactoVacio = (icono, titulo, texto, etiquetaBoton) => (abrirForm, editable) => (
    <EstadoVacio icono={icono} titulo={titulo} texto={texto}>
      {editable && <Boton onClick={abrirForm} style={{ marginTop: 8 }}>{etiquetaBoton}</Boton>}
    </EstadoVacio>
  );

  return (
    <ArmazonModalOrganizacion
      cabecera={{
        iniciales: iniciales(nombreVisible),
        nombre: nombreVisible,
        cuit: cuitCabecera,
        activa: esAlta ? null : !estaDeBaja,
        roles: [form.es_cliente && 'Cliente', form.es_transportista && 'Transporte'].filter(Boolean),
        sinGuardar: hayCambiosSinGuardar,
      }}
      pestanas={pestanas}
      pestanaActiva={pestanaVigente}
      onElegirPestana={setPestana}
      onCerrar={() => pedirConfirmacionSiHaceFalta(onCerrar)}
      pie={pie}
    >
      {pestanaVigente === 'general' && (
        <>
          {(soloLectura || (editando && editando.es_propia) || errores.length > 0) && (
            <div style={{ padding: '16px 28px 0' }}>
              {soloLectura && <div style={{ padding: '8px 12px', borderRadius: 8, background: colores.fondoAlterno, color: pal.azul, fontSize: 12, marginBottom: 12 }}>Solo lectura — tu rol no puede editar esta organización.</div>}
              {editando && editando.es_propia && (
                <div style={{ padding: '10px 14px', borderRadius: 8, background: tonos.aviso.bg, border: `0.5px solid ${tonos.aviso.borde}`, fontSize: 13, color: tonos.aviso.color, marginBottom: 12 }}>
                  Esta es la organización propia de Explora. Su razón social y sus
                  domicilios se usan como origen o destino de todos los pedidos.
                </div>
              )}
              {errores.length > 0 && (
                <div role="alert" style={{ padding: '10px 14px', borderRadius: 8, background: tonos.peligro.bg, border: `0.5px solid ${tonos.peligro.borde}`, fontSize: 13, color: tonos.peligro.color, marginBottom: 12, whiteSpace: 'pre-line' }}>
                  {errores.map((e, i) => <div key={i}>{e}</div>)}
                </div>
              )}
            </div>
          )}
          <PestanaGeneral
            form={form} onCambiar={cambiar} soloLectura={soloLectura} esAlta={esAlta}
            cuit={cuit} tipos={tipos} ficha={ficha} tarjetas={tarjetas}
            ultimaModificacion={editando ? formatearUltimaModificacion(editando.actualizado_en) : null}
            onIrA={setPestana}
          />
        </>
      )}

      {pestanaVigente === 'domicilios' && editando && (
        <div style={{ padding: '24px 28px', maxWidth: 800 }}>
          <GestionDomiciliosOrganizacion
            usuario={usuario} organizacion={editando}
            puedeEditar={editaDomicilios} soloLectura={!editaDomicilios}
            onCambio={setToast}
            renderVacio={compactoVacio('pin', 'Sin domicilios cargados', 'Agregá la dirección fiscal o la base operativa.', '+ Agregar domicilio')}
          />
        </div>
      )}

      {pestanaVigente === 'correos' && editando && (
        <div style={{ padding: '24px 28px', maxWidth: 800 }}>
          <GestionEmailsOrganizacion
            usuario={usuario} organizacion={editando}
            puedeEditar={puedeEditarOrg(editando)} soloLectura={soloLectura}
            onCambio={setToast}
            renderVacio={compactoVacio(
              'correo', 'Todavía no hay correos',
              editando.es_transportista
                ? 'Los despachos asignados se notifican a estas direcciones.'
                : 'Podés cargar los correos de contacto de la organización.',
              '+ Agregar correo'
            )}
          />
        </div>
      )}

      {pestanaVigente === 'usuarios' && editando && (
        <PestanaUsuarios
          usuarios={usuarios} cargando={cargandoUsuarios}
          onGestionar={() => pedirConfirmacionSiHaceFalta(() => onCambiarModal({ tipo: 'usuarios', org: editando }))}
        />
      )}

      {pestanaVigente === 'productos' && editando && (
        <PestanaProductos
          org={editando} productos={productos}
          puedeEditar={puedeEditarOrg(editando)} ocupado={ocupadoProductos}
          onAgregar={id => cambiarProducto(id, true)} onQuitar={id => cambiarProducto(id, false)}
        />
      )}
    </ArmazonModalOrganizacion>
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
