/** Real npm/pnpm HTTP receiver support; no expected release computation. */
import assert from 'node:assert/strict'
import { execFileSync, fork, spawn } from 'node:child_process'
import {
  accessSync,
  constants,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packageNames } from './release-history-oracle.js'
import { manifestPath, readJson, writeJson } from './release-fixture.js'

const require = createRequire(import.meta.url)
const changeset = require.resolve('@changesets/cli/bin.js')
const registryScript = fileURLToPath(
  new URL('./release-http-registry.js', import.meta.url),
)
const publishScript = fileURLToPath(
  new URL('./release-http-publish.mjs', import.meta.url),
)

function killGroup(child) {
  if (child.pid === undefined) return
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Child did not exit after termination')),
      5000,
    )
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function failAfterTermination(child, primary) {
  const secondary = []
  try {
    killGroup(child)
  } catch (error) {
    secondary.push(error)
  }
  try {
    await waitForExit(child)
  } catch (error) {
    secondary.push(error)
  }
  if (secondary.length > 0)
    throw new AggregateError(
      [primary, ...secondary],
      'HTTP registry failure and termination failures',
      { cause: primary },
    )
  throw primary
}

/** Own the process group, including pnpm/Changesets/npm descendants. */
export function runReleaseToolTree(executablePath, args, options) {
  return new Promise((resolve) => {
    const { timeout = 30_000, ...spawnOptions } = options
    const child = spawn(executablePath, args, {
      ...spawnOptions,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    const outputLimit = 16 * 1024 * 1024
    let outputBytes = 0
    let error
    const cleanupErrors = []
    let terminationRequested = false
    const terminate = () => {
      if (terminationRequested) return
      terminationRequested = true
      try {
        killGroup(child)
      } catch (cleanup) {
        cleanupErrors.push(cleanup)
        try {
          child.kill('SIGKILL')
        } catch (fallback) {
          cleanupErrors.push(fallback)
        }
      }
    }
    const timer = setTimeout(() => {
      error ??= new Error('Real release command timed out')
      terminate()
    }, timeout)
    child.once('error', (cause) => {
      error ??= cause
      terminate()
    })
    child.once('exit', () => {
      terminate()
    })
    for (const [stream, chunks] of [
      [child.stdout, stdout],
      [child.stderr, stderr],
    ])
      stream.on('data', (data) => {
        const remaining = outputLimit - outputBytes
        if (remaining > 0) {
          const accepted = data.subarray(0, remaining)
          chunks.push(accepted)
          outputBytes += accepted.length
        }
        if (data.length > remaining) {
          error ??= new Error('Real release output exceeds fixture bound')
          terminate()
        }
      })
    child.once('close', (status, signal) => {
      clearTimeout(timer)
      if (cleanupErrors.length > 0)
        error = new AggregateError(
          error === undefined ? cleanupErrors : [error, ...cleanupErrors],
          'Real release command and process termination failures',
          { cause: error ?? cleanupErrors[0] },
        )
      resolve({
        status,
        signal,
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
        error,
      })
    })
  })
}

function executable(name) {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const path = join(directory, name)
    try {
      accessSync(path, constants.X_OK)
      return realpathSync(path)
    } catch {}
  }
  throw new Error(`HTTP release setup requires an installed ${name} executable`)
}

async function startRegistry(statePath) {
  const child = fork(registryScript, [statePath], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
      ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
    },
  })
  let output = ''
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      output = (output + chunk).slice(-8192)
    })
  try {
    const origin = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`HTTP registry setup timed out: ${output}`)),
        5000,
      )
      const finish = (error, value) => {
        clearTimeout(timer)
        error ? reject(error) : resolve(value)
      }
      child.once('error', (error) => finish(error))
      child.once('exit', (code, signal) =>
        finish(
          new Error(
            `HTTP registry exited during setup: ${code}/${signal}: ${output}`,
          ),
        ),
      )
      child.once('message', (message) =>
        message.origin
          ? finish(undefined, message.origin)
          : finish(
              new Error(
                `HTTP registry setup failed: ${message.code}: ${message.setupError}`,
              ),
            ),
      )
    })
    return { child, origin, output: () => output }
  } catch (error) {
    return failAfterTermination(child, error)
  }
}

async function stopRegistry({ child, output }) {
  if (child.exitCode !== null || child.signalCode !== null)
    throw new Error(
      `HTTP registry exited unexpectedly: ${child.exitCode}/${child.signalCode}: ${output()}`,
    )
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('HTTP registry cleanup timed out'))
      }, 5000)
      child.once('exit', (code, signal) => {
        clearTimeout(timer)
        code === 0
          ? resolve()
          : reject(
              new Error(
                `HTTP registry cleanup failed: ${code}/${signal}: ${output()}`,
              ),
            )
      })
      child.send('close')
    })
  } catch (error) {
    return failAfterTermination(child, error)
  }
}

