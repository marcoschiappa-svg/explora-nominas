### SEÑALIZACIÓN DE LA VERSIÓN ACTUAL - MANTENER ACTUALIZADO

VERSION_ACTUAL: 1.2.1

# Changelog — Portal Explora

Versionado semántico: **MAYOR.MENOR.PARCHE**

- **PARCHE** (x.x.N): fixes, detalles, cambios menores
- **MENOR** (x.N.x): nuevas funciones, cambios medianos
- **MAYOR** (N.x.x): reescritura completa del portal, o una decisión de gran impacto

Cada versión, además de esta entrada, se marca con un tag de git con el
formato `Portal-vX.Y.Z` (por ejemplo `Portal-v1.0.1`).

Las versiones más nuevas van arriba.

---
## v1.2.1 — 5/10/2026

**Reorganización interna, sin cambios visibles.** `estados.js`, `datos.js`,
`logica-viajes.js` y `ui/tokens.js` (con el test de `logica-viajes`) se mudan
a `src/shared/`, el código que va a compartir la app TrackEx. Los archivos de
`shared/` ya no importan `./firebase`: `crear`, `actualizar`, `desactivar`,
`reactivar`, `enTransaccion(db, fn)`, `iniciarViaje`, `reportarDemora`,
`finalizarViaje` y `registrarPuntos(db, ...)` reciben `db` por parámetro y
fallan con un mensaje claro si falta. Todos los llamadores se actualizaron.

---
## v1.2.0 — 2/10/2026

**Paso 0 — Ajustes de RF-02.** `COMPORTAMIENTO.md` corregido: el cierre
manual de un viaje vale desde `RECIBIDO` o `EN_VIAJE` (decía "`EN_VIAJE`
únicamente", desactualizado desde que `logica-viajes.js` lo extendió a
`RECIBIDO`). El conmutador "Viajes abiertos vencidos" de Programación deja
su clave propia de `localStorage` y pasa a vivir dentro del mismo objeto de
preferencias que el resto de los filtros (`filtros-listado.js`, campo
`soloVencidos`); la clave vieja se migra una sola vez y se borra
(`migrarSoloVencidosLegacy` en `Programacion.js`). `App.test.js` — el test
por defecto de Create React App ("learn react"), roto desde antes de RF-01
— se reemplaza por un smoke test sobre `modulos.js`.

**RF-03 — Usuario transportista desde Organizaciones.** La validación y el
alta completa de un usuario (cuenta de Firebase Auth + perfil en
`usuarios/{uid}`) se sacan de `Usuarios.js` a `src/alta-usuarios.js`
(`validarAltaUsuario`, `darDeAltaUsuario`) — una sola implementación, que
ahora reusa también `Organizaciones.js`. Al dar de alta una organización
`es_transportista`, se ofrece (con opción de saltear) crear en el mismo
flujo su usuario transportista: nombre, email y teléfono, con
`organizacion_id` fijo y `roles: ['transportista']`; la clave se muestra
una sola vez, mismo patrón que `Usuarios.js`. El detalle de una
organización transportista (botón "Usuarios" en la lista, admin y
coordinador — el comercial no lo ve) lista sus usuarios y ofrece el mismo
alta si ninguno tiene el rol `transportista`; editar y desactivar siguen
siendo cosa de `Usuarios.js`.

**`firestore.rules.produccion` cambia por RF-03**: en `usuarios`, el
coordinador puede crear un documento con `roles: ['transportista']` cuando
la organización de destino es `es_transportista == true`
(`usuarioTransportistaValidoDelCoordinador()`) — cualquier otro rol sigue
siendo exclusivo del admin.

**RF-04 — Importación de choferes, tractores y acoplados.** Un
transportista (o un admin en su nombre) importa su flota desde un Excel,
con el mismo mecanismo que la carga masiva de pedidos: descargar plantilla
(generada en el navegador con SheetJS, tres hojas — Choferes, Tractores,
Acoplados) → subir el archivo completo → vista previa por hoja, fila por
fila, con estado (nueva / existente / con error) → confirmar (solo se
escriben las filas nuevas; error y existentes se informan, no se tocan) →
progreso → resumen. Entra desde "Importar desde Excel" en Mi Flota
(`Camiones.js`), visible para admin y transportista — nunca coordinador,
que no puede crear choferes.

La validación de cada chofer es `validarAltaUsuario()`
(`src/alta-usuarios.js`) y la de cada tractor/acoplado es `validarUnidad()`
(`src/logica-flota.js`, nuevo — ahí también se mudan
`normalizarPatente`/`patenteValida`/`mostrarPatente`, que antes vivían en
`Camiones.js`): la misma función que usa el formulario, sin una segunda
implementación de la misma regla. `src/importar-flota.js` (nuevo) es la
interpretación pura de la planilla: agrega solo lo que un alta de a una no
necesita — duplicado dentro del propio archivo (error) y fila "ya cargada"
(existente, se saltea). Tope de 100 filas por hoja, igual que la carga
masiva de pedidos; una hoja que lo supera se rechaza entera.

Si se creó al menos un chofer, un botón "Descargar credenciales" genera con
SheetJS un `.xlsx` (Nombre, DNI, Contraseña) — se puede descargar una sola
vez por importación, después queda deshabilitado. Las contraseñas viven
solo en el estado del componente (`ImportarFlota.js`, nuevo) y nunca se
escriben en Firestore, `localStorage` ni consola; si se sale de la pantalla
sin descargarlas, se avisa que se pierden.

No hacen falta reglas nuevas para RF-04: el chofer se crea con la misma
regla que ya usa `Usuarios.js` (admin, o transportista sobre su propia
organización), y las unidades con la de `Camiones.js`.

**RF-01 — Filtros y orden en Pedidos y Programación.** Una sola barra de
filtros y orden, construida una vez (`src/filtros-listado.js` para la lógica
pura, `src/ui/BarraFiltros.js` para la presentación) y usada por
`Pedidos.js` y `Programacion.js` — lo que el encabezado v1.1.3 de
`Pedidos.js` dejaba explícitamente pendiente para esta versión. Todo el
filtrado y el orden son en memoria sobre lo que cada pantalla ya carga: sin
consultas nuevas a Firestore, sin índices ni reglas nuevas.

Filtros nuevos, selección múltiple combinada con Y entre filtros distintos
y con O dentro del mismo filtro: cliente, producto, tipo de operación y
creado por (las dos pantallas); transportista, con la opción extra "Sin
asignar", y fecha de carga (solo Programación); fecha de creación (solo
Pedidos). Los rangos de fecha (entrega/creación/carga) tienen los atajos
Hoy, Próximos 7 días, Este mes y Personalizado, con bordes inclusivos.
"Solo sin cubrir" (Programación) pasa a vivir dentro del mismo objeto de
filtros, con el mismo criterio de siempre (`entregaSinCubrir`). "Mis
pedidos"/"Todos" (Pedidos) no cambia: sigue siendo un alcance aparte, por
fuera de la barra.

Orden con sentido ascendente/descendente en los dos, "sin dato al final" en
los dos sentidos y desempate estable por número de pedido. Pedidos suma
"Producto" y "Creado por" a los cuatro criterios que ya tenía; Programación
—que no tenía orden elegible— suma los seis, con "Fecha de entrega más
próxima" ascendente por defecto y "Fecha de carga más próxima" (la menor
entre los despachos vivos del pedido) como el único criterio nuevo propio
de esa pantalla.

Los conteos de las pastillas de estado se calculan con todos los demás
filtros ya aplicados. "Limpiar filtros" (visible solo con algún filtro
activo) limpia filtros, texto y pastilla de estado, pero no toca el orden
ni "Mis pedidos"/"Todos". Las opciones de cada selector salen de los datos
presentes en la pantalla, no de la colección entera — un cliente sin
pedidos no se ofrece.

