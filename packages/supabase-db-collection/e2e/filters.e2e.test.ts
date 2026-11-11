import {
  IR,
  and,
  createLiveQueryCollection,
  eq,
  ilike,
  inArray,
  like,
  not,
  or,
  upper,
} from '@tanstack/db'
import { expect } from 'vitest'
import { experimental_queryOnce } from '../src/index'
import { executeQuery } from '../src/query-once'
import { makeUsersCollection, test } from './e2e.utils'

const name = new IR.PropRef<string>([`user`, `name`])
const active = new IR.PropRef<boolean>([`user`, `active`])
const id = new IR.PropRef<number>([`user`, `id`])

// Each case reads the same filter on three paths, and every path asserts the
// rows it returns, not the shape of a URL:
//
// - An on-demand live query sends its WHERE to PostgREST and becomes ready
//   once that read has finished, so its rows are the server's answer filtered
//   again on the client.
// - `experimental_queryOnce` runs the same one-shot query through TanStack
//   DB's `queryOnce`.
// - `executeQuery` sends a serialized query IR straight to PostgREST, through
//   the translation that server-side aggregates use. Nothing filters its rows
//   again, so a filter the server applies too loosely shows up here.
//
// A filter the server applies too strictly loses rows, which the client
// cannot add back. Each call reads through a fresh collection, so rows an
// earlier query loaded cannot hide the loss.
const withUsers = async <T>(
  read: (users: ReturnType<typeof makeUsersCollection>) => Promise<T>,
): Promise<T> => {
  const users = makeUsersCollection()
  try {
    return await read(users)
  } finally {
    await users.collection.cleanup()
    await users.supabase.removeAllChannels()
  }
}

const sortedNames = (rows: Array<unknown>) =>
  rows.map((row) => (row as { name: string }).name).sort()

const liveNames = (where: IR.BasicExpression<boolean>) =>
  withUsers(async ({ collection }) => {
    const live = createLiveQueryCollection((q) =>
      q.from({ user: collection }).where(() => where),
    )
    try {
      await live.preload()
      return sortedNames(live.toArray)
    } finally {
      await live.cleanup()
    }
  })

const queryOnceNames = (where: IR.BasicExpression<boolean>) =>
  withUsers(async ({ collection, supabase }) =>
    sortedNames(
      await experimental_queryOnce(
        (q) => q.from({ user: collection }).where(() => where),
        supabase,
      ),
    ),
  )

const serverNames = (where: IR.BasicExpression<boolean>) =>
  withUsers(async ({ supabase }) =>
    sortedNames(
      await executeQuery(supabase, {
        from: { type: `table`, name: `users`, alias: `user` },
        where: [where],
      }),
    ),
  )

const expectNamesOnEveryPath = async (
  where: IR.BasicExpression<boolean>,
  expected: ReadonlyArray<string>,
) => {
  const label = JSON.stringify(where)
  expect(await liveNames(where), `live query ${label}`).toEqual(expected)
  expect(await queryOnceNames(where), `queryOnce ${label}`).toEqual(expected)
  expect(await serverNames(where), `executeQuery ${label}`).toEqual(expected)
}

const cases = [
  [`OR`, or(eq(name, `Alice`), eq(name, `Nobody`)), [`Alice`]],
  [
    `nested AND/OR`,
    or(and(eq(active, true), eq(name, `Bob`)), eq(id, 2)),
    [`Bob`],
  ],
  [`NOT AND`, not(and(eq(active, true), eq(name, `Alice`))), [`Bob`]],
  [`NOT OR`, not(or(eq(active, true), eq(name, `Nobody`))), [`Bob`]],
  [`double NOT`, not(not(or(eq(active, true), eq(name, `Nobody`)))), [`Alice`]],
  [`LIKE`, like(name, `A_i%`), [`Alice`]],
  [`ILIKE`, ilike(name, `%ALI%`), [`Alice`]],
  [`NOT LIKE`, not(like(name, `A%`)), [`Bob`]],
  [
    `OR ILIKE`,
    or(ilike(name, `%ali%`), ilike(name, `%bOB%`)),
    [`Alice`, `Bob`],
  ],
  [`overlapping IN`, and(inArray(id, [1, 2]), inArray(id, [2, 3])), [`Bob`]],
  [`empty IN`, inArray(id, []), []],
  [`NOT empty IN`, not(inArray(id, [])), [`Alice`, `Bob`]],
  [`NOT IN with null`, not(inArray(name, [`Alice`, null])), [`Bob`]],
] as const

for (const [label, where, expected] of cases) {
  test(`${label} returns matching rows on every query path`, async () => {
    await expectNamesOnEveryPath(where, expected)
  })
}

for (const value of [``, ` a `, `a,b(c)`, `a"b\\c`, `a.b:c&d=1+%`, `{a,b}`]) {
  test(`reserved value ${JSON.stringify(value)} round-trips through filters`, async ({
    other,
  }) => {
    const { error } = await other
      .from(`users`)
      .insert({ name: value, email: `special@test.com` } as unknown as never)
    expect(error).toBeNull()
    for (const where of [
      eq(name, value),
      or(eq(name, value), eq(id, -1)),
      inArray(name, [value]),
    ]) {
      await expectNamesOnEveryPath(where, [value])
    }
  })
}

test(`LIKE treats backslashes literally on every query path`, async ({
  other,
}) => {
  const value = `a\\path`
  const { error } = await other
    .from(`users`)
    .insert({ name: value, email: `slash@test.com` } as unknown as never)
  expect(error).toBeNull()
  for (const where of [
    like(name, `a\\%`),
    or(like(name, `a\\%`), eq(id, -1)),
  ]) {
    await expectNamesOnEveryPath(where, [value])
  }
})

// executeQuery is left out here: it returns PostgREST's rows without
// filtering them again, so a filter PostgREST cannot express has no exact
// answer on that path.
test(`unsupported OR and negated patterns retain rows for client filtering`, async () => {
  for (const read of [liveNames, queryOnceNames]) {
    expect(
      await read(or(eq(name, `Nobody`), eq(upper(name), `ALICE`))),
    ).toEqual([`Alice`])
    // PostgREST would interpret * as a wildcard and remove Alice here, whereas
    // TanStack treats it literally and should keep both seeded names.
    expect(await read(not(like(name, `*Ali*`)))).toEqual([`Alice`, `Bob`])
  }
})
