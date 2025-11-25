import { describe, expect, expectTypeOf, it, vi } from "vitest"
import { createCollection, createOptimisticAction } from "../src"
import { createLiveQueryCollection, eq } from "../src/query"
import type {
  MutationFnParams,
  Transaction,
  TransactionWithMutations,
} from "../src"

describe(`createOptimisticAction`, () => {
  // Runtime tests
  it(`should apply optimistic updates and execute mutation function`, async () => {
    // Setup a mock collection
    const collection = createCollection<{ id: string; text: string }>({
      id: `test-collection`,
      getKey: (item) => item.id,
      sync: {
        sync: () => {
          // No-op sync for testing
        },
      },
    })

    // Mock functions to verify they're called with correct arguments
    const onMutateMock = vi.fn()
    const mutationFnMock = vi.fn().mockResolvedValue({ success: true })

    // Create an optimistic action with string variables
    const addTodo = createOptimisticAction<string>({
      onMutate: (text) => {
        // Verify text is a string
        expect(typeof text).toBe(`string`)
        collection.insert({ id: `1`, text })
        onMutateMock(text)
      },
      mutationFn: async (text, params) => {
        // Verify text is a string and params has transaction
        expect(typeof text).toBe(`string`)
        expect(params).toHaveProperty(`transaction`)
        return Promise.resolve(mutationFnMock(text, params))
      },
    })

    // Execute the optimistic action
    const transaction = addTodo(`Test Todo`)

    // Verify onMutate was called immediately with the correct argument
    expect(onMutateMock).toHaveBeenCalledWith(`Test Todo`)

    // Verify the optimistic update was applied to the collection
    expect(collection.get(`1`)).toEqual({ id: `1`, text: `Test Todo` })

    // Wait for the mutation to complete
    await transaction.isPersisted.promise

    // Verify mutationFn was called with the correct arguments
    expect(mutationFnMock).toHaveBeenCalledTimes(1)
    expect(mutationFnMock.mock.calls[0]?.[0]).toBe(`Test Todo`)
    expect(mutationFnMock.mock.calls[0]?.[1]).toHaveProperty(`transaction`)
  })

  it(`should throw if onMutate returns a promise`, () => {
    const collection = createCollection<{ id: string; text: string }>({
      id: `async-on-mutate-collection`,
      getKey: (item) => item.id,
      sync: {
        sync: () => {
          // No-op sync for testing
        },
      },
    })

    const addTodo = createOptimisticAction<string>({
      onMutate: async (text) => {
        collection.insert({ id: `1`, text })
      },
      mutationFn: async () => {
        return Promise.resolve()
      },
    })

    expect(() => addTodo(`Async Todo`)).toThrowError(
      `onMutate must be synchronous`
    )
  })

  // Test with complex object variables
  it(`should handle complex object variables correctly`, async () => {
    // Setup a mock collection
    const collection = createCollection<{
      id: string
      name: string
      completed: boolean
    }>({
      id: `todo-collection`,
      getKey: (item) => item.id,
      sync: {
        sync: () => {
          // No-op sync for testing
        },
      },
    })

    // Mock functions
    const onMutateMock = vi.fn()
    const mutationFnMock = vi.fn().mockResolvedValue({ success: true })

    // Define a complex type for our variables
    type TodoInput = {
      id: string
      name: string
      completed: boolean
    }

    // Create an optimistic action with complex object variables
    const addComplexTodo = createOptimisticAction<TodoInput>({
      onMutate: (todoInput) => {
        // Verify todoInput has the expected shape
        expect(todoInput).toHaveProperty(`id`)
        expect(todoInput).toHaveProperty(`name`)
        expect(todoInput).toHaveProperty(`completed`)

        collection.insert(todoInput)
        onMutateMock(todoInput)
      },
      mutationFn: async (todoInput, params) => {
        // Verify todoInput has the expected shape and params has transaction
        expect(todoInput).toHaveProperty(`id`)
        expect(todoInput).toHaveProperty(`name`)
        expect(todoInput).toHaveProperty(`completed`)
        expect(params).toHaveProperty(`transaction`)

        return Promise.resolve(mutationFnMock(todoInput, params))
      },
    })

    // Execute the optimistic action with a complex object
    const todoData = { id: `2`, name: `Complex Todo`, completed: false }
    const transaction = addComplexTodo(todoData)

    // Verify onMutate was called with the correct object
    expect(onMutateMock).toHaveBeenCalledWith(todoData)

    // Verify the optimistic update was applied to the collection
    expect(collection.get(`2`)).toEqual(todoData)

    // Wait for the mutation to complete
    await transaction.isPersisted.promise

    // Verify mutationFn was called with the correct arguments
    expect(mutationFnMock).toHaveBeenCalledTimes(1)
    expect(mutationFnMock.mock.calls[0]?.[0]).toEqual(todoData)
    expect(mutationFnMock.mock.calls[0]?.[1]).toHaveProperty(`transaction`)
  })

  // Type tests using expectTypeOf
  it(`should enforce correct types for variables`, () => {
    // String variables
    const stringAction = createOptimisticAction<string>({
      onMutate: (text) => {
        // Verify text is inferred as string
        expectTypeOf(text).toBeString()
      },
      mutationFn: async (text, params) => {
        // Verify text is inferred as string and params has transaction
        expectTypeOf(text).toBeString()
        expectTypeOf(params).toEqualTypeOf<MutationFnParams>()
        expectTypeOf(
          params.transaction
        ).toEqualTypeOf<TransactionWithMutations>()
        return Promise.resolve({ success: true })
      },
    })

    // Verify the returned function accepts a string and returns a Transaction
    expectTypeOf(stringAction).parameters.toEqualTypeOf<[string]>()
    expectTypeOf(stringAction).returns.toEqualTypeOf<Transaction>()

    // Complex object variables
    interface User {
      id: number
      name: string
      email: string
    }

    const userAction = createOptimisticAction<User>({
      onMutate: (user) => {
        // Verify user is inferred as User
        expectTypeOf(user).toEqualTypeOf<User>()
        expectTypeOf(user.id).toBeNumber()
        expectTypeOf(user.name).toBeString()
        expectTypeOf(user.email).toBeString()
      },
      mutationFn: async (user, params) => {
        // Verify user is inferred as User and params has transaction
        expectTypeOf(user).toEqualTypeOf<User>()
        expectTypeOf(user.id).toBeNumber()
        expectTypeOf(params).toEqualTypeOf<MutationFnParams>()
        expectTypeOf(
          params.transaction
        ).toEqualTypeOf<TransactionWithMutations>()
        return Promise.resolve({ success: true })
      },
    })

    // Verify the returned function accepts a User and returns a Transaction
    expectTypeOf(userAction).parameters.toEqualTypeOf<[User]>()
    expectTypeOf(userAction).returns.toEqualTypeOf<Transaction>()
  })

  // Test with syncMode "on-demand"
  it(`should call mutationFn when using syncMode on-demand`, async () => {
    // This test reproduces the bug where mutationFn is not called
    // when the collection is configured with syncMode: "on-demand"
    // Bug report: https://discord.com/channels/...
    // - onMutate runs but mutationFn never runs
    // - works with eager mode but not on-demand

    const onMutateMock = vi.fn()
    const mutationFnMock = vi.fn().mockResolvedValue({ success: true })

    // Create a collection with syncMode: "on-demand"
    // This requires a loadSubset handler
    const collection = createCollection<{ id: string; text: string }>({
      id: `on-demand-collection`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          // For on-demand mode, we mark ready immediately but don't load data
          // Data is loaded on-demand via loadSubset
          markReady()

          return {
            loadSubset: () => {
              // No-op for testing - just return true to indicate sync
              return true
            },
          }
        },
      },
    })

    // Create an optimistic action
    const addTodo = createOptimisticAction<string>({
      onMutate: (text) => {
        collection.insert({ id: `1`, text })
        onMutateMock(text)
      },
      mutationFn: async (text, params) => {
        return Promise.resolve(mutationFnMock(text, params))
      },
    })

    // Execute the optimistic action
    const transaction = addTodo(`Test Todo`)

    // Verify onMutate was called
    expect(onMutateMock).toHaveBeenCalledWith(`Test Todo`)

    // Verify the optimistic update was applied to the collection
    expect(collection.get(`1`)).toEqual({ id: `1`, text: `Test Todo` })

    // Wait for the mutation to complete
    await transaction.isPersisted.promise

    // BUG: mutationFn should be called but it's not!
    expect(mutationFnMock).toHaveBeenCalledTimes(1)
  })

  // Test with syncMode "on-demand" where collection has NOT started sync yet
  it(`should call mutationFn when collection is not started (idle)`, async () => {
    // This test checks if mutationFn is called when the collection hasn't started sync
    const onMutateMock = vi.fn()
    const mutationFnMock = vi.fn().mockResolvedValue({ success: true })

    // Create a collection that doesn't start sync automatically
    const collection = createCollection<{ id: string; text: string }>({
      id: `idle-collection`,
      getKey: (item) => item.id,
      startSync: false,
      sync: {
        sync: () => {
          // No-op sync for testing
        },
      },
    })

    // Create an optimistic action
    const addTodo = createOptimisticAction<string>({
      onMutate: (text) => {
        collection.insert({ id: `1`, text })
        onMutateMock(text)
      },
      mutationFn: async (text, params) => {
        return Promise.resolve(mutationFnMock(text, params))
      },
    })

    // Execute the optimistic action (collection is in idle state)
    const transaction = addTodo(`Test Todo`)

    // Verify onMutate was called
    expect(onMutateMock).toHaveBeenCalledWith(`Test Todo`)

    // Verify the optimistic update was applied
    expect(collection.get(`1`)).toEqual({ id: `1`, text: `Test Todo` })

    // Wait for the mutation to complete
    await transaction.isPersisted.promise

    // mutationFn should be called
    expect(mutationFnMock).toHaveBeenCalledTimes(1)
  })

  // Test with syncMode "on-demand" where sync is in loading state (not ready yet)
  it(`should call mutationFn when collection is loading (not ready)`, async () => {
    // This test checks if mutationFn is called when the collection is still loading
    const onMutateMock = vi.fn()
    const mutationFnMock = vi.fn().mockResolvedValue({ success: true })

    // Create a collection that starts sync but doesn't call markReady
    const collection = createCollection<{ id: string; text: string }>({
      id: `loading-collection`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: () => {
          // Intentionally don't call markReady - collection stays in "loading" state
          return () => {}
        },
      },
    })

    // Create an optimistic action
    const addTodo = createOptimisticAction<string>({
      onMutate: (text) => {
        collection.insert({ id: `1`, text })
        onMutateMock(text)
      },
      mutationFn: async (text, params) => {
        return Promise.resolve(mutationFnMock(text, params))
      },
    })

    // Execute the optimistic action (collection is in loading state)
    const transaction = addTodo(`Test Todo`)

    // Verify onMutate was called
    expect(onMutateMock).toHaveBeenCalledWith(`Test Todo`)

    // Verify the optimistic update was applied
    expect(collection.get(`1`)).toEqual({ id: `1`, text: `Test Todo` })

    // Wait for the mutation to complete
    await transaction.isPersisted.promise

    // mutationFn should be called
    expect(mutationFnMock).toHaveBeenCalledTimes(1)
  })

  // Test with on-demand collection and a live query with filters - the reported scenario
  it(`should call mutationFn with on-demand collection and live query filter`, async () => {
    // This test attempts to reproduce the exact bug scenario:
    // - Base collection with syncMode: "on-demand"
    // - Live query collection with filters on top
    // - createOptimisticAction used to mutate the base collection
    // - Bug: onMutate runs but mutationFn never runs

    const onMutateMock = vi.fn()
    const mutationFnMock = vi.fn().mockResolvedValue({ success: true })

    // Create a base collection with syncMode: "on-demand"
    type Todo = { id: string; text: string; status: string }
    const baseCollection = createCollection<Todo>({
      id: `on-demand-base-collection`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ markReady, begin, write, commit }) => {
          // Simulate on-demand mode: mark ready immediately, load data on demand
          markReady()

          // Pre-populate with some data
          begin()
          write({
            type: `insert`,
            value: { id: `1`, text: `Existing todo`, status: `active` },
          })
          commit()

          return {
            loadSubset: () => {
              return true
            },
          }
        },
      },
    })

    // Create a live query collection with a filter on status
    const activeTodos = createLiveQueryCollection({
      id: `active-todos-query`,
      startSync: true,
      query: (q) =>
        q
          .from({ todo: baseCollection })
          .where(({ todo }) => eq(todo.status, `active`))
          .select(({ todo }) => ({ todo })),
    })

    // Wait for the live query to be ready
    await activeTodos.preload()

    // Verify initial state
    expect([...activeTodos.values()].length).toBe(1)
    expect([...activeTodos.values()][0]?.todo.text).toBe(`Existing todo`)

    // Create an optimistic action to INSERT a new todo
    const addTodo = createOptimisticAction<{ text: string }>({
      onMutate: (input) => {
        baseCollection.insert({ id: `2`, text: input.text, status: `active` })
        onMutateMock(input)
      },
      mutationFn: async (input, params) => {
        return Promise.resolve(mutationFnMock(input, params))
      },
    })

    // Execute the optimistic action
    const transaction = addTodo({ text: `New todo` })

    // Verify onMutate was called
    expect(onMutateMock).toHaveBeenCalledWith({ text: `New todo` })

    // Verify the optimistic update was applied to the base collection
    expect(baseCollection.get(`2`)).toEqual({
      id: `2`,
      text: `New todo`,
      status: `active`,
    })

    // Wait for the mutation to complete
    await transaction.isPersisted.promise

    // BUG: mutationFn should be called!
    expect(mutationFnMock).toHaveBeenCalledTimes(1)
  })

  // Test UPDATE scenario which might have different behavior
  it(`should call mutationFn when UPDATE is performed on on-demand collection`, async () => {
    const onMutateMock = vi.fn()
    const mutationFnMock = vi.fn().mockResolvedValue({ success: true })

    type Todo = { id: string; text: string; status: string }
    const collection = createCollection<Todo>({
      id: `on-demand-update-collection`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ markReady, begin, write, commit }) => {
          markReady()

          // Pre-populate with data
          begin()
          write({
            type: `insert`,
            value: { id: `1`, text: `Original text`, status: `active` },
          })
          commit()

          return {
            loadSubset: () => true,
          }
        },
      },
    })

    // Create an optimistic action to UPDATE an existing todo
    const updateTodo = createOptimisticAction<{ id: string; text: string }>({
      onMutate: (input) => {
        collection.update(input.id, (draft) => {
          draft.text = input.text
        })
        onMutateMock(input)
      },
      mutationFn: async (input, params) => {
        return Promise.resolve(mutationFnMock(input, params))
      },
    })

    // Execute the optimistic action
    const transaction = updateTodo({ id: `1`, text: `Updated text` })

    // Verify onMutate was called
    expect(onMutateMock).toHaveBeenCalledWith({ id: `1`, text: `Updated text` })

    // Verify the optimistic update was applied
    expect(collection.get(`1`)?.text).toBe(`Updated text`)

    // Wait for the mutation to complete
    await transaction.isPersisted.promise

    // mutationFn should be called
    expect(mutationFnMock).toHaveBeenCalledTimes(1)
  })

  // Debug test: verify mutations array is populated correctly
  it(`should have mutations in the transaction after onMutate completes`, async () => {
    const onMutateMock = vi.fn()
    const mutationFnMock = vi.fn().mockResolvedValue({ success: true })

    // Create an on-demand collection with live query filter
    type Todo = { id: string; text: string; status: string }
    const baseCollection = createCollection<Todo>({
      id: `debug-collection`,
      getKey: (item) => item.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => true,
          }
        },
      },
    })

    // Track mutations count at mutationFn call time
    let mutationsAtMutationFn: number | undefined

    const addTodo = createOptimisticAction<{ text: string }>({
      onMutate: (input) => {
        baseCollection.insert({ id: `1`, text: input.text, status: `active` })
        onMutateMock(input)
      },
      mutationFn: async (input, params) => {
        // Record the number of mutations at this point
        mutationsAtMutationFn = params.transaction.mutations.length
        return Promise.resolve(mutationFnMock(input, params))
      },
    })

    const transaction = addTodo({ text: `Test` })

    // Verify onMutate was called
    expect(onMutateMock).toHaveBeenCalled()

    // Wait for the transaction to complete
    await transaction.isPersisted.promise

    // Verify mutationFn was called
    expect(mutationFnMock).toHaveBeenCalledTimes(1)

    // Verify there was at least one mutation
    expect(mutationsAtMutationFn).toBeGreaterThan(0)
  })

  // Test error handling
  it(`should handle errors in mutationFn correctly`, async () => {
    // Setup a mock collection
    const collection = createCollection<{ id: string; text: string }>({
      id: `error-collection`,
      getKey: (item) => item.id,
      sync: {
        sync: () => {
          // No-op sync for testing
        },
      },
    })

    // Create an optimistic action that will fail
    const failingAction = createOptimisticAction<string>({
      onMutate: (text) => {
        collection.insert({ id: `3`, text })
      },
      mutationFn: () => {
        throw new Error(`Mutation failed`)
      },
    })

    // Execute the optimistic action
    const transaction = failingAction(`Will Fail`)

    // Verify the optimistic update was applied
    expect(collection.get(`3`)).toEqual({ id: `3`, text: `Will Fail` })

    // Wait for the transaction to complete (it will fail)
    try {
      await transaction.isPersisted.promise
      // Should not reach here
      expect(true).toBe(false)
    } catch (error) {
      // Verify the error was caught
      expect(error).toBeDefined()
      expect(transaction.state).toBe(`failed`)
      expect(transaction.error).toBeDefined()
      expect(transaction.error?.message).toContain(`Mutation failed`)
    }
  })
})
