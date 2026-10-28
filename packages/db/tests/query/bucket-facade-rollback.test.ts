import { D2, MultiSet } from '@tanstack/db-ivm'
import { describe, expect, it } from 'vitest'
import { BucketFacadeAdapter } from '../../src/query/live/bucket-facade-adapter.js'
import { createTransaction } from '../../src/transactions.js'
import { stripVirtualProps } from '../utils.js'
import { BUCKET_FACADE_REF } from '../../src/query/live/materialized-pipeline.js'
import {
  Driver,
  injectFailure,
  withCleanup,
} from './bucket-facade-rollback-support.js'
import type { Collection } from '../../src/collection/index.js'
import type { BucketRow } from '../../src/query/live/materialized-pipeline.js'
import type { FacadeEntry, Op, Row } from './bucket-facade-rollback-support.js'

// Unit tests for the bucket-facade rollback oracle. Each test here is a fixed
// scenario whose expectations are literal values, or a check of the oracle's
// own cleanup machinery, so no declared check or model reaches it. The laws of
// flush atomicity, bounded rollback work, and layout are owned by
// bucket-facade-rollback-oracle.property.test.ts. Its shared Driver lives in
// bucket-facade-rollback-support.ts.

/** The child facade a parent row's `kids` field points to. */
function kidsOf(row: unknown): unknown {
  return (row as { kids?: unknown } | undefined)?.kids
}

