import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import type { LoadSubsetOptions, SyncConfig } from '../src/types'

describe(`Collection truncate operations`, () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it(`should preserve optimistic inserts when truncate completes before async mutation handler`, async () => {
    const changeEvents: Array<any> = []
    let syncOps:
      | Parameters<SyncConfig<{ id: number; value: string }, number>[`sync`]>[0]
      | undefined

    const collection = createCollection<{ id: number; value: string }, number>({
      id: `truncate-with-optimistic`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: (cfg) => {
          syncOps = cfg
          cfg.begin()
          cfg.write({ type: `insert`, value: { id: 1, value: `initial-1` } })
          cfg.write({ type: `insert`, value: { id: 2, value: `initial-2` } })
          cfg.commit()
          cfg.markReady()
        },
      },
      onInsert: async ({ transaction }) => {
        await vi.advanceTimersByTimeAsync(50)
        syncOps!.begin()
        for (const mutation of transaction.mutations) {
          syncOps!.write({
            type: `insert`,
            value: mutation.modified,
          })
        }
        syncOps!.commit()
      },
    })

    collection.subscribeChanges((changes) => changeEvents.push(...changes), {
      includeInitialState: true,
    })

    await collection.stateWhenReady()
    expect(collection.state.size).toBe(2)
    changeEvents.length = 0

    // Start optimistic insert
    const tx = collection.insert({ id: 3, value: `new-item` })

    expect(changeEvents.length).toBe(1)
    expect(changeEvents[0]).toEqual({
      type: `insert`,
      key: 3,
      value: { id: 3, value: `new-item` },
    })

    changeEvents.length = 0

    // Truncate before onInsert completes
    syncOps!.begin()
    syncOps!.truncate()
    syncOps!.write({ type: `insert`, value: { id: 1, value: `initial-1` } })
    syncOps!.write({ type: `insert`, value: { id: 2, value: `initial-2` } })
    syncOps!.commit()

    await tx.isPersisted.promise

    // Verify final state includes all items
    expect(collection.state.size).toBe(3)
    expect(collection.state.get(1)).toEqual({ id: 1, value: `initial-1` })
    expect(collection.state.get(2)).toEqual({ id: 2, value: `initial-2` })
    expect(collection.state.get(3)).toEqual({ id: 3, value: `new-item` })

    // Verify only one insert event for the optimistic item
    const key3Inserts = changeEvents.filter(
      (e) => e.type === `insert` && e.key === 3,
    )
    expect(key3Inserts.length).toBe(1)
  })

  it(`should preserve optimistic inserts when mutation handler completes during truncate processing`, async () => {
    const changeEvents: Array<any> = []
    let syncOps:
      | Parameters<SyncConfig<{ id: number; value: string }, number>[`sync`]>[0]
      | undefined

    const collection = createCollection<{ id: number; value: string }, number>({
      id: `truncate-during-mutation`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: (cfg) => {
          syncOps = cfg
          cfg.begin()
          cfg.write({ type: `insert`, value: { id: 1, value: `initial-1` } })
          cfg.commit()
          cfg.markReady()
        },
      },
      onInsert: async ({ transaction }) => {
        await vi.advanceTimersByTimeAsync(10)
        syncOps!.begin()
        for (const mutation of transaction.mutations) {
          syncOps!.write({
            type: `insert`,
            value: mutation.modified,
          })
        }
        syncOps!.commit()
      },
    })

    collection.subscribeChanges((changes) => changeEvents.push(...changes))
    await collection.stateWhenReady()
    changeEvents.length = 0

    const tx = collection.insert({ id: 2, value: `new-item` })

    changeEvents.length = 0

    syncOps!.begin()
    syncOps!.truncate()
    syncOps!.write({ type: `insert`, value: { id: 1, value: `initial-1` } })

    await tx.isPersisted.promise

    syncOps!.commit()

    // Both items should be present in final state
    expect(collection.state.size).toBe(2)
    expect(collection.state.has(1)).toBe(true)
    expect(collection.state.has(2)).toBe(true)
    expect(collection.state.get(2)).toEqual({ id: 2, value: `new-item` })
  })

  it(`should handle truncate on empty collection followed by mutation sync`, async () => {
    const changeEvents: Array<any> = []
    let syncOps:
      | Parameters<SyncConfig<{ id: number; value: string }, number>[`sync`]>[0]
      | undefined

    const collection = createCollection<{ id: number; value: string }, number>({
      id: `truncate-empty-collection`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: (cfg) => {
          syncOps = cfg
          cfg.begin()
          cfg.commit()
          cfg.markReady()
        },
      },
      onInsert: async ({ transaction }) => {
        await vi.advanceTimersByTimeAsync(100)
        syncOps!.begin()
        for (const mutation of transaction.mutations) {
          syncOps!.write({
            type: `insert`,
            value: mutation.modified,
          })
        }
        syncOps!.commit()
      },
    })

    collection.subscribeChanges((changes) => changeEvents.push(...changes))
    await collection.stateWhenReady()

    const tx = collection.insert({ id: 1, value: `user-item` })

    expect(changeEvents.length).toBe(1)
    expect(changeEvents[0]).toEqual({
      type: `insert`,
      key: 1,
      value: { id: 1, value: `user-item` },
    })

    changeEvents.length = 0

    // Truncate before mutation handler completes
    syncOps!.begin()
    syncOps!.truncate()
    syncOps!.commit()

    await tx.isPersisted.promise

    // Item should be present in final state
    expect(collection.state.get(1)).toEqual({ id: 1, value: `user-item` })

    // Should not have duplicate insert events
    const insertCount = changeEvents.filter(
      (e) => e.type === `insert` && e.key === 1,
    ).length
    expect(insertCount).toBeLessThanOrEqual(1)
  })

  it(`should emit delete events for optimistic-only data during truncate`, async () => {
    const changeEvents: Array<any> = []
    let syncOps:
      | Parameters<SyncConfig<{ id: number; value: string }, number>[`sync`]>[0]
      | undefined
    let resolveOnInsert: (() => void) | undefined

    const collection = createCollection<{ id: number; value: string }, number>({
      id: `truncate-optimistic-only`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: (cfg) => {
          syncOps = cfg
          cfg.begin()
          cfg.commit()
          cfg.markReady()
        },
      },
      onInsert: async () => {
        // Keep promise pending until we explicitly resolve it
        await new Promise<void>((resolve) => {
          resolveOnInsert = resolve
        })
        // Don't sync - keep it optimistic only
      },
    })

    collection.subscribeChanges((changes) => changeEvents.push(...changes))
    await collection.stateWhenReady()

    const tx = collection.insert({ id: 1, value: `optimistic-only` })

    expect(collection.state.size).toBe(1)
    expect(changeEvents.length).toBe(1)
    expect(changeEvents[0]).toEqual({
      type: `insert`,
      key: 1,
      value: { id: 1, value: `optimistic-only` },
    })

    changeEvents.length = 0

    // Truncate while onInsert is still pending
    syncOps!.begin()
    syncOps!.truncate()
    syncOps!.commit()

    const deleteEvents = changeEvents.filter((e) => e.type === `delete`)
    const insertEvents = changeEvents.filter((e) => e.type === `insert`)

    // Should emit delete event for the optimistic item
    expect(deleteEvents.length).toBe(1)
    expect(deleteEvents[0]).toEqual({
      type: `delete`,
      key: 1,
      value: { id: 1, value: `optimistic-only` },
    })

    // Then re-insert the preserved optimistic item
    expect(insertEvents.length).toBe(1)
    expect(insertEvents[0]).toEqual({
      type: `insert`,
      key: 1,
      value: { id: 1, value: `optimistic-only` },
    })

    // Now explicitly complete the onInsert
    resolveOnInsert!()
    await tx.isPersisted.promise
  })

  it(`should preserve optimistic inserts started after truncate begins`, async () => {
    const changeEvents: Array<any> = []
    let syncOps:
      | Parameters<SyncConfig<{ id: number; value: string }, number>[`sync`]>[0]
      | undefined
    const onInsertResolvers: Array<() => void> = []

    const collection = createCollection<{ id: number; value: string }, number>({
      id: `truncate-late-optimistic`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: (cfg) => {
          syncOps = cfg
          cfg.begin()
          cfg.write({ type: `insert`, value: { id: 1, value: `server-item` } })
          cfg.commit()
          cfg.markReady()
        },
      },
      onInsert: async ({ transaction }) => {
        await new Promise<void>((resolve) => {
          onInsertResolvers.push(resolve)
        })
        syncOps!.begin()
        for (const mutation of transaction.mutations) {
          syncOps!.write({
            type: `insert`,
            value: mutation.modified,
          })
        }
        syncOps!.commit()
      },
    })

    collection.subscribeChanges((changes) => changeEvents.push(...changes))
    await collection.stateWhenReady()
    changeEvents.length = 0

    syncOps!.begin()
    syncOps!.truncate()
    syncOps!.write({ type: `insert`, value: { id: 1, value: `server-item` } })

    const lateTx = collection.insert({
      id: 2,
      value: `late-optimistic`,
    })

    expect(collection.state.has(2)).toBe(true)

    syncOps!.commit()

    expect(collection.state.size).toBe(2)
    expect(collection.state.has(1)).toBe(true)
    expect(collection.state.get(1)).toEqual({ id: 1, value: `server-item` })
    expect(collection.state.has(2)).toBe(true)
    expect(collection.state.get(2)).toEqual({
      id: 2,
      value: `late-optimistic`,
    })

    // Clean up the pending optimistic transactions
    while (onInsertResolvers.length > 0) {
      onInsertResolvers.pop()!()
    }
    await lateTx.isPersisted.promise
  })

  it(`should preserve all optimistic inserts when truncate occurs during async mutation handler`, async () => {
    const changeEvents: Array<any> = []
    let syncOps:
      | Parameters<SyncConfig<{ id: number; value: string }, number>[`sync`]>[0]
      | undefined

    const collection = createCollection<{ id: number; value: string }, number>({
      id: `truncate-preserve-optimistic`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: (cfg) => {
          syncOps = cfg
          cfg.begin()
          cfg.write({ type: `insert`, value: { id: 1, value: `server-item` } })
          cfg.commit()
          cfg.markReady()
        },
      },
      onInsert: async ({ transaction }) => {
        await vi.advanceTimersByTimeAsync(50)
        syncOps!.begin()
        for (const mutation of transaction.mutations) {
          syncOps!.write({
            type: `insert`,
            value: mutation.modified,
          })
        }
        syncOps!.commit()
      },
    })

    collection.subscribeChanges((changes) => changeEvents.push(...changes))
    await collection.stateWhenReady()

    expect(collection.state.size).toBe(1)
    changeEvents.length = 0

    const tx = collection.insert({ id: 2, value: `optimistic-item` })

    expect(collection.state.size).toBe(2)
    expect(changeEvents.length).toBe(1)
    changeEvents.length = 0

    // Truncate before mutation handler completes
    syncOps!.begin()
    syncOps!.truncate()
    // Server re-inserts item 1 but not item 2
    syncOps!.write({ type: `insert`, value: { id: 1, value: `server-item` } })
    syncOps!.commit()

    await tx.isPersisted.promise

    // Both items should be present in final state
    expect(collection.state.size).toBe(2)
    expect(collection.state.has(1)).toBe(true)
    expect(collection.state.has(2)).toBe(true)
    expect(collection.state.get(2)).toEqual({ id: 2, value: `optimistic-item` })
  })

  it(`should preserve optimistic delete when transaction still active during truncate`, async () => {
    let syncOps:
      | Parameters<SyncConfig<{ id: number; value: string }, number>[`sync`]>[0]
      | undefined
    const onDeleteResolvers: Array<() => void> = []

    const collection = createCollection<{ id: number; value: string }, number>({
      id: `truncate-optimistic-delete-active`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: (cfg) => {
          syncOps = cfg
          cfg.begin()
          cfg.write({ type: `insert`, value: { id: 1, value: `item-1` } })
          cfg.write({ type: `insert`, value: { id: 2, value: `item-2` } })
          cfg.commit()
          cfg.markReady()
        },
      },
      onDelete: async () => {
        await new Promise<void>((resolve) => onDeleteResolvers.push(resolve))
      },
    })

    await collection.stateWhenReady()

    expect(collection.state.size).toBe(2)

    // Optimistically delete item 1 (handler stays pending)
    const deleteTx = collection.delete(1)

    // Verify optimistic delete is applied
    expect(collection.state.size).toBe(1)
    expect(collection.state.has(1)).toBe(false)
    expect(collection._state.optimisticDeletes.has(1)).toBe(true)

    // Truncate while delete transaction is still active
    syncOps!.begin()
    syncOps!.truncate()
    // Server re-inserts both items (doesn't know about the delete yet)
    syncOps!.write({ type: `insert`, value: { id: 1, value: `item-1` } })
    syncOps!.write({ type: `insert`, value: { id: 2, value: `item-2` } })
    syncOps!.commit()

    // Item 1 should still be deleted (optimistic delete preserved from snapshot)
    expect(collection.state.size).toBe(1)
    expect(collection.state.has(1)).toBe(false)
    expect(collection.state.has(2)).toBe(true)
    expect(collection._state.optimisticDeletes.has(1)).toBe(true)

    // Clean up
    onDeleteResolvers.forEach((r) => r())
    await deleteTx.isPersisted.promise
  })

  it(`should preserve optimistic value over server value when transaction active during truncate`, async () => {
    const changeEvents: Array<any> = []
    let syncOps:
      | Parameters<SyncConfig<{ id: number; value: string }, number>[`sync`]>[0]
      | undefined
    const onUpdateResolvers: Array<() => void> = []

    const collection = createCollection<{ id: number; value: string }, number>({
      id: `truncate-optimistic-vs-server`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: (cfg) => {
          syncOps = cfg
          cfg.begin()
          cfg.write({
            type: `insert`,
            value: { id: 1, value: `server-value-1` },
          })
          cfg.commit()
          cfg.markReady()
        },
      },
      onUpdate: async () => {
        await new Promise<void>((resolve) => onUpdateResolvers.push(resolve))
      },
    })

    collection.subscribeChanges((changes) => changeEvents.push(...changes))
    await collection.stateWhenReady()

    expect(collection.state.get(1)).toEqual({ id: 1, value: `server-value-1` })
    changeEvents.length = 0

    // Optimistically update item 1 (handler stays pending)
    const updateTx = collection.update(1, (draft) => {
      draft.value = `optimistic-value`
    })

    expect(collection.state.get(1)).toEqual({
      id: 1,
      value: `optimistic-value`,
    })
    changeEvents.length = 0

    // Truncate while update transaction is still active
    syncOps!.begin()
    syncOps!.truncate()
    // Server re-inserts with a DIFFERENT value
    syncOps!.write({
      type: `insert`,
      value: { id: 1, value: `server-value-2` },
    })
    syncOps!.commit()

    // Optimistic value should win (client intent preserved)
    expect(collection.state.get(1)).toEqual({
      id: 1,
      value: `optimistic-value`,
    })

    // Clean up
    onUpdateResolvers.forEach((r) => r())
    await updateTx.isPersisted.promise
  })

  it(`should handle multiple consecutive truncate operations`, async () => {
    const changeEvents: Array<any> = []
    let syncOps:
      | Parameters<SyncConfig<{ id: number; value: string }, number>[`sync`]>[0]
      | undefined
    const onInsertResolvers: Array<() => void> = []

    const collection = createCollection<{ id: number; value: string }, number>({
      id: `truncate-consecutive`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: (cfg) => {
          syncOps = cfg
          cfg.begin()
          cfg.write({ type: `insert`, value: { id: 1, value: `initial` } })
          cfg.commit()
          cfg.markReady()
        },
      },
      onInsert: async () => {
        await new Promise<void>((resolve) => onInsertResolvers.push(resolve))
      },
    })

    collection.subscribeChanges((changes) => changeEvents.push(...changes))
    await collection.stateWhenReady()

    expect(collection.state.size).toBe(1)
    changeEvents.length = 0

    // First optimistic insert (stays pending)
    const tx1 = collection.insert({ id: 2, value: `optimistic-A` })
    expect(collection.state.size).toBe(2)

    // First truncate (item 2 should be preserved because tx1 is still active)
    syncOps!.begin()
    syncOps!.truncate()
    syncOps!.write({ type: `insert`, value: { id: 1, value: `initial` } })
    syncOps!.commit()

    expect(collection.state.size).toBe(2)
    expect(collection.state.has(2)).toBe(true)

    changeEvents.length = 0

    // Second optimistic insert (stays pending)
    const tx2 = collection.insert({ id: 3, value: `optimistic-B` })
    expect(collection.state.size).toBe(3)

    // Second truncate (both items 2 and 3 should be preserved)
    syncOps!.begin()
    syncOps!.truncate()
    syncOps!.write({ type: `insert`, value: { id: 1, value: `initial` } })
    syncOps!.commit()

    // Both optimistic items should be preserved
    expect(collection.state.size).toBe(3)
    expect(collection.state.has(2)).toBe(true)
    expect(collection.state.has(3)).toBe(true)

    // Clean up
    onInsertResolvers.forEach((r) => r())
    await Promise.all([tx1.isPersisted.promise, tx2.isPersisted.promise])
  })

  it(`should handle new mutation on same key after truncate snapshot`, async () => {
    const changeEvents: Array<any> = []
    let syncOps:
      | Parameters<SyncConfig<{ id: number; value: string }, number>[`sync`]>[0]
      | undefined
    const onUpdateResolvers: Array<() => void> = []

    const collection = createCollection<{ id: number; value: string }, number>({
      id: `truncate-same-key-mutation`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: (cfg) => {
          syncOps = cfg
          cfg.begin()
          cfg.write({ type: `insert`, value: { id: 1, value: `initial` } })
          cfg.commit()
          cfg.markReady()
        },
      },
      onUpdate: async () => {
        await new Promise<void>((resolve) => onUpdateResolvers.push(resolve))
      },
    })

    collection.subscribeChanges((changes) => changeEvents.push(...changes))
    await collection.stateWhenReady()

    changeEvents.length = 0

    // First optimistic update
    const tx1 = collection.update(1, (draft) => {
      draft.value = `value-1`
    })

    expect(collection.state.get(1)).toEqual({ id: 1, value: `value-1` })

    // Truncate is called (snapshot captures value-1)
    syncOps!.begin()
    syncOps!.truncate()

    // BEFORE commit, user makes another update to the same key
    const tx2 = collection.update(1, (draft) => {
      draft.value = `value-2`
    })

    expect(collection.state.get(1)).toEqual({ id: 1, value: `value-2` })

    // Now commit the truncate
    syncOps!.write({ type: `insert`, value: { id: 1, value: `initial` } })
    syncOps!.commit()

    // Should show value-2 (newest intent wins)
    expect(collection.state.get(1)).toEqual({ id: 1, value: `value-2` })

    // Clean up
    onUpdateResolvers.forEach((r) => r())
    await Promise.all([tx1.isPersisted.promise, tx2.isPersisted.promise])
  })

  it(`should handle transaction completing between truncate and commit`, async () => {
    const changeEvents: Array<any> = []
    let syncOps:
      | Parameters<SyncConfig<{ id: number; value: string }, number>[`sync`]>[0]
      | undefined
    let onInsertResolver: (() => void) | null = null

    const collection = createCollection<{ id: number; value: string }, number>({
      id: `truncate-transaction-completes`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: (cfg) => {
          syncOps = cfg
          cfg.begin()
          cfg.write({ type: `insert`, value: { id: 1, value: `initial` } })
          cfg.commit()
          cfg.markReady()
        },
      },
      onInsert: async () => {
        await new Promise<void>((resolve) => {
          onInsertResolver = resolve
        })
      },
    })

    collection.subscribeChanges((changes) => changeEvents.push(...changes))
    await collection.stateWhenReady()

    changeEvents.length = 0

    // Optimistic insert
    const tx = collection.insert({ id: 2, value: `optimistic` })

    expect(collection.state.size).toBe(2)
    expect(collection.state.has(2)).toBe(true)

    // Truncate is called (snapshot captures item 2)
    syncOps!.begin()
    syncOps!.truncate()

    // Transaction completes BEFORE commit
    onInsertResolver!()
    await tx.isPersisted.promise

    // Now commit the truncate
    syncOps!.write({ type: `insert`, value: { id: 1, value: `initial` } })
    syncOps!.commit()

    // Item 2 should still be present (preserved from snapshot)
    expect(collection.state.size).toBe(2)
    expect(collection.state.has(2)).toBe(true)
    expect(collection.state.get(2)).toEqual({ id: 2, value: `optimistic` })
  })

  it(`should buffer subscription changes during truncate until loadSubset refetch completes`, async () => {
    // This test verifies that when a truncate occurs:
    // 1. The subscription buffers delete events from the truncate
    // 2. The subscription re-requests its previously loaded subsets
    // 3. Insert events from the refetch are also buffered
    // 4. All buffered events are emitted together when loadSubset completes
    // This prevents a flash of missing content during must-refetch scenarios

    const changeEvents: Array<any> = []
    let syncOps:
      | Parameters<SyncConfig<{ id: number; value: string }, number>[`sync`]>[0]
      | undefined
    let loadSubsetResolver: (() => void) | undefined
    let loadSubsetCallCount = 0

    const collection = createCollection<{ id: number; value: string }, number>({
      id: `truncate-buffering-test`,
      getKey: (item) => item.id,
      startSync: true,
      syncMode: `on-demand`,
      sync: {
        sync: (cfg) => {
          syncOps = cfg
          cfg.markReady()

          return {
            loadSubset: (_options: LoadSubsetOptions) => {
              loadSubsetCallCount++

              // Return a promise that we control
              return new Promise<void>((resolve) => {
                loadSubsetResolver = () => {
                  // When resolved, write some data
                  cfg.begin()
                  cfg.write({
                    type: `insert`,
                    value: { id: 1, value: `refetched-1` },
                  })
                  cfg.write({
                    type: `insert`,
                    value: { id: 2, value: `refetched-2` },
                  })
                  cfg.commit()
                  resolve()
                }
              })
            },
          }
        },
      },
    })

    await collection.stateWhenReady()

    // Subscribe with includeInitialState to trigger loadSubset
    const subscription = collection.subscribeChanges(
      (changes) => {
        changeEvents.push(...changes)
      },
      {
        includeInitialState: true,
      },
    )

    // Initially empty, waiting for loadSubset
    expect(changeEvents.length).toBe(0)
    expect(loadSubsetCallCount).toBe(1)

    // Resolve the first loadSubset to get initial data
    loadSubsetResolver!()
    await vi.waitFor(() => expect(changeEvents.length).toBe(2))

    // Verify initial data arrived
    expect(changeEvents).toEqual([
      { type: `insert`, key: 1, value: { id: 1, value: `refetched-1` } },
      { type: `insert`, key: 2, value: { id: 2, value: `refetched-2` } },
    ])

    // Clear events for next phase
    changeEvents.length = 0
    loadSubsetCallCount = 0

    // Now trigger a truncate (simulating must-refetch)
    syncOps!.begin()
    syncOps!.truncate()
    syncOps!.commit()

    // The truncate event should trigger the subscription to buffer and re-request
    // loadSubset should be called again
    await vi.waitFor(() => expect(loadSubsetCallCount).toBe(1))

    // Changes should be buffered - subscriber should NOT see deletes yet
    // (The subscription is buffering until loadSubset completes)
    expect(changeEvents.length).toBe(0)

    // Now resolve the loadSubset - this should flush the buffer
    loadSubsetResolver!()

    // Wait for buffered events to be flushed
    await vi.waitFor(() => expect(changeEvents.length).toBeGreaterThan(0))

    // Verify we got all events in one batch (deletes + inserts)
    // The subscription should have received:
    // - Delete events for the old data (from truncate)
    // - Insert events for the new data (from refetch)
    const deletes = changeEvents.filter((e) => e.type === `delete`)
    const inserts = changeEvents.filter((e) => e.type === `insert`)

    expect(deletes.length).toBe(2) // Deleted the old items
    expect(inserts.length).toBe(2) // Inserted the refetched items

    // Verify final state is correct
    expect(collection.state.size).toBe(2)
    expect(collection.state.get(1)).toEqual({ id: 1, value: `refetched-1` })
    expect(collection.state.get(2)).toEqual({ id: 2, value: `refetched-2` })

    subscription.unsubscribe()
  })

  it(`should not buffer changes when there are no subsets to reload`, async () => {
    // When a subscription has no previously loaded subsets,
    // it should not enter buffering mode during truncate

    const changeEvents: Array<any> = []
    let syncOps:
      | Parameters<SyncConfig<{ id: number; value: string }, number>[`sync`]>[0]
      | undefined

    const collection = createCollection<{ id: number; value: string }, number>({
      id: `truncate-no-buffer-test`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: (cfg) => {
          syncOps = cfg
          cfg.begin()
          cfg.write({ type: `insert`, value: { id: 1, value: `initial` } })
          cfg.commit()
          cfg.markReady()
        },
      },
    })

    await collection.stateWhenReady()

    // Subscribe WITHOUT includeInitialState - no loadSubset is called
    collection.subscribeChanges((changes) => {
      changeEvents.push(...changes)
    })

    // No initial events since includeInitialState is false
    expect(changeEvents.length).toBe(0)

    // Trigger truncate
    syncOps!.begin()
    syncOps!.truncate()
    syncOps!.write({
      type: `insert`,
      value: { id: 1, value: `after-truncate` },
    })
    syncOps!.commit()

    // Since there were no loaded subsets, changes should be emitted immediately
    // (no buffering because there's nothing to refetch)
    expect(changeEvents.length).toBeGreaterThan(0)
  })

  it(`should handle unsubscribe during truncate buffering`, async () => {
    // Verifies that unsubscribing while buffering cleans up properly

    let syncOps:
      | Parameters<SyncConfig<{ id: number; value: string }, number>[`sync`]>[0]
      | undefined
    let loadSubsetResolver: (() => void) | undefined

    const collection = createCollection<{ id: number; value: string }, number>({
      id: `truncate-unsubscribe-during-buffer`,
      getKey: (item) => item.id,
      startSync: true,
      syncMode: `on-demand`,
      sync: {
        sync: (cfg) => {
          syncOps = cfg
          cfg.markReady()

          return {
            loadSubset: (_options: LoadSubsetOptions) => {
              return new Promise<void>((resolve) => {
                loadSubsetResolver = () => {
                  cfg.begin()
                  cfg.write({
                    type: `insert`,
                    value: { id: 1, value: `data` },
                  })
                  cfg.commit()
                  resolve()
                }
              })
            },
          }
        },
      },
    })

    await collection.stateWhenReady()

    const changeEvents: Array<any> = []
    const subscription = collection.subscribeChanges(
      (changes) => {
        changeEvents.push(...changes)
      },
      { includeInitialState: true },
    )

    // Resolve initial load
    loadSubsetResolver!()
    await vi.waitFor(() => expect(changeEvents.length).toBe(1))
    changeEvents.length = 0

    // Trigger truncate
    syncOps!.begin()
    syncOps!.truncate()
    syncOps!.commit()

    // Unsubscribe before loadSubset completes
    subscription.unsubscribe()

    // Resolve the loadSubset - should not cause errors
    loadSubsetResolver!()

    // Give it time to process
    await vi.advanceTimersByTimeAsync(10)

    // No additional events should have been emitted to the unsubscribed callback
    expect(changeEvents.length).toBe(0)
  })

  it(`should emit delete events after truncate when loadedInitialState was true`, async () => {
    // This test specifically validates the edge case where:
    // 1. requestSnapshot() is called without options (sets loadedInitialState = true)
    // 2. When loadedInitialState is true, trackSentKeys early-returns, leaving sentKeys empty
    // 3. On truncate, we must populate sentKeys BEFORE setting loadedInitialState = false
    //    Otherwise, delete events would be filtered out by filterAndFlipChanges
    //
    // This is the scenario the reviewer identified where sentKeys could be empty.

    const changeEvents: Array<any> = []
    let syncOps:
      | Parameters<SyncConfig<{ id: number; value: string }, number>[`sync`]>[0]
      | undefined
    let loadSubsetResolver: (() => void) | undefined
    let loadSubsetCallCount = 0

    const collection = createCollection<{ id: number; value: string }, number>({
      id: `truncate-loadedInitialState-test`,
      getKey: (item) => item.id,
      startSync: true,
      syncMode: `on-demand`,
      sync: {
        sync: (cfg) => {
          syncOps = cfg
          cfg.markReady()

          return {
            loadSubset: (_options: LoadSubsetOptions) => {
              loadSubsetCallCount++

              return new Promise<void>((resolve) => {
                loadSubsetResolver = () => {
                  cfg.begin()
                  cfg.write({
                    type: `insert`,
                    value: { id: 1, value: `item-1` },
                  })
                  cfg.write({
                    type: `insert`,
                    value: { id: 2, value: `item-2` },
                  })
                  cfg.commit()
                  resolve()
                }
              })
            },
          }
        },
      },
    })

    await collection.stateWhenReady()

    // Create subscription WITHOUT includeInitialState
    // Then manually call requestSnapshot() without options to set loadedInitialState = true
    const subscription = collection.subscribeChanges((changes) => {
      changeEvents.push(...changes)
    })

    // Manually trigger requestSnapshot() without options
    // This sets loadedInitialState = true and sentKeys stays empty
    // (This mimics the lazy join fallback path in joins.ts line 310)
    subscription.requestSnapshot()
    expect(loadSubsetCallCount).toBe(1)

    // Resolve the loadSubset promise
    loadSubsetResolver!()
    await vi.waitFor(() => expect(changeEvents.length).toBe(2))

    // Verify initial data arrived
    expect(changeEvents[0]).toMatchObject({ type: `insert`, key: 1 })
    expect(changeEvents[1]).toMatchObject({ type: `insert`, key: 2 })

    changeEvents.length = 0
    const previousLoadSubsetCount = loadSubsetCallCount

    // Now trigger a truncate
    syncOps!.begin()
    syncOps!.truncate()
    syncOps!.commit()

    // Wait for loadSubset to be called again
    await vi.waitFor(() =>
      expect(loadSubsetCallCount).toBeGreaterThan(previousLoadSubsetCount),
    )

    // Resolve the new loadSubset promise
    loadSubsetResolver!()

    // Wait for events to be emitted
    await vi.waitFor(() => expect(changeEvents.length).toBeGreaterThan(0))

    // The key assertion: we should have received delete events
    // Without the fix, sentKeys would be empty and deletes would be filtered out
    const deletes = changeEvents.filter((e) => e.type === `delete`)
    expect(deletes.length).toBe(2) // Must have delete events!

    subscription.unsubscribe()
  })

  it(`should buffer truncate deletes even when loadSubset is synchronous`, async () => {
    // This test verifies that even when loadSubset returns synchronously (true),
    // we still capture the truncate delete events in the buffer.
    // The truncate event is emitted BEFORE delete events are sent, so if we
    // flush immediately, we'd miss the deletes.

    const changeEvents: Array<any> = []
    let syncOps:
      | Parameters<SyncConfig<{ id: number; value: string }, number>[`sync`]>[0]
      | undefined

    const collection = createCollection<{ id: number; value: string }, number>({
      id: `truncate-sync-loadSubset-test`,
      getKey: (item) => item.id,
      startSync: true,
      syncMode: `on-demand`,
      sync: {
        sync: (cfg) => {
          syncOps = cfg
          cfg.markReady()

          return {
            // loadSubset returns true (synchronous) - data already available
            loadSubset: (_options: LoadSubsetOptions) => {
              // Synchronously write data
              cfg.begin()
              cfg.write({
                type: `insert`,
                value: { id: 1, value: `sync-item-1` },
              })
              cfg.write({
                type: `insert`,
                value: { id: 2, value: `sync-item-2` },
              })
              cfg.commit()
              return true // Synchronous return
            },
          }
        },
      },
    })

    await collection.stateWhenReady()

    // Subscribe with includeInitialState to trigger loadSubset
    const subscription = collection.subscribeChanges(
      (changes) => {
        changeEvents.push(...changes)
      },
      { includeInitialState: true },
    )

    // Wait for initial data
    await vi.waitFor(() => expect(changeEvents.length).toBe(2))
    expect(collection.state.size).toBe(2)

    changeEvents.length = 0

    // Trigger truncate - loadSubset will return synchronously
    syncOps!.begin()
    syncOps!.truncate()
    syncOps!.commit()

    // Wait for events to settle
    await vi.advanceTimersByTimeAsync(10)

    // We should have received delete events even though loadSubset was sync
    const deletes = changeEvents.filter((e) => e.type === `delete`)
    const inserts = changeEvents.filter((e) => e.type === `insert`)

    expect(deletes.length).toBe(2) // Should have 2 deletes
    expect(inserts.length).toBe(2) // Should have 2 inserts

    // Verify collection state is correct
    expect(collection.state.size).toBe(2)
    expect(collection.state.get(1)).toEqual({ id: 1, value: `sync-item-1` })
    expect(collection.state.get(2)).toEqual({ id: 2, value: `sync-item-2` })

    subscription.unsubscribe()
  })
})
