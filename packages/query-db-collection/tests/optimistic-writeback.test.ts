import { expect, it } from 'vitest'
import { QueryClient } from '@tanstack/query-core'
import {
  createCollection,
  createLiveQueryCollection,
  createOptimisticAction,
  createTransaction,
} from '@tanstack/db'
import { queryCollectionOptions } from '../src/query'

type Row = { id: string; text: string }

it.each([`insert`, `upsert`] as const)(
  `keeps repeated optimistic writes valid after direct %s acknowledgement`,
  async (method) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const source = createCollection(
      queryCollectionOptions({
        queryKey: [`optimistic-writeback`, method],
        queryClient,
        queryFn: async (): Promise<Array<Row>> => [],
        getKey: (row) => row.id,
      }),
    )
    const live = createLiveQueryCollection({
      query: (q) =>
        q.from({ row: source }).select(({ row }) => ({
          id: row.id,
          text: row.text,
        })),
    })
    const batches: Array<Array<string | number>> = []
    const subscription = source.subscribeChanges((changes) => {
      batches.push(changes.map((change) => change.key))
    })
    const insert = createOptimisticAction<Row>({
      onMutate: (row) => source.insert(row),
      mutationFn: async (row) => {
        await Promise.resolve()
        if (method === `insert`) source.utils.writeInsert({ ...row })
        else source.utils.writeUpsert({ ...row })
      },
    })
    const rename = createOptimisticAction<Row>({
      onMutate: (row) =>
        source.update(row.id, (draft) => {
          draft.text = row.text
        }),
      mutationFn: async (row) => {
        await Promise.resolve()
        source.utils.writeUpdate({ ...row })
      },
    })
    try {
      await live.preload()
      await insert({ id: `one`, text: `created` }).isPersisted.promise
      for (const text of [`renamed`, `renamed again`]) {
        await rename({ id: `one`, text }).isPersisted.promise
        expect([...live.values()].map((row) => row.text)).toEqual([text])
      }
      await insert({ id: `two`, text: `second` }).isPersisted.promise
      expect([...live.values()].map((row) => row.text).sort()).toEqual([
        `renamed again`,
        `second`,
      ])
      for (const keys of batches) expect(new Set(keys).size).toBe(keys.length)
    } finally {
      subscription.unsubscribe()
      await live.cleanup()
      await source.cleanup()
      queryClient.clear()
    }
  },
)

it(`keeps repeated optimistic updates valid after direct upsert acknowledgement`, async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  let position = 0
  const source = createCollection(
    queryCollectionOptions({
      queryKey: [`optimistic-upsert-rounds`],
      queryClient,
      queryFn: async () => [{ id: `one`, position }],
      getKey: (row) => row.id,
    }),
  )
  const live = createLiveQueryCollection((q) => q.from({ row: source }))
  try {
    await live.preload()
    for (const next of [1, 2, 3]) {
      const tx = createTransaction({
        mutationFn: async () => {
          position = next
          source.utils.writeUpsert({ id: `one`, position })
        },
      })
      tx.mutate(() =>
        source.update(`one`, (draft) => {
          draft.position += 1
        }),
      )
      await tx.isPersisted.promise
      expect([...live.values()].map((row) => row.position)).toEqual([next])
    }
  } finally {
    await live.cleanup()
    await source.cleanup()
    queryClient.clear()
  }
})
