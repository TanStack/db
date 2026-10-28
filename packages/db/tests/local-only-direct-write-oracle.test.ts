import { describe, expect, it } from 'vitest'
import { declareOracle } from './oracle-declaration'
import {
  confirmEverything,
  createOrders,
} from './local-only-direct-write-fixture'
import type { Handlers, Orders } from './local-only-direct-write-fixture'

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
              `${type}:${key}:${value.value}:${String(value.$hasPendingWrites)}`,
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
  await Promise.all(transactions.map((t) => t.when(`settled`)))
  return {
    rows: orders.toArray.map(({ id, value }) => ({ id, value })),
    batches,
    errors,
    states: transactions.map((t) => t.state),
    remaining: orders._state.transactions.size,
  }
}

// The check: the direct path matches the confirmed optimistic path in rows,
// batches, errors, and states, and leaves no transaction on the Collection.
function expectDirectMatchesConfirmed(
  direct: Awaited<ReturnType<typeof observe>>,
  reference: Awaited<ReturnType<typeof observe>>,
): void {
  expect(direct).toEqual(reference)
  expect(direct.states.every((state) => state === `completed`)).toBe(true)
  expect(direct.remaining).toBe(0)
}

declareOracle({ check: [expectDirectMatchesConfirmed] })

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

      expectDirectMatchesConfirmed(direct, reference)
    })
  }
})
