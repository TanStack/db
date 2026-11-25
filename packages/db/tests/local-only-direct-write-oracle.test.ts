import { describe, expect } from 'vitest'
import { fc } from '@fast-check/vitest'
import { createCollection } from '../src/collection/index'
import { localOnlyCollectionOptions } from '../src/local-only'
import { oracleProperty, pass, violation } from './oracle-config'
import { withOracleCleanup } from './oracle-cleanup'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from './oracle-assertion-adapter'
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
 * histories and checks every publication. These witnesses fix the guard's
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

  // A history's writes are functions, so each enumerated history is its name;
  // resolution maps it to those writes.
  oracleProperty({
    id: `local-only.direct-write-fixed`,
    law: {
      statement: `A local-only direct write leaves the same rows, publishes the same batches, throws the same errors, and ends with the same completed transactions as the confirmed optimistic path, with no transaction left on the Collection.`,
      authority: `The local-only direct-write law stated above`,
      limits: `The named guard fallback histories above, which the change-event history oracle does not generate.`,
    },
    // What this oracle owns: the gap report judges the local-only direct-write
    // guard in CollectionMutationsManager.commitLocalOnlyDirect and the local-only
    // Collection options by this file's fixed direct-write histories.
    owns: [
      `src/local-only.ts`,
      `src/collection/mutations.ts#CollectionMutationsManager.commitLocalOnlyDirect`,
    ],
    histories: Object.keys(histories),
    label: (name) => `for ${name}`,
    resolve: (name) => ({ name, writes: histories[name]! }),
    model: recordedAssertionJudgment,
    driver: (plan, record) =>
      recordAssertionJudgment(
        `local-only.direct-write-fixed`,
        plan,
        record,
        async () => {
          const direct = await observe({}, plan.writes)
          const reference = await observe(confirmEverything, plan.writes)

          expectDirectMatchesConfirmed(direct, reference)
        },
      ),
    check: forwardAssertionJudgment,
  })
})

/**
 * The LocalOnly guide's Mutation Handlers section promises automatic
 * confirmation after a successful optional handler. A rejected handler rolls
 * its optimistic mutation back. Its returned value supplies no separate
 * confirmation policy. This is the local receiving distinction from remote
 * handlers, whose confirmation requires an explicit provider operation.
 *
 * The independent model applies one authored operation to a plain row list
 * only on fulfillment. Histories vary the operation, handler decision, ignored
 * legacy return, row value and a disjoint peer. The driver holds the real
 * handler, records the optimistic public rows, releases it, records inside the
 * settlement waiter, then reloads. Reload must keep those accepted local rows:
 * they are the only copy (LocalOnly guide, initialData). No remote replacement,
 * simultaneous handlers, arbitrary values or callback publication is claimed.
 */
type LocalHandlerHistory = {
  operation: `insert` | `update` | `delete`
  accepted: boolean
  legacy: `void` | `false` | `refetch` | `checkpoint`
  peer: boolean
  value: string
}

const localHandlerHistory = fc.record({
  operation: fc.constantFrom(
    `insert` as const,
    `update` as const,
    `delete` as const,
  ),
  accepted: fc.boolean(),
  legacy: fc.constantFrom(
    `void` as const,
    `false` as const,
    `refetch` as const,
    `checkpoint` as const,
  ),
  peer: fc.boolean(),
  value: fc.string({ maxLength: 8 }),
})

const localHandlerStates = ([`insert`, `update`, `delete`] as const).flatMap(
  (operation) =>
    [true, false].flatMap((accepted) =>
      ([`void`, `false`, `refetch`, `checkpoint`] as const).map(
        (legacy) =>
          `${operation}:${accepted ? `accepted` : `rejected`}:${legacy}`,
      ),
    ),
)
const localHandlerRequired = new WeakMap<LocalHandlerHistory, string>()
const localHandlerState = (history: LocalHandlerHistory) =>
  `${history.operation}:${history.accepted ? `accepted` : `rejected`}:${history.legacy}`

