const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
// The Mac app and the iPhone app share their data model, storage, sync and editing
// operations: the `core` folder at the repository root.
const shared = path.resolve(projectRoot, '../../core')

const config = getDefaultConfig(projectRoot)
config.watchFolders = [...(config.watchFolders ?? []), shared]

const defaultResolve = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolve ?? context.resolveRequest
  if (moduleName.startsWith('@shared/')) {
    return resolve(context, path.join(shared, moduleName.slice('@shared/'.length)), platform)
  }
  // Packages imported by shared code (fractional-indexing, @supabase/supabase-js) come from
  // this app's node_modules, never from the Mac app's.
  if (context.originModulePath.startsWith(shared + path.sep) && !moduleName.startsWith('.')) {
    return resolve({ ...context, originModulePath: path.join(projectRoot, 'index.ts') }, moduleName, platform)
  }
  return resolve(context, moduleName, platform)
}

module.exports = config
