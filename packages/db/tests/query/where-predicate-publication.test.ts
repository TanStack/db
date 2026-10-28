// Unit tests for the WHERE publication path with fixed witnesses: an empty
// readiness batch, a same-key update that stays TRUE, a pending optimistic
// delete, a layout-only publication, and a restarted source. Each compares
// production with written values, not with a model. The law and its oracle
// owner are in where-predicate-publication-oracle.property.test.ts; the shared
// predicate builders are in where-predicate-support.ts.
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { eq } from '../../src/query/builder/functions.js'
import { Func, PropRef, Value } from '../../src/query/ir.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { oracleReplayRequested } from '../oracle-config.js'
import {
  mockSyncCollectionOptions,
  mockSyncCollectionOptionsNoInitialState,
  withOracleCleanup,
} from '../utils.js'
import {
  fieldEq,
  irPredicate,
  recordVisibleKeys,
} from './where-predicate-support.js'
import type { Row } from './where-predicate-support.js'

let collectionSerial = 0

describe(`WHERE predicate publication oracle`, () => {
  if (!oracleReplayRequested()) {
    it(`Collection readiness reaches a filtered subscriber as one empty batch`, async () => {
      // `markReady` notifies subscribers of Collection readiness with an
      // empty batch. A subscriber
      // whose predicate no row can satisfy must still receive it.
      const collection = createCollection(
        mockSyncCollectionOptionsNoInitialState<Row>({
          id: `where-publication-ready-${collectionSerial++}`,
          getKey: (row) => row.id,
        }),
      )
      const batches: Array<number> = []
      const subscription = collection.subscribeChanges(
        (changes) => batches.push(changes.length),
        { whereExpression: irPredicate(fieldEq(`a`)) },
      )
      await withOracleCleanup(() => {
        collection.utils.begin()
        collection.utils.commit()
        collection.utils.markReady()
        expect(batches).toEqual([0])
      }, [() => subscription.unsubscribe(), () => collection.cleanup()])
    })

    it(`publishes the new payload for a same-key update that stays TRUE`, async () => {
      type PayloadRow = { id: string; v: string; n: number }
      const collection = createCollection(
        mockSyncCollectionOptions<PayloadRow>({
          id: `where-publication-payload-${collectionSerial++}`,
          getKey: (row) => row.id,
          initialData: [{ id: `r0`, v: `a`, n: 1 }],
        }),
      )
      const live = createLiveQueryCollection((q) =>
        q.from({ row: collection }).where(({ row }) => eq(row.v, `a`)),
      )
      const events: Array<{
        type: string
        key: string | number
        n: number
        previousN: number | undefined
      }> = []
      await collection.stateWhenReady()
      await live.preload()
      const subscription = collection.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            events.push({
              type: change.type,
              key: change.key,
              n: change.value.n,
              previousN: change.previousValue?.n,
            })
          }
        },
        {
          includeInitialState: true,
          whereExpression: irPredicate(fieldEq(`a`)),
        },
      )
      await withOracleCleanup(() => {
        events.length = 0
        expect(live.get(`r0`)?.n).toBe(1)
        collection.utils.begin()
        collection.utils.write({
          type: `update`,
          value: { id: `r0`, v: `a`, n: 2 },
        })
        collection.utils.commit()
        expect(live.get(`r0`)?.n).toBe(2)
        expect(events).toEqual([
          { type: `update`, key: `r0`, n: 2, previousN: 1 },
        ])
      }, [
        () => subscription.unsubscribe(),
        () => live.cleanup(),
        () => collection.cleanup(),
      ])
    })

    it(`a pending optimistic delete hides a row from a prefiltered unindexed scan`, async () => {
      // The scan may read synced rows directly only when no optimistic state
      // changes visibility. A pending delete removes a synced row.
      const collection = createCollection(
        mockSyncCollectionOptions<Row>({
          id: `where-publication-optimistic-delete-${collectionSerial++}`,
          getKey: (row) => row.id,
          initialData: [
            { id: `r0`, v: `a` },
            { id: `r1`, v: `a` },
            { id: `r2`, v: `b` },
          ],
        }),
      )
      const visible = new Set<string | number>()
      let subscription: { unsubscribe: () => void } | undefined
      await withOracleCleanup(async () => {
        await collection.stateWhenReady()
        // The adapter's onDelete awaits a sync acknowledgement that this test
        // never sends, so the delete stays pending.
        collection.delete(`r1`)
        subscription = collection.subscribeChanges(recordVisibleKeys(visible), {
          includeInitialState: true,
          whereExpression: irPredicate(fieldEq(`a`)),
        })
        const snapshot = collection.currentStateAsChanges({
          where: irPredicate(fieldEq(`a`)),
        })
        expect(snapshot?.map((change) => change.key)).toEqual([`r0`])
        expect([...visible]).toEqual([`r0`])
      }, [() => subscription?.unsubscribe(), () => collection.cleanup()])
    })

    it(`a layout-only publication reaches a filtered subscriber as one empty batch`, async () => {
      // An ordered live query whose rows move without changing their selected
      // values publishes no rows, only a layout change. Every subscriber still
      // learns that the layout changed, whatever its predicate.
      type RankedRow = { id: string; rank: number }
      const source = createCollection(
        mockSyncCollectionOptions<RankedRow>({
          id: `where-publication-layout-${collectionSerial++}`,
          getKey: (row) => row.id,
          initialData: [
            { id: `r0`, rank: 1 },
            { id: `r1`, rank: 2 },
          ],
        }),
      )
      const live = createLiveQueryCollection((q) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.rank)
          .select(({ row }) => ({ id: row.id })),
      )
      const batches: Array<number> = []
      let subscription: { unsubscribe: () => void } | undefined
      await withOracleCleanup(async () => {
        await live.preload()
        subscription = live.subscribeChanges(
          (changes) => batches.push(changes.length),
          {
            whereExpression: new Func(`eq`, [
              new PropRef([`id`]),
              new Value(`missing`),
            ]),
          },
        )
        source.utils.begin()
        source.utils.write({ type: `update`, value: { id: `r0`, rank: 3 } })
        source.utils.commit()
        expect([...live.keys()]).toEqual([`r1`, `r0`])
        expect(batches).toEqual([0])
      }, [
        () => subscription?.unsubscribe(),
        () => live.cleanup(),
        () => source.cleanup(),
      ])
    })

    it(`a restarted source retracts a vanished row even when its first batch cannot match`, async () => {
      // Cleanup keeps the subscriber's published rows. The restarted eager
      // source's first publication must retract rows it no longer holds,
      // although no change in that batch satisfies the predicate. The check
      // runs before ready, whose empty batch would also reconcile them.
      let sourceRows: Array<Row> = [{ id: `r0`, v: `a` }]
      let markSourceReady = () => {}
      const collection = createCollection<Row>({
        id: `where-publication-restart-${collectionSerial++}`,
        getKey: (row) => row.id,
        startSync: true,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            for (const row of sourceRows) write({ type: `insert`, value: row })
            commit()
            markSourceReady = markReady
          },
        },
      })
      const visible = new Set<string | number>()
      markSourceReady()
      await collection.stateWhenReady()
      const subscription = collection.subscribeChanges(
        recordVisibleKeys(visible),
        {
          includeInitialState: true,
          whereExpression: irPredicate(fieldEq(`a`)),
        },
      )
      await withOracleCleanup(async () => {
        expect([...visible]).toEqual([`r0`])
        sourceRows = [{ id: `r1`, v: `b` }]
        await collection.cleanup()
        collection.startSyncImmediate()
        expect([...visible]).toEqual([])
        markSourceReady()
        expect([...visible]).toEqual([])
      }, [() => subscription.unsubscribe(), () => collection.cleanup()])
    })
  }
})
