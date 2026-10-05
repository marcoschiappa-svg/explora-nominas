const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Código compartido con el portal (ver portal/src/shared/). Importa
// `firebase/firestore`, así que Metro tiene que resolverlo SIEMPRE desde
// explora-app/node_modules: si lo buscara en portal/node_modules (que puede
// no existir en el build, o traer otra copia de firebase) la `db` de la app
// no sería compatible.
//
// `__dirname` va explícito: si watchFolders se pisa sin incluir la carpeta del
// proyecto, Metro deja de ver los archivos de la propia app.
config.watchFolders = [
  ...new Set([
    ...(config.watchFolders || []),
    __dirname,
    path.resolve(__dirname, '../portal/src/shared'),
  ]),
];

config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];

// NO se usa `disableHierarchicalLookup`: expo tiene dependencias anidadas
// (node_modules/expo/node_modules/expo-asset, etc.) que solo se encuentran
// subiendo por el árbol, y con esa opción el bundle falla con "Unable to
// resolve module expo-asset". En su lugar se bloquea portal/node_modules: así
// el código de shared/ nunca puede resolver una segunda copia de firebase.
const portalNodeModules = path
  .resolve(__dirname, '../portal/node_modules')
  .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const bloqueoPortal = new RegExp(`^${portalNodeModules}[\\\\/].*$`);
config.resolver.blockList = [].concat(config.resolver.blockList || [], bloqueoPortal);

module.exports = config;
