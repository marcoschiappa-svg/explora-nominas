# Comportamiento to-be

Qué hace cada acción del sistema: quién la ejecuta, desde qué estado, qué valida,
qué escribe y a quién notifica.

Estructura: `MODELO_DATOS_TOBE.md`

---

## Reglas transversales

**Todo lo que escribe más de un documento va en transacción.** Si el viaje se
cierra y el despacho no, quedan diciendo cosas distintas.

**Todo estado de partida se relee dentro de la transacción.** Hoy
`Coordinador.js` arma el array desde el estado de React sin releer: dos
coordinadores sobre el mismo pedido y el segundo pisa al primero en silencio.

**Todo cambio deja un registro en `historial`**, con los campos modificados.

**Las llamadas al Apps Script van después del commit.** Son HTTP, no entran en la
transacción. Le llegan siempre **nombres resueltos**, nunca IDs: el script rutea
al Plan de Producción comparando strings.

**Los estados se recalculan con una sola función**, nunca a mano. Toda acción que
toca un despacho recalcula su entrega, y toda acción que toca una entrega
recalcula el pedido.

**Nada se borra**, salvo adjuntos.

---

# Parte 1 — Pedido

## Crear un pedido

**Quién:** comercial, coordinador o admin.

### Antes de escribir

El formulario resuelve todo contra colecciones existentes: cliente de
`organizaciones` con `es_cliente`, producto de `productos` activos, domicilios de
`organizacion_domicilios`.

| `tipo` | origen | destino |
| --- | --- | --- |
| Entrega al cliente | planta de Explora (automático) | domicilios del cliente |
| Entrega en planta | domicilios del cliente | planta de Explora (automático) |
| Retiro de Proveedores | domicilio del proveedor | planta de Explora (automático) |

La planta sale de `organizacion_domicilios` de la organización con `es_propia`.
Deja de estar hardcodeada.

**Si el cliente o el domicilio no existen, no se crean al vuelo:** se dan de alta
formalmente y después se seleccionan. Es lo que evita las 50 direcciones para 34
lugares.

### Valida

1. Cliente, producto, tipo y los dos domicilios seleccionados
2. `volumen > 0`
3. OV de 4 dígitos, u OC de 5
4. Toda entrega tiene volumen y fecha, ninguna pasada
5. **La suma de las entregas es igual al volumen del pedido** — hoy no se valida

### Escribe

```
contadores/pedidos       leer → +1 → escribir
pedidos/{auto}           numero, estado: pendiente
entregas/{auto} × N      numeradas 1..N, estado: pendiente
adjuntos/{auto} × M
historial                accion: "crear_pedido"
```

**Siempre al menos una entrega.** Si no se carga cronograma, se crea una con el
volumen total y la fecha comprometida.

**Un solo registro de historial**, no uno por entrega: es una sola acción.

### Después

Apps Script: notificación al coordinador. **No escribe en el Plan de
Producción** — eso pasa recién cuando el coordinador acepta la entrega.

### Los adjuntos

Se suben a Drive antes de la transacción, porque necesitan el número de pedido.
Eso obliga a reservar el correlativo primero.

**Si falla una subida, no se crea el pedido.** Hoy se crea sin el adjunto y el
comercial cree que quedó completo.

### La carga masiva

Mismas validaciones sobre todas las filas **antes** de escribir nada. Las filas
con error quedan editables en pantalla; no se escribe hasta que estén todas bien;
si el usuario no corrige, cancela y no se crea ninguna.

Hoy crea las buenas y descarta las malas, y el comercial no sabe qué pasó con
las descartadas.

Cada pedido es su propia transacción: si una falla por conflicto en el contador,
se reintenta sin afectar a las demás.

---

## Editar un pedido

### Los tres grupos de campos

**Inmutables con despachos vivos** — cliente, OV, producto, recipiente. Si están
mal: se suspende el pedido y se crea otro.

**Editables sin consecuencias** — observaciones, banda horaria.

**Editables con consecuencias** — volumen, domicilios, fecha de una entrega.

---

## Cambiar el domicilio

**Quién:** comercial o admin.

Contempla el caso del cliente que prefiere recibir en otra de sus plantas.

**Valida:** el domicilio nuevo está entre los de la organización; **ningún viaje
del pedido está `EN_VIAJE`**.

**Escribe:**

