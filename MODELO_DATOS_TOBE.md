# Modelo de datos to-be — estructura

Reemplaza a las seis colecciones actuales de `explora-portal`.

**Alcance:** se rediseña la estructura y las relaciones. Los valores que hoy son
texto libre pasan a ser entidades: cliente, transporte, producto y domicilio.

**Este documento define qué existe.** Qué hace cada acción está en
`COMPORTAMIENTO.md`.

As-is: `MODELO_DATOS.md` y `RELEVAMIENTO_PEDIDOS_PORTAL.md`

---

## Criterio

**Un array anidado sirve solo si se cumplen las tres:** cantidad acotada, un solo
escritor, y nunca se consulta por sí mismo. Si falla una, es una colección.

**Las claves primarias son opacas y autogeneradas.** Los identificadores que ve
la gente (`PED-2026-001248`, `D1`) son campos. Un ID derivado de un dato obliga a
migrar referencias cuando ese dato cambia.

**Un dato se guarda una sola vez**, salvo denormalización explícita. Cada caso de
duplicación dice por qué existe.

**Nada se borra.** Todo se desactiva. La única excepción son los adjuntos, que no
son referenciados por nada.

---

## Mapa

```
organizaciones/{id}          clientes, transportes y Explora
domicilios/{id}
organizacion_domicilios/{id} qué domicilios usa cada organización
usuarios/{authUid}           el ID del documento ES el UID de Auth
productos/{id}
camiones/{id}
contadores/{nombre}

pedidos/{id}
    ├── entregas/{id}        lo que el cliente pidió
    ├── adjuntos/{id}
    └── despachos/{id}       el camión que cubre una entrega
            └── viajes/{id}  el camión andando
                    └── gps_puntos/{ts}    subcolección

historial/{id}
app_logs/{id}
```

---

# Parte 1 — Entidades base

## `organizaciones`

```
razon_social        string      "PAN AMERICAN ENERGY"
nombre_corto        string      "PAE"
cuit                string | null   sin guiones ni espacios
estado              string      activo | inactivo
obs                 string

es_cliente          bool
es_transportista    bool
es_propia           bool        true solo para Explora

creado_por_uid      string
creado_en           Timestamp
actualizado_en      Timestamp
```

**Una sola colección, no dos.** Hoy hay `transportistas_portal` y, aparte,
usuarios con `rol: 'transportista'`, vinculados por el string `empresa` — y los
strings **no coinciden**: uno dice `"RAD"` y el otro `"Transporte RAD"`. Por eso
`nominar()` rechaza nominaciones válidas: compara los dos con `!==`.

Y un cliente puede poner su propio transporte. Con colecciones separadas esa
empresa estaría cargada dos veces sin que nada indique que es la misma.

**Los roles son banderas, no subcolecciones.** Son dos, no crecen, y **se
consultan** —"dame los transportistas"—. Una subcolección no se puede consultar
desde la colección padre sin `collectionGroup`; dos booleanos sí.

**Explora** es una organización más, con `es_propia: true`. Hoy su planta está
hardcodeada en `Pedidos.js`. Esto además deja el modelo listo para las órdenes de
compra, donde Explora es la punta compradora.

---

## `domicilios`

```
calle               string
numero              string | null
ciudad              string
provincia           string
cp                  string | null
maps_link           string | null

verificado          bool        false = entró por migración o alta apurada
estado              string      activo | inactivo
obs                 string

creado_por_uid      string
creado_en           Timestamp
```

**Los domicilios no tienen tipo.** Una dirección es un punto de entrega posible;
que además sea planta o depósito no cambia nada operativamente.

**No se crean al cargar un pedido.** El comercial elige de la lista de la
organización; si no está, la da de alta formalmente y después la selecciona. Es
lo que evita lo de hoy: 50 direcciones distintas para 34 lugares reales.

`numero` y `cp` son opcionales: hay direcciones rurales que son "Ruta 14 KM 55,5"
y códigos Plus de Google sin calle.

---

## `organizacion_domicilios`

```
organizacion_id     string      → organizaciones
domicilio_id        string      → domicilios
alias               string | null   "Depósito norte"
principal           bool
creado_en           Timestamp
```