Persistencia por usuario y por pantalla en `localStorage`
(`explora:listado:v1:<pantalla>:<uid>`), con debounce de 300ms: selecciones,
rangos (el id del atajo, no fechas fijas, salvo en "Personalizado"),
pastilla de estado, orden y sentido, "Solo sin cubrir" y, en Pedidos,
"Mis pedidos"/"Todos". El texto del buscador nunca se persiste. Un valor
guardado ilegible, de otra versión, o con IDs que ya no existen se descarta
en silencio (los IDs inexistentes se filtran de la selección, el resto se
conserva) — nunca rompe la pantalla.

**RF-07 — Visibilidad de módulos por rol.** Quién ve y puede usar cada
módulo del portal pasa a decidirse en un solo lugar: `src/modulos.js`, una
tabla única con id/roles/categoría/textos por módulo. `Home.js` arma sus
tiles con `modulosVisibles()` y `App.js` rutea con `puedeVerModulo()` — antes
cada uno tenía su propia lista de roles, y podían divergir (`tarifario` era
el caso real: `App.js` solo exigía "no ser transportista", sin el límite de
roles que sí tenía el tile de `Home.js`). Los cuatro módulos "anteriores"
(`pedidos_legacy`, `coordinador`, `transportista`, `chofer`) más `admin`
quedan marcados `usaModeloViejo: true`: además del rol, exigen que el
usuario tenga documento en `usuarios_portal` — sin él, las reglas viejas
rechazan cualquier escritura, así que ver el tile sin poder usarlo no suma
nada.

Cambios de matriz: el coordinador entra a **Mis despachos** (en modo
consulta de solo lectura sobre todos los transportistas, sin aceptar/
rechazar/nominar) y a **Organizaciones** (da de alta y edita transportes,
nunca clientes, salvo que también sea comercial). El comercial entra a
**Productos** (alta, edición y baja — sin eliminar, como ya era para admin).
**Tarifario** pasa a evaluarse contra `perfil.roles` en vez del `rol` legacy,
con pestañas por nivel: admin ve las cuatro (incluida aprobar tarifas y
guardar versiones), coordinador ve Consulta y Generador sin aprobar ni
guardar (llega en RF-09), comercial solo Consulta. Se elimina por completo
el modo admin por contraseña de `Tarifario.js` (login/logout, cambio de
clave): el nivel de acceso sale del rol real, no de una clave compartida.

Las colecciones `portal`, `tarifario_versiones` y `catac_versiones` — hasta
ahora con `request.auth != null` para leer Y escribir, heredado de antes de
que existieran los roles nuevos — pasan a `esInterno()` para leer y
`esAdmin()` del modelo nuevo para escribir. `organizaciones` y `productos`
suman las reglas de banderas por rol que sostienen la matriz de arriba (ver
`firestore.rules.produccion`, Partes 2 y 5).

**RF-02 — Cierre manual de viajes con modal, y "Viajes abiertos vencidos".**
El botón "Cerrar viaje a mano" deja de ser un `window.prompt()` pidiendo
solo el motivo como texto libre: abre `ModalCierreManual.js` (nuevo,
compartido entre Programación y Seguimiento), con motivo de una lista
cerrada (`MOTIVOS_CIERRE_MANUAL`, con "Otro" + detalle obligatorio) y fecha
y hora de fin obligatoria — sin hora de inicio, nunca: un viaje cerrado
desde `RECIBIDO` queda sin esa marca siempre, el cierre manual no inventa un
dato que no se tiene. `validarCierreManual()` (`logica-viajes.js`) valida
que el fin no sea futuro (5 minutos de tolerancia), no sea anterior a la
fecha de carga menos un día, y sea posterior al inicio si el viaje llegó a
tener uno — la corre el modal antes de guardar, y `finalizarViaje()` la
vuelve a correr dentro de la transacción, sobre el viaje releído.

Seguimiento suma el mismo botón sobre un viaje vivo, visible solo para
admin y coordinador — nunca el transportista.

Programación suma un conmutador "Viajes abiertos vencidos" junto a "Solo
sin cubrir": un pedido pasa si algún despacho vivo tiene un viaje abierto
con fecha de carga anterior a hoy (`viajeVencido()`, nuevo en
`estados.js`). Participa de los conteos de las pastillas y de "Limpiar
filtros"; se persiste con su propia clave de `localStorage` (no pasa por
`filtros-listado.js`, fuera del alcance de esta tarea). La tarjeta de un
despacho vencido muestra la etiqueta "Vencido".

**RF-08 — Qué productos transporta cada transportista.** Campo nuevo
`organizaciones.productos_ids: string[]`, solo con sentido en
organizaciones `es_transportista` — ausente o vacío es "sin declarar".
`Organizaciones.js` suma el checklist "Productos que transporta" (admin y
coordinador, sobre productos activos y no genéricos) y, en la lista, las
pastillas de productos declarados por cada transporte. En Programación,
el único selector de transportista que existe (crear despacho o
asignar/reasignar uno existente) agrupa sus opciones en "Declaran
&lt;producto&gt;" / "No declaran este producto" cuando el producto del
pedido no es genérico — elegir del segundo grupo pide confirmación, no
bloquea.

**`firestore.rules.produccion` cambia por RF-08**: `organizaciones` suma
una validación de forma sobre `productos_ids` (lista de como mucho 50
elementos si el campo viene en la escritura) — no cambia quién puede
escribir, eso ya lo define RF-07. Las reglas se publican en producción y en
staging antes de mergear esta rama, junto con el resto de v1.2.0.

**RF-10 — Calendario operativo.** Un único calendario para marcar los días
sin despacho o sin operación (`src/logica-calendario.js`, nuevo — lógica
pura, con `logica-calendario.test.js`). Dos colecciones nuevas:
`calendario_operativo` (un documento por fecha `YYYY-MM-DD`, tipo + motivo +
`estado`) y `calendario_reglas/semanal` (un tipo por día de semana, para
"domingos sin operación" sin cargar 52 documentos) — un día marcado
explícitamente y activo gana sobre la regla semanal; desmarcar un día no
anula la regla semanal (limitación documentada: no hay un tipo "abierto").
Módulo nuevo **Calendario operativo** (`pages/CalendarioOperativo.js`, admin
y coordinador), vista mensual con navegación y sección de reglas semanales,
sin librería de calendario.

La fecha de CARGA de un despacho se **bloquea** contra el calendario, tanto
en `Programacion.js` como dentro de `logica-despachos.js`
(`aceptarEntrega()`/`editarDespacho()`, ver V1 de las verificaciones previas
de la tarea) — `sin_operacion` bloquea cualquier tipo de pedido,
`sin_despacho` bloquea solo "Entrega al cliente". La fecha de ENTREGA solo
**advierte**, nunca bloquea: en el alta de un pedido, al editar la fecha de
una entrega, al agregar entregas (`Pedidos.js`) y en la carga masiva
(`carga-masiva.js` suma un campo `advertencias`, separado de `errores` — la
fila se carga igual).

**`firestore.rules.produccion` cambia por RF-10**: dos colecciones nuevas
con reglas nuevas — `read` para cualquier interno (admin/coordinador/
comercial), `create`/`update` solo admin y coordinador, `delete: false` (se
desactiva, no se borra). Validación de forma: `tipo` dentro de los dos
valores válidos y `motivo` un string no vacío. Se publican en producción y
en staging antes de mergear esta rama, junto con el resto de v1.2.0.

**RF-05 — Vista de ciclo de vida.** Módulo nuevo, de solo lectura, **Ciclo de
vida** (`pages/CicloVida.js`, admin/coordinador/comercial): por entrega, en
qué etapa del ciclo está (Entrega solicitada → Despacho creado → Transporte
asignado → Aceptado → Nominado → Viaje recibido → En viaje → Entregado),
cuándo pasó por cada una, quién la ejecutó y cuánto tardó. La lógica que
arma el ciclo es pura (`src/logica-ciclo-vida.js`, nuevo, con
`logica-ciclo-vida.test.js`): cada etapa sale de un campo del documento (la
fecha) y de un registro de `historial` sin `derivado: true` (quién) — lo que
no tiene fuente se muestra "Sin registro", nunca se estima. Incluye ramas
cerradas (despachos rechazados o cancelados, con sus propias etapas, motivo
y quién los cerró) y marcas (cierre manual, sin inicio, demorado, fuera de
fecha, suspendida, reactivada).

