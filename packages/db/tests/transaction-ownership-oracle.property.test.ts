import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import { createCollection } from '../src/collection/index.js'
import { createTransaction } from '../src/transactions.js'
import { DuplicateTransactionIdError } from '../src/errors.js'
import { oraclePropertyOptions, oracleRuns } from './oracle-config.js'
import { mockSyncCollectionOptionsNoInitialState } from './utils.js'
import type { Transaction } from '../src/transactions.js'

/**
 * # Does a settled transaction leave every Collection that tracked it?
 *
 * A Collection tracks a transaction while the transaction can still change
 * what the Collection shows. The contract: once a transaction settles, by
 * success, failure, or rollback, it leaves every Collection that ever tracked
 * it, and each of those Collections stops showing its optimistic rows.
 * Settlement always settles `isPersisted`, even when a subscriber throws
 * during it.
 *
 * Ownership is wider than the transaction's current mutations. An insert and
 * a delete of one key in one transaction merge away, but the Collection that
 * took them still tracked the transaction. A rollback can also start inside a
 * sync commit, from a `truncate` listener, while the Collection skips its
 * ordinary recomputes.
 *
 * The model keeps, for each transaction, the Collections it ever wrote to, its
 * surviving writes per Collection and key, and its state. Its rules are
 * independent of production:
 *
 * - An unsettled transaction is pending or persisting. A Collection tracks
 *   exactly the unsettled transactions that ever wrote to it. An update that
 *   leaves the visible row unchanged is not a write.
 * - A Collection shows its base rows overlaid by the unsettled transactions'
 *   surviving writes, in creation order.
 * - A rollback, or a failed commit, also rolls back every pending (not yet
 *   committed) transaction that wrote one of the same Collection keys.
 * - A settled transaction's `isPersisted` has settled, and its set of
 *   tracking Collections is empty. Its mutations still name their
 *   Collection; this oracle does not claim the Collection is collectable.
 * - Transaction ids are unique among unsettled transactions in a Collection.
 *   A write that would make a Collection track a second unsettled
 *   transaction with an id it already tracks throws, and changes nothing.
 *   Ownership and conflicts follow transaction identity, so a later
 *   transaction that reuses a settled transaction's id is a separate
 *   transaction.
 * - A failed `mutate()` callback undoes its writes, but the Collection that
 *   took one still tracked the transaction.
 * - Error shape: a settling call that ran no throwing subscriber reports no
 *   subscriber error. Otherwise it throws one of the subscriber errors, as
 *   is. The contract does not say which one, because these failures are rare
 *   and the other laws already require every step to run. A commit whose
 *   mutation function rejected rejects with that error, also when subscribers
 *   threw.
 *
 * The grammar opens up to four manual transactions over Collections A and B
 * (keys 1 and 2); an `open` may reuse an earlier transaction's id. A step's `tx` number chooses among the transactions whose
 * state allows that step, so generated steps rarely skip. Steps write a value, write and remove key 9 in one call
 * (a pair that merges away), commit, settle a commit as success or failure,
 * roll back, roll back from a `truncate` listener during a sync commit, and
 * run a `mutate()` callback that writes and then throws. A settling step may
 * install a throwing subscriber on one Collection or on both. It stays
 * installed until promises flush, because a commit settles in a later
 * microtask, and it must have run whenever the model predicts that the step
 * changes that Collection's rows.
 *
 * After a synchronous settling step (commit, rollback, truncate rollback) the
 * driver first compares the tracked ids in the same call stack. After each
 * step it then flushes promises and compares, for each
 * Collection, the tracked transaction ids with the model's set, the rows of
 * keys 1, 2 and 9 with the model's overlay, and each transaction's
 * `isPersisted` settlement with the model's state. It compares tracked
 * transactions by identity. Each settling call's thrown error, or its
 * commit's rejection, is compared with the error-shape law, counting the
 * subscriber errors the step raised. A settled transaction's `collections`
 * must be empty. The tracked transactions come from `_state.transactions`,
 * because no public API exposes them; the rows and settlement are public.
 *
 * Out of scope: queued sync transactions that hold a completed row (owned by
 * the optimistic-history oracle), offline restoration (owned by the
 * offline-transactions witnesses), two Collection instances that share an
 * id (a focused witness in `collection.test.ts`), and Collection cleanup in
 * the middle of a history (a focused witness in `collection.test.ts`).
 */

