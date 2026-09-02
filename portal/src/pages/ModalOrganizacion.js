/**
 * =============================================================================
 * ModalOrganizacion.js — Alta rápida de un cliente sin salir del pedido
 * =============================================================================
 *
 * PARA QUÉ
 * Cuando el comercial está cargando un pedido y el cliente no existe todavía.
 * Sin esto tendría que abandonar la carga, ir al ABM, crear la organización,
 * volver y empezar de nuevo.
 *
 * -----------------------------------------------------------------------------
 * PIDE LO MÍNIMO
 * -----------------------------------------------------------------------------
 * Razón social, nombre corto y CUIT. Nada más. `es_cliente` va en true —se lo
 * está creando desde el selector de cliente— y el resto se completa después
 * desde el ABM si hace falta.
 *
 * El ABM completo tiene banderas, observaciones y estado. En el medio de cargar
 * un pedido eso es demasiado: cada campo de más es una decisión que interrumpe
 * lo que la persona vino a hacer.
 *
 * -----------------------------------------------------------------------------
 * LA DIRECCIÓN, EN EL MISMO FORMULARIO
 * -----------------------------------------------------------------------------
 * Un cliente recién creado no tiene domicilios, así que el paso siguiente del
 * pedido —elegir dónde entregar— quedaría trabado igual. Por eso el botón
 * despliega los campos de dirección acá adentro en vez de abrir otro modal:
 * uno sobre otro, en el medio de una carga, es demasiada profundidad.
 *
 * Con la dirección desplegada se crean TRES documentos en una transacción: la
 * organización, el domicilio y el vínculo. O entra todo o no entra nada — una
 * organización sin domicilio y un domicilio sin vínculo son dos formas
 * distintas de quedar a medias.
 *
 * -----------------------------------------------------------------------------
 * AVISA DE LOS DUPLICADOS
 * -----------------------------------------------------------------------------
 * Es la misma protección del ABM, y acá importa más: alguien apurado cargando
 * un pedido es exactamente quien escribe "Pro Crop" sin fijarse si ya existe
 * "PRO CROP".
 * ========================================================================== */

