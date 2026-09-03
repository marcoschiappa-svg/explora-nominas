/**
 * =============================================================================
 * ModalDomicilio.js — Agregar una dirección sin salir del pedido
 * =============================================================================
 *
 * PARA QUÉ
 * El caso más frecuente no es el cliente nuevo: es el cliente que ya existe y
 * pide una entrega en una dirección que todavía no está cargada. Sin esto, el
 * comercial tendría que abandonar el pedido, ir a Organizaciones → Domicilios,
 * cargarla y volver a empezar.
 *
 * -----------------------------------------------------------------------------
 * DOS CAMINOS, UN SOLO FORMULARIO
 * -----------------------------------------------------------------------------
 * La dirección puede existir ya —cargada para otro cliente— o ser nueva. No hay
 * dos opciones que elegir: se escribe, y si coincide con una existente se
 * reutiliza en vez de duplicarla.
 *
 *   Coincide EXACTO      se vincula la que ya está, sin preguntar
 *   Se PARECE mucho      se pregunta antes de crear
 *   No se parece a nada  se crea
 *
 * El aviso es el único momento en que se pueden evitar los duplicados. Los 50
 * registros para 34 lugares reales no salieron de que alguien eligiera mal:
 * salieron de escribir y guardar.
 *
 * -----------------------------------------------------------------------------
 * SIEMPRE HAY VÍNCULO
 * -----------------------------------------------------------------------------
 * Un domicilio sin vínculo no le aparece a nadie al cargar un pedido. Por eso
 * el domicilio y el vínculo van en la misma transacción: o entran los dos o no
 * entra ninguno.
 * ========================================================================== */