Responde **"qué domicilios ofrece esta organización"**, que es lo que el
formulario muestra al cargar un pedido.

No es lo mismo que el destino de un pedido. La planta de Explora es destino de 18
pedidos de 8 clientes distintos y **no está en la lista de ninguno**: es de
Explora.

Relación N a N: un domicilio puede tener varias organizaciones y una organización
varios domicilios.

---

## `usuarios`

El ID del documento **es** el UID de Firebase Auth.

```
nombre              string
email               string      real, o {dni}@explora-portal.com
roles               string[]    admin | coordinador | comercial |
                                transportista | chofer | (cliente, futuro)
estado              string      activo | inactivo

organizacion_id     string | null   → organizaciones
                                    Explora para los roles internos

telefonos           string[]    "(3476) 562372"
emails_extra        string[]    contacto, además del de login

datos_chofer        map | null  solo si tiene el rol chofer
    dni             string      INMUTABLE
    cuit            string      sin guiones
    licencia_venc   string | null   fuera de alcance por ahora

creado_por_uid      string
creado_en           Timestamp
actualizado_en      Timestamp
```

**`roles` es un array.** Hoy un mismo humano necesita dos cuentas de Auth para
ser chofer y admin. Con array, las reglas usan `roles.hasAny(['chofer'])` y
agregar un rol no obliga a tocar nada. Con campo único, soportarlo después
obligaría a reescribir todas las reglas.

Deja lugar además para modelar a los **clientes como usuarios**, que está fuera
del alcance actual: sería `roles: ['cliente']` con su `organizacion_id`, y la
consulta "los pedidos de mi organización" ya existe como campo.

**El chofer depende de su transportista por `organizacion_id`.** Es lo que
permite que el transportista liste y administre a su gente, y que las reglas le
dejen crear choferes solo con su propio `organizacion_id`.

**`datos_chofer` es un map, no una subcolección.** Es 1:1, tres campos, y las
reglas necesitan el DNI sin una lectura extra. Que sea un map anidado —y no
campos sueltos— evita lo que pasa hoy en el despacho: campos que existen o no
según la etapa, sin que nada indique por qué.

**Las patentes no están acá.** Van en `camiones`: un chofer puede manejar
cualquier camión de la empresa.

**Los teléfonos son un array.** Son dos o tres, los escribe solo quien edita el
usuario, y nunca se consultan por sí mismos. Reemplazan a `prefijo_1..3` +
`numero_1..3` de `usuarios_portal` y a `telefono_1..3` de
`transportistas_portal` — dos modelos distintos para lo mismo.

**Las organizaciones no tienen teléfonos propios.** El teléfono de la empresa lo
atiende una persona; se carga en su usuario.

**`password_visible` no existe.** Hoy hay contraseñas en texto plano en una
colección que cualquier autenticado puede leer. La clave se genera al crear, se
muestra una sola vez y no se guarda.

---

## `productos`

```
nombre              string      "Biodiesel"
codigo              string | null
activo              bool
es_generico         bool        true solo para "Otro"
obs                 string

creado_por_uid      string
creado_en           Timestamp
```

Hoy es una constante en `Pedidos.js`: cambiarla requiere un deploy.

**`"Otro"` se queda como escape.** Sirve para las pruebas de la app y para el
caso de Laruso, que compra aceite reesterificado —un producto real que hoy figura
como "Otro" y nadie sabe qué es—.

---

## `camiones`

```
organizacion_id     string      → organizaciones
patente_tractor     string      normalizada, mayúsculas sin espacios
patente_semi        string | null
estado              string      activo | inactivo
obs                 string

creado_por_uid      string
creado_en           Timestamp
actualizado_en      Timestamp
```

El camión es del transportista, no del chofer. Al nominar se eligen los dos por
separado: un chofer puede manejar cualquier camión de la empresa.

---

## `contadores`

```
contadores/{nombre}
    ultimo          number
```

Hoy `genNro()` genera `PED-260819-165` donde el `165` es **aleatorio entre 100 y
999**, sin verificar que exista. Con 10 pedidos en un día la probabilidad de
choque es ~5%; con 40, más del 50%. Y el Apps Script identifica el pedido por ese
número: dos pedidos iguales se pisan la fila en el Plan de Producción.

