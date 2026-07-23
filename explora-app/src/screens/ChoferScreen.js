import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, Linking, Modal, TextInput
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { collection, onSnapshot, doc, getDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { db } from '../config/firebase';
import { APPS_SCRIPT_URL, HEADER_COLORS, ESTADO_LABEL } from '../config/constants';

const GPS_TASK = 'explora-gps-task';

// Umbral de precisión: si el GPS reporta más de 100m de radio de error,
// descartamos la lectura — es la causa más común de que la posición
// "salte" cuando el camión está parado cerca de estructuras metálicas,
// tanques o galpones (señal rebotada, no movimiento real).
const PRECISION_MAXIMA_METROS = 100;

// Velocidad máxima físicamente razonable para un camión en ruta/planta.
// Un salto que implique más que esto entre dos lecturas es ruido de GPS,
// no movimiento real.
const VELOCIDAD_MAXIMA_KMH = 150;

// Distancia entre dos coordenadas (fórmula de Haversine), en metros.
function distanciaMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Tarea background de GPS — corre aunque el teléfono esté bloqueado
TaskManager.defineTask(GPS_TASK, async ({ data, error }) => {
  if (error) { console.error('GPS task error:', error); return; }
  if (!data) return;
  const { locations } = data;
  const location = locations[0];
  if (!location) return;

  // Filtro 1: descartar lecturas de baja precisión
  if (location.coords.accuracy != null && location.coords.accuracy > PRECISION_MAXIMA_METROS) {
    return;
  }

  // El docId y despachoIdx se guardan en el módulo al iniciar
  const stored = global.exploraViajeActivo;
  if (!stored) return;
  try {
    const snap = await getDoc(doc(db, 'pedidos_portal', stored.docId));
    const pedido = snap.data();
    const despachoActual = pedido.despachos[stored.despachoIdx];

    // Filtro 2: descartar saltos que implican velocidad imposible
    // (comparando contra la última posición guardada)
    if (despachoActual.gps_lat != null && despachoActual.gps_lng != null && despachoActual.gps_ts) {
      const metros = distanciaMetros(
        despachoActual.gps_lat, despachoActual.gps_lng,
        location.coords.latitude, location.coords.longitude
      );
      const segundos = (Date.now() - new Date(despachoActual.gps_ts).getTime()) / 1000;
      const kmh = segundos > 0 ? (metros / segundos) * 3.6 : 0;
      if (kmh > VELOCIDAD_MAXIMA_KMH) {
        return;
      }
    }

    const nuevosDespachos = [...pedido.despachos];
    nuevosDespachos[stored.despachoIdx] = {
      ...despachoActual,
      gps_lat: location.coords.latitude,
      gps_lng: location.coords.longitude,
      gps_ts: new Date().toISOString(),
    };

    // Acumula cada punto del recorrido en un array aparte (uno por
    // despacho), para poder dibujar el recorrido completo en el mapa
    // de Seguimiento cuando el viaje finalice.
    const trackField = `gps_track_${stored.despachoIdx}`;
    await updateDoc(doc(db, 'pedidos_portal', stored.docId), {
      despachos: nuevosDespachos,
      [trackField]: arrayUnion({
        lat: location.coords.latitude,
        lng: location.coords.longitude,
        ts: new Date().toISOString(),
      }),
    });
  } catch (e) {
    console.error('GPS background write error:', e);
  }
});

export default function ChoferScreen({ usuario, onLogout }) {
  const [viajes, setViajes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [procesando, setProcesando] = useState(false);
  const [modalDemora, setModalDemora] = useState(null);
  const [motivoDemora, setMotivoDemora] = useState('');
  const [modalFinalizar, setModalFinalizar] = useState(null);
  const viajeActivoRef = useRef(null);

  const dniUsuario = usuario?.dni || '';

  useEffect(() => {
    if (!dniUsuario) { setCargando(false); return; }
    const unsub = onSnapshot(collection(db, 'pedidos_portal'), (snap) => {
      const encontrados = [];
      snap.docs.forEach(d => {
        const pedido = d.data();
        (pedido.despachos || []).forEach((despacho, i) => {
          if (despacho.dni_chofer !== dniUsuario) return;
          const estadoChofer = despacho.estado_chofer || '';
          if (!['recibido', 'iniciado', 'demorado'].includes(estadoChofer)) return;
          encontrados.push({
            docId: d.id,
            pedidoId: pedido.id,
            despachoIdx: i,
            uid: pedido.id + '-D' + (i + 1),
            estado_chofer: estadoChofer,
            estado_chofer_ts: despacho.estado_chofer_ts || '',
            demora_motivo: despacho.demora_motivo || '',
            producto: pedido.producto,
            volumen: despacho.volumen,
            cliente: pedido.cliente,
            ov: pedido.ov,
            lugar: pedido.lugar,
            fecha_carga: despacho.fecha_carga,
            horario_carga: despacho.horario_carga || '',
            fecha_entrega: pedido.fecha_entrega,
            banda_horaria: pedido.banda_horaria || '',
            obs: pedido.obs || '',
            transporte: despacho.transporte,
            patente_tractor: despacho.patente_tractor || '',
            patente_semi: despacho.patente_semi || '',
          });
        });
      });
      encontrados.sort((a, b) => new Date(a.fecha_carga) - new Date(b.fecha_carga));
      setViajes(encontrados);
      setCargando(false);
    });
    return () => unsub();
  }, [dniUsuario]);

  // Actualizar ref y global para GPS background
  useEffect(() => {
    const activo = viajes.find(v => v.estado_chofer === 'iniciado' || v.estado_chofer === 'demorado');
    viajeActivoRef.current = activo || null;
    global.exploraViajeActivo = activo ? { docId: activo.docId, despachoIdx: activo.despachoIdx } : null;

    if (activo) {
      iniciarGPSBackground();
    } else {
      detenerGPSBackground();
    }
  }, [viajes]);

  async function iniciarGPSBackground() {
    const { status } = await Location.requestBackgroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permiso de ubicación', 'Necesitamos acceso a tu ubicación en segundo plano para el seguimiento del viaje.');
      return;
    }
    const running = await Location.hasStartedLocationUpdatesAsync(GPS_TASK).catch(() => false);
    if (!running) {
      await Location.startLocationUpdatesAsync(GPS_TASK, {
        accuracy: Location.Accuracy.High,
        timeInterval: 60000,
        distanceInterval: 100,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'Portal Explora',
          notificationBody: 'Seguimiento de viaje activo',
          notificationColor: '#C8102E',
        },
      });
    }
  }

  async function detenerGPSBackground() {
    const running = await Location.hasStartedLocationUpdatesAsync(GPS_TASK).catch(() => false);
    if (running) {
      await Location.stopLocationUpdatesAsync(GPS_TASK);
    }
  }

  async function cambiarEstado(viaje, nuevoEstado, extras = {}) {
    setProcesando(true);
    try {
      const snap = await getDoc(doc(db, 'pedidos_portal', viaje.docId));
      const pedido = snap.data();
      const nuevosDespachos = [...pedido.despachos];
      nuevosDespachos[viaje.despachoIdx] = {
        ...nuevosDespachos[viaje.despachoIdx],
        estado_chofer: nuevoEstado,
        estado_chofer_ts: new Date().toISOString(),
        ...extras,
      };
      await updateDoc(doc(db, 'pedidos_portal', viaje.docId), { despachos: nuevosDespachos });
      if (nuevoEstado === 'demorado' || nuevoEstado === 'finalizado') {
        const payload = {
          accion: nuevoEstado === 'demorado' ? 'chofer_demora' : 'chofer_finalizo',
          pedido_id: viaje.pedidoId,
          chofer: usuario?.nombre || dniUsuario,
          producto: viaje.producto,
          cliente: viaje.cliente,
          ov: viaje.ov,
          lugar: viaje.lugar,
          motivo: extras.demora_motivo || '',
        };
        await fetch(APPS_SCRIPT_URL + '?' + new URLSearchParams({ payload: JSON.stringify(payload) }).toString());
      }
    } catch (err) {
      Alert.alert('Error', 'No se pudo actualizar el estado. Intentá de nuevo.');
    } finally {
      setProcesando(false);
    }
  }

  async function confirmarDemora() {
    if (!motivoDemora.trim()) { Alert.alert('Error', 'Describí el problema antes de continuar.'); return; }
    await cambiarEstado(modalDemora, 'demorado', { demora_motivo: motivoDemora.trim() });
    setModalDemora(null);
    setMotivoDemora('');
  }

  async function confirmarFinalizar() {
    await cambiarEstado(modalFinalizar, 'finalizado', { chofer_fin_ts: new Date().toISOString() });
    setModalFinalizar(null);
  }

  function abrirGoogleMaps(lugar) {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(lugar)}&travelmode=driving`;
    Linking.openURL(url);
  }

  function abrirWaze(lugar) {
    const url = `waze://?q=${encodeURIComponent(lugar)}&navigate=yes`;
    Linking.canOpenURL(url).then(supported => {
      if (supported) Linking.openURL(url);
      else Linking.openURL(`https://waze.com/ul?q=${encodeURIComponent(lugar)}&navigate=yes`);
    });
  }

  function formatFecha(str) {
    if (!str) return '—';
    const partes = str.split('-');
    return partes.length === 3 ? `${partes[2]}/${partes[1]}` : str;
  }

  function tiempoDesde(isoStr) {
    if (!isoStr) return '';
    const diff = Date.now() - new Date(isoStr).getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (h > 0) return `hace ${h} h ${m} min`;
    return `hace ${m} min`;
  }

  const viajeActivo = viajes[0] || null;
  const estadoActual = viajeActivo?.estado_chofer || 'libre';
  const hc = HEADER_COLORS[estadoActual] || HEADER_COLORS.libre;
  const nombreCorto = usuario?.nombre?.split(' ')[0] || 'Chofer';

  return (
    <View style={s.wrap}>

      {/* Modal demora */}
      <Modal visible={!!modalDemora} transparent animationType="slide">
        <View style={s.overlay}>
          <View style={s.modal}>
            <Text style={s.modalIco}>⚠️</Text>
            <Text style={s.modalTit}>Reportar demora</Text>
            {modalDemora && <Text style={s.modalSub}>{modalDemora.producto} · {modalDemora.cliente}</Text>}
            <TextInput style={s.textarea} placeholder="Describí el problema (tráfico, desperfecto, clima, etc.)"
              value={motivoDemora} onChangeText={setMotivoDemora} multiline numberOfLines={3} />
            <TouchableOpacity style={s.btnRojo} onPress={confirmarDemora} disabled={procesando}>
              <Text style={s.btnBlanco}>{procesando ? 'Enviando...' : 'Reportar demora'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.btnGris} onPress={() => { setModalDemora(null); setMotivoDemora(''); }}>
              <Text style={s.btnGrisTxt}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal finalizar */}
      <Modal visible={!!modalFinalizar} transparent animationType="slide">
        <View style={s.overlay}>
          <View style={s.modal}>
            <Text style={s.modalIco}>✅</Text>
            <Text style={s.modalTit}>Confirmar entrega</Text>
            {modalFinalizar && <Text style={s.modalSub}>{modalFinalizar.producto} · {modalFinalizar.cliente}{'\n'}{modalFinalizar.lugar}</Text>}
            <Text style={s.modalDesc}>Al confirmar, el coordinador recibe la notificación y quedás libre para un nuevo viaje.</Text>
            <TouchableOpacity style={s.btnVerde} onPress={confirmarFinalizar} disabled={procesando}>
              <Text style={s.btnBlanco}>{procesando ? 'Confirmando...' : '✓ Confirmar entrega'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.btnGris} onPress={() => setModalFinalizar(null)}>
              <Text style={s.btnGrisTxt}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Header degradé */}
      <LinearGradient colors={[hc.from, hc.to]} style={s.header}>
        <View style={s.headerTop}>
          <Text style={s.headerAppName}>Portal Explora</Text>
          <TouchableOpacity onPress={onLogout}>
            <Text style={s.btnSalir}>Salir</Text>
          </TouchableOpacity>
        </View>
        {cargando ? (
          <Text style={s.headerSub}>Cargando...</Text>
        ) : viajeActivo ? (
          <View style={s.headerContent}>
            <Text style={s.headerSub}>{ESTADO_LABEL[estadoActual] || estadoActual}</Text>
            <Text style={s.headerTitulo}>{viajeActivo.producto} · {viajeActivo.cliente}</Text>
            <View style={s.badgeRow}>
              <View style={s.badge}><Text style={s.badgeTxt}>{viajeActivo.volumen} tn</Text></View>
              <View style={s.badge}><Text style={s.badgeTxt}>OV {viajeActivo.ov}</Text></View>
              {viajeActivo.estado_chofer_ts && (
                <View style={s.badge}><Text style={s.badgeTxt}>{tiempoDesde(viajeActivo.estado_chofer_ts)}</Text></View>
              )}
            </View>
          </View>
        ) : (
          <View style={s.headerContent}>
            <Text style={s.headerSub}>Sin viajes activos</Text>
            <Text style={s.headerTitulo}>Hola, {nombreCorto}</Text>
            <View style={s.badgeRow}>
              <View style={s.badge}><Text style={s.badgeTxt}>🟢 Libre</Text></View>
            </View>
          </View>
        )}
      </LinearGradient>

      <ScrollView style={s.body} contentContainerStyle={{ paddingBottom: 40 }}>

        {!dniUsuario && (
          <View style={s.alerta}>
            <Text style={s.alertaTxt}>⚠️ Tu perfil no tiene DNI registrado. Contactá al administrador.</Text>
          </View>
        )}

        {!cargando && dniUsuario && viajes.length === 0 && (
          <View style={s.libreWrap}>
            <Text style={s.libreIco}>🟢</Text>
            <Text style={s.libreTit}>Libre</Text>
            <Text style={s.libreSub}>Cuando el transportista te nomine, el viaje aparecerá acá automáticamente.</Text>
          </View>
        )}

        {viajes.map(v => (
          <View key={v.uid} style={s.card}>
            <View style={s.cardGrid}>
              <View style={s.field}><Text style={s.lbl}>Destino</Text><Text style={s.val}>{v.lugar}</Text></View>
              <View style={s.field}><Text style={s.lbl}>Fecha carga</Text><Text style={s.val}>{formatFecha(v.fecha_carga)}{v.horario_carga ? ' · ' + v.horario_carga : ''}</Text></View>
              {v.fecha_entrega && <View style={s.field}><Text style={s.lbl}>Entrega</Text><Text style={s.val}>{formatFecha(v.fecha_entrega)}{v.banda_horaria ? ' · ' + v.banda_horaria : ''}</Text></View>}
              <View style={s.field}><Text style={s.lbl}>Unidad</Text><Text style={s.val}>{v.patente_tractor}{v.patente_semi ? ' / ' + v.patente_semi : ''}</Text></View>
              <View style={s.field}><Text style={s.lbl}>Transporte</Text><Text style={s.val}>{v.transporte}</Text></View>
            </View>

            {v.obs ? <View style={s.obsBanner}><Text style={s.obsTxt}>📋 {v.obs}</Text></View> : null}
            {v.estado_chofer === 'demorado' && v.demora_motivo ? <View style={s.demoraBanner}><Text style={s.demoraTxt}>⚠️ {v.demora_motivo}</Text></View> : null}

            {/* Navegación */}
            {(v.estado_chofer === 'iniciado' || v.estado_chofer === 'demorado') && v.lugar && (
              <View style={s.navWrap}>
                <Text style={s.navLbl}>📍 {v.lugar}</Text>
                <View style={s.navBtns}>
                  <TouchableOpacity style={s.btnGoogleMaps} onPress={() => abrirGoogleMaps(v.lugar)}>
                    <Text style={s.btnGoogleMapsTxt}>🗺 Google Maps</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.btnWaze} onPress={() => abrirWaze(v.lugar)}>
                    <Text style={s.btnWazeTxt}>Waze</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Acciones */}
            <View style={s.actions}>
              {v.estado_chofer === 'recibido' && (
                <TouchableOpacity style={[s.btnPrimario, { opacity: procesando ? 0.7 : 1 }]}
                  disabled={procesando}
                  onPress={() => cambiarEstado(v, 'iniciado', { chofer_inicio_ts: new Date().toISOString() })}>
                  {procesando ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimarioTxt}>🚛 Iniciar viaje</Text>}
                </TouchableOpacity>
              )}
              {v.estado_chofer === 'iniciado' && (
                <>
                  <TouchableOpacity style={[s.btnPrimario, { opacity: procesando ? 0.7 : 1 }]}
                    disabled={procesando} onPress={() => setModalFinalizar(v)}>
                    <Text style={s.btnPrimarioTxt}>✓ Finalizar viaje</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.btnSecundario, { opacity: procesando ? 0.7 : 1 }]}
                    disabled={procesando} onPress={() => setModalDemora(v)}>
                    <Text style={s.btnSecundarioTxt}>⚠️ Reportar demora</Text>
                  </TouchableOpacity>
                </>
              )}
              {v.estado_chofer === 'demorado' && (
                <>
                  <TouchableOpacity style={[s.btnPrimario, { opacity: procesando ? 0.7 : 1 }]}
                    disabled={procesando} onPress={() => setModalFinalizar(v)}>
                    <Text style={s.btnPrimarioTxt}>✓ Finalizar viaje</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.btnSecundario, { opacity: procesando ? 0.7 : 1 }]}
                    disabled={procesando} onPress={() => cambiarEstado(v, 'iniciado')}>
                    <Text style={s.btnSecundarioTxt}>▶ Continuar viaje</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#F8F8F8' },
  header: { paddingTop: 60, paddingBottom: 32, paddingHorizontal: 16 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  headerAppName: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.8)' },
  btnSalir: { fontSize: 13, color: 'rgba(255,255,255,0.6)', padding: 4 },
  headerContent: { gap: 6 },
  headerSub: { fontSize: 11, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: 1 },
  headerTitulo: { fontSize: 22, fontWeight: '700', color: '#fff', letterSpacing: -0.3 },
  badgeRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 4 },
  badge: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  badgeTxt: { fontSize: 12, color: '#fff', fontWeight: '500' },
  body: { flex: 1, padding: 14 },
  alerta: { backgroundColor: '#FAEEDA', borderRadius: 10, padding: 12, marginBottom: 14 },
  alertaTxt: { fontSize: 13, color: '#633806' },
  libreWrap: { alignItems: 'center', paddingVertical: 60 },
  libreIco: { fontSize: 48, marginBottom: 12 },
  libreTit: { fontSize: 24, fontWeight: '700', color: '#111827', marginBottom: 8 },
  libreSub: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', lineHeight: 22, paddingHorizontal: 20 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  field: { width: '47%' },
  lbl: { fontSize: 11, color: '#9CA3AF', marginBottom: 2 },
  val: { fontSize: 13, color: '#111827', fontWeight: '500' },
  obsBanner: { backgroundColor: '#F9FAFB', borderRadius: 8, padding: 10, marginBottom: 10 },
  obsTxt: { fontSize: 12, color: '#6B7280' },
  demoraBanner: { backgroundColor: '#FAEEDA', borderRadius: 8, padding: 10, marginBottom: 10 },
  demoraTxt: { fontSize: 12, color: '#633806' },
  navWrap: { backgroundColor: '#F9FAFB', borderRadius: 10, padding: 10, marginBottom: 10 },
  navLbl: { fontSize: 12, color: '#6B7280', marginBottom: 8 },
  navBtns: { flexDirection: 'row', gap: 8 },
  btnGoogleMaps: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, padding: 10, alignItems: 'center' },
  btnGoogleMapsTxt: { fontSize: 13, fontWeight: '500', color: '#111827' },
  btnWaze: { flex: 1, backgroundColor: '#33CCFF', borderRadius: 8, padding: 10, alignItems: 'center' },
  btnWazeTxt: { fontSize: 13, fontWeight: '500', color: '#fff' },
  actions: { gap: 8 },
  btnPrimario: { backgroundColor: '#0F6E56', borderRadius: 10, padding: 14, alignItems: 'center' },
  btnPrimarioTxt: { color: '#fff', fontSize: 15, fontWeight: '600' },
  btnSecundario: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, padding: 12, alignItems: 'center' },
  btnSecundarioTxt: { fontSize: 14, color: '#374151' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 10 },
  modalIco: { fontSize: 36, textAlign: 'center' },
  modalTit: { fontSize: 18, fontWeight: '700', color: '#111827', textAlign: 'center' },
  modalSub: { fontSize: 13, color: '#6B7280', textAlign: 'center', lineHeight: 20 },
  modalDesc: { fontSize: 13, color: '#6B7280', textAlign: 'center', lineHeight: 20 },
  textarea: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, padding: 12, fontSize: 14, minHeight: 80, textAlignVertical: 'top' },
  btnVerde: { backgroundColor: '#0F6E56', borderRadius: 10, padding: 14, alignItems: 'center' },
  btnRojo: { backgroundColor: '#C8102E', borderRadius: 10, padding: 14, alignItems: 'center' },
  btnGris: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, padding: 12, alignItems: 'center' },
  btnBlanco: { color: '#fff', fontSize: 15, fontWeight: '600' },
  btnGrisTxt: { fontSize: 14, color: '#6B7280' },
});
