import { describe, expectTypeOf, it } from "vitest"
import { renderHook } from "@testing-library/react"
import { createCollection } from "../../db/src/collection/index"
import { mockSyncCollectionOptions } from "../../db/tests/utils"
import {
  createLiveQueryCollection,
  eq,
  liveQueryCollectionOptions,
} from "../../db/src/query/index"
import { useLiveQuery } from "../src/useLiveQuery"

type Person = {
  id: string
  name: string
  age: number
  email: string
  isActive: boolean
  team: string
}

describe(`useLiveQuery type assertions`, () => {
  it(`should type findOne query builder to return a single row`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-2`,
        getKey: (person: Person) => person.id,
        initialData: [],
      })
    )

    const { result } = renderHook(() => {
      return useLiveQuery((q) =>
        q
          .from({ collection })
          .where(({ collection: c }) => eq(c.id, `3`))
          .findOne()
      )
    })

    expectTypeOf(result.current.data).toEqualTypeOf<Person | undefined>()
  })

  it(`should type findOne config object to return a single row`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-2`,
        getKey: (person: Person) => person.id,
        initialData: [],
      })
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

    expectTypeOf(result.current.data).toEqualTypeOf<Person | undefined>()
  })

  it(`should type findOne collection using liveQueryCollectionOptions to return a single row`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-2`,
        getKey: (person: Person) => person.id,
        initialData: [],
      })
    )

    const options = liveQueryCollectionOptions({
      query: (q) =>
        q
          .from({ collection })
          .where(({ collection: c }) => eq(c.id, `3`))
          .findOne(),
    })

    const liveQueryCollection = createCollection(options)

    expectTypeOf(liveQueryCollection).toExtend<{ singleResult: true }>()

    const { result } = renderHook(() => {
      return useLiveQuery(liveQueryCollection)
    })

    expectTypeOf(result.current.data).toEqualTypeOf<Person | undefined>()
  })

  it(`should type findOne collection using createLiveQueryCollection to return a single row`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-persons-2`,
        getKey: (person: Person) => person.id,
        initialData: [],
      })
    )

    const liveQueryCollection = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ collection })
          .where(({ collection: c }) => eq(c.id, `3`))
          .findOne(),
    })

    expectTypeOf(liveQueryCollection).toExtend<{ singleResult: true }>()

    const { result } = renderHook(() => {
      return useLiveQuery(liveQueryCollection)
    })

    expectTypeOf(result.current.data).toEqualTypeOf<Person | undefined>()
  })
})