El correlativo se incrementa dentro de la transacción que crea el pedido.

---

# Parte 2 — Operación

## `pedidos`

```
numero                  string      "PED-2026-001248"
origen_carga            string      manual | carga_masiva
clase                   string      venta | compra   (compra, más adelante)

cliente_org_id          string      → organizaciones
ov                      string
tipo                    string      ver abajo
producto_id             string      → productos
recipiente              string
obs                     string

volumen                 number
volumen_original        number

origen_domicilio_id     string      → domicilios
destino_domicilio_id    string      → domicilios
banda_horaria           string

estado                  string      pendiente | programado_parcial |
                                    programado | cumplido | suspendido
suspension_motivo       string | null
suspension_ts           Timestamp | null

creado_por_uid          string
creado_en               Timestamp
actualizado_en          Timestamp
```

### Origen y destino, siempre los dos

Hoy el pedido tiene un solo lugar, y cuando el tipo es `"Entrega en planta"` se
escribe la dirección de Explora hardcodeada. Con las dos puntas explícitas los
tres tipos quedan uniformes:

| `tipo` | `origen_domicilio_id` | `destino_domicilio_id` |
| --- | --- | --- |
| Entrega al cliente | planta de Explora | domicilio del cliente |
| Entrega en planta | domicilio del cliente | planta de Explora |
| Retiro de Proveedores | domicilio del proveedor | planta de Explora |

Y deja el modelo listo para las órdenes de compra sin tocarlo.

### El estado se guarda

Un pedido recién creado está en `pendiente`, y eso es un hecho, no un cálculo.
Además el estado derivado necesita entregas y despachos: sin ellos un pedido no
tendría estado, y cualquier lista tendría que traer todo el árbol para pintar una
insignia.

Se recalcula con **una sola función**, dentro de cada transacción que lo pueda
afectar. La diferencia con hoy no es que esté guardado: es que hoy lo escriben
cinco funciones con criterios distintos —el coordinador mira todos los despachos,
el transportista solo el suyo—.

### Lo que desapareció

| Campo viejo | Qué pasó |
| --- | --- |
| `lugar` | Se arma desde el domicilio |
| `calle`, `numero`, `ciudad`, `provincia`, `cp`, `mapsLink` | Van al domicilio |
| `telefono`, `telefono_prefijo`, `telefono_numero` | Van al usuario |
| `creado_en` string + `timestamp` | Un solo `Timestamp` |
| `volumen_despachado` | Se deriva sumando los despachos |
| `volumen_entrega1`, `fecha_entrega` | La primera entrega es una entrega más |
| `creado_por`, `editado`, `editado_por`, `editado_en` | El historial los reemplaza |
| `cliente`, `producto` como texto | Son referencias |

---

## `entregas`

Lo que el cliente pidió: volumen y fecha.

```
pedido_id           string      → pedidos
numero              number      1, 2, 3... sin huecos
volumen             number
fecha_solicitada    string      "2026-08-20"
estado              string      pendiente | programada | cumplida | suspendida
creado_en           Timestamp
actualizado_en      Timestamp
```

**Toda creación de pedido genera al menos una entrega.** Si el comercial no carga
cronograma, se crea una sola con el volumen total y la fecha comprometida. No
existe un pedido sin entregas: el coordinador siempre tiene a qué asociar el
despacho.

**La primera entrega es un documento como cualquier otra.** Hoy vive en el pedido
(`fecha_entrega` + `volumen_entrega1`) y el cronograma guarda de la segunda en
adelante numeradas desde 1 — dos numeraciones desfasadas en uno.

**La entrega tiene estado propio.** La cadena es de tres niveles: el despacho
determina el estado de su entrega, y las entregas el del pedido. Cada nivel mira
solo a sus hijos.

```
estadoEntrega(entrega, sus despachos):
    si entrega.estado == suspendida    → suspendida   (decisión explícita)
    vivos = despachos con estado not in [RECHAZADO, CANCELADO]
    si no hay vivos                    → pendiente
    si el vivo está ENTREGADO          → cumplida
    si no                              → programada
```

