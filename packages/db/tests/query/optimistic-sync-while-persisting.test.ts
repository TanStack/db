import { describe, expect, test, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { createOptimisticAction } from '../../src/optimistic-action.js'
import type { SyncWhilePersistingContext } from '../../src/types.js'

type Item = {
  id: string
  value: string
}

type SyncControls = {
  begin: () => void
  write: (message: {
    type: `insert` | `update` | `delete`
    value: Item
  }) => void
  commit: () => void
  markReady: () => void
}

let collectionCounter = 0

type SetupOptions = {
  onSyncWhilePersisting?: (
    context: SyncWhilePersistingContext<string | number>,
  ) => boolean
}

function setup(options: SetupOptions = {}) {
  const { onSyncWhilePersisting = () => true } = options

  let syncBegin: SyncControls[`begin`] | undefined
  let syncWrite: SyncControls[`write`] | undefined
  let syncCommit: SyncControls[`commit`] | undefined
  let syncMarkReady: SyncControls[`markReady`] | undefined

  const source = createCollection<Item>({
    id: `optimistic-sync-source-${++collectionCounter}`,
    getKey: (item) => item.id,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        syncBegin = begin
        syncWrite = write
        syncCommit = commit
        syncMarkReady = markReady
      },
      onSyncWhilePersisting,
    },
  })

  const derived = createLiveQueryCollection({
    startSync: true,
    query: (q) => q.from({ item: source }),
    getKey: (item: Item) => item.id,
  })

  if (!syncBegin || !syncWrite || !syncCommit || !syncMarkReady) {
    throw new Error(`Sync controls not initialized`)
  }

  return {
    source,
    derived,
    sync: {
      begin: syncBegin,
      write: syncWrite,
      commit: syncCommit,
      markReady: syncMarkReady,
    },
  }
}

function createPendingOptimisticAction(source: {
  insert: (item: Item) => any
}) {
  let resolveMutation: (() => void) | undefined
  let startResolve: (() => void) | undefined
  const started = new Promise<void>((resolve) => {
    startResolve = resolve
  })

  const action = createOptimisticAction<Item>({
    onMutate: (item) => {
      source.insert(item)
    },
    mutationFn: async () => {
      return new Promise<void>((resolve) => {
        resolveMutation = resolve
        startResolve?.()
      })
    },
  })

  return {
    action,
    started,
    resolve: () => resolveMutation?.(),
  }
}

