/**
 * =============================================================================
 * organizaciones/PestanaGeneral.js — v1.2.2 (rediseño del modal)
 * =============================================================================
 *
 * SÍNTOMA
 *   La pestaña "Datos generales" del modal rediseñado: formulario a la
 *   izquierda y ficha a la derecha.
 *
 * CAUSA RAÍZ
 *   El formulario vivía mezclado con el modal entero (`ModalOrganizacion.js`).
 *
 * ALCANCE
 *   Solo presentación del formulario; el estado, la validación y el guardado
 *   siguen en `ModalOrganizacion.js`. Campos y nombres sin cambios. Incluye:
 *   CUIT con ícono de estado (la verificación del dígito es solo una
 *   advertencia ámbar, nunca bloquea), el switch "Cliente del exterior",
 *   las tarjetas Cliente / Transporte (respetan los permisos reales: ver
 *   `tipos`), observaciones con contador y, SOLO en el alta, el correo
 *   opcional. `telefono` de la organización se mantiene tal cual.
 *
 *   `tipos` = { editable, unico, ayuda }:
 *   - editable: false => las dos tarjetas quedan deshabilitadas con tooltip.
 *   - unico: true => se comportan como radio (se elige UNA).
 *
 * LIMITACIONES CONOCIDAS
 *   Ninguna nueva.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Un comercial editando un cliente ve
 *   las tarjetas deshabilitadas; un admin las puede marcar a las dos.
 * ========================================================================== */

import React from 'react';
import { marca, radio, tipografia } from '../../shared/tokens';
import { Icono, useTonos } from './piezas-modal-organizacion';
import PanelFichaCompleta from './PanelFichaCompleta';

const MAX_OBS = 500;

function Etiqueta({ htmlFor, children, extra }) {
  const { colores } = useTonos();
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <label htmlFor={htmlFor} style={{ fontSize: 12, fontWeight: tipografia.peso.negrita, color: colores.textoSecundario, letterSpacing: '.4px' }}>
        {children}
      </label>
      {extra}
    </div>
  );
}

