/**
 * =============================================================================
 * avisos.js — Bandeja de avisos del chofer
 * =============================================================================
 *
 * PROPÓSITO
 * `useAvisos(dni)` mantiene en tiempo real la lista de avisos NO leídos de un
 * chofer. Es lo que se ve en la bandeja de ChoferScreen y complementa al push:
 * si la notificación no llegó (sin permiso, sin token, sin red), el aviso
 * igual está acá.
 *
 * MODELO DE DATOS (lee `avisos`; el portal los escribe)
 *   destinatario_chofer_dni  string  — DNI del chofer destinatario
 *   tipo                     string  — 'viaje_nominado' | 'despacho_cancelado' |
 *                                      'domicilio_cambiado' | otro
 *   titulo, mensaje          string
 *   pedido_id, despacho_id, viaje_id   referencias
 *   leido                    boolean — lo único que el chofer puede cambiar
 *   creado_en                Timestamp
 *
 * DECISIONES
 *   - Consulta con dos igualdades (`destinatario_chofer_dni` y `leido`) y SIN
 *     `orderBy`: no hay un índice compuesto para ordenar. El orden (más nuevo
 *     primero) se resuelve en el cliente.
 *   - `creado_en` se convierte a ISO 8601: `tiempoDesde` espera ISO. Un aviso
 *     recién escrito por otro dispositivo puede llegar con `creado_en` null
 *     hasta que el servidor confirma; queda con '' y va al final.
 *   - Marcar como leído hace desaparecer el aviso: el snapshot deja de
 *     incluirlo (ya no cumple `leido == false`).
 * =============================================================================
 */

import { useEffect, useState, useCallback } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from './config/firebase';
import { logApp } from './registro';

/**
 * Convierte un Timestamp de Firestore a ISO 8601 ('' si falta).
 *
 * @param {*} ts Timestamp de Firestore, Date, string ISO o null.
 * @returns {string}
 */
function aISO(ts) {
  if (!ts) return '';
  if (typeof ts.toDate === 'function') return ts.toDate().toISOString();
  if (ts instanceof Date) return ts.toISOString();
  return typeof ts === 'string' ? ts : '';
}

/**
 * Avisos sin leer del chofer, en tiempo real.
 *
 * @param {string} dni DNI del chofer (`usuario.datos_chofer.dni`). Sin DNI no se suscribe.
 * @returns {{avisos: Array, marcarLeido: function(string): Promise<void>}}
 *   `avisos`: más nuevo primero, con `creado_en` en ISO. `marcarLeido(id)`
 *   escribe `leido: true`.
 */
export function useAvisos(dni) {
  const [avisos, setAvisos] = useState([]);

  /* EFECTO — suscripción. Depende de `dni`: si cambia el chofer hay que
     resuscribirse; al desmontar o cambiar se da de baja. */
  useEffect(() => {
    if (!dni) { setAvisos([]); return undefined; }

    const consulta = query(
      collection(db, 'avisos'),
      where('destinatario_chofer_dni', '==', dni),
      where('leido', '==', false)
    );

    const unsub = onSnapshot(consulta, (snap) => {
      const lista = snap.docs.map((d) => {
        const datos = d.data();
        return { id: d.id, ...datos, creado_en: aISO(datos.creado_en) };
      });
      lista.sort((a, b) => b.creado_en.localeCompare(a.creado_en));
      setAvisos(lista);
    }, (err) => {
      logApp('avisos_snapshot_error', { code: err?.code || '', mensaje: err?.message || '' });
    });

    return () => unsub();
  }, [dni]);

  /**
   * Marca un aviso como leído. Si falla se registra y el aviso sigue en la
   * bandeja (el chofer puede reintentar).
   *
   * @param {string} id ID del documento en `avisos`.
   */
  const marcarLeido = useCallback(async (id) => {
    try {
      await updateDoc(doc(db, 'avisos', id), { leido: true });
    } catch (err) {
      await logApp('aviso_marcar_leido_error', {
        code: err?.code || '',
        mensaje: err?.message || '',
        aviso_id: id,
      });
    }
  }, []);

  return { avisos, marcarLeido };
}