function localHandlerModel(history: LocalHandlerHistory) {
  const initial = [
    { id: 1, value: `initial` },
    ...(history.peer ? [{ id: 3, value: `peer` }] : []),
  ]
  const optimistic =
    history.operation === `insert`
      ? [...initial, { id: 2, value: history.value }]
      : history.operation === `update`
        ? initial.map((row) =>
            row.id === 1 ? { ...row, value: history.value } : row,
          )
        : initial.filter((row) => row.id !== 1)
  const sorted = (rows: typeof initial) => [...rows].sort((a, b) => a.id - b.id)
  return {
    optimistic: sorted(optimistic),
    final: sorted(history.accepted ? optimistic : initial),
    settlement: history.accepted ? `fulfilled` : `rejected`,
    state: history.accepted ? `completed` : `failed`,
  }
}

type LocalHandlerObservation = {
  held: Array<{ id: number; value: string }>
  heldSettlement: string
  settled: Array<{ id: number; value: string }>
  reloaded: Array<{ id: number; value: string }>
  settlement: string
  state: string
  exactFailure: boolean
  calls: number
}

async function localHandlerDriver(
  history: LocalHandlerHistory,
  record: (checkpoint: string, value: unknown) => void,
  omitConfirmation = false,
) {
  let release!: () => void
  let entered!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const entry = new Promise<void>((resolve) => {
    entered = resolve
  })
  const failure = new Error(`local handler failure`)
  let calls = 0
  const handler = async (): Promise<void> => {
    calls++
    entered()
    await gate
    if (!history.accepted) throw failure
    const ignored: unknown =
      history.legacy === `void`
        ? undefined
        : history.legacy === `false`
          ? false
          : history.legacy === `refetch`
            ? { refetch: false }
            : { checkpoint: `ignored` }
    return ignored as void
  }
  const options = localOnlyCollectionOptions({
    getKey: (row: { id: number; value: string }) => row.id,
    initialData: [
      { id: 1, value: `initial` },
      ...(history.peer ? [{ id: 3, value: `peer` }] : []),
    ],
    onInsert: handler,
    onUpdate: handler,
    onDelete: handler,
  })
  if (omitConfirmation) {
    const source = options.sync.sync
    options.sync = {
      ...options.sync,
      sync: (params) => {
        let initializing = true
        const run = source({
          ...params,
          // Hostile adapter-boundary control: retain the actual initial load,
          // but omit every later automatic confirmation write. Handler entry
          // and settlement still run through the real local adapter.
          write: (message) => {
            if (initializing) params.write(message)
          },
        })
        initializing = false
        return run
      },
    }
  }
  const collection = createCollection(options)
  const rows = () =>
    [...collection.values()]
      .map(({ id, value }) => ({ id, value }))
      .sort((a, b) => a.id - b.id)
  await withOracleCleanup(async () => {
    await collection.preload()
    const transaction =
      history.operation === `insert`
        ? collection.insert({ id: 2, value: history.value })
        : history.operation === `update`
          ? collection.update(1, (draft) => {
              draft.value = history.value
            })
          : collection.delete(1)
    let settlement = `pending`
    let exactFailure = false
    let settled: ReturnType<typeof rows> = []
    const pending = transaction.when(`settled`).then(
      () => {
        settlement = `fulfilled`
        settled = rows()
      },
      (error: unknown) => {
        settlement = `rejected`
        exactFailure = error === failure
        settled = rows()
      },
    )
    await entry
    const held = rows()
    const heldSettlement = settlement
    release()
    await pending
    await collection.reload()
    record(`local handler`, {
      held,
      heldSettlement,
      settled,
      reloaded: rows(),
      settlement,
      state: transaction.state,
      exactFailure,
      calls,
    } satisfies LocalHandlerObservation)
    record(`reach`, localHandlerState(history))
  }, [() => release(), () => collection.cleanup()])
}

