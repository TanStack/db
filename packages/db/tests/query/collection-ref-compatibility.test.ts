import { describe, expect, it } from 'vitest'
import { IR, collectionOptions, createCollection } from '../../src/index.js'

function source(id: string) {
  return createCollection<{ id: string }>({
    id,
    getKey: (row) => row.id,
    sync: { sync: ({ markReady }) => markReady() },
  })
}

describe(`CollectionRef public shape`, () => {
  it(`keeps a concrete Collection as a writable own field`, () => {
    const first = source(`collection-ref-first`)
    const second = source(`collection-ref-second`)
    const ref = new IR.CollectionRef(first, `item`)

    expect(Object.keys(ref).sort()).toEqual(
      [`type`, `collection`, `alias`].sort(),
    )
    expect({ ...ref }.collection).toBe(first)
    ref.collection = second
    expect(ref.collection).toBe(second)
    expect(ref.source).toBe(second)
  })

  it(`keeps a descriptor unbound until a client consumes its query`, () => {
    const descriptor = collectionOptions(`collection-ref-descriptor`, () => ({
      id: `collection-ref-descriptor`,
      getKey: (row: { id: string }) => row.id,
      sync: { sync: ({ markReady }) => markReady() },
    }))
    const ref = new IR.CollectionRef(descriptor, `item`)

    expect(ref.descriptor).toBe(descriptor)
    expect(ref.source).toBe(descriptor)
    expect(() => ref.collection).toThrow(/requires a DbClient/)
  })
})