describe(`bucket facade rollback`, () => {
  // Pinned: a list of 50 buckets with 3 rows each, where one insert touches
  // one bucket. The flush must read that bucket's rows and no others.
  it(`reads only the written facade in a wide list`, async () => {
    const driver = new Driver()
    await withCleanup(
      () => {
        const wide = Array.from({ length: 50 }, (_, index) => `w${index}`)
        for (const bucket of wide) {
          driver.send([
            { type: `activate`, bucket },
            ...[1, 2, 3].map((id): Op => ({
              type: `insert`,
              bucket,
              id,
              v: id,
              rank: id,
            })),
          ])
        }
        driver.adapter.flush().publish()
        driver.instrument()
        driver.send([{ type: `insert`, bucket: `w7`, id: 4, v: 4, rank: 4 }])
        driver.takeReads()
        driver.adapter.flush().publish()
        const written = driver.entry(`w7`)!.collection
        const untouchedReads = [...driver.takeReads()]
          .filter(([facade]) => facade !== written)
          .map(([facade]) => (facade as Collection<Row, number>).id)
        expect(untouchedReads).toEqual([])
      },
      () => driver.cleanup(),
    )
  })
  // Pinned: nested facades. A parent facade's row refers to a child facade.
  // The child edge commits first, then the parent edge's commit throws. The
  // failed flush must restore the child's rows, keep the parent's reference
  // to the old child facade, and drop the child facade it created. The retry
  // then applies every change.
  it(`restores a child facade when its parent edge fails`, async () => {
    const graph = new D2()
    const childRows = graph.newInput<[string, BucketRow]>()
    const childActive = graph.newInput<[string, true]>()
    const parentRows = graph.newInput<[string, BucketRow]>()
    const parentActive = graph.newInput<[string, true]>()
    const adapter = new BucketFacadeAdapter(
      `rollback-oracle-nested-${Math.random()}`,
      [
        {
          edgeId: `children`,
          rows: childRows,
          activeBuckets: childActive,
          hasOrderBy: false,
        },
        {
          edgeId: `parents`,
          rows: parentRows,
          activeBuckets: parentActive,
          hasOrderBy: false,
        },
      ],
      () => {},
    )
    graph.finalize()
    const entries = (
      adapter as unknown as {
        entries: Map<string, Map<string, FacadeEntry>>
      }
    ).entries
    const facade = (edgeId: string, bucket: string) =>
      entries.get(edgeId)?.get(bucket)?.collection
    const ref = (bucketKey: string) => ({
      [BUCKET_FACADE_REF]: { edgeId: `children`, bucketKey },
    })
    const row = (publicKey: number, value: object): BucketRow => [
      publicKey,
      value,
      undefined,
    ]
    const child10 = row(10, { id: 10, v: 1 })
    const parent1 = row(1, { id: 1, kids: ref(`c1`) })

    await withCleanup(
      () => {
        childActive.sendData(new MultiSet([[[`c1`, true], 1]]))
        childRows.sendData(new MultiSet([[[`c1`, child10], 1]]))
        parentActive.sendData(new MultiSet([[[`p1`, true], 1]]))
        parentRows.sendData(new MultiSet([[[`p1`, parent1], 1]]))
        graph.run()
        adapter.flush().publish()
        const c1 = facade(`children`, `c1`)!
        const p1 = facade(`parents`, `p1`)!
        expect(kidsOf(p1.get(1))).toBe(c1)

        let events = 0
        c1.subscribeChanges(() => events++)
        p1.subscribeChanges(() => events++)

        // The flush updates c1, creates c2, and moves parent 1 to c2.
        const child10v2 = row(10, { id: 10, v: 2 })
        const child11 = row(11, { id: 11, v: 1 })
        const parent1moved = row(1, { id: 1, kids: ref(`c2`) })
        childRows.sendData(
          new MultiSet([
            [[`c1`, child10], -1],
            [[`c1`, child10v2], 1],
          ]),
        )
        childActive.sendData(new MultiSet([[[`c2`, true], 1]]))
        childRows.sendData(new MultiSet([[[`c2`, child11], 1]]))
        parentRows.sendData(
          new MultiSet([
            [[`p1`, parent1], -1],
            [[`p1`, parent1moved], 1],
          ]),
        )
        graph.run()
        injectFailure(entries.get(`parents`)!.get(`p1`)!.sync!, `commit`)

        expect(() => adapter.flush()).toThrow(`injected facade write failure`)
        expect(c1.toArray.map(stripVirtualProps)).toEqual([{ id: 10, v: 1 }])
        expect(kidsOf(p1.get(1))).toBe(c1)
        expect([...entries.get(`children`)!.keys()]).toEqual([`c1`])
        expect(events).toBe(0)

        // The retry applies the pending changes the failed flush kept.
        adapter.flush().publish()
        const c2 = facade(`children`, `c2`)!
        expect(c1.toArray.map(stripVirtualProps)).toEqual([{ id: 10, v: 2 }])
        expect(c2.toArray.map(stripVirtualProps)).toEqual([{ id: 11, v: 1 }])
        expect(kidsOf(p1.get(1))).toBe(c2)
      },
      async () => {
        adapter.cleanup()
        await Promise.resolve()
      },
    )
  })
  // Calibration for ORC-010: when the history fails and cleanup also throws,
  // the report keeps the history's failure as its cause.
  it(`keeps the oracle failure when cleanup also fails`, async () => {
    const failure = new Error(`oracle assertion`)
    const cleanupFailure = new Error(`cleanup failure`)
    const result = await withCleanup(
      () => Promise.reject(failure),
      () => Promise.reject(cleanupFailure),
    ).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(result).toBeInstanceOf(AggregateError)
    const aggregate = result as AggregateError
    expect(aggregate.cause).toBe(failure)
    expect(aggregate.errors).toEqual([failure, cleanupFailure])

    // Without a history failure, the cleanup failure is reported as is.
    await expect(
      withCleanup(
        () => Promise.resolve(),
        () => Promise.reject(cleanupFailure),
      ),
    ).rejects.toBe(cleanupFailure)
  })
  // Invariant witness: the flush runs inside the graph run, so graph output
  // cannot reach the adapter before its rollback. If it did, restoring the
  // consumed deltas would overwrite it, so the rollback throws instead.
  it(`throws when graph output arrives between a flush and its rollback`, async () => {
    const driver = new Driver()
    await withCleanup(
      () => {
        driver.send([
          { type: `activate`, bucket: `b0` },
          { type: `insert`, bucket: `b0`, id: 1, v: 1, rank: 1 },
        ])
        driver.adapter.flush().publish()
        driver.send([{ type: `update`, bucket: `b0`, id: 1, v: 2, rank: 1 }])
        const publication = driver.adapter.flush()
        driver.send([{ type: `insert`, bucket: `b0`, id: 2, v: 3, rank: 2 }])
        expect(() => publication.rollback()).toThrow(
          `Bucket facade received graph output between a flush and its rollback`,
        )
        // The rollback restored the facade and closed its deferral before it
        // threw, so the new delta still publishes on the next flush.
        const facade = driver.entry(`b0`)!.collection
        expect(facade.toArray.map(stripVirtualProps)).toEqual([{ id: 1, v: 1 }])
        let events = 0
        facade.subscribeChanges(() => {
          events++
        })
        driver.adapter.flush().publish()
        expect(facade.toArray.map(stripVirtualProps)).toEqual([
          { id: 1, v: 1 },
          { id: 2, v: 3 },
        ])
        expect(events).toBe(1)
      },
      () => driver.cleanup(),
    )
  })
  // A live query can be disposed between a flush and its rollback, for
  // example by a listener that runs during the root commit. The rollback then
  // has nothing to restore and must not bring the disposed facades back.
  it(`does nothing on rollback after cleanup`, async () => {
    const driver = new Driver()
    await withCleanup(
      () => {
        driver.send([
          { type: `activate`, bucket: `b0` },
          { type: `insert`, bucket: `b0`, id: 1, v: 1, rank: 1 },
        ])
        driver.adapter.flush().publish()
        driver.send([{ type: `update`, bucket: `b0`, id: 1, v: 2, rank: 1 }])
        const publication = driver.adapter.flush()
        driver.adapter.cleanup()
        publication.rollback()
        expect(driver.entry(`b0`)).toBeUndefined()
        expect(driver.adapter.hasPendingChanges()).toBe(false)
      },
      () => driver.cleanup(),
    )
  })
  it(`retires a bucket while a facade transaction persists`, async () => {
    const driver = new Driver()
    let settle!: () => void
    await withCleanup(
      async () => {
        driver.send([
          { type: `activate`, bucket: `b0` },
          { type: `insert`, bucket: `b0`, id: 1, v: 1, rank: 1 },
        ])
        driver.adapter.flush().publish()
        const facade = driver.entry(`b0`)!.collection
        const transaction = createTransaction({
          autoCommit: false,
          mutationFn: () =>
            new Promise<void>((resolve) => {
              settle = resolve
            }),
        })
        transaction.mutate(() => {
          facade.insert({ id: 50, v: 0, $key: 50 } as unknown as Row)
        })
        const committed = transaction.commit()
        driver.send([{ type: `retire`, bucket: `b0` }])
        expect(() => driver.adapter.flush().publish()).not.toThrow()
        expect(driver.entry(`b0`)).toBeUndefined()
        settle()
        await committed
      },
      () => driver.cleanup(),
    )
  })
  // The graph retracts a bucket's rows before it retires the bucket, so a
  // row the graph sent and never retracted is a contradictory graph signal.
  // The flush throws and restores the facade, as for any failed flush.
  it(`throws when a retired bucket still has rows the graph sent`, async () => {
    const driver = new Driver()
    await withCleanup(
      () => {
        driver.send([
          { type: `activate`, bucket: `b0` },
          { type: `insert`, bucket: `b0`, id: 1, v: 1, rank: 1 },
        ])
        driver.adapter.flush().publish()
        const facade = driver.entry(`b0`)!.collection
        driver.retireWithoutRetractions(`b0`)
        expect(() => driver.adapter.flush()).toThrow(
          `Bucket facade retired with rows the graph did not retract`,
        )
        expect(driver.entry(`b0`)?.collection).toBe(facade)
        expect(facade.toArray.map(stripVirtualProps)).toEqual([{ id: 1, v: 1 }])
      },
      () => driver.cleanup(),
    )
  })
  // The retraction is an ordinary facade write, so a rollback restores it.
  it(`restores a retired facade's rows when the root commit fails`, async () => {
    const driver = new Driver()
    await withCleanup(
      () => {
        driver.send([
          { type: `activate`, bucket: `b0` },
          { type: `insert`, bucket: `b0`, id: 1, v: 1, rank: 1 },
        ])
        driver.adapter.flush().publish()
        const facade = driver.entry(`b0`)!.collection
        driver.send([{ type: `retire`, bucket: `b0` }])
        const publication = driver.adapter.flush()
        publication.prepare()
        publication.rollback()
        expect(driver.entry(`b0`)?.collection).toBe(facade)
        expect(facade.toArray.map(stripVirtualProps)).toEqual([{ id: 1, v: 1 }])
      },
      () => driver.cleanup(),
    )
  })
  // A throwing subscriber of one facade must not keep another facade's
  // deferral open. Each facade publishes, then the first error is rethrown.
  it(`publishes every facade when one facade's subscriber throws`, async () => {
    const driver = new Driver()
    await withCleanup(
      () => {
        driver.send([
          { type: `activate`, bucket: `b0` },
          { type: `activate`, bucket: `b1` },
          { type: `insert`, bucket: `b0`, id: 1, v: 1, rank: 1 },
          { type: `insert`, bucket: `b1`, id: 1, v: 1, rank: 1 },
        ])
        driver.adapter.flush().publish()
        const subscriberError = new Error(`subscriber failure`)
        const throwing = driver.entry(`b0`)!.collection.subscribeChanges(() => {
          throw subscriberError
        })
        const keys: Array<number> = []
        driver
          .entry(`b1`)!
          .collection.subscribeChanges((changes) =>
            keys.push(...changes.map((change) => change.key)),
          )
        driver.send([
          { type: `insert`, bucket: `b0`, id: 2, v: 1, rank: 2 },
          { type: `insert`, bucket: `b1`, id: 2, v: 1, rank: 2 },
        ])
        expect(() => driver.adapter.flush().publish()).toThrow(subscriberError)
        expect(keys).toEqual([2])
        throwing.unsubscribe()
        driver.send([{ type: `insert`, bucket: `b1`, id: 3, v: 1, rank: 3 }])
        driver.adapter.flush().publish()
        expect(keys).toEqual([2, 3])
      },
      () => driver.cleanup(),
    )
  })
  // A failed flush whose restore also throws still discards every deferral,
  // so the facade publishes the next successful flush.
  it(`keeps publishing a facade after its restore throws`, async () => {
    const driver = new Driver()
    await withCleanup(
      () => {
        driver.send([
          { type: `activate`, bucket: `b0` },
          { type: `insert`, bucket: `b0`, id: 1, v: 1, rank: 1 },
        ])
        driver.adapter.flush().publish()
        const entry = driver.entry(`b0`)!
        const keys: Array<number> = []
        entry.collection.subscribeChanges((changes) =>
          keys.push(...changes.map((change) => change.key)),
        )
        driver.send([{ type: `insert`, bucket: `b0`, id: 2, v: 1, rank: 2 }])
        const publication = driver.adapter.flush()
        publication.prepare()
        // The restore's commit throws.
        injectFailure(entry.sync!, `commit`)
        expect(() => publication.rollback()).toThrow(
          `injected facade write failure`,
        )
        driver.send([{ type: `insert`, bucket: `b0`, id: 3, v: 1, rank: 3 }])
        driver.adapter.flush().publish()
        expect(keys).toContain(3)
      },
      () => driver.cleanup(),
    )
  })
  // A flush with no facade changes copies no bookkeeping, so a root-only
  // write does no work proportional to the number of buckets.
  it(`copies nothing for a flush without facade changes`, async () => {
    const driver = new Driver()
    await withCleanup(
      () => {
        driver.send([
          { type: `activate`, bucket: `b0` },
          { type: `insert`, bucket: `b0`, id: 1, v: 1, rank: 1 },
        ])
        driver.adapter.flush().publish()
        const adapter = driver.adapter as unknown as { snapshot: () => unknown }
        let snapshots = 0
        const snapshot = adapter.snapshot
        adapter.snapshot = () => {
          snapshots++
          return snapshot.call(driver.adapter)
        }
        const publication = driver.adapter.flush()
        publication.prepare()
        publication.rollback()
        driver.adapter.flush().publish()
        expect(snapshots).toBe(0)
      },
      () => driver.cleanup(),
    )
  })
})
