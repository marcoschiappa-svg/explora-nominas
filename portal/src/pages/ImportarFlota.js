/**
 * =============================================================================
 * ImportarFlota.js — Importación de choferes, tractores y acoplados (RF-04)
 * =============================================================================
 *
 * v1.2.0 (RF-04)
 *
 * SÍNTOMA
 *   Una empresa de transporte que recién entra al portal carga sus choferes
 *   y sus unidades de a uno, a mano, desde `Usuarios.js`/`Camiones.js`.
 *
 * CAUSA RAÍZ
 *   No existía un camino de carga masiva para flota -- solo para pedidos
 *   (`Pedidos.js`, vista "Carga masiva").
 *
 * ALCANCE
 *   Mismo flujo que la carga masiva de pedidos: descargar plantilla → subir
 *   archivo → vista previa por hoja con estado y errores de cada fila →
 *   confirmar → progreso → resumen. La PLANTILLA se genera en el navegador
 *   con SheetJS (`XLSX.utils.aoa_to_sheet` + `XLSX.writeFile`), sin archivo
 *   estático nuevo -- a diferencia de la de pedidos, que es un `.xlsx`
 *   fijo en `public/`. Tres hojas -- Choferes, Tractores, Acoplados --
 *   mismo formato que la de pedidos: filas 1-2 título e instrucciones, fila
 *   3 encabezados, fila 4 ejemplo, datos desde la fila 5, columnas leídas
 *   por posición (ver `importar-flota.js`).
 *
 *   1. Entra desde "Importar desde Excel" en `Camiones.js`, visible para
 *      admin y transportista -- nunca coordinador: las reglas de
 *      `usuarios` no le permiten crear choferes (solo admin o el propio
 *      transportista, ver `firestore.rules.produccion`).
 *   2. Organización destino: el admin la elige entre las `es_transportista`
 *      activas (mismo criterio que `Camiones.js`); el transportista no
 *      elige, es la suya (`miOrganizacion(usuario)`).
 *   3. Solo se escriben las filas `nueva`. Las `existente` se informan y no
 *      se tocan; las `error` se listan en el resumen como no cargadas. Se
 *      puede confirmar el lote aunque tenga filas con error -- a diferencia
 *      de la carga masiva de pedidos, que bloquea TODO si hay una sola
 *      fila mal: acá cada fila es independiente (un chofer y un tractor no
 *      dependen uno del otro), así que no tiene sentido frenar el resto por
 *      una fila mala.
 *   4. Escritura fila por fila, sin frenar el lote si una falla: choferes
 *      con `darDeAltaUsuario()` (que ya deshace la cuenta de Auth si falla
 *      el perfil, ver `alta-usuarios.js`), tractores/acoplados con
 *      `crear()` de `datos.js` sobre el documento de
 *      `datosDeAltaUnidad()`.
 *   5. Credenciales de choferes: si se creó al menos uno, un botón
 *      "Descargar credenciales" arma con SheetJS un `.xlsx` (Nombre, DNI,
 *      Contraseña) -- se puede descargar UNA sola vez por importación;
 *      después se deshabilita con la leyenda de que las contraseñas no se
 *      guardan en ningún lado. Viven SOLO en el estado del componente
 *      (`credenciales`, más abajo) -- nunca se escriben en Firestore,
 *      `localStorage` ni consola. Si se sale de la pantalla sin
 *      descargarlas, `window.confirm` avisa que se pierden.
 *
 * LIMITACIONES CONOCIDAS
 *   No hay resolución por parecido (a diferencia de la carga masiva de
 *   pedidos): el DNI y la patente son el dato en sí, no un texto a
 *   resolver contra un catálogo -- ver `importar-flota.js`.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Manual: importar una planilla con
 *   una fila nueva, una existente y una con error por hoja -- el resumen
 *   tiene que mostrar los tres estados, y solo la nueva queda cargada.
 *   Descargar credenciales una vez y confirmar que el botón queda
 *   deshabilitado; salir sin descargarlas y confirmar que aparece el aviso.
 * ========================================================================== */

