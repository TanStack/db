/**
 * Each initially mounted Suspense binding receives its declared output indexing
 * settings, even when a peer already reads the same source and query. The
 * shared handoff owner's explicit-output law applies to each binding; cache
 * reuse cannot replace one binding's declaration with its peer's declaration.
 * Compatible declarations under the same query identity retain existing
 * Collection sharing. Mounted bindings retain their first options until query identity changes, as
 * required by the approved first-options rule.
 *
 * The shared grammar exhausts both configurations and three identity relations:
 * derived identity, the same explicit queryKey, and different explicit keys.
 * Each declaration is judged at admission and, when valid, after real React
 * Suspense commits its rows. Rechecking the first binding after the second
 * rejects a cache repair that overwrites a retained Collection's settings.
 * Both unscoped and DbProvider-scoped caches receive the same histories. A
 * second lane uses distinct constructor references with the same class name;
 * names cannot replace the declared constructor reference. This driver judges
 * no hydration or server render.
 */
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { Suspense } from 'react'
import {
  BTreeIndex,
  BasicIndex,
  DbClient,
  createCollection,
} from '@tanstack/db'
import { expect, test, vi } from 'vitest'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import { DbProvider } from '../src/DbProvider'
import {
  expectIndexingAdmission,
  expectIndexingConfiguration,
  expectIndexingReuse,
  expectedIndexing,
  expectedIndexingReuse,
  indexConfigurationPairs,
  indexConfigurations,
} from '../../db/tests/conformance/indexing-config-oracle'
import { expectUnorderedRows } from '../../db/tests/conformance/result-laws'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { createOracleReach } from '../../db/tests/oracle-reach'
import {
  mockSyncCollectionOptions,
  withOracleCleanup,
} from '../../db/tests/utils'
import type { InitialQueryBuilder } from '@tanstack/db'
import type { ReactNode } from 'react'
import type { IndexSettings } from '../../db/tests/conformance/indexing-config-oracle'
import type { Row } from '../../db/tests/conformance/contract'

declareOracle({
  grammar: [indexConfigurationPairs],
  model: [expectedIndexing, expectedIndexingReuse],
  check: [
    expectIndexingAdmission,
    expectIndexingConfiguration,
    expectIndexingReuse,
  ],
})

function createSameNameIndex() {
  return class SameNameIndex extends BasicIndex {}
}
const firstNamedIndex = createSameNameIndex()
const secondNamedIndex = createSameNameIndex()
const configurations = indexConfigurations({
  indexTypes: { basic: BasicIndex, btree: BTreeIndex },
})
const namedConfigurations = ([`off`, `eager`] as const).flatMap((autoIndex) =>
  [firstNamedIndex, secondNamedIndex].map((defaultIndexType) => ({
    autoIndex,
    defaultIndexType,
  })),
)
const pairs = [
  ...indexConfigurationPairs(configurations).map((history) => ({
    ...history,
    lane: `built-in`,
  })),
  ...indexConfigurationPairs(namedConfigurations)
    .filter(
      ({ first, second }) => first.defaultIndexType !== second.defaultIndexType,
    )
    .map((history) => ({ ...history, lane: `same-name` })),
]
const histories = pairs.flatMap((history, cell) =>
  ([`unscoped`, `client`] as const).map((scope) => ({
    ...history,
    cell,
    scope,
  })),
)

type ObservedOutput = {
  config: IndexSettings
  cleanup: (options?: { dependents?: boolean }) => Promise<void>
}

