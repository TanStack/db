import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createTransaction } from '../src/transactions.js'
import { BasicIndex } from '../src/indexes/basic-index.js'
import { createLiveQueryCollection } from '../src/query/live-query-collection.js'
import { inArray } from '../src/query/builder/functions.js'
import { mockSyncCollectionOptions, stripVirtualProps } from './utils.js'

type Row = { id: string; stage: string }

const flushTasks = () => new Promise((r) => setTimeout(r, 0))

describe(`auto-index snapback after optimistic + sync, with concurrent in-flight transactions`, () => {
  it(`single drag, no concurrent traffic — works correctly (baseline)`, async () => {
    const options = mockSyncCollectionOptions<Row>({
      id: `baseline`,
      getKey: (item) => item.id,
      initialData: [
        { id: `P`, stage: `A` },
        { id: `Q`, stage: `A` },
      ],
      autoIndex: `eager`,
      defaultIndexType: BasicIndex,
    })
    const collection = createCollection(options)
    await collection.stateWhenReady()

    const liveA = createLiveQueryCollection({
      query: (q: any) =>
        q
          .from({ p: collection })
          .where(({ p }: any) => inArray(p.stage, [`A`])),
      startSync: true,
    })
    await liveA.stateWhenReady()

    let resolveMutation!: () => void
    const tx = createTransaction<Row>({
      autoCommit: false,
      mutationFn: async () => {
        await new Promise<void>((r) => {
          resolveMutation = r
        })
      },
    })
    tx.mutate(() => {
      collection.update(`P`, (d) => {
        d.stage = `B`
      })
    })
    const committed = tx.commit()

    // mutationFn resolves before sync delivers — snapback happens.
    resolveMutation()
    await committed
    await tx.isPersisted.promise
    await flushTasks()

    options.utils.begin()
    options.utils.write({ type: `update`, value: { id: `P`, stage: `B` } })
    options.utils.commit()
    await flushTasks()

    expect(stripVirtualProps(collection.get(`P`))).toEqual({
      id: `P`,
      stage: `B`,
    })
    expect(liveA.toArray.map((r: any) => r.id).sort()).toEqual([`Q`])
  })

  // BUG REPRODUCTION
  //
  // Models the user's "fast successive drags" scenario:
  //
  //   1. User drags card P from stage A → stage B → optimistic T1 starts persisting.
  //   2. User immediately drags card Q from stage A → stage B → optimistic T2 starts persisting.
  //   3. T1's mutationFn resolves (server-confirmed). awaitTxId races out via the snapshot
  //      path before the shape stream has actually delivered P's row change — so when the
  //      optimistic delta lifts, no buffered sync exists for P, and `recomputeOptimisticState`
  //      drops P's optimistic upsert as "stale". Visible state for P snaps from B back to A.
  //   4. The shape stream now delivers P's row change. But T2 is still persisting, so
  //      `commitPendingTransactions` is gated on `hasPersistingTransaction` and the sync
  //      message sits buffered in `pendingSyncedTransactions` indefinitely.
  //   5. While T2 keeps persisting, anyone reading the live query sees P stuck in stage A
  //      even though the server has confirmed it as stage B.
  //
  // In the user's app: with continuous drag traffic, the "T2 still persisting" condition
  // is effectively always true → the buffered sync never flushes → "stays until reload".
  //
  // This test asserts the *correct* behaviour and is expected to FAIL until the bug is
  // fixed; the failing CI is intentional.
  it(`snapback + buffered sync remains stale while another transaction is persisting`, async () => {
      const options = mockSyncCollectionOptions<Row>({
        id: `bug-repro`,
        getKey: (item) => item.id,
        initialData: [
          { id: `P`, stage: `A` },
          { id: `Q`, stage: `A` },
        ],
        autoIndex: `eager`,
        defaultIndexType: BasicIndex,
      })
      const collection = createCollection(options)
      await collection.stateWhenReady()

      const liveA = createLiveQueryCollection({
        query: (q: any) =>
          q
            .from({ p: collection })
            .where(({ p }: any) => inArray(p.stage, [`A`])),
        startSync: true,
      })
      await liveA.stateWhenReady()
      expect(liveA.toArray.map((r: any) => r.id).sort()).toEqual([`P`, `Q`])

      // T1: optimistic P A → B
      let resolveT1!: () => void
      const t1 = createTransaction<Row>({
        autoCommit: false,
        mutationFn: async () => {
          await new Promise<void>((r) => {
            resolveT1 = r
          })
        },
      })
      t1.mutate(() => {
        collection.update(`P`, (d) => {
          d.stage = `B`
        })
      })
      const c1 = t1.commit()

      // T2: optimistic Q A → B (still persisting at the moment T1's sync arrives)
      const t2 = createTransaction<Row>({
        autoCommit: false,
        // Never resolves during this test — modeling a long-running transaction that
        // keeps `hasPersistingTransaction` true while T1's sync arrives.
        mutationFn: () => new Promise<void>(() => {}),
      })
      t2.mutate(() => {
        collection.update(`Q`, (d) => {
          d.stage = `B`
        })
      })
      void t2.commit()

      expect(liveA.toArray.map((r: any) => r.id)).toEqual([])

      // T1's mutationFn resolves (server confirmed). awaitTxId returned via snapshot path
      // before the row delivery — so no buffered sync exists yet. Snapback happens for P.
      resolveT1()
      await c1
      await t1.isPersisted.promise
      await flushTasks()

      // After the snapback for P: visible state for P reverted to synced (stage A),
      // because no pending sync existed at the moment T1's optimistic was lifted.
      expect(stripVirtualProps(collection.get(`P`))).toEqual({
        id: `P`,
        stage: `A`,
      })

      // Shape stream finally delivers P's row change. T2 is still persisting → buffered.
      options.utils.begin()
      options.utils.write({ type: `update`, value: { id: `P`, stage: `B` } })
      options.utils.commit()
      await flushTasks()

      // The assertions below describe the *correct* behaviour. They currently FAIL,
      // demonstrating the bug — collection.get and the live query both still report
      // P as stage A even though syncedData has the new value waiting in
      // pendingSyncedTransactions.
      expect(stripVirtualProps(collection.get(`P`))).toEqual({
        id: `P`,
        stage: `B`,
      })
      expect(liveA.toArray.map((r: any) => r.id).sort()).toEqual([`Q`])
  })
})