import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { crear } from '../shared/datos';
import { esAdmin, miOrganizacion } from '../sesion';
import { darDeAltaUsuario, traducirErrorAuth } from '../alta-usuarios';
import { mostrarPatente } from '../logica-flota';
import { interpretarPlanilla } from '../importar-flota';
import { colorEstado, tipografia } from '../shared/tokens';
import { useTema } from '../ui/TemaContext';
import Boton from '../ui/Boton';
import Tarjeta from '../ui/Tarjeta';
import Pastilla from '../ui/Pastilla';
import Campo from '../ui/Campo';

/* -----------------------------------------------------------------------------
 * La plantilla -- generada en el navegador, tres hojas.
 * -------------------------------------------------------------------------- */

const HOJAS = [
  {
    nombre: 'Choferes',
    encabezados: ['Nombre y apellido', 'DNI', 'CUIT', 'Teléfono'],
    ejemplo: ['CABALLERO, WALTER ROMAN', '25505747', '20-25505747-3', '3476562372'],
    instrucciones: 'Nombre y DNI son obligatorios. CUIT y Teléfono, opcionales.',
  },
  {
    nombre: 'Tractores',
    encabezados: ['Patente', 'Observaciones'],
    ejemplo: ['AB123CD', ''],
    instrucciones: 'Patente obligatoria, formato ABC123 o AB123CD.',
  },
  {
    nombre: 'Acoplados',
    encabezados: ['Patente', 'Observaciones'],
    ejemplo: ['AC456DE', ''],
    instrucciones: 'Patente obligatoria, formato ABC123 o AB123CD.',
  },
];

function generarPlantilla() {
  const wb = XLSX.utils.book_new();

  HOJAS.forEach(h => {
    const filas = [
      [`Planilla de ${h.nombre.toLowerCase()} — Portal Explora`],
      [h.instrucciones + ' Se completa desde la fila 5. No cambiar el orden de las columnas.'],
      h.encabezados,
      h.ejemplo,
    ];
    const hoja = XLSX.utils.aoa_to_sheet(filas);
    XLSX.utils.book_append_sheet(wb, hoja, h.nombre);
  });

  XLSX.writeFile(wb, 'plantilla_flota_explora.xlsx');
}

/* -----------------------------------------------------------------------------
 * Componente
 * -------------------------------------------------------------------------- */

const ETIQUETA_ESTADO = {
  nueva: { texto: 'Nueva', bg: colorEstado.exitoFondo, color: colorEstado.exitoTexto },
  existente: { texto: 'Existente — se saltea', bg: colorEstado.advertenciaFondoAlterno, color: colorEstado.advertenciaTextoFuerte },
  error: { texto: 'Con error', bg: colorEstado.peligroFondo, color: colorEstado.peligroTexto },
};

