import { describe, expect, test } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import {
  caseWhen,
  createLiveQueryCollection,
  eq,
  gt,
} from '../../src/query/index.js'
import { mockSyncCollectionOptions, stripVirtualProps } from '../utils.js'

type User = {
  id: number
  name: string
  age: number
  active: boolean
}

const sampleUsers: Array<User> = [
  { id: 1, name: `Alice`, age: 30, active: true },
  { id: 2, name: `Bob`, age: 17, active: false },
  { id: 3, name: `Charlie`, age: 22, active: true },
]

function createUsersCollection() {
  return createCollection(
    mockSyncCollectionOptions<User>({
      id: `case-when-users`,
      getKey: (user) => user.id,
      initialData: sampleUsers,
    }),
  )
}

describe(`caseWhen`, () => {
  test(`returns scalar branch values`, async () => {
    const users = createUsersCollection()
    const query = createLiveQueryCollection((q) =>
      q
        .from({ user: users })
        .select(({ user }) => ({
          id: user.id,
          category: caseWhen(gt(user.age, 18), `adult`, `minor`),
          maybeActive: caseWhen(eq(user.active, true), `active`),
        }))
        .orderBy(({ user }) => user.id),
    )

    await query.preload()

    expect(query.toArray.map((row) => stripVirtualProps(row))).toEqual([
      { id: 1, category: `adult`, maybeActive: `active` },
      { id: 2, category: `minor`, maybeActive: null },
      { id: 3, category: `adult`, maybeActive: `active` },
    ])
  })

  test(`works in where and orderBy expressions`, async () => {
    const users = createUsersCollection()
    const query = createLiveQueryCollection((q) =>
      q
        .from({ user: users })
        .where(({ user }) => caseWhen(eq(user.active, true), true, false))
        .orderBy(({ user }) => caseWhen(eq(user.name, `Alice`), 0, user.age))
        .select(({ user }) => ({
          id: user.id,
          name: user.name,
        })),
    )

    await query.preload()

    expect(query.toArray.map((row) => stripVirtualProps(row))).toEqual([
      { id: 1, name: `Alice` },
      { id: 3, name: `Charlie` },
    ])
  })

  test(`selects conditional projection objects`, async () => {
    const users = createUsersCollection()
    const query = createLiveQueryCollection((q) =>
      q
        .from({ user: users })
        .select(({ user }) => ({
          id: user.id,
          adultProfile: caseWhen(gt(user.age, 18), {
            id: user.id,
            name: user.name,
            label: `adult`,
          }),
        }))
        .orderBy(({ user }) => user.id),
    )

    await query.preload()

    expect(query.toArray.map((row) => stripVirtualProps(row))).toEqual([
      { id: 1, adultProfile: { id: 1, name: `Alice`, label: `adult` } },
      { id: 2, adultProfile: undefined },
      { id: 3, adultProfile: { id: 3, name: `Charlie`, label: `adult` } },
    ])
  })
})
