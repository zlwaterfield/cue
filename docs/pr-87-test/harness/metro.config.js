const path = require('node:path')
const config = require('./metro.base.config')
const h = (f) => path.join(__dirname, 'harness', f)
const alias = { 'expo-secure-store': h('secure-store.js'), 'expo-sqlite': h('sqlite.js'), 'react-native-safe-area-context': h('safe-area.js'), 'react-native-keyboard-controller': h('keyboard.js') }
const inner = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (alias[moduleName] && context.originModulePath !== alias[moduleName]) return { type: 'sourceFile', filePath: alias[moduleName] }
  return inner(context, moduleName, platform)
}
module.exports = config
