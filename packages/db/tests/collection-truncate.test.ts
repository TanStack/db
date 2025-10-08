import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createCollection } from "../src/collection/index.js"
import type { SyncConfig } from "../src/types"

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
      (e) => e.type === `insert` && e.key === 3
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
      (e) => e.type === `insert` && e.key === 1
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
})
