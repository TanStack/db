import { expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createTransaction } from '../src/transactions.js'
import type { SyncConfig } from '../src/types.js'

type Row = { id: number; value: number }

it(`reads the exposed authoritative base without optimistic rows`, async () => {
  let sync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
  let releaseMutation!: () => void
  const heldMutation = new Promise<void>((resolve) => {
    releaseMutation = resolve
  })
  const collection = createCollection<Row, number>({
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      rowUpdateMode: `full`,
      sync: (actions) => {
        sync = actions
        actions.begin()
        actions.write({ type: `insert`, value: { id: 1, value: 0 } })
        actions.write({ type: `insert`, value: { id: 2, value: 2 } })
        actions.commit()
        actions.markReady()
      },
    },
  })
  const transaction = createTransaction<Row>({
    autoCommit: false,
    mutationFn: () => heldMutation,
  })
  let commit: Promise<unknown> | undefined

  try {
    await collection.stateWhenReady()
    const base = collection.base
    expect(collection.base).toBe(base)
    expect([...base]).toEqual([
      [1, { id: 1, value: 0 }],
      [2, { id: 2, value: 2 }],
    ])
    expect([...base.keys()]).toEqual([1, 2])
    expect([...base.values()]).toEqual([
      { id: 1, value: 0 },
      { id: 2, value: 2 },
    ])
    expect([...base.entries()]).toEqual([...base])
    expect(base.size).toBe(2)
    expect(base.has(1)).toBe(true)
    expect(base.get(1)).toEqual({ id: 1, value: 0 })
    transaction.mutate(() => {
      collection.update(1, (draft) => {
        draft.value = 100
      })
      collection.delete(2)
      collection.insert({ id: 3, value: 3 })
    })
    commit = transaction.commit()
    await Promise.resolve()

    expect(collection.get(1)?.value).toBe(100)
    expect(collection.has(2)).toBe(false)
    expect(collection.has(3)).toBe(true)
    expect([...base]).toEqual([
      [1, { id: 1, value: 0 }],
      [2, { id: 2, value: 2 }],
    ])
    expect(base.has(2)).toBe(true)
    expect(base.has(3)).toBe(false)

    sync.begin({ immediate: true })
    sync.write({
      type: `update`,
      value: { id: 1, value: 10 },
      previousValue: { id: 1, value: 0 },
    })
    expect(sync.commit()).toBe(true)
    expect(base.get(1)).toEqual({ id: 1, value: 10 })
    expect(collection.get(1)?.value).toBe(100)

    sync.begin()
    sync.write({
      type: `update`,
      value: { id: 1, value: 20 },
      previousValue: { id: 1, value: 10 },
    })
    const queuedReceipt = sync.commit()
    expect(queuedReceipt).toBeInstanceOf(Promise)
    expect(base.get(1)).toEqual({ id: 1, value: 10 })

    releaseMutation()
    await commit
    await queuedReceipt
    expect(base.get(1)).toEqual({ id: 1, value: 20 })
  } finally {
    releaseMutation()
    await commit
    await collection.cleanup()
  }
})

it(`does not start sync when the authoritative base is read`, async () => {
  let syncStarts = 0
  const collection = createCollection<Row, number>({
    getKey: (row) => row.id,
    startSync: false,
    sync: {
      sync: (actions) => {
        syncStarts++
        actions.markReady()
      },
    },
  })

  try {
    const base = collection.base
    expect(base.size).toBe(0)
    expect(base.get(1)).toBeUndefined()
    expect([...base]).toEqual([])
    expect(syncStarts).toBe(0)

    collection.startSyncImmediate()
    expect(syncStarts).toBe(1)
    expect(collection.base).toBe(base)
  } finally {
    await collection.cleanup()
  }
})
