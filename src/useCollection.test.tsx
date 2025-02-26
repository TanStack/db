import { describe, it, expect, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useCollection } from "./useCollection"
import mitt from "mitt"
import "fake-indexeddb/auto"

describe(`useCollection`, () => {
  it(`should handle insert, update, and delete operations`, async () => {
    const emitter = mitt()
    const persistMock = vi.fn().mockResolvedValue(undefined)

    // Setup initial hook render
    const { result } = renderHook(() =>
      useCollection({
        id: `test-collection`,
        sync: {
          id: `mock`,
          sync: ({ begin, write, commit }) => {
            emitter.on(`*`, (type, mutations) => {
              begin()
              mutations.forEach((mutation) =>
                write({
                  key: mutation.key,
                  type: mutation.type as string,
                  value: mutation.changes,
                })
              )
              commit()
            })
          },
        },
        mutationFn: {
          persist: persistMock,
          awaitSync: async ({ transaction }) => {
            emitter.emit(`update`, transaction.mutations)
          },
        },
      })
    )

    // Initial state should be empty
    expect(result.current.data).toEqual(new Map())

    // Test insert
    await act(async () => {
      result.current.insert({
        key: `user1`,
        data: { name: `Alice` },
      })
    })

    // Verify insert
    expect(result.current.data).toEqual(new Map([[`user1`, { name: `Alice` }]]))

    // Test update
    const updateTransaction = await act(async () => {
      return result.current.update({
        key: `user1`,
        data: { name: `Alice Smith` },
      })
    })

    await updateTransaction.isSynced.promise
    // Verify update
    expect(result.current.data).toEqual(
      new Map([[`user1`, { name: `Alice Smith` }]])
    )

    // Test delete
    await act(async () => {
      await result.current.delete({
        key: `user1`,
      })
    })

    // Verify delete
    expect(result.current.data).toEqual(new Map())

    // Verify persist was called for each operation
    expect(persistMock).toHaveBeenCalledTimes(3)
  })
})
