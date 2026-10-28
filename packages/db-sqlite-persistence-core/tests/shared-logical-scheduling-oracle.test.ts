/**
 * # Which adapters share one logical scheduling boundary?
 *
 * Contract and source: the RFC #1659 driver protocol keys scheduling by the
 * exact shared driver identity. Two fresh core adapters over that identity
 * must not interleave a complete hydration scope with regular adapter work.
 * Transparent wrappers must forward the identity unchanged, including when
 * the identity itself is a function object.
 *
 * Independent relation and legal domain: a two-adapter history starts one
 * hydration metadata query, holds it at the driver boundary, then requests one
 * regular metadata query. Before release, exactly the first query may be
 * admitted; after release, both operations must finish. The three legal driver
 * forms are direct, transparently wrapped, and direct with a function-valued
 * key. This relation records admissions without copying the production
 * scheduler or invoking the opaque key. Promise-only discovery is a fourth
 * form: the first operation reveals the shared identity and its complete
 * hydration scope becomes the scheduler's already-running unit.
 *
 * Production boundary and checkpoint: both operations use
 * `createSQLiteCorePersistenceAdapter`; the hydration operation enters through
 * `runInHydrationScope`. The first checkpoint is immediately after the regular
 * request enters the adapter, while the first query remains held. Losing
 * wrapper identity or treating a function key as a getter synchronously admits
 * the second query and fails the exact admission assertion.
 *
 * Queued-work barrier: `runInRegularScope.afterQueuedWork()` settles after
 * every operation, in either lane, that was queued or running at the call.
 * It ignores operations queued after the call, settles on the next microtask
 * when the scheduler is idle, and never rejects, even when the work it waits
 * for fails. A hydrate adopted through promise discovery counts as running
 * work, whether or not the scheduler was already busy when it was adopted.
 * So does an unscheduled hydrate that has issued no query yet: before
 * discovery, and on a driver without scheduling support, it is still the
 * adapter's own running work.
 * Each relation is checked at a held query, so a barrier that waits too
 * long, too briefly, or only for one lane is pending or settled at the wrong
 * cut. The shared-driver fairness oracle checks that the barrier is not a
 * K=1 lane completion.
 *
 * Known omissions: promise-only discovery coordinates adapters over the same
 * wrapper identity. Distinct unbranded wrappers must forward the shared key
 * before adapter construction. This focused contract test does not establish
 * K=1 lane fairness, SQL result correctness, eventual progress under arbitrary
 * I/O, or cross-process coordination. Those belong to the shared-driver oracle
 * and provider refinements.
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { createSQLiteCorePersistenceAdapter } from '../src'
import { PromiseBrandedFirstQueryGatedDriver } from './shared-logical-scheduling-support'

describe(`shared logical scheduling`, () => {
  it(`keeps generated promise-discovered hydrate units non-preemptible`, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          hydrateQueries: fc.integer({ min: 1, max: 4 }),
          peerQueries: fc.integer({ min: 1, max: 3 }),
        }),
        async ({ hydrateQueries, peerQueries }) => {
          const driver = new PromiseBrandedFirstQueryGatedDriver()
          const hydrateAdapter = createSQLiteCorePersistenceAdapter({ driver })
          const peerAdapters = Array.from({ length: peerQueries }, () =>
            createSQLiteCorePersistenceAdapter({ driver }),
          )

          const hydrate = hydrateAdapter.runInHydrationScope!(
            async (scoped) => {
              for (let index = 0; index < hydrateQueries; index++) {
                await scoped.loadCollectionMetadata!({
                  kind: `eager`,
                  collectionId: `hydrate-${index}`,
                })
              }
            },
          )
          await driver.firstQueryEntered.promise

          const peers = peerAdapters.map((adapter, index) =>
            adapter.loadCollectionMetadata!({
              kind: `eager`,
              collectionId: `peer-${index}`,
            }),
          )
          expect(driver.admissions).toHaveLength(
            driver.firstQueryAdmissionCount,
          )

          driver.releaseFirstQuery()
          await Promise.all([hydrate, ...peers])
          expect(driver.metadataAdmissions).toEqual(
            Array.from({ length: hydrateQueries + peerQueries }, () => `query`),
          )
        },
      ),
      { seed: 1868, numRuns: 12, endOnFailure: true },
    )
  })
})
