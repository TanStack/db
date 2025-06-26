import { describe, expect, expectTypeOf, it, vi } from "vitest"
import { createCollection, createOptimisticAction } from "../src"
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
