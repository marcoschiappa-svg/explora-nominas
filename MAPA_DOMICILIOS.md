# Mapa de domicilios — carga inicial

Resultado del relevamiento de los 215 pedidos (21/08/2026) y de la revisión manual.

> **No es una migración.** Los pedidos viejos se quedan en `pedidos_portal`; estos 34 domicilios se crean desde cero en el modelo nuevo. El relevamiento sirve para no volver a cargar 50 direcciones donde hay 34 lugares.

> Los domicilios no tienen tipo. Una dirección es un punto de entrega posible; que además sea planta o depósito no cambia nada operativamente.

| | |
| --- | --- |
| Direcciones distintas relevadas | 50 |
| Se fusionan (misma dirección, escritura distinta) | 6 |
| No se cargan (datos de prueba) | 10 |
| **Domicilios a crear** | **34** |
| **Vínculos organización↔domicilio a crear** | **34** |
| Organizaciones con al menos un domicilio | 30 |

Ninguna dirección quedó sin parsear.

> El número de vínculos anduvo dando distinto según dónde se lo contara —este cuadro llegó a decir 36 y la tabla de la sección 3 daba 35—. Ahora **se calcula, no se transcribe**: `contarVinculos()` en `datos-domicilios.js` es la fuente. Da 34 porque a Barcan no se le crea vínculo (ver sección 5, punto 3).

---

## Cómo se asigna el vínculo

`organizacion_domicilios` responde a **"qué domicilios tiene esta organización"** — lo que el portal ofrece cuando se carga un pedido para ese cliente.

No es lo mismo que el destino de un pedido. La planta de Explora es el destino de 18 pedidos de 8 clientes distintos, pero **no está en la lista de ninguno de ellos**: es de Explora. Esos pedidos apuntan al domicilio desde `pedido.destino_domicilio_id`, sin vínculo de por medio.

El vínculo se crea cuando la organización **usa esa dirección**: es una de las opciones que aparecen al cargarle un pedido. No importa si físicamente es una planta, un depósito o un galpón alquilado — es un punto de entrega posible y con eso alcanza.

---

## 1 — Fusiones

Seis grupos que el agrupador automático no juntó, y por qué.

### 1.1 · La planta de Explora — 18 usos

```
16 x  YRIGOYEN, 2933, PUERTO GRAL.SAN MARTIN, SANTA FE, S2200HWA
      (escrita de 7 formas: PUERTO SAN MARTIN / PUERTO GENERAL SAN MARTIN,
       CP S2200HWA / 2200 / S2200H / sin CP)

 2 x  Explora S.A. — Complejo Industrial PGSM, Puerto General San Martín, Santa Fe
```

El agrupador compara calle + ciudad. `"Explora S.A. — Complejo Industrial PGSM"` no se parece a `"YRIGOYEN"` porque una es un nombre y la otra una calle.

**Canónico:** Yrigoyen 2933, Puerto General San Martín, Santa Fe, S2200HWA
**Vínculo:** EXPLORA · alias "Complejo Industrial PGSM" · principal

Organizaciones que la usan como destino, **sin vínculo**: METHIL GROUP, CDM, SINER, AGROVA, TECNICA QUIMICA ARGENTINA, MAPEI, ALIANZA NUTRIENTE, OCTA RENEWABLES.

### 1.2 · PAE Campana — 15 usos

```
 7 x  Emilio Mitre, 514, Campana, Buenos Aires, 2804      ← número equivocado
 7 x  Emilio Mitre , 574, Campana, Buenos Aires, 2804
 1 x  AV .ING MITRE , 574, CAMPANA, BS AS , B2804
```

El 514 está mal: confirmado que PAE está en el 574. El tercero es la misma calle escrita como "Av. Ing. Mitre".

**Canónico:** Av. Emilio Mitre 574, Campana, Buenos Aires, B2804
**Vínculo:** PAN AMERICAN ENERGY · principal

### 1.3 · Exolgan Dock Sud — 12 usos

```
11 x  Manuel Alberti 1780, 1780, Dock Sud, Buenos Aires, 1871
 1 x  Manual Alberti, 1780, Dock Sud, Buenos Aires, 1871   ← "Manual" por "Manuel"
```

**Canónico:** Manuel Alberti 1780, Dock Sud, Buenos Aires, 1871
**Vínculo:** EXOLGAN · principal

### 1.4 · Pro Crop Córdoba — 3 usos

```
 2 x  CALLE PUBLICA, 7156, BARRIO AEROPUERTO, CORDOBA, X5019
 1 x  CALLE PUBLICA 7156, AEROPUERTO, CORDOBA, X5019
```

**Canónico:** Calle Pública 7156, Barrio Aeropuerto, Córdoba, X5019
**Vínculo:** PRO CROP

### 1.5 · Pro Crop Brandsen — 3 usos

