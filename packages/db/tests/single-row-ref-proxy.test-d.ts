import { describe, expectTypeOf, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { eq } from '../src/query/builder/functions.js'
import type { RefLeaf } from '../src/query/builder/types.js'

describe(`SingleRowRefProxy nested optional property access`, () => {
  type Doc = {
    id: string
    name: string
    updatedAt?: { seconds: number; nanoseconds: number }
    author: { name: string; contact?: { email: string } }
    deletedAt: { seconds: number } | null
  }

  const collection = createCollection<Doc, string>({
    getKey: (doc) => doc.id,
    sync: { sync: () => {} },
  })

  it(`allows optional chaining into an optional nested object`, () => {
    collection.createIndex((row) => {
      expectTypeOf(row.updatedAt?.seconds).toEqualTypeOf<
        RefLeaf<number> | undefined
      >()
      return row.updatedAt?.seconds
    })
  })

  it(`requires optional chaining for an optional nested object`, () => {
    collection.createIndex((row) => {
      // @ts-expect-error - updatedAt may be undefined, plain access must error
      return row.updatedAt.seconds
    })
  })

  it(`allows optional chaining into a nullable nested object`, () => {
    collection.createIndex((row) => {
      expectTypeOf(row.deletedAt?.seconds).toEqualTypeOf<
        RefLeaf<number> | undefined
      >()
      return row.deletedAt?.seconds
    })
  })

  it(`keeps required nested objects traversable without optional chaining`, () => {
    collection.createIndex((row) => {
      expectTypeOf(row.author.name).toEqualTypeOf<RefLeaf<string>>()
      return row.author.name
    })
  })

  it(`supports optional objects nested below a required object`, () => {
    collection.createIndex((row) => {
      expectTypeOf(row.author.contact?.email).toEqualTypeOf<
        RefLeaf<string> | undefined
      >()
      return row.author.contact?.email
    })
  })

  it(`keeps scalar fields as plain leaves`, () => {
    collection.createIndex((row) => {
      expectTypeOf(row.name).toEqualTypeOf<RefLeaf<string>>()
      return row.name
    })
  })

  it(`rejects properties that do not exist on the nested object`, () => {
    collection.createIndex((row) => {
      // @ts-expect-error - millis is not a property of updatedAt
      return row.updatedAt?.millis
    })
  })

  it(`accepts nested optional refs in the subscribeChanges where callback`, () => {
    collection.subscribeChanges(() => {}, {
      where: (row) => eq(row.updatedAt?.seconds, 5),
    })
  })
})
