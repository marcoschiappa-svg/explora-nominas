# `pedidos_portal` — relevamiento as-is

Estructura real de la colección en `explora-portal`, relevada sobre el documento
`PED-260819-165` (26/08/2026) y contrastada con el código de `Pedidos.js`,
`Coordinador.js` y `Transportista.js`.

**Nada de este documento es propuesta.** Es lo que hay.

---

## Convenciones

| Marca | Significado |
| --- | --- |
| **siempre** | Está en todos los documentos |
| **al nominar** | Aparece recién cuando el transportista nomina |
| **al viajar** | Aparece recién cuando el chofer usa la app |
| ⚠ | Defecto confirmado |

---

## 1 — El documento de pedido

### 1.1 Identificación

| Campo | Tipo | Cuándo | Escribe | Notas |
| --- | --- | --- | --- | --- |
| `id` | string | siempre | Pedidos | `"PED-260819-165"`. Visible. No es el ID del documento |
| `origen` | string | siempre | Pedidos | `"carga_masiva"` o ausente si es carga manual |

El **ID del documento** es autogenerado por `addDoc`. El código lo arrastra
aparte como `docId`.

### 1.2 Datos comerciales y de operación

| Campo | Tipo | Cuándo | Notas |
| --- | --- | --- | --- |
| `cliente` | string | siempre | Texto libre. Sin normalizar |
| `ov` | string | siempre | `"OV-1126"` |
| `tipo` | string | siempre | `"Entrega al cliente"`, `"Entrega en planta"` o `"Retiro de Proveedores"` |
| `producto` | string | siempre | `"Otro"` cuando no está en la lista |
| `recipiente` | string | siempre | `"Granel"` |
| `obs` | string | siempre | Puede ser `""` |

### 1.3 Volumen — cuatro campos

| Campo | Tipo | Notas |
| --- | --- | --- |
| `volumen` | int64 | Total del pedido |
| `volumen_original` | int64 | Igual que `volumen` al crear; sirve para detectar ediciones |
| `volumen_despachado` | int64 | Suma de los despachos |
| `volumen_entrega1` | int64 | Volumen de la primera entrega |

⚠ `volumen_despachado` es un **acumulado guardado**, no derivado. Si una
escritura falla o se pisa, queda desincronizado de los despachos y nada lo
detecta.

### 1.4 Dirección — seis campos sueltos + uno concatenado

| Campo | Tipo | Ejemplo |
| --- | --- | --- |
| `calle` | string | `"Soberanía Nacional"` |
| `numero` | string | `"2550"` |
| `ciudad` | string | `"Puerto General San Martin"` |
| `provincia` | string | `"Santa Fe"` |
| `cp` | string | `"2231"` |
| `mapsLink` | string | Puede ser `""` |
| `lugar` | string | `"Soberanía Nacional, 2550, Puerto General San Martin, Santa Fe, 2231"` |

⚠ `lugar` es la concatenación de los otros cinco, guardada aparte. Dos
representaciones del mismo dato que hay que mantener sincronizadas a mano.

⚠ Cuando el `tipo` es `"Entrega en planta"`, `Pedidos.js` **no concatena**: pisa
`lugar` con la dirección de Explora escrita a mano en el código. Los otros cinco
campos quedan con lo que haya cargado el comercial.

⚠ El campo se llama `numero` y es el **número de calle**, pero dentro de
`despachos[]` hay otro `numero` que no existe (ahí es `id`). Nombre demasiado
genérico para un documento con tantos campos.

### 1.5 Fechas de entrega

| Campo | Tipo | Formato |
| --- | --- | --- |
| `fecha_entrega` | string | `"2026-09-14"` |
| `banda_horaria` | string | `"Tarde (12-18hs)"` |

⚠ `fecha_entrega` es la fecha de la **primera entrega**, no del pedido. Ver §2.

### 1.6 Teléfono — tres campos para un dato

| Campo | Tipo | Notas |
| --- | --- | --- |
| `telefono_prefijo` | string | |
| `telefono_numero` | string | |
| `telefono` | string | `"(prefijo) numero"` concatenado |

Mismo patrón que `lugar`: partes + concatenado, los dos guardados.

### 1.7 Auditoría

| Campo | Tipo | Formato | Notas |
| --- | --- | --- | --- |
| `creado_por` | string | | Nombre, no UID |
| `creado_por_email` | string | | |
| `creado_en` | string | `"19/8/2026, 11:49:04"` | ⚠ `toLocaleString('es-AR')` |
| `timestamp` | string | `"2026-08-19T14:49:04.776Z"` | ISO, mismo instante |
| `editado` | boolean | | |
| `editado_por` | string \| null | | Nombre |
| `editado_en` | string \| null | `toLocaleString` | ⚠ |

⚠ `creado_en` y `timestamp` son **el mismo instante en dos formatos**. El
primero no se puede parsear (12 horas sin AM/PM); el segundo sí. Se guardan los
dos.

⚠ `editado_por` / `editado_en` son **casilleros únicos**: editar dos veces pisa
el registro anterior. No hay historial.

