/**
 * Ordinary regression tests for cleanup of a persisted source that has a queued receipt, then restarts with the same
 * persistence: the queued receipt is fenced, and the restarted owner accepts its own writes, in startup and subscription
 * hydration phases, with and without the hydration routing probe. The fencing law is owned by persisted-oracle.test.ts,
 * which keeps its model-checked hydration cases. The last test is a self-test of expectHydrationReceiptsPending from
 * persisted-support.ts, the receipt-pending check the oracle file uses; it is not an oracle.
 */
import { describe, expect, it } from 'vitest'
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../src'
import {
  atPersistedOracleCheckpoint,
  cleanupPersistedOracle,
  createDeferred,
  createRecordingAdapter,
  expectHydrationReceiptsPending,
  flushAsyncWork,
  installHydrationRoutingProbe,
  observeSettlement,
  stripVirtualProps,
} from './persisted-support'
import type { Todo, TodoSyncParams } from './persisted-support'

describe(`hydration source durability routing`, () => {
  // Cleanup is a history action here, not only teardown. Queued source work
  // has not entered storage when cleanup invalidates its sync run; releasing
  // the old read cannot publish/store it in the replacement run. An already
  // issued storage operation is outside this witness's no-write premise.
  it.each(
    [false, true].flatMap((scoped) =>
      [`startup`, `subscription`].map((phase) => ({ scoped, phase })),
    ),
  )(
    `cleanup fences a queued source receipt and permits restart: $phase scoped=$scoped`,
    async ({ scoped, phase }) => {
      const adapter = createRecordingAdapter()
      const entered = createDeferred()
      const release = createDeferred()
      let holdRead = phase === `startup`
      const resume = adapter.loadResumeSnapshot.bind(adapter)
      const load = adapter.loadSubset.bind(adapter)
      const hold = async <T>(snapshot: T) => {
        if (holdRead) {
          holdRead = false
          entered.resolve()
          await release.promise
        }
        return snapshot
      }
      adapter.loadResumeSnapshot = async (...args) => {
        const snapshot = await resume(...args)
        return args[1]?.includeRows === false ? snapshot : hold(snapshot)
      }
      adapter.loadSubset = async (...args) => hold(await load(...args))
      const probe = scoped ? installHydrationRoutingProbe(adapter) : undefined
      let source!: TodoSyncParams
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `scoped-cleanup-restart`,
          getKey: (row) => row.id,
          syncMode: phase === `subscription` ? `on-demand` : `eager`,
          sync: {
            sync: (params) => {
              source = params
              params.markReady()
              return { loadSubset: () => true }
            },
          },
          persistence: { adapter },
        }),
      )
      const ready = collection.stateWhenReady()
      void ready.catch(() => undefined)
      let subset: Promise<unknown> | undefined
      let receipt: Promise<void> | undefined
      let hasPrimaryFailure = false
      try {
        if (phase === `subscription`) {
          await atPersistedOracleCheckpoint(ready, `cleanup initial readiness`)
          holdRead = true
          subset = Promise.resolve(collection._sync.loadSubset({ limit: 1 }))
          void subset.catch(() => undefined)
        }
        await atPersistedOracleCheckpoint(entered.promise, `cleanup held read`)
        source.begin()
        source.write({
          type: `insert`,
          value: { id: `obsolete`, title: `retired sync run` },
        })
        receipt = Promise.resolve(source.commit()).then(() => undefined)
        const receiptState = observeSettlement(receipt)
        const oldSource = source
        const cleaning = collection.cleanup()
        void cleaning.catch(() => undefined)
        release.resolve()
        await atPersistedOracleCheckpoint(
          Promise.allSettled([cleaning, receipt, ready, subset]),
          `cleanup invalidates buffered work`,
        )
        expect(receiptState.read().status).toBe(`rejected`)
        expect(adapter.applyCommittedTxCalls).toEqual([])
        expect(adapter.rows.size).toBe(0)
        expect(collection.status).toBe(`cleaned-up`)
        await atPersistedOracleCheckpoint(
          collection.stateWhenReady(),
          `replacement sync run ready`,
        )
        oldSource.begin()
        oldSource.write({
          type: `insert`,
          value: { id: `obsolete`, title: `late callback` },
        })
        await oldSource.commit()
        source.begin()
        source.write({
          type: `insert`,
          value: { id: `fresh`, title: `replacement source` },
        })
        await atPersistedOracleCheckpoint(
          Promise.resolve(source.commit()),
          `replacement source durable`,
        )
        expect(collection.get(`obsolete`)).toBeUndefined()
        expect(adapter.rows.has(`obsolete`)).toBe(false)
        expect(stripVirtualProps(collection.get(`fresh`))).toEqual({
          id: `fresh`,
          title: `replacement source`,
        })
        expect(adapter.rows.get(`fresh`)).toEqual({
          id: `fresh`,
          title: `replacement source`,
        })
        expect(probe?.violations() ?? []).toEqual([])
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        release.resolve()
        await cleanupPersistedOracle(
          [
            () => Promise.allSettled([ready, subset, receipt]),
            () => collection.cleanup(),
          ],
          hasPrimaryFailure,
        )
      }
    },
  )

  it(`rejects an early individual receipt even while its sibling is pending`, async () => {
    const pending = createDeferred()
    const receipts = [
      observeSettlement(Promise.resolve()),
      observeSettlement(pending.promise),
    ]
    // A task boundary drains promise reactions; no elapsed duration is treated
    // as progress evidence. The other receipt remains causally held by a gate.
    await flushAsyncWork()
    try {
      expect(() => expectHydrationReceiptsPending(receipts)).toThrow()
    } finally {
      pending.resolve()
    }
  })
})
