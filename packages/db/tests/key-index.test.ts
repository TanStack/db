import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { KeyIndex, createKeyIndexFromGetKey } from '../src/indexes/key-index.js'
import { BasicIndex } from '../src/indexes/basic-index.js'
import { findIndexForField } from '../src/utils/index-optimization.js'
import { mockSyncCollectionOptions } from './utils.js'

type Item = {
  id: string
  category: string
}

const sampleItems: Array<Item> = [
  { id: `a`, category: `one` },
  { id: `b`, category: `one` },
  { id: `c`, category: `two` },
]

function makeCollection(getKey: (item: Item) => string) {
  return createCollection(
    mockSyncCollectionOptions<Item>({
      id: `key-index-test`,
      getKey,
      initialData: sampleItems,
    }),
  )
}

describe(`createKeyIndexFromGetKey`, () => {
  it(`derives an index from a single property access`, () => {
    const keys = new Set([`a`, `b`])
    const index = createKeyIndexFromGetKey<Item, string>(
      (item) => item.id,
      (key) => keys.has(key),
      () => keys.size,
    )

    expect(index).toBeInstanceOf(KeyIndex)
    expect(index!.matchesField([`id`])).toBe(true)
    expect(index!.matchesField([`category`])).toBe(false)
    expect(index!.keyCount).toBe(2)
  })

  it(`returns undefined for a composite key`, () => {
    const index = createKeyIndexFromGetKey<Item, string>(
      (item) => `${item.id}:${item.category}`,
      () => true,
      () => 0,
    )

    expect(index).toBeUndefined()
  })

  it(`returns undefined when getKey does not read a property`, () => {
    const index = createKeyIndexFromGetKey<Item, string>(
      (item) => item as unknown as string,
      () => true,
      () => 0,
    )

    expect(index).toBeUndefined()
  })

  it(`returns undefined when getKey throws on the introspection proxy`, () => {
    const index = createKeyIndexFromGetKey<Item, string>(
      () => {
        throw new Error(`boom`)
      },
      () => true,
      () => 0,
    )

    expect(index).toBeUndefined()
  })
})

describe(`KeyIndex lookups`, () => {
  const keys = new Set([`a`, `b`])
  const index = createKeyIndexFromGetKey<Item, string>(
    (item) => item.id,
    (key) => keys.has(key),
    () => keys.size,
  )!

  it(`supports only eq and in`, () => {
    expect(index.supports(`eq`)).toBe(true)
    expect(index.supports(`in`)).toBe(true)
    expect(index.supports(`gt`)).toBe(false)
    expect(index.supports(`lte`)).toBe(false)
    expect(index.supportsRangeOptimization).toBe(false)
  })

  it(`resolves eq lookups through the key set`, () => {
    expect(index.lookup(`eq`, `a`)).toEqual(new Set([`a`]))
    expect(index.lookup(`eq`, `missing`)).toEqual(new Set())
    expect(index.lookup(`eq`, null)).toEqual(new Set())
  })

  it(`resolves in lookups by filtering to present keys`, () => {
    expect(index.lookup(`in`, [`a`, `b`, `missing`])).toEqual(
      new Set([`a`, `b`]),
    )
    expect(index.lookup(`in`, [])).toEqual(new Set())
  })

  it(`rejects unsupported operations`, () => {
    expect(() => index.lookup(`gt`, `a`)).toThrow(
      `Operation gt not supported by KeyIndex`,
    )
  })
})

describe(`collection.keyIndex`, () => {
  it(`is derived for a plain property getKey and reflects live state`, () => {
    const collection = makeCollection((item) => item.id)
    const keyIndex = collection.keyIndex

    expect(keyIndex).toBeInstanceOf(KeyIndex)
    expect(keyIndex!.matchesField([`id`])).toBe(true)
    expect(keyIndex!.lookup(`eq`, `a`)).toEqual(new Set([`a`]))
    expect(keyIndex!.lookup(`in`, [`a`, `c`, `zzz`])).toEqual(
      new Set([`a`, `c`]),
    )

    collection.utils.begin()
    collection.utils.write({
      type: `insert`,
      value: { id: `d`, category: `two` },
    })
    collection.utils.commit()

    expect(keyIndex!.lookup(`eq`, `d`)).toEqual(new Set([`d`]))
  })

  it(`is undefined for a composite getKey`, () => {
    const collection = makeCollection((item) => `${item.id}:${item.category}`)

    expect(collection.keyIndex).toBeUndefined()
  })
})

describe(`findIndexForField key-index fallback`, () => {
  it(`serves the key field when no explicit index exists`, () => {
    const collection = makeCollection((item) => item.id)

    const index = findIndexForField(collection, [`id`])

    expect(index).toBe(collection.keyIndex)
    expect(index!.lookup(`eq`, `b`)).toEqual(new Set([`b`]))
  })

  it(`prefers an explicit index on the key field`, () => {
    const collection = makeCollection((item) => item.id)
    collection.createIndex((row) => row.id, { indexType: BasicIndex })

    const index = findIndexForField(collection, [`id`])

    expect(index).toBeInstanceOf(BasicIndex)
  })

  it(`does not serve non-key fields`, () => {
    const collection = makeCollection((item) => item.id)

    expect(findIndexForField(collection, [`category`])).toBeUndefined()
  })

  it(`does not serve collections with a composite key`, () => {
    const collection = makeCollection((item) => `${item.id}:${item.category}`)

    expect(findIndexForField(collection, [`id`])).toBeUndefined()
  })

  it(`is conservatively skipped for collections with a custom string collation`, () => {
    const collection = createCollection<Item, string>({
      getKey: (item) => item.id,
      defaultStringCollation: { stringSort: `lexical` },
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const item of sampleItems) {
            write({ type: `insert`, value: item })
          }
          commit()
          markReady()
        },
      },
    })

    // The key index itself is derivable, but its compare options are the
    // defaults, so lookups under a custom collation fall back to a full scan.
    expect(collection.keyIndex).toBeInstanceOf(KeyIndex)
    expect(findIndexForField(collection, [`id`])).toBeUndefined()
  })
})
