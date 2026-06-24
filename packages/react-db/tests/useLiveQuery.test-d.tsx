import { describe, expectTypeOf, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createCollection } from '../../db/src/collection/index'
import { collectionOptions } from '../../db/src/index'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import {
  createLiveQueryCollection,
  eq,
  liveQueryCollectionOptions,
} from '../../db/src/query/index'
import { useLiveQuery } from '../src/useLiveQuery'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import { useDbClient } from '../src/DbProvider'
import type { DbClient } from '../../db/src/index'
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
  it(`should type useDbClient as DbClient`, () => {
    const client = useDbClient()
    expectTypeOf(client).toEqualTypeOf<DbClient>()
  })

  it(`should type findOne query builder to return a single row`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-2`,
        getKey: (person: Person) => person.id,
        initialData: [],
      }),
    )

    const { result } = renderHook(() => {
      return useLiveQuery((q) =>
        q
          .from({ collection })
          .where(({ collection: c }) => eq(c.id, `3`))
          .findOne(),
      )
    })

    expectTypeOf(result.current.data).toMatchTypeOf<
      OutputWithVirtual<Person> | undefined
    >()
  })

  it(`should type findOne config object to return a single row`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-2`,
        getKey: (person: Person) => person.id,
        initialData: [],
      }),
    )

    const { result } = renderHook(() => {
      return useLiveQuery({
        query: (q) =>
          q
            .from({ collection })
            .where(({ collection: c }) => eq(c.id, `3`))
            .findOne(),
      })
    })

    expectTypeOf(result.current.data).toMatchTypeOf<
      OutputWithVirtual<Person> | undefined
    >()
  })

  it(`should type config object to return query rows without queryKey`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-query-key`,
        getKey: (person: Person) => person.id,
        initialData: [],
      }),
    )

    const { result } = renderHook(() => {
      return useLiveQuery({
        query: (q) =>
          q
            .from({ collection })
            .where(({ collection: c }) => eq(c.team, `team-1`)),
      })
    })

    expectTypeOf(result.current.data).toMatchTypeOf<
      Array<OutputWithVirtual<Person>>
    >()
  })

  it(`should type collection descriptors in query sources`, () => {
    const collection = collectionOptions(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-descriptor-query-source`,
        getKey: (person: Person) => person.id,
        initialData: [],
      }),
    )

    const { result } = renderHook(() => {
      return useLiveQuery({
        query: (q) =>
          q
            .from({ collection })
            .where(({ collection: c }) => eq(c.team, `team-1`)),
      })
    })

    expectTypeOf(result.current.data).toMatchTypeOf<
      Array<OutputWithVirtual<Person>>
    >()
  })

  it(`should type suspense config object to return query rows without queryKey`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-suspense-query-key`,
        getKey: (person: Person) => person.id,
        initialData: [],
      }),
    )

    const { result } = renderHook(() => {
      return useLiveSuspenseQuery({
        query: (q) =>
          q
            .from({ collection })
            .where(({ collection: c }) => eq(c.team, `team-1`)),
      })
    })

    expectTypeOf(result.current.data).toMatchTypeOf<
      Array<OutputWithVirtual<Person>>
    >()
  })

  it(`should type infinite config object to return query rows without queryKey`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-infinite-query-key`,
        getKey: (person: Person) => person.id,
        initialData: [],
      }),
    )

    const { result } = renderHook(() => {
      return useLiveInfiniteQuery(
        (q) => q.from({ collection }).orderBy(({ collection: c }) => c.name),
        {
          pageSize: 10,
        },
      )
    })

    expectTypeOf(result.current.data).toMatchTypeOf<
      Array<OutputWithVirtual<Person>>
    >()
  })

  it(`should type findOne collection using liveQueryCollectionOptions to return a single row`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-2`,
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

    const { result } = renderHook(() => {
      return useLiveQuery(liveQueryCollection)
    })

    expectTypeOf(result.current.data).toMatchTypeOf<
      OutputWithVirtual<Person> | undefined
    >()
  })

  it(`should type findOne collection using createLiveQueryCollection to return a single row`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-2`,
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

    const { result } = renderHook(() => {
      return useLiveQuery(liveQueryCollection)
    })

    expectTypeOf(result.current.data).toMatchTypeOf<
      OutputWithVirtual<Person> | undefined
    >()
  })
})
