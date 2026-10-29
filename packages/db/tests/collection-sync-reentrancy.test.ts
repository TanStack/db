// Ordinary tests moved out of collection-sync-reentrancy-oracle.test.ts. They keep
// literal expectations for listener deferral, layout marks, and ready-callback
// publication; the listener-history law stays in the oracle file.
import { describe, expect, it, vi } from 'vitest'
import { CollectionChangesManager } from '../src/collection/changes.js'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { flushPromises } from './utils.js'
import {
  createSyncHarness,
  installInitialOrderedRows,
  stageInsert,
} from './collection-sync-reentrancy-support.js'
import type {
  LayoutCallback,
  OrderedRow,
  OrderedSync,
  Row,
  SyncOps,
} from './collection-sync-reentrancy-support.js'

describe(`sync publication reentrancy`, () => {
  it.each([`cleanup`, `discard`] as const)(
    `releases queued messages when %s retires a deferral`,
    (ending) => {
      const changes = new CollectionChangesManager<Row, number>()
      const handle = changes.deferPublication()
      changes.emitEvents([
        { type: `insert`, key: 1, value: { id: 1, value: `queued` } },
      ])

      const retired = (
        changes as unknown as { deferral?: { publications: Array<unknown> } }
      ).deferral
      if (!retired) throw new Error(`deferral did not open`)
      expect(retired.publications).toHaveLength(1)

      if (ending === `cleanup`) changes.cleanup()
      else handle.discard()
      expect(retired.publications).toHaveLength(0)
      handle.publish()
    },
  )

  it(`publishes nested deferrals as one coherent batch`, async () => {
    const harness = createSyncHarness(`nested-publication-cycle`)
    const { collection } = harness
    const callbacks: Array<{ changes: Array<string>; visibleValue: string }> =
      []
    const subscription = collection.subscribeChanges(
      (changes) => {
        callbacks.push({
          changes: changes.map((change) => change.value.value),
          visibleValue: collection.get(1)!.value,
        })
      },
      { includeInitialState: false },
    )

    try {
      const outer = collection._deferPublication()
      stageInsert(harness.sync, { id: 1, value: `first` })
      harness.sync.commit()
      const inner = collection._deferPublication()
      harness.sync.begin()
      harness.sync.write({
        type: `update`,
        value: { id: 1, value: `second` },
      })
      harness.sync.commit()

      inner.publish()
      expect(callbacks).toEqual([])
      outer.publish()
      expect(callbacks).toEqual([
        { changes: [`first`, `second`], visibleValue: `second` },
      ])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`starts a fresh publication after the previous one closes`, async () => {
    const harness = createSyncHarness(`successive-publication-cycles`)
    const { collection } = harness
    const callbacks: Array<Array<string>> = []
    const subscription = collection.subscribeChanges(
      (changes) => callbacks.push(changes.map((change) => change.value.value)),
      { includeInitialState: false },
    )

    try {
      const first = collection._deferPublication()
      stageInsert(harness.sync, { id: 1, value: `first` })
      harness.sync.commit()
      first.publish()

      const second = collection._deferPublication()
      harness.sync.begin()
      harness.sync.write({
        type: `update`,
        value: { id: 1, value: `second` },
      })
      harness.sync.commit()
      second.publish()

      expect(callbacks).toEqual([[`first`], [`second`]])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`does not let a discarded deferral poison the next publication`, async () => {
    const harness = createSyncHarness(`discarded-publication-cycle`)
    const { collection } = harness
    const callbacks: Array<Array<string>> = []
    const subscription = collection.subscribeChanges(
      (changes) => callbacks.push(changes.map((change) => change.value.value)),
      { includeInitialState: false },
    )

    try {
      const discarded = collection._deferPublication()
      stageInsert(harness.sync, { id: 1, value: `discarded` })
      harness.sync.commit()
      discarded.discard()
      expect(callbacks).toEqual([])

      const published = collection._deferPublication()
      harness.sync.begin()
      harness.sync.write({
        type: `update`,
        value: { id: 1, value: `published` },
      })
      harness.sync.commit()
      published.publish()
      expect(callbacks).toEqual([[`published`]])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`lets a publication callback start the next publication cycle`, async () => {
    const harness = createSyncHarness(`publication-cycle-from-callback`)
    const { collection } = harness
    const callbacks: Array<{
      changes: Array<string>
      visibleValue: string
      revision: number
    }> = []
    const initialRevision = collection._stateRevision
    const write = (type: `insert` | `update`, value: string) => {
      harness.sync.begin()
      harness.sync.write({ type, value: { id: 1, value } })
      harness.sync.commit()
    }
    const subscription = collection.subscribeChanges(
      (changes) => {
        callbacks.push({
          changes: changes.map((change) => change.value.value),
          visibleValue: collection.get(1)!.value,
          revision: collection._stateRevision,
        })

        if (changes[0]?.value.value === `first`) {
          const secondPublication = collection._deferPublication()
          write(`update`, `second`)
          secondPublication.publish()
        }
      },
      { includeInitialState: false },
    )

    try {
      const firstPublication = collection._deferPublication()
      write(`insert`, `first`)
      firstPublication.publish()

      expect(callbacks).toEqual([
        {
          changes: [`first`],
          visibleValue: `first`,
          revision: initialRevision + 1,
        },
        {
          changes: [`second`],
          visibleValue: `second`,
          revision: initialRevision + 2,
        },
      ])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`publishes an internal layout swap with unchanged endpoints`, async () => {
    let sync!: OrderedSync
    const collection = createCollection<OrderedRow, number>({
      id: `layout-middle-swap`,
      getKey: (row) => row.id,
      compare: (left, right) => left.rank - right.rank,
      startSync: true,
      sync: {
        sync: (ops) => {
          sync = ops
          ops.begin()
          for (let id = 1; id <= 5; id++) {
            ops.write({
              type: `insert`,
              value: { id, value: `value-${id}`, rank: id },
            })
          }
          ops.commit()
          ops.markReady()
        },
      },
    })
    const callbacks: Array<LayoutCallback> = []
    const subscription = collection.subscribeChanges(
      (changes) => {
        callbacks.push({
          changes: changes.map(({ key }) => key),
          keys: [...collection.keys()],
          values: collection.toArray.map(({ value }) => value),
          markedReceiptSettled: false,
          revision: collection._layoutRevision,
        })
      },
      { includeInitialState: false },
    )

    try {
      const revisionBeforeSwap = collection._layoutRevision
      sync.begin()
      sync.write({
        type: `update`,
        value: { id: 3, value: `value-3`, rank: 4 },
      })
      sync.write({
        type: `update`,
        value: { id: 4, value: `value-4`, rank: 3 },
      })
      sync.collection._markLayoutChange()
      expect(sync.commit()).toBe(true)

      expect([...collection.keys()]).toEqual([1, 2, 4, 3, 5])
      expect(collection._layoutRevision).toBe(revisionBeforeSwap + 1)
      expect(callbacks).toEqual([
        {
          changes: [3, 4],
          keys: [1, 2, 4, 3, 5],
          values: [`value-1`, `value-2`, `value-4`, `value-3`, `value-5`],
          markedReceiptSettled: false,
          revision: revisionBeforeSwap + 1,
        },
      ])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`publishes a parked layout mark when optimistic persistence drains it`, async () => {
    const updatePersistence = createDeferred<void>()
    let sync!: OrderedSync
    const collection = createCollection<OrderedRow, number>({
      id: `layout-prefix-normal-drain`,
      getKey: (row) => row.id,
      compare: (left, right) => left.rank - right.rank,
      startSync: true,
      sync: {
        sync: (ops) => {
          sync = ops
          installInitialOrderedRows(ops)
        },
      },
      onUpdate: () => updatePersistence.promise,
    })
    let markedReceiptSettled = false
    const callbacks: Array<LayoutCallback> = []
    const subscription = collection.subscribeChanges(
      (changes) => {
        callbacks.push({
          changes: changes.map(({ key }) => key),
          keys: [...collection.keys()],
          values: collection.toArray.map(({ value }) => value),
          markedReceiptSettled,
          revision: collection._layoutRevision,
        })
      },
      { includeInitialState: false },
    )
    const update = collection.update(2, (draft) => {
      draft.value = `optimistic-two`
    })

    try {
      sync.begin()
      sync.write({
        type: `update`,
        value: { id: 1, value: `one`, rank: 2 },
      })
      sync.collection._markLayoutChange()
      const receipt = sync.commit()
      expect(receipt).not.toBe(true)
      if (receipt !== true) {
        void receipt.then(() => {
          markedReceiptSettled = true
        })
      }

      callbacks.length = 0
      const revisionBeforeDrain = collection._layoutRevision
      await Promise.resolve()
      expect(markedReceiptSettled).toBe(false)
      expect([...collection.keys()]).toEqual([1, 2])

      updatePersistence.resolve()
      await update.when('settled')
      if (receipt !== true) await receipt

      expect([...collection.keys()]).toEqual([2, 1])
      expect(collection.toArray.map(({ value }) => value)).toEqual([
        `two`,
        `one`,
      ])
      expect(collection._layoutRevision).toBe(revisionBeforeDrain + 1)
      // Deltas form one batch; their order is not the collection's row order.
      // Assert exact membership while retaining ordered public-read assertions.
      expect(
        callbacks.map((callback) => ({
          ...callback,
          changes: [...callback.changes].sort((a, b) => a - b),
        })),
      ).toEqual([
        {
          changes: [1, 2],
          keys: [2, 1],
          values: [`two`, `one`],
          markedReceiptSettled: false,
          revision: revisionBeforeDrain + 1,
        },
      ])
      expect(markedReceiptSettled).toBe(true)
    } finally {
      updatePersistence.resolve()
      await update.when('settled').catch(() => undefined)
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`honors a parked layout mark when truncate drains its causal prefix`, async () => {
    const updatePersistence = createDeferred<void>()
    const insertPersistence = createDeferred<void>()
    let sync!: OrderedSync
    const collection = createCollection<OrderedRow, number>({
      id: `layout-prefix-truncate-drain`,
      getKey: (row) => row.id,
      compare: (left, right) => left.rank - right.rank,
      startSync: true,
      sync: {
        sync: (ops) => {
          sync = ops
          installInitialOrderedRows(ops)
        },
      },
      onUpdate: () => updatePersistence.promise,
      onInsert: () => insertPersistence.promise,
    })
    let markedReceiptSettled = false
    const callbacks: Array<LayoutCallback> = []
    const subscription = collection.subscribeChanges(
      (changes) => {
        callbacks.push({
          changes: changes.map(({ key }) => key),
          keys: [...collection.keys()],
          values: collection.toArray.map(({ value }) => value),
          markedReceiptSettled,
          revision: collection._layoutRevision,
        })
      },
      { includeInitialState: false },
    )
    const update = collection.update(1, (draft) => {
      draft.value = `optimistic-one`
    })
    let insert: ReturnType<typeof collection.insert> | undefined

    try {
      sync.begin()
      sync.write({
        type: `update`,
        value: { id: 1, value: `one`, rank: 2 },
      })
      sync.collection._markLayoutChange()
      const firstReceipt = sync.commit()
      expect(firstReceipt).not.toBe(true)
      if (firstReceipt !== true) {
        void firstReceipt.then(() => {
          markedReceiptSettled = true
        })
      }

      insert = collection.insert({
        id: 3,
        value: `optimistic-three`,
        rank: 3,
      })
      callbacks.length = 0
      const revisionBeforeDrain = collection._layoutRevision
      expect([...collection.keys()]).toEqual([1, 2, 3])

      sync.begin()
      sync.truncate()
      sync.write({
        type: `insert`,
        value: { id: 1, value: `one`, rank: 2 },
      })
      sync.write({
        type: `insert`,
        value: { id: 2, value: `two`, rank: 1 },
      })
      const truncateReceipt = sync.commit()

      expect(truncateReceipt).toBe(true)
      expect([...collection.keys()]).toEqual([2, 1, 3])
      expect(collection.toArray.map(({ value }) => value)).toEqual([
        `two`,
        `optimistic-one`,
        `optimistic-three`,
      ])
      expect(collection._layoutRevision).toBe(revisionBeforeDrain + 1)
      expect(callbacks).toEqual([
        {
          // Delete the prior public layout [1, 2, 3], not the unpublished
          // rank update's intermediate [2, 1, 3], then replay whole snapshots.
          // Each key is inserted once after the delete prefix.
          changes: [1, 2, 3, 1, 3, 2],
          keys: [2, 1, 3],
          values: [`two`, `optimistic-one`, `optimistic-three`],
          markedReceiptSettled: false,
          revision: revisionBeforeDrain + 1,
        },
      ])
      if (firstReceipt !== true) await firstReceipt
      expect(markedReceiptSettled).toBe(true)
    } finally {
      subscription.unsubscribe()
      updatePersistence.resolve()
      insertPersistence.resolve()
      await update.when('settled').catch(() => undefined)
      await insert?.when('settled').catch(() => undefined)
      await collection.cleanup()
    }
  })

  // A subscriber or a ready callback can throw while a truncate makes the
  // Collection ready. The commit must still settle every receipt it applied
  // and report the error, as it does when the Collection is already ready.
  it.each(
    // An already-ready Collection runs no ready callbacks, so only a
    // subscriber can throw there.
    [
      { alreadyReady: false, thrower: `subscriber` },
      { alreadyReady: false, thrower: `ready callback` },
      { alreadyReady: true, thrower: `subscriber` },
    ] as const,
  )(
    `settles applied receipts when a $thrower throws during a truncate (alreadyReady: $alreadyReady)`,
    async ({ alreadyReady, thrower }) => {
      const failure = new Error(`${thrower} failure`)
      const persistence = createDeferred<void>()
      let sync!: SyncOps
      const collection = createCollection<Row, number>({
        id: `truncate-ready-throw-${thrower}-${alreadyReady}`,
        getKey: (row) => row.id,
        startSync: true,
        sync: {
          sync: (ops) => {
            sync = ops
            ops.begin()
            ops.write({ type: `insert`, value: { id: 1, value: `one` } })
            ops.commit()
            if (alreadyReady) ops.markReady()
          },
        },
        onUpdate: () => persistence.promise,
      })
      await flushPromises()
      const blocker = collection.update(1, (draft) => {
        draft.value = `optimistic`
      })
      let subscription: { unsubscribe: () => void } | undefined
      try {
        sync.begin()
        sync.write({ type: `insert`, value: { id: 2, value: `two` } })
        const held = sync.commit()
        expect(held).not.toBe(true)
        let heldSettled = false
        if (held !== true)
          void held.then(
            () => (heldSettled = true),
            () => (heldSettled = true),
          )
        if (thrower === `subscriber`) {
          subscription = collection.subscribeChanges(() => {
            throw failure
          })
        } else {
          collection.onFirstReady(() => {
            throw failure
          })
        }

        sync.begin()
        sync.truncate()
        sync.write({ type: `insert`, value: { id: 3, value: `three` } })
        expect(() => sync.commit()).toThrow(failure)
        await flushPromises()

        expect(heldSettled).toBe(true)
        expect(collection.status).toBe(`ready`)
        expect(
          [...collection.state]
            .map(([key, row]) => [key, row.value] as const)
            .sort(([left], [right]) => left - right),
        ).toEqual([
          [1, `optimistic`],
          [3, `three`],
        ])
      } finally {
        subscription?.unsubscribe()
        persistence.resolve()
        await blocker.when('settled').catch(() => undefined)
        await collection.cleanup()
      }
    },
  )

  // A sync function can make the Collection ready by calling markReady or
  // by committing a truncate. If a ready callback throws during sync entry,
  // the error surfaces once the sync function returns: the sync function
  // finishes, and the Collection stays ready with the rows it committed.
  it.each([`markReady`, `truncate commit`, `truncate commit, then markReady`])(
    `defers a ready callback error until sync entry returns: %s`,
    async (entry) => {
      const failure = new Error(`ready callback failure`)
      let finished = false
      const collection = createCollection<Row, number>({
        id: `sync-entry-ready-failure-${entry}`,
        getKey: (row) => row.id,
        startSync: false,
        sync: {
          sync: (ops) => {
            ops.begin()
            if (entry !== `markReady`) ops.truncate()
            ops.write({ type: `insert`, value: { id: 1, value: `one` } })
            ops.commit()
            if (entry !== `truncate commit`) ops.markReady()
            finished = true
          },
        },
      })
      try {
        collection.onFirstReady(() => {
          throw failure
        })
        expect(() => collection.startSyncImmediate()).toThrow(failure)
        expect(finished).toBe(true)
        expect(collection.status).toBe(`ready`)
        expect([...collection.state.keys()]).toEqual([1])
      } finally {
        await collection.cleanup().catch(() => undefined)
      }
    },
  )

  it(`captures a fresh layout boundary for each reentrant causal prefix`, async () => {
    let sync!: OrderedSync
    const collection = createCollection<OrderedRow, number>({
      id: `layout-reentrant-prefixes`,
      getKey: (row) => row.id,
      compare: (left, right) => left.rank - right.rank,
      startSync: true,
      sync: {
        sync: (ops) => {
          sync = ops
          installInitialOrderedRows(ops)
        },
      },
    })
    let listenerDepth = 0
    let maxListenerDepth = 0
    let queuedRestore = false
    let innerReceipt: Promise<void> | undefined
    let innerReceiptSettled = false
    const callbacks: Array<LayoutCallback> = []
    const subscription = collection.subscribeChanges(
      (changes) => {
        listenerDepth++
        maxListenerDepth = Math.max(maxListenerDepth, listenerDepth)
        callbacks.push({
          changes: changes.map(({ key }) => key),
          keys: [...collection.keys()],
          values: collection.toArray.map(({ value }) => value),
          markedReceiptSettled: innerReceiptSettled,
          revision: collection._layoutRevision,
        })

        if (!queuedRestore) {
          queuedRestore = true
          sync.begin()
          sync.write({
            type: `update`,
            value: { id: 1, value: `one`, rank: 0 },
          })
          sync.collection._markLayoutChange()
          const receipt = sync.commit()
          if (receipt === true) {
            throw new Error(`Expected listener-created work to queue`)
          }
          innerReceipt = receipt
          void receipt.then(() => {
            innerReceiptSettled = true
          })
        }

        listenerDepth--
      },
      { includeInitialState: false },
    )

    try {
      const revisionBeforeDrain = collection._layoutRevision
      sync.begin()
      sync.write({
        type: `update`,
        value: { id: 1, value: `one`, rank: 2 },
      })
      sync.collection._markLayoutChange()
      expect(sync.commit()).toBe(true)

      expect([...collection.keys()]).toEqual([1, 2])
      expect(collection._layoutRevision).toBe(revisionBeforeDrain + 2)
      expect(callbacks).toEqual([
        {
          changes: [1],
          keys: [2, 1],
          values: [`two`, `one`],
          markedReceiptSettled: false,
          revision: revisionBeforeDrain + 1,
        },
        {
          changes: [1],
          keys: [1, 2],
          values: [`one`, `two`],
          markedReceiptSettled: false,
          revision: revisionBeforeDrain + 2,
        },
      ])
      expect(maxListenerDepth).toBe(1)
      expect(innerReceipt).toBeDefined()
      await innerReceipt
      expect(innerReceiptSettled).toBe(true)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`preserves sync work opened by a listener until it is committed`, async () => {
    const harness = createSyncHarness(`listener-opened-sync-work`)
    const { collection } = harness
    let openedInnerTransaction = false
    const batches: Array<Array<number>> = []

    const subscription = collection.subscribeChanges((changes) => {
      batches.push(changes.map((change) => change.key))
      if (!openedInnerTransaction && changes.some(({ key }) => key === 1)) {
        openedInnerTransaction = true
        stageInsert(harness.sync, { id: 2, value: `inner` })
      }
    })

    try {
      stageInsert(harness.sync, { id: 1, value: `outer` })
      harness.sync.commit()

      expect(openedInnerTransaction).toBe(true)
      expect(collection.get(2)).toBeUndefined()

      expect(() => harness.sync.commit()).not.toThrow()
      expect(collection.get(2)).toMatchObject({ id: 2, value: `inner` })
      expect(batches).toEqual([[1], [2]])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`publishes listener-committed sync work after the outer batch exactly once`, async () => {
    const harness = createSyncHarness(`listener-committed-sync-work`)
    const { collection } = harness
    const appliedKeys: Array<number> = []
    const originalSet = collection._state.syncedData.set.bind(
      collection._state.syncedData,
    )
    vi.spyOn(collection._state.syncedData, `set`).mockImplementation(
      (key, value) => {
        appliedKeys.push(key)
        return originalSet(key, value)
      },
    )
    const batches: Array<Array<number>> = []
    let listenerDepth = 0
    let maxListenerDepth = 0
    let committedInnerTransaction = false

    const subscription = collection.subscribeChanges((changes) => {
      listenerDepth++
      maxListenerDepth = Math.max(maxListenerDepth, listenerDepth)
      batches.push(changes.map((change) => change.key))

      if (!committedInnerTransaction && changes.some(({ key }) => key === 1)) {
        committedInnerTransaction = true
        stageInsert(harness.sync, { id: 2, value: `inner` })
        harness.sync.commit()
      }

      listenerDepth--
    })

    try {
      stageInsert(harness.sync, { id: 1, value: `outer` })
      harness.sync.commit()

      expect(appliedKeys).toEqual([1, 2])
      expect(batches).toEqual([[1], [2]])
      expect(maxListenerDepth).toBe(1)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`keeps callback work FIFO across committed, aborted, and open transactions`, async () => {
    const harness = createSyncHarness(`listener-sync-action-order`)
    const { collection } = harness
    const batches: Array<Array<number>> = []
    let ranListenerActions = false

    const subscription = collection.subscribeChanges((changes) => {
      batches.push(changes.map((change) => change.key))
      if (ranListenerActions || !changes.some(({ key }) => key === 1)) return
      ranListenerActions = true

      stageInsert(harness.sync, { id: 2, value: `left-open` })

      stageInsert(harness.sync, { id: 3, value: `committed` })
      harness.sync.metadata!.row.set(3, { source: `listener` })
      harness.sync.metadata!.collection.set(`listener:commit`, 3)
      harness.sync.commit()

      stageInsert(harness.sync, { id: 4, value: `aborted` })
      const controller = new AbortController()
      controller.abort()
      const abortedReceipt = harness.sync.commit(controller.signal)
      if (abortedReceipt !== true) {
        void abortedReceipt.catch(() => undefined)
      }
    })

    try {
      stageInsert(harness.sync, { id: 1, value: `outer` })
      harness.sync.commit()

      expect(collection.get(3)).toMatchObject({ id: 3, value: `committed` })
      expect(collection.get(4)).toBeUndefined()
      expect(collection._state.syncedMetadata.get(3)).toEqual({
        source: `listener`,
      })
      expect(
        collection._state.syncedCollectionMetadata.get(`listener:commit`),
      ).toBe(3)

      harness.sync.commit()
      expect(collection.get(2)).toMatchObject({ id: 2, value: `left-open` })
      expect(batches).toEqual([[1], [3], [2]])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`drains listener-committed transactions in staging order`, async () => {
    const harness = createSyncHarness(`listener-sync-fifo`)
    const { collection } = harness
    const batches: Array<Array<number>> = []
    let stagedInnerTransactions = false

    const subscription = collection.subscribeChanges((changes) => {
      batches.push(changes.map((change) => change.key))
      if (stagedInnerTransactions || !changes.some(({ key }) => key === 1)) {
        return
      }
      stagedInnerTransactions = true

      stageInsert(harness.sync, { id: 2, value: `first` })
      harness.sync.commit()
      stageInsert(harness.sync, { id: 3, value: `second` })
      harness.sync.commit()
    })

    try {
      stageInsert(harness.sync, { id: 1, value: `outer` })
      harness.sync.commit()

      expect([...collection._state.syncedData.keys()]).toEqual([1, 2, 3])
      expect(batches).toEqual([[1], [2, 3]])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`drains callback work before surfacing a listener error`, async () => {
    const harness = createSyncHarness(`throwing-sync-listener`)
    const { collection } = harness
    const failure = new Error(`listener failed`)
    const appliedKeys: Array<number> = []
    const originalSet = collection._state.syncedData.set.bind(
      collection._state.syncedData,
    )
    vi.spyOn(collection._state.syncedData, `set`).mockImplementation(
      (key, value) => {
        appliedKeys.push(key)
        return originalSet(key, value)
      },
    )
    let queuedReceipt: Promise<void> | undefined
    const subscription = collection.subscribeChanges((changes) => {
      if (!changes.some(({ key }) => key === 1)) return
      stageInsert(harness.sync, { id: 2, value: `queued` })
      const receipt = harness.sync.commit()
      if (receipt === true) {
        throw new Error(`Expected callback-created work to queue`)
      }
      queuedReceipt = receipt
      throw failure
    })

    try {
      stageInsert(harness.sync, { id: 1, value: `first` })
      expect(() => harness.sync.commit()).toThrow(failure)
      expect(collection.get(1)).toMatchObject({ id: 1, value: `first` })
      expect(collection.get(2)).toMatchObject({ id: 2, value: `queued` })
      expect(queuedReceipt).toBeDefined()
      await expect(queuedReceipt).resolves.toBeUndefined()

      stageInsert(harness.sync, { id: 3, value: `second` })
      expect(() => harness.sync.commit()).not.toThrow()

      expect(appliedKeys).toEqual([1, 2, 3])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`queues a listener truncate until the outer publication finishes`, async () => {
    const harness = createSyncHarness(`listener-sync-truncate`)
    const { collection } = harness
    const appliedKeys: Array<number> = []
    const originalSet = collection._state.syncedData.set.bind(
      collection._state.syncedData,
    )
    vi.spyOn(collection._state.syncedData, `set`).mockImplementation(
      (key, value) => {
        appliedKeys.push(key)
        return originalSet(key, value)
      },
    )
    let stagedTruncate = false
    const subscription = collection.subscribeChanges((changes) => {
      if (stagedTruncate || !changes.some(({ key }) => key === 1)) return
      stagedTruncate = true
      harness.sync.begin()
      harness.sync.truncate()
      harness.sync.write({
        type: `insert`,
        value: { id: 2, value: `replacement` },
      })
      harness.sync.commit()
    })

    try {
      stageInsert(harness.sync, { id: 1, value: `outer` })
      harness.sync.commit()

      expect(appliedKeys).toEqual([1, 2])
      expect(collection.get(1)).toBeUndefined()
      expect(collection.get(2)).toMatchObject({
        id: 2,
        value: `replacement`,
      })
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`releases subset demand from a publication callback without nested delivery`, async () => {
    let sync!: SyncOps
    const unloadSubset = vi.fn()
    const collection = createCollection<Row, number>({
      id: `listener-subset-release-row-gc`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: (ops) => {
          sync = ops
          ops.markReady()
          return {
            loadSubset: async () => {
              stageInsert(ops, { id: 2, value: `owned` })
              const receipt = ops.commit()
              if (receipt !== true) await receipt
              return
            },
            unloadSubset,
          }
        },
      },
    })
    let ownerUnsubscribed = false
    const owner = collection.subscribeChanges((changes) => {
      if (ownerUnsubscribed || !changes.some(({ key }) => key === 1)) return
      ownerUnsubscribed = true
      owner.unsubscribe()
    })
    owner.requestSnapshot({ optimizedOnly: false })
    await flushPromises()

    const batches: Array<Array<number>> = []
    let listenerDepth = 0
    let maxListenerDepth = 0
    const observer = collection.subscribeChanges(
      (changes) => {
        listenerDepth++
        maxListenerDepth = Math.max(maxListenerDepth, listenerDepth)
        batches.push(changes.map((change) => change.key))
        listenerDepth--
      },
      { includeInitialState: true },
    )
    batches.length = 0

    try {
      stageInsert(sync, { id: 1, value: `outer` })
      expect(() => sync.commit()).not.toThrow()

      expect(ownerUnsubscribed).toBe(true)
      expect(unloadSubset).toHaveBeenCalledOnce()
      expect(collection.get(2)).toMatchObject({ id: 2, value: `owned` })
      expect(batches).toEqual([[1]])
      expect(maxListenerDepth).toBe(1)
    } finally {
      owner.unsubscribe()
      observer.unsubscribe()
      await collection.cleanup()
    }
  })
})
