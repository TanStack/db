import { createLiveQueryCollection, eq, inArray } from '@tanstack/db'
import { expect, vi } from 'vitest'
import { WAIT, test } from './e2e.utils'

test('reads seeded rows through PostgREST', ({ usersLive }) => {
  const names = usersLive.toArray.map((user) => user.name).sort()
  expect(names).toEqual(['Alice', 'Bob'])
})

test('pushes a WHERE filter down to PostgREST', async ({ users }) => {
  // Seeded fixture: Alice is active, Bob is not — so active=true returns one row.
  const live = createLiveQueryCollection((q) =>
    q
      .from({ row: users.collection })
      .where(({ row }) => eq(row.active, true))
      .select(({ row }) => ({ id: row.id, name: row.name })),
  )

  // finally (not fixture teardown) so this live query is cleaned up before the
  // `users` fixture tears down the base collection it depends on.
  try {
    await live.preload()
    await vi.waitFor(() => expect(live.size).toBe(1), WAIT)
    expect(live.toArray[0]?.name).toBe('Alice')
  } finally {
    await live.cleanup()
  }
})

test('reads a set larger than the server row cap across pages', async ({
  users,
  other,
}) => {
  // config.toml caps responses at 2 rows; reset_e2e seeds Alice + Bob, so three
  // more rows push the matching set past the cap and force the paging loop.
  const { error } = await other.from('users').insert([
    { name: 'Carol', email: 'carol@test.com', active: true },
    { name: 'Dave', email: 'dave@test.com', active: true },
    { name: 'Erin', email: 'erin@test.com', active: true },
  ] as unknown as never)
  expect(error).toBeNull()

  const live = createLiveQueryCollection((q) =>
    q
      .from({ row: users.collection })
      .select(({ row }) => ({ id: row.id, name: row.name })),
  )

  try {
    await live.preload()
    await vi.waitFor(() => expect(live.size).toBe(5), WAIT)
    // The full set comes back despite the cap, with each row exactly once.
    expect(live.toArray.map((row) => row.name).sort()).toEqual([
      'Alice',
      'Bob',
      'Carol',
      'Dave',
      'Erin',
    ])
    expect(new Set(live.toArray.map((row) => row.id)).size).toBe(5)
  } finally {
    await live.cleanup()
  }
})

// Empirically confirmed against the local stack (Kong): a raw request with
// 1,500 sequential ids renders to ~9.4 KB and comes back `414 Request-URI Too
// Large` with an `error.message` mentioning the URI length. 500-1,200 ids
// (~3-7.3 KB) still succeed, so the failure is specifically the request-line
// limit this feature works around, not some unrelated cap.
test('a raw oversized IN filter is rejected by the gateway (baseline)', async ({
  other,
}) => {
  const ids = Array.from({ length: 1500 }, (_, i) => i + 1)
  const { data, error, status } = await other
    .from('users')
    .select()
    .in('id', ids)

  expect(data).toBeNull()
  expect(status).toBe(414)
  expect(error?.message).toMatch(/too long/i)
})

test('the same oversized IN filter comes back complete through a collection', async ({
  users,
  other,
}) => {
  // Seed enough matching rows that the split spans more than one chunk: Alice
  // (id 1) and Bob (id 2) from reset_e2e, plus 50 more (ids 3-52).
  const extras = Array.from({ length: 50 }, (_, i) => ({
    name: `Extra ${i}`,
    email: `extra${i}@test.com`,
    active: true,
  }))
  const { error: insertError } = await other
    .from('users')
    .insert(extras as unknown as never)
  expect(insertError).toBeNull()

  // Same size (and shape) as the raw request above, which the gateway
  // rejected outright — this is the request the adapter must split.
  const ids = Array.from({ length: 1500 }, (_, i) => i + 1)
  const live = createLiveQueryCollection((q) =>
    q
      .from({ row: users.collection })
      .where(({ row }) => inArray(row.id, ids))
      .select(({ row }) => ({ id: row.id, name: row.name })),
  )

  try {
    await live.preload()
    await vi.waitFor(() => expect(live.size).toBe(52), WAIT)
    // Every matching row exactly once, despite coming back over several
    // concatenated chunk requests.
    expect(new Set(live.toArray.map((row) => row.id)).size).toBe(52)
  } finally {
    await live.cleanup()
  }
})