**No tiene `despacho_id`.** El vínculo va en una sola dirección. Una entrega
puede tener varios despachos a lo largo del tiempo —uno rechazado y otro vivo—,
así que un campo único no alcanzaría, y mantener las dos puntas sincronizadas es
la duplicación que estamos sacando.

**Las fechas sin hora se quedan como string `YYYY-MM-DD`** a propósito: son
fechas de calendario, no instantes. Como `Timestamp` quedan atadas a una zona
horaria y aparecen corridas un día.

---

## `despachos`

El camión que cubre una entrega. Incluye la nominación.

```
pedido_id             string      → pedidos
entrega_id            string      → entregas
numero                string      "D1", visible

estado                string      ver "Estados"
estado_ts             Timestamp

volumen               number      copiado de la entrega, no editable
fecha_carga           string      "2026-09-14"
horario_carga         string

transportista_org_id  string | null   → organizaciones
requiere_transporte   bool            default true — ver abajo
rechazo_motivo        string | null
cancelacion_motivo    string | null

baja_solicitada       bool            default false — ver abajo
baja_motivo           string | null
baja_ts               Timestamp | null

chofer_uid            string | null   → usuarios
chofer_dni            string | null   la app y las reglas buscan por DNI
camion_id             string | null   → camiones
patente_tractor       string | null   denormalizada, congelada al nominar
patente_semi          string | null   ídem

cliente_razon_social  string      denormalizado
producto_nombre       string      denormalizado
transporte_nombre     string      denormalizado
ov                    string      denormalizado
destino_texto         string      denormalizado, ya concatenado

creado_en             Timestamp
actualizado_en        Timestamp
```

### Por qué la nominación se queda acá

Es 1:1 con el despacho y **no tiene escritor propio**: la hace el transportista,
igual que aceptar y rechazar. El viaje sí tiene escritor propio —la app y la
pantalla del chofer— y por eso sale.

### Qué salió del despacho

**Los datos de contacto del transportista** (`email_transportista`,
`emails_extra`, `telefonos`, `cuit_transporte`). Hoy se copian al asignar y
quedan congelados: si el transportista cambia su mail, los despachos ya creados
siguen mandando al viejo. Se resuelven desde `usuarios` al notificar.

**Los datos de la persona del chofer** (nombre, CUIT, teléfono). Están en
`usuarios`, se resuelven por `chofer_uid`.

**`nominacion_pendiente`.** Se deduce del estado.

**Todo el bloque de viaje.** Ver `viajes`.

### Qué se queda denormalizado, y por qué

Los cinco campos de nombre se copian a propósito:

- El transportista **no lee `pedidos`**. Sin estos campos, su pantalla no tiene
  qué mostrar. Y no habría forma de darle acceso: "los pedidos donde tengo un
  despacho" es un join, y las reglas de Firestore no consultan otra colección
  filtrando.
- El Apps Script del Plan de Producción rutea comparando **nombres**.

Los `*_id` son el vínculo real; los nombres son etiquetas para afuera. **Se
escriben siempre resolviéndolos desde el ID, nunca a mano** — hoy `transporte` y
`transporte_id` podían apuntar a empresas distintas.

Las patentes se copian al nominar y quedan fijas: si el camión se rematricula,
los despachos viejos conservan la que llevaba ese día.

### Los dos campos fuera de alcance

**`requiere_transporte`.** Hoy hay 19 despachos con `transporte: "—"`: el cliente
pone el camión y no hay a quién notificar. El flujo completo —quién lo cierra,
cómo se marca entregado, si tiene viaje— queda para una versión próxima. El campo
va desde ahora para no tener que migrar 200 despachos después.

**`baja_solicitada`.** El transportista que aceptó y después no puede cumplir
tiene que avisar al coordinador. Es una acción nueva —el transportista pide, el
coordinador decide— y no está modelada. La bandera va desde ahora por el mismo
motivo.

### El `numero`

Sigue siendo `"D1"` porque es lo que la gente lee y lo que va en los mails. Pero
**ya no es la clave**, así que un repetido no rompe nada.

Para los nuevos se calcula releyendo dentro de la transacción, como el mayor
existente más uno. No como `length + 1`, que hoy repite si se borra uno del
medio.

---

## `viajes`

