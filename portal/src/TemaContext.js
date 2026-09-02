/**
 * =============================================================================
 * TemaContext.js — B1: modo claro/oscuro para todo el portal
 * =============================================================================
 *
 * PROPÓSITO
 * Hoy el modo oscuro vive solo, local, adentro de `Home.js` — por eso hay que
 * volver a Home para poder cambiarlo, y ninguna otra pantalla lo respeta. Este
 * Context lo sube a un lugar que envuelve TODO el portal, para que la barra
 * superior, el pie de página, y cada pantalla a medida que se migre a `ui/`
 * lean el mismo estado sin que nadie tenga que pasarlo a mano de padre a
 * hijo en cada nivel.
 *
 * -----------------------------------------------------------------------------
 * DÓNDE SE ENGANCHA
 * -----------------------------------------------------------------------------
 * `<TemaProvider>` envuelve todo en `App.js`, por afuera de `<Contenido />` —
 * mismo criterio que `Pie.js`: tiene que estar disponible en la pantalla de
 * carga y en la de login, no solo después de loguearse.
 *
 * -----------------------------------------------------------------------------
 * CÓMO SE USA DESDE UN COMPONENTE CUALQUIERA
 * -----------------------------------------------------------------------------
 *   import { useTema } from '../ui/TemaContext';
 *
 *   function MiComponente() {
 *     const { oscuro, colores, alternar } = useTema();
 *     return <div style={{ background: colores.superficie }}>...</div>;
 *   }
 *
 * `colores` ya es el objeto correcto (`temaClaro` o `temaOscuro`, de
 * `tokens.js`) según el modo actual — no hace falta preguntar `if (oscuro)`
 * en cada componente que lo consume.
 * ========================================================================== */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { temaClaro, temaOscuro } from './tokens';

const TemaContext = createContext({
  oscuro: false,
  colores: temaClaro,
  alternar: () => {},
});

export function TemaProvider({ children }) {
  // Mismo nombre de clave que ya usaba `Home.js` en `localStorage`
  // (`portal_tema`), para que a alguien que ya tenía elegido el modo oscuro
  // no se le resetee la preferencia con este cambio.
  const [oscuro, setOscuro] = useState(() => localStorage.getItem('portal_tema') === 'oscuro');

  useEffect(() => {
    localStorage.setItem('portal_tema', oscuro ? 'oscuro' : 'claro');

    // Ademas de guardar la preferencia, sincroniza el <body> de verdad.
    // `App.css` le pone un fondo claro fijo (es el color que se ve un
    // instante antes de que React pinte nada) -- sin esto, cualquier borde
    // o rebote de scroll que deje ver el body por debajo de `Pagina` iba a
    // mostrar ese gris claro fijo aunque el resto de la pantalla ya este en
    // oscuro. `Pagina` (en App.js) es la que realmente arma el fondo de
    // toda la pantalla; esto es un refuerzo, no el arreglo principal.
    const t = oscuro ? temaOscuro : temaClaro;
    document.body.style.background = t.fondo;
    document.body.style.color = t.texto;
  }, [oscuro]);

  const valor = {
    oscuro,
    colores: oscuro ? temaOscuro : temaClaro,
    alternar: () => setOscuro(o => !o),
  };

  return <TemaContext.Provider value={valor}>{children}</TemaContext.Provider>;
}

export function useTema() {
  return useContext(TemaContext);
}
