import { expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { createLiveQueryCollection, eq } from '../src/query/index.js'
import { createTransaction } from '../src/transactions.js'
import { flushPromises } from './utils.js'
import type { SyncConfig } from '../src/types.js'

type Row = { id: number; value: number }
type Actions = Parameters<SyncConfig<Row, string | number>[`sync`]>[0]

it.each([0, 2])(`opens an inner-join window from limit %s`, async (limit) => {
  const makeSource = (collectionId: string) =>
    createCollection<Row>({
      id: collectionId,
      getKey: (row) => row.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (let id = 1; id <= 5; id++)
            write({ type: `insert`, value: { id, value: id } })
          commit()
          markReady()
        },
      },
    })
  const parent = makeSource(`window-parent-${limit}`)
  const child = makeSource(`window-child-${limit}`)
  const live = createLiveQueryCollection({
    query: (q) =>
      q
        .from({ a: parent })
        .join({ b: child }, ({ a, b }) => eq(a.id, b.id), `inner`)
        .orderBy(({ a }) => a.value)
        .limit(limit)
        .select(({ a }) => ({ id: a.id, value: a.value })),
  })
  try {
    await live.preload()
    expect(live.size).toBe(limit)
    await live.utils.setWindow({ limit: 10 })
    expect(live.toArray.map((row) => row.id)).toEqual([1, 2, 3, 4, 5])
  } finally {
    await live.cleanup()
    await parent.cleanup()
    await child.cleanup()
  }
})

it.each([1, 99])(
  `publishes server echo value %s after two optimistic inserts hold a sync batch`,
  async (echoValue) => {
    let sync!: Actions
    const source = createCollection<Row>({
      getKey: (row) => row.id,
      sync: {
        sync: (actions) => {
          sync = actions
          actions.markReady()
        },
      },
    })
    const observed = new Map<string | number, number>()
    const subscription = source.subscribeChanges(
      (changes) => {
        for (const change of changes) {
          if (change.type === `delete`) observed.delete(change.key)
          else observed.set(change.key, change.value.value)
        }
      },
      { includeInitialState: true },
    )
    const live = createLiveQueryCollection({ query: (q) => q.from({ source }) })
    await live.preload()
    const first = createDeferred<void>()
    const second = createDeferred<void>()
    const tx1 = createTransaction({ mutationFn: () => first.promise })
    const tx2 = createTransaction({ mutationFn: () => second.promise })
    try {
      tx1.mutate(() => source.insert({ id: 1, value: 1 }))
      tx2.mutate(() => source.insert({ id: 2, value: 2 }))
      sync.begin()
      sync.write({ type: `insert`, value: { id: 3, value: 3 } })
      const blocked = sync.commit()
      first.resolve()
      await tx1.isPersisted.promise
      sync.begin()
      sync.write({ type: `insert`, value: { id: 1, value: echoValue } })
      const echo = sync.commit()
      second.resolve()
      await tx2.isPersisted.promise
      await blocked
      await echo
      await flushPromises()
      expect(source.get(1)?.value).toBe(echoValue)
      expect(observed.get(1)).toBe(echoValue)
      expect(live.toArray.find((row) => row.id === 1)?.value).toBe(echoValue)
    } finally {
      first.resolve()
      second.resolve()
      subscription.unsubscribe()
      await live.cleanup()
      await source.cleanup()
    }
  },
)

it(`makes a graph hashing failure visible as a query error`, async () => {
  type DeepRow = { id: number; nested: object }
  let sync!: Parameters<SyncConfig<DeepRow, string | number>[`sync`]>[0]
  const source = createCollection<DeepRow>({
    getKey: (row) => row.id,
    sync: {
      sync: (actions) => {
        sync = actions
        actions.markReady()
      },
    },
  })
  const live = createLiveQueryCollection({
    query: (q) =>
      q
        .from({ source })
        .select(({ source: row }) => ({ id: row.id, nested: row.nested }))
        .distinct(),
  })
  try {
    await live.preload()
    let nested: object = {}
    for (let depth = 0; depth < 800; depth++) nested = { child: nested }
    sync.begin()
    sync.write({ type: `insert`, value: { id: 1, nested } })
    expect(() => sync.commit()).toThrow(RangeError)
    expect(source.has(1)).toBe(true)
    expect(live.status).toBe(`error`)
    sync.begin()
    sync.write({ type: `insert`, value: { id: 2, nested: {} } })
    sync.commit()
    expect(live.status).toBe(`error`)
    expect(live.size).toBe(0)
  } finally {
    await live.cleanup()
    await source.cleanup()
  }
})
