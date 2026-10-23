// @vitest-environment node
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

/**
 * # Does an app pay only for the operators it imports?
 *
 * Joins, grouping, includes, and pooling are opt-in. Each one's code arrives
 * with the value that names it: a join operator (`leftJoin`), an aggregate
 * (`count`) or `groupKeys`, an include function (`include`, `toArray`,
 * `materialize`), and `pooledLiveQueries`. The law: an app's production
 * bundle contains an operator's modules exactly when the app imports one of
 * those values. A static import from shared code would break it silently, so
 * this bundles small apps from source as an app's build would and reads which
 * modules reach the output.
 *
 * Each operator has a positive control: importing its value must bring its
 * modules in. Without the controls, a module renamed or moved would make the
 * absence checks pass vacuously.
 */
const index = fileURLToPath(new URL(`../src/index.ts`, import.meta.url))

const modules = {
  joins: [
    `src/query/compiler/joins.ts`,
    `src/query/compiler/join-runtime.ts`,
    `src/query/optimizer-joins.ts`,
  ],
  grouping: [`src/query/compiler/grouping.ts`],
  includes: [
    `src/query/live/bucket-facade-adapter.ts`,
    `src/query/live/includes-runtime.ts`,
    `src/query/live/materialized-pipeline.ts`,
  ],
  pooling: [`src/query/pooled-live-query.ts`],
} as const

// Joins and includes share public-key reduction; an app with neither keeps it
// out.
const shared = [`src/query/live/public-key-reduction.ts`]

/** Bundles an app that exports `names` and returns its modules' output bytes. */
async function bundledModules(names: Array<string>) {
  const result = await build({
    stdin: {
      contents: `export { ${names.join(`, `)} } from ${JSON.stringify(index)}`,
      resolveDir: fileURLToPath(new URL(`.`, import.meta.url)),
      loader: `ts`,
    },
    bundle: true,
    minify: true,
    write: false,
    metafile: true,
    format: `esm`,
    platform: `browser`,
    packages: `external`,
    tsconfigRaw: `{}`,
    logLevel: `error`,
    define: { 'process.env.NODE_ENV': `"production"` },
  })
  const output = Object.values(result.metafile.outputs)[0]!
  const bytes = new Map<string, number>()
  for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
    if (bytesInOutput > 0)
      bytes.set(input.replace(/^.*?(?=src\/)/, ``), bytesInOutput)
  }
  return bytes
}

const typicalApp = [
  `createLiveQueryCollection`,
  `eq`,
  `and`,
  `createCollection`,
]

describe(`opt-in operator bundles`, () => {
  it(`keeps every operator out of an app that imports none`, async () => {
    const bytes = await bundledModules(typicalApp)
    for (const files of Object.values(modules)) {
      for (const file of files) expect(bytes.has(file), file).toBe(false)
    }
    for (const file of shared) expect(bytes.has(file), file).toBe(false)
    // Aggregate detection stays in core; the grouping compiler does not.
    expect(bytes.get(`src/query/compiler/group-by.ts`) ?? 0).toBeLessThan(1000)
  })

  it.each([
    [`joins`, [`leftJoin`]],
    [`grouping`, [`count`]],
    [`grouping`, [`groupKeys`]],
    [`includes`, [`include`]],
    [`includes`, [`toArray`]],
    [`pooling`, [`pooledLiveQueries`]],
  ] as const)(`brings in %s with %s`, async (operator, names) => {
    const bytes = await bundledModules([...typicalApp, ...names])
    for (const file of modules[operator])
      expect(bytes.has(file), file).toBe(true)
    for (const [other, files] of Object.entries(modules)) {
      if (other === operator) continue
      for (const file of files) expect(bytes.has(file), file).toBe(false)
    }
  })
})
