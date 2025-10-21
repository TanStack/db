import { describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { createCollection, debounceStrategy } from "@tanstack/db"
import { useSerializedMutations } from "../src/useSerializedMutations"
import { mockSyncCollectionOptionsNoInitialState } from "../../db/tests/utils"

type Item = {
  id: number
  value: number
}

describe(`useSerializedMutations with debounce strategy`, () => {
  it(`should batch multiple rapid mutations into a single transaction`, async () => {
    const mutationFn = vi.fn(async () => {})

    const { result } = renderHook(() =>
      useSerializedMutations({
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

    const { result } = renderHook(() =>
      useSerializedMutations({
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
    expect(mutationFn.mock.calls[0][0].transaction.mutations).toHaveLength(1) // Merged to 1 mutation
  })
})
