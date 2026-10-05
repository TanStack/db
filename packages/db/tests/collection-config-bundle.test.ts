// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build, transformSync } from 'esbuild'
import { describe, expect, it, vi } from 'vitest'

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

  it(`warns only for likely misspellings in a development browser`, async () => {
    const { code } = await bundle(`development`)
    const warn = vi.fn()
    expect(
      runInNewContext(
        `${code}\nDb.createCollection({ id: 'browser', getKey: (row) => row.id, sync: { sync: () => {} }, oninsert: () => {}, parse: {}, serialize: {}, rowUpdateMode: 'full' }).id`,
        { console: { warn } },
      ),
    ).toBe(`browser`)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]![0]).toContain(`"onInsert"`)
    expect(warn.mock.calls[0]![0]).not.toContain(`parse`)
  })

  it.each([`development`, `production`])(
    `accepts the adapter guide factories in %s`,
    async (environment) => {
      const guide = readFileSync(
        new URL(
          `../../../docs/guides/collection-options-creator.md`,
          import.meta.url,
        ),
        `utf8`,
      )
      const blocks = [...guide.matchAll(/```typescript\n([\s\S]*?)```/g)].map(
        (match) => match[1]!,
      )
      const factories = blocks.filter(
        (block) =>
          block.includes(
            `export function trailbaseCollectionOptions(config)`,
          ) ||
          (block.includes(
            `export function myCollectionOptions<TItem extends object>`,
          ) &&
            block.includes(`rowUpdateMode: config.rowUpdateMode`)),
      )
      expect(factories).toHaveLength(3)
      const { code } = await bundle(environment)
      const warn = vi.fn()
      for (const source of factories) {
        // The guide shows partial factories. Supply the required key/sync
        // functions, while preserving every returned option from the guide.
        const factory = transformSync(
          source.split(`// User explicitly configures conversions`)[0]!,
          { loader: `ts`, format: `iife`, globalName: `Guide` },
        ).code
        const result = (await runInNewContext(
          `${code}
          const syncFn = ({ begin, write, commit, markReady }) => {
            begin(); write({ type: 'insert', value: { id: 1 } }); commit(); markReady()
          }
          ${factory}
          (async () => {
            const config = { parse: {}, serialize: {}, rowUpdateMode: 'full' }
            const options = Object.values(Guide)[0](config)
            const collection = Db.createCollection({
              id: 'guide', getKey: (row) => row.id, sync: { sync: syncFn }, ...options
            })
            await collection.preload()
            const result = { options, status: collection.status, row: collection.get(1) }
            await collection.cleanup()
            return result
          })()`,
          { console: { warn }, setTimeout, clearTimeout },
        )) as {
          options: Record<string, unknown>
          status: string
          row: { id: number }
        }
        expect(result.status).toBe(`ready`)
        expect(result.row.id).toBe(1)
        expect(result.options).not.toHaveProperty(`parse`)
        expect(result.options).not.toHaveProperty(`serialize`)
        expect(result.options).not.toHaveProperty(`rowUpdateMode`)
        if (source.includes(`rowUpdateMode`)) {
          expect(result.options).toHaveProperty(`sync.rowUpdateMode`, `full`)
        }
      }
      expect(warn).not.toHaveBeenCalled()
    },
  )

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
      expect(code.includes(`Did you mean`)).toBe(false)
      const warn = vi.fn()
      expect(
        runInNewContext(
          `${code}\nDb.createCollection({ id: 'production', getKey: (row) => row.id, sync: { sync: () => {} }, oninsert: () => {}, parse: {} }).id`,
          { console: { warn } },
        ),
      ).toBe(`production`)
      expect(warn).not.toHaveBeenCalled()
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
