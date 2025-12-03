import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QueryClient } from "@tanstack/query-core"
import { createCollection } from "@tanstack/db"
import { queryCollectionOptions } from "../src/query"
import type { Collection } from "@tanstack/db"

// Regression test for https://github.com/TanStack/db/issues/902
// Bug: Every other update to a non-primitive field rolls back
// Root cause: shallowEqual used reference equality for nested objects,
// causing handleQueryResult to incorrectly detect changes and write stale data

interface Todo {
  id: number
  slug: string
  createdAt: string
  metadata: { createdBy: string }
}

const getKey = (item: Todo) => item.slug

// Helper to allow microtasks to flush
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0))

describe(`Issue #902: Every other non-primitive update rolls back`, () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 0,
          gcTime: 0,
          retry: false,
        },
      },
    })
  })

  afterEach(() => {
    queryClient.clear()
  })

  it(`should correctly update non-primitive fields on consecutive updates`, async () => {
    const queryKey = [`todos-902`]

    // Simulated server-side data store
    const serverTodos: Array<Todo> = [
      {
        id: 0,
        slug: `todo-1`,
        createdAt: new Date().toISOString(),
        metadata: { createdBy: `user1` },
      },
    ]

    const queryFn = vi.fn().mockImplementation(async () => {
      await flushPromises()
      return serverTodos.map((t) => ({ ...t, metadata: { ...t.metadata } })) // Return deep copies
    })

    // Simulated server update
    const updateTodoOnServer = async (slug: string, changes: Partial<Todo>) => {
      await flushPromises()
      const todo = serverTodos.find((t) => t.slug === slug)
      if (todo) {
        // Deep merge for nested objects
        if (changes.metadata) {
          todo.metadata = { ...todo.metadata, ...changes.metadata }
        }
        // Shallow merge for other fields
        Object.keys(changes).forEach((key) => {
          if (key !== `metadata`) {
            ;(todo as any)[key] = (changes as any)[key]
          }
        })
        return { ...todo, metadata: { ...todo.metadata } } // Return a deep copy
      }
      throw new Error(`todo not found`)
    }

    let collectionRef: Collection<Todo, string> | null = null

    const options = queryCollectionOptions({
      queryKey,
      queryFn,
      queryClient,
      getKey,
      startSync: true,

      onUpdate: async ({ transaction }) => {
        const updates = transaction.mutations.map((m) => ({
          slug: m.key as string,
          changes: m.changes,
        }))

        // Simulate server call and get back updated items
        const serverItems = await Promise.all(
          updates.map((update) =>
            updateTodoOnServer(update.slug, update.changes)
          )
        )

        // Sync server response to the collection using writeUpdate
        collectionRef!.utils.writeBatch(() => {
          serverItems.forEach((serverItem) => {
            collectionRef!.utils.writeUpdate(serverItem)
          })
        })

        // Skip automatic refetch since we've already synced
        return { refetch: false }
      },
    })

    const collection = createCollection(options)
    collectionRef = collection as unknown as Collection<Todo, string>

    // Wait for collection to be ready
    await vi.waitFor(
      () => {
        expect(collection.status).toBe(`ready`)
      },
      { timeout: 5000 }
    )

    // Initial state
    const initialTodo = collection.get(`todo-1`)
    expect(initialTodo?.metadata.createdBy).toBe(`user1`)

    // First update
    const tx1 = collection.update(`todo-1`, (draft) => {
      draft.metadata = { createdBy: `user2` }
    })
    await tx1.isPersisted.promise
    await flushPromises()

    const afterFirst = collection.get(`todo-1`)
    expect(afterFirst?.metadata.createdBy).toBe(`user2`)

    // Second update - this is where the bug manifested
    // The value would roll back to "user2" instead of being "user3"
    const tx2 = collection.update(`todo-1`, (draft) => {
      draft.metadata = { createdBy: `user3` }
    })
    await tx2.isPersisted.promise
    await flushPromises()

    const afterSecond = collection.get(`todo-1`)
    expect(afterSecond?.metadata.createdBy).toBe(`user3`)

    // Third update - verify the pattern continues to work
    const tx3 = collection.update(`todo-1`, (draft) => {
      draft.metadata = { createdBy: `user4` }
    })
    await tx3.isPersisted.promise
    await flushPromises()

    const afterThird = collection.get(`todo-1`)
    expect(afterThird?.metadata.createdBy).toBe(`user4`)
  })

  it(`should correctly update primitive fields on consecutive updates (control test)`, async () => {
    interface SimpleTodo {
      id: number
      slug: string
      title: string
    }

    const queryKey = [`todos-902-primitive`]

    const serverTodos: Array<SimpleTodo> = [
      { id: 0, slug: `todo-1`, title: `Original Title` },
    ]

    const queryFn = vi.fn().mockImplementation(async () => {
      await flushPromises()
      return serverTodos.map((t) => ({ ...t }))
    })

    const updateTodoOnServer = async (
      slug: string,
      changes: Partial<SimpleTodo>
    ) => {
      await flushPromises()
      const todo = serverTodos.find((t) => t.slug === slug)
      if (todo) {
        Object.assign(todo, changes)
        return { ...todo }
      }
      throw new Error(`todo not found`)
    }

    let collectionRef: Collection<SimpleTodo, string> | null = null

    const options = queryCollectionOptions({
      queryKey,
      queryFn,
      queryClient,
      getKey: (item: SimpleTodo) => item.slug,
      startSync: true,

      onUpdate: async ({ transaction }) => {
        const updates = transaction.mutations.map((m) => ({
          slug: m.key as string,
          changes: m.changes,
        }))

        const serverItems = await Promise.all(
          updates.map((update) =>
            updateTodoOnServer(update.slug, update.changes)
          )
        )

        collectionRef!.utils.writeBatch(() => {
          serverItems.forEach((serverItem) => {
            collectionRef!.utils.writeUpdate(serverItem)
          })
        })

        return { refetch: false }
      },
    })

    const collection = createCollection(options)
    collectionRef = collection as unknown as Collection<SimpleTodo, string>

    await vi.waitFor(
      () => {
        expect(collection.status).toBe(`ready`)
      },
      { timeout: 5000 }
    )

    // Initial state
    expect(collection.get(`todo-1`)?.title).toBe(`Original Title`)

    // First update
    const tx1 = collection.update(`todo-1`, (draft) => {
      draft.title = `Title 2`
    })
    await tx1.isPersisted.promise
    await flushPromises()
    expect(collection.get(`todo-1`)?.title).toBe(`Title 2`)

    // Second update (should work correctly for primitives)
    const tx2 = collection.update(`todo-1`, (draft) => {
      draft.title = `Title 3`
    })
    await tx2.isPersisted.promise
    await flushPromises()
    expect(collection.get(`todo-1`)?.title).toBe(`Title 3`)

    // Third update
    const tx3 = collection.update(`todo-1`, (draft) => {
      draft.title = `Title 4`
    })
    await tx3.isPersisted.promise
    await flushPromises()
    expect(collection.get(`todo-1`)?.title).toBe(`Title 4`)
  })
})
