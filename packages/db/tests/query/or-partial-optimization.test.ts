import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection'
import { eq, or } from '../../src/query/builder/functions'
import { mockSyncCollectionOptions } from '../utils'

interface TestItem {
  id: string
  category: string
  tag: string
}

const testData: Array<TestItem> = [
  { id: `1`, category: `A`, tag: `x` },
  { id: `2`, category: `B`, tag: `y` },
  { id: `3`, category: `A`, tag: `z` },
  { id: `4`, category: `C`, tag: `x` },
]

describe(`or() with partially indexed branches`, () => {
  it(`returns all matching rows when only one or() branch is indexed`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<TestItem>({
        id: `or-partial-index`,
        getKey: (item) => item.id,
        initialData: testData,
        autoIndex: `off`,
      }),
    )

    await collection.stateWhenReady()

    collection.createIndex((row) => row.category, {
      indexType: BasicIndex,
    })

    const liveQuery = createLiveQueryCollection({
      query: (q: any) =>
        q
          .from({ item: collection })
          .where(({ item }: any) =>
            or(eq(item.category, `A`), eq(item.tag, `x`)),
          )
          .select(({ item }: any) => ({
            id: item.id,
            category: item.category,
            tag: item.tag,
          })),
      startSync: true,
    })

    await liveQuery.stateWhenReady()

    const ids = liveQuery.toArray.map((r) => r.id).sort()
    expect(ids).toEqual([`1`, `3`, `4`])
  })
})
