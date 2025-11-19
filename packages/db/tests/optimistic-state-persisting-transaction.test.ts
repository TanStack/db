import { describe, expect, it, vi } from "vitest"
import { createCollection } from "../src/collection/index.js"
import type { Transaction } from "../src/transactions"

/**
 * Test for fix to issue #814: optimistic state from 'persisting' transactions
 * should not be re-applied during commitPendingTransactions()
 *
 * When writeInsert() is called from within an onInsert handler, the transaction
 * is in 'persisting' state. Previously, commitPendingTransactions() would re-apply
 * optimistic state from persisting transactions after syncing server data, causing
 * server-generated fields to be overwritten with optimistic client-side values.
 */
describe(`Optimistic state with persisting transactions`, () => {
  it(`should not re-apply optimistic state from persisting transactions when server data is synced`, async () => {
    type Todo = { id: number; title: string }

    // Track the sequence of events
    const events: Array<{ type: string; id: number }> = []

    // Mock server that generates real IDs
    const createTodoOnServer = vi.fn().mockImplementation(async (todo: Todo) => {
      // Simulate server generating a real ID
      return { ...todo, id: Math.floor(Math.random() * 1000000) + 1 }
    })

    let syncFunctions: any = null

    const collection = createCollection<Todo>({
      id: `todos`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          // Initialize empty collection
          begin()
          commit()
          markReady()

          // Store sync functions for use in onInsert handler
          syncFunctions = { begin, write, commit }
        },
      },
      onInsert: async ({ transaction }: { transaction: Transaction<any> }) => {
        events.push({ type: `onInsert-called`, id: transaction.mutations[0]!.key as number })

        // Get the new item with temporary ID
        const newItem = transaction.mutations[0]!.modified as Todo
        events.push({ type: `onInsert-has-temp-id`, id: newItem.id })

        // Simulate sending to server and getting back real ID
        const serverItem = await createTodoOnServer(newItem)
        events.push({ type: `server-returned-real-id`, id: serverItem.id })

        // At this point, transaction.state should be 'persisting'
        expect(transaction.state).toBe(`persisting`)

        // Write the server item back to the collection using sync
        if (syncFunctions) {
          syncFunctions.begin()
          syncFunctions.write({
            type: `insert`,
            value: serverItem,
          })
          syncFunctions.commit()
          events.push({ type: `writeInsert-called`, id: serverItem.id })
        }

        return { refetch: false }
      },
    })

    await collection.stateWhenReady()

    // User inserts item with temporary negative ID
    const tempId = -1234
    const insertTx = collection.insert({
      id: tempId,
      title: `Test Task`,
    })
    events.push({ type: `user-insert`, id: tempId })

    // Wait for transaction to complete
    await insertTx.isPersisted.promise

    // Get the real server ID from the mock
    const serverItem = createTodoOnServer.mock.results[0]?.value
    expect(serverItem).toBeDefined()
    const realId = serverItem.id

    // CRITICAL TEST: The collection should now show the server ID, not the temp ID
    // Before the fix, the optimistic state from the persisting transaction would be
    // re-applied, overwriting the server data
    expect(collection.state.has(tempId)).toBe(false)
    expect(collection.state.has(realId)).toBe(true)
    expect(collection.state.get(realId)).toEqual({
      id: realId,
      title: `Test Task`,
    })

    // Verify the event sequence
    expect(events).toContainEqual({ type: `user-insert`, id: tempId })
    expect(events).toContainEqual({ type: `onInsert-called`, id: tempId })
    expect(events).toContainEqual({ type: `onInsert-has-temp-id`, id: tempId })
    expect(events).toContainEqual({ type: `server-returned-real-id`, id: realId })
    expect(events).toContainEqual({ type: `writeInsert-called`, id: realId })
  })

  it(`should handle multiple concurrent inserts with server-generated IDs`, async () => {
    type Todo = { id: number; title: string }

    let idCounter = 1000
    const createTodoOnServer = vi.fn().mockImplementation(async (todo: Todo) => {
      // Simulate server generating sequential IDs
      return { ...todo, id: idCounter++ }
    })

    let syncFunctions: any = null

    const collection = createCollection<Todo>({
      id: `todos-concurrent`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          commit()
          markReady()
          syncFunctions = { begin, write, commit }
        },
      },
      onInsert: async ({ transaction }: { transaction: Transaction<any> }) => {
        const newItem = transaction.mutations[0]!.modified as Todo
        const serverItem = await createTodoOnServer(newItem)

        expect(transaction.state).toBe(`persisting`)

        if (syncFunctions) {
          syncFunctions.begin()
          syncFunctions.write({
            type: `insert`,
            value: serverItem,
          })
          syncFunctions.commit()
        }

        return { refetch: false }
      },
    })

    await collection.stateWhenReady()

    // Insert multiple items with temp IDs
    const tx1 = collection.insert({ id: -1, title: `Task 1` })
    const tx2 = collection.insert({ id: -2, title: `Task 2` })
    const tx3 = collection.insert({ id: -3, title: `Task 3` })

    // Wait for all to complete
    await Promise.all([
      tx1.isPersisted.promise,
      tx2.isPersisted.promise,
      tx3.isPersisted.promise,
    ])

    // All temp IDs should be gone
    expect(collection.state.has(-1)).toBe(false)
    expect(collection.state.has(-2)).toBe(false)
    expect(collection.state.has(-3)).toBe(false)

    // Real IDs should be present
    expect(collection.state.has(1000)).toBe(true)
    expect(collection.state.has(1001)).toBe(true)
    expect(collection.state.has(1002)).toBe(true)

    // Verify data
    expect(collection.state.get(1000)?.title).toBe(`Task 1`)
    expect(collection.state.get(1001)?.title).toBe(`Task 2`)
    expect(collection.state.get(1002)?.title).toBe(`Task 3`)

    expect(collection.state.size).toBe(3)
  })

  it(`should show optimistic temp ID before transaction completes`, async () => {
    type Todo = { id: number; title: string }

    let resolveServerCall: ((value: Todo) => void) | null = null
    const serverPromise = new Promise<Todo>((resolve) => {
      resolveServerCall = resolve
    })

    const createTodoOnServer = vi.fn().mockReturnValue(serverPromise)

    let syncFunctions: any = null

    const collection = createCollection<Todo>({
      id: `todos-optimistic`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          commit()
          markReady()
          syncFunctions = { begin, write, commit }
        },
      },
      onInsert: async ({ transaction }: { transaction: Transaction<any> }) => {
        const newItem = transaction.mutations[0]!.modified as Todo
        const serverItem = await createTodoOnServer(newItem)

        if (syncFunctions) {
          syncFunctions.begin()
          syncFunctions.write({
            type: `insert`,
            value: serverItem,
          })
          syncFunctions.commit()
        }

        return { refetch: false }
      },
    })

    await collection.stateWhenReady()

    const tempId = -5678
    const insertTx = collection.insert({
      id: tempId,
      title: `Optimistic Task`,
    })

    // IMPORTANT: Before server responds, optimistic state should show temp ID
    expect(collection.state.has(tempId)).toBe(true)
    expect(collection.state.get(tempId)).toEqual({
      id: tempId,
      title: `Optimistic Task`,
    })

    // Now resolve server call with real ID
    const realId = 9999
    resolveServerCall!({ id: realId, title: `Optimistic Task` })

    await insertTx.isPersisted.promise

    // After server responds, should show real ID
    expect(collection.state.has(tempId)).toBe(false)
    expect(collection.state.has(realId)).toBe(true)
    expect(collection.state.get(realId)).toEqual({
      id: realId,
      title: `Optimistic Task`,
    })
  })

  it(`should preserve optimistic state when concurrent server update arrives during persisting transaction`, async () => {
    type Todo = { id: number; title: string; completed: boolean }

    let syncFunctions: any = null
    let serverCallResolver: ((value: Todo) => void) | null = null
    const serverPromise = new Promise<Todo>((resolve) => {
      serverCallResolver = resolve
    })

    const collection = createCollection<Todo>({
      id: `todos-concurrent-update`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          // Start with an existing item
          write({
            type: `insert`,
            value: { id: 1, title: `Original Task`, completed: false },
          })
          commit()
          markReady()
          syncFunctions = { begin, write, commit }
        },
      },
      onUpdate: async ({ transaction }: { transaction: Transaction<any> }) => {
        const updatedItem = transaction.mutations[0]!.modified as Todo
        const serverItem = await serverPromise

        expect(transaction.state).toBe(`persisting`)

        // Write server response back
        if (syncFunctions) {
          syncFunctions.begin()
          syncFunctions.write({
            type: `update`,
            value: serverItem,
          })
          syncFunctions.commit()
        }

        return { refetch: false }
      },
    })

    await collection.stateWhenReady()

    // Verify initial state
    expect(collection.state.get(1)).toEqual({
      id: 1,
      title: `Original Task`,
      completed: false,
    })

    // User updates the item (marks as completed)
    const updateTx = collection.update(1, (draft) => {
      draft.completed = true
      draft.title = `Updated Task`
    })

    // At this point, transaction is persisting and optimistic state shows the update
    // Simulate a concurrent server update that arrives with STALE data
    // (from before our mutation, e.g., someone else changed the title earlier)
    if (syncFunctions) {
      syncFunctions.begin()
      syncFunctions.write({
        type: `update`,
        value: { id: 1, title: `Task edited by someone else`, completed: false },
      })
      syncFunctions.commit()
    }

    // CRITICAL: Even though server data arrived, optimistic state should still show
    // the user's update because the transaction is still persisting
    expect(collection.state.get(1)).toEqual({
      id: 1,
      title: `Updated Task`,
      completed: true,
    })

    // Now resolve the server call with successful response
    serverCallResolver!({ id: 1, title: `Updated Task`, completed: true })

    await updateTx.isPersisted.promise

    // After transaction completes, should show the final server data
    expect(collection.state.get(1)).toEqual({
      id: 1,
      title: `Updated Task`,
      completed: true,
    })
  })
})