const PROPERTY = `transaction-ownership.settlement-release`

type CollectionName = `A` | `B`
type ThrowOn = CollectionName | `both` | undefined
type Key = 1 | 2
type Step =
  | { type: `open`; reuse: number | undefined }
  | { type: `edit`; tx: number; on: CollectionName; key: Key; value: number }
  | { type: `cancel`; tx: number; on: CollectionName }
  | { type: `commit`; tx: number }
  | {
      type: `settle`
      tx: number
      ok: boolean
      throwOn: ThrowOn
    }
  | { type: `rollback`; tx: number; throwOn: ThrowOn }
  | { type: `truncateRollback`; tx: number; on: CollectionName }
  | {
      type: `mutateThrows`
      tx: number
      on: CollectionName
      key: Key
      value: number
    }

type ModelState = `pending` | `persisting` | `completed` | `failed`
type ModelTx = {
  /** The index of the transaction whose id this one uses. */
  id: number
  state: ModelState
  owners: Set<CollectionName>
  writes: Map<`${CollectionName}:${Key}`, number>
}

class OwnershipModel {
  transactions: Array<ModelTx> = []

  open(reuse: number | undefined): void {
    this.transactions.push({
      id: reuse ?? this.transactions.length,
      state: `pending`,
      owners: new Set(),
      writes: new Map(),
    })
  }

  unsettled(tx: ModelTx): boolean {
    return tx.state === `pending` || tx.state === `persisting`
  }

  tracked(on: CollectionName): Array<number> {
    return this.transactions.flatMap((tx, index) =>
      this.unsettled(tx) && tx.owners.has(on) ? [index] : [],
    )
  }

  /** Whether `on` already tracks a different unsettled transaction with `index`'s id. */
  duplicate(index: number, on: CollectionName): boolean {
    const tx = this.transactions[index]!
    return this.transactions.some(
      (other, otherIndex) =>
        otherIndex !== index &&
        other.id === tx.id &&
        this.unsettled(other) &&
        other.owners.has(on) &&
        !tx.owners.has(on),
    )
  }

  row(on: CollectionName, key: Key): number {
    let value = 0
    for (const tx of this.transactions) {
      if (!this.unsettled(tx)) continue
      value = tx.writes.get(`${on}:${key}`) ?? value
    }
    return value
  }

  /**
   * Chooses a transaction for a step: the step's number selects among the
   * transactions whose state allows the step, so generated steps rarely skip.
   */
  pick(choice: number, states: ReadonlyArray<ModelState>): number | undefined {
    const eligible = this.transactions.flatMap((tx, index) =>
      states.includes(tx.state) ? [index] : [],
    )
    return eligible.length ? eligible[choice % eligible.length] : undefined
  }

  /** Fails `index`, then every pending transaction that shares a key. */
  fail(index: number): void {
    const tx = this.transactions[index]!
    tx.state = `failed`
    for (const candidate of this.transactions) {
      if (candidate === tx || candidate.state !== `pending`) continue
      if ([...candidate.writes.keys()].some((key) => tx.writes.has(key)))
        candidate.state = `failed`
    }
  }
}

