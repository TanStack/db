// @vitest-environment node
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

// Bundle the whole public API so exported errors cannot disappear merely
// because a fixture imports fewer exports than a real application might.
// These checks cover the build boundary, not Collection lifecycle histories.
async function bundle(environment: string | undefined, minify = false) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(`../src/index.ts`, import.meta.url))],
    bundle: true,
    write: false,
    platform: `browser`,
    format: `iife`,
    globalName: `Db`,
    define:
      environment === undefined
        ? { process: `process` }
        : { 'process.env.NODE_ENV': JSON.stringify(environment) },
    minify,
    metafile: true,
    logLevel: `silent`,
  })
  return {
    code: result.outputFiles![0]!.text,
    includedModules: Object.values(result.metafile!.outputs).flatMap((output) =>
      Object.entries(output.inputs)
        .filter(([, input]) => input.bytesInOutput > 0)
        .map(([name]) => name),
    ),
  }
}

describe(`Collection configuration in browser bundles`, () => {
  it(`validates development configuration without a process global`, async () => {
    const { code } = await bundle(`development`)
    expect(() =>
      runInNewContext(
        `${code}\nDb.createCollection({ id: 'browser', sync: { sync: () => {} } })`,
      ),
    ).toThrow(`Collection requires a "getKey" function`)
  })

  it(`preserves unbundled browser support without an environment replacement`, async () => {
    const { code } = await bundle(undefined)
    expect(
      runInNewContext(
        `${code}\nDb.createCollection({ id: 'browser', getKey: (row) => row.id, sync: { sync: () => {} } }).id`,
      ),
    ).toBe(`browser`)
  })

  it.each([false, true])(
    `ships no configuration validator or diagnostic classes in production (minify: %s)`,
    async (minify) => {
      const { code, includedModules } = await bundle(`production`, minify)
      for (const file of [`validate-config.ts`, `config-errors.ts`]) {
        expect(includedModules.some((name) => name.endsWith(file))).toBe(false)
      }
      expect(code.includes(`CollectionRequiresGetKeyError`)).toBe(false)
      expect(code.includes(`UnknownCollectionConfigError`)).toBe(false)
      expect(code.includes(`Did you mean?`)).toBe(false)
      expect(code.includes(`Valid config properties:`)).toBe(false)
      if (minify) {
        const createSource = runInNewContext(
          `${code}\nDb.createCollection.toString()`,
        ) as string
        expect(createSource.includes(`try`)).toBe(false)
        expect(createSource.includes(`process`)).toBe(false)
      }
      expect(
        runInNewContext(
          `${code}\nDb.createCollection({ id: 'browser', sync: { sync: () => {} } }).id`,
        ),
      ).toBe(`browser`)
    },
  )
})
