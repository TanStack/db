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

describe(`usePacedMutations React hook`, () => {
  it(`should work with debounce strategy (smoke test)`, async () => {
    const mutationFn = vi.fn(async () => {})

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

    const { result } = renderHook(() =>
      usePacedMutations<Item>({
        onMutate: (item) => {
          collection.insert(item)
        },
        mutationFn,
        strategy: debounceStrategy({ wait: 50 }),
      })
    )

    let tx
    act(() => {
      tx = result.current({ id: 1, value: 1 })
    })

    expect(mutationFn).not.toHaveBeenCalled()

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(mutationFn).toHaveBeenCalledTimes(1)
    expect(tx!.state).toBe(`completed`)
  })

  it(`should work with throttle strategy (smoke test)`, async () => {
    const mutationFn = vi.fn(async () => {})

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

    const { result } = renderHook(() =>
      usePacedMutations<Item>({
        onMutate: (item) => {
          collection.insert(item)
        },
        mutationFn,
        strategy: throttleStrategy({ wait: 50, leading: true }),
      })
    )

    let tx
    act(() => {
      tx = result.current({ id: 1, value: 1 })
    })

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mutationFn).toHaveBeenCalledTimes(1)
    expect(tx!.state).toBe(`completed`)
  })

  it(`should work with queue strategy (smoke test)`, async () => {
    const mutationFn = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
    })

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

    const { result } = renderHook(() =>
      usePacedMutations<Item>({
        onMutate: (item) => {
          collection.insert(item)
        },
        mutationFn,
        strategy: queueStrategy({ wait: 10 }),
      })
    )

    let tx
    act(() => {
      tx = result.current({ id: 1, value: 1 })
    })

    await tx!.isPersisted.promise
    expect(mutationFn).toHaveBeenCalledTimes(1)
    expect(tx!.state).toBe(`completed`)
  })

  describe(`memoization`, () => {
    it(`should not recreate instance when strategy object changes but values are same`, () => {
      const mutationFn = vi.fn(async () => {})
      const onMutate = vi.fn(() => {})

      // Simulate a custom hook that creates strategy inline on each render
      const useCustomHook = (wait: number) => {
        return usePacedMutations({
          onMutate,
          mutationFn,
          // Strategy is created inline on every render - new object reference each time
          strategy: debounceStrategy({ wait }),
        })
      }

      const { result, rerender } = renderHook(
        ({ wait }) => useCustomHook(wait),
        {
          initialProps: { wait: 3000 },
        }
      )

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
      const onMutate = vi.fn(() => {})

      // Simulate the exact user scenario: custom hook wrapping usePacedMutations
      const useDebouncedTransaction = (opts?: {
        wait?: number
        trailing?: boolean
        leading?: boolean
      }) => {
        return usePacedMutations({
          onMutate,
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
      const onMutate = vi.fn(() => {})

      const useDebouncedTransaction = (opts?: {
        wait?: number
        trailing?: boolean
        leading?: boolean
      }) => {
        return usePacedMutations({
          onMutate,
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
})
