# Changelog — TrackEx (explora-app)

Versionado semántico: **MAYOR.MENOR.PARCHE**

- **PARCHE** (x.x.N): fixes, detalles, cambios menores
- **MENOR** (x.N.x): nuevas funciones, cambios medianos
- **MAYOR** (N.x.x): reescritura completa de la app, o una decisión de gran impacto

Además del versionado semántico, cada entrada indica el `versionCode` de
Android correspondiente cuando aplica — es el número que gestiona EAS
automáticamente para Google Play, y es un dato distinto que conviene
seguir viendo junto al semántico.

---

## v1.1.0 — versionCode 8 — 06/10/2026
** TrackEx pasa al modelo de datos nuevo (colección `viajes`)**

Cambio de capa de datos; el diseño de la pantalla no se rediseña. La versión de
la app no cambia en esta entrada.

- Los viajes se leen de `viajes` (consulta por `chofer_dni` + `estado` RECIBIDO / EN_VIAJE)
  en lugar de recorrer `pedidos_portal`. El DNI sale de `usuario.datos_chofer.dni`.
- Iniciar, reportar demora y finalizar usan la lógica compartida del portal
  (`portal/src/shared/`, vía `src/compartido.js`): transacciones con historial, y el
  cierre del chofer ahora también pasa el despacho a ENTREGADO.
- La demora es un atributo del viaje, no un estado: con el viaje ya demorado se
  oculta el botón de demora y se elimina "Continuar viaje".
- El GPS escribe en `viajes/{id}/gps_puntos` con `registrarPuntos`. Se eliminan
  `gps_estado` y `gps_track_*`. El buffer de AsyncStorage convierte `ts` ISO a ms.
  Si el viaje fue cerrado por fuera (cierre manual), el buffer se descarta
  (`gps_descarte`) y se detiene el seguimiento.
- Migración en caliente: el viaje activo / buffer con la forma vieja se descartan
  al arrancar (`migracion_descarte`).
- Login: el perfil sale de `usuarios/{uid}` (sin consulta por email ni
  `usuarios_portal`), con una única `cargarPerfilChofer(uid)` usada por la
  restauración de sesión, DNI, email y Face ID. Solo entran usuarios con rol `chofer`.
- Face ID: nueva clave `explora_last_user_v2` que guarda solo `{ uid }`; el perfil
  se relee al reingresar. La clave vieja `explora_last_user` se borra al arrancar.
- La pantalla deja de mostrar OV, fecha de entrega, banda horaria, observaciones,
  horario de carga y transporte (los bloques se ocultan si no hay dato).
- Se conserva el aviso a Apps Script (`chofer_demora` / `chofer_finalizo`) y `app_logs`
  (ahora con `viaje_id` en lugar de `pedido_id`).

- Nuevo: `src/compartido.js`, `src/perfilChofer.js`
- Modificado: `App.js`, `src/screens/LoginScreen.js`, `src/screens/ChoferScreen.js`

** Tema claro/oscuro, tipografía y layout (Frentes A1 y E)**

- Nuevo tema claro/oscuro: arranca con el del sistema; desde el encabezado (🌓)
  se elige Automático / Claro / Oscuro y la elección se recuerda (`explora_tema`).
  Todos los colores salen de los tokens compartidos (`marca` #C60000, `temaClaro`,
  `temaOscuro`, `colorEstado`); desaparecen los literales de color.
- Tipografía Montserrat (400 a 800) cargada con `expo-font`.
- Encabezado: degradé y etiqueta según el estado real del viaje (Asignado / En
  ruta); la demora se muestra como badge "Demorado". Badges de volumen, tiempo
  y OV (esta última solo si el dato existe). "Salir" y el selector de tema con
  zona táctil ampliada.
- Tarjetas: se agrega Origen; los campos opcionales se muestran solo si hay dato.
- Textos: "Portal Explora" pasa a "TrackEx"; el botón de biometría dice
  "Ingresar con biometría" (el carácter anterior se veía como un cuadrado); el
  placeholder del DNI es "12345678".
- Edge-to-edge: el encabezado, el pie y los bottom sheets respetan los insets
  del sistema (reemplazan los paddings fijos 60 y 80) y los laterales respetan
  notch o cámara en horizontal. `StatusBar` de `expo-status-bar`.
- Teclado: el login pasa a ScrollView + KeyboardAvoidingView; el modal de demora
  también evita el teclado.
- Orientación libre (`orientation: default`) y `userInterfaceStyle: automatic`
  en `app.json`. En pantallas grandes el contenido se centra con ancho máximo 600.
- Pie con la versión ("TrackEx · v…") en el login y en la pantalla del chofer.
- Dependencias nuevas: `expo-font`, `@expo-google-fonts/montserrat`, `expo-constants`.
- Nuevo: `src/tema/` (`TemaContext.js`, `fuentes.js`, `encabezados.js`,
  `dimensiones.js`), `src/componentes/` (`ColumnaCentrada.js`, `PieVersion.js`)
