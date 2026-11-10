import { createClient } from '@supabase/supabase-js'
import { DbClient, collectionOptions } from '@tanstack/db'
import { QueryClient } from '@tanstack/query-core'
import { afterEach, describe, expect, test } from 'vitest'
import { supabaseCollectionOptions } from '../src/index'
import {
  SUPABASE_KEY,
  SUPABASE_URL,
  createMockFetch,
  usersSchema,
} from './test.utils'

// A collection descriptor is materialized once per DbClient. Like the query
// collection it builds on, a Supabase collection reads through the client's
// `queryClient` dependency, so each client's queries live in that client's
// cache rather than in the default QueryClient.

describe(`DbClient materialization`, () => {
  const cleanups: Array<() => Promise<void>> = []

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
  })

  const createDbClient = () => {
    const queryClient = new QueryClient()
    const client = new DbClient({ queryClient })
    cleanups.push(async () => {
      await client.cleanup()
      queryClient.clear()
    })
    return { client, queryClient }
  }

  test(`each DbClient reads through its own queryClient`, async () => {
    const descriptor = collectionOptions(
      supabaseCollectionOptions({
        tableName: `users`,
        keys: [`id`],
        schema: usersSchema,
        syncMode: `eager`,
        supabase: createClient(SUPABASE_URL, SUPABASE_KEY, {
          global: { fetch: createMockFetch() },
        }),
      }),
    )

    for (const { client, queryClient } of [
      createDbClient(),
      createDbClient(),
    ]) {
      const collection = client.collection(descriptor)
      await collection.preload()

      expect(collection.size).toBe(1)
      expect(
        queryClient.getQueryCache().findAll({ queryKey: [`users`] }),
      ).not.toHaveLength(0)
    }
  })
})