/** The server is a child because publishDuringRc synchronously blocks Node. */
export async function withHttpPublishReceiver(root, history, body) {
  if (process.platform === 'win32')
    throw new Error(
      'HTTP release receiver requires POSIX process-group cleanup',
    )
  writeFileSync(
    join(root, 'pnpm-workspace.yaml'),
    readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8') +
      '\nverifyDepsBeforeRun: false\n',
  )
  const bin = join(root, 'real-bin')
  mkdirSync(bin)
  const toolPaths = {
    node: process.execPath,
    npm: executable('npm'),
    pnpm: executable('pnpm'),
    git: executable('git'),
  }
  for (const [name, resolvedPath] of Object.entries(toolPaths)) {
    // A pnpm shell launcher can find its CLI relative to $0. Invoke it at its
    // installed path instead of relocating that pathname through a symlink.
    if (name === 'pnpm') {
      const quotedPath = `'${resolvedPath.replaceAll("'", "'\\''")}'`
      writeFileSync(join(bin, name), `#!/bin/sh\nexec ${quotedPath} "$@"\n`, {
        mode: 0o755,
      })
    } else symlinkSync(realpathSync(resolvedPath), join(bin, name))
  }
  mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true })
  symlinkSync(changeset, join(root, 'node_modules', '.bin', 'changeset'))
  const manifests = Object.keys(packageNames).map((key) => {
    const manifest = readJson(manifestPath(root, key))
    manifest.version =
      key === 'db'
        ? history.candidate
        : key === 'react'
          ? (history.reactCandidate ?? history.candidate)
          : key === 'query'
            ? '1.5.0'
            : '1.2.0'
    writeJson(manifestPath(root, key), manifest)
    writeFileSync(
      join(root, 'packages', key, 'index.js'),
      'export const fixture = true\n',
    )
    return manifest
  })
  // pnpm resolves workspace:* from local links while packing. Supply those
  // fixture links directly; this receiver performs no dependency installation
  // and makes no claim about the repository's installed dependency graph.
  for (const [owner, name, target] of [
    ['db', 'release-private', 'private'],
    ['react', packageNames.db, 'db'],
  ]) {
    const directory = join(root, 'packages', owner, 'node_modules')
    mkdirSync(join(directory, name.startsWith('@') ? name.split('/')[0] : ''), {
      recursive: true,
    })
    symlinkSync(join(root, 'packages', target), join(directory, name))
  }
  const initialRegistry = Object.fromEntries(
    manifests.map(({ name, version }, index) => {
      const key = Object.keys(packageNames)[index]
      const candidate = name === packageNames.db || name === packageNames.react
      const current =
        history.registry === 'current' || history.currentCandidate === key
      const versions =
        history.registry === 'never'
          ? []
          : current
            ? ['older-rc', 'older-rc-latest-current'].includes(
                history.tagShape,
              ) && candidate
              ? ['1.0.0-rc.1', version]
              : [version]
            : candidate
              ? history.registry === 'only-rc'
                ? ['1.0.0-rc.1']
                : ['0.15.2']
              : ['1.0.0']
      const last = versions.at(-1)
      // A dist-tag may point only to an existing version. Missing tags are legal,
      // including after a candidate was accidentally published under latest.
      const tags =
        last === undefined ||
        (candidate && history.tagShape === 'no-tags') ||
        (!candidate && history.stableTagShape === 'no-tags')
          ? {}
          : candidate && history.tagShape === 'latest-only'
            ? { latest: last }
            : candidate &&
                ['older-rc', 'older-rc-latest-current'].includes(
                  history.tagShape,
                )
              ? {
                  rc: versions[0],
                  ...(history.tagShape === 'older-rc-latest-current'
                    ? { latest: last }
                    : {}),
                }
              : candidate && ['only-rc', 'current'].includes(history.registry)
                ? {
                    rc: last,
                    ...(history.tagShape === 'latest-alias'
                      ? { latest: last }
                      : {}),
                  }
                : { latest: last }
      return [name, { versions, tags }]
    }),
  )
  // Reject a nearby invalid packument: every authored tag names a present
  // version. Tag absence and exact-target absence remain independent facts.
  for (const entry of Object.values(initialRegistry))
    for (const version of Object.values(entry.tags))
      assert(
        entry.versions.includes(version),
        'fixture dist-tag names an existing version',
      )
  const statePath = join(root, 'http-registry.json')
  writeJson(statePath, {
    packages: structuredClone(initialRegistry),
    failed: false,
    requests: [],
    candidateNames: [packageNames.db, packageNames.react],
    failureMode:
      history.failure === 'candidate-after-success'
        ? history.failure
        : undefined,
    failureName:
      history.failure === 'stable'
        ? packageNames.query
        : history.failure === 'candidate'
          ? packageNames.db
          : undefined,
  })
  writeJson(join(root, '.changeset', 'pre.json'), {
    mode: 'pre',
    tag: 'rc',
    initialVersions: Object.fromEntries(
      manifests.map(({ name, version }) => [name, version]),
    ),
    changesets: [],
  })
  const registry = await startRegistry(statePath)
  let failed = false
  let primary
  try {
    const userConfig = join(root, 'npm-user-config')
    const globalConfig = join(root, 'npm-global-config')
    const gitConfig = join(root, 'git-global-config')
    const hooks = join(root, 'empty-hooks')
    mkdirSync(hooks)
    writeFileSync(globalConfig, '')
    writeFileSync(gitConfig, '')
    writeFileSync(
      userConfig,
      [
        `registry=${registry.origin}`,
        `@tanstack:registry=${registry.origin}`,
        `//${new URL(registry.origin).host}/:_authToken=release-http-fixture`,
        'ignore-scripts=true',
        'audit=false',
        'fund=false',
        'update-notifier=false',
        'fetch-retries=0',
        'fetch-timeout=5000',
        'provenance=false',
      ].join('\n') + '\n',
    )
    const environment = {
      PATH: `${bin}:/usr/bin:/bin`,
      ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
      ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
      CI: 'true',
      COREPACK_ENABLE_NETWORK: '0',
      npm_config_registry: registry.origin,
      NPM_CONFIG_USERCONFIG: userConfig,
      NPM_CONFIG_GLOBALCONFIG: globalConfig,
      NPM_CONFIG_CACHE: join(root, 'npm-cache'),
      NPM_CONFIG_LOGLEVEL: 'error',
      NPM_CONFIG_LOGS_MAX: '0',
      XDG_CONFIG_HOME: join(root, 'xdg-config'),
      GIT_CONFIG_GLOBAL: gitConfig,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
    }
    for (const args of [
      ['init', '--quiet', `--template=${hooks}`],
      ['config', 'core.hooksPath', hooks],
      ['config', 'commit.gpgSign', 'false'],
      ['config', 'tag.gpgSign', 'false'],
      ['config', 'user.email', 'oracle@example.invalid'],
      ['config', 'user.name', 'Release oracle'],
      ['add', '.'],
      ['commit', '--quiet', '-m', 'HTTP release fixture'],
    ])
      execFileSync(join(bin, 'git'), args, {
        cwd: root,
        env: environment,
        stdio: 'pipe',
        timeout: 10_000,
      })
    const receiver = {
      manifests,
      initialRegistry,
      origin: registry.origin,
      tools: {
        paths: toolPaths,
        ...Object.fromEntries(
          ['npm', 'pnpm'].map((name) => [
            name,
            execFileSync(join(bin, name), ['--version'], {
              cwd: root,
              env: environment,
              encoding: 'utf8',
              timeout: 10_000,
            }).trim(),
          ]),
        ),
      },
      readState: () => readJson(statePath),
      bytes: () =>
        Object.fromEntries(
          [
            '.changeset/pre.json',
            ...Object.keys(packageNames).map(
              (key) => `packages/${key}/package.json`,
            ),
          ].map((file) => [file, readFileSync(join(root, file), 'base64')]),
        ),
      async run() {
        const result = await runReleaseToolTree(
          process.execPath,
          [publishScript, root],
          {
            cwd: root,
            env: environment,
            timeout: 30_000,
          },
        )
        if (result.error)
          throw new Error('Real release command setup or timeout failure', {
            cause: result.error,
          })
        if (result.status !== 0)
          throw new Error(
            `Real release command failed (${result.status}):\n${result.stdout}\n${result.stderr}`,
          )
      },
    }
    return await body(receiver)
  } catch (error) {
    failed = true
    primary = error
    throw error
  } finally {
    try {
      await stopRegistry(registry)
    } catch (cleanup) {
      throw failed
        ? new AggregateError(
            [primary, cleanup],
            'HTTP release comparison and cleanup failures',
            { cause: primary },
          )
        : cleanup
    }
  }
}
