import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createCollection } from '@tanstack/db'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import { useLiveQuery } from '../src/useLiveQuery'

type Item = { id: string; value: number }

function make(id: string, initialData: Array<Item>) {
  const collection = createCollection(
    mockSyncCollectionOptions<Item>({ id, getKey: (i) => i.id, initialData }),
  )
  const write = (type: `insert` | `update` | `delete`, value: Item) => {
    collection.utils.begin()
    collection.utils.write({ type, value })
    collection.utils.commit()
  }
  return { collection, write }
}

describe(`useLiveQuery orderBy + select(id-only): reorder is reflected`, () => {
  it(`a reorder updates the rendered id order even when value is not selected`, async () => {
    const { collection, write } = make(`uq-reorder`, [
      { id: `a`, value: 2 },
      { id: `b`, value: 1 },
    ])
    const { result } = renderHook(() =>
      useLiveQuery((q) =>
        q
          .from({ s: collection })
          .orderBy(({ s }) => s.value)
          .select(({ s }) => ({ id: s.id })),
      ),
    )

    await waitFor(() => expect(result.current.data.length).toBe(2))
    expect(result.current.data.map((r: any) => r.id)).toEqual([`b`, `a`])

    act(() => {
      write(`update`, { id: `a`, value: 0 })
    })

    await waitFor(() =>
      expect(result.current.data.map((r: any) => r.id)).toEqual([`a`, `b`]),
    )
  })
})
