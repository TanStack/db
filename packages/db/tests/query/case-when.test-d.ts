import { describe, expectTypeOf, test } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import {
  caseWhen,
  createLiveQueryCollection,
  gt,
} from '../../src/query/index.js'
import { mockSyncCollectionOptions } from '../utils.js'
import type { OutputWithVirtual } from '../utils.js'

type User = {
  id: number
  name: string
  age: number
  active: boolean
}

type OutputWithVirtualKeyed<T extends object> = OutputWithVirtual<
  T,
  string | number
>

function createUsers() {
  return createCollection(
    mockSyncCollectionOptions<User>({
      id: `case-when-type-users`,
      getKey: (user) => user.id,
      initialData: [],
    }),
  )
}

describe(`caseWhen types`, () => {
  test(`infers scalar branch values`, () => {
    const users = createUsers()
    const query = createLiveQueryCollection((q) =>
      q.from({ user: users }).select(({ user }) => ({
        id: user.id,
        category: caseWhen(gt(user.age, 18), `adult`, `minor`),
        maybeAdult: caseWhen(gt(user.age, 18), `adult`),
      })),
    )

    const result = query.toArray[0]!

    expectTypeOf(result).toMatchTypeOf<
      OutputWithVirtualKeyed<{
        id: number
        category: string
        maybeAdult: string | null
      }>
    >()
  })

  test(`infers conditional projection values`, () => {
    const users = createUsers()
    const query = createLiveQueryCollection((q) =>
      q.from({ user: users }).select(({ user }) => {
        const adultProfile = caseWhen(gt(user.age, 18), {
          id: user.id,
          name: user.name,
        })
        return {
          id: user.id,
          adultProfile,
        }
      }),
    )

    const result = query.toArray[0]!

    expectTypeOf(result).toMatchTypeOf<
      OutputWithVirtualKeyed<{
        id: number
        adultProfile:
          | {
              id: number
              name: string
            }
          | undefined
      }>
    >()
  })
})
