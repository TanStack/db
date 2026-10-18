import { expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/query-core'
import { createCollection, createLiveQueryCollection } from '@tanstack/db'
import { queryCollectionOptions } from '../src/query'
import { withOracleCleanup } from '../../db/tests/utils'

it(`observes custom API ingestion without invoking the Query Collection fetcher`, async () => {
  const queryClient = new QueryClient()
  const queryFn = vi.fn(() => Promise.resolve([{ id: 1, title: `server` }]))
  const tasks = createCollection(
    queryCollectionOptions({
      queryClient,
      queryKey: [`tasks`],
      queryFn,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
    }),
  )
  const local = createLiveQueryCollection({
    autoLoad: false,
    query: (q) =>
      q
        .from({ task: tasks })
        .orderBy(({ task }) => task.id)
        .limit(1),
  })
  await withOracleCleanup(async () => {
    await local.preload()
    expect(local.isReady()).toBe(true)
    expect(tasks.status).toBe(`idle`)
    expect(queryFn).not.toHaveBeenCalled()
    // The application owns initialization and ingestion from its custom API.
    tasks.startSyncImmediate()
    tasks.utils.writeUpsert([{ id: 1, title: `custom API` }])
    expect([...local.values()].map((row) => row.title)).toEqual([`custom API`])
    tasks.utils.writeUpsert([{ id: 1, title: `updated` }])
    expect([...local.values()].map((row) => row.title)).toEqual([`updated`])
    expect(queryFn).not.toHaveBeenCalled()
    expect(tasks.subscriberCount).toBe(0)
  }, [() => local.cleanup(), () => tasks.cleanup(), () => queryClient.clear()])
})
