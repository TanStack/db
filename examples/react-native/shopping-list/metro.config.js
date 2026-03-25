const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const monorepoRoot = path.resolve(projectRoot, '../../..')

const config = getDefaultConfig(projectRoot)

// Watch all files in the monorepo
config.watchFolders = [monorepoRoot]

// Ensure symlinks are followed (important for pnpm)
config.resolver.unstable_enableSymlinks = true
config.resolver.unstable_enablePackageExports = true
config.resolver.unstable_conditionNames = ['react-native']

const localNodeModules = path.resolve(projectRoot, 'node_modules')

// Singleton packages that must resolve to exactly one copy.
// In a pnpm monorepo, workspace packages may resolve these to a different
// version in the .pnpm store. This custom resolveRequest forces every import
// of these packages (from anywhere) to the app's local node_modules copy.
const singletonPackages = ['react', 'react-native']
const singletonPaths = {}
for (const pkg of singletonPackages) {
  singletonPaths[pkg] = path.resolve(localNodeModules, pkg)
}

const defaultResolveRequest = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Force singleton packages to resolve from the app's local node_modules,
  // regardless of where the import originates. This prevents workspace
  // packages (e.g. react-db) from pulling in their own copy of React.
  for (const pkg of singletonPackages) {
    if (moduleName === pkg || moduleName.startsWith(pkg + '/')) {
      try {
        const filePath = require.resolve(moduleName, {
          paths: [projectRoot],
        })
        return { type: 'sourceFile', filePath }
      } catch {}
    }
  }

  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform)
  }
  return context.resolveRequest(
    { ...context, resolveRequest: undefined },
    moduleName,
    platform,
  )
}

// Force singleton packages to resolve from the app's local node_modules
config.resolver.extraNodeModules = new Proxy(singletonPaths, {
  get: (target, name) => {
    if (target[name]) {
      return target[name]
    }
    return path.resolve(localNodeModules, name)
  },
})

// Block react-native 0.83 from root node_modules
const escMonorepoRoot = monorepoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
config.resolver.blockList = [
  new RegExp(`${escMonorepoRoot}/node_modules/\\.pnpm/react-native@0\\.83.*`),
]

// Let Metro know where to resolve packages from (local first, then root)
config.resolver.nodeModulesPaths = [
  localNodeModules,
  path.resolve(monorepoRoot, 'node_modules'),
]

// Allow dynamic imports with non-literal arguments (used by workspace packages
// for optional Node.js-only code paths that are never reached on React Native)
config.transformer.dynamicDepsInPackages = 'throwAtRuntime'

module.exports = config
