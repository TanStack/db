import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection'
import { createPacedMutations } from '../src/paced-mutations'
import {
  debounceStrategy,
  queueStrategy,
  throttleStrategy,
} from '../src/strategies'
import { mockSyncCollectionOptionsNoInitialState } from './utils'

type Item = {
  id: number
  value: number
}

/**
 * Helper to create a collection that's ready for testing.
 * Handles all the boilerplate setup: preload, begin, commit, markReady.
 */
async function createReadyCollection<T extends object>(opts: {
  id: string
  getKey: (item: T) => string | number
}) {
  const collection = createCollection(
    mockSyncCollectionOptionsNoInitialState<T>(opts),
  )

  const preloadPromise = collection.preload()
  collection.utils.begin()
  collection.utils.commit()
  collection.utils.markReady()
  await preloadPromise

  return collection
}

describe(`createPacedMutations`, () => {
  describe(`with debounce strategy`, () => {
    it(`should batch multiple rapid mutations into a single transaction`, async () => {
      const mutationFn = vi.fn(async () => {})

      const collection = await createReadyCollection<Item>({
        id: `test`,
        getKey: (item) => item.id,
      })

      let insertCount = 0
      const mutate = createPacedMutations<{ id: number; value: number }>({
        onMutate: (item) => {
          if (insertCount === 0) {
            collection.insert(item)
            insertCount++
          } else {
            collection.update(item.id, (draft) => {
              draft.value = item.value
            })
          }
        },
        mutationFn,
        strategy: debounceStrategy({ wait: 50 }),
      })

      // Trigger three rapid mutations (all within 50ms debounce window)
      const tx1 = mutate({ id: 1, value: 1 })
      const tx2 = mutate({ id: 1, value: 2 })
      const tx3 = mutate({ id: 1, value: 3 })

      // All three calls should return the SAME transaction object
      expect(tx1).toBe(tx2)
      expect(tx2).toBe(tx3)

      // Mutations get auto-merged (insert + updates on same key = single insert with final value)
      expect(tx1.mutations).toHaveLength(1)
      expect(tx1.mutations[0]).toMatchObject({
        type: `insert`,
        changes: { id: 1, value: 3 }, // Final merged value
      })

      // mutationFn should NOT have been called yet (still debouncing)
      expect(mutationFn).not.toHaveBeenCalled()

      // Wait for debounce period
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Now mutationFn should have been called ONCE with the merged mutation
      expect(mutationFn).toHaveBeenCalledTimes(1)
      expect(mutationFn).toHaveBeenCalledWith({
        transaction: expect.objectContaining({
          mutations: [
            expect.objectContaining({
              type: `insert`,
              changes: { id: 1, value: 3 },
            }),
          ],
        }),
      })

      // Transaction should be completed
      expect(tx1.state).toBe(`completed`)
    })

    it(`should reset debounce timer on each new mutation`, async () => {
      const mutationFn = vi.fn(async () => {})

      const collection = await createReadyCollection<Item>({
        id: `test`,
        getKey: (item) => item.id,
      })

      let insertCount = 0
      const mutate = createPacedMutations<{ id: number; value: number }>({
        onMutate: (item) => {
          if (insertCount === 0) {
            collection.insert(item)
            insertCount++
          } else {
            collection.update(item.id, (draft) => {
              draft.value = item.value
            })
          }
        },
        mutationFn,
        strategy: debounceStrategy({ wait: 50 }),
      })

      // First mutation at t=0
      mutate({ id: 1, value: 1 })

      // Wait 40ms (still within 50ms debounce window)
      await new Promise((resolve) => setTimeout(resolve, 40))

      // mutationFn should NOT have been called yet
      expect(mutationFn).not.toHaveBeenCalled()

      // Second mutation at t=40 (resets the timer)
      mutate({ id: 1, value: 2 })

      // Wait another 40ms (t=80, but only 40ms since last mutation)
      await new Promise((resolve) => setTimeout(resolve, 40))

      // mutationFn still should NOT have been called (timer was reset)
      expect(mutationFn).not.toHaveBeenCalled()

      // Wait another 20ms (t=100, now 60ms since last mutation, past the 50ms debounce)
      await new Promise((resolve) => setTimeout(resolve, 20))

      // NOW mutationFn should have been called
      expect(mutationFn).toHaveBeenCalledTimes(1)
      const firstCall = (mutationFn.mock.calls as any)[0]
      expect(firstCall[0].transaction.mutations).toHaveLength(1)
    })

    it(`should execute on leading edge when leading: true`, async () => {
      const mutationFn = vi.fn(async () => {})

      const collection = await createReadyCollection<Item>({
        id: `test`,
        getKey: (item) => item.id,
      })

      const mutate = createPacedMutations<Item>({
        onMutate: (item) => {
          collection.insert(item)
        },
        mutationFn,
        strategy: debounceStrategy({ wait: 50, leading: true }),
      })

      // First mutation should execute immediately with leading: true
      const tx1 = mutate({ id: 1, value: 1 })

      // Small delay for immediate execution
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Should have been called immediately (leading edge)
      expect(mutationFn).toHaveBeenCalledTimes(1)
      expect(tx1.state).toBe(`completed`)
    })
  })

  describe(`with throttle strategy`, () => {
    it(`should throttle mutations with leading and trailing execution`, async () => {
      const mutationFn = vi.fn(async () => {})

      const collection = await createReadyCollection<Item>({
        id: `test`,
        getKey: (item) => item.id,
      })

      const mutate = createPacedMutations<Item>({
        onMutate: (item) => {
          collection.insert(item)
        },
        mutationFn,
        strategy: throttleStrategy({
          wait: 100,
          leading: true,
          trailing: true,
        }),
      })

      // First mutation at t=0 (should execute immediately due to leading: true)
      const tx1 = mutate({ id: 1, value: 1 })

      // Leading edge should execute immediately
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(mutationFn).toHaveBeenCalledTimes(1)
      expect(tx1.state).toBe(`completed`)

      // Second mutation at t=20 (during throttle period, should batch)
      const tx2 = mutate({ id: 2, value: 2 })

      // Third mutation at t=30 (during throttle period, should batch with second)
      await new Promise((resolve) => setTimeout(resolve, 10))
      const tx3 = mutate({ id: 3, value: 3 })

      // tx2 and tx3 should be the same transaction (batched)
      expect(tx2).toBe(tx3)

      // Still only 1 call (waiting for throttle period to end)
      expect(mutationFn).toHaveBeenCalledTimes(1)

      // Wait for throttle period to complete (100ms from first mutation)
      await new Promise((resolve) => setTimeout(resolve, 110))

      // Trailing edge should have executed
      expect(mutationFn).toHaveBeenCalledTimes(2)
      expect(tx2.state).toBe(`completed`)
      expect(tx3.state).toBe(`completed`)

      // Verify the batched transaction has 2 inserts
      expect(tx2.mutations).toHaveLength(2)
    })

    it(`should respect leading: false option`, async () => {
      const mutationFn = vi.fn(async () => {})

      const collection = await createReadyCollection<Item>({
        id: `test`,
        getKey: (item) => item.id,
      })

      const mutate = createPacedMutations<Item>({
        onMutate: (item) => {
          collection.insert(item)
        },
        mutationFn,
        strategy: throttleStrategy({
          wait: 50,
          leading: false,
          trailing: true,
        }),
      })

      // First mutation should NOT execute immediately with leading: false
      const tx1 = mutate({ id: 1, value: 1 })

      // Wait for throttle period to complete
      await new Promise((resolve) => setTimeout(resolve, 70))

      // Now trailing edge should have executed
      expect(mutationFn).toHaveBeenCalledTimes(1)
      await tx1.isPersisted.promise
      expect(tx1.state).toBe(`completed`)
    })
  })

  describe(`with queue strategy`, () => {
    it(`should process mutations sequentially`, async () => {
      const mutationFn = vi.fn(async () => {
        // Quick execution
        await new Promise((resolve) => setTimeout(resolve, 5))
      })

      const collection = await createReadyCollection<Item>({
        id: `test`,
        getKey: (item) => item.id,
      })

      const mutate = createPacedMutations<Item>({
        onMutate: (item) => {
          collection.insert(item)
        },
        mutationFn,
        strategy: queueStrategy({ wait: 10 }),
      })

      // Trigger rapid mutations - queue creates separate transactions
      const tx1 = mutate({ id: 1, value: 1 })
      const tx2 = mutate({ id: 2, value: 2 })
      const tx3 = mutate({ id: 3, value: 3 })

      // Each should be a different transaction
      expect(tx1).not.toBe(tx2)
      expect(tx2).not.toBe(tx3)

      // Queue starts processing immediately
      await new Promise((resolve) => setTimeout(resolve, 5))
      expect(mutationFn).toHaveBeenCalledTimes(1)

      // Wait for first transaction to complete
      await tx1.isPersisted.promise
      expect(tx1.state).toBe(`completed`)

      // Each mutation should be in its own transaction
      expect(tx1.mutations).toHaveLength(1)
      expect(tx1.mutations[0]).toMatchObject({
        type: `insert`,
        changes: { id: 1, value: 1 },
      })
    })

    it(`should ensure serialization - wait for each transaction to complete`, async () => {
      const executionOrder: Array<number> = []
      let currentlyExecuting = false

      const mutationFn = vi.fn(async ({ transaction }) => {
        // Verify no concurrent execution
        expect(currentlyExecuting).toBe(false)
        currentlyExecuting = true

        const id = transaction.mutations[0].changes.id
        executionOrder.push(id)

        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 20))

        currentlyExecuting = false
      })

      const collection = await createReadyCollection<Item>({
        id: `test`,
        getKey: (item) => item.id,
      })

      const mutate = createPacedMutations<Item>({
        onMutate: (item) => {
          collection.insert(item)
        },
        mutationFn,
        strategy: queueStrategy({ wait: 5 }),
      })

      // Trigger rapid mutations
      const tx1 = mutate({ id: 1, value: 1 })
      const tx2 = mutate({ id: 2, value: 2 })
      const tx3 = mutate({ id: 3, value: 3 })

      // Wait for all to complete
      await Promise.all([
        tx1.isPersisted.promise,
        tx2.isPersisted.promise,
        tx3.isPersisted.promise,
      ])

      // Should have executed in order
      expect(executionOrder).toEqual([1, 2, 3])

      // All should be completed
      expect(tx1.state).toBe(`completed`)
      expect(tx2.state).toBe(`completed`)
      expect(tx3.state).toBe(`completed`)
    })

    it(`should process each mutation in its own transaction`, async () => {
      const mutationFn = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
      })

      const collection = await createReadyCollection<Item>({
        id: `test`,
        getKey: (item) => item.id,
      })

      const mutate = createPacedMutations<Item>({
        onMutate: (item) => {
          collection.insert(item)
        },
        mutationFn,
        strategy: queueStrategy({ wait: 5 }),
      })

      const tx1 = mutate({ id: 1, value: 1 })
      const tx2 = mutate({ id: 2, value: 2 })
      const tx3 = mutate({ id: 3, value: 3 })

      // Each should be a separate transaction
      expect(tx1).not.toBe(tx2)
      expect(tx2).not.toBe(tx3)
      expect(tx1).not.toBe(tx3)

      await Promise.all([
        tx1.isPersisted.promise,
        tx2.isPersisted.promise,
        tx3.isPersisted.promise,
      ])

      // All mutations should have been executed
      expect(mutationFn).toHaveBeenCalledTimes(3)

      // Each transaction should have exactly one mutation
      expect(tx1.mutations).toHaveLength(1)
      expect(tx2.mutations).toHaveLength(1)
      expect(tx3.mutations).toHaveLength(1)
    })

    it(`should work with zero or no wait option`, async () => {
      const mutationFn = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
      })

      const collection = await createReadyCollection<Item>({
        id: `test`,
        getKey: (item) => item.id,
      })

      // Test with explicit wait: 0
      const mutateExplicitZero = createPacedMutations<Item>({
        onMutate: (item) => {
          collection.insert(item)
        },
        mutationFn,
        strategy: queueStrategy({ wait: 0 }),
      })

      const tx1 = mutateExplicitZero({ id: 1, value: 1 })
      const tx2 = mutateExplicitZero({ id: 2, value: 2 })

      // Should still process sequentially even with zero wait
      await Promise.all([tx1.isPersisted.promise, tx2.isPersisted.promise])

      expect(mutationFn).toHaveBeenCalledTimes(2)
      expect(tx1.state).toBe(`completed`)
      expect(tx2.state).toBe(`completed`)

      mutationFn.mockClear()

      // Test with no wait option (defaults to 0)
      const mutateNoWait = createPacedMutations<Item>({
        onMutate: (item) => {
          collection.insert(item)
        },
        mutationFn,
        strategy: queueStrategy(),
      })

      const tx3 = mutateNoWait({ id: 3, value: 3 })
      const tx4 = mutateNoWait({ id: 4, value: 4 })

      await Promise.all([tx3.isPersisted.promise, tx4.isPersisted.promise])

      expect(mutationFn).toHaveBeenCalledTimes(2)
      expect(tx3.state).toBe(`completed`)
      expect(tx4.state).toBe(`completed`)
    })
  })

  describe(`error handling`, () => {
    it(`should handle mutationFn errors and set transaction to failed state`, async () => {
      const error = new Error(`Mutation failed`)
      const mutationFn = vi.fn(async () => {
        throw error
      })

      const collection = await createReadyCollection<Item>({
        id: `test`,
        getKey: (item) => item.id,
      })

      const mutate = createPacedMutations<Item>({
        onMutate: (item) => {
          collection.insert(item)
        },
        mutationFn,
        strategy: debounceStrategy({ wait: 10 }),
      })

      const tx = mutate({ id: 1, value: 1 })

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 30))

      // Transaction should be in failed state
      expect(tx.state).toBe(`failed`)
      await expect(tx.isPersisted.promise).rejects.toThrow(`Mutation failed`)
    })

    it(`should continue processing queue after an error`, async () => {
      const mutationFn = vi
        .fn()
        .mockRejectedValueOnce(new Error(`First failed`))
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)

      const collection = await createReadyCollection<Item>({
        id: `test`,
        getKey: (item) => item.id,
      })

      const mutate = createPacedMutations<Item>({
        onMutate: (item) => {
          collection.insert(item)
        },
        mutationFn,
        strategy: queueStrategy({ wait: 10 }),
      })

      const tx1 = mutate({ id: 1, value: 1 })
      const tx2 = mutate({ id: 2, value: 2 })
      const tx3 = mutate({ id: 3, value: 3 })

      // Wait for all to settle
      await Promise.allSettled([
        tx1.isPersisted.promise,
        tx2.isPersisted.promise,
        tx3.isPersisted.promise,
      ])

      // First should fail, rest should succeed
      expect(tx1.state).toBe(`failed`)
      expect(tx2.state).toBe(`completed`)
      expect(tx3.state).toBe(`completed`)

      // All three should have been attempted
      expect(mutationFn).toHaveBeenCalledTimes(3)
    })
  })

  describe(`cross-queue dependencies`, () => {
    it(`should wait for dependsOn transaction before executing mutationFn`, async () => {
      const executionOrder: Array<string> = []

      const collectionA = await createReadyCollection<{ id: string; name: string }>({
        id: `collection-a`,
        getKey: (item) => item.id,
      })

      const collectionB = await createReadyCollection<{ id: string; aId: string }>({
        id: `collection-b`,
        getKey: (item) => item.id,
      })

      const createA = createPacedMutations<{ id: string; name: string }>({
        onMutate: (item) => {
          collectionA.insert(item)
        },
        mutationFn: async ({ transaction }) => {
          // Simulate network delay
          await new Promise((resolve) => setTimeout(resolve, 50))
          executionOrder.push(`A:${transaction.mutations[0].changes.id}`)
        },
        strategy: queueStrategy(),
      })

      const createB = createPacedMutations<{ id: string; aId: string }>({
        onMutate: (item) => {
          collectionB.insert(item)
        },
        mutationFn: async ({ transaction }) => {
          executionOrder.push(`B:${transaction.mutations[0].changes.id}`)
        },
        strategy: queueStrategy(),
      })

      // Create A first, then B with dependency on A
      const txA = createA({ id: `a1`, name: `Parent` })
      const txB = createB({ id: `b1`, aId: `a1` }, { dependsOn: txA })

      // Both should show optimistically immediately
      expect(collectionA.get(`a1`)).toMatchObject({ id: `a1`, name: `Parent` })
      expect(collectionB.get(`b1`)).toMatchObject({ id: `b1`, aId: `a1` })

      // Wait for both to complete
      await Promise.all([
        txA.isPersisted.promise,
        txB.isPersisted.promise,
      ])

      // A should have executed before B
      expect(executionOrder).toEqual([`A:a1`, `B:b1`])
    })

    it(`should support multiple dependencies`, async () => {
      const executionOrder: Array<string> = []

      const collectionA = await createReadyCollection<{ id: string }>({
        id: `collection-a`,
        getKey: (item) => item.id,
      })

      const collectionB = await createReadyCollection<{ id: string }>({
        id: `collection-b`,
        getKey: (item) => item.id,
      })

      const collectionC = await createReadyCollection<{ id: string; aId: string; bId: string }>({
        id: `collection-c`,
        getKey: (item) => item.id,
      })

      const createA = createPacedMutations<{ id: string }>({
        onMutate: (item) => collectionA.insert(item),
        mutationFn: async ({ transaction }) => {
          await new Promise((resolve) => setTimeout(resolve, 30))
          executionOrder.push(`A:${transaction.mutations[0].changes.id}`)
        },
        strategy: queueStrategy(),
      })

      const createB = createPacedMutations<{ id: string }>({
        onMutate: (item) => collectionB.insert(item),
        mutationFn: async ({ transaction }) => {
          await new Promise((resolve) => setTimeout(resolve, 20))
          executionOrder.push(`B:${transaction.mutations[0].changes.id}`)
        },
        strategy: queueStrategy(),
      })

      const createC = createPacedMutations<{ id: string; aId: string; bId: string }>({
        onMutate: (item) => collectionC.insert(item),
        mutationFn: async ({ transaction }) => {
          executionOrder.push(`C:${transaction.mutations[0].changes.id}`)
        },
        strategy: queueStrategy(),
      })

      // Create A and B, then C depending on both
      const txA = createA({ id: `a1` })
      const txB = createB({ id: `b1` })
      const txC = createC(
        { id: `c1`, aId: `a1`, bId: `b1` },
        { dependsOn: [txA, txB] },
      )

      await Promise.all([
        txA.isPersisted.promise,
        txB.isPersisted.promise,
        txC.isPersisted.promise,
      ])

      // C should be last
      expect(executionOrder[executionOrder.length - 1]).toBe(`C:c1`)
      // Both A and B should have executed before C
      expect(executionOrder.indexOf(`A:a1`)).toBeLessThan(executionOrder.indexOf(`C:c1`))
      expect(executionOrder.indexOf(`B:b1`)).toBeLessThan(executionOrder.indexOf(`C:c1`))
    })

    it(`should support chained dependencies (A -> B -> C)`, async () => {
      const executionOrder: Array<string> = []

      const collectionA = await createReadyCollection<{ id: string }>({
        id: `collection-a`,
        getKey: (item) => item.id,
      })

      const collectionB = await createReadyCollection<{ id: string; aId: string }>({
        id: `collection-b`,
        getKey: (item) => item.id,
      })

      const collectionC = await createReadyCollection<{ id: string; bId: string }>({
        id: `collection-c`,
        getKey: (item) => item.id,
      })

      const createA = createPacedMutations<{ id: string }>({
        onMutate: (item) => collectionA.insert(item),
        mutationFn: async ({ transaction }) => {
          await new Promise((resolve) => setTimeout(resolve, 30))
          executionOrder.push(`A:${transaction.mutations[0].changes.id}`)
        },
        strategy: queueStrategy(),
      })

      const createB = createPacedMutations<{ id: string; aId: string }>({
        onMutate: (item) => collectionB.insert(item),
        mutationFn: async ({ transaction }) => {
          await new Promise((resolve) => setTimeout(resolve, 20))
          executionOrder.push(`B:${transaction.mutations[0].changes.id}`)
        },
        strategy: queueStrategy(),
      })

      const createC = createPacedMutations<{ id: string; bId: string }>({
        onMutate: (item) => collectionC.insert(item),
        mutationFn: async ({ transaction }) => {
          executionOrder.push(`C:${transaction.mutations[0].changes.id}`)
        },
        strategy: queueStrategy(),
      })

      // Create chained dependencies: A -> B -> C
      const txA = createA({ id: `a1` })
      const txB = createB({ id: `b1`, aId: `a1` }, { dependsOn: txA })
      const txC = createC({ id: `c1`, bId: `b1` }, { dependsOn: txB })

      // All should show optimistically immediately
      expect(collectionA.get(`a1`)).toBeDefined()
      expect(collectionB.get(`b1`)).toBeDefined()
      expect(collectionC.get(`c1`)).toBeDefined()

      await Promise.all([
        txA.isPersisted.promise,
        txB.isPersisted.promise,
        txC.isPersisted.promise,
      ])

      // Should execute in order A -> B -> C
      expect(executionOrder).toEqual([`A:a1`, `B:b1`, `C:c1`])
    })

    it(`should continue if dependency fails`, async () => {
      const executionOrder: Array<string> = []

      const collectionA = await createReadyCollection<{ id: string }>({
        id: `collection-a`,
        getKey: (item) => item.id,
      })

      const collectionB = await createReadyCollection<{ id: string; aId: string }>({
        id: `collection-b`,
        getKey: (item) => item.id,
      })

      const createA = createPacedMutations<{ id: string }>({
        onMutate: (item) => collectionA.insert(item),
        mutationFn: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20))
          executionOrder.push(`A:failed`)
          throw new Error(`A failed`)
        },
        strategy: queueStrategy(),
      })

      const createB = createPacedMutations<{ id: string; aId: string }>({
        onMutate: (item) => collectionB.insert(item),
        mutationFn: async ({ transaction }) => {
          executionOrder.push(`B:${transaction.mutations[0].changes.id}`)
        },
        strategy: queueStrategy(),
      })

      const txA = createA({ id: `a1` })
      const txB = createB({ id: `b1`, aId: `a1` }, { dependsOn: txA })

      await Promise.allSettled([
        txA.isPersisted.promise,
        txB.isPersisted.promise,
      ])

      // A should fail, B should still execute
      expect(txA.state).toBe(`failed`)
      expect(txB.state).toBe(`completed`)

      // B should still execute after A fails
      expect(executionOrder).toContain(`B:b1`)
    })

    it(`should allow independent items to process in parallel`, async () => {
      const startTimes: Record<string, number> = {}
      const endTimes: Record<string, number> = {}

      const collectionA = await createReadyCollection<{ id: string }>({
        id: `collection-a`,
        getKey: (item) => item.id,
      })

      const collectionB = await createReadyCollection<{ id: string }>({
        id: `collection-b`,
        getKey: (item) => item.id,
      })

      const createA = createPacedMutations<{ id: string }>({
        onMutate: (item) => collectionA.insert(item),
        mutationFn: async ({ transaction }) => {
          const id = transaction.mutations[0].changes.id as string
          startTimes[id] = Date.now()
          await new Promise((resolve) => setTimeout(resolve, 50))
          endTimes[id] = Date.now()
        },
        strategy: queueStrategy(),
      })

      const createB = createPacedMutations<{ id: string }>({
        onMutate: (item) => collectionB.insert(item),
        mutationFn: async ({ transaction }) => {
          const id = transaction.mutations[0].changes.id as string
          startTimes[id] = Date.now()
          await new Promise((resolve) => setTimeout(resolve, 50))
          endTimes[id] = Date.now()
        },
        strategy: queueStrategy(),
      })

      // Create two independent items - should process in parallel (different queues)
      const txA = createA({ id: `a1` })
      const txB = createB({ id: `b1` }) // No dependsOn, different queue

      await Promise.all([
        txA.isPersisted.promise,
        txB.isPersisted.promise,
      ])

      // B should start before A finishes (parallel execution)
      // Allow some tolerance for timing
      expect(startTimes[`b1`]!).toBeLessThan(endTimes[`a1`]!)
    })

    it(`should work with already-completed dependencies`, async () => {
      const executionOrder: Array<string> = []

      const collectionA = await createReadyCollection<{ id: string }>({
        id: `collection-a`,
        getKey: (item) => item.id,
      })

      const collectionB = await createReadyCollection<{ id: string; aId: string }>({
        id: `collection-b`,
        getKey: (item) => item.id,
      })

      const createA = createPacedMutations<{ id: string }>({
        onMutate: (item) => collectionA.insert(item),
        mutationFn: async ({ transaction }) => {
          executionOrder.push(`A:${transaction.mutations[0].changes.id}`)
        },
        strategy: queueStrategy(),
      })

      const createB = createPacedMutations<{ id: string; aId: string }>({
        onMutate: (item) => collectionB.insert(item),
        mutationFn: async ({ transaction }) => {
          executionOrder.push(`B:${transaction.mutations[0].changes.id}`)
        },
        strategy: queueStrategy(),
      })

      // Create A and wait for it to complete
      const txA = createA({ id: `a1` })
      await txA.isPersisted.promise

      // Now create B with dependency on already-completed A
      const txB = createB({ id: `b1`, aId: `a1` }, { dependsOn: txA })
      await txB.isPersisted.promise

      expect(executionOrder).toEqual([`A:a1`, `B:b1`])
      expect(txA.state).toBe(`completed`)
      expect(txB.state).toBe(`completed`)
    })
  })

  describe(`transaction batching`, () => {
    it(`should merge mutations on the same key`, async () => {
      const mutationFn = vi.fn(async () => {})

      const collection = await createReadyCollection<Item>({
        id: `test`,
        getKey: (item) => item.id,
      })

      let insertCount = 0
      const mutate = createPacedMutations<Item>({
        onMutate: (item) => {
          if (insertCount === 0) {
            collection.insert(item)
            insertCount++
          } else {
            collection.update(item.id, (draft) => {
              draft.value = item.value
            })
          }
        },
        mutationFn,
        strategy: debounceStrategy({ wait: 50 }),
      })

      // Insert then update same key - should merge to single insert
      mutate({ id: 1, value: 1 })
      mutate({ id: 1, value: 2 })
      mutate({ id: 1, value: 3 })

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(mutationFn).toHaveBeenCalledTimes(1)
      const call = (mutationFn.mock.calls as any)[0][0]
      expect(call.transaction.mutations).toHaveLength(1)
      expect(call.transaction.mutations[0]).toMatchObject({
        type: `insert`,
        changes: { id: 1, value: 3 }, // Final value
      })
    })

    it(`should batch mutations on different keys`, async () => {
      const mutationFn = vi.fn(async () => {})

      const collection = await createReadyCollection<Item>({
        id: `test`,
        getKey: (item) => item.id,
      })

      const mutate = createPacedMutations<Item>({
        onMutate: (item) => {
          collection.insert(item)
        },
        mutationFn,
        strategy: debounceStrategy({ wait: 50 }),
      })

      // Multiple inserts on different keys
      mutate({ id: 1, value: 1 })
      mutate({ id: 2, value: 2 })
      mutate({ id: 3, value: 3 })

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(mutationFn).toHaveBeenCalledTimes(1)
      const call = (mutationFn.mock.calls as any)[0][0]
      expect(call.transaction.mutations).toHaveLength(3)
    })
  })
})
