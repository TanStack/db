// Runs a benchmark as an app's production build ships TanStack DB: bundled
// against the built packages/db and packages/db-ivm dist, minified, with
// process.env.NODE_ENV set to `production`. Development-only code, such as
// full error messages and oracle probes, is therefore absent, and db's
// private members carry their mangled names. The arguments after the
// benchmark file pass through to it:
//
//   node scripts/bench/production.mjs scripts/bench/incremental-update.ts \
//     --iterations=100 --warmup=20 --repetitions=3 --outFile=candidate.json
import { realpathSync, rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { assertPackageDistFresh } from '../../packages/db/scripts/assert-dist-fresh.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const [benchmark, ...args] = process.argv.slice(2)
if (!benchmark)
  throw new Error('Usage: node scripts/bench/production.mjs <benchmark> [args]')

const dbEntry = await assertPackageDistFresh(root, 'db')
const ivmEntry = await assertPackageDistFresh(root, 'db-ivm')
const bundleDir = await mkdtemp(
  path.join(realpathSync(tmpdir()), 'tanstack-db-bench-'),
)
process.on('exit', () => rmSync(bundleDir, { recursive: true, force: true }))
const outfile = path.join(bundleDir, 'benchmark.mjs')
const { metafile } = await build({
  entryPoints: [path.resolve(benchmark)],
  outfile,
  bundle: true,
  minify: true,
  sourcemap: 'inline',
  metafile: true,
  format: 'esm',
  platform: 'node',
  // Resolve imports as an app would: the repo's tsconfig paths would
  // otherwise inline the workspace packages from their sources. The
  // benchmark imports db's source entry for its types; the bundle takes the
  // built entry instead.
  tsconfigRaw: '{}',
  alias: { '@tanstack/db-ivm': ivmEntry },
  plugins: [
    {
      name: 'built-db',
      setup(bundle) {
        bundle.onResolve({ filter: /\/packages\/db\/src\/index\.js$/ }, () => ({
          path: dbEntry,
        }))
      },
    },
  ],
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'error',
})

// A source module in the bundle would measure development code, or a second
// copy of a package beside its dist.
const sources = Object.keys(metafile.inputs).filter((input) =>
  /(^|\/)packages\/[^/]+\/src\//.test(input),
)
if (sources.length > 0)
  throw new Error(
    `The benchmark bundle must use built packages, but it includes sources:\n${sources.join('\n')}`,
  )

// The stack trace of a failed benchmark assertion names its source line.
process.setSourceMapsEnabled(true)
process.argv = [process.execPath, outfile, ...args]
await import(pathToFileURL(outfile).href)
