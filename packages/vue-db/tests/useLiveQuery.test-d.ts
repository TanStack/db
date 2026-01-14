import { describe, expectTypeOf, it } from 'vitest'
import { createCollection } from '../../db/src/collection/index'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import {
  createLiveQueryCollection,
  eq,
  liveQueryCollectionOptions,
} from '../../db/src/query/index'
import { useLiveQuery } from '../src/useLiveQuery'
import type { SingleResult } from '../../db/src/types'

type Person = {
  id: string
  name: string
  age: number
  email: string
  isActive: boolean
  team: string
}

describe(`useLiveQuery type assertions`, () => {
  it(`should type findOne query builder to return a single row`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-findone-vue`,
        getKey: (person: Person) => person.id,
        initialData: [],
      }),
    )

    const { data } = useLiveQuery((q) =>
      q
        .from({ collection })
        .where(({ collection: c }) => eq(c.id, `3`))
        .findOne(),
    )

    // BUG: Currently returns ComputedRef<Array<Person>> but should be ComputedRef<Person | undefined>
    expectTypeOf(data.value).toEqualTypeOf<Person | undefined>()
  })

  it(`should type findOne config object to return a single row`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-findone-config-vue`,
        getKey: (person: Person) => person.id,
        initialData: [],
      }),
    )

    const { data } = useLiveQuery({
      query: (q) =>
        q
          .from({ collection })
          .where(({ collection: c }) => eq(c.id, `3`))
          .findOne(),
    })

    // BUG: Currently returns ComputedRef<Array<Person>> but should be ComputedRef<Person | undefined>
    expectTypeOf(data.value).toEqualTypeOf<Person | undefined>()
  })

  it(`should type findOne collection using liveQueryCollectionOptions to return a single row`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-findone-options-vue`,
        getKey: (person: Person) => person.id,
        initialData: [],
      }),
    )

    const options = liveQueryCollectionOptions({
      query: (q) =>
        q
          .from({ collection })
          .where(({ collection: c }) => eq(c.id, `3`))
          .findOne(),
    })

    const liveQueryCollection = createCollection(options)

    expectTypeOf(liveQueryCollection).toExtend<SingleResult>()

    const { data } = useLiveQuery(liveQueryCollection)

    // BUG: Currently returns ComputedRef<Array<Person>> but should be ComputedRef<Person | undefined>
    expectTypeOf(data.value).toEqualTypeOf<Person | undefined>()
  })

  it(`should type findOne collection using createLiveQueryCollection to return a single row`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-findone-create-vue`,
        getKey: (person: Person) => person.id,
        initialData: [],
      }),
    )

    const liveQueryCollection = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ collection })
          .where(({ collection: c }) => eq(c.id, `3`))
          .findOne(),
    })

    expectTypeOf(liveQueryCollection).toExtend<SingleResult>()

    const { data } = useLiveQuery(liveQueryCollection)

    // BUG: Currently returns ComputedRef<Array<Person>> but should be ComputedRef<Person | undefined>
    expectTypeOf(data.value).toEqualTypeOf<Person | undefined>()
  })

  it(`should type regular query to return an array`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-array-vue`,
        getKey: (person: Person) => person.id,
        initialData: [],
      }),
    )

    const { data } = useLiveQuery((q) =>
      q
        .from({ collection })
        .where(({ collection: c }) => eq(c.isActive, true))
        .select(({ collection: c }) => ({
          id: c.id,
          name: c.name,
        })),
    )

    // Regular queries should return an array
    expectTypeOf(data.value).toEqualTypeOf<Array<{ id: string; name: string }>>()
  })
})