### 1.8 Estado

| Campo | Tipo | Valores |
| --- | --- | --- |
| `estado` | string | `Pendiente`, `prog-parcial`, `Programado`, `Aceptado`, `Nominado`, `Suspendido` |

⚠ En el documento relevado vale `"Nominado"` con **19 de 20 despachos sin
nominar**, y el único nominado ya está `finalizado`. El campo guarda la última
acción que pasó por el pedido, no el estado del pedido.

`"Cumplido"` existe en `pillLabel` de `Pedidos.js` pero **ninguna función lo
escribe**. Estado muerto.

Campos de suspensión, solo cuando se suspende desde `Pedidos.js`:
`suspendido_por`, `suspendido_en`, `motivo_suspension`.

⚠ `suspender` en `Coordinador.js` escribe **solo** `estado: 'Suspendido'`, sin
los otros tres. Dos funciones con el mismo nombre y distinto resultado.

---

## 2 — `cronograma[]` — array

Las entregas solicitadas.

| Campo | Tipo | Ejemplo |
| --- | --- | --- |
| `nro` | int64 | 1 a 19 |
| `volumen` | int64 | 1 |
| `fecha_solicitada` | string | `"2026-08-20"` |

### ⚠ La primera entrega no está en el cronograma

El documento tiene volumen 20 y 20 despachos, pero el cronograma tiene **19**
entradas. La entrega 1 vive en el pedido:

```
entrega 1   →  pedido.fecha_entrega + pedido.volumen_entrega1
entrega 2   →  cronograma[0], con nro = 1
entrega 3   →  cronograma[1], con nro = 2
```

Verificado cruzando fechas de carga:

| Despacho | `entrega_nro` | `fecha_carga` | De dónde sale |
| --- | --- | --- | --- |
| D1 | 1 | 2026-09-14 | `pedido.fecha_entrega` |
| D2 | 2 | 2026-08-20 | `cronograma.nro = 1` |
| D3 | 5 | 2026-08-21 | `cronograma.nro = 4` |

Hay **dos numeraciones desfasadas en uno** (`entrega_nro` y `cronograma.nro`) y
**dos representaciones** de la misma entidad (la primera en el pedido, el resto
en el array).

---

## 3 — `despachos[]` — array

El array que concentra casi todos los problemas.

### 3.1 Tres entidades en un solo mapa

Los campos aparecen de a bloques, según la etapa:

| Bloque | Cuándo | Campos |
| --- | --- | --- |
| Despacho | siempre | 14 |
| Nominación | al nominar | 11 |
| Viaje | al viajar | 11 |

Por eso D1 tiene 14 campos y D2 tiene 36. No es que uno esté "incompleto": son
tres entidades distintas guardadas en el mismo mapa.

### 3.2 Bloque despacho — siempre

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | string | `"D1"` a `"D20"`. ⚠ Se genera como `'D' + (length + 1)` |
| `entrega_nro` | int64 | Apunta a la entrega. Desfasado del cronograma (§2) |
| `volumen` | int64 | |
| `estado` | string | `Aceptado-pendiente`, `Programado`, `Aceptado`, `Nominado`, `Rechazado`, `En espera` |
| `fecha_carga` | string | `"2026-09-14"` |
| `horario_carga` | string | Suele ser `""` |
| `transporte` | string | ⚠ Texto libre. Lo usa el Apps Script para rutear |
| `transporte_id` | string | UID de Auth del **usuario** transportista |
| `cuit_transporte` | string | Con guiones |
| `email_transportista` | string | Principal |
| `emails_extra` | array | Secundarios |
| `telefonos` | array | |
| `aceptado_por` | string | Nombre. ⚠ Casillero único |
| `aceptado_en` | string | ⚠ `toLocaleString` |

⚠ `transporte` y `transporte_id` describen lo mismo desde dos lados. Nada
garantiza que apunten a la misma empresa.

⚠ Los datos de contacto (`email_transportista`, `emails_extra`, `telefonos`,
`cuit_transporte`) están **copiados** de `usuarios_portal` al momento de
asignar. Si el transportista cambia su mail, los despachos ya creados siguen
con el viejo.

### 3.3 Bloque nominación — al nominar

| Campo | Tipo |
| --- | --- |
| `chofer` | string (nombre) |
| `dni_chofer` | string |
| `cuit_chofer` | string |
| `patente_tractor` | string |
| `patente_semi` | string |
| `tel_prefijo`, `tel_numero`, `tel_unidad` | string |
| `nominacion_pendiente` | boolean |

⚠ El chofer se identifica por **DNI**, no por UID. `ChoferScreen` filtra los
viajes por DNI y `nominar()` valida contra `usuarios_portal`, pero el vínculo
queda como un string.

⚠ `tel_unidad` es la concatenación de `tel_prefijo` y `tel_numero`. Tercer caso
del mismo patrón.

### 3.4 Bloque viaje — al viajar

