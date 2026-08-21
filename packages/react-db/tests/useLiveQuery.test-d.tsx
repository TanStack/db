import { describe, expectTypeOf, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createCollection } from '../../db/src/collection/index'
import { collectionOptions } from '../../db/src/index'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import {
  Query,
  createLiveQueryCollection,
  eq,
  liveQueryCollectionOptions,
} from '../../db/src/query/index'
import { useLiveQuery } from '../src/useLiveQuery'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import { useDbClient } from '../src/DbProvider'
import { HydrationBoundary } from '../src/HydrationBoundary'
import type { DbClient, DehydratedDbState } from '../../db/src/index'
import type { JSX } from 'react'
import type { OutputWithVirtual } from '../../db/tests/utils'
import type { SingleResult } from '../../db/src/types'
import type { QueryBuilder } from '../../db/src/query/index'
import type {
  ConditionalUseLiveQueryConfig,
  UseLiveQueryConfig,
  UseLiveQueryStatus,
} from '../src/index'

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

  it(`types HydrationBoundary state`, () => {
    const state: DehydratedDbState = { collections: [] }
    const boundary = (
      <HydrationBoundary state={state}>
        <div />
      </HydrationBoundary>
    )

    expectTypeOf(boundary).toEqualTypeOf<JSX.Element>()
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

  it(`types a conditional findOne config object as disabled-capable`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-conditional-person-config`,
        getKey: (person: Person) => person.id,
        initialData: [],
      }),
    )
    const enabled = null as unknown as boolean
    const query = new Query()
      .from({ collection })
      .where(({ collection: c }) => eq(c.id, `3`))
      .findOne()
    type QueryContext =
      typeof query extends QueryBuilder<infer TContext> ? TContext : never
    const config: ConditionalUseLiveQueryConfig<QueryContext> = {
      queryKey: [collection.id, enabled],
      query: () => (enabled ? query : undefined),
    }

    const { result } = renderHook(() => {
      return useLiveQuery(config)
    })

    expectTypeOf(result.current.data).toMatchTypeOf<
      OutputWithVirtual<Person> | undefined
    >()
    expectTypeOf(result.current.status).toEqualTypeOf<UseLiveQueryStatus>()
    expectTypeOf(result.current.isEnabled).toEqualTypeOf<boolean>()
  })

  it(`accepts an annotated enabled config in useLiveSuspenseQuery`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-annotated-suspense-config`,
        getKey: (person: Person) => person.id,
        initialData: [],
      }),
    )
    const query = new Query().from({ collection })
    type QueryContext =
      typeof query extends QueryBuilder<infer TContext> ? TContext : never
    const config: UseLiveQueryConfig<QueryContext> = {
      query: () => query,
    }

    const { result } = renderHook(() => useLiveSuspenseQuery(config))

    expectTypeOf(result.current.data).toMatchTypeOf<
      Array<OutputWithVirtual<Person>>
    >()
  })

  it(`types a conditional config with deprecated dependencies`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-conditional-config-deps`,
        getKey: (person: Person) => person.id,
        initialData: [],
      }),
    )
    const enabled = null as unknown as boolean

    const { result } = renderHook(() =>
      useLiveQuery(
        {
          query: (q) =>
            enabled ? q.from({ collection }).findOne() : undefined,
        },
        [enabled],
      ),
    )

    expectTypeOf(result.current.data).toMatchTypeOf<
      OutputWithVirtual<Person> | undefined
    >()
    expectTypeOf(result.current.status).toEqualTypeOf<UseLiveQueryStatus>()
    expectTypeOf(result.current.isEnabled).toEqualTypeOf<boolean>()
  })

  it(`rejects a conditional config with a top-level scalar result`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-conditional-scalar-config`,
        getKey: (person: Person) => person.id,
        initialData: [],
      }),
    )
    const enabled = null as unknown as boolean

    useLiveQuery({
      // @ts-expect-error - top-level scalar results are not supported
      query: (q) => {
        if (!enabled) return undefined
        return q.from({ collection }).select(({ collection: c }) => c.name)
      },
    })
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

  it(`should type queryKey and a per-call DbClient override`, () => {
    const descriptor = collectionOptions(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-client-override`,
        getKey: (person: Person) => person.id,
        initialData: [],
      }),
    )
    const client = null as unknown as DbClient

    const { result } = renderHook(() => {
      return useLiveQuery({
        client,
        queryKey: [descriptor.id, `team`, `team-1`],
        query: (q) =>
          q
            .from({ person: descriptor })
            .where(({ person }) => eq(person.team, `team-1`)),
      })
    })

    expectTypeOf(result.current.data).toMatchTypeOf<
      Array<OutputWithVirtual<Person>>
    >()
  })

  it(`keeps the deprecated dependency-array overload typed`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-deprecated-deps`,
        getKey: (person: Person) => person.id,
        initialData: [],
      }),
    )

    const { result } = renderHook(() =>
      useLiveQuery(
        (q) =>
          q
            .from({ person: collection })
            .where(({ person }) => eq(person.team, `team-1`)),
        [`team-1`],
      ),
    )

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
