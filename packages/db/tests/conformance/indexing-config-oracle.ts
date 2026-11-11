/**
 * Hook configuration applies indexing settings to the output live-query
 * Collection. It changes no source Collection settings. This is the explicit
 * output-indexing API decision for #2292 (2026-10-30), using CollectionConfig's
 * existing off default and eager-constructor requirement.
 *
 * The bounded grammar exhausts omitted/off/eager modes with omitted/Basic/BTree
 * constructors. A constructor alone permits manual indexing; eager creates an
 * index when a downstream query filters the output. These dimensions reject
 * dropped options and accidental eager defaults. Eager without a constructor
 * is the adjacent invalid admission, rather than a silently skipped cell.
 *
 * Each real framework driver supplies its hook, constructors, and settled
 * flush cut. This owner judges configuration and index creation there; it does
 * not judge ordering, rendering before flush, or changes to mounted options.
 */
import { expect } from 'vitest'
import { expectUnorderedRows } from './result-laws'
import { ScenarioLifetime } from './scenario-lifetime'
import type { Collection, CollectionConfig } from '@tanstack/db'
import type { LiveQueryDriver, LiveQueryHandle, Row } from './contract'

export type IndexSettings = Pick<
  CollectionConfig<Row>,
  `autoIndex` | `defaultIndexType`
>

export function indexConfigurations(
  driver: Pick<LiveQueryDriver, `indexTypes`>,
) {
  return ([undefined, `off`, `eager`] as const).flatMap((autoIndex) =>
    [undefined, driver.indexTypes.basic, driver.indexTypes.btree].map(
      (defaultIndexType) => ({ autoIndex, defaultIndexType }),
    ),
  )
}

export function indexConfigurationLabel(
  settings: IndexSettings,
  driver: Pick<LiveQueryDriver, `indexTypes`>,
): string {
  // Names are build artifacts. The grammar assigns roles by exact reference.
  const constructor = !settings.defaultIndexType
    ? `none`
    : settings.defaultIndexType === driver.indexTypes.basic
      ? `basic`
      : `btree`
  return `${settings.autoIndex ?? `default`}/${constructor}`
}

// Indexing is opt-in. Supplying only a constructor changes how explicit
// indexes are built, but it does not authorize automatic index creation.
export function expectedIndexing(settings: IndexSettings) {
  return {
    mode: settings.autoIndex ?? `off`,
    constructor: settings.defaultIndexType,
    automaticIndexes: settings.autoIndex === `eager` ? 1 : 0,
    rejects: settings.autoIndex === `eager` && !settings.defaultIndexType,
  }
}

/** Initial-binding grammar: the second binding may meet a retained first
 * binding under derived identity, the same explicit key, or a different key.
 * Invalid eager declarations stay in the grammar even beside a valid cache.
 */
export function indexConfigurationPairs(
  configurations: ReadonlyArray<IndexSettings>,
) {
  return configurations.flatMap((first) =>
    configurations.flatMap((second) =>
      ([`derived`, `same-key`, `different-key`] as const).map((identity) => ({
        first,
        second,
        identity,
      })),
    ),
  )
}

// Presence is a separate grammar dimension from effective settings. For each
// field, compare omission with explicit undefined in both caller orders.
export function indexOptionAbsencePairs() {
  return ([`autoIndex`, `defaultIndexType`] as const).flatMap((option) =>
    indexConfigurationPairs([{}, { [option]: undefined }]).filter(
      ({ first, second }) => first !== second,
    ),
  )
}

export function expectIndexingAdmission(
  admission: { rejected: boolean; error?: unknown },
  settings: IndexSettings,
): void {
  const expected = expectedIndexing(settings)
  expect(admission.rejected).toBe(expected.rejects)
  if (expected.rejects) {
    expect(admission.error).toHaveProperty(
      `message`,
      expect.stringContaining(`requires defaultIndexType`),
    )
  }
}

