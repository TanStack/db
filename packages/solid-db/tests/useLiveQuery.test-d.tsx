import { describe, expectTypeOf, it } from 'vitest'
import { renderHook } from '@solidjs/testing-library'
import { createCollection } from '../../db/src/collection/index'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import { createLiveQueryCollection, eq } from '../../db/src/query/index'
import { useLiveQuery } from '../src/useLiveQuery'
import type { Prettify } from '../../db/src/query/index'
import type { Collection, CollectionStatus } from '@tanstack/db'
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
        id: `test-persons-2`,
        getKey: (person: Person) => person.id,
        initialData: [],
      }),
    )

    const rendered = renderHook(() => {
      return useLiveQuery((q) =>
        q
          .from({ collection })
          .where(({ collection: c }) => eq(c.id, `3`))
          .findOne(),
      )
    })

    expectTypeOf(rendered.result()).toMatchTypeOf<
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

    const rendered = renderHook(() => {
      return useLiveQuery(() => liveQueryCollection)
    })

    expectTypeOf(rendered.result()).toMatchTypeOf<
      OutputWithVirtual<Person> | undefined
    >()
  })

  it(`should type non-findOne queries to return an array`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-2`,
        getKey: (person: Person) => person.id,
        initialData: [],
      }),
    )

    const rendered = renderHook(() => {
      return useLiveQuery((q) => q.from({ collection }))
    })

    expectTypeOf(rendered.result()).toMatchTypeOf<
      Array<OutputWithVirtual<Person>>
    >()
  })

  it(`types disabled callbacks from their empty reactive runtime`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-conditional-solid`,
        getKey: (person: Person) => person.id,
        initialData: [],
      }),
    )
    const enabled = null as unknown as boolean

    // Compile-time observation cut: the public accessors returned by the real
    // `useLiveQuery` hook; the preload error proves the live-query Collection
    // is absent while disabled.
    const rendered = renderHook(() =>
      useLiveQuery((q) => (enabled ? q.from({ collection }) : null)),
    )

    expectTypeOf(rendered.result()).toEqualTypeOf<
      Array<Prettify<OutputWithVirtual<Person>>>
    >()
    expectTypeOf(rendered.result.collection).toEqualTypeOf<Collection<
      Prettify<OutputWithVirtual<Person>>,
      string | number,
      {}
    > | null>()
    expectTypeOf(rendered.result.status).toEqualTypeOf<
      CollectionStatus | `disabled`
    >()

    // @ts-expect-error Disabled callbacks expose a null collection until enabled.
    rendered.result.collection.preload()
  })

  it(`types conditional findOne data with its empty disabled representation`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-conditional-find-one-solid`,
        getKey: (person: Person) => person.id,
        initialData: [],
      }),
    )
    const enabled = null as unknown as boolean

    // The exact public result combines enabled `findOne` cardinality with the
    // empty-reactive disabled value. A paired framework test owns transitions.
    const rendered = renderHook(() =>
      useLiveQuery((q) =>
        enabled ? q.from({ collection }).findOne() : undefined,
      ),
    )

    expectTypeOf(rendered.result()).toEqualTypeOf<
      Prettify<OutputWithVirtual<Person>> | undefined | []
    >()
  })
})
