import { describe, expectTypeOf, it } from 'vitest'
import { createCollection } from '../../db/src/collection/index'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import { useLiveQuery } from '../src/useLiveQuery.svelte.js'
import type { ConditionalUseLiveQueryReturn } from '../src/index.js'
import type { Prettify } from '../../db/src/query/index'
import type { Collection, CollectionStatus } from '@tanstack/db'
import type { OutputWithVirtual } from '../../db/tests/utils'

type Person = {
  id: string
  name: string
}

describe(`useLiveQuery type assertions`, () => {
  it(`types disabled-capable callbacks from their empty reactive runtime`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-conditional-svelte`,
        getKey: (person: Person) => person.id,
        initialData: [],
      }),
    )
    const enabled = null as unknown as boolean

    // Compile-time observation cut: the public properties returned by the real
    // `useLiveQuery` hook; the preload error proves the live-query Collection
    // is absent while disabled.
    const result = useLiveQuery((q) =>
      enabled ? q.from({ collection }) : undefined,
    )

    const data: Array<OutputWithVirtual<Person>> = result.data
    expectTypeOf(data).toEqualTypeOf<Array<OutputWithVirtual<Person>>>()
    expectTypeOf(result.collection).toEqualTypeOf<Collection<
      Prettify<OutputWithVirtual<Person>>,
      string | number,
      {}
    > | null>()
    expectTypeOf(result.status).toEqualTypeOf<CollectionStatus | `disabled`>()

    // @ts-expect-error Disabled callbacks expose a null collection until enabled.
    result.collection.preload()
  })

  it(`preserves findOne cardinality`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-find-one-svelte`,
        getKey: (person: Person) => person.id,
        initialData: [],
      }),
    )

    const result = useLiveQuery((q) => q.from({ collection }).findOne())

    const data: OutputWithVirtual<Person> | undefined = result.data
    expectTypeOf(data).toEqualTypeOf<OutputWithVirtual<Person> | undefined>()
  })

  it(`types conditional findOne data with its empty disabled representation`, () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `test-conditional-find-one-svelte`,
        getKey: (person: Person) => person.id,
        initialData: [],
      }),
    )
    const enabled = null as unknown as boolean

    // The exact public result combines enabled `findOne` cardinality with the
    // empty-reactive disabled value. A paired framework test owns transitions.
    const result = useLiveQuery((q) =>
      enabled ? q.from({ collection }).findOne() : null,
    )
    const annotated: ConditionalUseLiveQueryReturn<
      Prettify<OutputWithVirtual<Person>>,
      Prettify<OutputWithVirtual<Person>> | undefined | []
    > = result

    expectTypeOf(annotated).toEqualTypeOf<typeof result>()
    expectTypeOf(result.data).toEqualTypeOf<
      Prettify<OutputWithVirtual<Person>> | undefined | []
    >()
  })
})