El camión andando. Se crea **al nominar**, no al arrancar: el chofer tiene que
verlo antes de iniciarlo.

```
despacho_id           string      → despachos
pedido_id             string      denormalizado
chofer_uid            string      → usuarios     INMUTABLE
chofer_dni            string                     INMUTABLE
transportista_org_id  string      para las reglas

estado                string      RECIBIDO | EN_VIAJE | FINALIZADO | CANCELADO
estado_ts             Timestamp

demorado              bool        default false — atributo, no estado
demora_motivo         string | null   texto libre
demora_ts             Timestamp | null

inicio_ts             Timestamp | null
fin_ts                Timestamp | null
cerrado_por           string | null   "chofer" | "manual"
cierre_motivo         string | null   solo si fue manual

inicio_lat/lng/precision/origen     number | string | null
fin_lat/lng/precision/origen        number | string | null
ultima_lat/lng                      number | null
ultima_ts                           Timestamp | null

puntos_registrados    number

cliente_razon_social  string      denormalizados para la pantalla del chofer
producto_nombre       string
origen_texto          string
destino_texto         string
volumen               number
fecha_carga           string
patente_tractor       string
patente_semi          string | null

creado_en             Timestamp
```

### Por qué es una colección aparte

Es 1:1 con el despacho, igual que la nominación. La diferencia es el escritor: lo
escriben la app y la pantalla del chofer, con ritmo propio (el GPS cada 30
segundos), reglas propias (el chofer escribe su viaje pero no toca el despacho) y
una subcolección propia.

### El chofer lee una sola colección

Los denormalizados están para eso: el chofer **no lee `pedidos` ni `despachos`**.
Todo lo que su pantalla muestra está en el viaje. Se copian al nominar y no
cambian, salvo `destino_texto` si el comercial cambia el domicilio antes de que
arranque.

### La demora es un atributo

Reportar una demora **no cambia el estado**: el camión sigue andando, va tarde.
Queda marcado hasta el final como información del viaje, no como semáforo.

Eso además arregla el `['iniciado','demorado'].includes(...)` que hoy existe en
`Transportista.js` solo porque la demora está metida como estado.

### La nominación es irreversible

`chofer_uid` y `chofer_dni` no cambian después de creado el viaje. Cambiar la
nominación hasta que el chofer se presenta en la puerta requiere hardware que no
existe: queda fuera de alcance. Si hay que cambiarlo, se cancela el despacho.

### Por qué la última posición está denormalizada

El mapa en vivo necesita la última posición de N camiones. Si viviera solo en la
subcolección, mostrar 12 camiones serían 12 consultas.

**No hay `gps_estado`.** Hoy es el literal `"activo"`, escrito una vez y nunca
actualizado. Se deriva:

```
saludGPS(viaje):
    si estado != EN_VIAJE              → no corresponde
    si ultima_ts hace < 2 min          → activo
    si ultima_ts hace < 15 min         → intermitente
    si no                              → sin señal
```

---

## `gps_puntos` — subcolección de `viajes`

```
viajes/{viajeId}/gps_puntos/{ts_en_milisegundos}

lat, lng            number
ts                  Timestamp
precision           number | null
velocidad           number | null
```

**La clave es el timestamp del punto**, no autogenerada. Vuelve idempotente la
escritura: si un lote se reenvía por un reintento, cada punto cae en la misma
clave en vez de duplicarse.

*(Los duplicados que se ven hoy en los datos son de otra causa: dos suscripciones
de ubicación activas a la vez llamando a `registrarPunto` con la misma lectura,
con timestamps a milisegundos de distancia. Eso se arregla en la app.)*

Ordenar por ID es ordenar cronológicamente: el recorrido se lee sin índice.

**Subcolección y no colección raíz:** un punto nunca se consulta fuera de su
viaje.

**Solo se crean.** Nunca se modifican ni se borran: un punto es la lectura de un
sensor en un instante.

Hoy el recorrido vive en `gps_track_{n}` como campo del pedido, donde **el sufijo
es el índice del array de despachos, no el número del despacho** — reordenar
despachos reasigna recorridos. Y cuenta contra el límite de 1 MB del documento:
cuando se llena, falla la escritura entera.

---

## `adjuntos`