export default function PestanaGeneral({
  form, onCambiar, soloLectura, esAlta, cuit, tipos, ficha, tarjetas, ultimaModificacion, onIrA,
}) {
  const { colores, pal, tonos } = useTonos();

  const estiloInput = {
    width: '100%', boxSizing: 'border-box', height: 38, padding: '0 12px', borderRadius: radio.lg,
    border: `1.5px solid ${colores.borde}`, background: colores.superficie, color: colores.texto,
    fontFamily: tipografia.familia, fontSize: 14,
  };
  const grupo = { display: 'flex', flexDirection: 'column', gap: 4 };

  const cuitIcono = cuit.estado === 'ok'
    ? { fondo: tonos.exito.color, nombre: 'check' }
    : (cuit.estado === 'advertencia' ? { fondo: tonos.aviso.borde, nombre: 'exclamar' }
      : (cuit.estado === 'incompleto' ? { fondo: tonos.peligro.color, nombre: 'exclamar' } : null));
  const cuitMensaje = form.es_exterior
    ? { texto: 'No aplica para clientes del exterior', color: colores.textoSuave }
    : (cuit.estado === 'ok' ? { texto: 'Dígito verificador válido', color: tonos.exito.color }
      : (cuit.estado === 'advertencia' ? { texto: cuit.mensaje, color: tonos.aviso.color }
        : (cuit.estado === 'incompleto' ? { texto: cuit.mensaje, color: tonos.peligro.color }
          : { texto: 'Con o sin guiones, se guarda normalizado', color: colores.textoSuave })));

  function elegirTipo(clave) {
    if (!tipos.editable || soloLectura) return;
    if (tipos.unico) {
      onCambiar({ es_cliente: clave === 'es_cliente', es_transportista: clave === 'es_transportista' });
    } else {
      onCambiar({ [clave]: !form[clave] });
    }
  }

  const tarjetasTipo = [
    { clave: 'es_cliente', titulo: 'Cliente', desc: 'Se le cargan pedidos', icono: 'caja' },
    { clave: 'es_transportista', titulo: 'Transporte', desc: 'Se le asignan despachos', icono: 'camion' },
  ];
  const sinTipo = !form.es_cliente && !form.es_transportista;
  const deshabilitadas = !tipos.editable || soloLectura;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 24, padding: '16px 28px', alignItems: 'stretch', flexGrow: 1 }}>
      {/* Izquierda: formulario (Observaciones se estira para llenar el alto) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px 18px' }}>
          <div style={grupo}>
            <Etiqueta htmlFor="f-razon">Razón social <span style={{ color: pal.rojo }}>*</span></Etiqueta>
            <input id="f-razon" style={estiloInput} disabled={soloLectura} value={form.razon_social}
              onChange={e => onCambiar({ razon_social: e.target.value })} placeholder="PAN AMERICAN ENERGY" />
          </div>
          <div style={grupo}>
            <Etiqueta htmlFor="f-corto">Nombre corto</Etiqueta>
            <input id="f-corto" style={estiloInput} disabled={soloLectura} value={form.nombre_corto}
              onChange={e => onCambiar({ nombre_corto: e.target.value })} placeholder={form.razon_social || 'PAE'}
              title="Para mostrar en listados. Si se deja vacío, se usa la razón social." />
          </div>
          <div style={grupo}>
            <Etiqueta htmlFor="f-cuit">{form.es_exterior ? 'Identificación fiscal' : 'CUIT'}</Etiqueta>
            <div style={{ position: 'relative' }}>
              <input id="f-cuit" disabled={soloLectura} value={form.cuit}
                onChange={e => onCambiar({ cuit: e.target.value })}
                aria-describedby="f-cuit-msg"
                placeholder={form.es_exterior ? 'VAT, RUT, EIN...' : '30-60561644-1'}
                style={{ ...estiloInput, fontFamily: 'monospace', fontSize: 13.5, paddingRight: 40 }} />
              {!form.es_exterior && cuitIcono && (
                <span aria-hidden="true" style={{ position: 'absolute', right: 12, top: 9, width: 20, height: 20, borderRadius: '50%', background: cuitIcono.fondo, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icono nombre={cuitIcono.nombre} tamano={12} grosor={3.2} />
                </span>
              )}
            </div>
            <span id="f-cuit-msg" style={{ fontSize: 12, color: cuitMensaje.color }}>{cuitMensaje.texto}</span>
          </div>
          <div style={grupo}>
            <Etiqueta htmlFor="f-tel">Teléfono</Etiqueta>
            <input id="f-tel" style={estiloInput} disabled={soloLectura} value={form.telefono}
              onChange={e => onCambiar({ telefono: e.target.value })} placeholder="(0341) 456-7890" />
          </div>
          {esAlta && (
            <div style={grupo}>
              <Etiqueta htmlFor="f-correo">Correo</Etiqueta>
              <input id="f-correo" type="email" style={estiloInput} value={form.email}
                onChange={e => onCambiar({ email: e.target.value })} placeholder="contacto@empresa.com" />
              <span style={{ fontSize: 12, color: colores.textoSuave }}>Opcional. Queda como correo principal; después se pueden agregar más desde la pestaña Correos.</span>
            </div>
          )}
        </div>

        {/* Exterior */}
        <button
          type="button" role="switch" aria-checked={form.es_exterior} disabled={soloLectura}
          onClick={() => onCambiar({ es_exterior: !form.es_exterior })}
          style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px', border: `1.5px solid ${colores.borde}`,
            borderRadius: 12, background: colores.superficie, color: colores.texto, cursor: soloLectura ? 'default' : 'pointer',
            font: 'inherit', fontFamily: tipografia.familia, textAlign: 'left',
          }}
        >
          <span aria-hidden="true" style={{ width: 40, height: 24, borderRadius: 999, background: form.es_exterior ? marca : colores.textoTenue, position: 'relative', flexShrink: 0, transition: 'background .15s' }}>
            <span style={{ position: 'absolute', top: 3, left: form.es_exterior ? 19 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 14, fontWeight: tipografia.peso.medio }}>Cliente del exterior</span>
            <span style={{ fontSize: 12, color: colores.textoSuave }}>Sin CUIT argentino — desactiva la validación fiscal.</span>
          </span>
        </button>

        {/* Tipo */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: tipografia.peso.negrita, color: colores.textoSecundario, letterSpacing: '.4px' }}>Qué es esta organización</span>
            {tipos.editable && !tipos.unico && <span style={{ fontSize: 12, color: colores.textoSuave }}>Podés marcar las dos</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {tarjetasTipo.map(t => {
              const on = !!form[t.clave];
              return (
                <button
                  key={t.clave} type="button" role={tipos.unico ? 'radio' : 'checkbox'} aria-checked={on}
                  disabled={deshabilitadas} title={deshabilitadas ? tipos.ayuda : undefined}
                  onClick={() => elegirTipo(t.clave)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 14, position: 'relative',
                    border: `1.5px solid ${on ? marca : colores.borde}`, background: on ? tonos.peligro.bg : colores.superficie,
                    color: on ? colorTextoSobreTinte(tonos) : colores.texto, opacity: deshabilitadas ? 0.7 : 1,
                    cursor: deshabilitadas ? 'not-allowed' : 'pointer', font: 'inherit', fontFamily: tipografia.familia, textAlign: 'left',
                  }}
                >
                  <span aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? marca : colores.fondoAlterno, color: on ? '#fff' : colores.textoSecundario }}>
                    <Icono nombre={t.icono} tamano={22} grosor={1.8} />
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingRight: 22 }}>
                    <span style={{ fontSize: 14.5, fontWeight: tipografia.peso.negrita }}>{t.titulo}</span>
                    <span style={{ fontSize: 12.5, opacity: 0.8, lineHeight: 1.35 }}>{t.desc}</span>
                  </span>
                  <span aria-hidden="true" style={{ position: 'absolute', top: 10, right: 10, width: 20, height: 20, borderRadius: tipos.unico ? '50%' : 6, boxSizing: 'border-box', border: `1.5px solid ${on ? marca : colores.textoTenue}`, background: on ? marca : 'transparent', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {on && <Icono nombre="check" tamano={12} grosor={3.4} />}
                  </span>
                </button>
              );
            })}
          </div>
          {form.es_cliente && form.es_transportista && (
            <div style={{ fontSize: 12.5, color: pal.azul, background: colores.fondoAlterno, borderRadius: 10, padding: '9px 12px' }}>
              Cliente que pone su propio camión para llevarse el producto.
            </div>
          )}
          {sinTipo && (
            <div role="alert" style={{ fontSize: 12.5, color: tonos.peligro.color, background: tonos.peligro.bg, borderRadius: 10, padding: '9px 12px' }}>
              Marcá al menos una opción para poder guardar.
            </div>
          )}
        </div>

        {/* Observaciones */}
        <div style={{ ...grupo, flexGrow: 1, minHeight: 84 }}>
          <Etiqueta htmlFor="f-obs" extra={<span style={{ fontSize: 11.5, color: colores.textoSuave }}>{(form.obs || '').length} / {MAX_OBS}</span>}>
            Observaciones
          </Etiqueta>
          <textarea
            id="f-obs" rows={2} maxLength={MAX_OBS} disabled={soloLectura} value={form.obs}
            onChange={e => onCambiar({ obs: e.target.value })}
            placeholder="Horarios de carga, contacto en planta, condiciones especiales…"
            style={{ ...estiloInput, height: 'auto', flexGrow: 1, minHeight: 56, padding: '10px 12px', resize: 'none', lineHeight: 1.5 }}
          />
        </div>
      </div>

      {/* Derecha: ficha */}
      <PanelFichaCompleta
        ficha={ficha} tarjetas={tarjetas} ultimaModificacion={ultimaModificacion}
        puedeNavegar={!esAlta} onIrA={onIrA}
      />
    </div>
  );
}

// Texto de una tarjeta de tipo activa: sobre el tinte de peligro suave se lee
// con el mismo texto de los banners de error.
function colorTextoSobreTinte(tonos) {
  return tonos.peligro.color;
}
