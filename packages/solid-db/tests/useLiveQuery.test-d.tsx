import { describe, expectTypeOf, it } from 'vitest'
import { renderHook } from '@solidjs/testing-library'
import { createCollection } from '../../db/src/collection/index'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import { createLiveQueryCollection, eq } from '../../db/src/query/index'
import { useLiveQuery } from '../src/useLiveQuery'
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
})