```
pedido_id             string      → pedidos
file_id               string      ID en Google Drive
nombre                string
visible_transportista bool
subido_por_uid        string
creado_en             Timestamp
```

El archivo vive en Drive. Firebase Storage exige plan Blaze desde octubre de 2024
y no se justifica por unos PDF.

**Es lo único que se borra de verdad.** No hay nada que lo referencie:
desactivarlo dejaría basura sin propósito.

---

## `historial`

```
entidad_tipo          string      pedido | entrega | despacho | viaje |
                                  organizacion | usuario | domicilio |
                                  producto | camion | adjunto
entidad_id            string
pedido_id             string | null   denormalizado: trae todo el árbol
accion                string
campos_modificados    string[]
antes                 map
despues               map
usuario_uid           string
usuario_nombre        string
razon                 string | null
ts                    Timestamp
```

Solo se crea. No se modifica ni se borra, ni por un admin: un registro de
auditoría editable no sirve como registro de auditoría.

Reemplaza los casilleros únicos `aceptado_por`, `asignado_por`,
`reprogramado_por`, `editado_por`, que hoy se pisan cada vez que la acción se
repite.

---

## `app_logs`

```
ts                  Timestamp   serverTimestamp, no string
nivel               string      info | warn | error
evento              string
mensaje             string
code                string | null

dispositivo_id      string      UUID por instalación, en AsyncStorage
chofer_dni          string | null
viaje_id            string | null
puntos_pendientes   number | null

plataforma          string
version_os          string
version_app         string
expira_en           Timestamp   política TTL nativa de Firestore
```

**`dispositivo_id`** identifica el teléfono, no la persona. Sin él, dos choferes
con Android 14 son indistinguibles en los logs.

**`viaje_id`** permite aislar los logs de un viaje. Hoy hay que buscar por rango
de hora y esperar que no haya otro chofer andando.

**`expira_en`** con la política TTL borra sola los documentos vencidos. Se
configura una vez en la consola, **sin Cloud Functions**.

---

# Parte 3 — Estados

## Despacho

```
PENDIENTE_ASIGNACION ──asignar──→ ASIGNADO
                                     │
                        ┌────────────┴────────────┐
                     aceptar                  rechazar
                        ↓                          ↓
                    ACEPTADO                  RECHAZADO
                        │                     (lo decide el transportista)
                     nominar
                        ↓
                    NOMINADO ──────→ se crea el viaje
                        │
                  el viaje se cierra
                        ↓
                    ENTREGADO

cualquiera vivo ──cancelar──→ CANCELADO     (lo decide Explora)
```

**No hay `EN_ESPERA`.** Hoy existe porque el despacho es un elemento de un array
y no se puede descartar sin romper índices: editar el pedido congela los veinte
despachos, y reprogramar los devuelve a `Programado` perdiendo la nominación. Con
despachos como documentos, se cancela y se crea otro. Reprogramar deja de ser una
acción: es cancelar más aceptar la entrega de nuevo.

**`RECHAZADO` y `CANCELADO` son distintos.** El primero lo decide el
transportista, el segundo un cambio del lado de Explora. Los dos son terminales y
los dos dejan la entrega descubierta, pero el motivo importa.

**`ENTREGADO` es el estado que hoy no existe.** Por eso `Nominado` es terminal:
el chofer entrega, `estado_chofer` pasa a `finalizado`, y `estado` nunca cambia.

## Viaje

```
RECIBIDO ──el chofer arranca──→ EN_VIAJE ──cerrar──→ FINALIZADO
   │                                                      │
   └──se cancela el despacho──→ CANCELADO                 └→ el despacho
                                                             pasa a ENTREGADO
```

Tres estados más la cancelación. La demora es un atributo.

El cierre lo hace el chofer, o un coordinador a mano si el chofer no cerró
(`cerrado_por: "manual"`). Sin esa distinción, un viaje sin posición de fin
parece un viaje con GPS roto.

## Entrega

```
pendiente ──se crea un despacho──→ programada ──el viaje cierra──→ cumplida
    ↑                                   │
    └───el despacho se rechaza──────────┘
        o se cancela

pendiente ──el comercial baja el volumen──→ suspendida
```

## Pedido