test.each(histories)(
  `each initial Suspense binding keeps its indexing settings: %j`,
  async ({ first, second, identity, cell, scope, lane }) => {
    const reach = createOracleReach(
      `React Suspense indexing/${scope}/${lane}/${identity}/${cell}`,
      [
        `first-admission`,
        `second-admission`,
        `retained-first`,
        ...(!expectedIndexing(first).rejects ? [`retained-options`] : []),
        ...(!expectedIndexing(first).rejects &&
        !expectedIndexing(second).rejects
          ? [`rebound-options`]
          : []),
      ],
    )
    reach.beginHistory()
    if (lane === `same-name`) {
      expect(first.defaultIndexType).not.toBe(second.defaultIndexType)
      expect(first.defaultIndexType?.name).toBe(second.defaultIndexType?.name)
    }
    const rows: Array<Row> = [
      { id: `1`, name: `Alice`, age: 30, team: `a` },
      { id: `2`, name: `Bob`, age: 25, team: `b` },
    ]
    const source = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `suspense-indexing-${scope}-${cell}`,
        getKey: (row) => row.id,
        initialData: rows.map((row) => ({ ...row })),
      }),
    )
    const client = scope === `client` ? new DbClient() : undefined
    function Wrapper({ children }: { children: ReactNode }) {
      const suspense = (
        <Suspense fallback={<div>Loading</div>}>{children}</Suspense>
      )
      return client ? (
        <DbProvider client={client}>{suspense}</DbProvider>
      ) : (
        suspense
      )
    }
    const query = (q: InitialQueryBuilder) => q.from({ row: source })
    const outputs = new Set<ObservedOutput>()
    let reconfigureFirst:
      ((settings: IndexSettings, rebind: boolean) => Promise<void>) | undefined
    // React reports an expected rejected render to console.error as well as
    // throwing it from renderHook. The admission observation keeps the error.
    const errors = vi.spyOn(console, `error`).mockImplementation(() => {})
    const mount = async (settings: IndexSettings, binding: 0 | 1) => {
      const queryKey =
        identity === `derived`
          ? undefined
          : [`suspense-indexing-${cell}`, identity === `same-key` ? 0 : binding]
      const admission: { rejected: boolean; error?: unknown } = {
        rejected: false,
      }
      let read:
        (() => { data: Array<Row>; collection: ObservedOutput }) | undefined
      try {
        const rendered = renderHook(
          ({ declaration, rebind }) =>
            useLiveSuspenseQuery({
              query,
              queryKey: rebind ? [`rebound-indexing`, cell] : queryKey,
              ...declaration,
            }),
          {
            wrapper: Wrapper,
            initialProps: { declaration: settings, rebind: false },
          },
        )
        read = () => rendered.result.current
        if (binding === 0)
          reconfigureFirst = async (declaration, rebind) => {
            rendered.rerender({ declaration, rebind })
            await waitFor(() =>
              expect(rendered.result.current.data).toHaveLength(rows.length),
            )
            const output = rendered.result.current.collection
            outputs.add(output)
            expectIndexingConfiguration(output, rebind ? declaration : settings)
            if (!rebind) expect(output).toBe(result.collection)
          }
      } catch (error) {
        admission.rejected = true
        admission.error = error
      }
      expectIndexingAdmission(admission, settings)
      if (expectedIndexing(settings).rejects) return undefined
      await waitFor(() => expect(read!().data).toHaveLength(rows.length))
      const result = read!()
      outputs.add(result.collection)
      expectUnorderedRows(result.data, rows)
      expectIndexingConfiguration(result.collection, settings)
      return result.collection
    }
    await withOracleCleanup(async () => {
      await source.preload()
      const firstOutput = await mount(first, 0)
      reach.reach(`first-admission`)
      const secondOutput = await mount(second, 1)
      reach.reach(`second-admission`)
      if (firstOutput) expectIndexingConfiguration(firstOutput, first)
      expectIndexingReuse(firstOutput, secondOutput, first, second, identity)
      reach.reach(`retained-first`)
      if (firstOutput) {
        await reconfigureFirst!(second, false)
        reach.reach(`retained-options`)
        if (!expectedIndexing(second).rejects) {
          await reconfigureFirst!(second, true)
          reach.reach(`rebound-options`)
        }
      }
      reach.assertReached()
    }, [
      () => cleanup(),
      () =>
        withOracleCleanup(
          () => {},
          [...outputs].map(
            (output) => () => output.cleanup({ dependents: true }),
          ),
        ),
      () => client?.cleanup(),
      () => source.cleanup({ dependents: true }),
      () => errors.mockRestore(),
    ])
  },
)