oracleProperty({
  id: `local-only.handler-confirmation`,
  owns: [`src/local-only.ts#localOnlyCollectionOptions`],
  law: {
    statement: `Successful local handlers automatically confirm their authored mutation, rejected handlers roll back with the same error, legacy returns are ignored, and reload retains the accepted rows.`,
    authority: `LocalOnly Collection guide, Direct Local Mutations, Mutation Handlers and initialData; glossary optimistic state and reload.`,
    limits: `One held insert/update/delete, one disjoint peer, short strings and four return shapes. No concurrent handlers, ambient transactions, arbitrary values or every publication.`,
  },
  histories: {
    arbitrary: localHandlerHistory,
    runs: 80,
    fixedSeeds: [2377],
    states: localHandlerStates,
    constructed: ([`insert`, `update`, `delete`] as const).flatMap(
      (operation) =>
        [true, false].flatMap((accepted) =>
          ([`void`, `false`, `refetch`, `checkpoint`] as const).map(
            (legacy) => {
              const state = localHandlerState({
                operation,
                accepted,
                legacy,
                peer: false,
                value: ``,
              })
              return {
                name: state,
                enters: [state],
                build: (generated: LocalHandlerHistory) => {
                  const history = { ...generated, operation, accepted, legacy }
                  localHandlerRequired.set(history, state)
                  return history
                },
              }
            },
          ),
        ),
    ),
  },
  model: localHandlerModel,
  driver: (history, record) => localHandlerDriver(history, record),
  check: (history, observations, expected) => {
    const actual = observations.find(
      ({ checkpoint }) => checkpoint === `local handler`,
    )?.value as LocalHandlerObservation | undefined
    if (!actual)
      return violation(
        `local handler`,
        `Missing handler observation`,
        `local automatic confirmation`,
      )
    const same = (a: unknown, b: unknown) =>
      JSON.stringify(a) === JSON.stringify(b)
    const correct =
      same(actual.held, expected.optimistic) &&
      actual.heldSettlement === `pending` &&
      same(actual.settled, expected.final) &&
      same(actual.reloaded, expected.final) &&
      actual.settlement === expected.settlement &&
      actual.state === expected.state &&
      actual.exactFailure === !history.accepted &&
      actual.calls === 1
    if (!correct)
      return violation(
        `local handler`,
        `Automatic local confirmation diverged`,
        `local automatic confirmation`,
        { actual, expected },
      )
    const required = localHandlerRequired.get(history)
    return !required ||
      observations.some(
        ({ checkpoint, value }) => checkpoint === `reach` && value === required,
      )
      ? pass
      : violation(
          `reach`,
          `Missing generated local handler state ${required}`,
          `local handler reach`,
        )
  },
  calibrations: [
    {
      name: `adapter omits actual automatic confirmation writes`,
      history: { constructed: `insert:accepted:void` },
      law: `local automatic confirmation`,
      driver: (history, record) => localHandlerDriver(history, record, true),
    },
    {
      name: `successful handler loses automatically accepted row`,
      history: { constructed: `insert:accepted:void` },
      law: `local automatic confirmation`,
      corrupt: (observations, history) =>
        history.accepted && history.operation === `insert`
          ? observations.map((entry) =>
              entry.checkpoint === `local handler`
                ? {
                    ...entry,
                    value: {
                      ...(entry.value as LocalHandlerObservation),
                      settled: [],
                    },
                  }
                : entry,
            )
          : undefined,
    },
    {
      name: `reload discards the only local copy`,
      history: { constructed: `insert:accepted:void` },
      law: `local automatic confirmation`,
      corrupt: (observations, history) =>
        history.accepted && history.operation === `insert`
          ? observations.map((entry) =>
              entry.checkpoint === `local handler`
                ? {
                    ...entry,
                    value: {
                      ...(entry.value as LocalHandlerObservation),
                      reloaded: [],
                    },
                  }
                : entry,
            )
          : undefined,
    },
    ...localHandlerStates.map((state) => ({
      name: `missing generated local handler state ${state}`,
      history: { constructed: state },
      law: `local handler reach`,
      corrupt: (
        observations: ReadonlyArray<{ checkpoint: string; value: unknown }>,
        history: LocalHandlerHistory,
      ) =>
        localHandlerRequired.get(history) === state
          ? observations.filter(({ checkpoint }) => checkpoint !== `reach`)
          : undefined,
    })),
  ],
})
