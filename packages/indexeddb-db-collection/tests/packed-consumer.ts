/** Packaging mechanics only. Pack the candidate and its installed dependency
 * closure, then install those tarballs in a disposable consumer. File overrides
 * keep this lane offline and deterministic; they never point at workspace source
 * or dist directories. No build runs here: the package/CI lane builds first.
 */
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

type Manifest = {
  name: string
  version: string
  dependencies?: Record<string, string>
}
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
function dependencyDirectory(from: string, name: string): string {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json')))
      return realpathSync(candidate)
    if (dirname(dir) === dir)
      throw new Error(`Installed dependency ${name} missing from ${from}`)
  }
}
export const consumerSource = `
import { createCollection } from '@tanstack/db'
import * as adapter from '@tanstack/indexeddb-db-collection'
export async function run(factory) {
  const open = () => adapter.createIndexedDB({ name: 'packed-consumer', version: 1, stores: ['rows'], idbFactory: factory })
  const make = db => createCollection(adapter.indexedDBCollectionOptions({ db, name: 'rows', getKey: row => row.id }))
  const db = await open()
  const collection = make(db)
  try {
    await collection.preload()
    await collection.insert({ id: 1, name: 'inserted' }).isPersisted.promise
    await collection.update(1, draft => { draft.name = 'updated' }).isPersisted.promise
  } finally { await collection.cleanup(); db.close() }
  const reopened = await open()
  const restored = make(reopened)
  try {
    await restored.preload()
    return { rows: [...restored.values()].map(({ id, name }) => ({ id, name })),
      exports: ['createIndexedDB', 'indexedDBCollectionOptions', 'deleteDatabase', 'executeTransaction'].map(name => typeof adapter[name]) }
  } finally { await restored.cleanup(); reopened.close() }
}
`
// The workspace pins pnpm. Its explicit option suppresses all pack hooks,
// including prepare, which older npm versions can run despite --ignore-scripts.
// Consume the existing build without mutating installed dependency artifacts.
export function packPackage(directory: string, archives: string) {
  execFileSync(
    'pnpm',
    ['pack', '--pack-destination', archives, '--config.ignore-scripts=true'],
    {
      cwd: directory,
      stdio: 'pipe',
      env: { ...process.env, pnpm_config_verify_deps_before_run: 'warn' },
    },
  )
}

export function createPackedConsumer() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'indexeddb-packed-')))
  try {
    const archives = join(root, 'archives')
    mkdirSync(archives)
    const packages = new Map<
      string,
      { directory: string; manifest: Manifest }
    >()
    function visit(directory: string) {
      const manifest = JSON.parse(
        readFileSync(join(directory, 'package.json'), 'utf8'),
      ) as Manifest
      if (packages.has(manifest.name)) return
      packages.set(manifest.name, { directory, manifest })
      for (const name of Object.keys(manifest.dependencies ?? {}))
        visit(dependencyDirectory(directory, name))
    }
    visit(packageRoot)
    visit(dependencyDirectory(packageRoot, 'fake-indexeddb'))
    const dependencies: Record<string, string> = {}
    for (const { directory, manifest } of packages.values()) {
      packPackage(directory, archives)
      dependencies[manifest.name] =
        `file:${join(archives, manifest.name.replace('@', '').replace('/', '-') + '-' + manifest.version + '.tgz')}`
    }
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ private: true, type: 'module', dependencies }),
    )
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      JSON.stringify({ overrides: dependencies, autoInstallPeers: false }),
    )
    try {
      execFileSync(
        'pnpm',
        [
          'install',
          '--offline',
          '--ignore-scripts',
          '--config.auto-install-peers=false',
        ],
        { cwd: root, stdio: 'pipe' },
      )
    } catch (error) {
      throw new Error(
        `Packed consumer installation failed: ${error instanceof Error && 'stdout' in error ? String(error.stdout) : String(error)}`,
        { cause: error },
      )
    }
    writeFileSync(join(root, 'consumer.mjs'), consumerSource)
    return {
      root,
      cleanup: () => rmSync(root, { recursive: true, force: true }),
    }
  } catch (error) {
    rmSync(root, { recursive: true, force: true })
    throw error
  }
}

export async function buildPackedBrowser(root: string) {
  writeFileSync(
    join(root, 'index.html'),
    '<script type="module" src="/browser.mjs"></script>',
  )
  writeFileSync(
    join(root, 'browser.mjs'),
    `import { run } from './consumer.mjs'; window.packedResult = await run(indexedDB)`,
  )
  await build({
    configFile: false,
    root,
    logLevel: 'error',
    build: { target: 'esnext', outDir: 'web' },
  })
  return join(root, 'web')
}
