import { expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index'
import { localStorageCollectionOptions } from '../src/local-storage'
import { createTransaction } from '../src/transactions'

type Row = { id: string; value: number }

const cases = ([`insert`, `update`, `delete`] as const).flatMap((operation) =>
  ([`storage`, `serialization`] as const).flatMap((failure) =>
    [false, true].map((manual) => ({ operation, failure, manual })),
  ),
)

it.each(cases)(
  `does not persist a rejected mutation on the next successful write: %j`,
  async ({ operation, failure, manual }) => {
    const data = new Map<string, string>()
    const error = new Error(`Persistence failed`)
    let fail = false
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      removeItem: (key: string) => {
        data.delete(key)
      },
      setItem: (key: string, value: string) => {
        if (fail && failure === `storage`) throw error
        data.set(key, value)
      },
    }
    const makeCollection = () =>
      createCollection(
        localStorageCollectionOptions<Row>({
          storageKey: `rows`,
          storage,
          storageEventApi: { addEventListener() {}, removeEventListener() {} },
          getKey: (row) => row.id,
          parser: {
            parse: JSON.parse,
            stringify: (value: unknown) => {
              // Per-row validation succeeds; serializing the full stored map fails.
              if (
                fail &&
                failure === `serialization` &&
                typeof value === `object` &&
                value !== null &&
                !(`id` in value)
              ) {
                throw error
              }
              return JSON.stringify(value)
            },
          },
        }),
      )
    const collection = makeCollection()
    const log = vi.spyOn(console, `error`).mockImplementation(() => {})
    try {
      await collection.preload()
      await collection.insert({ id: `seed`, value: 1 }).isPersisted.promise
      const mutate = () => {
        if (operation === `insert`)
          return collection.insert({ id: `bad`, value: 2 })
        if (operation === `delete`) return collection.delete(`seed`)
        return collection.update(`seed`, (draft) => {
          draft.value = 2
        })
      }
      fail = true
      const failed = manual
        ? createTransaction({
            autoCommit: false,
            mutationFn: ({ transaction }) => {
              collection.utils.acceptMutations(transaction)
              return Promise.resolve()
            },
          })
        : mutate()
      const rejection = expect(failed.isPersisted.promise).rejects.toBe(error)
      if (manual) {
        failed.mutate(mutate)
        await failed.commit().catch(() => {})
      }
      await rejection
      fail = false
      await collection.insert({ id: `good`, value: 3 }).isPersisted.promise
      const restored = makeCollection()
      try {
        await restored.preload()
        expect(
          [...restored.values()]
            .map(({ id, value }) => ({ id, value }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        ).toEqual([
          { id: `good`, value: 3 },
          { id: `seed`, value: 1 },
        ])
      } finally {
        await restored.cleanup()
      }
    } finally {
      fail = false
      await collection.cleanup()
      log.mockRestore()
    }
  },
)
