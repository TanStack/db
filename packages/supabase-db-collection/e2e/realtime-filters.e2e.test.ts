import {
  and,
  createLiveQueryCollection,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  not,
  or,
} from '@tanstack/db'
import { expect, vi } from 'vitest'
import {
  WAIT,
  makeFilteredRealtimeUsers,
  startFilteredRealtime,
  test,
} from './e2e.utils'

// These tests drive the realtimeUseFilter path end to end: a live query's WHERE
// becomes a server-side postgres_changes filter via realtimeFiltersToSearch.
// Unit tests only prove we format the filter string correctly against a mock
// channel; these prove the REAL Supabase Realtime server both accepts that
// syntax and evaluates it — when the server rejects a filter the adapter
// silently falls back to catch-all, so a broken operator would pass unit tests
// yet stop filtering in production. Each test's waitForChannel (inside
// startFilteredRealtime) only resolves once the server accepted the filter.

// Builds a filtered realtime users row payload. Ids stay above the Alice/Bob
// seed (1, 2) so inserts never collide with the reset_e2e() identity sequence.
const userRow = (
  id: number,
  over: Partial<{ name: string; email: string; active: boolean }> = {},
) => ({ id, name: `u${id}`, email: `u${id}@test.com`, active: true, ...over })

// ── Value quoting (reserved characters + whitespace) ──────────────────
// Names deliberately exercise quoteValue's branches: a comma (reserved) and
// surrounding whitespace (only quoted since realtimeFiltersToSearch adopted the
// shared quoteValue). Both must round-trip through the real server.
const QUOTED_NAMES = ['Doe, Jane', ' spaced '] as const

for (const value of QUOTED_NAMES) {
  test(`realtime filter on ${JSON.stringify(value)} delivers matching inserts`, async ({
    other,
  }) => {
    const ctx = makeFilteredRealtimeUsers()
    const live = createLiveQueryCollection((q) =>
      q
        .from({ row: ctx.collection })
        .where(({ row }) => eq(row.name, value))
        .select(({ row }) => ({ id: row.id, name: row.name })),
    )
    const cleanup = await startFilteredRealtime(ctx, live)
    try {
      const { error } = await other
        .from('users')
        .insert([
          { ...userRow(300), name: value },
          userRow(301, { name: 'Someone Else' }),
        ] as unknown as never)
      expect(error).toBeNull()

      await vi.waitFor(
        () => expect(live.toArray.map((row) => row.name)).toEqual([value]),
        WAIT,
      )
      expect(ctx.collection.toArray.some((r) => r.id === 301)).toBe(false)
    } finally {
      await cleanup()
    }
  })
}

// ── Operator matrix: does the real server accept each emitted operator? ─
// Every case inserts one matching and one non-matching row and asserts only the
// match is delivered through the filtered subscription. Membership checks (not
// exact arrays) keep the assertions robust against seed rows a filter may also
// select (e.g. lt over ids includes Alice/Bob).
const COMPARISONS = [
  { op: 'gt', pivot: 100, match: 101, miss: 99 },
  { op: 'gte', pivot: 100, match: 100, miss: 99 },
  { op: 'lt', pivot: 500, match: 400, miss: 600 },
  { op: 'lte', pivot: 400, match: 400, miss: 600 },
] as const

for (const c of COMPARISONS) {
  test(`realtime filter ${c.op} is accepted and evaluated by the server`, async ({
    other,
  }) => {
    const ctx = makeFilteredRealtimeUsers()
    const live = createLiveQueryCollection((q) =>
      q
        .from({ row: ctx.collection })
        .where(({ row }) => {
          switch (c.op) {
            case 'gt':
              return gt(row.id, c.pivot)
            case 'gte':
              return gte(row.id, c.pivot)
            case 'lt':
              return lt(row.id, c.pivot)
            default:
              return lte(row.id, c.pivot)
          }
        })
        .select(({ row }) => ({ id: row.id })),
    )
    const cleanup = await startFilteredRealtime(ctx, live)
    try {
      const { error } = await other
        .from('users')
        .insert([userRow(c.match), userRow(c.miss)] as unknown as never)
      expect(error).toBeNull()

      await vi.waitFor(
        () => expect(live.toArray.some((row) => row.id === c.match)).toBe(true),
        WAIT,
      )
      expect(live.toArray.some((row) => row.id === c.miss)).toBe(false)
      // Under a correct server-side filter the excluded row is never delivered,
      // so it must not reach the BASE collection either. A silent fallback to a
      // catch-all subscription would sync it here, which the live query's own
      // client-side re-filtering would otherwise hide.
      expect(ctx.collection.toArray.some((row) => row.id === c.miss)).toBe(
        false,
      )
    } finally {
      await cleanup()
    }
  })
}