import React, { useState, useMemo } from 'react';
import { doc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { enTransaccion, calcularDiferencias } from '../datos';
import { claveNormalizada, claveDomicilio, normalizarCuit } from '../mapa-normalizacion';
import { buscarCasiIgual, buscarIdentico, textoDomicilio } from '../buscar-domicilios';

const PROVINCIAS = [
  'Buenos Aires', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba', 'Corrientes',
  'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza',
  'Misiones', 'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis',
  'Santa Cruz', 'Santa Fe', 'Santiago del Estero', 'Tierra del Fuego', 'Tucumán',
];

export default function ModalOrganizacion({
  usuario,
  organizaciones,
  domicilios,
  nombreInicial = '',
  onCreada,        // (organizacionId, domicilioId | null)
  onCancelar,
}) {
  const [form, setForm] = useState({
    razon_social: nombreInicial,
    nombre_corto: '',
    cuit: '',
    calle: '', numero: '', ciudad: '', provincia: '', cp: '',
  });
  const [conDireccion, setConDireccion] = useState(false);
  const [errores, setErrores] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [avisoDomicilio, setAvisoDomicilio] = useState(null);

  /** ¿Ya existe una organización con ese nombre? Se busca mientras escribe. */
  const duplicada = useMemo(() => {
    const clave = claveNormalizada(form.razon_social);
    if (!clave) return null;
    return organizaciones.find(o => claveNormalizada(o.razon_social) === clave) || null;
  }, [form.razon_social, organizaciones]);

  function validar() {
    const problemas = [];

    if (!form.razon_social.trim()) {
      problemas.push('La razón social es obligatoria.');
    }
    if (form.cuit.trim() && !normalizarCuit(form.cuit)) {
      problemas.push('El CUIT tiene que tener 11 dígitos.');
    }

    if (conDireccion) {
      if (!form.calle.trim())     problemas.push('La calle es obligatoria.');
      if (!form.ciudad.trim())    problemas.push('La ciudad es obligatoria.');
      if (!form.provincia.trim()) problemas.push('La provincia es obligatoria.');
    }

    return problemas;
  }

  async function guardar(forzarDomicilio = false) {
    const problemas = validar();
    if (problemas.length > 0) { setErrores(problemas); return; }

    if (duplicada) {
      setErrores([`Ya existe "${duplicada.razon_social}". Elegila de la lista en vez de crear otra.`]);
      return;
    }

    const razon = form.razon_social.trim();
    const nuevoDomicilio = conDireccion ? {
      calle: form.calle.trim(),
      numero: form.numero.trim() || null,
      ciudad: form.ciudad.trim(),
      provincia: form.provincia.trim(),
      cp: form.cp.trim() || null,
    } : null;

    // Si la dirección ya existe idéntica, se reutiliza sin preguntar: no hay
    // nada que decidir.
    let domicilioExistente = null;
    if (nuevoDomicilio) {
      domicilioExistente = buscarIdentico(domicilios, nuevoDomicilio);

      // Si se parece mucho a otra, se pregunta antes de crear una nueva. Es el
      // único momento en que se pueden evitar los duplicados.
      if (!domicilioExistente && !forzarDomicilio) {
        const casiIgual = buscarCasiIgual(domicilios, nuevoDomicilio);
        if (casiIgual) { setAvisoDomicilio(casiIgual); return; }
      }
    }

    setGuardando(true);
    setErrores([]);

    try {
      const resultado = await enTransaccion(async (tx, anotar) => {
        const refOrg = doc(collection(db, 'organizaciones'));

        const datosOrg = {
          razon_social: razon,
          nombre_corto: form.nombre_corto.trim() || razon,
          cuit: form.cuit.trim() ? normalizarCuit(form.cuit) : null,
          estado: 'activo',
          obs: '',
          // Se la está creando desde el selector de cliente de un pedido.
          es_cliente: true,
          es_transportista: false,
          es_propia: false,
          clave_normalizada: claveNormalizada(razon),
          creado_por_uid: usuario.uid,
          creado_en: serverTimestamp(),
          actualizado_en: serverTimestamp(),
        };

        tx.set(refOrg, datosOrg);
        anotar({
          entidadTipo: 'organizacion',
          entidadId: refOrg.id,
          accion: 'crear_organizacion',
          diferencias: calcularDiferencias({}, datosOrg),
          usuario,
        });

        if (!nuevoDomicilio) return { orgId: refOrg.id, domicilioId: null };

        // El domicilio: nuevo, o el que ya existía.
        let domicilioId;

        if (domicilioExistente) {
          domicilioId = domicilioExistente.id;
        } else {
          const refDom = doc(collection(db, 'domicilios'));
          const datosDom = {
            ...nuevoDomicilio,
            maps_link: null,
            // Lo que se carga a mano nace verificado: alguien lo escribió
            // mirando la dirección real. Los que quedan sin verificar son los
            // de la carga inicial, que salieron de parsear texto libre.
            verificado: true,
            estado: 'activo',
            obs: '',
            clave_normalizada: claveDomicilio(nuevoDomicilio),
            creado_por_uid: usuario.uid,
            creado_en: serverTimestamp(),
            actualizado_en: serverTimestamp(),
          };
          tx.set(refDom, datosDom);
          anotar({
            entidadTipo: 'domicilio',
            entidadId: refDom.id,
            accion: 'crear_domicilio',
            diferencias: calcularDiferencias({}, datosDom),
            usuario,
          });
          domicilioId = refDom.id;
        }

        const refVinculo = doc(collection(db, 'organizacion_domicilios'));
        const datosVinculo = {
          organizacion_id: refOrg.id,
          domicilio_id: domicilioId,
          alias: null,
          principal: true,     // es la primera, así que es la principal
          clave_normalizada: `${refOrg.id}|${domicilioId}`,
          creado_por_uid: usuario.uid,
          creado_en: serverTimestamp(),
          actualizado_en: serverTimestamp(),
        };

        tx.set(refVinculo, datosVinculo);
        anotar({
          entidadTipo: 'organizacion_domicilio',
          entidadId: refVinculo.id,
          accion: 'vincular_domicilio',
          diferencias: calcularDiferencias({}, datosVinculo),
          usuario,
        });

        return { orgId: refOrg.id, domicilioId };
      }, 3);

      onCreada(resultado.orgId, resultado.domicilioId);
    } catch (err) {
      console.error(err);
      setErrores([traducirError(err)]);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div style={estilos.fondo} onMouseDown={onCancelar}>
      <div style={estilos.modal} onMouseDown={e => e.stopPropagation()}>
        <div style={estilos.titulo}>Nueva organización</div>

        {errores.length > 0 && (
          <div style={estilos.bannerError}>
            {errores.map((e, i) => <div key={i}>{e}</div>)}
          </div>
        )}

        {duplicada && (
          <div style={estilos.bannerAviso}>
            Ya existe <strong>{duplicada.razon_social}</strong>. Cerrá esto y
            elegila de la lista.
          </div>
        )}

        {avisoDomicilio && (
          <div style={estilos.bannerAviso}>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>
              ¿La dirección no será esta?
            </div>
            <div style={{ marginBottom: 8 }}>{textoDomicilio(avisoDomicilio)}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                style={estilos.btnPrimary}
                disabled={guardando}
                onClick={() => {
                  setForm({
                    ...form,
                    calle: avisoDomicilio.calle,
                    numero: avisoDomicilio.numero || '',
                    ciudad: avisoDomicilio.ciudad,
                    provincia: avisoDomicilio.provincia,
                    cp: avisoDomicilio.cp || '',
                  });
                  setAvisoDomicilio(null);
                }}
              >
                Sí, usar esa
              </button>
              <button
                type="button"
                style={estilos.btnSecundario}
                disabled={guardando}
                onClick={() => { setAvisoDomicilio(null); guardar(true); }}
              >
                No, crear la que escribí
              </button>
            </div>
          </div>
        )}

        <div style={estilos.campo}>
          <label style={estilos.label}>Razón social *</label>
          <input
            style={estilos.input}
            value={form.razon_social}
            onChange={e => setForm({ ...form, razon_social: e.target.value })}
            placeholder="PAN AMERICAN ENERGY"
            autoFocus
          />
        </div>

        <div style={estilos.grid2}>
          <div style={estilos.campo}>
            <label style={estilos.label}>Nombre corto</label>
            <input
              style={estilos.input}
              value={form.nombre_corto}
              onChange={e => setForm({ ...form, nombre_corto: e.target.value })}
              placeholder="PAE"
            />
            <span style={estilos.ayuda}>Para buscarla escribiendo poco.</span>
          </div>

          <div style={estilos.campo}>
            <label style={estilos.label}>CUIT</label>
            <input
              style={estilos.input}
              value={form.cuit}
              onChange={e => setForm({ ...form, cuit: e.target.value })}
              placeholder="30-60561644-1"
            />
          </div>
        </div>

        {!conDireccion ? (
          <button
            type="button"
            style={estilos.btnAgregar}
            onClick={() => setConDireccion(true)}
          >
            + Añadir dirección de entrega
          </button>
        ) : (
          <div style={estilos.seccionDireccion}>
            <div style={estilos.seccionTitulo}>Dirección de entrega</div>

            <div style={estilos.grid2}>
              <div style={estilos.campo}>
                <label style={estilos.label}>Calle *</label>
                <input
                  style={estilos.input}
                  value={form.calle}
                  onChange={e => { setForm({ ...form, calle: e.target.value }); setAvisoDomicilio(null); }}
                  placeholder="Av. Emilio Mitre"
                />
              </div>
              <div style={estilos.campo}>
                <label style={estilos.label}>Número</label>
                <input
                  style={estilos.input}
                  value={form.numero}
                  onChange={e => { setForm({ ...form, numero: e.target.value }); setAvisoDomicilio(null); }}
                  placeholder="574 · KM 55,5 · s/n"
                />
              </div>
              <div style={estilos.campo}>
                <label style={estilos.label}>Ciudad *</label>
                <input
                  style={estilos.input}
                  value={form.ciudad}
                  onChange={e => { setForm({ ...form, ciudad: e.target.value }); setAvisoDomicilio(null); }}
                  placeholder="Campana"
                />
              </div>
              <div style={estilos.campo}>
                <label style={estilos.label}>Provincia *</label>
                <select
                  style={estilos.input}
                  value={form.provincia}
                  onChange={e => setForm({ ...form, provincia: e.target.value })}
                >
                  <option value="">Elegir...</option>
                  {PROVINCIAS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div style={estilos.campo}>
                <label style={estilos.label}>Código postal</label>
                <input
                  style={estilos.input}
                  value={form.cp}
                  onChange={e => setForm({ ...form, cp: e.target.value })}
                  placeholder="B2804"
                />
              </div>
            </div>

            <button
              type="button"
              style={estilos.btnQuitarDireccion}
              onClick={() => { setConDireccion(false); setAvisoDomicilio(null); }}
            >
              Quitar la dirección
            </button>
          </div>
        )}

        <div style={estilos.acciones}>
          <button
            type="button"
            style={{ ...estilos.btnPrimary, opacity: guardando ? 0.6 : 1 }}
            disabled={guardando || !!duplicada || !!avisoDomicilio}
            onClick={() => guardar(false)}
          >
            {guardando ? 'Creando...' : 'Crear'}
          </button>
          <button type="button" style={estilos.btnSecundario} onClick={onCancelar}>
            Cancelar
          </button>
        </div>

        {!conDireccion && (
          <div style={estilos.pie}>
            Sin dirección no vas a poder elegir dónde entregar. Se puede agregar
            después desde Organizaciones.
          </div>
        )}
      </div>
    </div>
  );
}

function traducirError(err) {
  if (err && err.code === 'permission-denied') {
    return 'Firestore rechazó la escritura. Crear organizaciones requiere el rol '
         + 'de administrador o comercial.';
  }
  return (err && err.message) || 'Error desconocido.';
}

const estilos = {
  fondo: { position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '3rem 1rem', zIndex: 50, overflowY: 'auto' },
  modal: { background: '#fff', borderRadius: 12, padding: '1.5rem', width: '100%', maxWidth: 540, boxShadow: '0 12px 32px rgba(0,0,0,0.16)' },
  titulo: { fontSize: 16, fontWeight: 500, color: '#111827', marginBottom: 16 },
  campo: { display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 },
  label: { fontSize: 11, color: '#9CA3AF' },
  input: { fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '0.5px solid #E5E7EB', color: '#111827', width: '100%', boxSizing: 'border-box' },
  ayuda: { fontSize: 11, color: '#9CA3AF' },
  btnAgregar: { width: '100%', padding: '10px', borderRadius: 8, border: '0.5px dashed #E5E7EB', background: '#F9FAFB', color: '#C8102E', fontSize: 13, cursor: 'pointer', marginBottom: 12 },
  seccionDireccion: { padding: '12px', borderRadius: 8, background: '#F9FAFB', border: '0.5px solid #E5E7EB', marginBottom: 12 },
  seccionTitulo: { fontSize: 11, fontWeight: 500, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 },
  btnQuitarDireccion: { border: 'none', background: 'none', color: '#9CA3AF', fontSize: 12, cursor: 'pointer', padding: 0 },
  acciones: { display: 'flex', gap: 8, marginTop: 4 },
  btnPrimary: { padding: '8px 16px', borderRadius: 8, border: 'none', background: '#C8102E', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  btnSecundario: { padding: '8px 16px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer' },
  pie: { fontSize: 11, color: '#9CA3AF', marginTop: 10, lineHeight: 1.5 },
  bannerAviso: { padding: '10px 14px', borderRadius: 8, background: '#FEF3C7', border: '0.5px solid #F59E0B', fontSize: 13, color: '#92400E', marginBottom: 12 },
  bannerError: { padding: '10px 14px', borderRadius: 8, background: '#FEF2F2', border: '0.5px solid #FCA5A5', fontSize: 13, color: '#B91C1C', marginBottom: 12, whiteSpace: 'pre-line' },
};
