import { expect, it } from 'vitest'
import { QueryClient } from '@tanstack/query-core'
import { createCollection } from '@tanstack/db'
import { queryCollectionOptions } from '../src/query.js'

it('rejects obsolete observer data before rows or initial readiness publish', async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  let permit = new AbortController()
  const obsolete = permit
  let release!: (rows: Array<{ id: number; value: number }>) => void
  const result = new Promise<Array<{ id: number; value: number }>>(
    (resolve) => {
      release = resolve
    },
  )
  let first = true
  const collection = createCollection(
    queryCollectionOptions({
      id: 'authority-permit',
      queryKey: ['authority-permit'],
      queryClient,
      queryFn: async () => (first ? result : [{ id: 1, value: 2 }]),
      getKey: (row: { id: number; value: number }) => row.id,
      // Retained-cache success notifications must keep the old data's permit.
      getSyncSignal: (rows) =>
        rows[0]?.value === 1 ? obsolete.signal : permit.signal,
    }),
  )
  const loading = collection.preload()
  const seen: number[] = []
  const subscription = collection.subscribeChanges((changes) =>
    seen.push(...changes.map((change) => change.value.value)),
  )
  try {
    permit.abort()
    release([{ id: 1, value: 1 }])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(collection.status).not.toBe('ready')
    expect(collection.has(1)).toBe(false)
    expect(seen).toEqual([])
    // The Query cache remains a separate boundary; its owner must invalidate it.
    first = false
    queryClient.removeQueries({ queryKey: ['authority-permit'], exact: true })
    permit = new AbortController()
    await collection.utils.refetch({ throwOnError: true })
    await loading
    expect(collection.get(1)?.value).toBe(2)
    expect(seen).toEqual([2])
  } finally {
    subscription.unsubscribe()
    await collection.cleanup()
    queryClient.clear()
  }
})