test('realtime filter neq (boolean) delivers only non-matching-value rows', async ({
  other,
}) => {
  const ctx = makeFilteredRealtimeUsers()
  const live = createLiveQueryCollection((q) =>
    q
      .from({ row: ctx.collection })
      .where(({ row }) => not(eq(row.active, true)))
      .select(({ row }) => ({ id: row.id, active: row.active })),
  )
  const cleanup = await startFilteredRealtime(ctx, live)
  try {
    const { error } = await other
      .from('users')
      .insert([
        userRow(300, { active: false }),
        userRow(301, { active: true }),
      ] as unknown as never)
    expect(error).toBeNull()

    await vi.waitFor(
      () => expect(live.toArray.some((row) => row.id === 300)).toBe(true),
      WAIT,
    )
    expect(live.toArray.some((row) => row.id === 301)).toBe(false)
    // A silent fallback to catch-all would sync the excluded row into the base.
    expect(ctx.collection.toArray.some((row) => row.id === 301)).toBe(false)
  } finally {
    await cleanup()
  }
})

test('realtime filter not.gt (negated comparison) is accepted server-side', async ({
  other,
}) => {
  const ctx = makeFilteredRealtimeUsers()
  const live = createLiveQueryCollection((q) =>
    q
      .from({ row: ctx.collection })
      .where(({ row }) => not(gt(row.id, 100)))
      .select(({ row }) => ({ id: row.id })),
  )
  const cleanup = await startFilteredRealtime(ctx, live)
  try {
    const { error } = await other
      .from('users')
      .insert([userRow(99), userRow(101)] as unknown as never)
    expect(error).toBeNull()

    await vi.waitFor(
      () => expect(live.toArray.some((row) => row.id === 99)).toBe(true),
      WAIT,
    )
    expect(live.toArray.some((row) => row.id === 101)).toBe(false)
    // A silent fallback to catch-all would sync the excluded row into the base.
    expect(ctx.collection.toArray.some((row) => row.id === 101)).toBe(false)
  } finally {
    await cleanup()
  }
})

test('realtime filter in.(...) is accepted and matches list members', async ({
  other,
}) => {
  const ctx = makeFilteredRealtimeUsers()
  const live = createLiveQueryCollection((q) =>
    q
      .from({ row: ctx.collection })
      .where(({ row }) => inArray(row.id, [301, 302]))
      .select(({ row }) => ({ id: row.id })),
  )
  const cleanup = await startFilteredRealtime(ctx, live)
  try {
    const { error } = await other
      .from('users')
      .insert([userRow(301), userRow(303)] as unknown as never)
    expect(error).toBeNull()

    await vi.waitFor(
      () => expect(live.toArray.some((row) => row.id === 301)).toBe(true),
      WAIT,
    )
    expect(live.toArray.some((row) => row.id === 303)).toBe(false)
    // A silent fallback to catch-all would sync the excluded row into the base.
    expect(ctx.collection.toArray.some((row) => row.id === 303)).toBe(false)
  } finally {
    await cleanup()
  }
})

test('realtime filter not.in excludes list members', async ({ other }) => {
  const ctx = makeFilteredRealtimeUsers()
  const live = createLiveQueryCollection((q) =>
    q
      .from({ row: ctx.collection })
      .where(({ row }) => not(inArray(row.id, [301])))
      .select(({ row }) => ({ id: row.id })),
  )
  const cleanup = await startFilteredRealtime(ctx, live)
  try {
    const { error } = await other
      .from('users')
      .insert([userRow(302), userRow(301)] as unknown as never)
    expect(error).toBeNull()

    await vi.waitFor(
      () => expect(live.toArray.some((row) => row.id === 302)).toBe(true),
      WAIT,
    )
    expect(live.toArray.some((row) => row.id === 301)).toBe(false)
    // A silent fallback to catch-all would sync the excluded row into the base.
    expect(ctx.collection.toArray.some((row) => row.id === 301)).toBe(false)
  } finally {
    await cleanup()
  }
})

