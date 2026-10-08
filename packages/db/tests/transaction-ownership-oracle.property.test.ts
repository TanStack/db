import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import { createCollection } from '../src/collection/index.js'
import { createTransaction } from '../src/transactions.js'
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
 * - A settled transaction's `isPersisted` has settled.
 *
 * The grammar opens up to four manual transactions over Collections A and B
 * (keys 1 and 2). Steps write a value, write and remove key 9 in one call
 * (a pair that merges away), commit, settle a commit as success or failure,
 * roll back, and roll back from a `truncate` listener during a sync commit.
 * A settling step may install a throwing subscriber on one Collection for
 * that step only.
 *
 * After a synchronous settling step (commit, rollback, truncate rollback) the
 * driver first compares the tracked ids in the same call stack. After each
 * step it then flushes promises and compares, for each
 * Collection, the tracked transaction ids with the model's set, the rows of
 * keys 1, 2 and 9 with the model's overlay, and each transaction's
 * `isPersisted` settlement with the model's state. The tracked ids come from
 * `_state.transactions`, because no public API exposes them; the rows and
 * settlement are public.
 *
 * Out of scope: queued sync transactions that hold a completed row (owned by
 * the optimistic-history oracle), offline restoration (owned by the
 * offline-transactions witnesses), and two Collection instances that share an
 * id (a focused witness in `collection.test.ts`).
 */

const PROPERTY = `transaction-ownership.settlement-release`

type CollectionName = `A` | `B`
type Key = 1 | 2
type Step =
  | { type: `open` }
  | { type: `edit`; tx: number; on: CollectionName; key: Key; value: number }
  | { type: `cancel`; tx: number; on: CollectionName }
  | { type: `commit`; tx: number }
  | {
      type: `settle`
      tx: number
      ok: boolean
      throwOn: CollectionName | undefined
    }
  | { type: `rollback`; tx: number; throwOn: CollectionName | undefined }
  | { type: `truncateRollback`; tx: number; on: CollectionName }

type ModelState = `pending` | `persisting` | `completed` | `failed`
type ModelTx = {
  state: ModelState
  owners: Set<CollectionName>
  writes: Map<`${CollectionName}:${Key}`, number>
}

class OwnershipModel {
  transactions: Array<ModelTx> = []

  open(): void {
    this.transactions.push({
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

  row(on: CollectionName, key: Key): number {
    let value = 0
    for (const tx of this.transactions) {
      if (!this.unsettled(tx)) continue
      value = tx.writes.get(`${on}:${key}`) ?? value
    }
    return value
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
const throwOn = fc.option(name, { nil: undefined, freq: 3 })
const step: fc.Arbitrary<Step> = fc.oneof(
  { weight: 2, arbitrary: fc.constant({ type: `open` as const }) },
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
    weight: 2,
    arbitrary: fc.record({ type: fc.constant(`commit` as const), tx: txIndex }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      type: fc.constant(`settle` as const),
      tx: txIndex,
      ok: fc.boolean(),
      throwOn,
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      type: fc.constant(`rollback` as const),
      tx: txIndex,
      throwOn,
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
)

const flush = async () => {
  for (let index = 0; index < 4; index++)
    await new Promise((resolve) => setTimeout(resolve, 0))
}

type Driven = {
  tx: Transaction<{ id: number; v: number }>
  outcome: { resolve: () => void; reject: (error: Error) => void }
  settled: boolean
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
  const withThrowingSubscriber = (
    on: CollectionName | undefined,
    run: () => void,
  ) => {
    const subscription = on
      ? collections[on].collection.subscribeChanges(() => {
          throw new Error(`subscriber failed`)
        })
      : undefined
    try {
      run()
    } catch {
      // A throwing subscriber surfaces here. The law is that settlement still
      // completes, which the checks below observe.
    } finally {
      subscription?.unsubscribe()
    }
  }

  // A synchronous settlement releases the transaction in the recompute that
  // publishes it, so this runs before any promise turn as well as after.
  const checkTracked = (label: string) => {
    for (const on of [`A`, `B`] as const) {
      const tracked = [
        ...collections[on].collection._state.transactions.keys(),
      ].sort()
      const expected = model
        .tracked(on)
        .map((index) => driven[index]!.tx.id)
        .sort()
      expect(tracked, `${label}: ${on} tracks the unsettled owners`).toEqual(
        expected,
      )
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
      expect(entry.settled, `${label}: tx ${index} settlement`).toBe(
        !model.unsettled(model.transactions[index]!),
      )
    }
  }

  try {
    for (const [position, current] of steps.entries()) {
      const label = `step ${position} ${JSON.stringify(current)}`
      if (current.type === `open`) {
        if (driven.length === 4) continue
        let outcome!: Driven[`outcome`]
        const tx = createTransaction<{ id: number; v: number }>({
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
        model.open()
      } else {
        const modelTx = model.transactions[current.tx]
        const entry = driven[current.tx]
        if (!modelTx || !entry) continue
        if (current.type === `edit`) {
          if (modelTx.state !== `pending`) continue
          // An update that leaves the visible row unchanged creates no
          // mutation, so the Collection does not take the transaction.
          if (model.row(current.on, current.key) === current.value) continue
          entry.tx.mutate(() =>
            collections[current.on].collection.update(current.key, (draft) => {
              draft.v = current.value
            }),
          )
          modelTx.owners.add(current.on)
          modelTx.writes.set(`${current.on}:${current.key}`, current.value)
        } else if (current.type === `cancel`) {
          if (modelTx.state !== `pending`) continue
          entry.tx.mutate(() => {
            collections[current.on].collection.insert({ id: 9, v: 1 })
            collections[current.on].collection.delete(9)
          })
          modelTx.owners.add(current.on)
        } else if (current.type === `commit`) {
          if (modelTx.state !== `pending`) continue
          entry.tx.commit().catch(() => undefined)
          modelTx.state = modelTx.writes.size === 0 ? `completed` : `persisting`
        } else if (current.type === `settle`) {
          if (modelTx.state !== `persisting`) continue
          withThrowingSubscriber(current.throwOn, () => {
            if (current.ok) entry.outcome.resolve()
            else entry.outcome.reject(new Error(`rejected`))
          })
          if (current.ok) modelTx.state = `completed`
          else model.fail(current.tx)
        } else if (current.type === `rollback`) {
          if (!model.unsettled(modelTx)) continue
          withThrowingSubscriber(current.throwOn, () => entry.tx.rollback())
          model.fail(current.tx)
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
          model.fail(current.tx)
        }
      }
      if (
        current.type === `rollback` ||
        current.type === `truncateRollback` ||
        current.type === `commit`
      )
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
  it(`generated histories with fixed seed 2080`, async () => {
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

  it(`pinned: a merged-away pair, a conflicting rollback that throws, and a truncate rollback`, async () => {
    await runHistory([
      { type: `open` },
      { type: `cancel`, tx: 0, on: `A` },
      { type: `commit`, tx: 0 },
      { type: `open` },
      { type: `edit`, tx: 1, on: `A`, key: 1, value: 3 },
      { type: `edit`, tx: 1, on: `B`, key: 1, value: 3 },
      { type: `open` },
      { type: `edit`, tx: 2, on: `A`, key: 1, value: 4 },
      { type: `rollback`, tx: 1, throwOn: `A` },
      { type: `open` },
      { type: `edit`, tx: 3, on: `B`, key: 2, value: 5 },
      { type: `truncateRollback`, tx: 3, on: `B` },
    ])
  })
})
