import { describe, expect, it } from 'vitest'
import { z } from 'zod'
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
 * hides a direct write under a pending overlay and holds it behind a
 * persisting transaction, for every operation type.
 *
 * A local-only Collection whose handlers all resolve is the reference for
 * the direct path: it confirms the same writes through the optimistic stage.
 * Both must leave the same rows, publish the same batches (order within a
 * batch aside), throw the same error for a rejected write without publishing
 * it, and end with completed transactions and none left on the Collection.
 */
type Row = { id: number; value: string }

type Handlers = Partial<
  Record<`onInsert` | `onUpdate` | `onDelete`, () => Promise<void>>
>

function createOrders(handlers: Handlers = {}) {
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

const confirmEverything: Handlers = {
  onInsert: () => Promise.resolve(),
  onUpdate: () => Promise.resolve(),
  onDelete: () => Promise.resolve(),
}

type Orders = ReturnType<typeof createOrders>
type Write = (orders: Orders) => unknown

// Runs writes in order and records what a caller could observe. A write
// that throws is recorded and the remaining writes still run.
async function observe(handlers: Handlers, writes: Array<Write>) {
  const orders = createOrders(handlers)
  const batches: Array<Array<string>> = []
  orders.subscribeChanges(
    (changes) =>
      batches.push(
        changes
          .map(
            ({ type, key, value }) =>
              `${type}:${key}:${value.value}:${String(value.$synced)}`,
          )
          .sort(),
      ),
    { includeInitialState: true },
  )
  const errors: Array<string> = []
  const transactions = []
  for (const write of writes) {
    try {
      transactions.push(write(orders) as ReturnType<Orders[`insert`]>)
    } catch (error) {
      errors.push(`${(error as Error).name}: ${(error as Error).message}`)
    }
  }
  await Promise.all(transactions.map((t) => t.isPersisted.promise))
  return {
    rows: orders.toArray.map(({ id, value }) => ({ id, value })),
    batches,
    errors,
    states: transactions.map((t) => t.state),
    remaining: orders._state.transactions.size,
  }
}

describe(`local-only direct writes match the confirmed optimistic path`, () => {
  const histories: Record<string, Array<Write>> = {
    'a mixed multi-key batch': [
      (orders) =>
        orders.insert([
          { id: 2, value: `b` },
          { id: 3, value: `c` },
        ]),
      (orders) =>
        orders.update([1, 2], (drafts) => {
          for (const draft of drafts) draft.value += `!`
        }),
      (orders) => orders.delete([1, 3]),
    ],
    'an insert batch with an existing key': [
      (orders) =>
        orders.insert([
          { id: 4, value: `d` },
          { id: 1, value: `dup` },
        ]),
      (orders) => orders.insert({ id: 5, value: `e` }),
    ],
    'an insert batch that repeats a key': [
      (orders) =>
        orders.insert([
          { id: 4, value: `d` },
          { id: 4, value: `again` },
        ]),
    ],
    'an update batch with a missing key': [
      (orders) =>
        orders.update([1, 99], (drafts) => {
          for (const draft of drafts) draft.value = `x`
        }),
      (orders) =>
        orders.update(1, (draft) => {
          draft.value = `y`
        }),
    ],
    'an update callback that throws midway': [
      (orders) =>
        orders.update(1, (draft) => {
          draft.value = `half`
          throw new Error(`callback failed`)
        }),
    ],
    'a delete batch with a missing key': [
      (orders) => orders.insert({ id: 2, value: `b` }),
      (orders) => orders.delete([2, 99]),
      (orders) => orders.delete(1),
    ],
  }

  for (const [name, writes] of Object.entries(histories)) {
    it(`for ${name}`, async () => {
      const direct = await observe({}, writes)
      const reference = await observe(confirmEverything, writes)

      expect(direct).toEqual(reference)
      expect(direct.states.every((state) => state === `completed`)).toBe(true)
      expect(direct.remaining).toBe(0)
    })
  }

  it(`for a write the schema rejects`, () => {
    const results = []
    for (const handlers of [{}, confirmEverything]) {
      const orders = createCollection(
        localOnlyCollectionOptions({
          id: `local-only-direct-schema-${Math.random()}`,
          getKey: (row) => row.id,
          schema: z.object({ id: z.number(), value: z.string().min(1) }),
          initialData: [{ id: 1, value: `a` }],
          ...handlers,
        }),
      )
      const batches: Array<number> = []
      orders.subscribeChanges((changes) => batches.push(changes.length))
      const errors = []
      for (const write of [
        () => orders.insert({ id: 2, value: `` }),
        () =>
          orders.update(1, (draft) => {
            draft.value = ``
          }),
      ]) {
        try {
          write()
        } catch (error) {
          errors.push(`${(error as Error).name}: ${(error as Error).message}`)
        }
      }
      results.push({
        errors,
        batches,
        rows: orders.toArray.map(({ id, value }) => ({ id, value })),
        remaining: orders._state.transactions.size,
      })
    }

    expect(results[0]!.errors).toHaveLength(2)
    expect(results[0]!.batches).toEqual([])
    expect(results[0]).toEqual(results[1])
  })
})

describe(`local-only fallbacks for every operation type`, () => {
  type Kind = `insert` | `update` | `delete`
  // However the fallback is reached, the write must stay visible and must
  // not report completion before the optimistic stage confirms it.
  const write: Record<Kind, (orders: Orders) => ReturnType<Orders[`insert`]>> =
    {
      insert: (orders) => orders.insert({ id: 5, value: `direct` }),
      update: (orders) =>
        orders.update(1, (draft) => {
          draft.value = `direct`
        }),
      delete: (orders) => orders.delete(1),
    }
  const rollbackBatches: Record<Kind, Array<Array<string>>> = {
    insert: [[`insert:1`], [`insert:5`], [`delete:5`]],
    update: [[`insert:1`], [`update:1`], [`update:1`]],
    delete: [[`insert:1`], [`delete:1`], [`insert:1`]],
  }
  const visible: Record<Kind, (orders: Orders) => boolean> = {
    insert: (orders) => orders.get(5)?.value === `direct`,
    update: (orders) => orders.get(1)?.value === `direct`,
    delete: (orders) => !orders.has(1),
  }

  for (const kind of [`insert`, `update`, `delete`] as const) {
    it(`keeps a ${kind} visible while another transaction persists`, async () => {
      const orders = createOrders()
      const release = createDeferred<void>()
      const persisting = createTransaction({
        mutationFn: () => release.promise,
      })
      persisting.mutate(() => orders.insert({ id: 3, value: `persisting` }))

      const transaction = write[kind](orders)

      expect(transaction.state).not.toBe(`completed`)
      expect(visible[kind](orders)).toBe(true)
      release.resolve()
      await persisting.isPersisted.promise
      await transaction.isPersisted.promise
      expect(visible[kind](orders)).toBe(true)
    })

    it(`overlays a pending transaction with a ${kind}`, async () => {
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

      const transaction = write[kind](orders)

      expect(transaction.state).not.toBe(`completed`)
      expect(visible[kind](orders)).toBe(true)
      pending.rollback()
      await transaction.isPersisted.promise
      expect(visible[kind](orders)).toBe(true)
    })

    it(`joins an ambient transaction with a ${kind}`, () => {
      const orders = createOrders()
      const ambient = createTransaction({
        autoCommit: false,
        mutationFn: () => Promise.resolve(),
      })
      ambient.mutate(() => write[kind](orders))

      expect(ambient.mutations.map((m) => m.type)).toEqual([kind])
      expect(visible[kind](orders)).toBe(true)
      ambient.rollback()
      expect(visible[kind](orders)).toBe(false)
    })

    it(`rolls back a ${kind} whose handler rejects`, async () => {
      const handler = `on${kind[0]!.toUpperCase()}${kind.slice(1)}` as const
      const orders = createOrders({
        [handler]: () => Promise.reject(new Error(`handler failed`)),
      })
      const batches: Array<Array<string>> = []
      orders.subscribeChanges(
        (changes) =>
          batches.push(changes.map((change) => `${change.type}:${change.key}`)),
        { includeInitialState: true },
      )

      const transaction = write[kind](orders)

      expect(visible[kind](orders)).toBe(true)
      await expect(transaction.isPersisted.promise).rejects.toThrow(
        `handler failed`,
      )
      expect(transaction.state).toBe(`failed`)
      expect(visible[kind](orders)).toBe(false)
      expect(orders.get(1)?.value ?? `a`).toBe(`a`)
      expect(batches).toEqual(rollbackBatches[kind])
      // Operation types without a handler still write directly.
      const other = kind === `insert` ? `update` : `insert`
      expect(write[other](orders).state).toBe(`completed`)
    })
  }
})
