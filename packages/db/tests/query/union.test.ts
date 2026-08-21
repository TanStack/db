import { describe, expect, test } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { UnionKeyConflictError } from '../../src/errors.js'
import { union, unionFromLiveQuery } from '../../src/query/index.js'
import { mockSyncCollectionOptions } from '../utils.js'

type Item = {
  id: number
  value: string
}

function createItemsCollection(id: string, items: Array<Item>) {
  return createCollection(
    mockSyncCollectionOptions<Item>({
      id,
      getKey: (item) => item.id,
      initialData: items,
    }),
  )
}

describe(`union`, () => {
  test(`combines multiple collections into a single source`, async () => {
    const a = createItemsCollection(`items-a`, [
      { id: 1, value: `a1` },
      { id: 2, value: `a2` },
    ])
    const b = createItemsCollection(`items-b`, [{ id: 3, value: `b1` }])

    const unified = union(a, b)
    const items = await unified.toArrayWhenReady()

    const sorted = items.sort((left, right) => left.id - right.id)
    expect(sorted).toEqual([
      { id: 1, value: `a1` },
      { id: 2, value: `a2` },
      { id: 3, value: `b1` },
    ])
  })

  test(`throws when union sources share the same key`, async () => {
    const a = createItemsCollection(`items-a`, [{ id: 1, value: `a1` }])
    const b = createItemsCollection(`items-b`, [{ id: 1, value: `b1` }])

    const unified = union(a, b)

    await expect(unified.preload()).rejects.toThrow(UnionKeyConflictError)
    expect(unified.status).toBe(`error`)
  })
})

describe(`unionFromLiveQuery`, () => {
  test(`adds and removes sources based on live query results`, async () => {
    const sourceIndex = createItemsCollection(`sources`, [
      { id: 1, value: `first` },
      { id: 2, value: `second` },
    ])

    const collectionA = createItemsCollection(`items-a`, [
      { id: 1, value: `a` },
    ])
    const collectionB = createItemsCollection(`items-b`, [
      { id: 2, value: `b` },
    ])

    const unified = unionFromLiveQuery(
      (q) => q.from({ source: sourceIndex }),
      (result) => (result.id === 1 ? collectionA : collectionB),
    )

    await unified.preload()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(unified.toArray.map((row) => row.id)).toEqual([1, 2])

    sourceIndex.delete(2)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(unified.toArray.map((row) => row.id)).toEqual([1])
  })

  test(`keeps a source while multiple live query rows reference it`, async () => {
    const sourceIndex = createItemsCollection(`sources`, [
      { id: 1, value: `first` },
      { id: 2, value: `second` },
    ])

    const sharedCollection = createItemsCollection(`items-shared`, [
      { id: 1, value: `shared` },
    ])

    const unified = unionFromLiveQuery(
      (q) => q.from({ source: sourceIndex }),
      () => sharedCollection,
    )

    await unified.preload()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(unified.toArray.map((row) => row.id)).toEqual([1])

    sourceIndex.delete(1)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(unified.toArray.map((row) => row.id)).toEqual([1])

    sourceIndex.delete(2)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(unified.toArray).toEqual([])
  })
})