| Campo | Tipo | Formato |
| --- | --- | --- |
| `estado_chofer` | string | `recibido`, `iniciado`, `demorado`, `finalizado` |
| `estado_chofer_ts` | string | ISO |
| `chofer_inicio_ts` | string | ISO |
| `chofer_fin_ts` | string | ISO |
| `gps_estado` | string | `"activo"` — ⚠ literal fijo, no estado real |
| `gps_lat`, `gps_lng` | double | Última posición |
| `gps_ts` | string | ISO |
| `gps_inicio_lat/lng/ts/precision/origen` | 5 campos | |
| `gps_fin_lat/lng/ts/precision/origen` | 5 campos | |

⚠ **`estado` y `estado_chofer` son dos ciclos paralelos que nadie sincroniza.**
En D2, `estado` dice `"Nominado"` y `estado_chofer` dice `"finalizado"`. El
primero se congela al nominar y nunca vuelve a cambiar.

⚠ La posición está en **tres esquemas a la vez**: `gps_*` (última),
`gps_inicio_*` / `gps_fin_*` (extremos), y `gps_track_{n}` (recorrido). Trece
campos para lo que son tres puntos y una lista.

---

## 4 — `gps_track_{n}` — array, en el pedido

| Campo | Tipo | Formato |
| --- | --- | --- |
| `lat`, `lng` | double | |
| `ts` | string | ISO |

### ⚠ El sufijo es el índice del array, no el número de despacho

En el documento relevado, el único viaje es de **D2**, que está en la
**posición 1** del array. Su recorrido está en `gps_track_1`.

Es decir: `gps_track_0` sería el de D1, `gps_track_1` el de D2. Quien lea
`gps_track_1` buscando el recorrido de D1 obtiene el de otro camión.

Y si se borra un despacho del medio, todos los índices se corren: **cada
recorrido queda apuntando a otro viaje.**

### ⚠ Los puntos vienen duplicados

```
[2]  -32.6898193, -60.7430931   20:04:16.239
[3]  -32.6898193, -60.7430931   20:04:16.266   ← 27 ms después, idéntico
```

De 24 puntos, ~20 son diez pares con coordenadas idénticas y timestamps a
milisegundos de distancia.

**La causa son dos suscripciones de ubicación activas a la vez**, la de primer
plano y la tarea de background, llamando las dos a `registrarPunto` con la misma
lectura del sensor. Por eso las coordenadas coinciden al decimal y el tiempo
difiere en milisegundos: `ts` se genera con `new Date()` en cada llamada.

*(No es la carrera del buffer `KEY_BUFFER_GPS`, que también existe pero
produciría duplicados con el `ts` idéntico y `arrayUnion` los deduplicaría.)*

### ⚠ El recorrido cuenta contra el límite del documento

Firestore admite 1 MB por documento. Cada punto son ~100 bytes. Un pedido con
20 despachos y viajes largos llena el documento — y cuando se llena, **falla la
escritura entera**, no solo el punto.

---

## 5 — `adjuntos[]` — array

| Campo | Notas |
| --- | --- |
| `file_id` | ID en Google Drive |
| `nombre` | |
| `visible_transportista` | boolean, lo alterna el coordinador |

Vacío en el documento relevado.

---

## 6 — Resumen de defectos

### Estructurales

1. **`despachos[]` es un array.** Toda escritura reescribe el array completo.
   Dos usuarios sobre el mismo pedido: el segundo pisa al primero.
   `Coordinador.js` además arma el array desde el estado de React sin releer.
2. **El `id` del despacho es `'D' + (length + 1)`.** Borrar uno del medio
   produce IDs repetidos.
3. **`gps_track_{n}` usa el índice del array como sufijo.** Reordenar despachos
   reasigna recorridos.
4. **El GPS crece dentro del pedido**, contra el límite de 1 MB.
5. **El despacho mezcla tres entidades**: despacho, nominación y viaje.
6. **La primera entrega está modelada aparte** del cronograma, con numeraciones
   desfasadas.

### De estado

7. **`estado` y `estado_chofer` son dos ciclos sin sincronizar.** `estado` se
   congela en `Nominado`.
8. **`pedido.estado` no describe al pedido**, sino la última acción.
9. **Se escribe desde cinco funciones con criterios distintos.** El coordinador
   mira todos los despachos; el transportista solo el suyo.
10. **`Cumplido` es un estado muerto.**
11. **No hay forma de reactivar** un pedido suspendido.

### De datos

12. **Fechas en dos formatos**, uno de ellos no parseable.
13. **Datos duplicados a propósito**: `lugar`, `telefono`, `tel_unidad`,
    `creado_en`/`timestamp`, `volumen_despachado`.
14. **Contacto del transportista copiado** al despacho: no se actualiza.
15. **La trazabilidad se pisa**: `aceptado_por`, `editado_por` son casilleros
    únicos.
16. **`gps_estado` es el literal `"activo"`**, no un estado derivado.
17. **Los puntos GPS se duplican** porque hay dos suscripciones de ubicación
    activas a la vez pasando la misma lectura.

### De acceso

18. **Cualquier autenticado lee y escribe cualquier pedido**, choferes
    incluidos.

---

*Explora S.A. — relevamiento as-is*