const name = fc.constantFrom<CollectionName>(`A`, `B`)
const txIndex = fc.integer({ min: 0, max: 3 })
const throwTarget: fc.Arbitrary<ThrowOn> = fc.oneof(
  { weight: 3, arbitrary: fc.constant(undefined) },
  { weight: 2, arbitrary: name },
  { weight: 1, arbitrary: fc.constant(`both` as const) },
)
const step: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 2,
    arbitrary: fc.record({
      type: fc.constant(`open` as const),
      reuse: fc.option(txIndex, { nil: undefined, freq: 2 }),
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      type: fc.constant(`edit` as const),
      tx: txIndex,
      on: name,
      key: fc.constantFrom<Key>(1, 2),
      value: fc.integer({ min: 1, max: 9 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      type: fc.constant(`cancel` as const),
      tx: txIndex,
      on: name,
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({ type: fc.constant(`commit` as const), tx: txIndex }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      type: fc.constant(`settle` as const),
      tx: txIndex,
      ok: fc.boolean(),
      throwOn: throwTarget,
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      type: fc.constant(`rollback` as const),
      tx: txIndex,
      throwOn: throwTarget,
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant(`truncateRollback` as const),
      tx: txIndex,
      on: name,
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant(`mutateThrows` as const),
      tx: txIndex,
      on: name,
      key: fc.constantFrom<Key>(1, 2),
      value: fc.integer({ min: 1, max: 9 }),
    }),
  },
)

const flush = async () => {
  for (let index = 0; index < 4; index++)
    await new Promise((resolve) => setTimeout(resolve, 0))
}

type Driven = {
  tx: Transaction<{ id: number; v: number }>
  outcome: { resolve: () => void; reject: (error: Error) => void }
  settled: boolean
  /** How `commit()` settled, once it has. */
  commitResult?: { ok: true } | { ok: false; error: unknown }
}

/**
 * The error-shape law. `raised` are the subscriber errors a settling call ran
 * into; `mutationError` is the mutation function's rejection, if any.
 */
function expectErrorShape(
  label: string,
  result: { ok: true } | { ok: false; error: unknown },
  raised: ReadonlyArray<Error>,
  mutationError?: Error,
): void {
  if (mutationError) {
    expect(result.ok, `${label}: mutation error reported`).toBe(false)
    if (!result.ok)
      expect(result.error, `${label}: mutation error rethrown`).toBe(
        mutationError,
      )
    return
  }
  if (raised.length === 0) {
    expect(result.ok, `${label}: no settlement error`).toBe(true)
    return
  }
  expect(result.ok, `${label}: settlement error reported`).toBe(false)
  if (result.ok) return
  expect(
    raised.includes(result.error as Error),
    `${label}: one subscriber error rethrown as is`,
  ).toBe(true)
}

async function makeCollection(id: string) {
  const options = mockSyncCollectionOptionsNoInitialState<{
    id: number
    v: number
  }>({ id, getKey: (row) => row.id, startSync: true })
  const collection = createCollection(options)
  const writeBase = () => {
    options.utils.write({ type: `insert`, value: { id: 1, v: 0 } })
    options.utils.write({ type: `insert`, value: { id: 2, v: 0 } })
  }
  options.utils.begin()
  writeBase()
  options.utils.commit()
  options.utils.markReady()
  await collection.stateWhenReady()
  return { collection, utils: options.utils, writeBase }
}

/** Runs one history against the model and two Collections. */
async function runHistory(steps: ReadonlyArray<Step>): Promise<void> {
  const suffix = Math.random().toString(36).slice(2)
  const collections = {
    A: await makeCollection(`ownership-a-${suffix}`),
    B: await makeCollection(`ownership-b-${suffix}`),
  }
  const model = new OwnershipModel()
  const driven: Array<Driven> = []
  const settle = (entry: Driven) => {
    entry.tx.isPersisted.promise.then(
      () => (entry.settled = true),
      () => (entry.settled = true),
    )
  }
  const rows = (on: CollectionName) => [model.row(on, 1), model.row(on, 2)]
  // Runs a settling step with throwing subscribers on `throwOn`. A commit
  // settles in a later microtask, so the subscribers stay installed until
  // promises flush. When the model predicts that the step changes a
  // Collection's rows, its subscriber must have run, so the throw really
  // reached the settlement. Returns the synchronous result and every
  // subscriber error raised.
  const withThrowingSubscribers = async (
    label: string,
    throwOn: ThrowOn,
    run: () => void,
    applyModel: () => void,
  ) => {
    const targets: Array<CollectionName> =
      throwOn === `both` ? [`A`, `B`] : throwOn ? [throwOn] : []
    const before = targets.map((on) => JSON.stringify(rows(on)))
    const raised: Array<Error> = []
    const calls = new Map<CollectionName, number>()
    const subscriptions = targets.map((on) =>
      collections[on].collection.subscribeChanges(() => {
        calls.set(on, (calls.get(on) ?? 0) + 1)
        const error = new Error(`subscriber on ${on} failed`)
        raised.push(error)
        throw error
      }),
    )
    let result: { ok: true } | { ok: false; error: unknown } = { ok: true }
    try {
      run()
    } catch (error) {
      result = { ok: false, error }
    }
    applyModel()
    try {
      await flush()
    } finally {
      for (const subscription of subscriptions) subscription.unsubscribe()
    }
    targets.forEach((on, position) => {
      if (JSON.stringify(rows(on)) !== before[position])
        expect(
          calls.get(on) ?? 0,
          `${label}: the throwing subscriber on ${on} ran`,
        ).toBeGreaterThan(0)
    })
    return { result, raised }
  }

  // A synchronous settlement releases the transaction in the recompute that
  // publishes it, so this runs before any promise turn as well as after. It
  // compares transactions by identity, because ids can repeat.
  const checkTracked = (label: string) => {
    for (const on of [`A`, `B`] as const) {
      const tracked = new Set(
        collections[on].collection._state.transactions.values(),
      )
      const expected = new Set(
        model.tracked(on).map((index) => driven[index]!.tx),
      )
      expect(
        tracked.size === expected.size &&
          [...tracked].every((tx) => expected.has(tx as never)),
        `${label}: ${on} tracks exactly the unsettled owners`,
      ).toBe(true)
    }
  }

  const check = (label: string) => {
    checkTracked(label)
    for (const on of [`A`, `B`] as const) {
      const { collection } = collections[on]
      for (const key of [1, 2] as const) {
        expect(collection.get(key)?.v, `${label}: ${on} row ${key}`).toBe(
          model.row(on, key),
        )
      }
      expect(collection.has(9), `${label}: ${on} merged-away row`).toBe(false)
    }
    for (const [index, entry] of driven.entries()) {
      const settled = !model.unsettled(model.transactions[index]!)
      expect(entry.settled, `${label}: tx ${index} settlement`).toBe(settled)
      if (settled)
        expect(
          entry.tx.collections.size,
          `${label}: settled tx ${index} tracks no Collection`,
        ).toBe(0)
    }
  }

  try {
    for (const [position, current] of steps.entries()) {
      const label = `step ${position} ${JSON.stringify(current)}`
      if (current.type === `open`) {
        if (driven.length === 4) continue
        const reuse =
          current.reuse !== undefined && driven.length > 0
            ? current.reuse % driven.length
            : undefined
        let outcome!: Driven[`outcome`]
        const tx = createTransaction<{ id: number; v: number }>({
          ...(reuse === undefined ? {} : { id: driven[reuse]!.tx.id }),
          autoCommit: false,
          mutationFn: () =>
            new Promise<void>((resolve, reject) => {
              outcome = { resolve, reject }
            }),
        })
        const entry: Driven = {
          tx,
          get outcome() {
            return outcome
          },
          settled: false,
        }
        settle(entry)
        driven.push(entry)
        model.open(
          reuse === undefined ? undefined : model.transactions[reuse]!.id,
        )
      } else {
        const states: ReadonlyArray<ModelState> =
          current.type === `edit` ||
          current.type === `cancel` ||
          current.type === `mutateThrows` ||
          current.type === `commit`
            ? [`pending`]
            : current.type === `settle`
              ? [`persisting`]
              : [`pending`, `persisting`]
        const index = model.pick(current.tx, states)
        if (index === undefined) continue
        const modelTx = model.transactions[index]!
        const entry = driven[index]!
        if (
          current.type === `edit` ||
          current.type === `cancel` ||
          current.type === `mutateThrows`
        ) {
          if (modelTx.state !== `pending`) continue
          // An update that leaves the visible row unchanged creates no
          // mutation, so the Collection does not take the transaction.
          if (
            current.type !== `cancel` &&
            model.row(current.on, current.key) === current.value
          )
            continue
          const target = collections[current.on].collection
          const callbackError = new Error(`callback failed`)
          let thrown: unknown
          try {
            entry.tx.mutate(() => {
              if (current.type === `cancel`) {
                target.insert({ id: 9, v: 1 })
                target.delete(9)
                return
              }
              target.update(current.key, (draft) => {
                draft.v = current.value
              })
              if (current.type === `mutateThrows`) throw callbackError
            })
          } catch (error) {
            thrown = error
          }
          if (model.duplicate(index, current.on)) {
            // A second unsettled transaction with a tracked id changes nothing.
            expect(thrown, `${label}: duplicate id rejected`).toBeInstanceOf(
              DuplicateTransactionIdError,
            )
            continue
          }
          if (current.type === `mutateThrows`) {
            expect(thrown, `${label}: callback error rethrown`).toBe(
              callbackError,
            )
          } else {
            expect(thrown, `${label}: mutate succeeds`).toBeUndefined()
          }
          modelTx.owners.add(current.on)
          if (current.type === `edit`)
            modelTx.writes.set(`${current.on}:${current.key}`, current.value)
        } else if (current.type === `commit`) {
          if (modelTx.state !== `pending`) continue
          entry.tx.commit().then(
            () => (entry.commitResult = { ok: true }),
            (error: unknown) => (entry.commitResult = { ok: false, error }),
          )
          modelTx.state = modelTx.writes.size === 0 ? `completed` : `persisting`
        } else if (current.type === `settle`) {
          if (modelTx.state !== `persisting`) continue
          const mutationError = current.ok ? undefined : new Error(`rejected`)
          const { raised } = await withThrowingSubscribers(
            label,
            current.throwOn,
            () => {
              if (mutationError) entry.outcome.reject(mutationError)
              else entry.outcome.resolve()
            },
            () => {
              if (current.ok) modelTx.state = `completed`
              else model.fail(index)
            },
          )
          expectErrorShape(
            `${label} commit`,
            entry.commitResult ?? { ok: false, error: `commit unsettled` },
            raised,
            mutationError,
          )
        } else if (current.type === `rollback`) {
          if (!model.unsettled(modelTx)) continue
          let sameCall = true
          const { result, raised } = await withThrowingSubscribers(
            label,
            current.throwOn,
            () => entry.tx.rollback(),
            () => {
              model.fail(index)
              // A rollback settles synchronously, before any promise turn.
              if (sameCall) checkTracked(`${label} (same call)`)
              sameCall = false
            },
          )
          expectErrorShape(`${label} rollback`, result, raised)
        } else {
          if (!model.unsettled(modelTx)) continue
          const target = collections[current.on]
          const stop = target.collection.on(`truncate`, () => {
            if (entry.tx.state === `pending` || entry.tx.state === `persisting`)
              entry.tx.rollback()
          })
          try {
            target.utils.begin()
            target.utils.truncate()
            target.writeBase()
            target.utils.commit()
          } finally {
            stop()
          }
          model.fail(index)
        }
      }
      if (current.type === `truncateRollback` || current.type === `commit`)
        checkTracked(`${label} (same call)`)
      await flush()
      check(label)
    }
  } finally {
    for (const entry of driven) {
      if (entry.tx.state === `persisting`) entry.outcome.resolve()
    }
    await flush()
    await collections.A.collection.cleanup()
    await collections.B.collection.cleanup()
  }
}

const history = fc.array(step, { minLength: 1, maxLength: 24 })

describe(`settled transactions leave every Collection that tracked them`, () => {
  it(`generated histories with a fixed seed`, async () => {
    await fc.assert(
      fc.asyncProperty(history, (steps) => runHistory(steps)),
      { numRuns: oracleRuns(200), seed: 2080 },
    )
  }, 300_000)

  it(`generated histories with a random or replayed seed`, async () => {
    await fc.assert(
      fc.asyncProperty(history, (steps) => runHistory(steps)),
      oraclePropertyOptions(200, PROPERTY),
    )
  }, 300_000)

  it(`pinned: a subscriber throws during an asynchronous success and failure settlement`, async () => {
    await runHistory([
      { type: `open`, reuse: undefined },
      { type: `edit`, tx: 0, on: `A`, key: 1, value: 3 },
      { type: `edit`, tx: 0, on: `B`, key: 1, value: 3 },
      { type: `commit`, tx: 0 },
      { type: `settle`, tx: 0, ok: true, throwOn: `A` },
      { type: `open`, reuse: undefined },
      { type: `edit`, tx: 0, on: `A`, key: 2, value: 4 },
      { type: `edit`, tx: 0, on: `B`, key: 2, value: 4 },
      { type: `commit`, tx: 0 },
      { type: `settle`, tx: 0, ok: false, throwOn: `A` },
    ])
  })

  it(`pinned: a merged-away pair, a conflicting rollback that throws, and a truncate rollback`, async () => {
    await runHistory([
      { type: `open`, reuse: undefined },
      { type: `cancel`, tx: 0, on: `A` },
      { type: `commit`, tx: 0 },
      { type: `open`, reuse: undefined },
      { type: `edit`, tx: 1, on: `A`, key: 1, value: 3 },
      { type: `edit`, tx: 1, on: `B`, key: 1, value: 3 },
      { type: `open`, reuse: undefined },
      // Choices index the eligible transactions: pending 1 and 2 here.
      { type: `edit`, tx: 1, on: `A`, key: 1, value: 4 },
      { type: `rollback`, tx: 0, throwOn: `A` },
      { type: `open`, reuse: undefined },
      { type: `edit`, tx: 3, on: `B`, key: 2, value: 5 },
      { type: `truncateRollback`, tx: 3, on: `B` },
    ])
  })

  it(`pinned: a rolled-back transaction does not remove a live one that shares its id`, async () => {
    await runHistory([
      { type: `open`, reuse: undefined },
      { type: `edit`, tx: 0, on: `A`, key: 1, value: 5 },
      { type: `open`, reuse: 0 },
      // Choices index the eligible transactions: pending 0 and 1 here.
      { type: `edit`, tx: 1, on: `B`, key: 1, value: 6 },
      { type: `rollback`, tx: 1, throwOn: undefined },
      { type: `open`, reuse: undefined },
      // Pending 0 and 2: the rollback of 2 also rolls back 0, which shares A1.
      { type: `edit`, tx: 1, on: `A`, key: 1, value: 7 },
      { type: `rollback`, tx: 1, throwOn: undefined },
    ])
  })

  it(`pinned: a second live transaction with a tracked id is rejected`, async () => {
    await runHistory([
      { type: `open`, reuse: undefined },
      { type: `edit`, tx: 0, on: `A`, key: 1, value: 5 },
      { type: `open`, reuse: 0 },
      { type: `edit`, tx: 1, on: `A`, key: 2, value: 6 },
    ])
  })

  it(`pinned: conflicting rollbacks that throw settle every transaction and rethrow one subscriber error`, async () => {
    await runHistory([
      { type: `open`, reuse: undefined },
      { type: `edit`, tx: 0, on: `A`, key: 1, value: 5 },
      { type: `open`, reuse: undefined },
      { type: `edit`, tx: 1, on: `A`, key: 1, value: 6 },
      { type: `edit`, tx: 1, on: `A`, key: 2, value: 6 },
      { type: `open`, reuse: undefined },
      { type: `edit`, tx: 2, on: `A`, key: 1, value: 7 },
      { type: `edit`, tx: 2, on: `B`, key: 2, value: 7 },
      { type: `rollback`, tx: 0, throwOn: `both` },
    ])
  })

  it(`pinned: a failed commit whose rollback subscriber throws keeps the mutation error`, async () => {
    await runHistory([
      { type: `open`, reuse: undefined },
      { type: `edit`, tx: 0, on: `A`, key: 1, value: 5 },
      { type: `commit`, tx: 0 },
      { type: `settle`, tx: 0, ok: false, throwOn: `A` },
    ])
  })
})