// The seed schema has no nullable column (name is NOT NULL), so a matching row
// for `is.null` cannot exist. We therefore only smoke-test `not.is.null`: it
// proves the server accepts the is/not.is syntax and still delivers. The
// positive `is.null` match stays unit-tested.
test('realtime filter not.is.null is accepted and delivers rows', async ({
  other,
}) => {
  const ctx = makeFilteredRealtimeUsers()
  const live = createLiveQueryCollection((q) =>
    q
      .from({ row: ctx.collection })
      .where(({ row }) => not(isNull(row.name)))
      .select(({ row }) => ({ id: row.id })),
  )
  const cleanup = await startFilteredRealtime(ctx, live)
  try {
    const { error } = await other
      .from('users')
      .insert([userRow(300)] as unknown as never)
    expect(error).toBeNull()

    await vi.waitFor(
      () => expect(live.toArray.some((row) => row.id === 300)).toBe(true),
      WAIT,
    )
  } finally {
    await cleanup()
  }
})

test('realtime filter accepts a 100-member in.(...) list', async ({
  other,
}) => {
  const ids = Array.from({ length: 100 }, (_, i) => 300 + i)
  const ctx = makeFilteredRealtimeUsers()
  const live = createLiveQueryCollection((q) =>
    q
      .from({ row: ctx.collection })
      .where(({ row }) => inArray(row.id, ids))
      .select(({ row }) => ({ id: row.id })),
  )
  const cleanup = await startFilteredRealtime(ctx, live)
  try {
    const { error } = await other
      .from('users')
      .insert([userRow(350), userRow(999)] as unknown as never)
    expect(error).toBeNull()

    await vi.waitFor(
      () => expect(live.toArray.some((row) => row.id === 350)).toBe(true),
      WAIT,
    )
    expect(live.toArray.some((row) => row.id === 999)).toBe(false)
    // A silent fallback to catch-all would sync the excluded row into the base.
    expect(ctx.collection.toArray.some((row) => row.id === 999)).toBe(false)
  } finally {
    await cleanup()
  }
})

// A composite AND becomes a single comma-joined condition list
// (`id=gt.300,id=lt.500`). Unit tests prove we format it; this proves the real
// server accepts a multi-condition filter and evaluates every condition rather
// than silently rejecting it (which would fall back to catch-all).
test('realtime filter with two AND-ed conditions is accepted and evaluated', async ({
  other,
}) => {
  const ctx = makeFilteredRealtimeUsers()
  const live = createLiveQueryCollection((q) =>
    q
      .from({ row: ctx.collection })
      .where(({ row }) => and(gt(row.id, 300), lt(row.id, 500)))
      .select(({ row }) => ({ id: row.id })),
  )
  const cleanup = await startFilteredRealtime(ctx, live)
  try {
    const { error } = await other
      .from('users')
      .insert([userRow(400), userRow(600)] as unknown as never)
    expect(error).toBeNull()

    await vi.waitFor(
      () => expect(live.toArray.some((row) => row.id === 400)).toBe(true),
      WAIT,
    )
    // 600 satisfies gt.300 but not lt.500: it must be excluded, proving the
    // server honours both conditions and did not fall back to catch-all.
    expect(live.toArray.some((row) => row.id === 600)).toBe(false)
    expect(ctx.collection.toArray.some((row) => row.id === 600)).toBe(false)
  } finally {
    await cleanup()
  }
})

// ── Filter-window UPDATE / DELETE correctness ─────────────────────────
// A row that leaves the filter window disappears from the live query (which
// re-filters client-side) but must stay fresh in the BASE collection, kept
// current by the extra unfiltered UPDATE listener. So these assert on the base
// collection, not the live query.
test('UPDATE moving a row out of the filter window keeps it fresh', async ({
  other,
}) => {
  const ctx = makeFilteredRealtimeUsers()
  const live = createLiveQueryCollection((q) =>
    q
      .from({ row: ctx.collection })
      .where(({ row }) => eq(row.active, true))
      .select(({ row }) => ({ id: row.id, active: row.active })),
  )
  const cleanup = await startFilteredRealtime(ctx, live)
  const aliceInBase = () => ctx.collection.toArray.find((r) => r.id === 1)
  try {
    // Seed: only Alice (id 1) is active, so she is synced into the base.
    await vi.waitFor(() => expect(aliceInBase()).toBeDefined(), WAIT)

    // Move Alice out of the active=true window.
    const { error } = await other
      .from('users')
      .update({ active: false } as unknown as never)
      .eq('id', 1)
    expect(error).toBeNull()

    // The unfiltered UPDATE listener still applied the change instead of
    // leaving a stale active=true row behind. Applying it is a manual write,
    // which makes query-db-collection revalidate its on-demand queries; the
    // active=true query then no longer owns Alice, so she may also be dropped
    // from the base entirely. Either outcome is fresh; only active=true is stale.
    await vi.waitFor(
      () => expect(aliceInBase()?.active ?? false).toBe(false),
      WAIT,
    )
  } finally {
    await cleanup()
  }
})

