/* =============================================================================
 * datos-domicilios.js — Los 34 domicilios y sus vínculos
 * =============================================================================
 *
 * Resultado del relevamiento de los 215 pedidos y de la revisión manual
 * (ver MAPA_DOMICILIOS.md).
 *
 * QUE ES
 *   El insumo para la CARGA INICIAL de `domicilios` y `organizacion_domicilios`
 *   en el modelo nuevo. No es una migración: los pedidos viejos se quedan donde
 *   están y estos domicilios se crean desde cero.
 *
 * CADA ENTRADA TRAE
 *   - Los campos ya normalizados y corregidos (erratas de localidad, el 514 de
 *     PAE que era 574, las comas decimales que el parser partía en dos).
 *   - `organizaciones`: qué organizaciones ofrecen esta dirección al cargarles
 *     un pedido. Es lo que va a `organizacion_domicilios`.
 *   - `variantes`: todas las formas en que la dirección aparece escrita hoy.
 *     Quedan como DOCUMENTACION de por qué se fusionaron. Sin ellas, en seis
 *     meses nadie sabe por qué "Manual Alberti" y "Manuel Alberti" son el
 *     mismo lugar.
 *
 * LOS IDS SON AUTOGENERADOS
 *   El script de carga no deriva el ID de la dirección: usa `claveDomicilio`
 *   de `mapa-normalizacion.js` como campo `clave_normalizada` para saber si el
 *   domicilio ya existe. Un ID derivado de la calle obligaría a migrar
 *   referencias cada vez que se corrige una dirección.
 *
 * LOS DOMICILIOS NO TIENEN TIPO
 *   Una dirección es un punto de entrega posible; que además sea planta o
 *   depósito no cambia nada operativamente.
 * ========================================================================== */

