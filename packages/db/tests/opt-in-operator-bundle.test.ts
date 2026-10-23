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
 * The check runs every operator value alone, so each one is a positive control
 * for its own modules: without them, a module renamed or moved would make the
 * absence checks pass vacuously. It also runs every combination of operator
 * families, each family named by one of its values in turn, so a module that
 * only a combination reaches is checked too. The modules shared by joins and
 * includes must arrive exactly when an app imports one of the two.
 */
const index = fileURLToPath(new URL(`../src/index.ts`, import.meta.url))

const modules = {
  joins: [
    `src/query/compiler/joins.ts`,
    `src/query/compiler/join-runtime.ts`,
    `src/query/optimizer-joins.ts`,
  ],
  grouping: [
    `src/query/compiler/grouping.ts`,
    `src/query/compiler/group-by.ts`,
  ],
  includes: [
    `src/query/live/bucket-facade-adapter.ts`,
    `src/query/live/includes-runtime.ts`,
    `src/query/live/materialized-pipeline.ts`,
  ],
  pooling: [`src/query/pooled-live-query.ts`],
} as const
type Family = keyof typeof modules

/** The values that bring each family's code in. */
const values: Record<Family, ReadonlyArray<string>> = {
  joins: [`leftJoin`, `innerJoin`, `rightJoin`, `fullJoin`, `joinOf`],
  grouping: [`count`, `sum`, `avg`, `min`, `max`, `groupKeys`],
  includes: [`include`, `toArray`, `materialize`],
  pooling: [`pooledLiveQueries`],
}

// Joins and includes share public-key reduction; an app with neither keeps it
// out.
const shared = [`src/query/live/public-key-reduction.ts`]
const families = Object.keys(modules) as Array<Family>

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

// `concat` and `caseWhen` build select values but bring no operator code.
const typicalApp = [
  `createLiveQueryCollection`,
  `eq`,
  `and`,
  `concat`,
  `caseWhen`,
  `createCollection`,
]

/** The law: an operator's modules are in the bundle exactly when it is imported. */
function expectOperators(
  bytes: ReadonlyMap<string, number>,
  imported: ReadonlySet<Family>,
) {
  for (const family of families)
    for (const file of modules[family])
      expect(bytes.has(file), `${family}: ${file}`).toBe(imported.has(family))
  for (const file of shared)
    expect(bytes.has(file), file).toBe(
      imported.has(`joins`) || imported.has(`includes`),
    )
}

describe(`opt-in operator bundles`, () => {
  it.each(
    Object.entries(values).flatMap(([family, names]) =>
      names.map((name) => [name, family as Family] as const),
    ),
  )(`brings in only what %s needs (%s)`, async (name, family) => {
    expectOperators(
      await bundledModules([...typicalApp, name]),
      new Set([family]),
    )
  })

  // Every subset of families, the empty one included. Subset i names each
  // family by its value at position i, so the combinations rotate values.
  const subsets = Array.from({ length: 2 ** families.length }, (_, i) =>
    families.filter((_family, bit) => i & (1 << bit)),
  )
  it.each(
    subsets.map(
      (subset, i) => [subset.join(` + `) || `none`, subset, i] as const,
    ),
  )(`keeps the law for %s`, async (_label, subset, i) => {
    const names = subset.map(
      (family) => values[family][i % values[family].length]!,
    )
    expectOperators(
      await bundledModules([...typicalApp, ...names]),
      new Set(subset),
    )
  })
})
