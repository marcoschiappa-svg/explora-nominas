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

<!-- v1.2.0 (Paso 0.2 de RF-02) -- Corregido para que coincida con el código
     (`logica-viajes.js`, `finalizarViaje()`/`validarCierreManual()`, y
     `ModalCierreManual.js`): el cierre manual SÍ vale desde `RECIBIDO`, no
     solo desde `EN_VIAJE`. Esta sección decía "EN_VIAJE únicamente" y
     "RECIBIDO queda afuera" -- eso describía un comportamiento viejo (ver
     el encabezado "v2 (2026-09-18)" de `logica-viajes.js`, que ya lo
     extendió a `RECIBIDO`) que quedó sin actualizar acá. -->

**Quién:** coordinador o admin. **Desde:** `RECIBIDO` o `EN_VIAJE`.

**Por qué también desde `RECIBIDO`:** un chofer nominado que nunca inició el
viaje en la app —olvido, celular sin señal, camión que ya salió con papeles
y patente puestos— deja el viaje en `RECIBIDO` para siempre si el cierre
manual solo valiera desde `EN_VIAJE`. El coordinador tiene que poder cerrarlo
igual.

**Entrada:** motivo obligatorio, de una lista cerrada (`MOTIVOS_CIERRE_MANUAL`
en `ModalCierreManual.js`, con "Otro" + detalle obligatorio); fecha y hora de
fin obligatoria.

**Escribe:** lo mismo que finalizar, con `cerrado_por: "manual"`,
`cierre_motivo`, y **sin posición de fin** — el coordinador no sabe dónde estaba
el camión, e inventarla sería peor. Si el viaje venía de `RECIBIDO`, tampoco
tiene posición ni hora de INICIO — nunca se inventa un dato que no se tiene,
ni siquiera para completar el registro.

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

### v1.2.0 — navegación por modales

Clic en una fila de la lista abre el **modal de edición** — ya no hay una
vista de formulario a pantalla completa. Los botones de la fila no propagan
el clic (`stopPropagation`).

**Domicilios**, **Usuarios** y **Productos** (este último, solo en
transportistas) abren modales propios en vez de reemplazar la pantalla.
**Nunca hay dos modales abiertos a la vez**: desde el panel "RESUMEN" del
modal de edición, los enlaces "Gestionar X" reemplazan el modal actual por
el correspondiente, pidiendo confirmación antes si hay cambios sin guardar.

**Solo lectura:** si el rol no puede editar una organización (por ejemplo, un
comercial sobre un transportista), el modal de edición se abre con los
campos deshabilitados, sin botón "Guardar" y con la leyenda "Solo lectura".

**Domicilios — el coordinador ya no queda bloqueado.** Antes, un coordinador
sin rol comercial no podía ver el botón "Domicilios" porque la pantalla de
Domicilios bloqueaba el acceso entero para cualquiera que no fuera admin o
comercial (limitación que había dejado anotada RF-07). Ahora el botón está
siempre disponible y el modal decide: ese rol ve la lista de domicilios sin
ninguna acción (sin alta, vincular, desvincular ni marcar principal).

**Usuarios** (modal, solo visible para admin/coordinador sobre un
transportista): si la organización es transportista, además de la lista se
puede dar de alta un usuario nuevo — el admin elige entre Transportista y
Chofer, el coordinador solo puede crear Transportista. El alta de chofer
pide DNI (de ahí sale el correo de acceso) en vez de correo. La clave se
muestra una sola vez, igual que en `Usuarios.js`. Editar o desactivar un
usuario existente sigue haciéndose solo desde `Usuarios.js`.

**Productos** (modal, en transportistas): el checklist de productos que
transporta (RF-08) salió del formulario de edición y vive en su propio
modal. Admin y coordinador editan; el comercial ve los chips en solo
lectura. "Guardar" sigue escribiendo solo `productos_ids`.

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

## Calendario operativo — v1.2.0 (RF-10)

**Dos tipos**, sobre `calendario_operativo` (un documento por fecha) o la
regla semanal de `calendario_reglas/semanal`:

- **`sin_operacion`**: bloquea CUALQUIER tipo de pedido en la fecha de carga.
- **`sin_despacho`**: bloquea solo `"Entrega al cliente"` en la fecha de
  carga. `"Entrega en planta"` y `"Retiro de Proveedores"` se permiten igual.

**Precedencia:** un día marcado explícitamente y `estado: 'activo'` gana
sobre la regla semanal. Un día desactivado NO anula la regla semanal — sigue
rigiendo sola. No existe un tipo "abierto" que anule la regla semanal para un
día puntual: para abrir un domingo puntual con "domingos sin operación"
activo como regla, hoy no hay forma.

**Dónde bloquea, dónde advierte:**

| Acción | Fecha | Efecto |
| --- | --- | --- |
| Crear despacho (`aceptarEntrega`) | Carga | **Bloquea** — en la pantalla y dentro de `logica-despachos.js` |
| Reprogramar despacho (`editarDespacho`) | Carga | **Bloquea**, igual |
| Alta de pedido, editar fecha de una entrega, agregar entregas | Entrega | **Advierte** — deja guardar |
| Carga masiva | Entrega (por fila) | **Advierte** — la fila se carga igual |

El bloqueo real vive en la función de lógica (`logica-despachos.js`), no solo
en la pantalla: la validación en `Programacion.js` es la misma regla
evaluada del lado del cliente, para no dejar que el coordinador se entere
recién por el error de Firestore.

---

## Ciclo de vida — v1.2.0 (RF-05)

Vista de solo lectura (salvo el cierre manual, que ya existía en
Programación) sobre **una entrega**, no un pedido: en qué etapa está, cuándo
pasó por cada una, quién la ejecutó y cuánto tardó.

**Ocho etapas fijas:** Entrega solicitada → Despacho creado → Transporte
asignado → Aceptado → Nominado → Viaje recibido → En viaje → Entregado.

**De dónde salen los datos:** cada etapa sale de un CAMPO del documento
(`entregas.creado_en`, `despachos.creado_en`, `viajes.creado_en`/`inicio_ts`/
`fin_ts`...) para la FECHA, y de un registro de `historial` (con su
`accion` propia, excluyendo siempre `derivado: true`) para el "quién". Ver
la tabla completa de fuentes en el encabezado de `logica-ciclo-vida.js`.

**Lo que no tiene registro se muestra "Sin registro" — nunca se estima ni se
infiere.** Un viaje cerrado a mano desde `RECIBIDO` (sin que el chofer nunca
haya arrancado la app) queda con "En viaje" en "Sin registro", con la marca
"Sin inicio".

**Ramas cerradas:** los despachos rechazados o cancelados de una entrega se
muestran aparte, con sus propias etapas hasta el cierre, el motivo y quién
lo cerró — la entrega sigue con el despacho vivo, o el último.

**Marcas:** cierre manual (motivo y quién), sin inicio, demorado (atributo
del viaje), fuera de fecha (entregado después de lo solicitado), suspendida
y reactivada — todas de una fuente puntual, nunca inferidas.

---

## Tarifario — dos pantallas en paralelo, v1.2.0 (RF-09)

Cuánto sale llevar un producto de un lugar a otro. Conviven dos pantallas:

- **El Tarifario existente** (`Tarifario.js`), **sin ningún cambio**: modo
  admin por contraseña, las rutas en `portal/rutas.lista[]`, todo como
  siempre. Se retira cuando se apruebe y se adopte la pantalla nueva.
- **NuevoTarifario**, con su propio registro maestro de rutas.

**Mientras convivan las dos, las actualizaciones de tarifa se hacen en
NuevoTarifario.** Si se siguen haciendo en el Tarifario existente, los dos se
desalinean — no hay ninguna sincronización entre ambos.

### NuevoTarifario — maestras y derivadas

Una **ruta** es origen + destino + producto: **no lleva cliente**, el mismo
flete vale lo mismo lo pida quien lo pida.