import React, { useState, useMemo } from 'react';
import { doc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { enTransaccion, calcularDiferencias } from '../datos';
import { claveDomicilio } from '../mapa-normalizacion';
import {
  buscarParecidos,
  buscarCasiIgual,
  buscarIdentico,
  textoDomicilio,
} from '../buscar-domicilios';

const PROVINCIAS = [
  'Buenos Aires', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba', 'Corrientes',
  'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza',
  'Misiones', 'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis',
  'Santa Cruz', 'Santa Fe', 'Santiago del Estero', 'Tierra del Fuego', 'Tucumán',
];

export default function ModalDomicilio({
  usuario,
  organizacionId,
  organizacionNombre,
  domicilios,
  yaVinculados = new Set(),
  onCreado,        // (domicilioId)
  onCancelar,
}) {
  const [form, setForm] = useState({
    calle: '', numero: '', ciudad: '', provincia: '', cp: '', alias: '',
  });
  const [errores, setErrores] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [elegido, setElegido] = useState(null);

  /**
   * Sugerencias mientras se escribe. Las que este cliente ya tiene se muestran
   * marcadas en vez de esconderse: si alguien está escribiendo una dirección
   * que ya cargó, lo útil es decírselo ahí, no dejar que la termine.
   */
  const sugerencias = useMemo(() => {
    if (elegido) return [];
    return buscarParecidos(domicilios, form).map(s => ({
      ...s,
      yaEsta: yaVinculados.has(s.domicilio.id),
    }));
  }, [domicilios, form, elegido, yaVinculados]);

  function validar() {
    const problemas = [];
    if (!form.calle.trim())     problemas.push('La calle es obligatoria.');
    if (!form.ciudad.trim())    problemas.push('La ciudad es obligatoria.');
    if (!form.provincia.trim()) problemas.push('La provincia es obligatoria.');
    return problemas;
  }

  async function guardar(forzar = false) {
    setErrores([]);

    // Se eligió una de las sugeridas: solo hay que vincularla.
    if (elegido) {
      await escribir(elegido, null);
      return;
    }

    const problemas = validar();
    if (problemas.length > 0) { setErrores(problemas); return; }

    const nuevo = {
      calle: form.calle.trim(),
      numero: form.numero.trim() || null,
      ciudad: form.ciudad.trim(),
      provincia: form.provincia.trim(),
      cp: form.cp.trim() || null,
    };

    const identico = buscarIdentico(domicilios, nuevo);
    if (identico) {
      if (yaVinculados.has(identico.id)) {
        setErrores([`${organizacionNombre} ya tiene esa dirección.`]);
        return;
      }
      await escribir(identico, null);
      return;
    }

    if (!forzar) {
      const casiIgual = buscarCasiIgual(domicilios, nuevo);
      if (casiIgual) { setAviso(casiIgual); return; }
    }

    await escribir(null, nuevo);
  }

  /**
   * Escribe. Si `existente` viene, solo se crea el vínculo; si viene `nuevo`,
   * se crean el domicilio y el vínculo juntos.
   */
  async function escribir(existente, nuevo) {
    setGuardando(true);
    try {
      const id = await enTransaccion(async (tx, anotar) => {
        let domicilioId;

        if (existente) {
          domicilioId = existente.id;
        } else {
          const refDom = doc(collection(db, 'domicilios'));
          const datosDom = {
            ...nuevo,
            maps_link: null,
            // Lo que se carga a mano nace verificado: alguien lo escribió
            // mirando la dirección real.
            verificado: true,
            estado: 'activo',
            obs: '',
            clave_normalizada: claveDomicilio(nuevo),
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
          organizacion_id: organizacionId,
          domicilio_id: domicilioId,
          alias: form.alias.trim() || null,
          // Principal solo si es la primera del cliente.
          principal: yaVinculados.size === 0,
          clave_normalizada: `${organizacionId}|${domicilioId}`,
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

        return domicilioId;
      }, 2);

      onCreado(id);
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
        <div style={estilos.titulo}>Dirección de entrega</div>
        <div style={estilos.subtitulo}>{organizacionNombre}</div>

        {errores.length > 0 && (
          <div style={estilos.bannerError}>
            {errores.map((e, i) => <div key={i}>{e}</div>)}
          </div>
        )}

        {elegido && (
          <div style={estilos.bannerOk}>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>
              Se va a vincular esta dirección:
            </div>
            <div>{textoDomicilio(elegido)}</div>
            <button
              type="button"
              style={estilos.btnLink}
              onClick={() => setElegido(null)}
            >
              No es esa, escribir otra
            </button>
          </div>
        )}

        {aviso && (
          <div style={estilos.bannerAviso}>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>¿No será esta?</div>
            <div style={{ marginBottom: 8 }}>{textoDomicilio(aviso)}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                style={estilos.btnPrimary}
                onClick={() => { setElegido(aviso); setAviso(null); }}
              >
                Sí, usar esa
              </button>
              <button
                type="button"
                style={estilos.btnSecundario}
                disabled={guardando}
                onClick={() => { setAviso(null); guardar(true); }}
              >
                No, crear la que escribí
              </button>
            </div>
          </div>
        )}

        {!elegido && (
          <>
            <div style={estilos.grid2}>
              <div style={estilos.campo}>
                <label style={estilos.label}>Calle *</label>
                <input
                  style={estilos.input}
                  value={form.calle}
                  onChange={e => { setForm({ ...form, calle: e.target.value }); setAviso(null); }}
                  placeholder="Av. Emilio Mitre"
                  autoFocus
                />
              </div>
              <div style={estilos.campo}>
                <label style={estilos.label}>Número</label>
                <input
                  style={estilos.input}
                  value={form.numero}
                  onChange={e => { setForm({ ...form, numero: e.target.value }); setAviso(null); }}
                  placeholder="574 · KM 55,5 · s/n"
                />
              </div>
              <div style={estilos.campo}>
                <label style={estilos.label}>Ciudad *</label>
                <input
                  style={estilos.input}
                  value={form.ciudad}
                  onChange={e => { setForm({ ...form, ciudad: e.target.value }); setAviso(null); }}
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
              <div style={estilos.campo}>
                <label style={estilos.label}>Alias</label>
                <input
                  style={estilos.input}
                  value={form.alias}
                  onChange={e => setForm({ ...form, alias: e.target.value })}
                  placeholder="Depósito norte"
                />
              </div>
            </div>

            {sugerencias.length > 0 && (
              <div style={estilos.sugerencias}>
                <div style={estilos.sugerenciasTitulo}>
                  Direcciones parecidas que ya están cargadas
                </div>
                {sugerencias.map(s => (
                  <button
                    key={s.domicilio.id}
                    type="button"
                    style={{ ...estilos.sugerencia, opacity: s.yaEsta ? 0.5 : 1 }}
                    onClick={() => {
                      if (s.yaEsta) {
                        setErrores([`${organizacionNombre} ya tiene esa dirección.`]);
                        return;
                      }
                      setElegido(s.domicilio);
                      setAviso(null);
                      setErrores([]);
                    }}
                  >
                    <span>{textoDomicilio(s.domicilio)}</span>
                    {s.yaEsta && <span style={estilos.sugerenciaNota}>ya la tiene</span>}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        <div style={estilos.acciones}>
          <button
            type="button"
            style={{ ...estilos.btnPrimary, opacity: guardando ? 0.6 : 1 }}
            disabled={guardando || !!aviso}
            onClick={() => guardar(false)}
          >
            {guardando ? 'Guardando...' : (elegido ? 'Vincular' : 'Agregar')}
          </button>
          <button type="button" style={estilos.btnSecundario} onClick={onCancelar}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function traducirError(err) {
  if (err && err.code === 'permission-denied') {
    return 'Firestore rechazó la escritura. Cargar direcciones requiere el rol '
         + 'de administrador o comercial.';
  }
  return (err && err.message) || 'Error desconocido.';
}

const estilos = {
  fondo: { position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '3rem 1rem', zIndex: 50, overflowY: 'auto' },
  modal: { background: '#fff', borderRadius: 12, padding: '1.5rem', width: '100%', maxWidth: 540, boxShadow: '0 12px 32px rgba(0,0,0,0.16)' },
  titulo: { fontSize: 16, fontWeight: 500, color: '#111827' },
  subtitulo: { fontSize: 13, color: '#6B7280', marginBottom: 16 },
  campo: { display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 },
  label: { fontSize: 11, color: '#9CA3AF' },
  input: { fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '0.5px solid #E5E7EB', color: '#111827', width: '100%', boxSizing: 'border-box' },
  sugerencias: { background: '#F9FAFB', border: '0.5px solid #E5E7EB', borderRadius: 8, padding: '8px 10px', marginBottom: 12 },
  sugerenciasTitulo: { fontSize: 11, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 },
  sugerencia: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', textAlign: 'left', padding: '6px 8px', borderRadius: 6, border: 'none', background: '#fff', fontSize: 12, color: '#111827', cursor: 'pointer', marginBottom: 4 },
  sugerenciaNota: { fontSize: 11, color: '#9CA3AF', flexShrink: 0 },
  acciones: { display: 'flex', gap: 8, marginTop: 4 },
  btnPrimary: { padding: '8px 16px', borderRadius: 8, border: 'none', background: '#C8102E', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  btnSecundario: { padding: '8px 16px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer' },
  btnLink: { border: 'none', background: 'none', color: '#C8102E', fontSize: 12, cursor: 'pointer', padding: 0, textDecoration: 'underline', marginTop: 6 },
  bannerOk: { padding: '10px 14px', borderRadius: 8, background: '#E1F5EE', border: '0.5px solid #5DCAA5', fontSize: 13, color: '#085041', marginBottom: 12 },
  bannerAviso: { padding: '10px 14px', borderRadius: 8, background: '#FEF3C7', border: '0.5px solid #F59E0B', fontSize: 13, color: '#92400E', marginBottom: 12 },
  bannerError: { padding: '10px 14px', borderRadius: 8, background: '#FEF2F2', border: '0.5px solid #FCA5A5', fontSize: 13, color: '#B91C1C', marginBottom: 12, whiteSpace: 'pre-line' },
};