```
pedidos/{id}         destino_domicilio_id (u origen)
despachos vivos      destino_texto = el nuevo    ← se actualizan, NO se cancelan
viajes en RECIBIDO   destino_texto = el nuevo
historial            accion: "cambiar_destino"
```

**El despacho no se cancela:** el camión sigue sirviendo, cambia adónde va, no
cuándo sale. A diferencia de la fecha.

**Notifica a todos los implicados:** transportistas, coordinadores y choferes con
viaje en `RECIBIDO`.

---

## Cambiar la fecha de una entrega

**Quién:** comercial o admin.

El caso que lo motiva: el cliente no lo quiere más para mañana.

**Escribe:**

```
entregas/{id}    fecha_solicitada = la nueva
                 estado = pendiente

despacho vivo de esa entrega:
                 estado = CANCELADO
                 cancelacion_motivo = "cambio de fecha de la entrega"

pedidos/{id}.estado = recalculado
historial        accion: "reprogramar_entrega"
```

**La fila sale del Plan de Producción** — Apps Script `borrar_despacho`, la
acción que hoy no existe. Sin ella quedan dos filas: la vieja y la nueva.

**Notifica al transportista.**

El coordinador ve la entrega en `pendiente` y crea un despacho nuevo con la fecha
nueva. Eso es aceptar una entrega, la acción que ya existe.

---

## Editar el volumen

### El principio

El volumen es lo que se edita. **La cantidad de entregas es consecuencia.** Las
entregas que quedan van a sumar el volumen nuevo o más, y eso alcanza: no se
valida que la suma dé exacta.

### El piso

```
volumen_minimo = suma de las entregas programadas o cumplidas
```

**No se puede bajar de ahí. Punto.** Si hay 15 tn asignadas, el mínimo es 15. Para
bajar más, el coordinador cancela despachos primero — el comercial no toca lo que
ya está en marcha.

### Bajar

**Entrada:** el volumen nuevo, y qué entregas se suspenden. **Se le ofrecen solo
las entregas en `pendiente`.**

**Valida:** `volumen_nuevo >= volumen_minimo`, `> 0`, y que las elegidas sigan en
`pendiente` — releído, por si el coordinador acaba de asignar una.

**Escribe:**

```
pedidos/{id}.volumen = el nuevo
entregas elegidas: estado = suspendida
pedidos/{id}.estado = recalculado
historial            accion: "editar_volumen"
```

**Las entregas que quedan no se tocan.** No cambian de estado, no vuelven sobre
la marcha, no cambian su curso.

**No se cancela ningún despacho** — las suspendidas no tenían uno. **No se llama
al Apps Script** — no hay filas que borrar.

### Subir

Se agregan entregas nuevas, numeradas desde el mayor existente + 1, en
`pendiente`. **Nunca se aumenta el volumen de una entrega existente.**

### Reactivar una entrega suspendida

Vuelve a `pendiente` si el volumen del pedido lo permite:

```
volumen del pedido >= volumen comprometido + volumen de esta entrega
```

---

## Suspender un pedido

**Es terminal. Sin vuelta atrás.** Suspender y cancelar son lo mismo.

**Quién:** comercial que lo creó, coordinador o admin. Motivo obligatorio.

**Valida:** ningún viaje del pedido está `EN_VIAJE`.

**Escribe:**

```
pedidos/{id}     estado = suspendido, suspension_motivo, suspension_ts
entregas no cumplidas  → suspendida
despachos vivos        → CANCELADO
historial        accion: "suspender_pedido"
```

**Las entregas cumplidas y sus despachos entregados no se tocan.** Son historia:
esos camiones fueron y descargaron.

**Un viaje en curso bloquea la suspensión.** El camión está en la ruta; suspender
no lo detiene. Se resuelve por teléfono y se suspende cuando el viaje cierra.

**Después:** Apps Script `borrar_despacho` por cada cancelado. Notifica a todos
los implicados.

---

# Parte 2 — Despacho

## Aceptar una entrega

**Quién:** coordinador o admin. Es la primera acción que escribe en el Plan.

**Entrada:** la entrega, fecha de carga, horario, transportista (opcional).

**Valida:**

1. La entrega existe, es del pedido y **no tiene despacho vivo** — releído: dos
   coordinadores podrían aceptar la misma al mismo tiempo
2. El pedido no está suspendido
3. **Fecha de carga entre hoy y la `fecha_solicitada` de esa entrega** — hoy solo
   se valida el techo, y en el HTML
