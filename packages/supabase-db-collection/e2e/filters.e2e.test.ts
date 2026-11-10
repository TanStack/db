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
import { makeUsersCollection, test } from './e2e.utils'

const name = new IR.PropRef<string>([`user`, `name`])
const active = new IR.PropRef<boolean>([`user`, `active`])
const id = new IR.PropRef<number>([`user`, `id`])

// An on-demand live query sends its WHERE to PostgREST and becomes ready once
// that read has finished, so its rows are the server's answer filtered again
// on the client. A filter the server applies too strictly loses rows, which
// the client cannot add back. Each call reads through a fresh collection, so
// rows an earlier query loaded cannot hide the loss.
const liveNames = async (where: IR.BasicExpression<boolean>) => {
  const { collection, supabase } = makeUsersCollection()
  const live = createLiveQueryCollection((q) =>
    q.from({ user: collection }).where(() => where),
  )
  try {
    await live.preload()
    return live.toArray.map((row) => row.name).sort()
  } finally {
    await live.cleanup()
    await collection.cleanup()
    await supabase.removeAllChannels()
  }
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
  test(`${label} returns matching rows through a live query`, async () => {
    expect(await liveNames(where)).toEqual(expected)
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
      expect(await liveNames(where), JSON.stringify(where)).toEqual([value])
    }
  })
}

test(`LIKE treats backslashes literally`, async ({ other }) => {
  const value = `a\\path`
  const { error } = await other
    .from(`users`)
    .insert({ name: value, email: `slash@test.com` } as unknown as never)
  expect(error).toBeNull()
  for (const where of [
    like(name, `a\\%`),
    or(like(name, `a\\%`), eq(id, -1)),
  ]) {
    expect(await liveNames(where), JSON.stringify(where)).toEqual([value])
  }
})

test(`unsupported OR and negated patterns retain rows for client filtering`, async () => {
  expect(
    await liveNames(or(eq(name, `Nobody`), eq(upper(name), `ALICE`))),
  ).toEqual([`Alice`])
  // PostgREST would interpret * as a wildcard and remove Alice here, whereas
  // TanStack treats it literally and should keep both seeded names.
  expect(await liveNames(not(like(name, `*Ali*`)))).toEqual([`Alice`, `Bob`])
})
