import { describe, expectTypeOf, it } from 'vitest'
import { createCollection } from '../../db/src/collection/index'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import {
  createLiveQueryCollection,
  eq,
  liveQueryCollectionOptions,
} from '../../db/src/query/index'
import { useLiveQuery } from '../src/useLiveQuery'
import type { ConditionalUseLiveQueryReturn } from '../src/index'
import type { Prettify } from '../../db/src/query/index'
import type {
  Collection,
  CollectionStatus,
  InitialQueryBuilder,
  QueryBuilder,
} from '@tanstack/db'
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
    expectTypeOf(data.value).toMatchTypeOf<
      OutputWithVirtual<Person> | undefined
    >()
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
    expectTypeOf(data.value).toMatchTypeOf<
      OutputWithVirtual<Person> | undefined
    >()
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
    expectTypeOf(data.value).toMatchTypeOf<
      OutputWithVirtual<Person> | undefined
    >()
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
    expectTypeOf(data.value).toMatchTypeOf<
      OutputWithVirtual<Person> | undefined
    >()
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
    expectTypeOf(data.value).toMatchTypeOf<
      Array<OutputWithVirtual<{ id: string; name: string }>>
    >()
  })

  it(`types disabled-capable callbacks from their empty reactive runtime`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-conditional-vue`,
        getKey: (person: Person) => person.id,
        initialData: [],
      }),
    )
    const enabled = null as unknown as boolean

    const result = useLiveQuery((q) =>
      enabled ? q.from({ collection }) : null,
    )

    const data: Array<OutputWithVirtual<Person>> = result.data.value
    expectTypeOf(data).toEqualTypeOf<Array<OutputWithVirtual<Person>>>()
    expectTypeOf(result.collection.value).toEqualTypeOf<Collection<
      Prettify<OutputWithVirtual<Person>>,
      string | number,
      {}
    > | null>()
    expectTypeOf(result.status.value).toEqualTypeOf<
      CollectionStatus | `disabled`
    >()

    // @ts-expect-error Disabled callbacks expose a null collection until enabled.
    result.collection.value.preload()
  })

  it(`types conditional findOne data with its empty disabled representation`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-conditional-find-one-vue`,
        getKey: (person: Person) => person.id,
        initialData: [],
      }),
    )
    const enabled = null as unknown as boolean
    const build = (q: InitialQueryBuilder) => q.from({ collection }).findOne()
    type QueryContext =
      ReturnType<typeof build> extends QueryBuilder<infer TContext>
        ? TContext
        : never

    const result = useLiveQuery((q) => (enabled ? build(q) : null))
    const annotated: ConditionalUseLiveQueryReturn<QueryContext> = result

    expectTypeOf(annotated).toEqualTypeOf<typeof result>()
    expectTypeOf(result.data.value).toEqualTypeOf<
      Prettify<OutputWithVirtual<Person>> | undefined | []
    >()
  })
})