4. **Horario dentro de la banda horaria del pedido** *(pendiente: `banda_horaria`
   tiene que ser un rango parseable)*
5. Si eligió transportista: existe, `es_transportista`, activo, y tiene al menos
   un usuario activo con email

**El volumen no se ingresa:** se copia de la entrega.

**Escribe:**

```
numero = mayor numero de los despachos del pedido + 1    ← releído
despachos/{auto}   estado = ASIGNADO si eligió transportista
                            PENDIENTE_ASIGNACION si no
entregas/{id}.estado = programada
pedidos/{id}.estado  = recalculado
historial            accion: "aceptar_entrega"
```

Los denormalizados se resuelven desde los IDs del pedido, nunca de un formulario.

**Después:** Apps Script `programar_despacho` — escribe la fila en el Plan. Mail
al transportista solo si se asignó uno.

---

## Asignar transportista

**Quién:** coordinador o admin. **Desde:** `PENDIENTE_ASIGNACION`.

**Entrada:** solo el transportista. Fecha, horario y volumen ya están definidos.

**Valida:** estado releído; pedido no suspendido; organización existe, es
transportista y está activa; **tiene al menos un usuario activo con email** — sin
correo no se entera del despacho.

**Escribe:**

```
despachos/{id}   estado = ASIGNADO, estado_ts
                 transportista_org_id
                 transporte_nombre = resuelto desde la organización
pedidos/{id}.estado = recalculado
historial        accion: "asignar_transportista"
```

**`transporte_nombre` se resuelve desde la organización, nunca se copia del
formulario.** Hoy `transporte` y `transporte_id` son independientes y pueden
apuntar a empresas distintas — y eso es lo que rompe la nominación.

**No se copian emails ni teléfonos.** Se resuelven al notificar.

**Después:** Apps Script `asignar_transportista`. Mail al transportista, con los
destinatarios resueltos **en ese momento** desde los usuarios de la organización.

## Reasignar

Misma acción **desde `ASIGNADO` únicamente**. Una vez que aceptó, se compromete:
el camino es que rechace o pida la baja.

Historial: `accion: "reasignar"`, con el anterior en `antes`.

---

## Editar un despacho

**Quién:** coordinador o admin.
**Desde:** `PENDIENTE_ASIGNACION`, `ASIGNADO` o `ACEPTADO`.

**Una vez nominado no se edita.** Hay un chofer con el viaje en la app y un
camión reservado. Si está mal, se cancela.

**Qué se edita:** fecha de carga y horario. **El transportista no** — para eso
está reasignar. Hoy están en la misma función y se puede cambiar el transportista
de un despacho nominado sin ninguna validación.

**Valida:** estado releído; fecha entre hoy y la `fecha_solicitada`; horario en
la banda; pedido no suspendido; algo cambió.

**Escribe:** `fecha_carga`, `horario_carga`, `actualizado_en`, historial.

**No toca el estado.** Un despacho `ACEPTADO` sigue `ACEPTADO`: el transportista
aceptó el viaje, no la fecha exacta.

**No toca la entrega ni el pedido.** Su estado no depende de qué día carga.

**Después:** Apps Script `editar_despacho`. Mail al transportista si hay uno.

---

## Cancelar un despacho

**Quién:** coordinador o admin. Motivo obligatorio.

Es la acción que hoy no existe, y por eso el coordinador no puede deshacer nada:
si asignó mal, tiene que pedirle al transportista que rechace.

**Desde:** cualquier estado vivo, **hasta `NOMINADO` con el viaje en `RECIBIDO`**.

**No se puede con el viaje `EN_VIAJE`:** el camión está en la ruta, cancelarlo no
lo detiene y le saca el viaje de la app mientras maneja.

**Escribe:**

```
despachos/{id}   estado = CANCELADO, cancelacion_motivo
viajes/{id}      estado = CANCELADO      ← si tiene
entregas/{id}.estado = recalculado       → vuelve a pendiente
pedidos/{id}.estado  = recalculado
historial        accion: "cancelar_despacho"
```

**El viaje se cancela, no se borra.** Conserva su ID, su historial y sus puntos.

**Después:** Apps Script `borrar_despacho`. Notifica al transportista y al chofer
si había viaje.

**Queda visible.** Un `D3` cancelado y un `D8` vivo pueden apuntar a la misma
entrega: es la historia de que se intentó.

### La cadena que destraba

