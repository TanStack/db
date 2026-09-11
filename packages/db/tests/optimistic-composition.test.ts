import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createCollection } from '../src/collection/index.js'
import { createTransaction } from '../src/transactions'
import { mockSyncCollectionOptions, stripVirtualProps } from './utils'

type Row = { id: number; a: string; b: string; c: string }

const inFlight = () => new Promise<void>(() => {})

function createRowCollection() {
  return createCollection(
    mockSyncCollectionOptions<Row>({
      id: `optimistic-composition`,
      getKey: (row) => row.id,
      initialData: [{ id: 1, a: `a0`, b: `b0`, c: `c0` }],
    }),
  )
}

function inFlightTransaction() {
  const transaction = createTransaction({
    mutationFn: inFlight,
    autoCommit: false,
  })
  transaction.isPersisted.promise.catch(() => {})
  return transaction
}

describe(`optimistic overlay composition`, () => {
  it(`keeps a field owned by a transaction that mutated after a later-sorting one`, () => {
    const collection = createRowCollection()
    const t1 = inFlightTransaction()
    const t2 = inFlightTransaction()

    t2.mutate(() =>
      collection.update(1, (draft) => {
        draft.b = `b2`
      }),
    )
    t1.mutate(() =>
      collection.update(1, (draft) => {
        draft.a = `a1`
      }),
    )
    t1.commit()
    t2.commit()

    expect(stripVirtualProps(collection.get(1))).toEqual({
      id: 1,
      a: `a1`,
      b: `b2`,
      c: `c0`,
    })
  })

  it(`keeps a settled transaction's field when an unrelated key syncs`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `optimistic-composition-unrelated-sync`,
        getKey: (row) => row.id,
        initialData: [
          { id: 1, a: `a0`, b: `b0`, c: `c0` },
          { id: 2, a: `x`, b: `y`, c: `z` },
        ],
      }),
    )

    const pending = inFlightTransaction()
    pending.mutate(() =>
      collection.update(1, (draft) => {
        draft.a = `a1`
      }),
    )
    pending.commit()

    const settled = collection.update(1, (draft) => {
      draft.b = `b2`
    })
    collection.utils.resolveSync()
    await settled.isPersisted.promise

    collection.utils.begin()
    collection.utils.write({
      type: `update`,
      value: { id: 2, a: `x2`, b: `y`, c: `z` },
    })
    collection.utils.commit()

    expect(stripVirtualProps(collection.get(1))).toEqual({
      id: 1,
      a: `a1`,
      b: `b2`,
      c: `c0`,
    })
  })

  it(`rolling back one transaction only reverts its own field`, () => {
    const collection = createRowCollection()
    const t1 = inFlightTransaction()
    const t2 = inFlightTransaction()
    const t3 = inFlightTransaction()

    t1.mutate(() =>
      collection.update(1, (draft) => {
        draft.a = `a1`
      }),
    )
    t2.mutate(() =>
      collection.update(1, (draft) => {
        draft.b = `b2`
      }),
    )
    t3.mutate(() =>
      collection.update(1, (draft) => {
        draft.c = `c3`
      }),
    )
    t1.commit()
    t2.commit()
    t3.commit()

    t2.rollback()

    expect(stripVirtualProps(collection.get(1))).toEqual({
      id: 1,
      a: `a1`,
      b: `b0`,
      c: `c3`,
    })
  })

  it(`surfaces a synced update to a field no uncommitted mutation touched`, () => {
    const collection = createRowCollection()
    const transaction = inFlightTransaction()

    transaction.mutate(() =>
      collection.update(1, (draft) => {
        draft.a = `a1`
      }),
    )

    collection.utils.begin()
    collection.utils.write({
      type: `update`,
      value: { id: 1, a: `a0`, b: `remote`, c: `c0` },
    })
    collection.utils.commit()

    expect(stripVirtualProps(collection.get(1))).toEqual({
      id: 1,
      a: `a1`,
      b: `remote`,
      c: `c0`,
    })
  })

  it(`preserves schema defaults from an optimistic insert when a later transaction updates the row`, () => {
    const schema = z.object({
      id: z.number(),
      title: z.string(),
      completed: z.boolean().default(false),
      priority: z.number().default(3),
    })

    const collection = createCollection({
      id: `optimistic-composition-defaults`,
      getKey: (row) => row.id,
      sync: {
        sync: ({ begin, commit }) => {
          begin()
          commit()
        },
      },
      schema,
    })

    const insertTransaction = inFlightTransaction()
    insertTransaction.mutate(() => collection.insert({ id: 1, title: `first` }))
    insertTransaction.commit()

    const updateTransaction = inFlightTransaction()
    updateTransaction.mutate(() =>
      collection.update(1, (draft) => {
        draft.title = `second`
      }),
    )
    updateTransaction.commit()

    expect(stripVirtualProps(collection.get(1))).toEqual({
      id: 1,
      title: `second`,
      completed: false,
      priority: 3,
    })
  })

  it(`does not emit redundant update events when recomputing an unchanged overlay`, () => {
    const collection = createRowCollection()
    const transaction = inFlightTransaction()

    transaction.mutate(() =>
      collection.update(1, (draft) => {
        draft.a = `a1`
      }),
    )
    transaction.commit()

    const seen: Array<unknown> = []
    collection.subscribeChanges((changes) => {
      for (const change of changes) {
        if (change.key === 1) {
          seen.push(change)
        }
      }
    })

    const unrelated = inFlightTransaction()
    unrelated.mutate(() => collection.insert({ id: 2, a: `x`, b: `y`, c: `z` }))
    unrelated.commit()

    expect(seen).toEqual([])
  })
})
