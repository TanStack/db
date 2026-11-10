/**
 * Supabase Collection E2E Tests
 *
 * End-to-end tests against a local Supabase stack (PostgREST + Realtime), using
 * the shared test suites from @tanstack/db-collection-e2e. The stack is booted
 * by ./global-setup.ts and its schema lives in supabase/migrations.
 */

import { afterEach, beforeEach, describe, expect, inject } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { createCollection } from '@tanstack/db'
import { QueryClient } from '@tanstack/query-core'
import { z } from 'zod'
import {
  captureSeedData,
  createCollationTestSuite,
  createDeduplicationTestSuite,
  createJoinsTestSuite,
  createLiveUpdatesTestSuite,
  createMutationsTestSuite,
  createPaginationTestSuite,
  createPredicatesTestSuite,
  generateSeedData,
} from '@tanstack/db-collection-e2e'
import { supabaseCollectionOptions } from '../src/index'
import { makeAdminClient } from './setup'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Collection } from '@tanstack/db'
import type {
  Comment,
  E2ETestConfig,
  Post,
  SeedDataResult,
  User,
} from '@tanstack/db-collection-e2e'

/**
 * Rows as PostgREST and Realtime deliver them: JSON, so timestamps are strings
 * and bigints are numbers. The collections convert them into the `User`,
 * `Post` and `Comment` types with `parse`, and back with `serialize`.
 */
const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  age: z.number(),
  isActive: z.boolean(),
  createdAt: z.date(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  deletedAt: z.date().nullable(),
})

const postSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string(),
  content: z.string().nullable(),
  viewCount: z.number(),
  largeViewCount: z.bigint(),
  publishedAt: z.date().nullable(),
  deletedAt: z.date().nullable(),
})

const commentSchema = z.object({
  id: z.string(),
  postId: z.string(),
  userId: z.string(),
  text: z.string(),
  createdAt: z.date(),
  deletedAt: z.date().nullable(),
})

const parseDate = (value: unknown) => new Date(value as string)
const dateToJson = (value: Date) => value.toISOString()

const dateColumns = {
  parse: parseDate,
  serialize: dateToJson,
}

const syncModes = [
  { syncMode: 'eager', suffix: 'eager' },
  { syncMode: 'on-demand', suffix: 'ondemand' },
] as const

type SyncMode = (typeof syncModes)[number]['syncMode']

function createCollectionsForSyncMode(
  supabase: SupabaseClient,
  syncMode: SyncMode,
  own: (collection: { cleanup: () => Promise<void> }) => void,
) {
  // A QueryClient per collection: the realtime channel registry is keyed by
  // QueryClient, so sharing one would make the collections share a channel.
  const users = createCollection(
    supabaseCollectionOptions({
      tableName: 'e2e_users',
      keys: ['id'],
      schema: userSchema,
      supabase,
      queryClient: new QueryClient(),
      realtime: true,
      syncMode,
      parse: {
        createdAt: dateColumns.parse,
        deletedAt: dateColumns.parse,
      },
      serialize: {
        createdAt: dateColumns.serialize,
        deletedAt: dateColumns.serialize,
      },
    }),
  )
  own(users)

  const posts = createCollection(
    supabaseCollectionOptions({
      tableName: 'e2e_posts',
      keys: ['id'],
      schema: postSchema,
      supabase,
      queryClient: new QueryClient(),
      realtime: true,
      syncMode,
      parse: {
        // The column is text, so PostgREST sends every digit of the value.
        largeViewCount: (value) => BigInt(value as string),
        publishedAt: dateColumns.parse,
        deletedAt: dateColumns.parse,
      },
      serialize: {
        // The column is text (see the migration), so the exact digits are sent.
        largeViewCount: (value) => value.toString(),
        publishedAt: dateColumns.serialize,
        deletedAt: dateColumns.serialize,
      },
    }),
  )
  own(posts)

  const comments = createCollection(
    supabaseCollectionOptions({
      tableName: 'e2e_comments',
      keys: ['id'],
      schema: commentSchema,
      supabase,
      queryClient: new QueryClient(),
      realtime: true,
      syncMode,
      parse: {
        createdAt: dateColumns.parse,
        deletedAt: dateColumns.parse,
      },
      serialize: {
        createdAt: dateColumns.serialize,
        deletedAt: dateColumns.serialize,
      },
    }),
  )
  own(comments)

  return {
    users: users as unknown as Collection<User>,
    posts: posts as unknown as Collection<Post>,
    comments: comments as unknown as Collection<Comment>,
  }
}

/** Wire format of the seed rows, as sent to PostgREST. */
function toRows(seedData: SeedDataResult) {
  const toIso = (date: Date | null) => (date ? date.toISOString() : null)
  return {
    users: seedData.users.map((user) => ({
      ...user,
      createdAt: toIso(user.createdAt),
      deletedAt: toIso(user.deletedAt),
    })),
    posts: seedData.posts.map((post) => ({
      ...post,
      largeViewCount: post.largeViewCount.toString(),
      publishedAt: toIso(post.publishedAt),
      deletedAt: toIso(post.deletedAt),
    })),
    comments: seedData.comments.map((comment) => ({
      ...comment,
      createdAt: toIso(comment.createdAt),
      deletedAt: toIso(comment.deletedAt),
    })),
  }
}

async function seedDatabase(admin: SupabaseClient, seedData: SeedDataResult) {
  // Wipe all pre-existing data, e.g. when reusing a stack from a previous run.
  const reset = await admin.rpc('reset_e2e_shared')
  if (reset.error) {
    throw new Error(`e2e reset failed: ${reset.error.message}`)
  }

  const rows = toRows(seedData)
  const results = [
    await admin.from('e2e_users').insert(rows.users),
    await admin.from('e2e_posts').insert(rows.posts),
    await admin.from('e2e_comments').insert(rows.comments),
  ]
  const errors = results.flatMap(({ error }) => (error ? [error] : []))
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Supabase fixture insertions failed')
  }
}