```
pedido de 20, 15 asignadas, el comercial quiere bajar a 12
    → el comercial no puede: el piso es 15
    → el coordinador cancela despachos hasta liberar 3 tn
    → esas entregas vuelven a pendiente
    → el piso baja a 12
```

Dos personas, dos acciones, cada una en su alcance. Es también el camino para
reprogramar: cancelar y aceptar la entrega de nuevo.

---

# Parte 3 — Transportista

## Cómo llega a sus despachos

```
where('transportista_org_id', '==', suOrganizacion)
```

Hoy trae **todos** los pedidos y filtra en memoria. Y el vínculo es con el
**usuario**: si una empresa tuviera dos personas con acceso, cada una vería solo
lo suyo. Con la organización, las dos ven lo de la empresa.

## Aceptar

**Desde:** `ASIGNADO` únicamente.

**Valida:** estado releído; es de su organización; **el pedido no está
suspendido** — hoy no se valida.

**Escribe:** `estado = ACEPTADO`, recalcula entrega y pedido, historial.

**El pedido no pasa a `Aceptado`.** Hoy `aceptar()` lo escribe sin mirar los
otros despachos: un pedido con tres despachos donde uno se acepta queda marcado
como aceptado entero.

**`nominacion_pendiente` no se escribe.** Que esté en `ACEPTADO` ya significa que
falta nominar.

**Aceptar es un compromiso.** A partir de acá se obligó a poner un chofer.

**Después:** Apps Script `confirmar_despacho`, mail al coordinador.

## Rechazar

**Desde:** `ASIGNADO` únicamente. **Motivo obligatorio.**

Una vez aceptado no puede rechazar. Si no puede cumplir, solicita la baja al
coordinador *(fuera de alcance: `baja_solicitada` reservado)*.

**Escribe:** `estado = RECHAZADO`, `rechazo_motivo`, recalcula entrega —vuelve a
`pendiente`— y pedido, historial.

**El pedido no vuelve a `pendiente`** salvo que fuera su única entrega. Hoy
`rechazar()` lo manda directo y el coordinador lo ve como si no hubiera hecho
nada.

**El transportista sigue viendo el despacho rechazado:** es su constancia.

**Después:** Apps Script `rechazar_despacho`, mail al coordinador.

## Nominar

**Desde:** `ACEPTADO`. **Crea el viaje.**

**Entrada:** chofer y camión, elegidos por separado.

```
choferes:  where('organizacion_id','==',suOrg)
           where('roles','array-contains','chofer')
           where('estado','==','activo')
camiones:  where('organizacion_id','==',suOrg)
           where('estado','==','activo')
```

**Valida:**

1. Estado releído, es de su organización, pedido no suspendido
2. El chofer es de su organización — **comparación de IDs, no de strings.** Hoy
   compara `chofer.empresa` contra `despacho.transporte` y son `"Transporte RAD"`
   y `"RAD"`: rechaza nominaciones válidas
3. El chofer tiene `datos_chofer.dni`
4. **El chofer tiene cuenta de Auth.** Hoy no se valida: Walter Caballero está en
   el padrón sin `uid` ni `email`. Si lo nominan, el viaje no le aparece nunca
5. El camión es de su organización y está activo

Si el chofer no existe, puede darlo de alta en el momento o ir al ABM.

**Escribe:**

```
despachos/{id}   estado = NOMINADO
                 chofer_uid, chofer_dni, camion_id
                 patente_tractor, patente_semi     ← copiadas del camión

viajes/{auto}    estado = RECIBIDO
                 despacho_id, pedido_id, chofer_uid, chofer_dni,
                 transportista_org_id, puntos_registrados: 0
                 + los denormalizados de la pantalla del chofer

entregas y pedido recalculados
historial        accion: "nominar"
```

**El viaje se crea al nominar, no al arrancar:** el chofer tiene que verlo antes.

**La nominación es irreversible.** No hay renominar: cambiar hasta que el chofer
se presenta en la puerta requiere hardware que no existe. Si hay que cambiarlo,
se cancela el despacho.

**Después:** Apps Script `nominar_unidad`. Al chofer no se le notifica: el viaje
le aparece en la app.

---

# Parte 4 — Chofer

Desde la app o desde su pantalla del portal. Las dos hacen lo mismo.

```
where('chofer_dni', '==', suDni)
where('estado', 'in', ['RECIBIDO', 'EN_VIAJE'])
```