La lista es una fila por entrega, de TODOS los pedidos —incluidos los
cumplidos y suspendidos, es una vista histórica— con las mismas colecciones
que ya carga `Programacion.js`, sin consultas nuevas por fila: la etapa
actual sale de campos, no de `historial` (que se lee recién al abrir el
detalle de una entrega, con el mismo índice `pedido_id + ts` de v1.1.3).
Filtros con `BarraFiltros` (mismos criterios que Pedidos), pastillas por
ETAPA ACTUAL en vez de por estado del pedido, y orden por fecha de entrega,
cliente, días en la etapa actual (descendente por defecto) o número de
pedido. Si la entrega tiene un viaje abierto, admin y coordinador ven el
botón "Cerrar viaje a mano" que abre `ModalCierreManual` (el mismo de RF-02,
sin reescribirlo) — el comercial no lo ve.

`extractores-pedidos.js` (nuevo) recibe las dos utilidades puras que ya
vivían dentro de `Pedidos.js` (`proximaFechaPendiente`, `formatoFechaTs`),
sin cambiar su implementación, para que `CicloVida.js` las reuse — el
comportamiento de `Pedidos.js` no cambia y sus tests de RF-01 siguen en
verde.

**RF-09 (rehecho) — NuevoTarifario: registro maestro, rutas derivadas y
actualización por indicador. El Tarifario existente queda como legacy, sin
tocarse.** La primera versión de RF-09 reemplazaba por completo el Tarifario
existente. Esa decisión se revierte: **`Tarifario.js` no se modifica ni una
línea** — sigue con su modo admin por contraseña, `T_BASE` y todo su
funcionamiento sobre `portal/*`, tal como estaba antes de v1.2.0. Se retira
más adelante, cuando se apruebe y se adopte la pantalla nueva. `App.js` le
sigue pasando `userRole`/`userEmail` (los campos legacy de la sesión,
`usuario.rol`/`usuario.email`), no el objeto `usuario`.

En paralelo se agrega **`NuevoTarifario.js`**, un módulo nuevo
(`nuevo_tarifario` en `modulos.js`, mismos roles que `tarifario`) con su
propio registro maestro de rutas, reutilizando lo que ya había construido la
primera versión de RF-09: la colección **`rutas`**, la subcolección
`rutas/{id}/tarifas`, `src/calculo-tarifario.js` y `src/logica-tarifario.js`.
**La ruta no lleva cliente**: se identifica por origen, destino y producto
(`clave_normalizada`).

Dos clases, en la misma colección, mostradas como **maestra** y **derivada**
(el campo `tipo` conserva sus valores `'parametro'`/`'referencia'` para no
romper lo ya cargado en staging). **Maestra**: datos maestros, las escribe
solo el admin, las leen admin, coordinador y comercial; se agregan
`tarifa_actualizada_en`/`tarifa_actualizada_por` (`{uid, nombre}`), escritos en
el alta y en cada aprobación — es la "Fecha de actualización" del registro.
**Derivada**: la arma un coordinador o el admin con el Generador, a partir de
una maestra **elegida y fija** (`ruta_maestra_id`, ya no la vecina más cercana
recalculada de la primera versión); guarda `tarifa_al_crear`/`fecha_calculo`
como foto informativa, nunca como verdad — su tarifa se calcula siempre en el
momento, `catac(km_derivada) × (tarifa_vigente_maestra / catac(km_maestra))`
(`calcularTarifaDerivada()`, nueva en `calculo-tarifario.js`), así que se
mueve sola cuando la maestra se actualiza o cambia la tabla CATAC. Si la
maestra se desactiva, la derivada queda "Maestra inactiva" (sin tarifa
calculada) hasta que se le asigna otra. Las leen admin, coordinador y
comercial (comercial: solo lectura) — a diferencia de la primera versión, que
se lo escondía. Una sola ruta activa por clave, contando las dos clases.

**Las tarifas maestras solo cambian por indicador, aprobado por el admin**
(`aplicarIndicador()`, nueva en `logica-tarifario.js`): CATAMP (factor
compuesto de una grilla de meses) o CATAC (un porcentaje simple), con alcance
todas las maestras o una categoría. Guarda la foto en la colección nueva
**`rutas_versiones`** (no `tarifario_versiones`, que sigue siendo del
Tarifario legacy, con su propio formato por `idx`) y deja cada maestra
afectada con `pendiente`, reusando `cargarPendientes()`; el admin aprueba o
descarta desde la tabla de pendientes. **No hay edición manual tarifa por
tarifa ni ajuste libre por porcentaje** fuera de un indicador —
`editarTarifa()` y `promoverReferencia()` ("Promover a ruta parámetro") se
eliminan de `logica-tarifario.js`, sin otro uso. Restaurar una versión de
`rutas_versiones` ya no pisa `tarifa_vigente` directo: la carga como
pendientes, con motivo "Restauración de versión \<fecha\>", para que pase por
la misma aprobación.

`NuevoTarifario.js` (nuevo, `pages/`): Registro vigente (maestras,
filtrable y exportable a Excel), Historial (por ruta y general, con filtros),
Rutas derivadas (con tarifa calculada al día), Generar ruta derivada
(admin+coordinador) y, solo admin, Actualizar por indicador + pendientes +
versiones y Nueva ruta maestra. Usa `crearEstilos(colores, oscuro)` +
`useEstilos()` con los tokens de `ui/tokens.js`, modo claro y oscuro.
`Tarifario.rf09.js` (la pantalla completa de la primera versión de RF-09)
queda solo como material de referencia para componentes y selectores — no se
importa desde ningún lado, Ivan puede borrarlo.

**`firestore.rules.produccion`**: las reglas de `portal`, `tarifario_versiones`
y `catac_versiones` vuelven a ser **idénticas** a las que tenían antes de la
primera versión de RF-09 (`portal/{docId}`: escritura abierta a cualquier
autenticado, el gate real es la contraseña dentro de la app;
`tarifario_versiones`/`catac_versiones`: admin por `usuarios_portal.rol`, sin
pasar por el `esAdmin()` del modelo nuevo) — el Tarifario legacy depende de
que sigan así, sin tocarse. **Limitación conocida:** `portal/config` (con la
contraseña de administrador) queda legible y escribible por cualquier
autenticado; se resuelve cuando se retire el Tarifario legacy. Colección
`rutas`: el `read` se simplifica a `esInterno()` liso (antes le escondía las
derivadas al comercial); `create`/`update`/`delete` no cambian. Subcolección
`rutas/{id}/tarifas`: sin cambios. Colección nueva `rutas_versiones`: lectura
interna, alta solo admin, `update`/`delete` en `false`.
`firestore.indexes.json` no cambia.

**Script `scripts/migrar-rutas-tarifario.js` se renombra a
`scripts/cargar-registro-maestro.js`** — ya no es una "migración" que
reemplaza al Tarifario (el legacy no se toca), es la carga inicial de
`NuevoTarifario.js`. Mismo funcionamiento (`--simular` por defecto,
`--ejecutar`, `--mapa`, idempotente por `legacy.idx`, no toca `portal/*`);
agrega `tarifa_actualizada_en`/`tarifa_actualizada_por` por ruta migrada: si
tiene historial, de la fecha (parseada de `DD/M/AAAA`) del último cambio —el
historial legacy nunca guardó QUIÉN hizo cada cambio, así que el autor queda
"Autor no registrado (historial migrado)"—; si no, la fecha de la carga con
autor `carga-inicial`. Sigue sin adivinar el domicilio con más de uno
vinculado, y la suposición `proveedor = origen` sigue a la vista en el reporte
del simulacro.

