/** Production drivers for release-history-oracle.js; no expected release plan. */
import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packageNames } from './release-history-oracle.js'

const require = createRequire(import.meta.url)
const cli = require.resolve('@changesets/cli/bin.js')
export const fixtureRegistry = 'http://127.0.0.1:4873'

export function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function manifestPath(root, key) {
  return join(root, 'packages', key, 'package.json')
}

export function addFixtureChangeset(root, id, releases) {
  const entries = Object.entries(releases)
    .map(([key, type]) => `'${packageNames[key]}': ${type}`)
    .join('\n')
  writeFileSync(
    join(root, '.changeset', `${id}.md`),
    `---\n${entries}\n---\n\nrelease-token:${id}\n`,
  )
}

export function createReleaseWorkspace(stableDependency = false) {
  const root = mkdtempSync(join(tmpdir(), 'db-release-oracle-'))
  mkdirSync(join(root, '.changeset'))
  mkdirSync(join(root, 'examples'))
  writeJson(join(root, 'package.json'), {
    name: 'release-oracle-fixture',
    private: true,
    packageManager: 'pnpm@11.1.0',
  })
  writeFileSync(
    join(root, 'pnpm-workspace.yaml'),
    'packages:\n  - packages/*\n',
  )
  writeJson(join(root, '.changeset', 'config.json'), {
    changelog: ['./changelog.cjs', null],
    commit: false,
    access: 'public',
    baseBranch: 'main',
    updateInternalDependencies: 'patch',
    fixed: [],
    linked: [],
    ignore: [],
    privatePackages: { version: false, tag: false },
    ___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH: {
      onlyUpdatePeerDependentsWhenOutOfRange: true,
    },
  })
  // Formatting is deliberately trivial. The callback supplies the raw ID;
  // only the independent model decides when/where that ID must occur once.
  writeFileSync(
    join(root, '.changeset', 'changelog.cjs'),
    `
    exports.getReleaseLine = async (changeset) => {
      if (process.env.RELEASE_ORACLE_CHANGELOG_FAIL === ${JSON.stringify(root)})
        throw new Error('injected release changelog failure')
      return '- ' + changeset.summary
    }
    exports.getDependencyReleaseLine = async () => ''
  `,
  )
  const manifests = {
    db: {
      name: packageNames.db,
      version: '0.15.2',
      devDependencies: { 'release-private': 'workspace:*' },
    },
    react: {
      name: packageNames.react,
      version: '0.1.0',
      dependencies: { [packageNames.db]: 'workspace:*' },
    },
    query: {
      name: packageNames.query,
      version: '1.4.8',
      peerDependencies: { [packageNames.db]: '^1.0.0-rc.0' },
    },
    offline: {
      name: packageNames.offline,
      version: '1.1.4',
      ...(stableDependency
        ? { dependencies: { [packageNames.db]: 'workspace:*' } }
        : { peerDependencies: { [packageNames.db]: '^1.0.0-rc.0' } }),
    },
    private: {
      name: 'release-private',
      version: '0.1.0',
      private: true,
      description: 'must retain exact original manifest bytes',
    },
  }
  for (const [key, value] of Object.entries(manifests)) {
    mkdirSync(join(root, 'packages', key), { recursive: true })
    writeJson(manifestPath(root, key), value)
  }
  return { root, privateManifest: structuredClone(manifests.private) }
}

export function enterRealPreMode(root) {
  execFileSync(process.execPath, [cli, 'pre', 'enter', 'rc'], {
    cwd: root,
    stdio: 'pipe',
    timeout: 10_000,
    env: { ...process.env, CI: 'true' },
  })
}

export function exitRealPreMode(root) {
  execFileSync(process.execPath, [cli, 'pre', 'exit'], {
    cwd: root,
    stdio: 'pipe',
    timeout: 10_000,
    env: { ...process.env, CI: 'true' },
  })
}

export function repeatStableVersion(root) {
  execFileSync(process.execPath, [cli, 'version'], {
    cwd: root,
    stdio: 'pipe',
    timeout: 10_000,
    env: { ...process.env, CI: 'true' },
  })
}

