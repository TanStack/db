import { beforeEach, describe, expect, it } from "vitest"
import { createCollection } from "../../src/collection/index.js"
import { mockSyncCollectionOptions } from "../utils.js"
import { createLiveQueryCollection } from "../../src/query/live-query-collection.js"
import { eq, inArray } from "../../src/query/builder/functions.js"

type Score = {
  itemId: string
  score: number
}

type Item = {
  id: string
  name: string
  category: string
  tag: string
}

describe(`limit with filter changes bug`, () => {
  let scoreCollection: ReturnType<typeof createCollection<Score>>
  let itemCollection: ReturnType<typeof createCollection<Item>>

  beforeEach(() => {
    // Define initial data
    const items: Array<Item> = [
      { id: `1`, name: `Item 1`, category: `A`, tag: `tag1` },
      { id: `2`, name: `Item 2`, category: `A`, tag: `tag2` },
      { id: `3`, name: `Item 3`, category: `A`, tag: `tag1` },
      { id: `4`, name: `Item 4`, category: `B`, tag: `tag2` },
      { id: `5`, name: `Item 5`, category: `B`, tag: `tag1` },
      { id: `6`, name: `Item 6`, category: `A`, tag: `tag2` },
      { id: `7`, name: `Item 7`, category: `B`, tag: `tag1` },
      { id: `8`, name: `Item 8`, category: `A`, tag: `tag2` },
      { id: `9`, name: `Item 9`, category: `B`, tag: `tag1` },
      { id: `10`, name: `Item 10`, category: `A`, tag: `tag2` },
    ]

    const scores: Array<Score> = [
      { itemId: `1`, score: 10 },
      { itemId: `2`, score: 20 },
      { itemId: `3`, score: 30 },
      { itemId: `4`, score: 40 },
      { itemId: `5`, score: 50 },
      { itemId: `6`, score: 60 },
      { itemId: `7`, score: 70 },
      { itemId: `8`, score: 80 },
      { itemId: `9`, score: 90 },
      { itemId: `10`, score: 100 },
    ]

    // Create score collection with ORDER BY index
    scoreCollection = createCollection<Score>({
      ...mockSyncCollectionOptions<Score>({
        id: `scores`,
        getKey: (score) => score.itemId,
        initialData: scores,
      }),
      indexes: [{ field: `score`, type: `range` }],
    })

    // Create item collection
    itemCollection = createCollection<Item>({
      ...mockSyncCollectionOptions<Item>({
        id: `items`,
        getKey: (item) => item.id,
        initialData: items,
      }),
    })
  })

  it(`should return correct results after filter changes with limit`, async () => {
    // Create query 1: Filter by category A and tag1, with limit
    const query1 = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ score: scoreCollection })
          .orderBy(({ score }) => score.score, `desc`)
          .innerJoin({ item: itemCollection }, ({ score, item }) =>
            eq(item.id, score.itemId)
          )
          .where(({ item }) => inArray(item.category, [`A`]))
          .where(({ item }) => inArray(item.tag, [`tag1`]))
          .select(({ item, score }) => ({
            id: item.id,
            name: item.name,
            score: score.score,
            category: item.category,
            tag: item.tag,
          }))
          .limit(50),
      startSync: true,
    })

    await query1.preload()
    const result1 = Array.from(query1.entries()).map(([, v]) => v)

    // Should have 2 results: Item 1 (category A, tag1) and Item 3 (category A, tag1)
    expect(result1.length).toBe(2)
    expect(result1.map((r) => r.id).sort()).toEqual([`1`, `3`])

    query1.cleanup()

    // Create query 2: Remove tag filter (only category A)
    const query2 = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ score: scoreCollection })
          .orderBy(({ score }) => score.score, `desc`)
          .innerJoin({ item: itemCollection }, ({ score, item }) =>
            eq(item.id, score.itemId)
          )
          .where(({ item }) => inArray(item.category, [`A`]))
          .select(({ item, score }) => ({
            id: item.id,
            name: item.name,
            score: score.score,
            category: item.category,
            tag: item.tag,
          }))
          .limit(50),
      startSync: true,
    })

    await query2.preload()
    const result2 = Array.from(query2.entries()).map(([, v]) => v)

    // Should have 6 results: Items 1, 2, 3, 6, 8, 10 (all category A)
    expect(result2.length).toBe(6)
    expect(result2.map((r) => r.id).sort()).toEqual([
      `1`,
      `10`,
      `2`,
      `3`,
      `6`,
      `8`,
    ])

    query2.cleanup()

    // Create query 3: Re-add tag filter (back to category A and tag1)
    const query3 = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ score: scoreCollection })
          .orderBy(({ score }) => score.score, `desc`)
          .innerJoin({ item: itemCollection }, ({ score, item }) =>
            eq(item.id, score.itemId)
          )
          .where(({ item }) => inArray(item.category, [`A`]))
          .where(({ item }) => inArray(item.tag, [`tag1`]))
          .select(({ item, score }) => ({
            id: item.id,
            name: item.name,
            score: score.score,
            category: item.category,
            tag: item.tag,
          }))
          .limit(50),
      startSync: true,
    })

    await query3.preload()
    const result3 = Array.from(query3.entries()).map(([, v]) => v)

    // BUG: This should return 2 results like query1, but might return 0
    expect(result3.length).toBe(2)
    expect(result3.map((r) => r.id).sort()).toEqual([`1`, `3`])

    query3.cleanup()
  })

  it(`should return correct results without limit (control test)`, async () => {
    // Create query 1: Filter by category A and tag1, WITHOUT limit
    const query1 = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ score: scoreCollection })
          .orderBy(({ score }) => score.score, `desc`)
          .innerJoin({ item: itemCollection }, ({ score, item }) =>
            eq(item.id, score.itemId)
          )
          .where(({ item }) => inArray(item.category, [`A`]))
          .where(({ item }) => inArray(item.tag, [`tag1`]))
          .select(({ item, score }) => ({
            id: item.id,
            name: item.name,
            score: score.score,
            category: item.category,
            tag: item.tag,
          })),
      startSync: true,
    })

    await query1.preload()
    const result1 = Array.from(query1.entries()).map(([, v]) => v)

    expect(result1.length).toBe(2)
    query1.cleanup()

    // Create query 2: Remove tag filter
    const query2 = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ score: scoreCollection })
          .orderBy(({ score }) => score.score, `desc`)
          .innerJoin({ item: itemCollection }, ({ score, item }) =>
            eq(item.id, score.itemId)
          )
          .where(({ item }) => inArray(item.category, [`A`]))
          .select(({ item, score }) => ({
            id: item.id,
            name: item.name,
            score: score.score,
            category: item.category,
            tag: item.tag,
          })),
      startSync: true,
    })

    await query2.preload()
    const result2 = Array.from(query2.entries()).map(([, v]) => v)

    expect(result2.length).toBe(6)
    query2.cleanup()

    // Create query 3: Re-add tag filter
    const query3 = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ score: scoreCollection })
          .orderBy(({ score }) => score.score, `desc`)
          .innerJoin({ item: itemCollection }, ({ score, item }) =>
            eq(item.id, score.itemId)
          )
          .where(({ item }) => inArray(item.category, [`A`]))
          .where(({ item }) => inArray(item.tag, [`tag1`]))
          .select(({ item, score }) => ({
            id: item.id,
            name: item.name,
            score: score.score,
            category: item.category,
            tag: item.tag,
          })),
      startSync: true,
    })

    await query3.preload()
    const result3 = Array.from(query3.entries()).map(([, v]) => v)

    // Without limit, this should work correctly
    expect(result3.length).toBe(2)

    query3.cleanup()
  })
})