**RF-09b — Las rutas de NuevoTarifario son texto, no vínculos a
organizaciones/domicilios/productos.** Ajuste sobre RF-09: `origen_domicilio_id`,
`destino_domicilio_id` y `producto_id` se eliminan del modelo de `rutas`, de
`logica-tarifario.js` y de `NuevoTarifario.js`. Pasan a ser `origen`,
`destino` y `producto`: texto libre estandarizado (hasta 120 caracteres, sin
espacios en los extremos), con `clave_normalizada` armada normalizando cada
uno por separado con `claveNormalizada()` de `mapa-normalizacion.js` —el
mismo normalizador que ya usa el resto del portal— en vez de concatenar tres
ids. El tarifario resuelve por ruta CONVENIDA, no por domicilio operativo ni
por producto del catálogo de pedidos: no tiene por qué depender de esas
colecciones.

`validarRuta()` exige los tres campos no vacíos (ni solo espacios) y hasta
120 caracteres, y que origen y destino no sean el mismo lugar comparando por
clave normalizada (no por texto crudo). La unicidad por `clave_normalizada`
no cambia de criterio. `armarRuta()` guarda los tres campos recortados
(`.trim()`).

`NuevoTarifario.js` deja de leer `organizaciones`, `domicilios`,
`organizacion_domicilios` y `productos`: se sacan esas cuatro suscripciones.
`SelectorLugar` (organización → domicilio) y los `<select>` de producto se
reemplazan por `CampoConSugerencias`, un campo de texto con `<datalist>` que
sugiere los valores ya cargados en el registro maestro para ese campo —se
puede escribir uno nuevo igual—, en el modal "Nueva ruta maestra" y en
"Generar derivada". El registro vigente, el historial, las derivadas, los
pendientes, las versiones y el Excel muestran `origen`/`destino`/`producto`
tal como están guardados, sin resolver contra ninguna colección. Los filtros
del registro vigente siguen siendo texto libre sobre esos tres campos más la
categoría.

`firestore.rules.produccion`: el bloque de `rutas` no validaba ninguno de
los tres campos eliminados por su nombre, así que no cambia ninguna
condición — se documenta el ajuste, los permisos (quién crea y edita cada
clase) siguen igual.

`scripts/cargar-registro-maestro.js` pasa a ser una **copia directa** del
Tarifario legacy: `origen = proveedor`, `destino = destino`, `producto =
producto` de cada `portal/rutas.lista[idx]`, recortados, sin resolver contra
ninguna colección. Se eliminan la resolución por similitud, los candidatos,
`--mapa` y la generación de `mapa-rutas-pendientes.json`. Si dos rutas
legacy dan la misma `clave_normalizada`, NINGUNA de las dos se migra hasta
resolverlo con la opción nueva `--omitir <idx>[,<idx>…]`. Si `rutas` ya
tiene documentos con la forma anterior (`origen_domicilio_id`, o sin
`origen`), el script los lista y ABORTA sin tocar nada — Ivan decide qué
hacer con ellos. Se mantiene sin cambios: `--credencial`, la validación de
`project_id`, `--simular` por defecto/`--ejecutar`, la idempotencia por
`legacy.idx`, y que no toca `portal/*`.

**Rediseño de Pedidos.** `Pedidos.js` (lista y detalle) pasa al diseño
aprobado ("Portal Pedidos", Claude Design) -- cambio de presentación, no de
lógica: mismos permisos, mismas acciones, mismo `filtros-listado.js`.

- **Lista** reordenada: badge de estado, cliente, producto, cantidad,
  **barra de progreso** y chip de orden OV/OC -- ya no muestra el número PED
  (sigue siendo buscable por texto). Vista Tabla con las mismas columnas.
- **Progreso** (`src/progreso-pedido.js`, nuevo, con test): cálculo puro,
  ponderado por cantidad, a partir de `entrega.estado` -- esta pantalla no
  carga `despachos` ni `viajes`, así que las 5 etapas del diseño original se
  colapsan a las 3 que se pueden calcular sin leer nada nuevo (ver el
  encabezado del archivo).
