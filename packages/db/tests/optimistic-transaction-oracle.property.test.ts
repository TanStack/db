import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { createLiveQueryCollection } from '../src/query/index.js'
import { createTransaction } from '../src/transactions.js'
import {
  expectHistoryOutcome,
  observeHistoryPromise,
  withHistoryCleanup,
} from './optimistic-history-oracle.js'
import { oraclePropertyOptions, oracleRuns } from './oracle-config.js'
import type { ChangeMessage, SyncConfig } from '../src/types.js'

type Row = { id: number; value: number; note: string }
type Operation = `insert` | `update` | `delete`
type Scenario = {
  order: Array<Operation>
  optimistic: boolean
  outcome: `resolve` | `reject` | `rollback`
  value: number
  note: string
}
type ObservationFault =
  | `missing-delete`
  | `untouched-field`
  | `partial-publication`
  | `payload`
  | `string-key`
const orders: Array<Array<Operation>> = [
  [`insert`, `update`, `delete`],
  [`insert`, `delete`, `update`],
  [`update`, `insert`, `delete`],
  [`update`, `delete`, `insert`],
  [`delete`, `insert`, `update`],
  [`delete`, `update`, `insert`],
]

// Observe user fields without discarding unexpected fields or undefined keys.
function userRow(value: Row): Row {
  const copy: Record<string, unknown> = { ...value }
  for (const field of [`$synced`, `$origin`, `$key`, `$collectionId`])
    delete copy[field]
  return copy as Row
}
const ordered = (rows: Iterable<Row>) =>
  [...rows].map(userRow).sort((a, b) => a.id - b.id)

function expectRows(
  actual: Iterable<Row>,
  expected: Iterable<Row>,
  cut: string,
) {
  expect(ordered(actual), cut).toStrictEqual(ordered(expected))
}