export function observeRelease(fixture) {
  const { root } = fixture
  const manifests = Object.fromEntries(
    Object.keys(packageNames).map((key) => [
      key,
      readJson(manifestPath(root, key)),
    ]),
  )
  const prePath = join(root, '.changeset', 'pre.json')
  return {
    versions: Object.fromEntries(
      Object.entries(manifests).map(([key, manifest]) => [
        key,
        manifest.version,
      ]),
    ),
    tokens: Object.fromEntries(
      Object.keys(packageNames).map((key) => {
        const path = join(root, 'packages', key, 'CHANGELOG.md')
        const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
        let version
        const tokens = []
        for (const line of text.split('\n')) {
          if (line.startsWith('## ')) version = line.slice(3)
          for (const match of line.matchAll(/release-token:([a-z0-9-]+)/g))
            tokens.push({ id: match[1], version })
        }
        return [key, tokens]
      }),
    ),
    pre: existsSync(prePath) ? readJson(prePath) : undefined,
    changesets: readdirSync(join(root, '.changeset'))
      .filter((file) => file.endsWith('.md'))
      .map((file) => file.slice(0, -3)),
    privateManifest: readJson(manifestPath(root, 'private')),
    originalPrivateManifest: fixture.privateManifest,
    ignoredDependency: manifests.db.devDependencies['release-private'],
    dependencies: {
      react: manifests.react.dependencies[packageNames.db],
      query: manifests.query.peerDependencies[packageNames.db],
      offline: (manifests.offline.dependencies ??
        manifests.offline.peerDependencies)[packageNames.db],
    },
  }
}

