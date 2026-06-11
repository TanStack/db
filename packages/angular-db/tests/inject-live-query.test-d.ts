import { describe, expectTypeOf, it } from 'vitest'
import { createCollection } from '../../db/src/collection/index'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import {
  createLiveQueryCollection,
  eq,
  liveQueryCollectionOptions,
} from '../../db/src/query/index'
import { injectLiveQuery } from '../src/index'
import type { OutputWithVirtual } from '../../db/tests/utils'
import type { SingleResult } from '../../db/src/types'

type Person = {
  id: string
  name: string
  age: number
  email: string
  isActive: boolean
  team: string
}

describe(`injectLiveQuery type assertions`, () => {
  it(`should type findOne query builder to return a single row`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-findone-angular`,
        getKey: (person: Person) => person.id,
        initialData: [],
      }),
    )

    const { data } = injectLiveQuery((q) =>
      q
        .from({ collection })
        .where(({ collection: c }) => eq(c.id, `3`))
        .findOne(),
    )

    expectTypeOf(data()).toMatchTypeOf<OutputWithVirtual<Person> | undefined>()
  })

  it(`should type findOne config object to return a single row`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-findone-config-angular`,
        getKey: (person: Person) => person.id,
        initialData: [],
      }),
    )

    const { data } = injectLiveQuery({
      params: () => ({ id: `3` }),
      query: ({ params, q }) =>
        q
          .from({ collection })
          .where(({ collection: c }) => eq(c.id, params.id))
          .findOne(),
    })

    expectTypeOf(data()).toMatchTypeOf<OutputWithVirtual<Person> | undefined>()
  })

  it(`should type findOne collection using liveQueryCollectionOptions to return a single row`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-findone-options-angular`,
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

    const { data } = injectLiveQuery(liveQueryCollection)

    expectTypeOf(data()).toMatchTypeOf<OutputWithVirtual<Person> | undefined>()
  })

  it(`should type findOne collection using createLiveQueryCollection to return a single row`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-findone-create-angular`,
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

    const { data } = injectLiveQuery(liveQueryCollection)

    expectTypeOf(data()).toMatchTypeOf<OutputWithVirtual<Person> | undefined>()
  })

  it(`should type regular query to return an array`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-array-angular`,
        getKey: (person: Person) => person.id,
        initialData: [],
      }),
    )

    const { data } = injectLiveQuery((q) =>
      q
        .from({ collection })
        .where(({ collection: c }) => eq(c.isActive, true))
        .select(({ collection: c }) => ({
          id: c.id,
          name: c.name,
        })),
    )

    expectTypeOf(data()).toMatchTypeOf<
      Array<OutputWithVirtual<{ id: string; name: string }>>
    >()
  })
})