- Modificado: `App.js`, `LoginScreen.js`, `ChoferScreen.js`, `config/constants.js`
  (se quitan `HEADER_COLORS` y `ESTADO_LABEL`), `app.json`, `package.json`

** Avisos al chofer, bandeja en la app y notificaciones push (Frente F)**

- Bandeja de avisos en la pantalla del chofer: una tarjeta por aviso sin leer
  (viaje nuevo, viaje cancelado, cambio de destino) con título, mensaje, "hace X" y
  el botón "Entendido", que lo marca como leído. Colores por tipo salidos de los
  tokens. Sin avisos, no se muestra.
- Notificaciones push: al ingresar, la app pide el permiso, obtiene el token de Expo y
  lo guarda en el perfil del chofer (`usuarios/{uid}.push_token`); al cerrar sesión
  lo borra (con un tope de 3 segundos para no bloquear sin red). Canal de Android
  "Avisos de viaje" (importancia alta) y notificación visible con la app abierta.
- El permiso de notificaciones se pide en un solo lugar: el servicio de GPS ya no
  lo pide por su cuenta.
- El envío lo hace un trigger de Apps Script (`PushAvisos.gs`, cada minuto), no la app.
- Portal: nominar escribe el aviso "Tenés un viaje nuevo" al chofer, y cancelar un
  despacho con viaje avisa también al chofer ("Se canceló tu viaje").
- Reglas de Firestore: el transportista puede crear solo el aviso de nominación,
  atado al viaje que crea en la misma transacción; el chofer puede escribir solo su
  `push_token`. Pendiente de publicar.
- `logApp` pasa a `src/registro.js` (sin cambios de comportamiento).
- `app.json`: plugin `expo-notifications` (color de marca y canal por defecto).
  Falta `googleServicesFile` (FCM) para recibir push en un build de EAS.
- Nuevo: `src/notificaciones.js`, `src/avisos.js`, `src/registro.js`
- Modificado: `App.js`, `ChoferScreen.js`, `app.json`
- Fuera de la app: `portal/src/logica-transportista.js`, `portal/src/logica-despachos.js`,
  `portal/firestore.rules.produccion`, `portal/app-script/plan-produccion/PushAvisos.gs` (nuevo)

** Splash, ícono de notificación y fondo del ícono adaptable (Frente A2)**

- Splash con `expo-splash-screen` (plugin, sin la clave legacy `splash`): símbolo
  blanco `splash-icon.png`, ancho 200, `contain`, sobre el rojo del ícono `#C9173A`.
- Ícono adaptable de Android: el fondo pasa de `#E6F4FE` (color de plantilla de Expo)
  a `#C9173A`, el color real de `android-icon-background.png` (verificado leyendo el PNG).
- Ícono de notificación nuevo `assets/notification-icon.png` (96x96, blanco puro con
  fondo transparente, generado a partir de `android-icon-monochrome.png`, recortado a
  la silueta y con 8 % de margen por lado). El plugin `expo-notifications` lo usa
  como `icon` y su `color` pasa de `#C60000` a `#C9173A`. El rojo del ícono
  (`#C9173A`) no es el `marca` de la interfaz (`#C60000`).
- El splash y el ícono de notificación solo se ven correctos en un build de EAS, no
  en Expo Go.
- Dependencia nueva: `expo-splash-screen ~56.0.15`.
- Nuevo: `assets/notification-icon.png`
- Modificado: `app.json`, `package.json`, `package-lock.json`

## v1.0.3 - versionCode 7 - 18/08/2026
** Corrección permisos de ubicación en la aplicación

Se corrige la utilización de permisos de ubicacion otorgados por el usuario para, inicialmente pedir usar la ubicación en primer
plano y posteriormente utilizar la ubicación en segundo plano para trackear el viaje sin necesidad de que tenga la pantalla prendida

Asi como tambien se corrigen las notificaciones para que se muestre información util y no sea molesto al uso.

## v1.0.2 - versionCode 6 - 23/07/2026
** Filtro de precisión/velocidad GPS + recorrido completo en seguimiento**

Se programa un filtro para evitar saltos imposibles que impiden una lectura limpia del recorrido del chofer en el seguimiento
Estos cambios se perdieron anteriormente por recontrucción de las rama main

## v1.0.1 — versionCode 4 — 23/07/2026

**Configuración de Android y EAS para Play Store.** Reconstrucción de
`app.json` (paquete, permisos, plugin de ubicación) y creación de
`eas.json`. Resuelve los errores de bundle inválido en Google Play
Console.

- Nuevo: `eas.json`
- Modificado: `app.json`, `package.json`

## v1.0.0 — 23/07/2026

Versión base — punto de partida a partir del cual se empieza a versionar
la app de forma explícita.