```
 2 x  RP29 KM 4.5, BRANDSEN, BUENOS AIRES, B1980
 1 x  RUTA 29, KM 4,5, BRANDSEN, BUENOS AIRES, B1980
```

**Canónico:** Ruta Provincial 29 KM 4,5, Brandsen, Buenos Aires, B1980
**Vínculo:** PRO CROP

### 1.6 · Lanther La Puerta — 2 usos ⚠ CONFIRMAR

```
 1 x  Ruta Provincial , 17&18, La Puerta, Cordoba, 5137
 1 x  RP17 & RP10,, LA PUERTA, CORDOBA, X5137
```

Misma ciudad, mismo CP, mismo cliente. Pero **una dice `17&18` y la otra `RP17 & RP10`**. Puede ser la misma intersección mal escrita, o dos cruces distintos.

**Propuesta:** fusionar como "RP17 y RP10, La Puerta, Córdoba, X5137".
**Vínculo:** LANTHER

---

## 2 — Correcciones de datos

Errores de carga que se corrigen al cargar el domicilio nuevo. El pedido viejo queda como está.

| Como está guardado | Corregido | Motivo |
| --- | --- | --- |
| `Emilio Mitre, 514` | Av. Emilio Mitre **574** | Confirmado, PAE está en el 574 |
| `Manual Alberti` | **Manuel** Alberti | Errata |
| `Benabidez` | **Benavídez** | Errata en la localidad |
| `villa parancito` | Villa **Paranacito** | Errata en la localidad (Entre Ríos) |
| `rio cuarto` | **Río Cuarto** | Sin acento ni mayúsculas |
| `$ de Enero, 981` | **4** de Enero 981 | ⚠ El `$` es casi seguro un `4`, pero **confirmar**: es la dirección de SENASA en Santa Fe |

### Direcciones rurales con coma decimal

El parser corta en la coma de los decimales. Se corrigen a mano:

| Como quedó | Corregido |
| --- | --- |
| `RUTA 14` + `KM 55 5` | Ruta 14 KM 55,5 |
| `en Ruta 10 km 0` + `5` | Ruta 10 KM 0,5 *(se saca el "en")* |
| `RUTA 205` + `Km.186 5` | Ruta 205 KM 186,5 |
| `RUTA Nº 19` + `KM 283 5` | Ruta 19 KM 283,5 |
| `Ruta 188` + `Km 80 5` | Ruta 188 KM 80,5 |
| `Ruta Provincial N° 19 km 1` + `9` | Ruta Provincial 19 KM 1,9 |
| `RUTA 29` + `KM 4 5` | Ruta 29 KM 4,5 |

### Direcciones sin calle

Dos usan códigos Plus de Google en vez de una dirección:

```
"44R9+HH, ROLDAN, SANTA FE, 2134"           — FERTILIZANTES FULLTEC
"Brazo Largo, 4429+MH, villa parancito"     — SETI
```

Se cargan como están, con el código en `calle`, y con `verificado: false` para que queden en la cola de revisión del ABM hasta que se sepa la dirección real.

---

## 3 — Los 34 domicilios

Ordenados por uso.

