import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryCollection, eq } from '../src/query/index.js'
import { flushPromises, mockSyncCollectionOptions  } from './utils.js'

type Item = {
  id: string
  category: string
  name: string
}

describe(`Boundary expansion for multi-column orderBy`, () => {
  it(`should include all boundary items when paginating with multi-column orderBy`, async () => {
    // Items with same category (first orderBy col) but different names (second orderBy col).
    // BTree indexes by (category, _id) only. When paginating, items sharing the
    // boundary category but with different _id ordering may be missed by BTree's take().
    // The boundary expansion step should send them so D2 picks the correct top-K.
    const initialData: Array<Item> = [
      { id: `a1`, category: `A`, name: `Zeta` },
      { id: `a2`, category: `A`, name: `Alpha` },
      { id: `a3`, category: `A`, name: `Beta` },
      { id: `b1`, category: `B`, name: `Gamma` },
      { id: `b2`, category: `B`, name: `Delta` },
      { id: `c1`, category: `C`, name: `Epsilon` },
    ]

    const sourceCollection = createCollection(
      mockSyncCollectionOptions({
        id: `boundary-multi-orderby-source`,
        getKey: (item: Item) => item.id,
        initialData,
        autoIndex: `eager`,
      }),
    )

    await sourceCollection.preload()

    const liveQuery = createLiveQueryCollection((q) =>
      q
        .from({ items: sourceCollection })
        .orderBy(({ items }) => items.category, `asc`)
        .orderBy(({ items }) => items.name, `asc`)
        .limit(4)
        .select(({ items }) => ({
          id: items.id,
          category: items.category,
          name: items.name,
        })),
    )

    await liveQuery.preload()
    await flushPromises()

    const results = Array.from(liveQuery.values())

    // Full multi-column sort (category asc, name asc):
    //   A-Alpha (a2), A-Beta (a3), A-Zeta (a1), B-Delta (b2), B-Gamma (b1), C-Epsilon (c1)
    // Top 4 should be: A-Alpha, A-Beta, A-Zeta, B-Delta
    expect(results).toHaveLength(4)
    expect(results.map((r) => r.id)).toEqual([`a2`, `a3`, `a1`, `b2`])
  })

  it(`should return correct results when all items share the same first orderBy value`, async () => {
    const initialData: Array<Item> = [
      { id: `x3`, category: `X`, name: `Cherry` },
      { id: `x1`, category: `X`, name: `Apple` },
      { id: `x2`, category: `X`, name: `Banana` },
      { id: `x4`, category: `X`, name: `Date` },
      { id: `x5`, category: `X`, name: `Elderberry` },
    ]

    const sourceCollection = createCollection(
      mockSyncCollectionOptions({
        id: `boundary-same-first-col`,
        getKey: (item: Item) => item.id,
        initialData,
        autoIndex: `eager`,
      }),
    )

    await sourceCollection.preload()

    const liveQuery = createLiveQueryCollection((q) =>
      q
        .from({ items: sourceCollection })
        .orderBy(({ items }) => items.category, `asc`)
        .orderBy(({ items }) => items.name, `asc`)
        .limit(3)
        .select(({ items }) => ({
          id: items.id,
          category: items.category,
          name: items.name,
        })),
    )

    await liveQuery.preload()
    await flushPromises()

    const results = Array.from(liveQuery.values())

    // All share category X, sorted by name: Apple (x1), Banana (x2), Cherry (x3), Date (x4), Elderberry (x5)
    // Top 3: Apple, Banana, Cherry
    expect(results).toHaveLength(3)
    expect(results.map((r) => r.id)).toEqual([`x1`, `x2`, `x3`])
  })

  it(`should handle multi-column orderBy with where filter correctly`, async () => {
    const initialData: Array<Item & { active: boolean }> = [
      { id: `a1`, category: `A`, name: `Zeta`, active: true },
      { id: `a2`, category: `A`, name: `Alpha`, active: false },
      { id: `a3`, category: `A`, name: `Beta`, active: true },
      { id: `b1`, category: `B`, name: `Gamma`, active: true },
      { id: `b2`, category: `B`, name: `Delta`, active: true },
      { id: `c1`, category: `C`, name: `Epsilon`, active: true },
    ]

    const sourceCollection = createCollection(
      mockSyncCollectionOptions({
        id: `boundary-multi-orderby-where`,
        getKey: (item: (typeof initialData)[0]) => item.id,
        initialData,
        autoIndex: `eager`,
      }),
    )

    await sourceCollection.preload()

    const liveQuery = createLiveQueryCollection((q) =>
      q
        .from({ items: sourceCollection })
        .where(({ items }) => eq(items.active, true))
        .orderBy(({ items }) => items.category, `asc`)
        .orderBy(({ items }) => items.name, `asc`)
        .limit(3)
        .select(({ items }) => ({
          id: items.id,
          category: items.category,
          name: items.name,
        })),
    )

    await liveQuery.preload()
    await flushPromises()

    const results = Array.from(liveQuery.values())

    // Active items sorted by (category asc, name asc):
    //   A-Beta (a3), A-Zeta (a1), B-Delta (b2), B-Gamma (b1), C-Epsilon (c1)
    // (a2 Alpha is inactive, filtered out)
    // Top 3: A-Beta, A-Zeta, B-Delta
    expect(results).toHaveLength(3)
    expect(results.map((r) => r.id)).toEqual([`a3`, `a1`, `b2`])
  })

  it(`should return only the first item when limit is 1`, async () => {
    const initialData: Array<Item> = [
      { id: `a1`, category: `A`, name: `Zeta` },
      { id: `a2`, category: `A`, name: `Alpha` },
      { id: `b1`, category: `B`, name: `Gamma` },
    ]

    const sourceCollection = createCollection(
      mockSyncCollectionOptions({
        id: `boundary-limit-1`,
        getKey: (item: Item) => item.id,
        initialData,
        autoIndex: `eager`,
      }),
    )

    await sourceCollection.preload()

    const liveQuery = createLiveQueryCollection((q) =>
      q
        .from({ items: sourceCollection })
        .orderBy(({ items }) => items.category, `asc`)
        .orderBy(({ items }) => items.name, `asc`)
        .limit(1)
        .select(({ items }) => ({
          id: items.id,
          category: items.category,
          name: items.name,
        })),
    )

    await liveQuery.preload()
    await flushPromises()

    const results = Array.from(liveQuery.values())

    // Full sort (category asc, name asc): A-Alpha (a2), A-Zeta (a1), B-Gamma (b1)
    // limit(1) → only A-Alpha
    expect(results).toHaveLength(1)
    expect(results.map((r) => r.id)).toEqual([`a2`])
  })

  it(`should return all rows when limit equals total row count`, async () => {
    const initialData: Array<Item> = [
      { id: `b1`, category: `B`, name: `Gamma` },
      { id: `a2`, category: `A`, name: `Alpha` },
      { id: `a1`, category: `A`, name: `Zeta` },
    ]

    const sourceCollection = createCollection(
      mockSyncCollectionOptions({
        id: `boundary-limit-equals-total`,
        getKey: (item: Item) => item.id,
        initialData,
        autoIndex: `eager`,
      }),
    )

    await sourceCollection.preload()

    const liveQuery = createLiveQueryCollection((q) =>
      q
        .from({ items: sourceCollection })
        .orderBy(({ items }) => items.category, `asc`)
        .orderBy(({ items }) => items.name, `asc`)
        .limit(3)
        .select(({ items }) => ({
          id: items.id,
          category: items.category,
          name: items.name,
        })),
    )

    await liveQuery.preload()
    await flushPromises()

    const results = Array.from(liveQuery.values())

    // All 3 rows in sorted order: A-Alpha (a2), A-Zeta (a1), B-Gamma (b1)
    expect(results).toHaveLength(3)
    expect(results.map((r) => r.id)).toEqual([`a2`, `a1`, `b1`])
  })

  it(`should update top-K after dynamic insert via sync`, async () => {
    const initialData: Array<Item> = [
      { id: `a1`, category: `A`, name: `Zeta` },
      { id: `b1`, category: `B`, name: `Gamma` },
      { id: `c1`, category: `C`, name: `Epsilon` },
    ]

    const options = mockSyncCollectionOptions({
      id: `boundary-dynamic-insert`,
      getKey: (item: Item) => item.id,
      initialData,
      autoIndex: `eager`,
    })

    const sourceCollection = createCollection(options)

    await sourceCollection.preload()

    const liveQuery = createLiveQueryCollection((q) =>
      q
        .from({ items: sourceCollection })
        .orderBy(({ items }) => items.category, `asc`)
        .orderBy(({ items }) => items.name, `asc`)
        .limit(2)
        .select(({ items }) => ({
          id: items.id,
          category: items.category,
          name: items.name,
        })),
    )

    await liveQuery.preload()
    await flushPromises()

    // Before insert — sorted: A-Zeta (a1), B-Gamma (b1), C-Epsilon (c1)
    // Top 2: A-Zeta, B-Gamma
    let results = Array.from(liveQuery.values())
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.id)).toEqual([`a1`, `b1`])

    // Insert a new item that should land in the top-2
    options.utils.begin()
    options.utils.write({
      type: `insert`,
      value: { id: `a2`, category: `A`, name: `Alpha` },
    })
    options.utils.commit()
    await flushPromises()

    // After insert — sorted: A-Alpha (a2), A-Zeta (a1), B-Gamma (b1), C-Epsilon (c1)
    // Top 2: A-Alpha, A-Zeta
    results = Array.from(liveQuery.values())
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.id)).toEqual([`a2`, `a1`])
  })
})
