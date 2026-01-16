const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const monorepoRoot = path.resolve(projectRoot, '../../..')

const config = getDefaultConfig(projectRoot)

// Watch all files in the monorepo
config.watchFolders = [monorepoRoot]

// Ensure symlinks are followed (important for pnpm)
config.resolver.unstable_enableSymlinks = true

// Force all React-related packages to resolve from THIS project's node_modules
// This prevents the "multiple copies of React" error
const localNodeModules = path.resolve(projectRoot, 'node_modules')
config.resolver.extraNodeModules = new Proxy(
  {
    react: path.resolve(localNodeModules, 'react'),
    'react-native': path.resolve(localNodeModules, 'react-native'),
    'react/jsx-runtime': path.resolve(localNodeModules, 'react/jsx-runtime'),
    'react/jsx-dev-runtime': path.resolve(
      localNodeModules,
      'react/jsx-dev-runtime',
    ),
  },
  {
    get: (target, name) => {
      if (target[name]) {
        return target[name]
      }
      // Fall back to normal resolution for other modules
      return path.resolve(localNodeModules, name)
    },
  },
)

// Block react-native 0.83 from root node_modules
config.resolver.blockList = [
  new RegExp(
    `${monorepoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/node_modules/\\.pnpm/react-native@0\\.83.*`,
  ),
  new RegExp(
    `${monorepoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/node_modules/\\.pnpm/react@(?!19\\.0\\.0).*`,
  ),
]

// Let Metro know where to resolve packages from (local first, then root)
config.resolver.nodeModulesPaths = [
  localNodeModules,
  path.resolve(monorepoRoot, 'node_modules'),
]

module.exports = config