const DOMICILIOS = [
  {
    calle: 'Río Primero', numero: '155',
    ciudad: 'General Rodríguez', provincia: 'Buenos Aires', cp: 'B1748',
    organizaciones: [{ org: 'PRO CROP', principal: true }],
    variantes: [
      'RIO PRIMERO, 155, GENERAL RODRIGUEZ, BUENOS AIRES, B1748',
      'RIO PRIMERO 155, GENERAL RODRIGUEZ, BUENOS AIRES, B1748',
      'Rio Primero 155, GENERAL RODRIGUEZ, BUENOS AIRES, B1748',
      'Rio Primero , 155, GRAL RODRIGUEZ, BUENOS AIRES, B1748',
      'RIO PRIMERO, 155, GRAL.RODRIGUEZ, BUENOS AIRES, B1748',
      'Rio Primero , 155, General Rodriguez, Buenos Aires, 1748',
    ],
    // Barcan Química usó esta dirección en 2 pedidos. NO se le crea vínculo:
    // si necesita una dirección propia, se da de alta desde el ABM.
  },
  {
    calle: 'Cam. Real Presbítero González y Aragón', numero: null,
    ciudad: 'Carlos Spegazzini', provincia: 'Buenos Aires', cp: 'B1812EIE',
    organizaciones: [{ org: 'CHEMOTECNICA S.A.', principal: true }],
    variantes: ['Cam. Real Presbítero González y Aragón, CARLOS SPEGAZZINI, BUENO AIRES, B1812EIE'],
  },
  {
    // La planta de Explora. Destino de los pedidos "Retiro del cliente".
    // Aparece en 18 pedidos de 8 clientes distintos, pero el vínculo es
    // solo con Explora: no es la dirección de ninguno de ellos.
    calle: 'Yrigoyen', numero: '2933',
    ciudad: 'Puerto General San Martín', provincia: 'Santa Fe', cp: 'S2200HWA',
    organizaciones: [{ org: 'EXPLORA S.A.', principal: true, alias: 'Complejo Industrial PGSM' }],
    variantes: [
      'YRIGOYEN, 2933, PUERTO GRAL.SAN MARTIN, SANTA FE, S2200HWA',
      'YRIGOYEN, 2933, PUERTO SAN MARTIN, SANTA FE, S2200HWA',
      'YRIGOYEN, 2933, PUERTO GENERAL SAN MARTIN, SANTA FE, S2200HWA',
      'Yrigoyen 2933,, 2933, Puerto Gral. San Martin, , Santa Fe , 2200',
      'Yrigoyen 2933, , 2933, Puerto general San martin, santa fe, S2200H',
      'Yrigoyen, 2933, Puerto Gral San Martin , Santa Fe',
      'Yrigoyen , 2933, Puerto gral san martin, santa fe',
      'Explora S.A. — Complejo Industrial PGSM, Puerto General San Martín, Santa Fe',
    ],
  },
  {
    calle: 'Iraola', numero: '850',
    ciudad: 'Venado Tuerto', provincia: 'Santa Fe', cp: '2600',
    organizaciones: [{ org: 'PEYTE', principal: true }],
    variantes: [
      'IRAOLA, 850, VENADO TUERTO, SANTA FE, 2600',
      'Iraola, 850, Venado Tuerto, Santa Fe, 2600',
    ],
  },
  {
    // El 514 está mal. PAE está en el 574, confirmado.
    calle: 'Av. Emilio Mitre', numero: '574',
    ciudad: 'Campana', provincia: 'Buenos Aires', cp: 'B2804',
    organizaciones: [{ org: 'PAN AMERICAN ENERGY', principal: true }],
    variantes: [
      'Emilio Mitre, 514, Campana, Buenos Aires, 2804',
      'Emilio Mitre , 574, Campana, Buenos Aires, 2804',
      'AV .ING MITRE , 574, CAMPANA, BS AS , B2804',
    ],
  },
  {
    calle: 'Manuel Alberti', numero: '1780',
    ciudad: 'Dock Sud', provincia: 'Buenos Aires', cp: '1871',
    organizaciones: [{ org: 'EXOLGAN', principal: true }],
    variantes: [
      'Manuel Alberti 1780, 1780, Dock Sud, Buenos Aires, 1871',
      'Manual Alberti, 1780, Dock Sud, Buenos Aires, 1871',
    ],
  },
  {
    calle: 'Ruta 14', numero: 'KM 55,5',
    ciudad: 'Gualeguaychú', provincia: 'Entre Ríos', cp: '2823',
    organizaciones: [{ org: 'RAINBOW AGROSCIENCES S.A.', principal: true }],
    variantes: ['RUTA 14 , KM 55,5, GUALEGUAYCHÚ, ENTRE RIOS, 2823'],
  },
  {
    calle: 'Ruta Nacional 34', numero: 'KM 130',
    ciudad: 'Cañada de Rosquín', provincia: 'Santa Fe', cp: null,
    organizaciones: [{ org: 'LARUSO', principal: true }],
    variantes: ['Ruta nacional 34, KM 130, CAÑADA DE ROSQUIN, SANTA FE'],
  },
  {
    calle: 'Ruta 10', numero: 'KM 0,5',
    ciudad: 'San Lorenzo', provincia: 'Santa Fe', cp: 'S2200',
    organizaciones: [{ org: 'FORMULAGRO', principal: true }],
    variantes: ['en Ruta 10 km 0,5, SAN LORENZO, SANTA FE, S2200'],
  },
  {
    calle: 'Ruta 16', numero: 'KM 25',
    ciudad: 'Puerto Tirol', provincia: 'Chaco', cp: '3505',
    organizaciones: [{ org: 'ALLTEC S.A.', principal: true }],
    variantes: [
      'RUTA 16, KM 25, PUERTO TIROL, CHACO, 3505',
      'Ruta 16, KM 25, Puerto Tirol, Chaco, 3505',
    ],
  },
  {
    calle: 'Gelly y Obes', numero: '1680',
    ciudad: 'Benavídez', provincia: 'Buenos Aires', cp: 'B1621',
    organizaciones: [{ org: 'ANDREANI', principal: true }],
    variantes: ['Gelly y Obes , 1680, Benavidez, Buenos Aires, B1621'],
  },
  {
    calle: 'Ruta Provincial 29', numero: 'KM 4,5',
    ciudad: 'Brandsen', provincia: 'Buenos Aires', cp: 'B1980',
    organizaciones: [{ org: 'PRO CROP' }],
    variantes: [
      'RP29 KM 4.5, BRANDSEN, BUENOS AIRES, B1980',
      'RUTA 29, KM 4,5, BRANDSEN, BUENOS AIRES, B1980',
    ],
  },
  {
    calle: 'Calle Pública', numero: '7156',
    ciudad: 'Barrio Aeropuerto, Córdoba', provincia: 'Córdoba', cp: 'X5019',
    organizaciones: [{ org: 'PRO CROP' }],
    variantes: [
      'CALLE PUBLICA, 7156, BARRIO AEROPUERTO, CORDOBA, X5019',
      'CALLE PUBLICA 7156, AEROPUERTO, CORDOBA, X5019',
    ],
  },
  {
    calle: 'Ruta 205', numero: 'KM 186,5',
    ciudad: 'Saladillo', provincia: 'Buenos Aires', cp: 'B7260',
    organizaciones: [{ org: 'BAYA CASAL S.A.', principal: true }],
    variantes: ['RUTA 205 , , Km.186,5, SALADILLO, BUENOS AIRES, B7260'],
  },
  {
    calle: 'Ruta Provincial 41', numero: 'KM 169',
    ciudad: 'Lobos', provincia: 'Buenos Aires', cp: 'B7240',
    organizaciones: [{ org: 'DARUMA AGRO S.R.L.', principal: true }],
    variantes: ['RP Nº 41 , KM 169, LOBOS, BUENOS AIRES, B7240'],
  },
  {
    calle: 'Río de Rey e/ Río Pinto y Río Potrero', numero: null,
    ciudad: 'General Rodríguez', provincia: 'Buenos Aires', cp: null,
    organizaciones: [{ org: 'REOPEN', principal: true }],
    variantes: ['RIO DE REY E/ RIO PINTO Y RIO POTRERO, GENERAL RODRIGUEZ, BUENOS AIRES'],
  },
  {
    calle: 'Ing. Guillermo Marconi', numero: '657',
    ciudad: 'Carlos Spegazzini', provincia: 'Buenos Aires', cp: '1812',
    organizaciones: [{ org: 'CAGSA', principal: true }],
    variantes: ['ING.GUILLERMO MARCONI, 657, CARLOS SPEGAZZINI, BUENOS AIRES, 1812'],
  },
  {
    calle: 'Ruta 19', numero: 'KM 283,5',
    ciudad: 'Río Primero', provincia: 'Córdoba', cp: 'X5227',
    organizaciones: [{ org: 'AKTIV', principal: true }],
    variantes: ['RUTA Nº 19, KM 283,5, RIO PRIMERO, CORDOBA, X5227'],
  },
  {
    calle: 'Av. Juan Domingo Perón', numero: '4734',
    ciudad: 'Benavídez', provincia: 'Buenos Aires', cp: '1621',
    organizaciones: [{ org: 'ANDREANI' }],
    variantes: ['Av Juan Domingo Perón , 4734, Benabidez, Buenos Aires, 1621'],
  },
  {
    calle: 'Avda. Dr. Arturo Frondizi', numero: '1150',
    ciudad: 'Pergamino', provincia: 'Buenos Aires', cp: 'B2700',
    organizaciones: [{ org: 'RIZOBACTER', principal: true }],
    variantes: ['Avda. Dr. Arturo Frondizi, 1150, PERGAMINO, BS. AS., B2700'],
  },
  {
    calle: 'Ruta 188', numero: 'KM 188',
    ciudad: 'Rojas', provincia: 'Buenos Aires', cp: '2705',
    organizaciones: [{ org: 'LABORATORIO DEGSER', principal: true }],
    variantes: ['Ruta 188, km 188, Rojas , Buenos Aires, 2705'],
  },
  {
    calle: 'Ruta 188', numero: 'KM 80,5',
    ciudad: 'Pergamino', provincia: 'Buenos Aires', cp: 'B2700',
    organizaciones: [{ org: 'PALAVERSICH Y CIA S.A.C.', principal: true }],
    variantes: ['Ruta 188 Km 80,5 , PERGAMINO, BUENOS AIRES, B2700'],
  },
  {
    // El "$" del original es un "4". Confirmado: dirección real de SENASA.
    calle: '4 de Enero', numero: '981',
    ciudad: 'Santa Fe', provincia: 'Santa Fe', cp: '3000',
    organizaciones: [{ org: 'SENASA', principal: true }],
    variantes: ['$ de Enero, 981, Santa Fe, Santa Fe, 3000'],
  },
  {
    calle: 'Acceso Parque Industrial Arturo Frondizi', numero: null,
    ciudad: 'América - Rivadavia', provincia: 'Buenos Aires', cp: 'B6237',
    organizaciones: [{ org: 'MOLISOLES S.R.L.', principal: true }],
    variantes: ['Acceso parque Industrial Arturo Frondizi , AMERICA - RIVADAVIA, BUENOS AIRES, B6237'],
  },
  {
    calle: 'Mosconi', numero: '3898',
    ciudad: 'San Lorenzo', provincia: 'Santa Fe', cp: '2200',
    organizaciones: [{ org: 'PAN AMERICAN ENERGY' }],
    variantes: ['MOSCONI, 3898, San Lorenzo, SANTA FE, 2200'],
  },
  {
    calle: 'Ruta 11', numero: 'KM 455',
    ciudad: 'Sauce Viejo', provincia: 'Santa Fe', cp: '3017',
    organizaciones: [{ org: 'PB LEINER', principal: true }],
    variantes: ['Ruta 11, km 455, Sauce Viejo, Santa Fe, 3017'],
  },
  {
    calle: 'RP17 y RP10', numero: null,
    ciudad: 'La Puerta', provincia: 'Córdoba', cp: 'X5137',
    organizaciones: [{ org: 'LANTHER', principal: true }],
    variantes: [
      'Ruta Provincial , 17&18, La Puerta, Cordoba, 5137',
      'RP17 & RP10,, LA PUERTA, CORDOBA, X5137',
    ],
  },
  {
    // Código Plus de Google, sin dirección de calle. Se migra tal cual.
    calle: '44R9+HH', numero: null,
    ciudad: 'Roldán', provincia: 'Santa Fe', cp: '2134',
    organizaciones: [{ org: 'FERTILIZANTES FULLTEC S.R.L.', principal: true }],
    variantes: ['44R9+HH, ROLDAN, SANTA FE, 2134'],
  },
  {
    calle: 'Ruta Provincial 19', numero: 'KM 1,9',
    ciudad: 'Río Cuarto', provincia: 'Córdoba', cp: 'X5800',
    organizaciones: [{ org: 'BIOELECTRICA', principal: true }],
    variantes: ['Ruta Provincial N° 19 km,  1,9, rio cuarto, Cordoba, X5800'],
  },
  {
    // Código Plus como número. Se migra tal cual.
    calle: 'Brazo Largo', numero: '4429+MH',
    ciudad: 'Villa Paranacito', provincia: 'Entre Ríos', cp: null,
    organizaciones: [{ org: 'SETI', principal: true }],
    variantes: ['Brazo Largo, 4429+MH, villa parancito, Entrerios'],
  },
  {
    calle: 'Alvarado s/nro. lote 4b0', numero: null,
    ciudad: 'Fighiera', provincia: 'Santa Fe', cp: 'S2126',
    organizaciones: [{ org: 'ARANAMI INDUSTRIAL', principal: true }],
    variantes: ['Alvarado s/nro. lote 4b0,, FIGHIERA, SANTA FE, S2126'],
  },
  {
    calle: 'Calle 1910 - Parque Industrial Park Empresario, lote 12 s/n', numero: null,
    ciudad: 'Rosario', provincia: 'Santa Fe', cp: 'S2000',
    organizaciones: [{ org: 'ECOFERTIL', principal: true }],
    variantes: ['CALLE 1910 - PARQUE INDUSTRIAL PARK EMPRESARIO, LOTE 12 S/N, ROSARIO, SANTA FE, S2000'],
  },
  {
    calle: 'Paraná', numero: '57',
    ciudad: 'Las Varillas', provincia: 'Córdoba', cp: 'X5940',
    organizaciones: [{ org: 'SERV QUIM', principal: true }],
    variantes: ['PARANÁ, 57, LAS VARILLAS, CÓRDOBA, X5940'],
  },
  {
    calle: 'Jorge Stephenson', numero: '3213',
    ciudad: 'Malvinas Argentinas', provincia: 'Buenos Aires', cp: 'B1667',
    organizaciones: [{ org: 'EL TOBIANO', principal: true }],
    variantes: ['Jorge Stephenson, 3213, Área de Promoción Industrial el Triángulo de Malvinas Argentinas, BUENOS AIRES, B1667'],
  },
];

