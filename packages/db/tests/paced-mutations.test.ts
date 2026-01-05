import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection'
import { createPacedMutations } from '../src/paced-mutations'
import {
  debounceStrategy,
  dependencyQueueStrategy,
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

  describe(`with dependency queue strategy`, () => {
    it(`should run independent mutations in parallel`, async () => {
      const executionLog: Array<{ id: number; action: string }> = []
      const mutationFn = vi.fn(async ({ transaction }) => {
        const id = transaction.mutations[0].changes.id
        executionLog.push({ id, action: `start` })
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 30))
        executionLog.push({ id, action: `end` })
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
        strategy: dependencyQueueStrategy(),
      })

      // Trigger mutations on DIFFERENT items - should run in parallel
      const tx1 = mutate({ id: 1, value: 1 })
      const tx2 = mutate({ id: 2, value: 2 })
      const tx3 = mutate({ id: 3, value: 3 })

      // Each should be a different transaction
      expect(tx1).not.toBe(tx2)
      expect(tx2).not.toBe(tx3)

      // Wait for all to complete
      await Promise.all([
        tx1.isPersisted.promise,
        tx2.isPersisted.promise,
        tx3.isPersisted.promise,
      ])

      // All should be completed
      expect(tx1.state).toBe(`completed`)
      expect(tx2.state).toBe(`completed`)
      expect(tx3.state).toBe(`completed`)

      // Key test: they should have started before others finished (parallel execution)
      // Check that at least 2 started before the first one ended
      const firstEndIndex = executionLog.findIndex(
        (log) => log.action === `end`,
      )
      const startsBeforeFirstEnd = executionLog
        .slice(0, firstEndIndex)
        .filter((log) => log.action === `start`).length

      expect(startsBeforeFirstEnd).toBeGreaterThanOrEqual(2)
    })

    it(`should serialize mutations on the same key`, async () => {
      const executionOrder: Array<string> = []
      let currentlyExecuting = false

      const mutationFn = vi.fn(async ({ transaction }) => {
        // Verify no concurrent execution on same key
        expect(currentlyExecuting).toBe(false)
        currentlyExecuting = true

        const mutation = transaction.mutations[0]
        executionOrder.push(`${mutation.type}:${mutation.changes.value}`)

        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 20))

        currentlyExecuting = false
      })

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
        strategy: dependencyQueueStrategy(),
      })

      // Trigger mutations on SAME item - should serialize
      const tx1 = mutate({ id: 1, value: 1 })
      const tx2 = mutate({ id: 1, value: 2 })
      const tx3 = mutate({ id: 1, value: 3 })

      // Each should be a different transaction
      expect(tx1).not.toBe(tx2)
      expect(tx2).not.toBe(tx3)

      // Wait for all to complete
      await Promise.all([
        tx1.isPersisted.promise,
        tx2.isPersisted.promise,
        tx3.isPersisted.promise,
      ])

      // Should have executed in order (serialized)
      expect(executionOrder).toEqual([`insert:1`, `update:2`, `update:3`])
    })

    it(`should handle mixed dependencies - parallel where possible, serial where needed`, async () => {
      const executionLog: Array<{
        id: number
        action: string
        time: number
      }> = []
      const startTime = Date.now()

      const mutationFn = vi.fn(async ({ transaction }) => {
        // Use 'key' field instead of changes.id since updates may not include id in changes
        const id = transaction.mutations[0].key as number
        executionLog.push({ id, action: `start`, time: Date.now() - startTime })
        await new Promise((resolve) => setTimeout(resolve, 30))
        executionLog.push({ id, action: `end`, time: Date.now() - startTime })
      })

      const collection = await createReadyCollection<Item>({
        id: `test`,
        getKey: (item) => item.id,
      })

      let firstInsert = true
      let secondInsert = true
      const mutate = createPacedMutations<Item>({
        onMutate: (item) => {
          if (item.id === 1) {
            if (firstInsert) {
              collection.insert(item)
              firstInsert = false
            } else {
              collection.update(item.id, (draft) => {
                draft.value = item.value
              })
            }
          } else {
            if (secondInsert) {
              collection.insert(item)
              secondInsert = false
            } else {
              collection.update(item.id, (draft) => {
                draft.value = item.value
              })
            }
          }
        },
        mutationFn,
        strategy: dependencyQueueStrategy(),
      })

      // Pattern: item 1 twice, item 2 once
      // tx1 (item 1) and tx3 (item 2) can run in parallel
      // tx2 (item 1) must wait for tx1
      const tx1 = mutate({ id: 1, value: 1 })
      const tx2 = mutate({ id: 1, value: 2 })
      const tx3 = mutate({ id: 2, value: 1 })

      await Promise.all([
        tx1.isPersisted.promise,
        tx2.isPersisted.promise,
        tx3.isPersisted.promise,
      ])

      // tx1 and tx3 should start at roughly the same time (parallel)
      const tx1Start = executionLog.find(
        (l) => l.id === 1 && l.action === `start`,
      )!
      const tx3Start = executionLog.find(
        (l) => l.id === 2 && l.action === `start`,
      )!

      // They should start within 20ms of each other (accounting for test timing variance)
      expect(Math.abs(tx1Start.time - tx3Start.time)).toBeLessThan(20)

      // tx2 (second item 1 mutation) should start after tx1 ends
      const tx1End = executionLog.find(
        (l) => l.id === 1 && l.action === `end`,
      )!
      const tx2Start = executionLog.filter(
        (l) => l.id === 1 && l.action === `start`,
      )[1]!

      expect(tx2Start.time).toBeGreaterThanOrEqual(tx1End.time - 5) // small tolerance
    })

    it(`should continue processing after an error`, async () => {
      const mutationFn = vi
        .fn()
        .mockRejectedValueOnce(new Error(`First failed`))
        .mockResolvedValueOnce(undefined)

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
        strategy: dependencyQueueStrategy(),
      })

      // First mutation will fail, second should still process
      const tx1 = mutate({ id: 1, value: 1 })
      const tx2 = mutate({ id: 1, value: 2 })

      await Promise.allSettled([
        tx1.isPersisted.promise,
        tx2.isPersisted.promise,
      ])

      expect(tx1.state).toBe(`failed`)
      expect(tx2.state).toBe(`failed`) // Cascaded rollback due to same key
      expect(mutationFn).toHaveBeenCalledTimes(1) // Second didn't run due to rollback
    })

    it(`should process independent items after one fails`, async () => {
      const mutationFn = vi
        .fn()
        .mockImplementation(async ({ transaction }) => {
          const id = transaction.mutations[0].changes.id
          if (id === 1) {
            throw new Error(`Item 1 failed`)
          }
          await new Promise((resolve) => setTimeout(resolve, 10))
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
        strategy: dependencyQueueStrategy(),
      })

      // item 1 will fail, item 2 should still succeed (independent)
      const tx1 = mutate({ id: 1, value: 1 })
      const tx2 = mutate({ id: 2, value: 2 })

      await Promise.allSettled([
        tx1.isPersisted.promise,
        tx2.isPersisted.promise,
      ])

      expect(tx1.state).toBe(`failed`)
      expect(tx2.state).toBe(`completed`) // Independent item should succeed
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