describe(`sync while optimistic transaction is persisting (onSyncWhilePersisting callback)`, () => {
  test(`shows non-conflicting synced rows immediately when callback returns true`, async () => {
    const { source, derived, sync } = setup({
      onSyncWhilePersisting: () => true,
    })
    const { action, started, resolve } = createPendingOptimisticAction(source)

    action({ id: `optimistic-1`, value: `optimistic` })
    await started

    sync.begin()
    sync.write({ type: `insert`, value: { id: `synced-1`, value: `synced` } })
    sync.commit()

    expect(derived.has(`optimistic-1`)).toBe(true)
    expect(derived.has(`synced-1`)).toBe(true)
    expect(derived.size).toBe(2)

    resolve()
  })

  test(`keeps optimistic row visible on conflicting sync`, async () => {
    const { source, derived, sync } = setup({
      onSyncWhilePersisting: () => true,
    })
    const { action, started, resolve } = createPendingOptimisticAction(source)

    action({ id: `item-1`, value: `optimistic` })
    await started

    expect(derived.get(`item-1`)?.value).toBe(`optimistic`)

    sync.begin()
    sync.write({ type: `insert`, value: { id: `item-1`, value: `synced` } })
    sync.commit()

    expect(derived.size).toBe(1)
    expect(derived.get(`item-1`)?.value).toBe(`optimistic`)

    resolve()
  })

  test(`callback receives correct context`, async () => {
    const callbackSpy = vi.fn(
      (_ctx: SyncWhilePersistingContext<string | number>) => true,
    )
    const { source, sync } = setup({ onSyncWhilePersisting: callbackSpy })
    const { action, started, resolve } = createPendingOptimisticAction(source)

    action({ id: `optimistic-1`, value: `optimistic` })
    await started

    sync.begin()
    sync.write({ type: `insert`, value: { id: `synced-1`, value: `synced` } })
    sync.write({ type: `insert`, value: { id: `synced-2`, value: `synced` } })
    sync.commit()

    expect(callbackSpy).toHaveBeenCalledTimes(1)
    const context = callbackSpy.mock
      .calls[0]![0] as unknown as SyncWhilePersistingContext<string | number>

    expect(context.pendingSyncKeys).toBeInstanceOf(Set)
    expect(context.pendingSyncKeys.has(`synced-1`)).toBe(true)
    expect(context.pendingSyncKeys.has(`synced-2`)).toBe(true)
    expect(context.pendingSyncKeys.size).toBe(2)

    expect(context.persistingKeys).toBeInstanceOf(Set)
    expect(context.persistingKeys.has(`optimistic-1`)).toBe(true)
    expect(context.persistingKeys.size).toBe(1)

    expect(context.conflictingKeys).toBeInstanceOf(Set)
    expect(context.conflictingKeys.size).toBe(0)

    expect(context.persistingTransactionCount).toBe(1)
    expect(context.isTruncate).toBe(false)

    resolve()
  })

  test(`callback receives conflicting keys correctly`, async () => {
    const callbackSpy = vi.fn(
      (_ctx: SyncWhilePersistingContext<string | number>) => true,
    )
    const { source, sync } = setup({ onSyncWhilePersisting: callbackSpy })
    const { action, started, resolve } = createPendingOptimisticAction(source)

    action({ id: `shared-key`, value: `optimistic` })
    await started

    sync.begin()
    sync.write({ type: `insert`, value: { id: `shared-key`, value: `synced` } })
    sync.write({
      type: `insert`,
      value: { id: `synced-only`, value: `synced` },
    })
    sync.commit()

    const context = callbackSpy.mock
      .calls[0]![0] as unknown as SyncWhilePersistingContext<string | number>

    expect(context.conflictingKeys.has(`shared-key`)).toBe(true)
    expect(context.conflictingKeys.size).toBe(1)
    expect(context.pendingSyncKeys.size).toBe(2)
    expect(context.persistingKeys.size).toBe(1)

    resolve()
  })

  test(`callback returning false defers sync until transaction completes`, async () => {
    const callbackSpy = vi.fn(() => false)
    const { source, derived, sync } = setup({
      onSyncWhilePersisting: callbackSpy,
    })
    const { action, started, resolve } = createPendingOptimisticAction(source)

    const transaction = action({ id: `optimistic-1`, value: `optimistic` })
    await started

    // At this point, transaction should be persisting
    expect(transaction.state).toBe(`persisting`)

    sync.begin()
    sync.write({ type: `insert`, value: { id: `synced-1`, value: `synced` } })
    sync.commit()

    // Callback should have been called once (during sync.commit)
    expect(callbackSpy).toHaveBeenCalledTimes(1)

    // Synced row should NOT be visible yet because callback returned false
    expect(derived.has(`optimistic-1`)).toBe(true)
    expect(derived.has(`synced-1`)).toBe(false)

    // Check pending sync transactions before completing
    expect(source._state.pendingSyncedTransactions.length).toBeGreaterThan(0)

    // Complete the optimistic transaction and wait for it to finish
    resolve()
    await transaction.isPersisted.promise

    // Transaction should now be completed
    expect(transaction.state).toBe(`completed`)

    // Give a tick for any async cleanup
    await new Promise((r) => setTimeout(r, 0))

    // The callback should NOT be called again (because no persisting transactions)
    // So it should still be 1 call total
    expect(callbackSpy).toHaveBeenCalledTimes(1)

    // Pending syncs should have been processed
    expect(source._state.pendingSyncedTransactions.length).toBe(0)

    // Now synced row should be visible
    expect(source.has(`synced-1`)).toBe(true)
    expect(derived.has(`synced-1`)).toBe(true)
  })

  test(`selective allow based on conflicting keys`, async () => {
    // Only allow sync if there are no conflicts
    const { source, derived, sync } = setup({
      onSyncWhilePersisting: ({ conflictingKeys }) =>
        conflictingKeys.size === 0,
    })
    const { action, started, resolve } = createPendingOptimisticAction(source)

    action({ id: `optimistic-1`, value: `optimistic` })
    await started

    // Non-conflicting sync should be allowed
    sync.begin()
    sync.write({ type: `insert`, value: { id: `synced-1`, value: `synced` } })
    sync.commit()

    expect(derived.has(`synced-1`)).toBe(true)

    // Conflicting sync should be deferred
    sync.begin()
    sync.write({
      type: `update`,
      value: { id: `optimistic-1`, value: `synced-update` },
    })
    sync.commit()

    // The optimistic value should still be visible (sync was deferred)
    expect(derived.get(`optimistic-1`)?.value).toBe(`optimistic`)

    resolve()
  })

  test(`no callback means sync is deferred while persisting (default behavior)`, async () => {
    // Setup without onSyncWhilePersisting callback
    let syncBegin: SyncControls[`begin`] | undefined
    let syncWrite: SyncControls[`write`] | undefined
    let syncCommit: SyncControls[`commit`] | undefined

    const source = createCollection<Item>({
      id: `no-callback-test-${++collectionCounter}`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit }) => {
          syncBegin = begin
          syncWrite = write
          syncCommit = commit
        },
        // No onSyncWhilePersisting callback
      },
    })

    const derived = createLiveQueryCollection({
      startSync: true,
      query: (q) => q.from({ item: source }),
      getKey: (item: Item) => item.id,
    })

    const { action, started, resolve } = createPendingOptimisticAction(source)

    const transaction = action({ id: `optimistic-1`, value: `optimistic` })
    await started

    syncBegin!()
    syncWrite!({ type: `insert`, value: { id: `synced-1`, value: `synced` } })
    syncCommit!()

    // Without callback, sync should be deferred
    expect(derived.has(`optimistic-1`)).toBe(true)
    expect(derived.has(`synced-1`)).toBe(false)

    resolve()
    await transaction.isPersisted.promise

    // After transaction completes, sync should apply
    expect(derived.has(`synced-1`)).toBe(true)
  })

  test(`callback is not called when no persisting transactions`, async () => {
    const callbackSpy = vi.fn(() => true)
    const { sync } = setup({ onSyncWhilePersisting: callbackSpy })

    // Sync without any pending optimistic transaction
    sync.begin()
    sync.write({ type: `insert`, value: { id: `synced-1`, value: `synced` } })
    sync.commit()

    // Callback should not be called since there's no persisting transaction
    expect(callbackSpy).not.toHaveBeenCalled()
  })

  test(`multiple persisting transactions are counted correctly`, async () => {
    const callbackSpy = vi.fn(
      (_ctx: SyncWhilePersistingContext<string | number>) => true,
    )
    const { source, sync } = setup({ onSyncWhilePersisting: callbackSpy })

    // Create two pending optimistic actions
    const action1 = createPendingOptimisticAction(source)
    const action2 = createPendingOptimisticAction(source)

    action1.action({ id: `optimistic-1`, value: `optimistic` })
    await action1.started

    action2.action({ id: `optimistic-2`, value: `optimistic` })
    await action2.started

    sync.begin()
    sync.write({ type: `insert`, value: { id: `synced-1`, value: `synced` } })
    sync.commit()

    const context = callbackSpy.mock
      .calls[0]![0] as unknown as SyncWhilePersistingContext<string | number>
    expect(context.persistingTransactionCount).toBe(2)
    expect(context.persistingKeys.has(`optimistic-1`)).toBe(true)
    expect(context.persistingKeys.has(`optimistic-2`)).toBe(true)

    action1.resolve()
    action2.resolve()
  })
})