**RF-09b: origen, destino y producto son texto estandarizado, no vínculos.**
No se relacionan con `organizaciones`, `domicilios` ni `productos` del
portal — son datos propios del tarifario. Al cargar una maestra o generar
una derivada, cada campo sugiere (con un `<datalist>`, se puede escribir un
valor nuevo) los valores que ya existen en el registro maestro, para
mantener la estandarización sin obligar a elegir de otra colección.

| Clase | Qué es | Quién escribe | Quién lee |
| --- | --- | --- | --- |
| **Maestra** | Las rutas del registro maestro (carga inicial + las que agregue el admin). Son datos maestros: su tarifa **solo** cambia por un indicador aprobado. | Solo admin | Admin, coordinador, comercial |
| **Derivada** | Las que un coordinador o el admin arma con el Generador, a partir de una maestra ELEGIDA. **Nunca modifican la maestra de la que dependen.** | El coordinador que la creó, o el admin | Admin, coordinador y comercial (comercial: solo lectura) |

La clase **no cambia después del alta**.

**Una sola ruta activa por origen+destino+producto**, contando maestras y
derivadas. Si se genera una ruta que ya existe, se muestra la existente en vez
de ofrecer guardar un duplicado.

### Quién hace qué

| Pestaña | admin | coordinador | comercial |
| --- | --- | --- | --- |
| Registro vigente (maestras) | Sí | Sí | Sí |
| Historial (por ruta, y general con filtros) | Sí | Sí | Sí |
| Rutas derivadas | Sí, todas | Sí, todas; edita y desactiva las suyas | Sí, solo lectura |
| Generar ruta derivada | Sí | Sí | No |
| Actualizar por indicador + pendientes + versiones | Sí | No | No |
| Nueva ruta maestra | Sí | No | No |

### Rutas derivadas: la tarifa siempre se calcula

Una derivada se genera eligiendo origen, destino y producto de los maestros y
cargando el km. La pantalla propone como maestra la vecina más cercana en km
(mismo criterio que antes tenía el Generador), y se puede elegir otra de la
lista de similares — pero la maestra elegida queda **fija**
(`ruta_maestra_id`), no se recalcula sola.

La tarifa de una derivada **nunca se guarda como verdad**: se calcula siempre
en el momento, `catac(km_derivada) × (tarifa_vigente_maestra /
catac(km_maestra))`, contra la tabla CATAC activa (la misma del Tarifario
existente, solo lectura acá). Si la maestra se actualiza, la derivada se
mueve sola — sin que nadie la toque. Una derivada cuya maestra se desactiva
queda marcada **"Maestra inactiva"**, sin tarifa calculada, hasta que se le
asigna otra (el creador o el admin).

### Las tarifas maestras: solo por indicador

**No hay edición manual tarifa por tarifa ni ajuste libre por porcentaje.**
La única vía para cambiar una tarifa maestra es aplicar un indicador, y solo
el admin puede hacerlo:

- **CATAMP:** meses con su índice, factor compuesto — se multiplica, no se
  suma: +2,26 % × +6,85 % = ×1,0926, no +9,11 %.
- **CATAC:** un porcentaje de variación.

En los dos casos se carga el nombre del indicador, el período, la
justificación y el link al informe de respaldo (si falta el link, se confirma
igual). El techo de alerta solo **avisa**, no bloquea. El alcance es todas las
maestras o una categoría.

**Flujo:** se guarda la foto en `rutas_versiones` → cada maestra afectada
queda **pendiente** → el admin revisa la tabla de pendientes y aprueba o
descarta → al aprobar, la tarifa pasa a vigente, se estampan
`tarifa_actualizada_en`/`tarifa_actualizada_por` y queda un documento en
`rutas/{id}/tarifas` con la tarifa anterior, la nueva, la variación, la
justificación y quién lo hizo. Esa subcolección es **append-only**: no se
edita ni se borra. Las derivadas **no** tienen pendientes ni historial
propio: se mueven solas cuando se aprueba la maestra.

**Restaurar una versión de `rutas_versiones`** (solo admin) NO pisa las
tarifas vigentes directo: las carga como **pendientes**, con motivo
"Restauración de versión \<fecha\>", para que pase por la misma aprobación que
cualquier otro cambio.

---

*Explora S.A. — comportamiento to-be*