test('UPDATE moving a row into the filter window delivers it', async ({
  other,
}) => {
  const ctx = makeFilteredRealtimeUsers()
  const live = createLiveQueryCollection((q) =>
    q
      .from({ row: ctx.collection })
      .where(({ row }) => eq(row.active, true))
      .select(({ row }) => ({ id: row.id })),
  )
  const cleanup = await startFilteredRealtime(ctx, live)
  try {
    // Seed: Bob (id 2) is inactive, so he starts outside the window.
    await vi.waitFor(
      () => expect(live.toArray.some((r) => r.id === 2)).toBe(false),
      WAIT,
    )

    const { error } = await other
      .from('users')
      .update({ active: true } as unknown as never)
      .eq('id', 2)
    expect(error).toBeNull()

    // The filtered UPDATE listener upserts the row now that it matches.
    await vi.waitFor(
      () => expect(live.toArray.some((r) => r.id === 2)).toBe(true),
      WAIT,
    )
  } finally {
    await cleanup()
  }
})

test('DELETE is delivered even while a server-side filter is active', async ({
  other,
}) => {
  const ctx = makeFilteredRealtimeUsers()
  const live = createLiveQueryCollection((q) =>
    q
      .from({ row: ctx.collection })
      .where(({ row }) => eq(row.active, true))
      .select(({ row }) => ({ id: row.id })),
  )
  const cleanup = await startFilteredRealtime(ctx, live)
  const aliceInBase = () => ctx.collection.toArray.some((r) => r.id === 1)
  try {
    await vi.waitFor(() => expect(aliceInBase()).toBe(true), WAIT)

    const { error } = await other.from('users').delete().eq('id', 1)
    expect(error).toBeNull()

    // Deletes are never filtered; the unfiltered DELETE listener removes it.
    await vi.waitFor(() => expect(aliceInBase()).toBe(false), WAIT)
  } finally {
    await cleanup()
  }
})

// ── Multiple active queries & catch-all fallback ──────────────────────
test('two filtered live queries over one collection stay isolated', async ({
  other,
}) => {
  const ctx = makeFilteredRealtimeUsers()
  const liveX = createLiveQueryCollection((q) =>
    q
      .from({ row: ctx.collection })
      .where(({ row }) => eq(row.id, 301))
      .select(({ row }) => ({ id: row.id })),
  )
  const liveY = createLiveQueryCollection((q) =>
    q
      .from({ row: ctx.collection })
      .where(({ row }) => eq(row.id, 302))
      .select(({ row }) => ({ id: row.id })),
  )
  const cleanup = await startFilteredRealtime(ctx, liveX, liveY)
  try {
    const { error } = await other
      .from('users')
      .insert([userRow(301), userRow(302), userRow(303)] as unknown as never)
    expect(error).toBeNull()

    await vi.waitFor(() => {
      expect(liveX.toArray.map((r) => r.id)).toEqual([301])
      expect(liveY.toArray.map((r) => r.id)).toEqual([302])
    }, WAIT)
    // 303 matches neither filtered subscription, so it never syncs.
    expect(ctx.collection.toArray.some((r) => r.id === 303)).toBe(false)
  } finally {
    await cleanup()
  }
})

test('an unsupported WHERE falls back to catch-all but still syncs', async ({
  other,
}) => {
  const ctx = makeFilteredRealtimeUsers()
  // OR is not pushable to a Realtime filter, so realtimeFiltersToSearch yields a
  // catch-all (unfiltered) subscription; the live query re-filters client-side.
  const live = createLiveQueryCollection((q) =>
    q
      .from({ row: ctx.collection })
      .where(({ row }) => or(eq(row.name, 'Xavier'), eq(row.name, 'Yolanda')))
      .select(({ row }) => ({ id: row.id, name: row.name })),
  )
  const cleanup = await startFilteredRealtime(ctx, live)
  try {
    const { error } = await other
      .from('users')
      .insert([
        userRow(300, { name: 'Xavier' }),
        userRow(301, { name: 'Zoe' }),
      ] as unknown as never)
    expect(error).toBeNull()

    // The matching row arrives through the degraded (unfiltered) subscription
    // and passes the client-side OR filter.
    await vi.waitFor(
      () => expect(live.toArray.map((r) => r.name)).toEqual(['Xavier']),
      WAIT,
    )
  } finally {
    await cleanup()
  }
})
