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
            emitter.on(`*`, (type, { changes }) => {
              begin()
              changes.map((change) =>
                write({
                  key: change.key,
                  type: change.type as string,
                  value: change.value,
                })
              )
              commit()
            })
          },
        },
        mutationFn: {
          persist: persistMock,
          awaitSync: async () => {},
        },
      })
    )

    // Initial state should be empty
    expect(result.current.data).toEqual(new Map())

    // Test insert
    await act(async () => {
      await result.current.insert({
        key: `user1`,
        data: { name: `Alice` },
      })
    })

    // Verify insert
    expect(result.current.data).toEqual(new Map([[`user1`, { name: `Alice` }]]))

    // Test update
    await act(async () => {
      await result.current.update({
        key: `user1`,
        data: { name: `Alice Smith` },
      })
    })

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
