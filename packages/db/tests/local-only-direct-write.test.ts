/**
 * Ordinary tests for local-only direct writes: a direct write publishes once
 * and completes; a write under a pending, persisting, or ambient transaction
 * keeps its optimistic visibility; and a rejected schema write publishes
 * nothing. The direct-path law is owned by local-only-direct-write-oracle.test.ts,
 * which compares the direct and confirmed paths.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createCollection } from '../src/index'
import { localOnlyCollectionOptions } from '../src/local-only'
import { createTransaction } from '../src/transactions'
import { createDeferred } from '../src/deferred'
import {
  confirmEverything,
  createOrders,
} from './local-only-direct-write-fixture'
import { captureCreatedTransactions } from './utils'
import type { Orders } from './local-only-direct-write-fixture'

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
      await expect(transaction.when(`settled`)).resolves.toBe(transaction)
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

  // The direct write stores its rows when it publishes them, so a throwing
  // subscriber cannot undo the write. The call rethrows, and the transaction
  // still completes instead of staying pending.
  it(`completes a direct write whose subscriber throws`, async () => {
    const orders = createOrders()
    const { created, restore: restoreCreate } =
      captureCreatedTransactions(orders)
    const failure = new Error(`subscriber failed`)
    const subscription = orders.subscribeChanges(() => {
      throw failure
    })
    expect(() => orders.insert({ id: 2, value: `b` })).toThrow(failure)
    subscription.unsubscribe()
    restoreCreate()

    expect(orders.get(2)?.value).toBe(`b`)
    expect(created.map((transaction) => transaction.state)).toEqual([
      `completed`,
    ])
    await expect(created[0]!.isPersisted.promise).resolves.toBe(created[0])
    // The next direct write still takes the direct path.
    expect(orders.insert({ id: 3, value: `c` }).state).toBe(`completed`)
  })

  // A subscriber may write the key it was told about, as a normalizing or
  // rejecting subscriber does. The first write stored its rows before that,
  // so it completes and does not throw.
  for (const kind of [`update`, `delete`] as const) {
    it(`completes a direct insert whose subscriber ${kind}s the same key`, async () => {
      const orders = createOrders()
      const { created, restore: restoreCreate } =
        captureCreatedTransactions(orders)
      let reacted = false
      const subscription = orders.subscribeChanges((changes) => {
        if (reacted || changes.every((change) => change.key !== 2)) return
        reacted = true
        if (kind === `update`)
          orders.update(2, (draft) => {
            draft.value = `normalized`
          })
        else orders.delete(2)
      })
      try {
        expect(() => orders.insert({ id: 2, value: `b` })).not.toThrow()
      } finally {
        subscription.unsubscribe()
        restoreCreate()
      }
      expect(orders.get(2)?.value).toBe(
        kind === `update` ? `normalized` : undefined,
      )
      await Promise.all(
        created.map((transaction) => transaction.isPersisted.promise),
      )
      expect(created.map((transaction) => transaction.state)).toEqual([
        `completed`,
        `completed`,
      ])
    })
  }

  // A subscriber may throw a value that is not an Error. The rolled-back
  // transaction still records an Error, so its receipt names the failure.
  it(`records an Error when a direct write's subscriber throws a non-Error`, async () => {
    const orders = createOrders({ onInsert: async () => {} })
    const { created, restore: restoreCreate } =
      captureCreatedTransactions(orders)
    const subscription = orders.subscribeChanges(() => {
      throw `bad`
    })
    try {
      expect(() => orders.insert({ id: 2, value: `b` })).toThrow(`bad`)
    } finally {
      subscription.unsubscribe()
      restoreCreate()
    }
    expect(created.map((transaction) => transaction.state)).toEqual([`failed`])
    expect(created[0]!.error?.error).toBeInstanceOf(Error)
    expect(created[0]!.error?.message).toBe(`bad`)
    await expect(created[0]!.isPersisted.promise).rejects.toBeInstanceOf(Error)
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

describe(`local-only fallbacks for every operation type`, () => {
  type Kind = `insert` | `update` | `delete`
  // However the fallback is reached, the write must stay visible and must
  // not report completion before the optimistic stage confirms it.
  const write: Record<Kind, (orders: Orders) => ReturnType<Orders[Kind]>> = {
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

describe(`local-only direct writes match the confirmed optimistic path`, () => {
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