/**
 * Shared-suite cases that cannot pass against the local Supabase stack, by test
 * name, with the reason. The suites cannot be edited to accommodate Supabase,
 * so each case is skipped here and reported as skipped.
 */
const unsupportedCases = new Map<string, string>([
  [
    'should maintain query state during data changes',
    // Verified: the same steps pass when the live query under test is held by a
    // subscriber, so the collection itself keeps up with the changes.
    'Realtime delivers a change about 500ms after it is committed. This case ' +
      'inserts eleven rows one by one, waiting for each to be delivered, which ' +
      'takes longer than the five seconds a live query without subscribers ' +
      'survives, so the live query under test is garbage collected mid-test.',
  ],
])

describe('Supabase Collection E2E Tests', async () => {
  beforeEach(({ task, skip }) => {
    const reason = unsupportedCases.get(task.name)
    if (reason) skip(reason)
  })

  // The collections under test read and write with the anon key, like a
  // browser would. Writes that stand in for "another client" use their own
  // client so the collections only learn about them through Realtime.
  const makeAnonClient = () =>
    createClient(inject('supabaseUrl'), inject('supabaseAnonKey'))
  const other = makeAnonClient()

  const cleanups: Array<() => Promise<void>> = []
  const own = (collection: { cleanup: () => Promise<void> }) => {
    cleanups.push(() => collection.cleanup())
  }
  afterEach(async () => {
    const errors: Array<unknown> = []
    for (const cleanup of cleanups.splice(0).reverse()) {
      try {
        await cleanup()
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1)
      throw new AggregateError(errors, 'Supabase collection cleanup failed')
  })

  const seedData = generateSeedData()
  const fixture = captureSeedData(seedData, {
    registration: 'packages/supabase-db-collection/e2e/supabase.e2e.test.ts',
    provider: 'Supabase local stack (PostgREST + Realtime)',
  })
  await seedDatabase(makeAdminClient(), seedData)

  async function getConfig(): Promise<E2ETestConfig> {
    const supabase = makeAnonClient()
    cleanups.push(async () => {
      await supabase.removeAllChannels()
    })

    const [eager, onDemand] = syncModes.map(({ syncMode }) =>
      createCollectionsForSyncMode(supabase, syncMode, own),
    ) as [
      ReturnType<typeof createCollectionsForSyncMode>,
      ReturnType<typeof createCollectionsForSyncMode>,
    ]

    // Hold a subscriber on every collection for the length of the test, like a
    // mounted component would. Without one, a collection that has lost all its
    // subscribers is idle: its query observers are removed and the adapter
    // closes the Realtime channel (there is nothing left to deliver changes to).
    // Live queries the suites start are garbage collected five seconds after
    // their last subscriber, which would otherwise silence a long-running test.
    const subscribable: Array<
      Pick<Collection<User | Post | Comment>, `subscribeChanges`>
    > = [...Object.values(eager), ...Object.values(onDemand)]
    for (const collection of subscribable) {
      const subscription = collection.subscribeChanges(() => {})
      cleanups.push(() => Promise.resolve(subscription.unsubscribe()))
    }

    // On-demand collections are marked ready immediately.
    await Promise.all([
      onDemand.users.preload(),
      onDemand.posts.preload(),
      onDemand.comments.preload(),
    ])

    // Eager collections fetch the whole table before they are ready.
    await Promise.all([
      eager.users.preload(),
      eager.posts.preload(),
      eager.comments.preload(),
    ])
    expect(eager.users.size).toEqual(seedData.users.length)
    expect(eager.posts.size).toEqual(seedData.posts.length)
    expect(eager.comments.size).toEqual(seedData.comments.length)

    return {
      fixture,
      collections: { eager, onDemand },
      // Changes made through `mutations` reach the collections via Realtime.
      hasReplicationLag: true,
      // `progressive` is Electric-only, so it is not configured.
      mutations: {
        insertUser: async (user) => {
          const { error } = await other
            .from('e2e_users')
            .insert(toRows({ ...seedData, users: [user] }).users)
          if (error) throw error
        },
        updateUser: async (id, updates) => {
          // Only the columns being changed: a partial update must not touch the rest.
          const changes = Object.fromEntries(
            Object.entries(updates).map(([column, value]) => [
              column,
              value instanceof Date ? value.toISOString() : value,
            ]),
          )
          const { error } = await other
            .from('e2e_users')
            .update(changes)
            .eq('id', id)
          if (error) throw error
        },
        deleteUser: async (id) => {
          const { error } = await other.from('e2e_users').delete().eq('id', id)
          if (error) throw error
        },
        insertPost: async (post) => {
          const { error } = await other
            .from('e2e_posts')
            .insert(toRows({ ...seedData, posts: [post] }).posts)
          if (error) throw error
        },
        deletePost: async (id) => {
          const { error } = await other.from('e2e_posts').delete().eq('id', id)
          if (error) throw error
        },
      },
      setup: async () => {},
      teardown: async () => {},
    }
  }

  // Run all shared test suites. Progressive and Moves are Electric-specific
  // (they rely on Electric's snapshot/swap transition and move-out semantics).
  createPredicatesTestSuite(getConfig)
  createPaginationTestSuite(getConfig)
  createJoinsTestSuite(getConfig)
  createDeduplicationTestSuite(getConfig)
  createCollationTestSuite(getConfig)
  createMutationsTestSuite(getConfig)
  createLiveUpdatesTestSuite(getConfig)
})
