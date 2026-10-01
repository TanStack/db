import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { localOnlyCollectionOptions } from '../src/local-only.js'
import { mockSyncCollectionOptions, withExpectedRejection } from './utils.js'

/**
 * A row read with virtual props is a copy, cached so repeated reads and
 * publications share one object. These laws pin what that cache must keep:
 * the value a change publishes is the row later reads return, for every
 * subscriber, and a key that leaves the collection leaves the cache.
 */
type Row = { id: string; a: number }
const cacheSize = (collection: unknown) =>
  (collection as { _state: { virtualPropsCache: Map<unknown, unknown> } })
    ._state.virtualPropsCache.size

describe(`virtual props cache`, () => {
  it(`publishes the row that later reads return, to every subscriber`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `virtual-props-cache-sync`,
        getKey: (row) => row.id,
        initialData: [{ id: `x`, a: 0 }],
      }),
    )
    await collection.stateWhenReady()
    const first: Array<unknown> = []
    const second: Array<unknown> = []
    collection.subscribeChanges((changes) =>
      first.push(...changes.map((c) => c.value)),
    )
    collection.subscribeChanges((changes) =>
      second.push(...changes.map((c) => c.value)),
    )
    for (const a of [1, 2]) {
      collection.utils.begin()
      collection.utils.write({ type: `update`, value: { id: `x`, a } })
      collection.utils.commit()
      expect(first.at(-1)).toBe(collection.get(`x`))
      expect(second.at(-1)).toBe(first.at(-1))
      expect(collection.toArray[0]).toBe(first.at(-1))
    }
  })

  it(`publishes the row that later reads return after local writes`, () => {
    const collection = createCollection(
      localOnlyCollectionOptions<Row>({
        id: `virtual-props-cache-local`,
        getKey: (row) => row.id,
        initialData: [{ id: `x`, a: 0 }],
      }),
    )
    const published: Array<unknown> = []
    collection.subscribeChanges((changes) =>
      published.push(...changes.map((c) => c.value)),
    )
    for (const a of [1, 2]) {
      collection.update(`x`, (draft) => {
        draft.a = a
      })
      expect(published.at(-1)).toBe(collection.get(`x`))
    }
  })

  it(`drops a key's entry when the key is deleted or rolled back`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `virtual-props-cache-delete`,
        getKey: (row) => row.id,
        initialData: [{ id: `x`, a: 0 }],
      }),
    )
    await collection.stateWhenReady()
    collection.subscribeChanges(() => {})
    collection.get(`x`)
    collection.utils.begin()
    collection.utils.write({ type: `delete`, value: { id: `x`, a: 0 } })
    collection.utils.commit()
    expect(cacheSize(collection)).toBe(0)

    await withExpectedRejection(`rolled back`, async () => {
      const transaction = collection.insert({ id: `y`, a: 1 })
      collection.get(`y`)
      collection.utils.rejectSync(new Error(`rolled back`))
      await transaction.isPersisted.promise.catch(() => undefined)
    })
    expect(collection.has(`y`)).toBe(false)
    expect(cacheSize(collection)).toBe(0)
  })
})
