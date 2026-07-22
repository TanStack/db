import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { createLiveQueryCollection } from '../src/query/index.js'
import { mockSyncCollectionOptions } from './utils.js'

type TestItem = {
  id: string
  value: number
}

describe(`CollectionSubscriber out-of-window SSE filter`, () => {
  it(`should not promote an out-of-window SSE insert when an in-window item is deleted`, async () => {
    const initialData: Array<TestItem> = [
      { id: `1`, value: 100 },
      { id: `2`, value: 90 },
      { id: `3`, value: 80 },
      { id: `4`, value: 70 },
    ]

    const sourceCollection = createCollection(
      mockSyncCollectionOptions({
        id: `sse-window-filter`,
        getKey: (item: TestItem) => item.id,
        initialData,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
      }),
    )

    await sourceCollection.preload()

    const liveQueryCollection = createLiveQueryCollection((q) =>
      q
        .from({ items: sourceCollection })
        .orderBy(({ items }) => items.value, `desc`)
        .limit(3)
        .select(({ items }) => ({
          id: items.id,
          value: items.value,
        })),
    )

    await liveQueryCollection.preload()

    const initialResults = Array.from(liveQueryCollection.values())
    expect(initialResults).toHaveLength(3)
    expect(initialResults.map((r) => r.id)).toEqual([`1`, `2`, `3`])

    // SSE delivers an insert for an item that sorts BELOW the current window
    // (value 10 is lower than all top-3 values: 100, 90, 80)
    sourceCollection.utils.begin()
    sourceCollection.utils.write({
      type: `insert`,
      value: { id: `out-of-window`, value: 10 },
    })
    sourceCollection.utils.commit()

    // Window should be unchanged
    let results = Array.from(liveQueryCollection.values())
    expect(results).toHaveLength(3)
    expect(results.map((r) => r.id)).toEqual([`1`, `2`, `3`])

    // Now delete one of the top-3 items
    sourceCollection.utils.begin()
    sourceCollection.utils.write({
      type: `delete`,
      value: { id: `2`, value: 90 },
    })
    sourceCollection.utils.commit()

    // Wait for loadNextItems to fetch the replacement
    await vi.waitFor(() => {
      const r = Array.from(liveQueryCollection.values())
      expect(r).toHaveLength(3)
      expect(r.some((item) => item.value === 70)).toBe(true)
    })

    results = Array.from(liveQueryCollection.values())

    // The replacement should be item 4 (value 70) — the next item from the
    // BTree — NOT the out-of-window SSE insert (value 10).
    expect(
      results.map((r) => r.id),
      `Expected item 4 (value 70) to replace deleted item 2, ` +
        `not the out-of-window SSE insert (value 10). ` +
        `Got: ${JSON.stringify(results.map((r) => ({ id: r.id, value: r.value })))}`,
    ).toEqual([`1`, `3`, `4`])
  })

  it(`should pass through all inserts when window is not full yet`, async () => {
    const sourceCollection = createCollection(
      mockSyncCollectionOptions({
        id: `sse-window-not-full`,
        getKey: (item: TestItem) => item.id,
        initialData: [],
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
      }),
    )

    await sourceCollection.preload()

    const liveQueryCollection = createLiveQueryCollection((q) =>
      q
        .from({ items: sourceCollection })
        .orderBy(({ items }) => items.value, `desc`)
        .limit(3)
        .select(({ items }) => ({
          id: items.id,
          value: items.value,
        })),
    )

    await liveQueryCollection.preload()

    // Insert items one at a time — all should pass through since window
    // (limit=3) is not full yet, regardless of sort position
    sourceCollection.utils.begin()
    sourceCollection.utils.write({
      type: `insert`,
      value: { id: `a`, value: 5 },
    })
    sourceCollection.utils.commit()

    await vi.waitFor(() => {
      expect(Array.from(liveQueryCollection.values())).toHaveLength(1)
    })

    sourceCollection.utils.begin()
    sourceCollection.utils.write({
      type: `insert`,
      value: { id: `b`, value: 50 },
    })
    sourceCollection.utils.commit()

    await vi.waitFor(() => {
      expect(Array.from(liveQueryCollection.values())).toHaveLength(2)
    })

    sourceCollection.utils.begin()
    sourceCollection.utils.write({
      type: `insert`,
      value: { id: `c`, value: 1 },
    })
    sourceCollection.utils.commit()

    await vi.waitFor(() => {
      expect(Array.from(liveQueryCollection.values())).toHaveLength(3)
    })

    const results = Array.from(liveQueryCollection.values())
    expect(results.map((r) => r.id)).toEqual([`b`, `a`, `c`])
  })

  it(`should pass through all inserts when there is no limit`, async () => {
    const initialData: Array<TestItem> = [
      { id: `1`, value: 100 },
      { id: `2`, value: 50 },
    ]

    const sourceCollection = createCollection(
      mockSyncCollectionOptions({
        id: `sse-no-limit`,
        getKey: (item: TestItem) => item.id,
        initialData,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
      }),
    )

    await sourceCollection.preload()

    // No .limit() — infinite window
    const liveQueryCollection = createLiveQueryCollection((q) =>
      q
        .from({ items: sourceCollection })
        .orderBy(({ items }) => items.value, `desc`)
        .select(({ items }) => ({
          id: items.id,
          value: items.value,
        })),
    )

    await liveQueryCollection.preload()

    expect(Array.from(liveQueryCollection.values())).toHaveLength(2)

    // Insert items that would sort at the very bottom — should still pass
    // through since there is no limit
    sourceCollection.utils.begin()
    sourceCollection.utils.write({
      type: `insert`,
      value: { id: `low-1`, value: 1 },
    })
    sourceCollection.utils.write({
      type: `insert`,
      value: { id: `low-2`, value: 2 },
    })
    sourceCollection.utils.commit()

    await vi.waitFor(() => {
      expect(Array.from(liveQueryCollection.values())).toHaveLength(4)
    })

    const results = Array.from(liveQueryCollection.values())
    expect(results.map((r) => r.id)).toEqual([`1`, `2`, `low-2`, `low-1`])
  })
})
