/**
 * =============================================================================
 * TemaContext.js — Tema claro/oscuro de la app
 * =============================================================================
 *
 * PROPÓSITO
 * Provee a toda la app el tema vigente (claro u oscuro) y cómo cambiarlo. Los
 * valores de color salen de los tokens compartidos (`temaClaro` / `temaOscuro`);
 * la app no duplica ninguno.
 *
 * CONTRATO — `useTema()` devuelve:
 *   oscuro         boolean  — el tema vigente es el oscuro
 *   colores        objeto   — `temaOscuro` o `temaClaro`
 *   alternar()              — fija la preferencia manual en lo opuesto a lo vigente
 *   modo           'manual' | 'auto'
 *   seguirSistema()         — borra la preferencia: vuelve a seguir al sistema
 *   fijarModo(valor)        — 'claro' | 'oscuro' | null (null = seguir al sistema);
 *                             lo usa el selector de tema de ChoferScreen
 *   listo          boolean  — ya se leyó la preferencia guardada
 * Los tres primeros nombres coinciden con `useTema()` del portal para que el
 * código se lea igual en los dos lados; `modo`, `seguirSistema` y `listo` son
 * propios de la app.
 *
 * DECISIONES
 *   - Arranca siguiendo el tema del sistema (`useColorScheme`). El usuario
 *     puede forzar claro u oscuro y esa elección se recuerda.
 *   - Persistencia: AsyncStorage, clave 'explora_tema', valor 'claro' | 'oscuro'.
 *     Clave ausente = seguir al sistema.
 *   - `listo` existe para evitar un destello del tema equivocado: mientras es
 *     false, App.js mantiene la pantalla de carga.
 *   - Si la lectura de AsyncStorage falla se sigue al sistema y se avisa por
 *     consola; un fallo de storage no debe impedir abrir la app.
 *   - La decisión está en `resolverOscuro`, función pura, para poder probarla
 *     sin React.
 * =============================================================================
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { temaClaro, temaOscuro } from '../compartido';

/** Clave de AsyncStorage con la preferencia manual. */
const CLAVE_TEMA = 'explora_tema';

/**
 * Decide si el tema es oscuro.
 *
 * La preferencia manual manda; sin ella se sigue al sistema. Un esquema de
 * sistema desconocido (`null`, que `useColorScheme` puede devolver) cuenta como
 * claro.
 *
 * @param {'claro'|'oscuro'|null} preferencia Elección guardada, o null.
 * @param {'light'|'dark'|null} esquemaSistema Valor de `useColorScheme()`.
 * @returns {boolean} True si corresponde el tema oscuro.
 */
export function resolverOscuro(preferencia, esquemaSistema) {
  return preferencia ? preferencia === 'oscuro' : esquemaSistema === 'dark';
}

const TemaContext = createContext({
  oscuro: false,
  colores: temaClaro,
  alternar: () => {},
  modo: 'auto',
  seguirSistema: () => {},
  fijarModo: () => {},
  listo: false,
});

/**
 * Proveedor del tema. Va por fuera de todo lo que use `useTema()`.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children
 */
export function TemaProvider({ children }) {
  const esquemaSistema = useColorScheme();

  /** 'claro' | 'oscuro' | null (null = seguir al sistema). */
  const [preferencia, setPreferencia] = useState(null);
  const [listo, setListo] = useState(false);

  /* EFECTO 1 — Lee la preferencia guardada, una sola vez al montar (sin
     dependencias: el valor se guarda desde `fijar`, no se vuelve a leer). */
  useEffect(() => {
    let cancelado = false;
    AsyncStorage.getItem(CLAVE_TEMA)
      .then((valor) => {
        if (!cancelado && (valor === 'claro' || valor === 'oscuro')) setPreferencia(valor);
      })
      .catch((err) => {
        console.warn('tema: no se pudo leer la preferencia:', err?.message || err);
      })
      .finally(() => {
        if (!cancelado) setListo(true);
      });
    return () => { cancelado = true; };
  }, []);

  const oscuro = resolverOscuro(preferencia, esquemaSistema);

  /** Guarda (o borra, con null) la preferencia, en estado y en disco. */
  const fijar = useCallback((valor) => {
    setPreferencia(valor);
    const operacion = valor
      ? AsyncStorage.setItem(CLAVE_TEMA, valor)
      : AsyncStorage.removeItem(CLAVE_TEMA);
    operacion.catch((err) => {
      console.warn('tema: no se pudo guardar la preferencia:', err?.message || err);
    });
  }, []);

  const alternar = useCallback(() => fijar(oscuro ? 'claro' : 'oscuro'), [fijar, oscuro]);
  const seguirSistema = useCallback(() => fijar(null), [fijar]);

  const valor = useMemo(() => ({
    oscuro,
    colores: oscuro ? temaOscuro : temaClaro,
    alternar,
    modo: preferencia ? 'manual' : 'auto',
    seguirSistema,
    fijarModo: fijar,
    listo,
  }), [oscuro, alternar, preferencia, seguirSistema, fijar, listo]);

  return <TemaContext.Provider value={valor}>{children}</TemaContext.Provider>;
}

/**
 * Tema vigente y sus acciones. Ver el contrato en el encabezado del archivo.
 *
 * @returns {{oscuro: boolean, colores: Object, alternar: Function, modo: string, seguirSistema: Function, fijarModo: Function, listo: boolean}}
 */
export function useTema() {
  return useContext(TemaContext);
}
