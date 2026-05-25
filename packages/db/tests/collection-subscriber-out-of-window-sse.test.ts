import { describe, expect, it } from 'vitest'
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
    await new Promise((resolve) => setTimeout(resolve, 50))

    results = Array.from(liveQueryCollection.values())
    expect(results).toHaveLength(3)

    // The replacement should be item 4 (value 70) — the next item from the
    // BTree — NOT the out-of-window SSE insert (value 10).
    expect(
      results.map((r) => r.id),
      `Expected item 4 (value 70) to replace deleted item 2, ` +
        `not the out-of-window SSE insert (value 10). ` +
        `Got: ${JSON.stringify(results.map((r) => ({ id: r.id, value: r.value })))}`,
    ).toEqual([`1`, `3`, `4`])
  })
})
