/**
 * Every explicit DbClient preload declaration obeys Collection's eager-index
 * constructor requirement, including warm reuse. Authority: maintainer's
 * preload-admission decision in the PR #2314 review, 2026-10-30. A rejected
 * declaration cannot discard a compatible caller's pending or settled preload.
 *
 * The shared indexing model judges admission synchronously, before any held
 * source delivery. The finite grammar crosses all nine declarations with a
 * cold client or each valid prior declaration, pending/settled prior delivery,
 * and derived/same/different query keys. It judges no hydrated cache or SSR.
 */
import { expect, test } from 'vitest'
import {
  BTreeIndex,
  BasicIndex,
  DbClient,
  Query,
  createCollection,
} from '../src'
import {
  expectIndexingAdmission,
  expectedIndexing,
  indexConfigurations,
} from './conformance/indexing-config-oracle'
import { declareOracle } from './oracle-declaration'
import { createOracleReach } from './oracle-reach'
import { withOracleCleanup } from './utils'

function preloadIndexHistories() {
  const settings = indexConfigurations({
    indexTypes: { basic: BasicIndex, btree: BTreeIndex },
  })
  const priors = [
    { first: undefined, phase: `cold` },
    ...settings
      .filter((setting) => !expectedIndexing(setting).rejects)
      .flatMap((first) =>
        [`pending`, `settled`].map((phase) => ({ first, phase })),
      ),
  ]
  return priors.flatMap((prior) =>
    settings.flatMap((second) =>
      ([`derived`, `same-key`, `different-key`] as const).map((identity) => ({
        ...prior,
        second,
        identity,
      })),
    ),
  )
}
declareOracle({
  grammar: [preloadIndexHistories],
  model: [expectedIndexing],
  check: [expectIndexingAdmission],
})

test.each(preloadIndexHistories())(
  `preload indexing admission: %j`,
  async ({ first, second, phase, identity }) => {
    const reach = createOracleReach(`preload indexing/${phase}/${identity}`, [
      `admission`,
      ...(first ? [`original-reuse`] : []),
    ])
    reach.beginHistory()
    const client = new DbClient()
    let starts = 0
    let delivered = false
    let deliver = () => {}
    const source = createCollection({
      id: `preload-indexing-source`,
      getKey: (row: { id: number }) => row.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          starts++
          deliver = () => {
            if (delivered) return
            delivered = true
            begin()
            write({ type: `insert`, value: { id: 1 } })
            commit()
            markReady()
          }
        },
      },
    })
    const query = new Query().from({ row: source })
    const queryKey = identity === `derived` ? undefined : [`preload-indexing`]
    const firstConfig = { query, queryKey, ...first }
    const pending: Array<Promise<void>> = []
    let original: Promise<void> | undefined
    await withOracleCleanup(async () => {
      if (first) {
        original = client.preloadLiveQuery(firstConfig)
        pending.push(original)
        expect(starts, `first preload starts held source`).toBe(1)
        if (phase === `settled`) {
          deliver()
          await original
        }
      }
      const admission: { rejected: boolean; error?: unknown } = {
        rejected: false,
      }
      try {
        pending.push(
          client.preloadLiveQuery({
            query,
            queryKey:
              identity === `different-key`
                ? [`other-preload-indexing`]
                : queryKey,
            ...second,
          }),
        )
      } catch (error) {
        admission.rejected = true
        admission.error = error
      }
      expectIndexingAdmission(admission, second)
      reach.reach(`admission`)
      if (first) {
        expect(
          client.preloadLiveQuery(firstConfig),
          `prior preload survives second admission`,
        ).toBe(original)
        reach.reach(`original-reuse`)
      }
      if (phase !== `settled` && starts) deliver()
      await Promise.all(pending)
      reach.assertReached()
    }, [
      async () => {
        if (phase !== `settled` && starts) deliver()
        await Promise.allSettled(pending)
        await client.cleanup()
      },
      () => source.cleanup({ dependents: true }),
    ])
  },
)