**Lee una sola colección.** Todo lo que su pantalla muestra está denormalizado en
el viaje.

## Iniciar

**Desde:** `RECIBIDO`. **Valida:** el viaje es suyo; el pedido no está
suspendido; **no tiene otro viaje `EN_VIAJE`** — hoy nada lo impide.

**Escribe:** `estado = EN_VIAJE`, `inicio_ts`, `inicio_lat/lng/precision/origen`.

**No toca el despacho:** sigue en `NOMINADO` hasta que el viaje cierre.

**`inicio_origen`** distingue posición real de última conocida: si arranca sin
señal, queda registrado que el punto no es confiable.

**El GPS arranca acá.**

## Reportar demora

**No cambia el estado.** El camión sigue andando, va tarde.

**Escribe:** `demorado = true`, `demora_motivo` (texto libre), `demora_ts`.

**Queda marcado hasta el final:** es información del viaje, no un semáforo.

## Finalizar

**Desde:** `EN_VIAJE`. Cierre en cascada, en transacción:

```
viajes/{id}      estado = FINALIZADO, fin_ts, fin_lat/lng/precision/origen
                 cerrado_por = "chofer"
despachos/{id}   estado = ENTREGADO       ← acá se destraba
entregas/{id}    estado = cumplida
pedidos/{id}     estado = recalculado
historial        accion: "finalizar_viaje"
```

**Este es el punto que hoy no existe.** El chofer finaliza, `estado_chofer` pasa
a `finalizado`, y el despacho sigue diciendo `"Nominado"` para siempre.

**El GPS se detiene** y se vacía el buffer pendiente.

## Lo que no puede hacer

- **Volver atrás.** `FINALIZADO` es terminal para él.
- **Tocar el despacho.** Las reglas se lo impiden y no lo necesita.
- **Iniciar dos viajes a la vez.**

---

## El GPS

```
iniciar → arranca el servicio
    cada 30s: posición → buffer local
    cada 10 puntos (~5 min) o por antigüedad: descargar
finalizar → descarga final → detener
```

**Un `writeBatch`:** los puntos con `setDoc` usando el timestamp como ID, más la
actualización del viaje (`ultima_lat/lng/ts`, `puntos_registrados`).

**Escribir primero, limpiar el buffer después.** Si se limpia primero y la
escritura falla, esos puntos se perdieron. *(Ya está así en el código actual.)*

**5 minutos de atraso es lo tolerado** por el coordinador mirando el mapa.

**`saludGPS`** hace visible el hueco mientras pasa, en vez de descubrirlo
revisando el recorrido después.

### Lo que hay que arreglar en la app

**Dos suscripciones de ubicación activas a la vez** llamando a `registrarPunto`
con la misma lectura. Es el origen de los duplicados: coordenadas idénticas con
timestamps a milisegundos de distancia.

*(Los permisos de primer plano y `POST_NOTIFICATIONS` ya están resueltos en el
código vigente.)*

**Sigue abierta** la hipótesis del hueco de 30 minutos: el sistema operativo
congelando el proceso por batería baja. La prueba controlada —batería sobre 60%,
TrackEx en "Sin restricciones"— es independiente de todo esto.

---

## Cerrar un viaje a mano

**Quién:** coordinador o admin. **Desde:** `EN_VIAJE` únicamente.

**`RECIBIDO` queda afuera:** un viaje que nunca arrancó no se puede dar por
entregado. Si el camión no fue, se cancela el despacho.

**Entrada:** motivo obligatorio; fecha y hora de fin opcional.

**Escribe:** lo mismo que finalizar, con `cerrado_por: "manual"`,
`cierre_motivo`, y **sin posición de fin** — el coordinador no sabe dónde estaba
el camión, e inventarla sería peor.

Sin `cerrado_por`, un viaje sin posición de fin parece un viaje con GPS roto.

---

# Parte 5 — ABM

**Nada se borra. Todo se desactiva.** Un registro inactivo no aparece en los
selectores y sigue visible en todo lo histórico.

## Organizaciones — admin y comercial

**El comercial no elige banderas:** siempre crea con `es_cliente: true`. Solo
admin ve la pregunta y puede marcar las dos.

**Valida:** razón social no vacía; CUIT único, normalizado sin guiones ni
espacios —hoy conviven `"20-25505747-3"` y `"20438430122"`, y uno arranca con
espacio—; al menos una bandera.

**Edición:** todo salvo `es_propia`.

