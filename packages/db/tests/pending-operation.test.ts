import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryCollection } from '../src/query/live-query-collection.js'
import { createEffect } from '../src/index.js'
import { localOnlyCollectionOptions } from '../src/local-only.js'
import { createTransaction } from '../src/transactions'
import { and, count, eq, isNull, not, or } from '../src/query/builder/functions'
import { mockSyncCollectionOptions, stripVirtualProps } from './utils'
import type { ChangeMessage } from '../src/types'

const waitForChanges = () => new Promise((resolve) => setTimeout(resolve, 10))

type Item = { id: string; title: string }

describe(`$pendingOperation virtual property`, () => {
  // ── B1: Basic virtual prop behavior ─────────────────────────────────

  describe(`basic behavior`, () => {
    it(`should be null for synced rows`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptions({
          id: `pending-op-synced`,
          getKey: (item: Item) => item.id,
          initialData: [{ id: `1`, title: `Synced item` }],
        }),
      )

      await collection.preload()

      const item = collection.get(`1`)
      expect(item).toBeDefined()
      expect(item!.$pendingOperation).toBe(null)
    })

    it(`should be 'insert' for optimistic insert in pending transaction`, async () => {
      const collection = createCollection<Item, string>({
        id: `pending-op-insert`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        onInsert: async () => {
          // Never resolves during test — keeps transaction pending
          await new Promise(() => {})
        },
      })

      collection.subscribeChanges(() => {}, { includeInitialState: false })
      await waitForChanges()

      collection.insert({ id: `new-1`, title: `New item` })
      await waitForChanges()

      const item = collection.get(`new-1`)
      expect(item).toBeDefined()
      expect(item!.$pendingOperation).toBe(`insert`)
    })

    it(`should be 'update' for optimistic update in pending transaction`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptions({
          id: `pending-op-update`,
          getKey: (item: Item) => item.id,
          initialData: [{ id: `1`, title: `Original` }],
        }),
      )

      await collection.preload()

      const tx = createTransaction({
        autoCommit: false,
        mutationFn: async () => {
          await new Promise(() => {})
        },
      })

      tx.mutate(() => {
        collection.update(`1`, (item) => {
          item.title = `Updated`
        })
      })

      const item = collection.get(`1`)
      expect(item).toBeDefined()
      expect(item!.$pendingOperation).toBe(`update`)
    })

    it(`should be 'delete' for optimistic delete in pending transaction`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptions({
          id: `pending-op-delete`,
          getKey: (item: Item) => item.id,
          initialData: [{ id: `1`, title: `To delete` }],
        }),
      )

      await collection.preload()

      const tx = createTransaction({
        autoCommit: false,
        mutationFn: async () => {
          await new Promise(() => {})
        },
      })

      tx.mutate(() => {
        collection.delete(`1`)
      })

      // Note: get() returns undefined for deleted items (public API unchanged)
      // but the internal state tracks pendingOperation as 'delete'
      expect(collection.get(`1`)).toBeUndefined()
      expect(collection._state.getPendingOperation(`1`)).toBe(`delete`)
    })

    it(`should return to null after transaction commit + sync confirmation`, async () => {
      let syncFns: {
        begin: () => void
        write: (msg: any) => void
        commit: () => void
      }

      const collection = createCollection<Item, string>({
        id: `pending-op-confirm`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            syncFns = { begin, write, commit }
            markReady()
          },
        },
        onInsert: async () => {},
      })

      collection.subscribeChanges(() => {}, { includeInitialState: false })
      await waitForChanges()

      collection.insert({ id: `1`, title: `New` })
      await waitForChanges()

      expect(collection.get(`1`)!.$pendingOperation).toBe(`insert`)

      // Simulate sync confirmation
      syncFns!.begin()
      syncFns!.write({ type: `insert`, value: { id: `1`, title: `New` } })
      syncFns!.commit()
      await waitForChanges()

      expect(collection.get(`1`)!.$pendingOperation).toBe(null)
    })

    it(`should return to null after transaction rollback`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptions({
          id: `pending-op-rollback`,
          getKey: (item: Item) => item.id,
          initialData: [{ id: `1`, title: `Original` }],
        }),
      )

      await collection.preload()

      const mutationFn = vi.fn().mockRejectedValue(new Error(`Rollback test`))

      const tx = createTransaction({
        autoCommit: false,
        mutationFn,
      })

      tx.mutate(() => {
        collection.update(`1`, (item) => {
          item.title = `Updated`
        })
      })

      expect(collection.get(`1`)!.$pendingOperation).toBe(`update`)

      // Commit should fail and trigger rollback
      try {
        await tx.commit()
      } catch {
        // Expected
      }
      await waitForChanges()

      expect(collection.get(`1`)!.$pendingOperation).toBe(null)
    })

    it(`should always be null for local-only collections`, () => {
      const collection = createCollection<Item, string>(
        localOnlyCollectionOptions({
          id: `pending-op-local-only`,
          getKey: (item: any) => item.id,
        }),
      )

      collection.insert({ id: `1`, title: `Local item` })

      const item = collection.get(`1`)
      expect(item).toBeDefined()
      expect(item!.$pendingOperation).toBe(null)
    })

    it(`should be null for non-optimistic mutations`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptions({
          id: `pending-op-non-optimistic`,
          getKey: (item: Item) => item.id,
          initialData: [{ id: `1`, title: `Original` }],
        }),
      )

      await collection.preload()

      const tx = createTransaction({
        autoCommit: false,
        mutationFn: async () => {
          await new Promise(() => {})
        },
      })

      tx.mutate(() => {
        collection.update(`1`, { optimistic: false }, (item) => {
          item.title = `Non-optimistic update`
        })
      })

      // Non-optimistic mutations should not show pending operation
      expect(collection.get(`1`)!.$pendingOperation).toBe(null)
    })
  })

  // ── B2: Transition and merging tests ────────────────────────────────

  describe(`mutation merging`, () => {
    it(`insert + update in same transaction shows $pendingOperation: 'insert'`, async () => {
      const collection = createCollection<Item, string>({
        id: `pending-op-merge-insert-update`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        onInsert: async () => {
          await new Promise(() => {})
        },
      })

      collection.subscribeChanges(() => {}, { includeInitialState: false })
      await waitForChanges()

      const tx = createTransaction({
        autoCommit: false,
        mutationFn: async () => {
          await new Promise(() => {})
        },
      })

      tx.mutate(() => {
        collection.insert({ id: `1`, title: `New` })
      })
      tx.mutate(() => {
        collection.update(`1`, (item) => {
          item.title = `Updated new`
        })
      })

      // insert + update = insert (merged)
      const item = collection.get(`1`)
      expect(item).toBeDefined()
      expect(item!.$pendingOperation).toBe(`insert`)
      expect(stripVirtualProps(item)).toEqual({
        id: `1`,
        title: `Updated new`,
      })
    })

    it(`insert + delete in same transaction cancels out — item gone entirely`, async () => {
      const collection = createCollection<Item, string>({
        id: `pending-op-merge-insert-delete`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        onInsert: async () => {
          await new Promise(() => {})
        },
      })

      collection.subscribeChanges(() => {}, { includeInitialState: false })
      await waitForChanges()

      const tx = createTransaction({
        autoCommit: false,
        mutationFn: async () => {
          await new Promise(() => {})
        },
      })

      tx.mutate(() => {
        collection.insert({ id: `1`, title: `Temp` })
      })
      tx.mutate(() => {
        collection.delete(`1`)
      })

      // insert + delete = cancelled
      expect(collection.get(`1`)).toBeUndefined()
      expect(collection._state.getPendingOperation(`1`)).toBe(null)
    })

    it(`update + delete in same transaction shows $pendingOperation: 'delete'`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptions({
          id: `pending-op-merge-update-delete`,
          getKey: (item: Item) => item.id,
          initialData: [{ id: `1`, title: `Original` }],
        }),
      )

      await collection.preload()

      const tx = createTransaction({
        autoCommit: false,
        mutationFn: async () => {
          await new Promise(() => {})
        },
      })

      tx.mutate(() => {
        collection.update(`1`, (item) => {
          item.title = `Updated`
        })
      })
      tx.mutate(() => {
        collection.delete(`1`)
      })

      // update + delete = delete
      expect(collection.get(`1`)).toBeUndefined()
      expect(collection._state.getPendingOperation(`1`)).toBe(`delete`)
    })

    it(`pending delete superseded by update in new transaction on same key`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptions({
          id: `pending-op-supersede`,
          getKey: (item: Item) => item.id,
          initialData: [{ id: `1`, title: `Original` }],
        }),
      )

      await collection.preload()

      const tx1 = createTransaction({
        autoCommit: false,
        mutationFn: async () => {
          await new Promise(() => {})
        },
      })

      tx1.mutate(() => {
        collection.delete(`1`)
      })

      expect(collection._state.getPendingOperation(`1`)).toBe(`delete`)

      // Second transaction inserts the item back (or updates it)
      const tx2 = createTransaction({
        autoCommit: false,
        mutationFn: async () => {
          await new Promise(() => {})
        },
      })

      tx2.mutate(() => {
        collection.insert({ id: `1`, title: `Reinserted` })
      })

      // tx2's insert supersedes tx1's delete. Since the item exists in syncedData,
      // the net effect is an upsert of an existing server item — so it's 'update', not 'insert'.
      const item = collection.get(`1`)
      expect(item).toBeDefined()
      expect(item!.$pendingOperation).toBe(`update`)
    })

    it(`subscribeChanges emits events when $pendingOperation transitions`, async () => {
      const changes: Array<ChangeMessage<any>> = []

      const collection = createCollection<Item, string>({
        id: `pending-op-transitions`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        onInsert: async () => {
          await new Promise(() => {})
        },
      })

      const subscription = collection.subscribeChanges(
        (events) => changes.push(...events),
        { includeInitialState: false },
      )
      await waitForChanges()

      collection.insert({ id: `1`, title: `New` })
      await waitForChanges()

      // Should have an insert event with $pendingOperation: 'insert'
      const insertChange = changes.find(
        (c) => c.key === `1` && c.type === `insert`,
      )
      expect(insertChange).toBeDefined()
      expect(insertChange!.value.$pendingOperation).toBe(`insert`)

      subscription.unsubscribe()
    })

    it(`subscribeChanges still emits type: 'delete' for optimistic deletes (backward compat)`, async () => {
      const changes: Array<ChangeMessage<any>> = []

      const collection = createCollection(
        mockSyncCollectionOptions({
          id: `pending-op-delete-event`,
          getKey: (item: Item) => item.id,
          initialData: [{ id: `1`, title: `Item` }],
        }),
      )

      await collection.preload()

      const subscription = collection.subscribeChanges(
        (events) => changes.push(...events),
        { includeInitialState: false },
      )

      const tx = createTransaction({
        autoCommit: false,
        mutationFn: async () => {
          await new Promise(() => {})
        },
      })

      tx.mutate(() => {
        collection.delete(`1`)
      })
      await waitForChanges()

      // subscribeChanges should still emit a delete event (collection layer unchanged)
      const deleteChange = changes.find(
        (c) => c.key === `1` && c.type === `delete`,
      )
      expect(deleteChange).toBeDefined()

      subscription.unsubscribe()
    })
  })

  // ── B3: Edge case tests ─────────────────────────────────────────────

  describe(`edge cases`, () => {
    it(`$pendingOperation change invalidates virtual props cache when $synced and $origin are unchanged`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptions({
          id: `pending-op-cache`,
          getKey: (item: Item) => item.id,
          initialData: [{ id: `1`, title: `Original` }],
        }),
      )

      await collection.preload()

      // First, do an update — item is $synced: false, $origin: 'local', $pendingOperation: 'update'
      const tx = createTransaction({
        autoCommit: false,
        mutationFn: async () => {
          await new Promise(() => {})
        },
      })

      tx.mutate(() => {
        collection.update(`1`, (item) => {
          item.title = `Updated`
        })
      })

      const updatedItem = collection.get(`1`)
      expect(updatedItem!.$synced).toBe(false)
      expect(updatedItem!.$origin).toBe(`local`)
      expect(updatedItem!.$pendingOperation).toBe(`update`)

      // Now delete in the same transaction — $synced stays false, $origin stays local
      // but $pendingOperation should change to 'delete'
      tx.mutate(() => {
        collection.delete(`1`)
      })

      // The item is deleted so get() returns undefined, but we can check internal state
      expect(collection._state.getPendingOperation(`1`)).toBe(`delete`)
    })

    it(`item in completed-but-awaiting-sync window still shows non-null $pendingOperation`, async () => {
      let resolveSync: (() => void) | undefined

      const collection = createCollection<Item, string>({
        id: `pending-op-awaiting-sync`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        onInsert: async () => {
          await new Promise<void>((resolve) => {
            resolveSync = resolve
          })
        },
      })

      collection.subscribeChanges(() => {}, { includeInitialState: false })
      await waitForChanges()

      collection.insert({ id: `1`, title: `New` })
      await waitForChanges()

      // Item should have $pendingOperation: 'insert' before commit resolves
      expect(collection.get(`1`)!.$pendingOperation).toBe(`insert`)

      // The onInsert creates a transaction that auto-commits.
      // The mutationFn (onInsert) is still running — transaction is in 'persisting' state.
      // $pendingOperation should still be non-null during this window.
      expect(collection._state.getPendingOperation(`1`)).not.toBe(null)

      // Resolve the sync to clean up
      resolveSync?.()
      await waitForChanges()
    })

    it(`$pendingOperation transition triggers virtualChanged event during sync commit`, async () => {
      const changes: Array<ChangeMessage<any>> = []
      let syncFns: {
        begin: () => void
        write: (msg: any) => void
        commit: () => void
      }

      const collection = createCollection<Item, string>({
        id: `pending-op-virtual-changed`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            syncFns = { begin, write, commit }
            markReady()
          },
        },
        onInsert: async () => {},
      })

      const subscription = collection.subscribeChanges(
        (events) => changes.push(...events),
        { includeInitialState: false },
      )
      await waitForChanges()

      collection.insert({ id: `1`, title: `New` })
      await waitForChanges()

      const insertEvent = changes.find((c) => c.key === `1`)
      expect(insertEvent).toBeDefined()
      expect(insertEvent!.value.$pendingOperation).toBe(`insert`)

      changes.length = 0

      // Sync confirms the insert
      syncFns!.begin()
      syncFns!.write({ type: `insert`, value: { id: `1`, title: `New` } })
      syncFns!.commit()
      await waitForChanges()

      // Should emit an update event for the virtual prop transition
      // $pendingOperation goes from 'insert' to null
      const updateEvent = changes.find(
        (c) => c.key === `1` && c.type === `update`,
      )
      expect(updateEvent).toBeDefined()
      if (updateEvent) {
        expect(updateEvent.value.$pendingOperation).toBe(null)
      }

      subscription.unsubscribe()
    })
  })

  // ── B4: Delete visibility tests (should FAIL until Phase C) ─────────

  describe(`delete visibility`, () => {
    it(`deleted items are hidden from default query results (backward compat)`, async () => {
      const sourceCollection = createCollection(
        mockSyncCollectionOptions({
          id: `pending-op-query-default`,
          getKey: (item: Item) => item.id,
          initialData: [
            { id: `1`, title: `Keep` },
            { id: `2`, title: `Delete me` },
          ],
        }),
      )

      await sourceCollection.preload()

      const liveQuery = createLiveQueryCollection({
        query: (q) => q.from({ item: sourceCollection }),
        getKey: (item) => item.id,
      })

      await liveQuery.preload()

      const tx = createTransaction({
        autoCommit: false,
        mutationFn: async () => {
          await new Promise(() => {})
        },
      })

      tx.mutate(() => {
        sourceCollection.delete(`2`)
      })
      await waitForChanges()

      // Default query should NOT show deleted items
      const results = Array.from(liveQuery.values())
      expect(results.map((r) => stripVirtualProps(r))).toEqual([
        { id: `1`, title: `Keep` },
      ])
    })

    it(`deleted items are visible in query when where clause references $pendingOperation`, async () => {
      const sourceCollection = createCollection(
        mockSyncCollectionOptions({
          id: `pending-op-query-optin`,
          getKey: (item: Item) => item.id,
          initialData: [
            { id: `1`, title: `Keep` },
            { id: `2`, title: `Delete me` },
          ],
        }),
      )

      await sourceCollection.preload()

      // Query that references $pendingOperation — should show pending deletes
      const liveQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ item: sourceCollection })
            .where(({ item }) =>
              or(
                isNull(item.$pendingOperation),
                not(isNull(item.$pendingOperation)),
              ),
            ),
        getKey: (item: any) => item.id,
      })

      await liveQuery.preload()

      const tx = createTransaction({
        autoCommit: false,
        mutationFn: async () => {
          await new Promise(() => {})
        },
      })

      tx.mutate(() => {
        sourceCollection.delete(`2`)
      })
      await waitForChanges()

      // With $pendingOperation in where, deleted items should be visible
      const results = Array.from(liveQuery.values())
      const item2 = results.find(
        (r) => (stripVirtualProps(r) as unknown as Item).id === `2`,
      )
      expect(item2).toBeDefined()
      expect((item2 as any).$pendingOperation).toBe(`delete`)
    })

    it(`pending-delete items appear in initial query snapshot when opted in`, async () => {
      const sourceCollection = createCollection(
        mockSyncCollectionOptions({
          id: `pending-op-snapshot`,
          getKey: (item: Item) => item.id,
          initialData: [
            { id: `1`, title: `Keep` },
            { id: `2`, title: `Delete me` },
          ],
        }),
      )

      await sourceCollection.preload()

      // Delete before creating the query
      const tx = createTransaction({
        autoCommit: false,
        mutationFn: async () => {
          await new Promise(() => {})
        },
      })

      tx.mutate(() => {
        sourceCollection.delete(`2`)
      })
      await waitForChanges()

      // Create a query AFTER the delete — initial snapshot should include the pending delete
      const liveQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ item: sourceCollection })
            .where(({ item }) =>
              or(
                isNull(item.$pendingOperation),
                not(isNull(item.$pendingOperation)),
              ),
            ),
        getKey: (item: any) => item.id,
      })

      await liveQuery.preload()
      await waitForChanges()

      const results = Array.from(liveQuery.values())
      const item2 = results.find(
        (r) => (stripVirtualProps(r) as unknown as Item).id === `2`,
      )
      expect(item2).toBeDefined()
    })

    it(`sync-confirmed delete removes item from opted-in query results`, async () => {
      let syncFns: {
        begin: () => void
        write: (msg: any) => void
        commit: () => void
      }

      const sourceCollection = createCollection<Item, string>({
        id: `pending-op-sync-delete`,
        getKey: (item: any) => item.id,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            syncFns = { begin, write, commit }
            begin()
            write({
              type: `insert`,
              value: { id: `1`, title: `Item 1` },
            })
            write({
              type: `insert`,
              value: { id: `2`, title: `Item 2` },
            })
            commit()
            markReady()
          },
        },
        onDelete: async () => {},
      })

      // Query with $pendingOperation reference
      const liveQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ item: sourceCollection })
            .where(({ item }) =>
              or(
                isNull(item.$pendingOperation),
                not(isNull(item.$pendingOperation)),
              ),
            ),
        getKey: (item: any) => item.id,
      })

      await liveQuery.preload()
      await waitForChanges()

      // Optimistically delete item 2
      const tx = createTransaction({
        autoCommit: false,
        mutationFn: async () => {},
      })

      tx.mutate(() => {
        sourceCollection.delete(`2`)
      })
      await waitForChanges()

      // Item 2 should be visible with $pendingOperation: 'delete'
      let results = Array.from(liveQuery.values())
      let item2 = results.find(
        (r) => (stripVirtualProps(r) as unknown as Item).id === `2`,
      )
      expect(item2).toBeDefined()
      expect((item2 as any).$pendingOperation).toBe(`delete`)

      // Commit the transaction
      await tx.commit()
      await waitForChanges()

      // Sync confirms the delete
      syncFns!.begin()
      syncFns!.write({ type: `delete`, key: `2` })
      syncFns!.commit()
      await waitForChanges()

      // Item 2 should now be GONE (sync confirmed the delete)
      results = Array.from(liveQuery.values())
      item2 = results.find(
        (r) => (stripVirtualProps(r) as unknown as Item).id === `2`,
      )
      expect(item2).toBeUndefined()
    })
  })

  // ── B5: Live query integration ──────────────────────────────────────

  describe(`live query integration`, () => {
    it(`live query default behavior unchanged — deletes vanish from results`, async () => {
      const sourceCollection = createCollection(
        mockSyncCollectionOptions({
          id: `pending-op-live-default`,
          getKey: (item: Item) => item.id,
          initialData: [
            { id: `1`, title: `Keep` },
            { id: `2`, title: `Delete me` },
          ],
        }),
      )

      await sourceCollection.preload()

      const liveQuery = createLiveQueryCollection({
        query: (q) => q.from({ item: sourceCollection }),
        getKey: (item) => item.id,
      })

      await liveQuery.preload()

      const tx = createTransaction({
        autoCommit: false,
        mutationFn: async () => {
          await new Promise(() => {})
        },
      })

      tx.mutate(() => {
        sourceCollection.delete(`2`)
      })
      await waitForChanges()

      const results = Array.from(liveQuery.values())
      const ids = results.map(
        (r) => (stripVirtualProps(r) as unknown as Item).id,
      )
      expect(ids).toEqual([`1`])
    })

    it(`live query with $pendingOperation where clause shows deleted items inline`, async () => {
      const sourceCollection = createCollection(
        mockSyncCollectionOptions({
          id: `pending-op-live-optin`,
          getKey: (item: Item) => item.id,
          initialData: [
            { id: `1`, title: `Keep` },
            { id: `2`, title: `Delete me` },
            { id: `3`, title: `Also keep` },
          ],
        }),
      )

      await sourceCollection.preload()

      const liveQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ item: sourceCollection })
            .where(({ item }) =>
              or(
                isNull(item.$pendingOperation),
                not(isNull(item.$pendingOperation)),
              ),
            ),
        getKey: (item: any) => item.id,
      })

      await liveQuery.preload()

      const tx = createTransaction({
        autoCommit: false,
        mutationFn: async () => {
          await new Promise(() => {})
        },
      })

      tx.mutate(() => {
        sourceCollection.delete(`2`)
      })
      await waitForChanges()

      const results = Array.from(liveQuery.values())
      const ids = results.map(
        (r) => (stripVirtualProps(r) as unknown as Item).id,
      )

      // All 3 items should be present — item 2 with $pendingOperation: 'delete'
      expect(ids).toContain(`1`)
      expect(ids).toContain(`2`)
      expect(ids).toContain(`3`)

      const item2 = results.find(
        (r) => (stripVirtualProps(r) as unknown as Item).id === `2`,
      )
      expect((item2 as any).$pendingOperation).toBe(`delete`)
    })
  })

  // ── GROUP BY ────────────────────────────────────────────────────────

  describe(`GROUP BY`, () => {
    type Task = { id: string; category: string; title: string }

    it(`$pendingOperation is null when all rows in group are null`, async () => {
      const sourceCollection = createCollection(
        mockSyncCollectionOptions({
          id: `pending-op-groupby-null`,
          getKey: (item: Task) => item.id,
          initialData: [
            { id: `1`, category: `work`, title: `Task 1` },
            { id: `2`, category: `work`, title: `Task 2` },
            { id: `3`, category: `personal`, title: `Task 3` },
          ],
        }),
      )

      await sourceCollection.preload()

      const liveQuery = createLiveQueryCollection({
        query: (q: any) =>
          q
            .from({ task: sourceCollection })
            .groupBy(({ task }: any) => task.category)
            .select(({ task }: any) => ({
              category: task.category,
              count: count(task.id),
            })),
        getKey: (item: any) => item.category,
      })

      await liveQuery.preload()

      const results = Array.from(liveQuery.values())
      for (const row of results) {
        expect(row.$pendingOperation).toBe(null)
      }
    })

    it(`$pendingOperation is non-null when any row in group has pending operation`, async () => {
      const sourceCollection = createCollection(
        mockSyncCollectionOptions({
          id: `pending-op-groupby-nonnull`,
          getKey: (item: Task) => item.id,
          initialData: [
            { id: `1`, category: `work`, title: `Task 1` },
            { id: `2`, category: `work`, title: `Task 2` },
            { id: `3`, category: `personal`, title: `Task 3` },
          ],
        }),
      )

      await sourceCollection.preload()

      const liveQuery = createLiveQueryCollection({
        query: (q: any) =>
          q
            .from({ task: sourceCollection })
            .groupBy(({ task }: any) => task.category)
            .select(({ task }: any) => ({
              category: task.category,
              count: count(task.id),
            })),
        getKey: (item: any) => item.category,
      })

      await liveQuery.preload()

      // Update one item in the 'work' group
      const tx = createTransaction({
        autoCommit: false,
        mutationFn: async () => {
          await new Promise(() => {})
        },
      })

      tx.mutate(() => {
        sourceCollection.update(`1`, (item) => {
          item.title = `Updated`
        })
      })
      await waitForChanges()

      const results = Array.from(liveQuery.values())
      const workGroup = results.find((r) => r.category === `work`)
      const personalGroup = results.find((r) => r.category === `personal`)

      // Work group has one updated item — $pendingOperation should be non-null
      expect(workGroup).toBeDefined()
      expect(workGroup.$pendingOperation).not.toBe(null)

      // Personal group has no pending changes — $pendingOperation should be null
      expect(personalGroup).toBeDefined()
      expect(personalGroup.$pendingOperation).toBe(null)
    })
  })

  it(`$synced should be false when $pendingOperation is non-null (pendingOptimistic state)`, async () => {
    let resolveDelete: (() => void) | undefined

    const collection = createCollection<Item, string>({
      id: `pending-op-synced-consistency`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: `insert`, value: { id: `1`, title: `Item 1` } })
          commit()
          markReady()
        },
      },
      onDelete: async () => {
        await new Promise<void>((resolve) => {
          resolveDelete = resolve
        })
      },
    })

    collection.subscribeChanges(() => {}, { includeInitialState: true })
    await waitForChanges()

    // Delete item — auto-commits via onDelete, holds in persisting state
    collection.delete(`1`)
    await waitForChanges()

    // Resolve to move to 'completed' state (pending sync confirmation)
    resolveDelete?.()
    await waitForChanges()

    // $synced and $pendingOperation should be consistent:
    // if there's a pending operation, $synced should be false
    const pendingOp = collection._state.getPendingOperation(`1`)
    const synced = collection._state.isRowSynced(`1`)

    expect(pendingOp).toBe(`delete`)
    expect(synced).toBe(false)
  })

  it(`rollback of optimistic delete restores item in query with $pendingOperation`, async () => {
    let syncFns: {
      begin: () => void
      write: (msg: any) => void
      commit: () => void
    }

    const collection = createCollection<Item, string>({
      id: `rollback-delete`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          syncFns = { begin, write, commit }
          markReady()
        },
      },
    })

    // Live query with $pendingOperation tautology (enables includePendingDeletes)
    const liveQuery = createLiveQueryCollection({
      query: (q: any) =>
        q
          .from({ item: collection })
          .where(({ item }: any) =>
            or(
              isNull(item.$pendingOperation),
              not(isNull(item.$pendingOperation)),
            ),
          ),
      getKey: (item: any) => item.id,
    })

    await liveQuery.preload()
    await waitForChanges()

    // Sync an item into the collection
    syncFns!.begin()
    syncFns!.write({
      type: `insert`,
      value: { id: `1`, title: `Existing` },
    })
    syncFns!.commit()
    await waitForChanges()

    // Item should be visible with $pendingOperation: null
    let results = Array.from(liveQuery.values())
    expect(results).toHaveLength(1)
    expect(results[0].$pendingOperation).toBe(null)

    // Delete via a pending transaction
    const tx = createTransaction({
      autoCommit: false,
      mutationFn: async () => {
        await new Promise(() => {})
      },
    })
    tx.mutate(() => {
      collection.delete(`1`)
    })
    await waitForChanges()

    // Item should still be visible with $pendingOperation: 'delete'
    results = Array.from(liveQuery.values())
    expect(results).toHaveLength(1)
    expect(results[0].$pendingOperation).toBe(`delete`)

    // Rollback the delete
    tx.rollback()
    await waitForChanges()

    // Item should be restored with $pendingOperation: null
    results = Array.from(liveQuery.values())
    expect(results).toHaveLength(1)
    expect(results[0].$pendingOperation).toBe(null)
  })

  // Lazy source (join) — test that pending-delete items in joined collections
  // are visible via live events (not snapshot, since lazy sources skip initial state)
  it(`pending-delete items in joined collection are visible via live events`, async () => {
    type Parent = { id: string }
    type Child = { id: string; parentId: string; name: string }

    let parentSyncFns: {
      begin: () => void
      write: (msg: any) => void
      commit: () => void
    }
    let childSyncFns: {
      begin: () => void
      write: (msg: any) => void
      commit: () => void
    }

    const parents = createCollection<Parent, string>({
      id: `lazy-parent`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          parentSyncFns = { begin, write, commit }
          markReady()
        },
      },
    })

    const children = createCollection<Child, string>({
      id: `lazy-child`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          childSyncFns = { begin, write, commit }
          markReady()
        },
      },
    })

    const liveQuery = createLiveQueryCollection({
      query: (q: any) =>
        q.from({ p: parents }).select(({ p }: any) => ({
          ...p,
          children: q
            .from({ c: children })
            .where(({ c }: any) =>
              and(
                eq(c.parentId, p.id),
                or(
                  isNull(c.$pendingOperation),
                  not(isNull(c.$pendingOperation)),
                ),
              ),
            ),
        })),
      getKey: (item: any) => item.id,
    })

    await liveQuery.preload()
    await waitForChanges()

    // Sync parent and child
    parentSyncFns!.begin()
    parentSyncFns!.write({ type: `insert`, value: { id: `p1` } })
    parentSyncFns!.commit()

    childSyncFns!.begin()
    childSyncFns!.write({
      type: `insert`,
      value: { id: `c1`, parentId: `p1`, name: `Child` },
    })
    childSyncFns!.commit()
    await waitForChanges()

    // Delete the child via pending transaction
    const tx = createTransaction({
      autoCommit: false,
      mutationFn: async () => {
        await new Promise(() => {})
      },
    })
    tx.mutate(() => {
      children.delete(`c1`)
    })
    await waitForChanges()

    // Child should be visible in the join with $pendingOperation: 'delete'
    const results = Array.from(liveQuery.values())
    const parent = results.find((r: any) => r.id === `p1`)
    expect(parent).toBeDefined()
    const childResults = Array.from(parent.children.values())
    expect(childResults).toHaveLength(1)
    expect((childResults[0] as any).$pendingOperation).toBe(`delete`)
  })

  // createEffect support
  it(`createEffect onEnter fires for pending-delete items when $pendingOperation is in where`, async () => {
    let syncFns: {
      begin: () => void
      write: (msg: any) => void
      commit: () => void
    }

    const collection = createCollection<Item, string>({
      id: `effect-pending-delete`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          syncFns = { begin, write, commit }
          markReady()
        },
      },
    })

    // Activate sync by subscribing
    collection.subscribeChanges(() => {}, { includeInitialState: false })
    await waitForChanges()

    // Sync an item
    syncFns!.begin()
    syncFns!.write({ type: `insert`, value: { id: `1`, title: `Hello` } })
    syncFns!.commit()
    await waitForChanges()

    // Delete via pending transaction
    const tx = createTransaction({
      autoCommit: false,
      mutationFn: async () => {
        await new Promise(() => {})
      },
    })
    tx.mutate(() => {
      collection.delete(`1`)
    })
    await waitForChanges()

    // createEffect with $pendingOperation in where — should find the deleted item
    const entered: Array<any> = []
    const effect = createEffect({
      query: (q: any) =>
        q
          .from({ item: collection })
          .where(({ item }: any) =>
            or(
              isNull(item.$pendingOperation),
              not(isNull(item.$pendingOperation)),
            ),
          ),
      onEnter: (event: any) => {
        entered.push(event.value)
      },
    })

    await waitForChanges()

    // The deleted item should have triggered onEnter with $pendingOperation: 'delete'
    const deletedItem = entered.find((v: any) => v.id === `1`)
    expect(deletedItem).toBeDefined()
    expect(deletedItem.$pendingOperation).toBe(`delete`)

    effect.dispose()
  })
})
