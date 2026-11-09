import { cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rebuild } from '@electron/rebuild'

const require = createRequire(import.meta.url)
const buildPath = fileURLToPath(
  new URL('../.electron-native/', import.meta.url),
)
const sourceManifest = require.resolve('better-sqlite3/package.json')
const source = dirname(sourceManifest)
const manifest = JSON.parse(await readFile(sourceManifest, 'utf8'))
const modules = join(buildPath, 'node_modules')

// pnpm shares the installed native module with Node consumers. Rebuild a
// physical copy in a root with no workspace links for the rebuilder to follow.
await rm(buildPath, { recursive: true, force: true })
await mkdir(modules, { recursive: true })
await writeFile(
  join(buildPath, 'package.json'),
  JSON.stringify({
    private: true,
    dependencies: { 'better-sqlite3': manifest.version },
  }),
)
await cp(source, join(modules, 'better-sqlite3'), { recursive: true })
const sourceRequire = createRequire(sourceManifest)
for (const dependency of Object.keys(manifest.dependencies ?? {})) {
  const target = join(modules, dependency)
  await mkdir(dirname(target), { recursive: true })
  await symlink(
    dirname(sourceRequire.resolve(`${dependency}/package.json`)),
    target,
    process.platform === 'win32' ? 'junction' : 'dir',
  )
}
await rebuild({
  buildPath,
  projectRootPath: buildPath,
  electronVersion: require('electron/package.json').version,
  onlyModules: ['better-sqlite3'],
  force: true,
})