export function workspaceBytes(root) {
  const result = {}
  const visit = (directory, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`
      if (entry.isDirectory()) visit(join(directory, entry.name), `${name}/`)
      else
        result[name] = readFileSync(join(directory, entry.name)).toString(
          'base64',
        )
    }
  }
  visit(root)
  return result
}

export async function withReleaseWorkspace(
  body,
  stableDependency = false,
  cleanupWorkspace = rmSync,
) {
  const fixture = createReleaseWorkspace(stableDependency)
  let failed = false
  let primary
  try {
    return await body(fixture)
  } catch (error) {
    failed = true
    primary = error
    throw error
  } finally {
    try {
      cleanupWorkspace(fixture.root, { recursive: true, force: true })
    } catch (cleanup) {
      throw failed
        ? new AggregateError(
            [primary, cleanup],
            'Release mismatch and workspace cleanup failure',
            { cause: primary },
          )
        : cleanup
    }
  }
}

/**
 * Real Changesets runs behind strict local npm/pnpm process shims. Those shims
 * only supply registry responses and capture requests; they choose no tag.
 * No real npm command, network request, package install or HTTP server runs.
 */
export function preparePublishReceiver(root, history) {
  const bin = join(root, 'bin')
  mkdirSync(bin)
  const registryPath = join(root, 'registry.json')
  const logPath = join(root, 'registry-requests.json')
  const emptyConfig = join(root, 'empty-config')
  writeFileSync(emptyConfig, '')
  const emptyHooks = join(root, 'empty-hooks')
  mkdirSync(emptyHooks)
  const commandEnvironment = () => ({
    PATH: `${bin}:${process.env.PATH}`,
    ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
    npm_config_registry: fixtureRegistry,
    NPM_CONFIG_USERCONFIG: emptyConfig,
    NPM_CONFIG_GLOBALCONFIG: emptyConfig,
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    CI: 'true',
  })
  const manifests = Object.keys(packageNames).map((key) => {
    const manifest = readJson(manifestPath(root, key))
    manifest.version =
      key === 'db' || key === 'react'
        ? history.candidate
        : key === 'query'
          ? '1.5.0'
          : '1.2.0'
    writeJson(manifestPath(root, key), manifest)
    return manifest
  })
  const registry = Object.fromEntries(
    manifests.map((manifest) => [
      manifest.name,
      {
        versions:
          history.registry === 'never'
            ? []
            : history.registry === 'current'
              ? [manifest.version]
              : manifest.name === packageNames.db ||
                  manifest.name === packageNames.react
                ? history.registry === 'only-rc'
                  ? ['1.0.0-rc.1']
                  : ['0.15.2']
                : ['1.0.0'],
        tags: {},
      },
    ]),
  )
  const failureName =
    history.failure === 'stable'
      ? packageNames.query
      : history.failure === 'candidate'
        ? packageNames.db
        : undefined
  writeJson(registryPath, { packages: registry, failureName, failed: false })
  writeJson(logPath, [])
  writeJson(join(root, '.changeset', 'pre.json'), {
    mode: 'pre',
    tag: 'rc',
    initialVersions: Object.fromEntries(
      manifests.map((manifest) => [manifest.name, manifest.version]),
    ),
    changesets: [],
  })
  const shim = `#!${process.execPath}
const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')
const args = process.argv.slice(2)
const tool = path.basename(process.argv[1])
const statePath = ${JSON.stringify(registryPath)}
const logPath = ${JSON.stringify(logPath)}
const registry = process.env.npm_config_registry
let lockHeld = false
function stop(message) {
  if (lockHeld) fs.rmdirSync(statePath + '.lock')
  console.error(message); process.exit(91)
}
if (registry !== ${JSON.stringify(fixtureRegistry)}) stop('foreign or missing registry')
if (tool === 'pnpm' && args.join(' ') === '--version') {
  console.log('11.1.0'); process.exit(0)
}
if (tool === 'pnpm' && args.slice(0, 3).join(' ') === 'exec changeset publish' &&
    (args.length === 3 || (args.length === 5 && args[3] === '--tag' && ['rc', 'latest'].includes(args[4])))) {
  const result = cp.spawnSync(process.execPath, [${JSON.stringify(cli)}, 'publish', ...args.slice(3)], {
    cwd: process.cwd(), env: process.env, stdio: 'inherit', timeout: 10000,
  })
  process.exit(result.status ?? 92)
}
// Changesets can publish independent packages concurrently. Serialize the
// fixture's read-modify-write, preserving every raw attempt and result.
const lock = statePath + '.lock'
const deadline = Date.now() + 2000
while (true) {
  try { fs.mkdirSync(lock); lockHeld = true; break } catch (error) {
    if (error.code !== 'EEXIST' || Date.now() > deadline) throw error
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2)
  }
}
const state = JSON.parse(fs.readFileSync(statePath))
const log = JSON.parse(fs.readFileSync(logPath))
if (tool === 'npm' && args[0] === 'info') {
  const name = args[1]
  if (!state.packages[name]) stop('unknown registry package ' + name)
  if (JSON.stringify(args) !== JSON.stringify(['info', name, '--registry=' + registry, '--json']))
    stop('unrecognized registry info arguments')
  log.push({ type: 'info', name, registry, args })
  fs.writeFileSync(logPath, JSON.stringify(log))
  const versions = state.packages[name].versions
  console.log(JSON.stringify(versions.length ? { versions }
    : { error: { code: 'E404' } }))
  fs.rmdirSync(lock)
  process.exit(versions.length ? 0 : 1)
}
if (tool === 'pnpm' && args[0] === 'publish') {
  const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json')))
  const tag = args[args.indexOf('--tag') + 1]
  const access = args[args.indexOf('--access') + 1]
  if (JSON.stringify(args) !== JSON.stringify([
    'publish', '--json', '--access', access, '--tag', tag, '--no-git-checks',
  ]) || !state.packages[manifest.name] || tag.startsWith('-') || access.startsWith('-'))
    stop('unrecognized publish command')
  const success = state.failed || state.failureName !== manifest.name
  log.push({ type: 'publish', name: manifest.name, version: manifest.version,
    tag, access, registry, success, args })
  if (success) {
    state.packages[manifest.name].versions.push(manifest.version)
    state.packages[manifest.name].tags[tag] = manifest.version
  } else state.failed = true
  fs.writeFileSync(statePath, JSON.stringify(state))
  fs.writeFileSync(logPath, JSON.stringify(log))
  console.log(JSON.stringify(success ? { id: manifest.name + '@' + manifest.version }
    : { error: { code: 'EORACLE', summary: 'injected publish failure' } }))
  fs.rmdirSync(lock)
  process.exit(success ? 0 : 1)
}
stop('unrecognized command ' + tool + ' ' + args.join(' '))
`
  for (const name of ['npm', 'pnpm'])
    writeFileSync(join(bin, name), shim, { mode: 0o755 })
  for (const args of [
    ['init', '--quiet', `--template=${emptyHooks}`],
    ['config', 'core.hooksPath', emptyHooks],
    ['config', 'commit.gpgSign', 'false'],
    ['config', 'tag.gpgSign', 'false'],
    ['config', 'user.email', 'oracle@example.invalid'],
    ['config', 'user.name', 'Release oracle'],
    ['add', '.'],
    ['commit', '--quiet', '-m', 'release fixture'],
  ])
    execFileSync('git', args, {
      cwd: root,
      stdio: 'pipe',
      timeout: 10_000,
      env: commandEnvironment(),
    })
  return {
    manifests,
    initialRegistry: structuredClone(registry),
    readRequests: () => readJson(logPath),
    readRegistry: () => readJson(registryPath),
    invokeCommand: (tool, args, key = 'db') =>
      spawnSync(join(bin, tool), args, {
        cwd: key === 'root' ? root : join(root, 'packages', key),
        encoding: 'utf8',
        timeout: 5_000,
        env: commandEnvironment(),
      }),
    // Only manifest/pre-state bytes belong to the publish restoration promise;
    // registry and Git logs deliberately change when a publish succeeds.
    bytes: () =>
      Object.fromEntries(
        [
          '.changeset/pre.json',
          ...Object.keys(packageNames).map(
            (key) => `packages/${key}/package.json`,
          ),
        ].map((file) => [file, readFileSync(join(root, file), 'base64')]),
      ),
    async run(publish) {
      // Drop credential/scope overrides from child commands. HOME retains its
      // normal value; npm and Git config files are explicitly isolated instead.
      const before = { ...process.env }
      const childEnvironment = commandEnvironment()
      for (const name of Object.keys(process.env)) delete process.env[name]
      Object.assign(process.env, childEnvironment)
      try {
        return await publish(root)
      } finally {
        for (const name of Object.keys(process.env)) delete process.env[name]
        Object.assign(process.env, before)
      }
    },
  }
}