- **Avisos** del encabezado ("N entregas vencidas sin cubrir" / "N
  entrega(s) sin cubrir") ahora son **clickeables**: prenden un filtro en
  memoria (no persistido) sobre la lista.
- **`ui/BarraFiltros.js`** (compartida con Programación y Ciclo de vida):
  pasa a ser un panel único (fondo, borde, radio 18, sombra suave) con un
  slot nuevo, `piePastillas`, para que cada pantalla le agregue sus propias
  pastillas de estado sin que el componente conozca colores de dominio. El
  segmentado "Mis pedidos/Todos" + "Tarjetas/Tabla" sigue siendo propio de
  `Pedidos.js`, dibujado con el mismo lenguaje visual justo encima.
- **Modal de detalle** a dos columnas: datos del pedido (con "Destino"
  mostrando "Varía por entrega →" cuando las entregas activas no comparten
  domicilio) y panel "Entregas" con su propia paleta cálida. `ui/Modal.js`
  suma un prop opcional `alto` (default sin cambios) para el 88vh que pide
  este modal.
- **`ui/tokens.js`** suma `paletaPedidos(oscuro)` y `radioPedidos` con los
  colores/radios del diseño, con equivalente en modo oscuro, sin tocar los
  tokens generales del resto del portal.
- Discrepancias con el diseño (frenadas, documentadas en el encabezado de
  `Pedidos.js`): no existe "Reactivar pedido" (`logica-pedidos.js` documenta
  que suspender un pedido es definitivo); el chip "Con/sin camión" se
  mantiene como el chip de estado existente (el campo que pide el diseño
  vive en `despacho`, no en `entrega`, y esta pantalla no lee despachos); se
  mantuvo la tipografía DM Sans del portal en esta tarea puntual (el diseño
  usa Montserrat, y la regla de esa tarea era no agregar fuentes nuevas) --
  **superado por el rediseño de Programación, más abajo**, que sí la agrega
  para todo el portal.

**Rediseño de Programación, y tipografía Montserrat en todo el portal.**
`Programacion.js` (lista y detalle) pasa al diseño aprobado ("Portal
Programación", Claude Design) -- mismo criterio que el rediseño de Pedidos:
cambio de presentación, no de lógica. Mismos permisos, mismas acciones
(crear despacho, asignar/reasignar/cancelar transporte, editar/reprogramar,
cerrar viaje a mano, selector de transportista por producto de RF-08,
bloqueo por calendario de RF-10), mismo `filtros-listado.js`.

- **Tipografía (Paso 0):** DM Sans → **Montserrat** (pesos 400/500/600/700/800)
  para **todo el portal**, no solo esta pantalla -- `ui/tokens.js`
  (`tipografia.familia`), `public/index.html` (Google Fonts), `src/index.css`
  (`body` + `input`/`button`/`select`/`textarea{font-family:inherit}`
  nuevo) y `src/App.css`. La única pantalla con una fuente fija fuera de
  `tipografia.familia` era `src/pages/Chofer.js` (no migrada a `ui/tokens.js`),
  pasada a `inherit`. `Tarifario.js` queda afuera a propósito (regla
  explícita de la tarea) y sigue con las suyas.
- **Lista** reordenada a un único panel blanco (radio 16, filas separadas
  por una línea fina, no tarjetas sueltas): badge de estado, cliente
  (bold), producto (rojo marca), cantidad, chip "N sin cubrir" y OV/OC (rojo
  marca, bold, a la derecha) -- ya no muestra el número PED, las fechas, las
  entregas ni los despachos (sigue siendo buscable por número de texto).
- **`ui/BarraFiltros.js`** suma una **variante compacta** (`variante=
  "compacta"`, sin tocar la variante de Pedidos): buscador a ancho completo
  + un único botón "Filtros y orden · N" que despliega los seis filtros de
  RF-01 y el orden; pastillas de estado + "Solo sin cubrir" + "Viajes
  abiertos vencidos" en rojo sólido cuando están activas, con el contador
  "N de M pedidos" al lado.
- **Modal de detalle**, ancho 960/alto 88vh: título "Pedido `<OV/OC>`" + el
  número PED chico y tenue debajo; grilla de datos con etiquetas en
  mayúsculas chicas y "Destino" a ancho completo ("Varía por entrega →" si
  cambia por entrega); nota del pedido (`obs`) en caja roja, solo si hay
  texto. Panel "Entregas": una tarjeta por entrega activa (borde izquierdo
  rojo 5px; las cumplidas/suspendidas van al final, atenuadas), sin chip de
  prioridad (se ordenan por número); fecha solicitada en formato largo, con
  aviso de calendario operativo si cae en un día marcado (RF-10, no
  bloquea); una línea por despacho vivo, con su propio chip de estado (tres
  estilos nuevos -- ver `paletaProgramacion()`), "carga `<fecha larga>`" en
  verde si está confirmado, transportista en rojo marca, y sus propios
  botones (Asignar/Reasignar, Editar -contorno azul-, Cancelar -contorno
  rojo-, Cerrar viaje a mano); "Asignar transporte" como botón primario para
  la entrega sin cubrir, que abre el mismo formulario de siempre; despachos
  rechazados/cancelados plegados bajo "Ver N anteriores", atenuados, con su
  motivo.
- **`ui/tokens.js`** suma `paletaProgramacion(oscuro)` (tres estilos de
  estado de despacho, la nota del pedido, fecha de carga confirmada,
  transportista) y `radioProgramacion`, con equivalente en modo oscuro.
- **Nuevo:** `pages/programacion/logica-vista.js` (lógica pura: conteo de
  entregas sin cubrir, orden de entregas por número, mapeo de estado de
  despacho a estilo, formato de fecha larga -- con tests),
  `pages/programacion/SelectorTransportista.js` y
  `pages/programacion/ModalDetallePedido.js` (extraídos de `Programacion.js`
  para no superar las ~700 líneas del prompt).
- Discrepancias con el diseño (frenadas, documentadas en el encabezado de
  `Programacion.js`/`ModalDetallePedido.js`): el chip "Con/sin camión" se
  mantiene como el chip de estado existente, mismo caso que Pedidos.js; el
  chip de prioridad del diseño se descarta (el propio prompt lo pide); este
  modelo no tiene cobertura parcial de una entrega, así que la línea "Sin
  cubrir" nunca convive con líneas de despacho reales para la misma entrega.

### Secuencia obligatoria de puesta en producción de NuevoTarifario

1. **Publicar las reglas** (Paso 8 de `Procedimiento.md`), en staging y en
   producción.
2. **En staging**: `--simular` → revisar duplicados en el reporte →
   `--ejecutar`, con `--omitir <idx,...>` si hizo falta resolver algún
   duplicado → probar la pantalla con los tres roles.
3. **Lo mismo en producción**, con la credencial de producción y `--produccion`.
4. **Recién después**, merge y deploy del código.

### Pruebas manuales, después de la carga inicial

- **Tarifario legacy:** funciona exactamente como antes de v1.2.0, incluido
  el modo admin por contraseña — Consulta, Generador, Editor, CATAMP,
  versiones y CATAC.
- **NuevoTarifario, registro y alta:** el registro vigente muestra las rutas
  con las mismas tarifas vigentes que el legacy, con fecha de actualización e
  historial; el admin crea una maestra nueva.
- **NuevoTarifario, indicador:** el admin aplica un CATAMP a una categoría —
  se genera la foto, aparecen los pendientes, aprueba y cambian las tarifas,
  la fecha y el historial con autor y motivo; las derivadas de esas maestras
  cambian solas; restaurar la foto genera pendientes.
- **NuevoTarifario, derivadas:** el coordinador genera una derivada, la ve con
  su tarifa al día, no puede editar la de otro coordinador; una clave
  repetida muestra la existente; el coordinador no ve la pestaña de
  actualización; desactivar una maestra marca sus derivadas "Maestra
  inactiva".
- **NuevoTarifario, comercial:** ve el registro, el historial y las derivadas,
  no puede escribir nada.
- **Reglas:** desde la consola del navegador, un coordinador no puede
  escribir una maestra, `rutas_versiones` ni la subcolección `tarifas`.

**Las reglas de Firestore se publican en producción y en staging ANTES de
mergear esta rama** — Paso 8 de `Procedimiento.md`. Sin eso, el código nuevo
choca con las reglas viejas.

**Rediseño de NuevoTarifario.** `NuevoTarifario.js` pasa al mismo lenguaje
visual que Pedidos y Programación — cambio de presentación, no de lógica:
misma lógica de `logica-tarifario.js`/`calculo-tarifario.js`, mismos
permisos por rol, ninguna acción ni dato se pierde.

- El archivo (1193 líneas) se parte en `pages/nuevo-tarifario/`: el
  orquestador (`NuevoTarifario.js`, suscripciones Firestore, permisos,
  filtros/orden y qué modal está abierto) arma props para
  `RegistroVigente.js`, `RutasDerivadas.js`, `GenerarDerivada.js`,
  `Historial.js`, `Actualizaciones.js`, `ModalDetalleRuta.js` (dos columnas,
  `tipo` `"maestra"`/`"derivada"`), `ModalNuevaMaestra.js` y
  `CampoConSugerencias.js` (mudado tal cual), más un `estilos.js` compartido
  con `crearEstilos(colores, oscuro)` + `useEstilos()`.
- "Nueva ruta maestra" es modal, abierto desde el encabezado (admin,
  primario). "Generar derivada" **queda como pestaña** (admin+coordinador) —
  corrección post-revisión: la primera versión la había vuelto un modal
  (`ModalGenerarDerivada.js`, ya borrado), pero es un flujo exploratorio
  (completar datos y VER la maestra sugerida/tarifa resultante/cálculo antes
  de decidir guardar) que un modal angosto no acompaña bien; al guardar,
  limpia el formulario en vez de cerrarse, igual que la pestaña original. El
  encabezado ya no repite, como botón, una acción que ya es pestaña
  ("Actualizar por indicador" también se sacó del encabezado por la misma
  razón — ya está la pestaña "Actualizaciones", y el aviso ámbar lleva ahí
  igual). Se saca también el botón "← Inicio" del encabezado: `BarraSuperior`
  (`App.js`) ya resuelve la vuelta a Home para todas las pantallas —
  `Pedidos.js` tampoco lo tiene. Avisos clickeables (ámbar, "N tarifas
  pendientes", solo admin → pestaña Actualizaciones; rojo, "N derivadas con
  maestra inactiva" → Rutas derivadas filtrado).
- Registro vigente con `Segmentado` Filas/Tabla (**Tabla por defecto** —
  corrección post-revisión, es la vista preferente acá). En Filas
  (`PanelLista`), el km gana prioridad visual (columna centrada, en negrita)
  y la fecha de actualización se saca de la fila (ya está en el detalle, un
  clic adentro) — los chips de categoría/brecha quedan en columnas de ancho
  fijo centradas, en vez de flotar según el largo del texto previo. Rutas
  derivadas con el
  mismo `PanelLista` y el chip de variación desde que se creó
  (`calcularVariacion`, ya existente); Historial como línea de tiempo
  agrupada por día; Actualizaciones con tres pasos numerados (Indicador →
  Vista previa → Pendientes) más Versiones. El detalle de una ruta (antes
  dos modales separados — historial de la maestra, nada para la derivada)
  pasa a ser un solo `ModalDetalleRuta` de dos columnas con panel cálido,
  mismo patrón que el detalle de Pedidos.
- **`ui/tokens.js`** suma `paletaTarifario(oscuro)` (categoría, brecha,
  pendiente, panel cálido). **Nuevo en `ui/`:** `PastillaGrupo.js`,
  `Segmentado.js`, `AvisoClickeable.js` (+ `FranjaAvisos`/`AvisoNeutro`),
  `PanelLista.js` — extraídos 1:1 de `Pedidos.js`/`Programacion.js`, que
  ahora los importan desde acá en vez de definirlos local (sin cambio de
  aspecto ni comportamiento). **Nuevo:** `src/formatos.js`
  (`formatoMoneda`/`formatoKm`/`formatoPorcentaje`/`formatoFechaLarga`, con
  test) reemplaza los `fmt`/`fp`/`formatoFecha` locales que tenía el archivo
  original.
- **`filtros-listado.js`** suma, de forma aditiva, `km` (rango numérico),
  `brecha` (selección múltiple), `actualizacion` (rango de fecha única) y
  `soloMaestraInactiva` (booleano) a `filtrosVacios()`/`aplicarFiltros()`, y
  los criterios `'origen'`/`'destino'`/`'km'`/`'tarifa'`/`'brecha'`/
  `'actualizacion'` a `comparador()`/`valorDeOrden()` — inertes para
  Pedidos/Programación/Ciclo de vida, que no pasan esos extractores.
  **`ui/BarraFiltros.js`** suma `control.tipo === 'rangoNumero'` (dos
  `<input type="number">` desde/hasta, sin atajos).
- Decisiones de detalle (documentadas en el encabezado de
  `NuevoTarifario.js`): Registro vigente y Rutas derivadas comparten un solo
  estado de filtros/orden persistido (`leerPreferencias`/
  `guardarPreferencias('nuevo_tarifario', ...)`); el enlace "derivadas que
  dependen de esta maestra" filtra por `ruta_maestra_id` con un estado local,
  aparte de `filtros-listado.js`; ordenar por "brecha" ordena por el balde
  (bajo/en rango/sobre), no por el valor numérico, porque filtrar y ordenar
  comparten la misma clave de extractor.

**Rediseño de Organizaciones.** `Organizaciones.js` pasa a ser un re-export
de `pages/organizaciones/Organizaciones.js`, partido en varios archivos:
clic en una fila abre un **modal de edición** (hasta 920px, dos columnas,
panel "RESUMEN" a la derecha) en vez de una vista de formulario a pantalla
completa; "Domicilios", "Usuarios" y "Productos" (este último solo en
transportistas) abren modales propios en vez de reemplazar la pantalla —
nunca hay dos modales abiertos a la vez. La lista usa `BarraFiltros`
(`variante="compacta"`) con pastillas de tipo (Todas/Clientes/Transportes/
Propias, con conteo) y "Mostrar inactivas", persistidas con
`filtros-listado.js` (`grupoActivo`, y el campo nuevo `verInactivas`); suma
la localidad del primer domicilio de cada organización en la fila.
`Domicilios.js` extrae su gestión por organización a
`GestionDomiciliosOrganizacion` (migrada a B1), reusada por el modal y por
la pantalla de siempre — el coordinador sin comercial, que antes veía la
pantalla de Domicilios bloqueada entera, ahora ve la lista en solo lectura
dentro del modal (resuelve una limitación que había dejado RF-07). El modal
de Usuarios amplía el alta de RF-03: el admin puede elegir entre
Transportista y Chofer (antes solo Transportista), mismo criterio de campos
que `Usuarios.js` (DNI para chofer, en vez de correo); el coordinador sigue
fijo en Transportista. El checklist de productos de RF-08 sale del
formulario de edición a su propio modal.

---
## v1.1.3 — 18-09-2026

**Parche de corrección.** Cinco problemas de producción, tres de ellos
invisibles hasta que alguien los buscó: dos consultas que fallaban por
índices no declarados, y un botón que existía en el código pero exigía un
estado inalcanzable.

- **Corregido**: `Notificaciones.gs` + `logica-pedidos.js` — los mails de
  pedido nuevo salían con "undefined" en cinco lugares, incluido el asunto.
  La causa era un desfase de nombres entre el payload que arma el portal y
  los que lee el Apps Script, introducido por el modelo nuevo de v1.1.0: el
  script leía `data.id` y el portal mandaba `pedido_id`; `creado_en`,
  `recipiente` y `fecha_entrega` directamente no se mandaban. Que
  `creado_por` fuera el único campo correcto en el mail real es la prueba:
  es el único cuyo nombre no cambió. Se reescriben los nueve emisores con
  un contrato explícito, asunto uniforme
  (`[OV-2860] - Pedido nuevo - Glicerina - 28 tn - MAPEI`), destinatarios
  resueltos por rol contra `usuarios` en vez de tres direcciones escritas a
  mano en el script, y el cronograma completo de entregas en vez de una
  sola fecha — el pedido del modelo nuevo no tiene fecha propia. Todos los
  campos pasan por una función que cae a "—": un campo que deje de
  mandarse ya no escribe "undefined", pero tampoco avisa.
- **Corregido**: `estados.js`, `logica-viajes.js`, `Programacion.js` — el
  botón "Cerrar viaje a mano" no aparecía nunca. Exigía
  `viaje.estado === EN_VIAJE`, y ese estado solo lo escribe
  `iniciarViaje()`, llamable únicamente desde `MisViajes.js`. Con TrackEx
  en pausa y `Chofer.js` escribiendo en `pedidos_portal` —colección legacy,
  desconectada de `viajes`—, un despacho puede quedar nominado con chofer
  asignado y su viaje se queda en `RECIBIDO` para siempre. Se agrega
  `viajeAbierto()` en `estados.js` (RECIBIDO o EN_VIAJE, en un solo lugar
  para no repetir la comparación en dos archivos, que es lo que causó el
  bug), `finalizarViaje()` acepta RECIBIDO solo cuando el cierre es manual,
  y se agrega el chequeo de rol que faltaba.
- **Corregido**: `firestore.indexes.json` — tres consultas compuestas
  fallaban con `failed-precondition` porque sus índices no estaban
  declarados. La pantalla de historial del pedido no mostraba nada, dar de
  baja un camión fallaba, y la resolución de coordinadores para los mails
  habría fallado igual. Se agregan `historial` (`pedido_id` + `ts`),
  `despachos` (`tractor_id` + `estado` y `acoplado_id` + `estado`) y
  `usuarios` (`roles` + `estado`). Se elimina el índice de `despachos` por
  `camion_id`: ese campo se separó en `tractor_id` y `acoplado_id` y ya no
  existe en ningún documento — el índice quedó vivo apuntando a la nada.
- **Corregido**: `firestore.rules.produccion` —
  `camposDelTransportista()` seguía listando `camion_id`, que ya no se
  escribe, y le faltaban `tractor_id` y `acoplado_id`, que sí. Como la
  regla usa `cambia().hasOnly(...)`, la ausencia de un campo que la acción
  necesita escribir rechaza la nominación entera con `permission-denied`.
  Mismo patrón que el caso de `viaje_id` ya documentado en ese archivo.
- **Nuevo**: `Organizaciones.js` — casilla "Cliente del exterior". Un
  cliente sin CUIT no se podía dar de alta porque la validación exige el
  formato argentino. Con la casilla marcada, el identificador fiscal acepta
  texto libre y la unicidad se mantiene sobre el valor normalizado.
  Deliberadamente mínimo: no se agregan `pais` ni `tipo_identificacion` al
  modelo, que es lo correcto a largo plazo pero implica migrar las
  organizaciones existentes.
- **Nuevo**: `Pedidos.js` — el detalle del pedido muestra quién lo creó y
  quién lo modificó por última vez. El dato ya se guardaba y nunca se
  mostraba. La última modificación sale de `historial`, descartando los
  registros con `derivado: true`: sin ese filtro, la línea mostraría el
  nombre del transportista que aceptó un despacho como si hubiera editado
  el pedido.
- **Nuevo**: `Pedidos.js` — conmutador "Mis pedidos / Todos", que arranca
  en "Mis pedidos" para el comercial que no es además admin ni coordinador.
  Filtro en memoria sobre `creado_por_uid`, sin tocar la consulta ni
  persistir la preferencia.

Las reglas y los índices se publicaron **antes** del merge, como exige el
Paso 8 del procedimiento.

Pendientes conocidos, sin resolver en esta versión: el recordatorio de 12hs
sigue sin dispararse nunca —lo llama `verificarNominacionesPendientes()`,
que lee una hoja "Pedidos Portal" que no existe—; el portal sigue llamando
al Apps Script con `mode: 'no-cors'` en varias rutas, así que muestra que
notificó aunque el mail falle; y un viaje cerrado desde `RECIBIDO` queda
sin timestamp de inicio, algo que la vista de ciclo de vida de v1.2 va a
tener que contemplar.


## v1.1.1 — 04-09-2026

**Parche de estabilización post-v1.1.0.** Cuatro correcciones puntuales
detectadas al probar el rediseño en producción: dos de comportamiento en
el modal de detalle de pedido, una del pie de página, y una de layout en
Seguimiento.

- **Corregido**: `Pedidos.js` — el aviso "Se llegó al volumen total de la
  orden" en `ModalDetallePedido` se mostraba apenas el pedido alcanzaba su
  volumen nominal, sin que el usuario hubiera hecho nada. Ahora solo
  aparece al clickear "+ Agregar entrega", que es el momento en que
  realmente es información accionable. El aviso equivalente dentro del
  formulario de carga (que sí corresponde ahí) no cambió.
- **Corregido**: `Pedidos.js` — el segmento ámbar de `BarraProgreso`
  (entregas programadas, no solo cumplidas) se ajusta para distinguirse
  mejor del fondo de la barra. El cálculo de `cubiertas`/`cumplidas` ya
  era correcto desde v1.1.0; el ajuste es solo de contraste visual.
- **Corregido**: `scripts/preparar-build.js` — el pie de página mostraba
  el hash corto del commit (`6a061a1`) en vez del tag de versión
  (`v1.1.0`) en el deploy de producción. La causa era que Vercel clona el
  repo con historia de Git limitada durante el build, y en ese contexto
  `git describe --tags` no siempre encuentra el tag. Se agrega un intento
  de traer los tags explícitamente antes de leer la versión, con
  fallback silencioso si el repo ya tiene el historial completo.
- **Corregido**: `App.js` — el contenedor de `Pagina` que envuelve todo
  el contenido no tenía `minHeight: 0`, lo que rompía la cadena de
  `flex: 1, minHeight: 0` que usan las pantallas con layout de alto
  completo (como el mapa de `Seguimiento.js`). El mapa quedaba con una
  altura recortada, dependiente de la cantidad de viajes activos en el
  panel lateral, en vez de ocupar el espacio disponible de la ventana.

Sin cambios en el modelo de datos ni en las reglas de Firestore. No
requiere migración ni redeploy de reglas — solo build y deploy del
portal.

## v1.1.0 — 02-09-2026

**El modelo de datos nuevo entra en producción, en convivencia con el viejo.**
Las seis colecciones de `MODELO_DATOS_TOBE.md` (`organizaciones`, `domicilios`,
`organizacion_domicilios`, `usuarios`, `productos`, `camiones`, y el árbol
`pedidos/entregas/despachos/viajes/gps_puntos`) se implementan y conviven con
`pedidos_portal`/`usuarios_portal` hasta que los pedidos viejos terminan su
ciclo. El comportamiento de cada acción sigue `COMPORTAMIENTO.md`.

- **Nuevo**: `sesion.js` — `cargarSesion()` lee los dos modelos de usuario (el
  perfil viejo de `usuarios_portal` y el nuevo de `usuarios`) y decide si
  puede entrar. `App.js` rutea las pantallas legacy por el campo `rol` de
  siempre y las nuevas por `tieneAlgunRol()` contra el array `perfil.roles`,
  con la misma lista de roles que su tile en `Home.js`.
- **Nuevo**: `estados.js`, `logica-pedidos.js`, `logica-despachos.js`,
  `logica-transportista.js`, `logica-viajes.js` — la lógica de negocio del
  modelo nuevo: transacciones, recálculo de estados en cascada
  (despacho → entrega → pedido), historial.
- **Nuevo**: pantallas — `Programacion.js` (reemplazo de `Coordinador.js`),
  `MisDespachos.js` (reemplazo de `Transportista.js`), `MisViajes.js`
  (reemplazo de `Chofer.js`), `Organizaciones.js`, `Usuarios.js`,
  `Productos.js`, `Camiones.js`, `Domicilios.js` (con sus modales
  `ModalOrganizacion.js` / `ModalDomicilio.js`), `HistorialPedido.js`,
  `BuscadorOrganizacion.js`.
- **Nuevo**: `PedidosLegacy.js` — los pedidos que quedaron en `pedidos_portal`,
  en solo lectura. `Coordinador.js`, `Transportista.js`, `Chofer.js` y
  `Admin.js` **no se tocaron**: siguen operativos, transicionalmente, hasta
  que se decida sacarlos del menú.
- **Nuevo**: sistema de diseño (Fase B1) — `ui/BarraSuperior.js` (header
  sticky unificado con logo, toggle de tema, cambio de contraseña migrado
  desde `Home.js`, logout), `ui/tokens.js`, `ui/TemaContext.js`
  (dark/light mode), y los componentes `Boton`, `Tabla`, `Campo`,
  `Buscador`, `Modal`, `Pastilla`, `Tarjeta`, `Pie`, `Vacio`. Color de marca
  único: `#C60000`.
- **Nuevo**: `camiones` separa tractor y acoplado como dos documentos con
  `tipo` (antes era un documento con `patente_tractor` + `patente_semi`).
  Migrado con `scripts/migrar-camiones-a-flota.js` (dry-run por defecto).
- **Nuevo**: la API del Portal (Apps Script de Marcos) **se versiona en el
  repo por primera vez**, en `portal/app-script/plan-produccion/`:
  - `Codigo.gs`: `doPost`/`doGet` unificados contra una sola tabla
    `ACCIONES` — antes tenían copias separadas que podían divergir (el bug
    de la hoja "Pedidos Portal" que nunca se creaba).
  - `BorrarDespacho.gs`: implementa `borrar_despacho`, la acción que
    `REORGANIZACION_REPO.md` marcaba como faltante.
  - `Adjuntos.gs`: subir/borrar adjuntos de Drive (`eliminar_adjunto` ya
    existía con otro nombre del que se pensaba).
  - `Notificaciones.gs`: todos los `enviarEmail*` en un solo archivo, sin
    cambios en la redacción.
  - `PlanDeProduccion.gs`, `MovVehiculos.gs`: escritura de las dos hojas de
    cálculo, separadas.
  - `RecordatorioFirestore.gs`: el recordatorio semanal pasa a leer
    Firestore real en vez de una hoja que nunca se llenaba.
- **Nuevo**: `scripts/verificar-contadores.js` — solo lectura, recuenta
  `entregas_total/cubiertas/cumplidas` de cada pedido contra sus entregas
  reales y lista diferencias.
- **Nuevo**: `scripts/preparar-build.js` + Paso 9 de `Procedimiento.md` — la
  versión del portal (pie de página) sale de `git describe --tags`, ya no
  se escribe a mano. Requiere taggear (`git tag vX.Y.Z && git push origin
  vX.Y.Z`) al cerrar cada versión.
- **Modificado**: `firestore.rules.produccion` y `firestore.indexes.json`
  para las colecciones nuevas.
- **Nueva dependencia**: `firebase-admin` (dev), para los scripts de
  migración y verificación.

Pendiente conocido, sin resolver en esta versión:
- `Coordinador.js`, `Transportista.js`, `Chofer.js` y `Admin.js` quedan
  transicionalmente sin cambios; se retiran cuando termine la migración.
- `portal/src/TemaContext.js` quedó duplicado de `ui/TemaContext.js`, sin
  usarse en ningún lado. Limpieza pendiente.
- Comentarios en el código referencian `PENDIENTES.md`, un documento
  transitorio que no se sube al repo. Falta sacar esas referencias o
  definir un sistema de gestión documental.
- `subirAdjunto()` comparte los archivos de Drive como "cualquiera con el
  link": `visible_transportista` es una bandera de UI, no una protección
  real.

## v1.0.5 — Rediseño del modelo de datos (documentación)

Se descarta el enfoque de dual-write y migración incremental. El modelo nuevo
se construye al lado del actual y los pedidos vivos terminan su ciclo donde
están.

- Nuevos: MODELO_DATOS.md (as-is), RELEVAMIENTO_PEDIDOS_PORTAL.md,
  MODELO_DATOS_TOBE.md, COMPORTAMIENTO.md
- Se retiran MODELO_DATOS_v2.md, PLAN_FASE_1.md y PLAN_MIGRACION.md
- mapa-normalizacion.js: los IDs derivados del nombre se reemplazan por
  clave_normalizada como campo de deduplicación
- Sin cambios en el código que corre.


## v1.0.4 — 21/08/2026

**Entorno de prueba con datos reales.** Se agrega un tercer entorno al que
el portal puede apuntar: un proyecto de Firebase separado
(`entorno-prueba-explora`) con una copia de los datos de producción. Sirve
para probar cambios que tocan la base de datos sin riesgo, en particular la
migración del modelo de datos que viene.

- **Modificado**: `src/firebase.js` — dos configuraciones de proyecto
  (producción y prueba) y una variable de entorno que elige cuál. Nuevo
  export `ENTORNO`. Sin `.env.local`, el portal apunta a producción
  exactamente igual que antes de este cambio.
- **Modificado**: `src/App.js` — franja de aviso arriba de todo cuando el
  portal NO está apuntando a producción. En producción no se renderiza
  nada, así que el portal real queda idéntico.
- **Corregido**: `src/pages/Admin.js` tenía la configuración de Firebase
  hardcodeada apuntando a producción, para la instancia secundaria que usa
  al crear usuarios. Eso significaba que crear un usuario desde el entorno
  de prueba habría creado la cuenta de Auth en la base REAL, mientras el
  perfil se escribía en la de prueba. Ahora importa la configuración
  activa, así que la instancia secundaria siempre apunta al mismo proyecto
  que el resto del portal.
- **Corregido**: `src/pages/Login.js` descartaba el error original del
  login con Google y mostraba siempre el mismo mensaje genérico. Eso hacía
  imposible distinguir "Google rechazó el login" de "Firestore rechazó la
  lectura del perfil", que son problemas completamente distintos. Ahora el
  código de error se registra en la consola y se incluye en el mensaje.
- **Nuevo**: `scripts/copiar-a-staging.js` — copia las colecciones de
  producción al entorno de prueba conservando los IDs de documento
  (imprescindible: el ID de un documento de `usuarios_portal` ES el UID de
  Firebase Auth). Tiene modo simulación, recorre subcolecciones, y verifica
  el `project_id` de cada credencial antes de escribir, para que pasar las
  claves al revés no pueda escribir sobre producción.
- **Nuevo**: `ENTORNO_PRUEBA.md` — guía completa del entorno: cómo
  activarlo, cómo volver a producción, cómo refrescar los datos, y qué se
  copia y qué no.
- **Corregido**: `.gitignore` — la regla de `firestore-debug.log` estaba
  escrita en UTF-16 y Git no la interpretaba (se leía como caracteres
  sueltos separados por espacios). Se reescriben los tres `.gitignore` del
  repo en UTF-8 y se agregan reglas para las claves de cuentas de servicio
  y para la exportación de cuentas de Auth, que contiene hashes de
  contraseñas.

Las cuentas de Firebase Auth se importaron al entorno de prueba con sus
UIDs originales (`firebase auth:export` / `auth:import`), así que las
credenciales de acceso son las mismas que en producción.

Sin impacto en producción: sin `.env.local`, el comportamiento es idéntico
al de la versión anterior. Se verificó arrancando el portal sin el archivo
y confirmando que no aparece ninguna franja.

Pendiente conocido, sin resolver en esta versión: la app TrackEx sigue
apuntando siempre a producción — su configuración está hardcodeada en
`explora-app/src/config/firebase.js`. Y `Login.js` crea su propio
`GoogleAuthProvider` en vez de usar el que exporta `firebase.js`, así que
la restricción de dominio `hd: 'explora.com.ar'` está configurada pero
nunca se aplica.

---

## v1.0.3 — 20/08/2026

**Las reglas de Firestore pasan a versionarse en el repo.** Hasta esta
versión, las reglas de producción se editaban y publicaban a mano desde
la consola web de Firebase, y el repo tenía una copia informativa que
podía divergir sin que nadie se enterara. Además, la configuración del
CLI apuntaba a un proyecto que no existe (`explora-portal-dev`), así que
`firebase deploy` nunca había funcionado en este repo.

- **Renombrado**: `portal/firestore.rules` → `portal/firestore.rules.emulador`
  (queda como referencia histórica, ya no lo usa nadie).
- **Movido**: `firestore.rules.produccion` de la raíz del repo a `portal/`,
  donde vive `firebase.json` y donde el CLI resuelve las rutas.
- **Modificado**: `portal/firebase.json` — la clave `firestore.rules` ahora
  apunta a `firestore.rules.produccion`. Ningún archivo se llama
  `firestore.rules` a secas: si algo apunta mal, el deploy falla en vez de
  publicar reglas equivocadas.
- **Corregido**: `portal/.firebaserc` — el proyecto pasa de
  `explora-portal-dev` (inexistente) a `explora-portal` (el real).
- **Modificado**: encabezado de `firestore.rules.produccion` — documenta el
  procedimiento de publicación y las comprobaciones previas. Las reglas en
  sí no se modificaron.
- **Cambio de comportamiento local**: el emulador ahora usa las reglas de
  producción en vez de las permisivas. Lo que se prueba local es lo que
  corre en la realidad.

Las reglas publicadas no cambiaron: el primer deploy por CLI fue
deliberadamente idéntico a lo que ya estaba en producción, para validar el
mecanismo sin alterar comportamiento.

Pendiente conocido, sin resolver en esta versión: la regla de
`pedidos_portal` sigue permitiendo lectura y escritura a cualquier usuario
autenticado, incluidos los choferes sobre pedidos que no les corresponden.

---

## v1.0.2 — 18/08/2026

**El portal ahora refleja el estado del viaje del chofer.** Hasta esta
versión, `estado_chofer` (que escribe la app TrackEx) y `estado` (el ciclo
administrativo del portal) vivían desincronizados: un viaje entregado por
el chofer seguía figurando como "Nominado" para siempre, sin ninguna
pantalla que mostrara que ya se había completado.

- **Seguimiento**: filtros por transportista y chofer (selección múltiple,
  chofer en cascada según el transportista elegido) y por rango de fecha
  (Hoy / 7 días / Este mes), aplicados a las pestañas "En vivo" e
  "Historial". Corregido: los marcadores de inicio/fin del historial se
  acumulaban en el mapa sin límite; el historial no filtraba por
  transportista porque el campo no se copiaba al armar los registros.
- **Transportista**: insignia con el estado del viaje en cada despacho,
  filtro "Pendientes / En viaje / Entregados / Todos" (arranca en
  Pendientes, así los ya entregados no se acumulan en la lista), y
  horarios de inicio/fin en el detalle. Corregido: el mapa "Mis unidades"
  nunca mostraba nada porque faltaban los campos de posición GPS al armar
  los despachos.
- **Coordinador**: insignia de viaje en la tarjeta del pedido ("En ruta" /
  "Entregado") y en cada despacho individual, con el bloque de
  seguimiento (inicio, fin, motivo de demora si lo hay).
- **Admin**: nueva sección de viajes finalizados (colapsada por defecto),
  con duración del viaje y estado de la traza GPS. Corregido: el cierre
  manual de un viaje escribía `chofer_fin_ts` en formato local en vez de
  ISO 8601, lo que producía "Invalid Date" en el historial de
  Seguimiento — ahora escribe ISO, igual que la app.

Ningún cambio de esta versión modifica el modelo de datos ni ninguna
escritura existente: todo es lectura de campos que ya se guardaban.


## v1.0.1 — 23/07/2026

**Entorno de emulador local de Firestore.** Se agrega la configuración
necesaria para correr el portal contra una base de datos Firestore 100%
local (Firebase Local Emulator Suite), sin tocar producción.

- Nuevo: `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`
- Modificado: `src/firebase.js` — conexión al emulador condicionada a la
  variable `REACT_APP_USE_EMULATOR` (definida en `.env.local`, no se sube
  a git). Sin la variable, el portal se conecta a producción exactamente
  igual que antes de este cambio.
- Sin impacto en producción.

## v1.0.0 — 23/07/2026

Versión base — punto de partida a partir del cual se empieza a versionar
el portal de forma explícita.