async function runTransaction(scenario: Scenario, fault?: ObservationFault) {
  const base = new Map<number, Row>([
    [1, { id: 1, value: -1, note: `deleted` }],
    [2, { id: 2, value: 0, note: `untouched update field` }],
    [4, { id: 4, value: -4, note: `unrelated peer` }],
  ])
  const proposed = new Map(base)
  proposed.delete(1)
  proposed.set(2, { ...base.get(2)!, value: scenario.value })
  proposed.set(3, { id: 3, value: scenario.value + 1, note: scenario.note })
  let sync!: Parameters<SyncConfig<Row>[`sync`]>[0]
  const source = createCollection<Row>({
    getKey: (row) => row.id,
    sync: {
      rowUpdateMode: `full`,
      sync: (actions) => {
        sync = actions
        actions.begin()
        for (const row of base.values())
          actions.write({ type: `insert`, value: { ...row } })
        actions.commit()
        actions.markReady()
      },
    },
  })
  const derived = createLiveQueryCollection({
    query: (q) => q.from({ row: source }),
  })
  const gate = createDeferred<void>()
  let payload:
    | Array<{
        type: Operation
        key: unknown
        original: object
        modified: Row
        changes: object
      }>
    | undefined
  const tx = createTransaction<Row>({
    autoCommit: false,
    mutationFn: ({ transaction }) => {
      payload = transaction.mutations.map((mutation) => ({
        type: mutation.type,
        key: mutation.key,
        original: { ...mutation.original },
        modified: userRow(mutation.modified),
        changes: { ...mutation.changes },
      }))
      return gate.promise
    },
  })
  const persisted = observeHistoryPromise(tx.isPersisted.promise)
  let committed: ReturnType<typeof observeHistoryPromise<typeof tx>> | undefined
  let subscription: ReturnType<typeof source.subscribeChanges> | undefined
  const replica = new Map<number, Row>()
  const publications: Array<{
    changes: Array<ChangeMessage<Row>>
    rows: Array<Row>
    replica: Array<Row>
  }> = []
  const failure = new Error(`authored mutation failure`)
  let checked = 0
  const check = (expected: Map<number, Row>, label: string, graph = true) => {
    const read = ordered(source.values())
    // Test-only faults alter captured observations, never the expected world or
    // runtime. Every fault also runs beside the same healthy real driver.
    if (fault === `missing-delete` && label === `authoritative acknowledgement`)
      read.push({ ...base.get(1)! })
    if (fault === `untouched-field` && label === `draft update`)
      read.find((row) => row.id === 2)!.note = `wrong untouched field`
    if (
      fault === `partial-publication` &&
      label === `authoritative acknowledgement`
    ) {
      const partial = new Map(base)
      partial.delete(1)
      publications.splice(checked, 0, {
        changes: [],
        rows: ordered(partial.values()),
        replica: ordered(partial.values()),
      })
    }
    expectRows(read, expected.values(), `${label}: source`)
    if (graph)
      expectRows(derived.values(), expected.values(), `${label}: derived`)
    expectRows(replica.values(), expected.values(), `${label}: replica`)
    for (const publication of publications.slice(checked)) {
      for (const change of publication.changes) {
        expect(typeof change.key, `${label}: native callback key type`).toBe(
          `number`,
        )
        expect(change.key, `${label}: callback key matches row`).toBe(
          change.value.id,
        )
      }
      expectRows(publication.rows, expected.values(), `${label}: callback read`)
      expectRows(
        publication.replica,
        expected.values(),
        `${label}: callback delta`,
      )
    }
    checked = publications.length
  }
  return withHistoryCleanup(
    async () => {
      await derived.preload()
      subscription = source.subscribeChanges(
        (batch) => {
          // Copy entries before reduction: key identity and previous values
          // cannot be recovered from a final reconstructed row snapshot.
          const changes = batch.map((change) => ({
            ...change,
            key: fault === `string-key` ? String(change.key) : change.key,
            value: userRow(change.value),
            ...(`previousValue` in change
              ? {
                  previousValue: change.previousValue
                    ? userRow(change.previousValue)
                    : change.previousValue,
                }
              : {}),
          }))
          for (const change of changes) {
            if (change.type === `delete`) replica.delete(change.key as number)
            else replica.set(change.key as number, userRow(change.value))
          }
          publications.push({
            changes,
            rows: ordered(source.values()),
            replica: ordered(replica.values()),
          })
        },
        { includeInitialState: true },
      )
      check(base, `initial`)
      const draftRows = new Map(base)
      tx.mutate(() => {
        for (const operation of scenario.order) {
          if (operation === `delete`)
            source.delete(1, { optimistic: scenario.optimistic })
          else if (operation === `insert`)
            source.insert(
              { ...proposed.get(3)! },
              { optimistic: scenario.optimistic },
            )
          else
            source.update(2, { optimistic: scenario.optimistic }, (draft) => {
              draft.value = scenario.value
            })
          // mutate groups persistence, not synchronous Collection calls. Each
          // authored operation may publish its own complete draft prefix.
          if (operation === `delete`) draftRows.delete(1)
          else if (operation === `insert`) draftRows.set(3, proposed.get(3)!)
          else draftRows.set(2, proposed.get(2)!)
          check(
            scenario.optimistic ? draftRows : base,
            `draft ${operation}`,
            false,
          )
        }
      })
      const pendingRows = scenario.optimistic ? proposed : base
      check(pendingRows, `complete mutation scope`)
      committed = observeHistoryPromise(tx.commit())
      expect(payload, `actual mutation function entered`).toBeDefined()
      if (fault === `payload`)
        payload![0]!.modified.note = `wrong transmitted value`
      const expectedPayload = scenario.order.map((type) => {
        const key = type === `insert` ? 3 : type === `update` ? 2 : 1
        return {
          type,
          key,
          original: type === `insert` ? {} : base.get(key)!,
          modified: type === `delete` ? base.get(key)! : proposed.get(key)!,
          changes:
            type === `update`
              ? { value: scenario.value }
              : type === `insert`
                ? proposed.get(key)!
                : base.get(key)!,
        }
      })
      expect(payload, `whole authored mutation payload`).toStrictEqual(
        expectedPayload,
      )
      expectHistoryOutcome(
        persisted.read(),
        { status: `pending` },
        `held persistence`,
      )
      expectHistoryOutcome(
        committed.read(),
        { status: `pending` },
        `held commit`,
      )
      check(pendingRows, `held handler`)
      if (scenario.outcome === `reject`) gate.reject(failure)
      else {
        if (scenario.outcome === `rollback`) tx.rollback()
        gate.resolve()
      }
      await Promise.all([persisted.settled, committed.settled])
      expectHistoryOutcome(
        persisted.read(),
        scenario.outcome === `resolve`
          ? { status: `fulfilled`, value: tx }
          : scenario.outcome === `reject`
            ? { status: `rejected`, reason: failure }
            : { status: `rejected` },
        `persistence settlement`,
      )
      // Manual rollback rejects persistence; the already running commit returns
      // its transaction when the held handler finishes without a new failure.
      expectHistoryOutcome(
        committed.read(),
        scenario.outcome === `reject`
          ? { status: `rejected`, reason: failure }
          : { status: `fulfilled`, value: tx },
        `commit settlement`,
      )
      const accepted = scenario.outcome === `resolve`
      // Unlike completed direct operations, an explicit manual transaction with
      // no queued sync acknowledgement does not retain its optimistic rows.
      check(base, `settled without queued acknowledgement`)
      let expected = new Map(accepted ? proposed : base)
      if (accepted) {
        sync.begin()
        for (const type of scenario.order) {
          const key = type === `insert` ? 3 : type === `update` ? 2 : 1
          sync.write({
            type,
            value: {
              ...(type === `delete` ? base.get(key)! : proposed.get(key)!),
            },
          })
        }
        const receipt = sync.commit()
        if (receipt !== true) await receipt
        check(expected, `authoritative acknowledgement`)
      }
      const peer = { ...base.get(4)!, value: 404 }
      expected = new Map(expected).set(4, peer)
      sync.begin()
      sync.write({ type: `update`, value: { ...peer } })
      const receipt = sync.commit()
      if (receipt !== true) await receipt
      check(expected, `later unrelated source change`)
    },
    () => [
      () => {
        if (tx.state === `pending` || tx.state === `persisting`) tx.rollback()
      },
      () => gate.resolve(),
      () => persisted.settled,
      () => committed?.settled,
      () => subscription?.unsubscribe(),
      () => derived.cleanup(),
      () => source.cleanup(),
    ],
  )
}

