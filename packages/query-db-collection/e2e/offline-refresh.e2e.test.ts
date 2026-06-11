/**
 * Integration test: offline transactions + query collection refresh
 *
 * Verifies that a query-backed collection does not revert to stale server
 * state when coming back online with pending offline transactions.
 */

import { describe, expect, it, vi } from 'vitest'
import { createCollection, BTreeIndex } from '@tanstack/db'
import { QueryClient } from '@tanstack/query-core'
import { startOfflineExecutor } from '@tanstack/offline-transactions'
import { queryCollectionOptions } from '../src/query'
import type { Collection } from '@tanstack/db'
import type {
  LeaderElection,
  OfflineConfig,
  OnlineDetector,
  StorageAdapter,
} from '@tanstack/offline-transactions'

// --- Browser API mocks needed by @tanstack/offline-transactions ---
// jsdom doesn't provide navigator.locks, which the WebLocksLeader uses.
// We pass custom implementations (FakeLeaderElection, ManualOnlineDetector,
// FakeStorageAdapter) so these mocks just prevent initialization errors.

if (!(globalThis.navigator as any)?.locks) {
  Object.defineProperty(globalThis.navigator, `locks`, {
    value: { request: vi.fn().mockResolvedValue(false) },
    configurable: true,
  })
}

// --- Test helpers ---

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0))

class ManualOnlineDetector implements OnlineDetector {
  private listeners = new Set<() => void>()
  private online: boolean

  constructor(initialOnline: boolean) {
    this.online = initialOnline
  }

  subscribe(callback: () => void): () => void {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }

  notifyOnline(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }

  isOnline(): boolean {
    return this.online
  }

  setOnline(isOnline: boolean): void {
    this.online = isOnline
    if (isOnline) {
      this.notifyOnline()
    }
  }

  dispose(): void {
    this.listeners.clear()
  }
}

class FakeStorageAdapter implements StorageAdapter {
  private store = new Map<string, string>()

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.store.has(key) ? this.store.get(key)! : null)
  }

  set(key: string, value: string): Promise<void> {
    this.store.set(key, value)
    return Promise.resolve()
  }

  delete(key: string): Promise<void> {
    this.store.delete(key)
    return Promise.resolve()
  }

  keys(): Promise<Array<string>> {
    return Promise.resolve(Array.from(this.store.keys()))
  }

  clear(): Promise<void> {
    this.store.clear()
    return Promise.resolve()
  }
}

class FakeLeaderElection implements LeaderElection {
  private listeners = new Set<(isLeader: boolean) => void>()
  private leader = true

  requestLeadership(): Promise<boolean> {
    this.notify(this.leader)
    return Promise.resolve(this.leader)
  }

  releaseLeadership(): void {
    this.leader = false
    this.notify(false)
  }

  isLeader(): boolean {
    return this.leader
  }

  onLeadershipChange(callback: (isLeader: boolean) => void): () => void {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }

  private notify(isLeader: boolean): void {
    for (const listener of this.listeners) {
      listener(isLeader)
    }
  }
}

// --- Test item type ---

interface TestItem {
  id: string
  value: string
}

type OfflineMutationParams = Parameters<OfflineConfig[`mutationFns`][string]>[0]

// --- Tests ---

