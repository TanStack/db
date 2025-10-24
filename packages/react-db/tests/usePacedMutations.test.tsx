import { describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import {
  createCollection,
  debounceStrategy,
  queueStrategy,
  throttleStrategy,
} from "@tanstack/db"
import { usePacedMutations } from "../src/usePacedMutations"
import { mockSyncCollectionOptionsNoInitialState } from "../../db/tests/utils"

type Item = {
  id: number
  value: number
}

describe(`usePacedMutations with debounce strategy`, () => {
  it(`should batch multiple rapid mutations into a single transaction`, async () => {
    const mutationFn = vi.fn(async () => {})

    const { result } = renderHook(() =>
      usePacedMutations({
        mutationFn,
        strategy: debounceStrategy({ wait: 50 }),
      })
    )

    const collection = createCollection(
      mockSyncCollectionOptionsNoInitialState<Item>({
        id: `test`,
        getKey: (item) => item.id,
      })
    )

    // Setup collection
    const preloadPromise = collection.preload()
    collection.utils.begin()
    collection.utils.commit()
    collection.utils.markReady()
    await preloadPromise

    let tx1, tx2, tx3

    // Trigger three rapid mutations (all within 50ms debounce window)
    act(() => {
      tx1 = result.current(() => {
        collection.insert({ id: 1, value: 1 })
      })
    })

    act(() => {
      tx2 = result.current(() => {
        collection.update(1, (draft) => {
          draft.value = 2
        })
      })
    })

    act(() => {
      tx3 = result.current(() => {
        collection.update(1, (draft) => {
          draft.value = 3
        })
      })
    })

    // All three calls should return the SAME transaction object
    expect(tx1).toBe(tx2)
    expect(tx2).toBe(tx3)

    // Mutations get auto-merged (insert + updates on same key = single insert with final value)
    expect(tx1!.mutations).toHaveLength(1)
    expect(tx1!.mutations[0]).toMatchObject({
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
    expect(tx1!.state).toBe(`completed`)
  })

  it(`should reset debounce timer on each new mutation`, async () => {
    const mutationFn = vi.fn(async () => {})

    const { result } = renderHook(() =>
      usePacedMutations({
        mutationFn,
        strategy: debounceStrategy({ wait: 50 }),
      })
    )

    const collection = createCollection(
      mockSyncCollectionOptionsNoInitialState<Item>({
        id: `test`,
        getKey: (item) => item.id,
      })
    )

    const preloadPromise = collection.preload()
    collection.utils.begin()
    collection.utils.commit()
    collection.utils.markReady()
    await preloadPromise

    // First mutation at t=0
    act(() => {
      result.current(() => {
        collection.insert({ id: 1, value: 1 })
      })
    })

    // Wait 40ms (still within 50ms debounce window)
    await new Promise((resolve) => setTimeout(resolve, 40))

    // mutationFn should NOT have been called yet
    expect(mutationFn).not.toHaveBeenCalled()

    // Second mutation at t=40 (resets the timer)
    act(() => {
      result.current(() => {
        collection.update(1, (draft) => {
          draft.value = 2
        })
      })
    })

    // Wait another 40ms (t=80, but only 40ms since last mutation)
    await new Promise((resolve) => setTimeout(resolve, 40))

    // mutationFn still should NOT have been called (timer was reset)
    expect(mutationFn).not.toHaveBeenCalled()

    // Wait another 20ms (t=100, now 60ms since last mutation, past the 50ms debounce)
    await new Promise((resolve) => setTimeout(resolve, 20))

    // NOW mutationFn should have been called
    expect(mutationFn).toHaveBeenCalledTimes(1)
    const firstCall = mutationFn.mock.calls[0] as unknown as [
      { transaction: { mutations: Array<unknown> } },
    ]
    expect(firstCall[0].transaction.mutations).toHaveLength(1) // Merged to 1 mutation
  })
})

describe(`usePacedMutations with queue strategy`, () => {
  it(`should accumulate mutations then process sequentially`, async () => {
    const mutationFn = vi.fn(async () => {
      // Quick execution
      await new Promise((resolve) => setTimeout(resolve, 5))
    })

    const { result } = renderHook(() =>
      usePacedMutations({
        mutationFn,
        strategy: queueStrategy({ wait: 10 }),
      })
    )

    const collection = createCollection(
      mockSyncCollectionOptionsNoInitialState<Item>({
        id: `test`,
        getKey: (item) => item.id,
      })
    )

    // Setup collection
    const preloadPromise = collection.preload()
    collection.utils.begin()
    collection.utils.commit()
    collection.utils.markReady()
    await preloadPromise

    let tx1

    // Trigger rapid mutations within single act - they accumulate in one transaction
    act(() => {
      tx1 = result.current(() => {
        collection.insert({ id: 1, value: 1 })
        collection.insert({ id: 2, value: 2 })
        collection.insert({ id: 3, value: 3 })
      })
    })

    // Queue starts processing immediately
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(mutationFn).toHaveBeenCalledTimes(1)

    // Wait for transaction to complete
    await tx1!.isPersisted.promise
    expect(tx1!.state).toBe(`completed`)

    // All 3 mutations should be in the same transaction
    expect(tx1!.mutations).toHaveLength(3)
  })
})

describe(`usePacedMutations with throttle strategy`, () => {
  it(`should throttle mutations with leading and trailing execution`, async () => {
    const mutationFn = vi.fn(async () => {})

    const { result } = renderHook(() =>
      usePacedMutations({
        mutationFn,
        strategy: throttleStrategy({
          wait: 100,
          leading: true,
          trailing: true,
        }),
      })
    )

    const collection = createCollection(
      mockSyncCollectionOptionsNoInitialState<Item>({
        id: `test`,
        getKey: (item) => item.id,
      })
    )

    // Setup collection
    const preloadPromise = collection.preload()
    collection.utils.begin()
    collection.utils.commit()
    collection.utils.markReady()
    await preloadPromise

    let tx1, tx2, tx3

    // First mutation at t=0 (should execute immediately due to leading: true)
    act(() => {
      tx1 = result.current(() => {
        collection.insert({ id: 1, value: 1 })
      })
    })

    // Leading edge should execute immediately
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mutationFn).toHaveBeenCalledTimes(1)
    expect(tx1!.state).toBe(`completed`)

    // Second mutation at t=20 (during throttle period, should batch)
    act(() => {
      tx2 = result.current(() => {
        collection.insert({ id: 2, value: 2 })
      })
    })

    // Third mutation at t=30 (during throttle period, should batch with second)
    await new Promise((resolve) => setTimeout(resolve, 10))
    act(() => {
      tx3 = result.current(() => {
        collection.insert({ id: 3, value: 3 })
      })
    })

    // tx2 and tx3 should be the same transaction (batched)
    expect(tx2).toBe(tx3)

    // Still only 1 call (waiting for throttle period to end)
    expect(mutationFn).toHaveBeenCalledTimes(1)

    // Wait for throttle period to complete (100ms from first mutation)
    await new Promise((resolve) => setTimeout(resolve, 110))

    // Trailing edge should have executed
    expect(mutationFn).toHaveBeenCalledTimes(2)
    expect(tx2!.state).toBe(`completed`)
    expect(tx3!.state).toBe(`completed`)

    // Verify the batched transaction has 2 inserts
    expect(tx2!.mutations).toHaveLength(2)
  })

  it(`should respect trailing: true with leading: false option`, async () => {
    const mutationFn = vi.fn(async () => {})

    const { result } = renderHook(() =>
      usePacedMutations({
        mutationFn,
        strategy: throttleStrategy({
          wait: 50,
          leading: false,
          trailing: true,
        }),
      })
    )

    const collection = createCollection(
      mockSyncCollectionOptionsNoInitialState<Item>({
        id: `test`,
        getKey: (item) => item.id,
      })
    )

    const preloadPromise = collection.preload()
    collection.utils.begin()
    collection.utils.commit()
    collection.utils.markReady()
    await preloadPromise

    let tx1

    // First mutation should NOT execute immediately with leading: false
    act(() => {
      tx1 = result.current(() => {
        collection.insert({ id: 1, value: 1 })
      })
    })

    // Should not have been called yet
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mutationFn).not.toHaveBeenCalled()

    // Add another mutation during throttle period to ensure trailing fires
    act(() => {
      result.current(() => {
        collection.insert({ id: 2, value: 2 })
      })
    })

    // Wait for throttle period to complete
    await new Promise((resolve) => setTimeout(resolve, 70))

    // Now trailing edge should have executed
    expect(mutationFn).toHaveBeenCalledTimes(1)
    await tx1!.isPersisted.promise
    expect(tx1!.state).toBe(`completed`)
  })
})

describe(`usePacedMutations memoization`, () => {
  it(`should not recreate instance when strategy object changes but values are same`, () => {
    const mutationFn = vi.fn(async () => {})

    // Simulate a custom hook that creates strategy inline on each render
    const useCustomHook = (wait: number) => {
      return usePacedMutations({
        mutationFn,
        // Strategy is created inline on every render - new object reference each time
        strategy: debounceStrategy({ wait }),
      })
    }

    const { result, rerender } = renderHook(({ wait }) => useCustomHook(wait), {
      initialProps: { wait: 3000 },
    })

    const firstMutate = result.current

    // Rerender with same wait value - strategy object will be different reference
    rerender({ wait: 3000 })
    const secondMutate = result.current

    // mutate function should be stable (same reference)
    expect(secondMutate).toBe(firstMutate)

    // Rerender with different wait value - should create new instance
    rerender({ wait: 5000 })
    const thirdMutate = result.current

    // mutate function should be different now
    expect(thirdMutate).not.toBe(firstMutate)
  })

  it(`should not recreate instance when wrapped in custom hook with inline strategy`, () => {
    const mutationFn = vi.fn(async () => {})

    // Simulate the exact user scenario: custom hook wrapping usePacedMutations
    const useDebouncedTransaction = (opts?: {
      wait?: number
      trailing?: boolean
      leading?: boolean
    }) => {
      return usePacedMutations({
        mutationFn,
        strategy: debounceStrategy({
          wait: opts?.wait ?? 3000,
          trailing: opts?.trailing ?? true,
          leading: opts?.leading ?? false,
        }),
      })
    }

    const { result, rerender } = renderHook(() => useDebouncedTransaction())

    const firstMutate = result.current

    // Multiple rerenders with no options - should not recreate instance
    rerender()
    expect(result.current).toBe(firstMutate)

    rerender()
    expect(result.current).toBe(firstMutate)

    rerender()
    expect(result.current).toBe(firstMutate)

    // All should still be the same mutate function
    expect(result.current).toBe(firstMutate)
  })

  it(`should recreate instance when strategy options actually change`, () => {
    const mutationFn = vi.fn(async () => {})

    const useDebouncedTransaction = (opts?: {
      wait?: number
      trailing?: boolean
      leading?: boolean
    }) => {
      return usePacedMutations({
        mutationFn,
        strategy: debounceStrategy({
          wait: opts?.wait ?? 3000,
          trailing: opts?.trailing ?? true,
          leading: opts?.leading ?? false,
        }),
      })
    }

    const { result, rerender } = renderHook(
      ({ opts }) => useDebouncedTransaction(opts),
      { initialProps: { opts: { wait: 3000 } } }
    )

    const firstMutate = result.current

    // Rerender with different wait value
    rerender({ opts: { wait: 5000 } })
    const secondMutate = result.current

    // Should be different instance since wait changed
    expect(secondMutate).not.toBe(firstMutate)

    // Rerender with same wait value again
    rerender({ opts: { wait: 5000 } })
    const thirdMutate = result.current

    // Should be same as second since value didn't change
    expect(thirdMutate).toBe(secondMutate)
  })
})