```
estadoPedido(pedido, sus entregas):
    si pedido.suspendido               → suspendido
    vivas = entregas con estado != suspendida
    si no hay vivas                    → pendiente
    si todas cumplidas                 → cumplido
    si todas programadas o cumplidas   → programado
    si alguna programada o cumplida    → programado_parcial
    si todas pendientes                → pendiente
```

`suspendido` es terminal: suspender es cancelar. No hay reactivar.

`cumplido` existe de verdad. Hoy está en las etiquetas de `Pedidos.js` y ninguna
función lo escribe.

---

# Parte 4 — Acceso

| Colección | Interno | Transportista | Chofer |
| --- | --- | --- | --- |
| `organizaciones` | todo | lectura | lectura |
| `domicilios` | todo | lectura | lectura |
| `organizacion_domicilios` | todo | lectura | lectura |
| `usuarios` | todo | los de su organización; crea choferes | el suyo |
| `productos` | admin escribe | lectura | lectura |
| `camiones` | todo | los suyos, ABM completo | lectura |
| `pedidos` | todo | — | — |
| `entregas` | todo | — | — |
| `adjuntos` | todo | los marcados visibles | — |
| `despachos` | todo | los suyos | — |
| `viajes` | todo | los de su organización | el suyo, escritura acotada |
| `gps_puntos` | todo | los de su organización | crea los suyos |
| `historial` | lectura | — | — |
| `contadores` | interno | — | — |
| `app_logs` | consola | — | crea |

Hoy cualquier autenticado lee y escribe **cualquier** pedido, choferes incluidos.

**El chofer no lee `despachos`.** Todo lo que necesita está en el viaje.

**El transportista crea usuarios** con rol chofer y su propio `organizacion_id`,
y camiones de su organización. Está en el modelo aunque la pantalla se haga
después: si no se contempla ahora, hay que rehacer las reglas.

**El chofer usa el portal además de la app**, con una pantalla equivalente. Las
mismas reglas cubren los dos accesos.

Las consultas tienen que venir filtradas: si el transportista pide `despachos`
sin `where('transportista_org_id','==',...)`, Firestore rechaza la consulta
entera.

---

# Parte 5 — Notas

## Lo que este modelo no resuelve

| Tema | Por qué |
| --- | --- |
| `mode: 'no-cors'` en las llamadas al Apps Script | Es del cliente. El portal nunca ve si falló |
| El Apps Script no borra del Plan | Necesita una acción `borrar_despacho` nueva |
| Las dos suscripciones de GPS en la app | Es un bug de la app |
| Permisos de la carpeta de Drive | Si los archivos son públicos con el link, `visible_transportista` no protege nada |
| Órdenes de compra | `clase` y las dos puntas de domicilio lo dejan preparado |
| Clientes como usuarios | `roles` lo soporta; falta la regla de lectura |
| Flujo sin transporte | `requiere_transporte` reservado |
| Solicitud de baja del transportista | `baja_solicitada` reservado |
| Banda horaria como rango parseable | Hoy es `"Tarde (12-18hs)"`, un string. Sin rango no se puede validar el horario de carga contra él |

## Del lado del Apps Script

| Acción | Estado |
| --- | --- |
| `borrar_despacho` | **no existe** — hace falta para cancelar y suspender |
| `borrar_adjunto` | **no existe** |
| Ruteo por producto | hoy hardcodeado; hay que adaptarlo al ABM |

El script no está en el repositorio: vive solo en Google, en la cuenta de Marcos.
Antes de tocarlo hay que conseguir acceso y versionarlo, o se pierde la única
copia.

## Sobre el motor

Estos datos son relacionales y una base SQL los expresaría mejor: una FK haría
imposible un despacho apuntando a una entrega inexistente, y un `CHECK` haría
imposible el estado congelado.

Lo que juega en contra es operativo: hoy no hay backend —el portal es React
estático y la app habla directo con Firestore—, y el offline de la app es lo más
difícil de reemplazar. Un camión sin señal: Firestore encola las escrituras y las
manda al volver la cobertura.

Queda anotado, no decidido. Este modelo se traduce a tablas casi línea por línea.

---

*Explora S.A. — modelo de datos to-be*