| # | Dirección | Ciudad | Prov. | CP | Organización |
| --- | --- | --- | --- | --- | --- |
| 1 | Río Primero 155 | General Rodríguez | BA | B1748 | PRO CROP |
| | | | | | BARCAN QUIMICA |
| 2 | Cam. Real Presbítero González y Aragón | Carlos Spegazzini | BA | B1812EIE | CHEMOTECNICA |
| 3 | Yrigoyen 2933 | Puerto Gral. San Martín | SF | S2200HWA | **EXPLORA** |
| 4 | Iraola 850 | Venado Tuerto | SF | 2600 | PEYTE |
| 5 | Av. Emilio Mitre 574 | Campana | BA | B2804 | PAN AMERICAN ENERGY |
| 6 | Manuel Alberti 1780 | Dock Sud | BA | 1871 | EXOLGAN |
| 7 | Ruta 14 KM 55,5 | Gualeguaychú | ER | 2823 | RAINBOW AGROSCIENCES |
| 8 | Ruta Nacional 34 KM 130 | Cañada de Rosquín | SF | — | LARUSO |
| 9 | Ruta 10 KM 0,5 | San Lorenzo | SF | S2200 | FORMULAGRO |
| 10 | Ruta 16 KM 25 | Puerto Tirol | Chaco | 3505 | ALLTEC |
| 11 | Gelly y Obes 1680 | Benavídez | BA | B1621 | ANDREANI |
| 12 | Ruta Provincial 29 KM 4,5 | Brandsen | BA | B1980 | PRO CROP |
| 13 | Calle Pública 7156 | Barrio Aeropuerto, Córdoba | Cba | X5019 | PRO CROP |
| 14 | Ruta 205 KM 186,5 | Saladillo | BA | B7260 | BAYA CASAL |
| 15 | Ruta Provincial 41 KM 169 | Lobos | BA | B7240 | DARUMA AGRO |
| 16 | Río de Rey e/ Río Pinto y Río Potrero | General Rodríguez | BA | — | REOPEN |
| 17 | Ing. Guillermo Marconi 657 | Carlos Spegazzini | BA | 1812 | CAGSA |
| 18 | Ruta 19 KM 283,5 | Río Primero | Cba | X5227 | AKTIV |
| 19 | Av. Juan Domingo Perón 4734 | Benavídez | BA | 1621 | ANDREANI |
| 20 | Avda. Dr. Arturo Frondizi 1150 | Pergamino | BA | B2700 | RIZOBACTER |
| 21 | Ruta 188 KM 188 | Rojas | BA | 2705 | LABORATORIO DEGSER |
| 22 | Ruta 188 KM 80,5 | Pergamino | BA | B2700 | PALAVERSICH Y CIA |
| 23 | 4 de Enero 981 ⚠ | Santa Fe | SF | 3000 | SENASA |
| 24 | Acceso Parque Industrial Arturo Frondizi | América - Rivadavia | BA | B6237 | MOLISOLES |
| 25 | Mosconi 3898 | San Lorenzo | SF | 2200 | PAN AMERICAN ENERGY |
| 26 | Ruta 11 KM 455 | Sauce Viejo | SF | 3017 | PB LEINER |
| 27 | RP17 y RP10 ⚠ | La Puerta | Cba | X5137 | LANTHER |
| 28 | 44R9+HH ⚠ | Roldán | SF | 2134 | FERTILIZANTES FULLTEC |
| 29 | Ruta Provincial 19 KM 1,9 | Río Cuarto | Cba | X5800 | BIOELECTRICA |
| 30 | Brazo Largo 4429+MH ⚠ | Villa Paranacito | ER | — | SETI |
| 31 | Alvarado s/nro. lote 4b0 | Fighiera | SF | S2126 | ARANAMI INDUSTRIAL |
| 32 | Calle 1910 - Parque Industrial Park Empresario, lote 12 s/n | Rosario | SF | S2000 | ECOFERTIL |
| 33 | Paraná 57 | Las Varillas | Cba | X5940 | SERV QUIM |
| 34 | Jorge Stephenson 3213 | Malvinas Argentinas | BA | B1667 | EL TOBIANO |

**Domicilios con más de una organización:** ninguno. El #1 (Río Primero 155) es el único candidato —Barcan usó la planta de Pro Crop en 2 pedidos— y quedó sin vínculo hasta confirmarlo (sección 5, punto 3).
**Organizaciones con más de un domicilio:** PRO CROP (3), PAN AMERICAN ENERGY (2), ANDREANI (2).
**Total:** 34 domicilios, 34 vínculos, 30 organizaciones.

---

## 4 — Las 10 direcciones que no se cargan

Pertenecen a los usuarios de prueba, que tampoco se cargan.

| Dirección | Usuario |
| --- | --- |
| 9 de Julio 1450, Rosario | IvanPruebaApp / Prueba Ivan |
| Iriondo 1729, Rosario | JuanPruebaApp |
| Parravicini 9125, Rosario | SofiaPruebaApp |
| Av. Libertador 1200, Rosario | EzequielPruebaApp |
| Bv. Rondou 196, Rosario | AgustinPruebaApp |
| Entre Ríos 402, San Lorenzo | MagaliPruebaApp |
| Soberanía Nacional 2550, PGSM | JoelPruebaApp |
| Lisandro de la Torre 774, Timbúes | HernanPruebaApp |
| `rr, 77, jj, hh, 8888` | Prueba |
| `rr, 111, ww, ss, 3333` | **Otro** |

> La organización `OTRO` **sí se crea** (se usa para pruebas), pero su dirección es basura y no se carga. Los pedidos de prueba que la referencian quedan en `pedidos_portal`, como todos los demás pedidos viejos.

---

## 5 — Qué falta confirmar

| # | Punto | Por qué importa |
| --- | --- | --- |
| 1 | **`$ de Enero 981`** | El `$` debería ser un `4`, pero conviene verificar la dirección real de SENASA en Santa Fe. |
| 2 | **Lanther: `17&18` vs `RP17 & RP10`** | Si son dos cruces distintos, son dos domicilios y no uno. |
| 3 | **Barcan en Río Primero 155** | Usa la planta de Pro Crop. ¿Es un depósito compartido, o son dos pedidos mal cargados? |
| 4 | **Las dos direcciones de Andreani** | Gelly y Obes 1680 y Av. Perón 4734, las dos en Benavídez. Probablemente dos depósitos reales, pero conviene confirmarlo. |
| 5 | **Los códigos Plus** | Fulltec (Roldán) y SETI (Villa Paranacito) no tienen calle. Se cargan igual, con `verificado: false` para que aparezcan en la cola de revisión del ABM. |

---

*Explora S.A. — insumo de carga inicial*
