// Process-isolated, paired measurements of persisted eager startup. The prior
// selection uses immutable adapter sources, so it stays valid after a repair.
// Example: node scripts/bench/persisted-startup.mjs --rows=1000,10000 --repetitions=5 --out=.review-2367/startup-perf/results.json
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')),
)
const rows = (args.rows ?? '1000,10000,100000').split(',').map(Number)
const repetitions = Number(args.repetitions ?? 5)
const warmup = Number(args.warmup ?? 1)
const adapters = (args.adapters ?? 'rxdb,powersync').split(',')
const savedStates = (args.saved ?? 'false,true')
  .split(',')
  .map((value) => value === 'true')
const schedules = (args.schedules ?? 'natural,source-first,fallback').split(',')
const out = path.resolve(
  root,
  args.out ?? '.review-2367/startup-perf/results.json',
)
const directory = path.dirname(out)
await mkdir(directory, { recursive: true })
const variants = ['prior-selection', 'current']
const baselineRef =
  args.baselineRef ?? '0e86c1fdae85520aff142f141f71ccf46a8ee8bd'
const sourceControls = [
  {
    file: 'packages/rxdb-db-collection/src/rxdb.ts',
    sha256: '2dca19cff8bb602b2aa59f46c7635035e49d0f1cda0a2222e1917f6d2eb8aa62',
  },
  {
    file: 'packages/powersync-db-collection/src/powersync.ts',
    sha256: 'd945eb99bff416fc9c7ba041a802fa842072e5cf03a71d02dd2ed214610df408',
  },
]
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const sourceInputs = new Map()
for (const control of sourceControls) {
  const original = spawnSync(
    'git',
    ['show', `${baselineRef}:${control.file}`],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
  if (original.status !== 0) throw new Error(original.stderr)
  if (sha256(original.stdout) !== control.sha256)
    throw new Error(`Immutable baseline source guard failed: ${control.file}`)
  const prior = original.stdout.replace(
    /persistence !== null \|\|\s*!collection\._state\.acceptedSyncedEntries\(\)\.next\(\)\.done/,
    '!collection._state.acceptedSyncedEntries().next().done',
  )
  if (prior === original.stdout)
    throw new Error(`Snapshot source control did not match ${control.file}`)
  sourceInputs.set(path.join(root, control.file), {
    file: control.file,
    baselineSourceSha256: control.sha256,
    'prior-selection': prior,
    current: await readFile(path.join(root, control.file), 'utf8'),
  })
}
const bundleHashes = {}
const workspace = {
  '@tanstack/db': path.join(root, 'packages/db/src/index.ts'),
  '@tanstack/db-ivm': path.join(root, 'packages/db-ivm/src/index.ts'),
}
for (const variant of variants) {
  let changed = 0
  await build({
    entryPoints: [path.join(root, 'scripts/bench/persisted-startup-worker.ts')],
    outfile: path.join(directory, `${variant}.mjs`),
    bundle: true,
    minify: true,
    sourcemap: 'inline',
    format: 'esm',
    platform: 'node',
    tsconfigRaw: '{}',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [
      {
        name: 'startup-source-control',
        setup(bundle) {
          bundle.onResolve({ filter: /^[^./]/ }, async (request) => {
            if (request.pluginData?.resolved) return
            if (workspace[request.path])
              return { path: workspace[request.path] }
            if (request.path.startsWith('node:'))
              return { path: request.path, external: true }
            const resolveDir = request.path.startsWith('@powersync/')
              ? path.join(root, 'packages/powersync-db-collection')
              : request.path.startsWith('rxdb/')
                ? path.join(root, 'packages/rxdb-db-collection')
                : request.resolveDir
            const resolved = await bundle.resolve(request.path, {
              resolveDir,
              kind: request.kind,
              pluginData: { resolved: true },
            })
            if (resolved.errors.length) return { errors: resolved.errors }
            return { path: resolved.path, external: true }
          })
          bundle.onLoad(
            {
              filter:
                /packages\/(rxdb|powersync)-db-collection\/src\/(rxdb|powersync)\.ts$/,
            },
            async ({ path: source }) => {
              const input = sourceInputs.get(source)
              if (!input)
                throw new Error(`Uncontrolled adapter source ${source}`)
              changed++
              return { contents: input[variant], loader: 'ts' }
            },
          )
        },
      },
    ],
  })
  if (changed !== 2)
    throw new Error(
      `Expected two controlled snapshot selections, got ${changed}`,
    )
  bundleHashes[variant] = sha256(
    await readFile(path.join(directory, `${variant}.mjs`)),
  )
}
const sourceHead = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).stdout.trim()
const report = {
  sourceHead,
  baseline:
    'Pinned adapter source with only the persisted-capability OR operand removed from RxDB/PowerSync eager snapshot selection, matching prior ordinary startup selection. Both variants share current core/dependencies. Not a full origin/main checkout; omitted-row correctness is judged separately by the oracle.',
  baselineRef,
  sourceInputs: [...sourceInputs.values()].map((input) => ({
    file: input.file,
    baselineSourceSha256: input.baselineSourceSha256,
    priorSelectionSha256: sha256(input['prior-selection']),
    currentSha256: sha256(input.current),
  })),
  bundleHashes,
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus()[0]?.model,
    logicalCPUs: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
  },
  configuration: {
    rows,
    repetitions,
    warmup,
    adapters,
    savedStates,
    schedules,
    payloadBytes: Number(args.payloadBytes ?? 256),
    batch: Number(args.batch ?? 1000),
  },
  observations: [],
}
await writeFile(out, `${JSON.stringify(report, null, 2)}\n`)
let pair = 0
for (const adapter of adapters)
  for (const count of rows)
    for (const saved of savedStates)
      for (const schedule of schedules) {
        if (schedule === 'fallback' && !saved) continue
        const config = {
          adapter,
          rows: count,
          saved,
          batch: report.configuration.batch,
          payloadBytes: report.configuration.payloadBytes,
          render: schedule === 'fallback' ? 'network-first' : 'default',
          restoreDelayMs: schedule === 'source-first' ? 300 : 0,
          sourceDelayMs: schedule === 'fallback' ? 350 : 0,
        }
        for (let repetition = -warmup; repetition < repetitions; repetition++) {
          const order = pair++ % 2 ? [...variants].reverse() : variants
          for (const variant of order) {
            const child = spawnSync(
              process.execPath,
              [
                '--expose-gc',
                '--enable-source-maps',
                path.join(directory, `${variant}.mjs`),
                JSON.stringify(config),
              ],
              {
                cwd: root,
                encoding: 'utf8',
                timeout: 180000,
                maxBuffer: 8 * 1024 * 1024,
              },
            )
            if (child.status !== 0)
              throw new Error(
                `${variant} ${JSON.stringify(config)} failed:\n${child.stdout.slice(-2000)}\n${child.stderr
                  .split('\n')
                  .slice(-15)
                  .map((line) => line.slice(0, 600))
                  .join('\n')}`,
              )
            const line = child.stdout
              .split('\n')
              .find((item) => item.startsWith('STARTUP_RESULT '))
            if (!line)
              throw new Error(
                `No result: ${child.stdout.slice(-2000)}\n${child.stderr
                  .split('\n')
                  .slice(-15)
                  .map((line) => line.slice(0, 600))
                  .join('\n')}`,
              )
            const result = {
              variant,
              schedule,
              repetition,
              warmup: repetition < 0,
              ...JSON.parse(line.slice('STARTUP_RESULT '.length)),
            }
            report.observations.push(result)
            await writeFile(out, `${JSON.stringify(report, null, 2)}\n`)
            console.log(JSON.stringify(result))
          }
        }
      }
console.log(`Saved ${report.observations.length} observations to ${out}`)
