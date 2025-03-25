import { describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import mitt from "mitt"
import { useCollection } from "../src/useCollection"
import type { PendingMutation } from "@tanstack/optimistic"
import "fake-indexeddb/auto"

describe(`useCollection`, () => {
  it(`should handle insert, update, and delete operations`, async () => {
    const emitter = mitt()
    const persistMock = vi.fn().mockResolvedValue(undefined)

    // Setup initial hook render
    const { result } = renderHook(() =>
      useCollection<{ name: string }>({
        id: `test-collection`,
        sync: {
          sync: ({ begin, write, commit }) => {
            emitter.on(`*`, (_, mutations) => {
              begin()
              ;(mutations as Array<PendingMutation>).forEach((mutation) => {
                write({
                  key: mutation.key,
                  type: mutation.type,
                  value: mutation.changes as { name: string },
                })
              })
              commit()
            })
          },
        },
        mutationFn: {
          persist: persistMock,
          awaitSync: ({ transaction }) => {
            emitter.emit(`update`, transaction.mutations)
            return Promise.resolve()
          },
        },
      })
    )

    // Initial state should be empty
    expect(result.current.state.size).toBe(0)
    expect(result.current.data).toEqual([])

    // Test single insert with explicit key
    act(() => {
      return result.current.insert({ name: `Alice` }, { key: `user1` })
    })

    // Verify insert
    expect(result.current.state.size).toBe(1)
    expect(result.current.state.get(`user1`)).toEqual({ name: `Alice` })
    expect(result.current.data).toEqual([{ name: `Alice` }])

    // Test bulk insert with sparse keys
    act(() => {
      result.current.insert([{ name: `Bob` }, { name: `Charlie` }], {
        key: [`user2`, undefined],
      })
    })

    // Get the auto-generated key for Charlie
    const charlieKey = Array.from(result.current.state.keys())[2]

    // Verify bulk insert
    expect(result.current.state.size).toBe(3)
    expect(result.current.state.get(`user2`)).toEqual({ name: `Bob` })
    expect(result.current.state.get(charlieKey!)).toEqual({ name: `Charlie` })
    expect(result.current.data.length).toBe(3)
    expect(result.current.data).toContainEqual({ name: `Bob` })
    expect(result.current.data).toContainEqual({ name: `Charlie` })

    // Test update with callback
    const updateTransaction = await act(() => {
      return result.current.update(
        result.current.state.get(`user1`)!,
        (item) => {
          item.name = `Alice Smith`
        }
      )
    })

    await updateTransaction.isSynced?.promise

    // Verify update
    expect(result.current.state.get(`user1`)).toEqual({ name: `Alice Smith` })
    expect(result.current.data).toContainEqual({ name: `Alice Smith` })

    // Test bulk update with metadata
    await act(() => {
      const items = [
        result.current.state.get(`user1`)!,
        result.current.state.get(`user2`)!,
      ]
      return result.current.update(
        items,
        { metadata: { bulkUpdate: true } },
        (drafts) => {
          drafts.forEach((draft, i) => {
            if (i === 0) {
              draft.name = draft.name + ` Jr.`
            } else if (i === 1) {
              draft.name = draft.name + ` Sr.`
            }
          })
        }
      )
    })

    // Verify bulk update
    expect(result.current.state.get(`user1`)).toEqual({
      name: `Alice Smith Jr.`,
    })
    expect(result.current.state.get(`user2`)).toEqual({ name: `Bob Sr.` })
    expect(result.current.data).toContainEqual({ name: `Alice Smith Jr.` })
    expect(result.current.data).toContainEqual({ name: `Bob Sr.` })

    // Test single delete
    await act(() => {
      return result.current.delete(result.current.state.get(`user1`)!)
    })

    // Verify single delete
    expect(result.current.state.has(`user1`)).toBe(false)
    expect(result.current.data).not.toContainEqual({ name: `Alice Smith Jr.` })

    // Test bulk delete with metadata
    act(() => {
      const items = [
        result.current.state.get(`user2`)!,
        result.current.state.get(charlieKey!)!,
      ]
      result.current.delete(items, { metadata: { reason: `bulk cleanup` } })
    })

    // Verify all items are deleted
    expect(result.current.state.size).toBe(0)
    expect(result.current.data.length).toBe(0)

    // Verify persist was called for each operation
    expect(persistMock).toHaveBeenCalledTimes(6) // 2 inserts + 2 updates + 2 deletes
  })

  it(`should expose state, items, and data properties correctly`, () => {
    const emitter = mitt()
    const persistMock = vi.fn().mockResolvedValue(undefined)

    // Setup initial hook render
    const { result } = renderHook(() =>
      useCollection({
        id: `test-properties`,
        mutationFn: {
          persist: persistMock,
          awaitSync: ({ transaction }) => {
            emitter.emit(`update`, transaction.mutations)
            return Promise.resolve()
          },
        },
        sync: {
          sync: ({ begin, write, commit }) => {
            emitter.on(`*`, (_, mutations) => {
              begin()
              ;(mutations as Array<PendingMutation>).forEach((mutation) => {
                write({
                  key: mutation.key,
                  type: mutation.type,
                  value: mutation.changes,
                })
              })
              commit()
            })
          },
        },
      })
    )

    // Initial state should be empty
    expect(result.current.state).toBeInstanceOf(Map)
    expect(result.current.state.size).toBe(0)
    expect(result.current.data).toBeInstanceOf(Array)
    expect(result.current.data.length).toBe(0)

    // Insert some test data
    act(() => {
      result.current.insert(
        [
          { id: 1, name: `Item 1` },
          { id: 2, name: `Item 2` },
          { id: 3, name: `Item 3` },
        ],
        { key: [`key1`, `key2`, `key3`] }
      )
      emitter.emit(`update`, [
        { key: `key1`, type: `insert`, changes: { id: 1, name: `Item 1` } },
        { key: `key2`, type: `insert`, changes: { id: 2, name: `Item 2` } },
        { key: `key3`, type: `insert`, changes: { id: 3, name: `Item 3` } },
      ])
    })

    // Verify state property (Map)
    expect(result.current.state.size).toBe(3)
    expect(result.current.state.get(`key1`)).toEqual({ id: 1, name: `Item 1` })
    expect(result.current.state.get(`key2`)).toEqual({ id: 2, name: `Item 2` })
    expect(result.current.state.get(`key3`)).toEqual({ id: 3, name: `Item 3` })

    // Verify items property (Array)
    expect(result.current.data.length).toBe(3)
    expect(result.current.data).toContainEqual({ id: 1, name: `Item 1` })
    expect(result.current.data).toContainEqual({ id: 2, name: `Item 2` })
    expect(result.current.data).toContainEqual({ id: 3, name: `Item 3` })
  })

  it(`should work with a selector function`, () => {
    const emitter = mitt()
    const persistMock = vi.fn().mockResolvedValue(undefined)

    // Setup hook with selector
    const { result } = renderHook(() =>
      useCollection<{ id: number; name: string }>({
        id: `test-selector`,
        mutationFn: {
          persist: persistMock,
          awaitSync: ({ transaction }) => {
            emitter.emit(`update`, transaction.mutations)
            return Promise.resolve()
          },
        },
        sync: {
          sync: ({ begin, write, commit }) => {
            emitter.on(`*`, (_, mutations) => {
              begin()
              ;(mutations as Array<PendingMutation>).forEach((mutation) => {
                write({
                  key: mutation.key,
                  type: mutation.type,
                  // TODO this should get the type automatically
                  value: mutation.changes as { id: number; name: string },
                })
              })
              commit()
            })
          },
        },
      })
    )

    // Initial state
    expect(result.current.state).toBeInstanceOf(Map)
    expect(result.current.state.size).toBe(0)
    expect(result.current.data).toBeInstanceOf(Array)
    expect(result.current.data.length).toBe(0)

    // Insert some test data
    act(() => {
      result.current.insert(
        [
          { id: 1, name: `Alice` },
          { id: 2, name: `Bob` },
          { id: 3, name: `Charlie` },
        ],
        { key: [`key1`, `key2`, `key3`] }
      )
      emitter.emit(`update`, [
        { key: `key1`, type: `insert`, changes: { id: 1, name: `Alice` } },
        { key: `key2`, type: `insert`, changes: { id: 2, name: `Bob` } },
        { key: `key3`, type: `insert`, changes: { id: 3, name: `Charlie` } },
      ])
    })

    // Verify selector result
    expect(
      result.current.data.map((item) => (item as { name: string }).name)
    ).toEqual([`Alice`, `Bob`, `Charlie`])

    // Verify state and data are still available
    expect(result.current.state.size).toBe(3)
    expect(result.current.data.length).toBe(3)
  })
})