describe(`Whole mixed transaction publication`, () => {
  const cells = orders.flatMap((order) =>
    [false, true].flatMap((optimistic) =>
      ([`resolve`, `reject`, `rollback`] as const).map((outcome) => ({
        order,
        optimistic,
        outcome,
      })),
    ),
  )
  it.each(cells)(`publishes complete transaction cuts %j`, async (cell) => {
    await runTransaction({ ...cell, value: 17, note: `new row` })
  })
  it.each([505202, undefined])(
    `varies full payloads, seed=%s`,
    async (seed) => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            order: fc.constantFrom(...orders),
            optimistic: fc.boolean(),
            outcome: fc.constantFrom(
              `resolve` as const,
              `reject` as const,
              `rollback` as const,
            ),
            value: fc.integer({ min: 1, max: 100 }),
            note: fc.string({ maxLength: 10 }),
          }),
          (scenario) => runTransaction(scenario),
        ),
        seed === undefined
          ? oraclePropertyOptions(100, `collection-state.mixed-transaction`)
          : { numRuns: oracleRuns(100), seed },
      )
    },
  )
  it.each([
    `missing-delete`,
    `untouched-field`,
    `partial-publication`,
    `payload`,
    `string-key`,
  ] as const)(
    `rejects captured %s through the real transaction driver's checks`,
    async (fault) => {
      const scenario: Scenario = {
        order: [`insert`, `update`, `delete`],
        optimistic: true,
        outcome: `resolve`,
        value: 17,
        note: `new row`,
      }
      await runTransaction(scenario)
      await expect(runTransaction(scenario, fault)).rejects.toMatchObject({
        name: `AssertionError`,
      })
    },
  )
})