describe(`offline transactions + query collection refresh`, () => {
  it(`should not revert optimistic state when query refetches before pending offline transactions complete`, async () => {
    // This test verifies that when a user goes offline, queues a mutation,
    // and comes back online, the collection does not temporarily lose the
    // optimistic insert. In a query-backed collection, data flows through
    // query refetches (queryFn), not directly from the mutation function.
    // When refetchOnReconnect fires before the offline transaction reaches
    // the server, the refetch returns stale data. The optimistic state
    // should remain visible until the transaction completes and a fresh
    // refetch confirms the data.

    const onlineDetector = new ManualOnlineDetector(false) // Start offline
    const storage = new FakeStorageAdapter()

    // --- Mock server state ---
    const serverItems: Array<TestItem> = [
      { id: `item-1`, value: `server-data` },
    ]

    // Control when the mutation fn resolves
    let resolveMutation: (() => void) | null = null

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 0,
          retry: false,
        },
      },
    })

    // queryFn reads from serverItems (simulating a real API GET endpoint)
    const queryFn = vi.fn().mockImplementation(() => {
      return Promise.resolve([...serverItems])
    })

    // Create the query-backed collection
    const collection = createCollection(
      queryCollectionOptions({
        id: `offline-refresh-test`,
        queryClient,
        queryKey: [`offline-refresh-test`],
        queryFn,
        getKey: (item: TestItem) => item.id,
        startSync: true,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
      }),
    )

    // Wait for initial query to populate the collection
    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(1)
      expect(collection.size).toBe(1)
    })
    expect(collection.get(`item-1`)?.value).toBe(`server-data`)

    // --- Set up offline executor ---
    const mutationFnName = `syncData`
    const offlineConfig: OfflineConfig = {
      collections: { [`offline-refresh-test`]: collection as any },
      mutationFns: {
        [mutationFnName]: async (params: OfflineMutationParams) => {
          // Block until the test explicitly resolves (simulating slow API POST)
          await new Promise<void>((resolve) => {
            resolveMutation = resolve
          })

          // Update server state (simulating the server processing the mutation)
          for (const mutation of params.transaction.mutations) {
            if (mutation.type === `insert`) {
              serverItems.push(mutation.modified as unknown as TestItem)
            }
          }

          return { ok: true }
        },
      },
      storage,
      leaderElection: new FakeLeaderElection(),
      onlineDetector,
    }

    const executor = startOfflineExecutor(offlineConfig)
    await executor.waitForInit()

    // --- Go offline and create an offline mutation ---
    const offlineTx = executor.createOfflineTransaction({
      mutationFnName,
      autoCommit: false,
    })

    offlineTx.mutate(() => {
      ;(collection as Collection<TestItem, string, any>).insert({
        id: `item-2`,
        value: `offline-insert`,
      })
    })

    // Commit while offline: persists to outbox, mutation fn NOT called yet
    const commitPromise = offlineTx.commit()
    await flushMicrotasks()

    // Verify: item-2 is visible through optimistic state
    expect(collection.get(`item-2`)?.value).toBe(`offline-insert`)
    expect(collection.get(`item-1`)?.value).toBe(`server-data`)

    // --- Come online ---
    // This triggers both:
    //   1. The offline executor replaying pending transactions (mutationFn called)
    //   2. TanStack Query potentially refetching (refetchOnReconnect default)
    onlineDetector.setOnline(true)
    await flushMicrotasks()

    // Trigger a query refetch that returns stale server state.
    // The server doesn't have item-2 yet (the mutation is still in progress).
    // This simulates what refetchOnReconnect would do.
    await collection.utils.refetch()

    // The refetch returned stale data (only item-1), but item-2 should
    // still be visible because the offline transaction is still pending
    // and the optimistic state should cover the gap.
    expect(collection.get(`item-2`)?.value).toBe(`offline-insert`)

    // --- Complete the mutation (server processes it) ---
    expect(resolveMutation).not.toBeNull()
    resolveMutation!()

    // Wait for the transaction to fully complete
    await commitPromise

    // After the transaction completes, item-2 should remain visible.
    //
    // Without the fix: the stale refetch overwrote syncedData with only
    // item-1, the optimistic state was cleaned up, and item-2 is gone
    // permanently (no fresh refetch is triggered).
    //
    // With the fix: the stale refetch was skipped (barrier), and a fresh
    // refetch is triggered once the barrier resolves. The fresh refetch
    // includes item-2 because the server now has it. We use waitFor to
    // allow the barrier-triggered refetch to complete.
    await vi.waitFor(
      () => {
        expect(collection.get(`item-2`)?.value).toBe(`offline-insert`)
      },
      { timeout: 1000 },
    )

    executor.dispose()
    queryClient.clear()
  })
})
