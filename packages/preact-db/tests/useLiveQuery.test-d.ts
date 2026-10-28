import { describe, expectTypeOf, it } from 'vitest'
import { createCollection, createLiveQueryCollection, eq } from '@tanstack/db'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import { useLiveQuery } from '../src/useLiveQuery'
import type { CollectionStatus } from '@tanstack/db'
import type { OutputWithVirtual } from '../../db/tests/utils'
import type { UseLiveQueryStatus } from '../src/index'

type Person = { id: string; name: string; age: number }

const people = createCollection(
  mockSyncCollectionOptions<Person>({
    id: `type-people`,
    getKey: (person) => person.id,
    initialData: [],
  }),
)

describe(`useLiveQuery types`, () => {
  it(`types an always-enabled query callback`, () => {
    const result = useLiveQuery((q) =>
      q
        .from({ person: people })
        .select(({ person }) => ({ id: person.id, name: person.name })),
    )
    expectTypeOf(result.data).toMatchTypeOf<
      Array<OutputWithVirtual<{ id: string; name: string }>>
    >()
    expectTypeOf(result.status).toEqualTypeOf<CollectionStatus>()
    expectTypeOf(result.isEnabled).toEqualTypeOf<true>()
  })

  it(`types a callback that can disable the query`, () => {
    const enabled = null as unknown as boolean
    const result = useLiveQuery((q) =>
      enabled ? q.from({ person: people }) : undefined,
    )
    expectTypeOf(result.data).toMatchTypeOf<
      Array<OutputWithVirtual<Person>> | undefined
    >()
    expectTypeOf(result.state).toMatchTypeOf<
      ReadonlyMap<string | number, OutputWithVirtual<Person>> | undefined
    >()
    // A disabled query has no data, so the result must be narrowed first.
    // @ts-expect-error data can be undefined
    result.data.map((person) => person.id)
    expectTypeOf(result.status).toEqualTypeOf<UseLiveQueryStatus>()
    expectTypeOf(result.isEnabled).toEqualTypeOf<boolean>()
  })

  it(`types findOne as one row or undefined`, () => {
    const result = useLiveQuery((q) =>
      q
        .from({ person: people })
        .where(({ person }) => eq(person.id, `1`))
        .findOne(),
    )
    expectTypeOf(result.data).toMatchTypeOf<
      OutputWithVirtual<Person> | undefined
    >()
  })

  it(`types the config-object form`, () => {
    const result = useLiveQuery({
      query: (q) => q.from({ person: people }),
      gcTime: 1000,
    })
    expectTypeOf(result.data).toMatchTypeOf<Array<OutputWithVirtual<Person>>>()
  })

  it(`types a supplied live-query Collection`, () => {
    const adults = createLiveQueryCollection((q) =>
      q.from({ person: people }).select(({ person }) => ({ id: person.id })),
    )
    const result = useLiveQuery(adults)
    expectTypeOf(result.data).toMatchTypeOf<
      Array<OutputWithVirtual<{ id: string }>>
    >()
    expectTypeOf(result.isEnabled).toEqualTypeOf<true>()
  })
})