// Config is observable before a downstream reader asks for an index. Checking
// both bindings at that cut also rejects changing a retained peer's config.
export function expectIndexingConfiguration(
  collection: { config: IndexSettings },
  settings: IndexSettings,
): void {
  const expected = expectedIndexing(settings)
  expect(collection.config.autoIndex).toBe(expected.mode)
  expect(collection.config.defaultIndexType).toBe(expected.constructor)
}

// Independent Suspense bindings own distinct outputs (maintainer decision,
// 2026-11-03). Effective indexing equality never authorizes mutable sharing.
export function expectIndependentIndexingOutputs(
  firstOutput: object | undefined,
  secondOutput: object | undefined,
  first: IndexSettings,
  second: IndexSettings,
): void {
  if (!expectedIndexing(first).rejects && !expectedIndexing(second).rejects)
    expect(secondOutput).not.toBe(firstOutput)
}

function expectIndexing(
  collection: Collection<Row>,
  settings: IndexSettings,
): void {
  const expected = expectedIndexing(settings)
  expectIndexingConfiguration(collection, settings)
  expect(collection.indexes.size).toBe(expected.automaticIndexes)
  for (const index of collection.indexes.values()) {
    expect(index).toBeInstanceOf(expected.constructor!)
  }
}

// Owns no production entry in packages/db: this module checks the public
// observations that each framework driver passes it, so the framework packages
// that run it own the entries it judges.

export function registerIndexingConfigScenarios(
  driver: LiveQueryDriver,
  scenario: (key: string, name: string, run: () => Promise<void>) => void,
): void {
  for (const settings of indexConfigurations(driver)) {
    const label = indexConfigurationLabel(settings, driver)
    scenario(
      `output-indexing-${label}`,
      `hook config applies output indexing ${label}`,
      async () => {
        const expected = expectedIndexing(settings)
        // Each finite configuration has one required admission checkpoint.
        const requiredState = expected.rejects ? `rejected` : `output-read`
        const observedStates = new Set<string>()
        const rows: Array<Row> = [
          { id: `1`, name: `Alice`, age: 30, team: `a` },
          { id: `2`, name: `Bob`, age: 25, team: `b` },
        ]
        const source = driver.makeSource(rows)
        const sourceConfig = {
          mode: source.collection.config.autoIndex,
          constructor: source.collection.config.defaultIndexType,
        }
        let handle: LiveQueryHandle | undefined
        let child: LiveQueryHandle | undefined
        let output: Collection<Row> | null = null
        const resources = new ScenarioLifetime()
        resources.defer(() => child?.unmount())
        resources.defer(() => handle?.unmount())
        resources.defer(() => output?.cleanup({ dependents: true }))
        const mount = () => {
          handle = driver.mountConfig(
            (q) => q.from({ row: source.collection }),
            settings,
          )
          output = handle.collection()
          return handle
        }
        await resources.run(async () => {
          if (expected.rejects) {
            const admission: { rejected: boolean; error?: unknown } = {
              rejected: false,
            }
            try {
              handle = mount()
              await handle.flush()
              handle.current()
            } catch (caught) {
              admission.rejected = true
              admission.error = caught
            }
            expectIndexingAdmission(admission, settings)
            observedStates.add(`rejected`)
          } else {
            handle = mount()
            await handle.flush()
            output = handle.collection()
            expect(output).not.toBeNull()
            observedStates.add(`output-read`)
            child = driver.mount((q) =>
              q
                .from({ row: output! })
                .where(({ row }: { row: Row }) => driver.ops.eq(row.age, 25)),
            )
            await child.flush()
            expectUnorderedRows(
              child.current().data,
              rows.filter((row) => row.age === 25),
            )
            expectIndexing(output!, settings)
            if (!expected.automaticIndexes && expected.constructor) {
              expect(output!.createIndex((row) => row.age)).toBeInstanceOf(
                expected.constructor,
              )
            }
          }
          expect(source.collection.config.autoIndex).toBe(sourceConfig.mode)
          expect(source.collection.config.defaultIndexType).toBe(
            sourceConfig.constructor,
          )
          expect(source.collection.indexes.size).toBe(0)
          expect(
            [...observedStates],
            `${driver.name}/${label} admission checkpoint`,
          ).toEqual([requiredState])
        })
      },
    )
  }
}
