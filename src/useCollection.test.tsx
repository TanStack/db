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

    // Test single insert with explicit key
    await act(async () => {
      result.current.insert({ name: `Alice` }, { key: `user1` })
    })

    // Verify insert
    expect(result.current.data).toEqual(new Map([[`user1`, { name: `Alice` }]]))

    // Test bulk insert with sparse keys
    await act(async () => {
      result.current.insert([{ name: `Bob` }, { name: `Charlie` }], {
        key: [`user2`, undefined],
      })
    })

    // Get the auto-generated key for Charlie
    const charlieKey = Array.from(result.current.data.keys())[2]

    // Verify bulk insert
    expect(result.current.data.get(`user2`)).toEqual({ name: `Bob` })
    expect(result.current.data.get(charlieKey)).toEqual({ name: `Charlie` })

    // Test update with callback
    const updateTransaction = await act(async () => {
      return result.current.update(
        result.current.data.get(`user1`)!,
        (item) => {
          item.name = `Alice Smith`
        }
      )
    })

    await updateTransaction.isSynced?.promise
    // Verify update
    expect(result.current.data.get(`user1`)).toEqual({ name: `Alice Smith` })

    // Test bulk update with metadata
    await act(async () => {
      const items = [
        result.current.data.get(`user1`)!,
        result.current.data.get(`user2`)!,
      ]
      result.current.update(
        items,
        { metadata: { bulkUpdate: true } },
        (items) => {
          items[0].name = items[0].name + ` Jr.`
          items[1].name = items[1].name + ` Sr.`
        }
      )
    })

    // Verify bulk update
    expect(result.current.data.get(`user1`)).toEqual({
      name: `Alice Smith Jr.`,
    })
    expect(result.current.data.get(`user2`)).toEqual({ name: `Bob Sr.` })

    // Test single delete
    await act(async () => {
      result.current.delete(result.current.data.get(`user1`)!)
    })

    // Verify single delete
    expect(result.current.data.has(`user1`)).toBe(false)

    // Test bulk delete with metadata
    await act(async () => {
      const items = [
        result.current.data.get(`user2`)!,
        result.current.data.get(charlieKey)!,
      ]
      result.current.delete(items, { metadata: { reason: `bulk cleanup` } })
    })

    // Verify all items are deleted
    expect(result.current.data.size).toBe(0)

    // Verify persist was called for each operation
    expect(persistMock).toHaveBeenCalledTimes(6) // 2 inserts + 2 updates + 2 deletes
  })
})
