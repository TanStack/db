import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/index'
import { localOnlyCollectionOptions } from '../src/local-only'
import { createTransaction } from '../src/transactions'
import { createDeferred } from '../src/deferred'

/**
 * # When does a local-only direct write skip the optimistic stage?
 *
 * Law: a local-only Collection confirms its own writes. A direct `insert`,
 * `update`, or `delete` for an operation type without a user handler, with no
 * other transaction on the Collection pending or persisting, publishes the
 * synced row once and returns a completed transaction. Otherwise the write
 * keeps the optimistic path and its visibility: it overlays a pending
 * transaction, is visible while another persists, joins an ambient
 * transaction, and runs the user's handler.
 *
 * The change-event history oracle drives this path through generated
 * histories and checks every publication. These witnesses pin the guard's
 * fallback cases, which that oracle does not generate: removing the guard
 * hides a direct update under a pending overlay and holds it behind a
 * persisting transaction.
 */
type Row = { id: number; value: string }

function createOrders(
  handlers: Partial<{ onUpdate: () => Promise<void> }> = {},
) {
  return createCollection(
    localOnlyCollectionOptions<Row, number>({
      id: `local-only-direct-${Math.random()}`,
      getKey: (row) => row.id,
      initialData: [{ id: 1, value: `a` }],
      ...handlers,
    }),
  )
}

describe(`local-only direct writes`, () => {
  it(`publishes each direct write once and returns a completed transaction`, async () => {
    const orders = createOrders()
    const batches: Array<Array<string>> = []
    orders.subscribeChanges(
      (changes) =>
        batches.push(changes.map((change) => `${change.type}:${change.key}`)),
      { includeInitialState: true },
    )

    const inserted = orders.insert({ id: 2, value: `b` })
    const updated = orders.update(1, (draft) => {
      draft.value = `c`
    })
    const deleted = orders.delete(2)

    for (const transaction of [inserted, updated, deleted]) {
      expect(transaction.state).toBe(`completed`)
      await expect(transaction.isPersisted.promise).resolves.toBe(transaction)
    }
    expect(batches).toEqual([
      [`insert:1`],
      [`insert:2`],
      [`update:1`],
      [`delete:2`],
    ])
    expect(orders.get(1)).toMatchObject({
      value: `c`,
      $synced: true,
      $origin: `local`,
    })
    expect(orders.has(2)).toBe(false)
  })

  it(`overlays a pending transaction instead of writing beneath it`, () => {
    const orders = createOrders()
    const pending = createTransaction({
      autoCommit: false,
      mutationFn: () => Promise.resolve(),
    })
    pending.mutate(() =>
      orders.update(1, (draft) => {
        draft.value = `pending`
      }),
    )

    const direct = orders.update(1, (draft) => {
      draft.value = `direct`
    })

    expect(direct.state).not.toBe(`completed`)
    expect(orders.get(1)?.value).toBe(`direct`)
    pending.rollback()
  })

  it(`stays visible while another transaction persists`, async () => {
    const orders = createOrders()
    const release = createDeferred<void>()
    const persisting = createTransaction({
      mutationFn: () => release.promise,
    })
    persisting.mutate(() => orders.insert({ id: 3, value: `persisting` }))
    expect(persisting.state).toBe(`persisting`)

    orders.update(1, (draft) => {
      draft.value = `direct`
    })

    expect(orders.get(1)?.value).toBe(`direct`)
    release.resolve()
    await persisting.isPersisted.promise
  })

  it(`joins an ambient transaction`, () => {
    const orders = createOrders()
    const ambient = createTransaction({
      autoCommit: false,
      mutationFn: () => Promise.resolve(),
    })
    ambient.mutate(() =>
      orders.update(1, (draft) => {
        draft.value = `ambient`
      }),
    )

    expect(ambient.state).toBe(`pending`)
    expect(ambient.mutations).toHaveLength(1)
    expect(orders.get(1)?.value).toBe(`ambient`)
    ambient.rollback()
    expect(orders.get(1)?.value).toBe(`a`)
  })

  it(`runs the user's handler for that operation type`, async () => {
    let calls = 0
    const orders = createOrders({
      onUpdate: () => {
        calls++
        return Promise.resolve()
      },
    })

    const transaction = orders.update(1, (draft) => {
      draft.value = `handled`
    })

    expect(transaction.state).not.toBe(`completed`)
    await transaction.isPersisted.promise
    expect(calls).toBe(1)
    expect(orders.get(1)?.value).toBe(`handled`)
    // Inserts have no handler, so they still take the direct path.
    expect(orders.insert({ id: 4, value: `d` }).state).toBe(`completed`)
  })
})