/* -----------------------------------------------------------------------------
 * Direcciones que NO se migran — pertenecen a los usuarios de prueba
 * -------------------------------------------------------------------------- */

const DIRECCIONES_PRUEBA = [
  '9 de Julio, 1450, Rosario, Santa Fe, 2000',
  'Iriondo, 1729, Rosario, Santa Fe, 2000',
  'Parravicini, 9125, Rosario, Santa Fe, 2000',
  'Av. Libertador, 1200, Rosario, Santa Fe, 2000',
  'Bv Rondou, 196, Rosario, Santa Fe, 2000',
  'Entre Rios, 402, San Lorenzo, Santa Fe, 2000',
  'Soberanía Nacional, 2550, Puerto General San Martin, Santa Fe, 2231',
  'Lisandro de la Torre, 774, Timbues, Santa Fe, 2300',
  'rr, 77, jj, hh, 8888',
  'rr, 111, ww, ss, 3333',
];

/**
 * Cuenta los vínculos organización↔domicilio que se van a crear.
 *
 * Existe porque el número anduvo dando distinto según dónde se lo contara: el
 * cuadro de MAPA_DOMICILIOS.md decía 36, la tabla de ese mismo documento daba
 * 35, y este archivo genera otro. Se calcula, no se transcribe.
 *
 * @returns {{domicilios: number, vinculos: number, sinVinculo: string[]}}
 */
function contarVinculos() {
  let vinculos = 0;
  const sinVinculo = [];

  DOMICILIOS.forEach((d, i) => {
    const n = (d.organizaciones || []).length;
    vinculos += n;
    if (n === 0) sinVinculo.push(`#${i + 1} ${d.calle} ${d.numero || ''}`.trim());
  });

  return { domicilios: DOMICILIOS.length, vinculos, sinVinculo };
}

module.exports = { DOMICILIOS, DIRECCIONES_PRUEBA, contarVinculos };
