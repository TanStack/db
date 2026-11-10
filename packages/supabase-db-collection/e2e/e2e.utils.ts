/* eslint-disable no-empty-pattern -- vitest fixtures without dependencies must destructure an empty context object */
import { createClient } from '@supabase/supabase-js'
import { createCollection, createLiveQueryCollection } from '@tanstack/db'
import { QueryClient } from '@tanstack/query-core'
import { test as baseTest, expect, inject, vi } from 'vitest'
import { supabaseCollectionOptions } from '../src/index'
import { realtimeChannelTopicPrefix } from '../src/realtime'
import { usersSchema } from '../tests/test.utils'
import { makeAdminClient, resetE2e } from './setup'
import type { SupabaseClient } from '@supabase/supabase-js'

// Shared polling window for awaiting async PostgREST/realtime propagation.
export const WAIT = { timeout: 15_000, interval: 200 } as const

// A fresh Supabase client using the anon key, exactly like a browser would.
const makeSupabase = (): SupabaseClient =>
  createClient(inject('supabaseUrl'), inject('supabaseAnonKey'))

// Each collection gets its own QueryClient: the realtime channel registry in
// src/db.ts is keyed by QueryClient, so a fresh one per collection prevents
// channels leaking across tests.
export const makeUsersCollection = ({
  realtime = false,
  realtimeUseFilter = false,
} = {}) => {
  const supabase = makeSupabase()
  const collection = createCollection(
    supabaseCollectionOptions({
      tableName: 'users',
      keys: ['id'],
      schema: usersSchema,
      supabase,
      queryClient: new QueryClient(),
      realtime,
      realtimeUseFilter,
    }),
  )
  return { collection, supabase }
}

// A realtime collection that pushes each live query's WHERE down to the
// server-side postgres_changes filter (see realtimeUseFilter in src/db.ts).
export const makeFilteredRealtimeUsers = () =>
  makeUsersCollection({ realtime: true, realtimeUseFilter: true })

type UsersContext = ReturnType<typeof makeUsersCollection>
type UsersCollection = UsersContext['collection']

// An on-demand collection only loads when a live query drives demand. This live
// query also creates the active query that the realtime channel attaches to.
const liveUsers = (base: UsersCollection) =>
  createLiveQueryCollection((q) =>
    q.from({ row: base }).select(({ row }) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      active: row.active,
    })),
  )

type LiveUsersCollection = ReturnType<typeof liveUsers>

// Waits until one of the adapter's realtime channels for the table is actually
// joined, so changes written afterwards are guaranteed to be captured. The
// adapter numbers its channel topics (see realtimeChannelTopicPrefix in
// src/db.ts), and supabase-js exposes them under its own "realtime:" prefix.
export const waitForChannel = (supabase: SupabaseClient, table: string) =>
  vi.waitFor(() => {
    const prefix = `realtime:${realtimeChannelTopicPrefix(table)}`
    const joined = supabase
      .getChannels()
      .some((c) => c.topic.startsWith(prefix) && c.state === 'joined')
    expect(joined).toBe(true)
  }, WAIT)

// A live query and its base collection both expose these; the helper below only
// needs to drive their lifecycle, not their query shape.
type Preloadable = {
  preload: () => Promise<unknown>
  cleanup: () => Promise<unknown>
}

// Preloads one or more filtered realtime live queries over a shared collection
// and blocks until the channel has actually joined — which only happens once the
// server accepted the filters these queries emit, so it doubles as proof the
// emitted filter syntax is valid. Returns a cleanup to await in the test's
// `finally`, tearing down the live queries, the base collection, and the
// client's channels.
export const startFilteredRealtime = async (
  ctx: UsersContext,
  ...lives: Array<Preloadable>
) => {
  await Promise.all(lives.map((live) => live.preload()))
  await waitForChannel(ctx.supabase, 'users')
  return async () => {
    await Promise.all(lives.map((live) => live.cleanup()))
    await ctx.collection.cleanup()
    await ctx.supabase.removeAllChannels()
  }
}

const preloadSeeded = async (live: LiveUsersCollection) => {
  await live.preload()
  // The reset_e2e() seed always yields exactly Alice and Bob.
  await vi.waitFor(() => expect(live.size).toBe(2), WAIT)
}

// Fixtures are lazy: a test only pays for what it destructures. Teardown runs
// in reverse initialization order and ALWAYS runs, even when the test fails —
// unlike trailing cleanup calls in a test body.
export const test = baseTest.extend<{
  /** Base users collection + its anon client. */
  users: UsersContext
  /** Preloaded live query over `users`, seeded rows awaited. */
  usersLive: LiveUsersCollection
  /** Like `users` but with realtime enabled. */
  rtUsers: UsersContext
  /** Preloaded live query over `rtUsers`, realtime channel joined. */
  rtUsersLive: LiveUsersCollection
  /** A second anon client acting as "another user" for realtime writes. */
  other: SupabaseClient
  /** Resets the users tables to the Alice/Bob fixture before every test. */
  resetDatabase: void
}>({
  resetDatabase: [
    async ({}, use) => {
      await resetE2e(makeAdminClient())
      await use()
    },
    { auto: true },
  ],
  users: async ({}, use) => {
    const ctx = makeUsersCollection()
    await use(ctx)
    await ctx.collection.cleanup()
    await ctx.supabase.removeAllChannels()
  },
  usersLive: async ({ users }, use) => {
    const live = liveUsers(users.collection)
    await preloadSeeded(live)
    await use(live)
    await live.cleanup()
  },
  rtUsers: async ({}, use) => {
    const ctx = makeUsersCollection({ realtime: true })
    await use(ctx)
    await ctx.collection.cleanup()
    await ctx.supabase.removeAllChannels()
  },
  rtUsersLive: async ({ rtUsers }, use) => {
    const live = liveUsers(rtUsers.collection)
    await preloadSeeded(live)
    // Wait until the realtime channel is joined before the test writes,
    // otherwise a change could be published before the subscription exists.
    await waitForChannel(rtUsers.supabase, 'users')
    await use(live)
    await live.cleanup()
  },
  other: async ({}, use) => {
    const client = makeSupabase()
    await use(client)
    await client.removeAllChannels()
  },
})