**Quitar una bandera:** solo sin nada vivo que dependa de ella.

**Desactivar:** solo sin pedidos ni despachos vivos.

## Domicilios y vínculos — admin y comercial

Son dos ABM: **el domicilio existe; el vínculo dice quién lo usa.**

**Alta:** calle, ciudad y provincia obligatorios. **Al guardar se busca si ya
existe uno parecido** —misma ciudad, calle similar— y se avisa antes de crear. Es
lo único que evita las siete formas de escribir la planta de Explora.

**El vínculo:** organización, domicilio, alias opcional, si es principal.

**Desvincular:** solo si ningún pedido vivo lo usa.

**`verificado`** lo marca admin sobre los que entraron por migración. Es la cola
de limpieza.

## Productos — solo admin

**Valida:** nombre único.

**No se edita el nombre con pedidos vivos:** el despacho lleva `producto_nombre`
denormalizado y el Apps Script rutea por nombre.

**Desactivar:** solo sin pedidos vivos.

## Camiones — el transportista, y admin

`organizacion_id` es la del transportista que lo crea, **siempre** — nunca se
elige.

**Valida:** formato argentino `AA123AA` o `ABC123`, normalizado a mayúsculas sin
espacios. Patente de tractor única dentro de la organización.

**Desactivar:** solo si no está nominado en un despacho con viaje `RECIBIDO` o
`EN_VIAJE`.

## Usuarios — admin, y el transportista sobre sus choferes

### El alta

```
1. Auth: crear cuenta                    ← fuera de la transacción
2. usuarios/{authUid}: el perfil
3. historial
```

**Si falla el paso 2, se borra la cuenta del paso 1.** Ese descalce es el origen
de los 5 huecos entre las 70 cuentas de Auth y los 65 perfiles.

**Trampa del SDK:** `createUserWithEmailAndPassword` deja logueado al usuario
recién creado. El admin crearía un chofer y quedaría logueado como ese chofer. Se
resuelve con una instancia secundaria de Firebase App solo para el alta.

**La clave se genera y se muestra una sola vez.** No se guarda.

| Quien crea | Puede crear |
| --- | --- |
| **Admin** | cualquier rol, cualquier organización |
| **Transportista** | solo `chofer`, solo con **su** `organizacion_id` |

El transportista carga nombre, DNI, CUIT y teléfono. El email se genera como
`{dni}@explora-portal.com`.

### Edición

**El DNI es inmutable.** Es la identidad de la persona y la app filtra por él. Si
está mal, se desactiva y se crea de nuevo.

**El rol lo cambia solo admin.**

**La organización solo la cambia admin**, y solo sin viajes ni despachos vivos.

### Desactivar

Se bloquea si tiene un viaje `EN_VIAJE`. *(`RECIBIDO` no bloquea: el chofer
todavía no arrancó.)*

**El acceso se corta:** el login verifica `estado === 'activo'`. La cuenta de
Auth sigue existiendo, así que se puede reactivar sin recrear nada.

---

## Adjuntos

**Subir:** Apps Script `subir_adjunto` → `file_id`, después el documento. Si
falla la subida, no se escribe nada. Valida pedido no suspendido y un tope de
tamaño: van en base64 dentro de una llamada HTTP.

**Marcar visible:** coordinador o admin, no el comercial — decidir qué ve un
tercero es del coordinador. El transportista lo ve inmediatamente, sin
notificación.

**Borrar:** quien lo subió, o admin. **Acá sí se borra de verdad**: nada lo
referencia. El historial conserva que existió.

**No se puede borrar si es visible y hay despachos vivos.** Primero se le saca la
visibilidad.

**Descargar:** los permisos los controla Drive, no Firestore.

⚠ **Verificar cómo está compartida la carpeta.** Si los archivos son públicos con
el link, `visible_transportista` no protege nada: el `file_id` está en un
documento que el transportista puede leer.

---

## Login

```
1. Firebase Auth valida la contraseña
2. leer usuarios/{authUid}
3. si no existe          → cerrar sesión, "cuenta sin perfil"
4. si estado != activo   → cerrar sesión, "cuenta desactivada"
5. rutear según roles
```

**El paso 3 es lo que hoy no existe**, y por eso alguien puede estar en el padrón
sin poder entrar sin que nadie lo sepa.

**El paso 5 con `roles` como array:** si tiene más de uno, elige al entrar.

---

*Explora S.A. — comportamiento to-be*
