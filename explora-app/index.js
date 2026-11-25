import './src/gps/tarea';
import { registerRootComponent } from 'expo';

import App from './App';

// TrackEx v1.1.2 — GPS: la PRIMERA línea importa la tarea de GPS en segundo
// plano. La doc de expo-task-manager (SDK 56) exige que `defineTask` se llame
// en el ámbito global del bundle: cuando Android levanta la app en segundo
// plano no monta ninguna vista. Importarla antes que App deja la tarea definida
// sin depender de que se importe ChoferScreen (ver src/gps/tarea.js).

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