export default function ImportarFlota({ usuario, organizaciones, onVolver }) {
  const styles = useEstilos();
  const soyAdmin = esAdmin(usuario);
  const miOrg = miOrganizacion(usuario);

  const [organizacionId, setOrganizacionId] = useState(soyAdmin ? '' : miOrg);
  const [usuarios, setUsuarios] = useState([]);
  const [camiones, setCamiones] = useState([]);

  const [paso, setPaso] = useState('descargar');       // descargar | subir
  const [resultado, setResultado] = useState(null);     // salida de interpretarPlanilla
  const [nombreArchivo, setNombreArchivo] = useState('');
  const [errorArchivo, setErrorArchivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [progreso, setProgreso] = useState(null);        // { hechos, total, creados: {...}, existentes: {...}, fallidos: {...} }
  const [credenciales, setCredenciales] = useState(null); // [{ nombre, dni, clave }] -- solo en memoria
  const [credencialesDescargadas, setCredencialesDescargadas] = useState(false);

  const orgsElegibles = useMemo(
    () => (organizaciones || [])
      .filter(o => o.es_transportista && o.estado === 'activo')
      .sort((a, b) => a.razon_social.localeCompare(b.razon_social, 'es')),
    [organizaciones]
  );

  /* ── Carga de catálogos de la organización elegida ─────────────────────── */

  useEffect(() => {
    if (!organizacionId) { setUsuarios([]); setCamiones([]); return; }

    const unsubU = onSnapshot(
      query(collection(db, 'usuarios'), where('organizacion_id', '==', organizacionId)),
      snap => setUsuarios(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => console.error('ImportarFlota usuarios:', err)
    );
    const unsubC = onSnapshot(
      query(collection(db, 'camiones'), where('organizacion_id', '==', organizacionId)),
      snap => setCamiones(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => console.error('ImportarFlota camiones:', err)
    );

    return () => { unsubU(); unsubC(); };
  }, [organizacionId]);

  /* ── Leer el archivo ────────────────────────────────────────────────────── */

  function leerArchivo(archivo) {
    setErrorArchivo('');
    setResultado(null);
    setNombreArchivo(archivo.name);

    const lector = new FileReader();
    lector.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'binary' });

        const matrizDe = (nombreHoja) => {
          const hoja = wb.Sheets[nombreHoja];
          if (!hoja) return undefined;
          return XLSX.utils.sheet_to_json(hoja, { header: 1, raw: false, defval: '' });
        };

        const interpretado = interpretarPlanilla(
          { choferes: matrizDe('Choferes'), tractores: matrizDe('Tractores'), acoplados: matrizDe('Acoplados') },
          { organizacion_id: organizacionId, usuarios, camiones }
        );

        setResultado(interpretado);
      } catch (err) {
        console.error(err);
        setErrorArchivo('No se pudo leer el archivo. ¿Es la plantilla de flota?');
      }
    };
    lector.readAsBinaryString(archivo);
  }

  const hayFilas = resultado && (
    resultado.choferes.filas.length + resultado.tractores.filas.length + resultado.acoplados.filas.length > 0
  );
  const hayNuevas = resultado && ['choferes', 'tractores', 'acoplados']
    .some(k => resultado[k].filas.some(f => f.estado === 'nueva'));

  /* ── Confirmar: escribir las filas "nueva" ─────────────────────────────── */

  async function confirmar() {
    if (!resultado) return;
    setGuardando(true);

    const nuevasChoferes = resultado.choferes.filas.filter(f => f.estado === 'nueva');
    const nuevasTractores = resultado.tractores.filas.filter(f => f.estado === 'nueva');
    const nuevasAcoplados = resultado.acoplados.filas.filter(f => f.estado === 'nueva');
    const total = nuevasChoferes.length + nuevasTractores.length + nuevasAcoplados.length;

    const creados = { choferes: [], tractores: [], acoplados: [] };
    const fallidos = { choferes: [], tractores: [], acoplados: [] };
    const credencialesNuevas = [];

    setProgreso({ hechos: 0, total, creados, fallidos });

    let hechos = 0;

    // Choferes primero: cada uno es una cuenta de Auth + perfil, y si algo
    // sale mal más vale saberlo antes de tocar unidades.
    for (const fila of nuevasChoferes) {
      try {
        const { clave } = await darDeAltaUsuario({ datos: fila.datos, usuario });
        creados.choferes.push({ numeroFila: fila.numeroFila, nombre: fila.datos.nombre });
        credencialesNuevas.push({ nombre: fila.datos.nombre, dni: fila.datos.dni, clave });
      } catch (err) {
        console.error('Fila', fila.numeroFila, err);
        fallidos.choferes.push({
          numeroFila: fila.numeroFila,
          nombre: fila.datos.nombre,
          motivo: err.fase === 'auth' ? traducirErrorAuth(err) : traducirError(err),
        });
      }
      hechos++;
      setProgreso({ hechos, total, creados: { ...creados }, fallidos: { ...fallidos } });
    }

    for (const [clave, tipo, filasDelTipo] of [
      ['tractores', 'tractor', nuevasTractores],
      ['acoplados', 'acoplado', nuevasAcoplados],
    ]) {
      for (const fila of filasDelTipo) {
        try {
          await crear({
            db,
            coleccion: 'camiones',
            datos: fila.datos,
            accion: `crear_${tipo}`,
            entidadTipo: tipo,
            usuario,
          });
          creados[clave].push({ numeroFila: fila.numeroFila, patente: mostrarPatente(fila.datos.patente) });
        } catch (err) {
          console.error('Fila', fila.numeroFila, err);
          fallidos[clave].push({ numeroFila: fila.numeroFila, patente: mostrarPatente(fila.datos.patente), motivo: traducirError(err) });
        }
        hechos++;
        setProgreso({ hechos, total, creados: { ...creados }, fallidos: { ...fallidos } });
      }
    }

    setCredenciales(credencialesNuevas.length > 0 ? credencialesNuevas : null);
    setCredencialesDescargadas(false);
    setGuardando(false);
  }

  /* ── Credenciales -- se descargan una sola vez, nunca se guardan ───────── */

  function descargarCredenciales() {
    if (!credenciales || credencialesDescargadas) return;

    const wb = XLSX.utils.book_new();
    const filas = [
      ['Nombre', 'DNI', 'Contraseña'],
      ...credenciales.map(c => [c.nombre, c.dni, c.clave]),
    ];
    const hoja = XLSX.utils.aoa_to_sheet(filas);
    XLSX.utils.book_append_sheet(wb, hoja, 'Credenciales');
    XLSX.writeFile(wb, 'credenciales_choferes.xlsx');

    setCredencialesDescargadas(true);
  }

  function volver() {
    if (credenciales && !credencialesDescargadas) {
      const seguir = window.confirm(
        'Todavía no descargaste las contraseñas de los choferes que se crearon. '
        + 'No se guardan en ningún lado: si salís ahora, se pierden para siempre. '
        + '¿Salir igual?'
      );
      if (!seguir) return;
    }
    onVolver();
  }

  function elegirOtroArchivo() {
    setResultado(null);
    setNombreArchivo('');
    setErrorArchivo('');
  }

  /* ── Render ─────────────────────────────────────────────────────────────── */

  return (
    <div style={styles.wrap}>
      <div style={styles.panelHeader}>
        <div style={styles.titulo}>Importar flota desde Excel</div>
        <Boton variante="secundario" onClick={volver}>Volver</Boton>
      </div>

      {/* 1. Admin: elige la organización destino antes de cualquier otra cosa.
          Transportista: ya está fijada, no ve este paso. */}
      {soyAdmin && !organizacionId && (
        <Tarjeta style={{ padding: '1.5rem' }}>
          <div style={styles.seccionTitulo}>Organización destino</div>
          <Campo
            as="select" label="Empresa de transporte *"
            value={organizacionId}
            onChange={e => setOrganizacionId(e.target.value)}
          >
            <option value="">Elegir...</option>
            {orgsElegibles.map(o => <option key={o.id} value={o.id}>{o.razon_social}</option>)}
          </Campo>
          {orgsElegibles.length === 0 && (
            <div style={styles.ayuda}>No hay empresas de transporte activas. Cargá una desde Organizaciones.</div>
          )}
        </Tarjeta>
      )}

      {organizacionId && !progreso && !hayFilas && (
        <>
          {soyAdmin && (
            <div style={styles.orgElegida}>
              Importando para <strong>{(orgsElegibles.find(o => o.id === organizacionId) || {}).razon_social}</strong>
              <button style={styles.btnLink} onClick={() => setOrganizacionId('')}>Cambiar</button>
            </div>
          )}

          {paso === 'descargar' && (
            <Tarjeta style={{ padding: '1.5rem' }}>
              <div style={styles.seccionTitulo}>Paso 1 de 2 — Descargar la planilla</div>
              <div style={styles.instruccion}>
                Descargate esta planilla de Excel y completala con los choferes,
                tractores y acoplados. Cada uno tiene su propia hoja. Se leen las
                filas desde la 5 en adelante.
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                <Boton onClick={generarPlantilla}>Descargar plantilla</Boton>
              </div>
              <div style={styles.aclaracion}>
                Un DNI o una patente que ya estén cargados no dan error: se
                informan como "existentes" y no se tocan. En el próximo paso vas
                a poder revisar el estado de cada fila antes de confirmar nada.
              </div>
              <div style={styles.accionesFila}>
                <Boton onClick={() => setPaso('subir')}>Ya la completé, continuar</Boton>
              </div>
            </Tarjeta>
          )}

          {paso === 'subir' && (
            <Tarjeta style={{ padding: '1.5rem' }}>
              <div style={styles.seccionTitulo}>Paso 2 de 2 — Subir la planilla completa</div>
              <div style={styles.instruccion}>
                Elegí el archivo que acabás de completar. Antes de crear nada vas
                a poder revisar cómo se interpretó cada fila.
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                <label style={styles.btnPrimaryLabel}>
                  Elegir archivo
                  <input
                    type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
                    onChange={e => e.target.files[0] && leerArchivo(e.target.files[0])}
                  />
                </label>
                <Boton variante="secundario" onClick={() => setPaso('descargar')}>Volver al paso 1</Boton>
              </div>
              {errorArchivo && <div style={styles.bannerError}>{errorArchivo}</div>}
            </Tarjeta>
          )}
        </>
      )}

      {resultado && hayFilas && !progreso && (
        <>
          <div style={styles.resumenMasiva}>
            <span><strong>{nombreArchivo}</strong></span>
            <button style={styles.btnLink} onClick={elegirOtroArchivo}>Elegir otro archivo</button>
          </div>

          {(resultado.choferes.error || resultado.tractores.error || resultado.acoplados.error) && (
            <div style={styles.bannerError}>
              {resultado.choferes.error && <div>Choferes: {resultado.choferes.error}</div>}
              {resultado.tractores.error && <div>Tractores: {resultado.tractores.error}</div>}
              {resultado.acoplados.error && <div>Acoplados: {resultado.acoplados.error}</div>}
            </div>
          )}

          <HojaPreview titulo="Choferes" filas={resultado.choferes.filas} renderDato={f => f.datos.nombre} renderSub={f => `DNI ${f.datos.dni}`} />
          <HojaPreview titulo="Tractores" filas={resultado.tractores.filas} renderDato={f => mostrarPatente(f.datos.patente)} />
          <HojaPreview titulo="Acoplados" filas={resultado.acoplados.filas} renderDato={f => mostrarPatente(f.datos.patente)} />

          <div style={{ ...styles.accionesFila, marginTop: 16 }}>
            <Boton disabled={guardando || !hayNuevas} onClick={confirmar}>
              {guardando ? 'Importando...' : `Confirmar ${['choferes', 'tractores', 'acoplados'].reduce((n, k) => n + resultado[k].filas.filter(f => f.estado === 'nueva').length, 0)} fila(s) nueva(s)`}
            </Boton>
            <Boton variante="secundario" disabled={guardando} onClick={volver}>Cancelar</Boton>
          </div>
          {!hayNuevas && <div style={styles.ayuda}>No hay ninguna fila nueva para cargar.</div>}
        </>
      )}

      {progreso && (
        <Tarjeta style={{ padding: '1.5rem' }}>
          <div style={styles.seccionTitulo}>
            {progreso.hechos < progreso.total ? `Importando... ${progreso.hechos}/${progreso.total}` : 'Importación terminada'}
          </div>

          {progreso.hechos === progreso.total && (
            <>
              <ResumenTipo etiqueta="Choferes" creados={progreso.creados.choferes} fallidos={progreso.fallidos.choferes} campo="nombre" />
              <ResumenTipo etiqueta="Tractores" creados={progreso.creados.tractores} fallidos={progreso.fallidos.tractores} campo="patente" />
              <ResumenTipo etiqueta="Acoplados" creados={progreso.creados.acoplados} fallidos={progreso.fallidos.acoplados} campo="patente" />

              {credenciales && (
                <div style={styles.bannerAviso}>
                  <div style={{ marginBottom: 8 }}>
                    Se {credenciales.length > 1 ? 'crearon' : 'creó'} {credenciales.length} cuenta(s) de chofer nueva(s).
                    Descargá las contraseñas ahora: no se guardan en ningún lado
                    y no se pueden volver a ver.
                  </div>
                  <Boton disabled={credencialesDescargadas} onClick={descargarCredenciales}>
                    {credencialesDescargadas ? 'Ya descargadas' : 'Descargar credenciales'}
                  </Boton>
                  {credencialesDescargadas && (
                    <div style={{ ...styles.ayuda, marginTop: 6 }}>
                      Las contraseñas ya se descargaron y no se guardan en ningún lado.
                    </div>
                  )}
                </div>
              )}

              <div style={{ ...styles.accionesFila, marginTop: 16 }}>
                <Boton variante="secundario" onClick={volver}>Listo</Boton>
              </div>
            </>
          )}
        </Tarjeta>
      )}
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Subcomponentes de presentación
 * -------------------------------------------------------------------------- */

function HojaPreview({ titulo, filas, renderDato, renderSub }) {
  const styles = useEstilos();
  if (filas.length === 0) return null;

  const conteos = filas.reduce((c, f) => { c[f.estado] = (c[f.estado] || 0) + 1; return c; }, {});

  return (
    <Tarjeta style={{ padding: '10px 14px', marginBottom: 10 }}>
      <div style={styles.hojaHeader}>
        <span style={styles.hojaTitulo}>{titulo}</span>
        <span style={styles.hojaConteo}>
          {conteos.nueva || 0} nueva(s) · {conteos.existente || 0} existente(s) · {conteos.error || 0} con error
        </span>
      </div>
      {filas.map(f => {
        const et = ETIQUETA_ESTADO[f.estado];
        return (
          <div key={f.numeroFila} style={styles.filaPreview}>
            <span style={styles.filaNumero}>Fila {f.numeroFila}</span>
            <span style={styles.filaDato}>{renderDato(f)}</span>
            {renderSub && <span style={styles.filaSub}>{renderSub(f)}</span>}
            <Pastilla chico colores={{ bg: et.bg, color: et.color }}>{et.texto}</Pastilla>
            {f.errores.length > 0 && (
              <ul style={styles.erroresLista}>{f.errores.map((e, i) => <li key={i}>{e}</li>)}</ul>
            )}
          </div>
        );
      })}
    </Tarjeta>
  );
}

function ResumenTipo({ etiqueta, creados, fallidos, campo }) {
  const styles = useEstilos();
  if (creados.length === 0 && fallidos.length === 0) return null;

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={styles.resumenTipoTitulo}>{etiqueta}: {creados.length} creado(s){fallidos.length > 0 ? `, ${fallidos.length} con error` : ''}</div>
      {creados.map(c => <div key={c.numeroFila} style={styles.resultadoItem}>Fila {c.numeroFila} → {c[campo]} creado</div>)}
      {fallidos.map(f => <div key={f.numeroFila} style={{ ...styles.resultadoItem, color: colorEstado.peligroTexto }}>Fila {f.numeroFila} → {f[campo]}: {f.motivo}</div>)}
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Auxiliares
 * -------------------------------------------------------------------------- */

function traducirError(err) {
  if (err && err.code === 'permission-denied') {
    return 'Firestore rechazó la escritura. Revisá la consola del navegador.';
  }
  return (err && err.message) || 'Error desconocido.';
}

/* -----------------------------------------------------------------------------
 * Estilos -- crearEstilos(colores, oscuro) + useEstilos(), mismo patrón que
 * el resto de las pantallas migradas.
 * -------------------------------------------------------------------------- */

function crearEstilos(colores) {
  return {
    wrap: { maxWidth: 900, margin: '0 auto', padding: '1.5rem 1rem', background: colores.fondo, color: colores.texto },
    panelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' },
    titulo: { fontSize: 18, fontWeight: 500, color: colores.texto },

    seccionTitulo: { fontSize: 12, fontWeight: tipografia.peso.medio, color: colores.textoTenue, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 },
    instruccion: { fontSize: 13, color: colores.textoSecundario, lineHeight: 1.5, marginBottom: 12 },
    aclaracion: { fontSize: 12, color: colores.textoTenue, lineHeight: 1.5, marginTop: 10, marginBottom: 10 },
    ayuda: { fontSize: 12, color: colores.textoTenue, lineHeight: 1.4 },
    accionesFila: { display: 'flex', gap: 8 },

    btnPrimaryLabel: {
      display: 'inline-flex', alignItems: 'center', padding: '8px 16px', borderRadius: 8,
      background: colores.superficie, border: `0.5px solid ${colores.borde}`, color: colores.textoSecundario,
      fontSize: tipografia.tamano.lg, fontFamily: tipografia.familia, cursor: 'pointer',
    },
    btnLink: { background: 'none', border: 'none', color: colorEstado.acentoAzul, fontSize: 12, cursor: 'pointer', textDecoration: 'underline', padding: 0 },

    orgElegida: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: colores.textoSecundario, marginBottom: 12 },

    resumenMasiva: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 13, color: colores.textoSecundario, marginBottom: 12, flexWrap: 'wrap' },

    hojaHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 6 },
    hojaTitulo: { fontSize: 13, fontWeight: tipografia.peso.medio, color: colores.texto },
    hojaConteo: { fontSize: 11, color: colores.textoTenue },

    filaPreview: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 0', borderTop: `0.5px solid ${colores.borde}` },
    filaNumero: { fontSize: 11, color: colores.textoTenue, flexShrink: 0, minWidth: 50 },
    filaDato: { fontSize: 13, color: colores.texto, fontWeight: tipografia.peso.medio },
    filaSub: { fontSize: 12, color: colores.textoTenue },

    erroresLista: { flexBasis: '100%', margin: '4px 0 0', paddingLeft: 18, fontSize: 12, color: colorEstado.peligroTexto },

    resumenTipoTitulo: { fontSize: 12, fontWeight: tipografia.peso.medio, color: colores.texto, marginBottom: 4 },
    resultadoItem: { fontSize: 12, color: colores.textoSecundario, paddingLeft: 8 },

    bannerAviso: { padding: '10px 14px', borderRadius: 8, background: colorEstado.advertenciaFondo, border: `0.5px solid ${colorEstado.advertenciaBorde}`, fontSize: 13, color: colorEstado.advertenciaTexto, marginTop: 12, marginBottom: 4, lineHeight: 1.5 },
    bannerError: { padding: '10px 14px', borderRadius: 8, background: colorEstado.peligroFondo, border: `0.5px solid ${colorEstado.peligroBordeAlterno}`, fontSize: 13, color: colorEstado.peligroTexto, marginBottom: 12, whiteSpace: 'pre-line' },
  };
}

function useEstilos() {
  const { colores, oscuro } = useTema();
  return useMemo(() => crearEstilos(colores, oscuro), [colores, oscuro]);
}
