import { isDeepStrictEqual } from 'node:util'
import { fc } from '@fast-check/vitest'
import { expect } from 'vitest'
import { z } from 'zod'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { createLiveQueryCollection } from '../src/query/index.js'
import { whenSyncAccepted } from '../src/sync-receipt.js'
import { createTransaction } from '../src/transactions.js'
import { declareOracle } from './oracle-declaration.js'
import type { CollectionConfig, SyncConfig } from '../src/types.js'

/**
 * # Which rows do optimistic and sync histories expose?
 *
 * An optimistic mutation is visible in the tick that makes it. While its
 * mutation function runs, an optimistic transaction overlays its optimistic
 * state on the applied synced rows. When the mutation function
 * settles, the transaction's optimistic state drops. Success does not wait
 * for a sync confirmation: a handler that returns before the server row
 * arrives exposes the previous synced row until that row applies. Failure
 * drops the optimistic state in the same way.
 *
 * A sync transaction committed while an optimistic transaction is persisting
 * is accepted and queued. A sync transaction has two moments: accepted, when
 * `commit()` returns (or a wrapping sync finishes its durable step), and
 * visible, when it applies and publishes. Handler-facing writes wait for
 * acceptance, so a mutation handler may write, and await, its own server row.
 * Commit receipts, subset loads, and readiness wait for visibility. A handler
 * that awaits a visibility receipt held by its own transaction, such as an
 * on-demand load of its own Collection, waits for itself and never returns.
 * Queued sync transactions apply when no optimistic transaction is
 * persisting, in the same publication that drops the settling transaction's
 * optimistic state. A successful transaction's optimistic row is held only
 * while a committed sync transaction that has not applied touches its key, so
 * that drop and that sync transaction publish together. Such a transaction is
 * queued in the Collection, or deferred: a wrapping sync, such as
 * persistence, has not handed it to the Collection because an earlier durable
 * step is still running. A deferred transaction keeps the row held through
 * drains of the queue ahead of it. It is not accepted yet, so it can still
 * abort: the wrapping sync discards it at its turn, and every hold and
 * unconsumed attribution it alone kept ends in that publication. With one local mutation and no truncate, the
 * first queued same-key source transaction consumes local attribution at
 * settlement, even if a peer supplied it. Every same-key write in that atomic
 * transaction keeps that attribution. A later transaction is `'remote'`
 * without another local owner. A failed mutation gives queued source writes no
 * local attribution. `when('settled')` settles after that publication.
 * A truncate applies at once, with every queued sync transaction before it.
 * Its same-key source row can receive local attribution while a mutation still
 * persists, even if that mutation later fails. Still-persisting transactions
 * overlay the replacement. The truncate consumes active attribution for keys
 * it writes, but an active mutation on an untouched key still attributes its
 * first later source transaction, even when both transactions share a drain.
 * Completed one-use attribution ends at the truncate. A later transaction on
 * that key in the same drain is remote without another local owner.
 *
 * The reference model has three small parts: the applied synced rows, an
 * ordered list of optimistic transactions with one mutation each, and a queue
 * of accepted sync transactions. `visible()` folds held completed
 * transactions, then pending and persisting ones, over the applied rows.
 * It does not reuse production caches, pending-mutation mergers, or
 * publication code. Model
 * alignment: `transactions` are optimistic transactions, `queue` holds
 * sync transactions the Collection has taken, `deferred` holds committed sync
 * transactions waiting behind a wrapping sync's held durable step, and `base`
 * is the applied synced rows. `deferred` is model vocabulary; core reaches it
 * only through a wrapping sync, so the core lane never enters it. `held` is
 * a model-only flag for the hold described above: it is set when a
 * transaction completes while a queued sync transaction touches its key, and
 * the drain that applies that queue clears it.
 *
 * A sync transaction still open when a transaction settles is not accepted:
 * it holds no completed row and attributes nothing. If it later commits, its
 * writes are `'remote'` unless another active local transaction touches their
 * key; if it aborts, its writes never apply, and both its receipt and its acceptance
 * moment (`whenSyncAccepted`) reject.
 * External completion, used when work was applied outside commit, admits only
 * pending transactions. A completion attempt in persisting, completed or failed
 * state rejects and preserves the state, settlement verdict and visible rows.
 * Authority: commit admission and terminal request outcomes in the public
 * transaction contract; the internal completion path cannot revoke them.
 *
 * A manual local transaction can remain pending before its mutation function
 * starts. Source writes on its key apply at once and receive local attribution;
 * rolling it back exposes that source row with the same origin. A pending
 * manual transaction starts its mutation function at commit. If that function
 * rejects, the transaction rolls back and `when('settled')` rejects with its
 * reason. A later edit cannot determine the earlier manual request's outcome.
 * The model keeps pending distinct from persisting because the same source
 * commit publishes immediately in the former state and waits in the latter.
 * A failed same-key edit that cascades also rolls back a pending manual peer.
 * A persisting or different-key peer keeps its own settlement. Handler rejection
 * cascades; an explicit rollback can request a secondary rollback without it.
 * Ordinary source batches write rows before deletes. The ordered-operations
 * lane also permits a delete and reinsert of one key in the same transaction.
 * Its `row` action combines source insert and update; the production driver
 * resolves that kind against source membership before invoking sync writes.
 * A reentrant history commits a truncate and its suffix from a subscriber
 * while an earlier truncate publishes. Core applies that suffix in one drain.
 *
 * A mutation handler can write a sync transaction before it returns, and can
 * await that write's acceptance. It is the same event as a sync transaction
 * written while the transaction persists: it waits for settlement unless it
 * is a truncate.
 *
 * The source may delete a key it does not hold, for example after its backend
 * accepted an optimistic insert and deleted the row before the source streamed
 * it. The delete removes no applied synced row and acknowledges no request.
 * Committed while the transaction persists, or inside its handler, it is
 * queued like any sync transaction: the completed row is held, and the drop
 * and the delete publish together, so the row is gone after settlement. Once
 * the optimistic state has dropped, the delete changes no visible row. A
 * persisting transaction keeps its optimistic row, even beneath a truncate
 * that carries the delete.
 *
 * A history can also keep the default `partial` row update mode. There a
 * source update may omit `c`, and the Collection merges the update into the
 * source row, so the held `c` remains. The model applies the same merge to its
 * base. Other histories use `full` mode and always write whole rows.
 *
 * A settled transaction leaves the Collection's tracked transactions, whether
 * it succeeded or failed. Every per-mutation pass walks them, so the
 * Collection tracks exactly its unsettled transactions. A completed row that a
 * queued sync transaction still holds lives in the held-row layer, which the
 * transaction does not need to stay tracked for.
 *
 * `runOptimisticHistory` gives the same edit, delete, settle, and sync history
 * to this model and a real Collection. A `WrappingSyncLane` runs the same
 * history through a wrapping sync, adds `hold-store` and `release-store`
 * steps, and lets the wrapping sync settle before each comparison. Right after
 * each optimistic mutation call, before any await, the driver checks that the
 * row is already visible. After every step it compares rows,
 * metadata, immutable handler payloads, promise outcomes, the rows visible
 * when the settlement waiter fulfills, downstream query state, and complete
 * publication cuts. A second subscriber starts without initial state, so no
 * sent-key filter can hide an invalid message. Each of its batches must be
 * valid for its replica: an insert names an absent key, and an update or
 * delete names a present one. Wrong-answer mutants prove these observations
 * reject wrong keys, partial batches, stale previous values, and transient
 * fields.
 */

export type HistoryRow = { id: number; a: number; b: number; c: number }
type Fields = Partial<Omit<HistoryRow, `id`>>
type SourceOperation =
  { type: `row`; row: HistoryRow } | { type: `delete`; key: number }
type SourceBatch = {
  type: `sync`
  rows: Array<HistoryRow>
  // Keys the source deletes after writing its rows, held or not.
  deletes?: Array<number> | undefined
  // Overrides rows/deletes when a source transaction needs mixed write order.
  operations?: Array<SourceOperation> | undefined
  truncate: boolean
  copies: number
  // In the partial-update lane, the source's updates omit `c`.
  partial?: boolean | undefined
}
// A transaction with no operation and no truncate has no durable write.
function writes(batch: SourceBatch): boolean {
  return batch.truncate || sourceOperations(batch).length > 0
}
function sourceOperations(batch: SourceBatch): Array<SourceOperation> {
  if (batch.operations) return batch.operations
  const operations: Array<SourceOperation> = []
  for (let copy = 0; copy < batch.copies; copy++)
    for (const row of batch.rows) operations.push({ type: `row`, row })
  for (const key of batch.deletes ?? [])
    operations.push({ type: `delete`, key })
  return operations
}
// A sync transaction the mutation handler writes before it returns. With
// `awaitReceipt`, the handler awaits the write's acceptance before returning.
type HandlerBatch = SourceBatch & { awaitReceipt?: boolean }
export type OptimisticStep =
  | {
      type: `edit`
      key: number
      fields: Fields
      optimistic: boolean
      pending?: boolean
      inHandler?: HandlerBatch | undefined
    }
  | {
      type: `delete`
      key: number
      optimistic: boolean
      inHandler?: HandlerBatch | undefined
    }
  | {
      type: `settle`
      slot: number
      success: boolean
      cascade: boolean
      failure?: `rollback` | `reject`
    }
  // External completion never runs a handler and admits only pending work.
  | { type: `complete`; slot: number }
  | SourceBatch
  // A sync transaction that begins and writes now but commits or aborts at its
  // `close` step. While it is open, other sync batches are skipped, because the
  // sync API writes to the most recent open transaction.
  | { type: `open`; batch: SourceBatch }
  | { type: `close`; commit: boolean }
  // The trigger publishes first; its subscriber commits all later batches
  // while core is still draining. A truncate in the suffix releases them as
  // one subsequent drain, preserving their source order.
  | { type: `reentrant`; trigger: SourceBatch; batches: Array<SourceBatch> }
  // Durable writes run one at a time. `hold-store` holds the next one until
  // `release-store`; every later durable write waits behind it.
  | { type: `hold-store` }
  | { type: `release-store` }
  // The source aborts one deferred transaction's signal. It never applies;
  // the wrapping sync discards it when its turn comes.
  | { type: `abort-deferred`; slot: number }

type ModelTransaction = {
  key: number
  kind: `insert` | `update` | `delete`
  row: HistoryRow
  optimistic: boolean
  state: `pending` | `persisting` | `completed` | `failed`
  // Settled while a queued sync transaction touched its key. The drain that
  // applies that queue ends the hold.
  held: boolean
  // The first queued same-key source transaction can consume local attribution.
  originPending: boolean
}
type ObservedRow = HistoryRow & {
  $origin: `local` | `remote`
  $hasPendingWrites: boolean
}

/** Pure event-history model. It never reads production caches or callbacks. */
class HistoryModel {
  base = new Map<number, HistoryRow>()
  origins = new Map<number, `local` | `remote`>()
  transactions: Array<ModelTransaction> = []
  queue: Array<SourceBatch> = []
  // Committed by the source, not yet in the Collection: a wrapping sync's
  // held durable step is ahead of them. They reach `queue` in commit order.
  deferred: Array<SourceBatch> = []
  holdNext = false
  // This Collection's own commit is waiting for the held write, so its later
  // commits are deferred.
  storeHeld = false
  // Drains that kept a settled row held for a deferred transaction. Only a
  // wrapping sync reaches this state.
  deferredHoldsAcrossDrain = 0
  // Deferred transactions whose signal was aborted before their turn.
  aborted = new Set<SourceBatch>()
  // Discarded aborted transactions that released a settled row's hold.
  abortReleases = 0
  // Of those, releases of attribution no source transaction had consumed.
  abortAttributionReleases = 0

  constructor(
    rows: Array<HistoryRow>,
    private insertDefault = 0,
    private partialUpdates = false,
  ) {
    for (const row of rows) {
      this.base.set(row.id, row)
      this.origins.set(row.id, `remote`)
    }
  }

  private keysOf(batches: ReadonlyArray<SourceBatch>) {
    return new Set(
      batches.flatMap((batch) => [
        ...sourceOperations(batch).map((operation) =>
          operation.type === `row` ? operation.row.id : operation.key,
        ),
      ]),
    )
  }

  // Keys of committed sync transactions that have not applied yet, whether
  // they are queued in the Collection or deferred behind a durable step.
  private committedKeys() {
    return this.keysOf([...this.queue, ...this.deferred])
  }

  private persisting() {
    return this.transactions.some((entry) => entry.state === `persisting`)
  }

  visible(): Map<number, ObservedRow> {
    const result = new Map<number, ObservedRow>(
      [...this.base].map(([key, row]) => [
        key,
        {
          ...row,
          $origin: this.origins.get(key)!,
          $hasPendingWrites: false,
        },
      ]),
    )
    const overlay = [
      ...this.transactions.filter((entry) => entry.held),
      ...this.transactions.filter(
        (entry) => entry.state === `pending` || entry.state === `persisting`,
      ),
    ]
    for (const transaction of overlay) {
      if (!transaction.optimistic) continue
      if (transaction.kind === `delete`) {
        result.delete(transaction.key)
        continue
      }
      result.set(transaction.key, {
        ...transaction.row,
        $origin: `local`,
        $hasPendingWrites: true,
      })
    }
    return result
  }

  author(
    step: Extract<OptimisticStep, { type: `edit` | `delete` }>,
  ): number | undefined {
    const row = this.visible().get(step.key)
    if (step.type === `delete` && !row) return
    if (
      step.type === `edit` &&
      row &&
      Object.entries(step.fields).every(
        ([key, value]) => row[key as keyof Fields] === value,
      )
    )
      return
    this.transactions.push({
      key: step.key,
      kind: step.type === `delete` ? `delete` : row ? `update` : `insert`,
      row: {
        ...(row ?? { id: step.key, a: 0, b: 0, c: this.insertDefault }),
        ...(step.type === `edit` ? step.fields : {}),
      },
      optimistic: step.optimistic,
      state: step.type === `edit` && step.pending ? `pending` : `persisting`,
      held: false,
      originPending: false,
    })
    return this.transactions.length - 1
  }

  settle(index: number, success: boolean, cascade: boolean): Array<number> {
    const transaction = this.transactions[index]!
    transaction.state = success ? `completed` : `failed`
    transaction.held = success && this.committedKeys().has(transaction.key)
    // A successful mutation grants one queued same-key source transaction
    // local attribution when that transaction is held at this boundary.
    transaction.originPending = transaction.held
    // This one-Collection model uses key equality for the public same-key
    // conflict rule. Only pending peers can be canceled by a failed request.
    const canceled: Array<number> = []
    if (!success && cascade) {
      for (const [peerIndex, peer] of this.transactions.entries()) {
        if (
          peerIndex !== index &&
          peer.state === `pending` &&
          peer.key === transaction.key
        ) {
          peer.state = `failed`
          canceled.push(peerIndex)
        }
      }
    }
    if (!this.persisting()) this.drain()
    return canceled
  }

  sync(step: SourceBatch) {
    if (this.storeHeld) {
      this.deferred.push(step)
      return
    }
    // The durable step follows the Collection's acceptance of this
    // transaction, so the transaction itself is queued or applied as usual.
    // When that step waits for a held write, later commits are deferred.
    if (writes(step) && this.holdNext) {
      this.holdNext = false
      this.storeHeld = true
    }
    this.arrive(step)
  }

  private arrive(step: SourceBatch) {
    this.queue.push(step)
    if (step.truncate || !this.persisting()) this.drain()
  }

  holdStore() {
    if (!this.storeHeld) this.holdNext = true
  }

  // Only a deferred transaction can abort: a queued one was accepted and
  // always applies. Returns the aborted transaction, if any.
  abortDeferred(slot: number): SourceBatch | undefined {
    const live = this.deferred.filter((step) => !this.aborted.has(step))
    if (!live.length) return undefined
    const step = live[slot % live.length]!
    this.aborted.add(step)
    return step
  }

  // Deferred transactions reach the Collection one at a time, in commit
  // order. An aborted one is discarded at its turn instead, and every hold it
  // alone kept ends in that publication. `applied` observes the visible rows
  // after each one.
  releaseStore(applied: () => void) {
    this.holdNext = false
    this.storeHeld = false
    while (this.deferred.length) {
      const step = this.deferred.shift()!
      if (this.aborted.has(step)) this.discard()
      else this.arrive(step)
      applied()
    }
  }

  // A settled row, and its unconsumed attribution, is held only while a
  // committed sync transaction that has not applied touches its key.
  private discard() {
    const keys = this.committedKeys()
    for (const transaction of this.transactions) {
      if (!transaction.held || keys.has(transaction.key)) continue
      if (transaction.originPending) this.abortAttributionReleases++
      transaction.held = false
      transaction.originPending = false
      this.abortReleases++
    }
  }

  syncTogether(batches: ReadonlyArray<SourceBatch>) {
    this.queue.push(...batches)
    if (batches.some((batch) => batch.truncate) || !this.persisting())
      this.drain()
  }

  private drain() {
    // A truncate can drain before a mutation settles. Active keys survive it
    // until a source operation touches them, regardless of later settlement.
    const activeKeys = new Set(
      this.transactions
        .filter(
          (entry) => entry.state === `pending` || entry.state === `persisting`,
        )
        .map((entry) => entry.key),
    )
    const attributed = new Set(
      this.transactions
        .filter((entry) => entry.originPending)
        .map((entry) => entry.key),
    )
    for (const batch of this.queue) {
      // One atomic source transaction has one attribution per key. Snapshot
      // ownership at its start, then consume it for later transactions only.
      // Repeated writes within this batch retain the same attribution. A
      // truncate ends completed one-use attribution, including for its own
      // writes; only active keys attribute them. Core applies a truncate at
      // once, so only a deferred truncate can meet completed attribution.
      const batchLocalKeys = new Set([
        ...(batch.truncate ? [] : attributed),
        ...activeKeys,
      ])
      if (batch.truncate) {
        this.base.clear()
        this.origins.clear()
      }
      for (const operation of sourceOperations(batch)) {
        if (operation.type === `delete`) {
          // A source delete removes the applied row and ends attribution for
          // later transactions, but this atomic batch keeps its snapshot.
          this.base.delete(operation.key)
          this.origins.delete(operation.key)
          attributed.delete(operation.key)
          activeKeys.delete(operation.key)
          continue
        }
        const { row } = operation
        const local = batchLocalKeys.has(row.id)
        const held = this.base.get(row.id)
        // The default row update mode merges a partial update into the
        // source row, so an omitted `c` keeps the held value.
        this.base.set(
          row.id,
          this.partialUpdates && batch.partial && held
            ? { ...row, c: held.c }
            : row,
        )
        this.origins.set(row.id, local ? `local` : `remote`)
        attributed.delete(row.id)
        activeKeys.delete(row.id)
      }
      // Truncate ends completed one-use attribution. Active keys omitted by
      // its operations remain eligible for a later transaction in this drain.
      if (batch.truncate) attributed.clear()
    }
    // A deferred transaction on the key keeps the row held, and keeps an
    // unconsumed attribution for that transaction, until it applies.
    const deferredKeys = this.keysOf(this.deferred)
    for (const transaction of this.transactions) {
      const deferred = deferredKeys.has(transaction.key)
      if (transaction.held && deferred) this.deferredHoldsAcrossDrain++
      transaction.held = transaction.held && deferred
      transaction.originPending =
        transaction.originPending && deferred && attributed.has(transaction.key)
    }
    this.queue = []
  }
}

const plain = ({ id, a, b, c }: HistoryRow): HistoryRow => ({ id, a, b, c })
const observed = (
  row: HistoryRow & {
    $origin: `local` | `remote`
    $hasPendingWrites: boolean
  },
): ObservedRow => ({
  ...Object.fromEntries(
    Object.entries(row).filter(
      ([key]) => key !== `$key` && key !== `$collectionId`,
    ),
  ),
  id: row.id,
  a: row.a,
  b: row.b,
  c: row.c,
  $origin: row.$origin,
  $hasPendingWrites: row.$hasPendingWrites,
})
const sorted = <T extends HistoryRow>(rows: Iterable<T>) =>
  [...rows].sort((a, b) => a.id - b.id)

/** Validate native deltas before their kind/old value are lost to Map.set. */
export function expectHistoryEventSemantics<T>(
  before: ReadonlyMap<unknown, T>,
  changes: ReadonlyArray<{
    key: unknown
    type: string
    value: T
    previousValue?: T
  }>,
  label: string,
): void {
  const rows = new Map(before)
  for (const change of changes) {
    const message = `${label}: event semantics ${change.type} ${String(change.key)}`
    if (change.type === `insert`) {
      expect(rows.has(change.key), `${message}: absent old membership`).toBe(
        false,
      )
      rows.set(change.key, change.value)
    } else {
      expect(rows.has(change.key), `${message}: present old membership`).toBe(
        true,
      )
      const previous = rows.get(change.key)
      if (change.type === `update`) {
        expect(
          change.previousValue,
          `${message}: previous visible row`,
        ).toStrictEqual(previous)
        rows.set(change.key, change.value)
      } else {
        expect(change.type, message).toBe(`delete`)
        expect(change.value, `${message}: removed visible row`).toStrictEqual(
          previous,
        )
        rows.delete(change.key)
      }
    }
  }
}

export type HistoryOutcome<T> =
  | { status: `pending` }
  | { status: `fulfilled`; value: T }
  | { status: `rejected`; reason?: unknown }

export function observeHistoryPromise<T>(promise: Promise<T>) {
  let current: HistoryOutcome<T> = { status: `pending` }
  // Attach both handlers now, not during eventual teardown.
  const settled = promise.then(
    (value) => {
      current = { status: `fulfilled`, value }
    },
    (reason: unknown) => {
      current = { status: `rejected`, reason }
    },
  )
  return { read: () => current, settled }
}

export function expectHistoryOutcome<T>(
  actual: HistoryOutcome<T>,
  expected: HistoryOutcome<T>,
  label: string,
) {
  expect(actual.status, label).toBe(expected.status)
  if (actual.status === `fulfilled` && expected.status === `fulfilled`)
    expect(actual.value, label).toBe(expected.value)
  if (
    actual.status === `rejected` &&
    expected.status === `rejected` &&
    `reason` in expected
  )
    expect(actual.reason, label).toBe(expected.reason)
}

export async function withHistoryCleanup<T>(
  work: () => Promise<T>,
  cleanups: () => Array<() => unknown | Promise<unknown>>,
): Promise<T> {
  let result: T | undefined
  let failed = false
  let primary: unknown
  const errors: Array<unknown> = []
  try {
    result = await work()
  } catch (error) {
    failed = true
    primary = error
  }
  for (const cleanup of cleanups()) {
    try {
      await cleanup()
    } catch (error) {
      errors.push(error)
    }
  }
  if (failed && !errors.length) throw primary
  if (failed)
    throw new AggregateError(
      [primary, ...errors],
      `History and cleanup failed`,
      {
        cause: primary,
      },
    )
  if (errors.length === 1) throw errors[0]
  if (errors.length) throw new AggregateError(errors, `History cleanup failed`)
  return result as T
}

// The history grammar shared by every production path.
export const historyRow = fc.record({
  id: fc.integer({ min: 1, max: 3 }),
  a: fc.integer({ min: -2, max: 2 }),
  b: fc.integer({ min: -2, max: 2 }),
  c: fc.integer({ min: -2, max: 2 }),
})
const sourceBatch = fc.record({
  type: fc.constant(`sync` as const),
  rows: fc.uniqueArray(historyRow, {
    selector: (row) => row.id,
    maxLength: 3,
  }),
  // The source may also delete keys, including keys it does not hold.
  deletes: fc.oneof(
    { weight: 3, arbitrary: fc.constant([]) },
    {
      weight: 1,
      arbitrary: fc.uniqueArray(fc.integer({ min: 1, max: 3 }), {
        minLength: 1,
        maxLength: 2,
      }),
    },
  ),
  truncate: fc.boolean(),
  copies: fc.integer({ min: 1, max: 2 }),
})
// A mutation handler may write a source batch before it returns, and may
// await that batch's commit receipt.
const handlerSourceBatch = fc.oneof(
  { weight: 3, arbitrary: fc.constant(undefined) },
  {
    weight: 1,
    arbitrary: fc
      .tuple(sourceBatch, fc.boolean())
      .map(([batch, awaitReceipt]) => ({ ...batch, awaitReceipt })),
  },
)
export const optimisticStep: fc.Arbitrary<OptimisticStep> = fc.oneof(
  {
    weight: 2,
    arbitrary: fc.record({
      type: fc.constant(`delete` as const),
      key: fc.integer({ min: 1, max: 3 }),
      optimistic: fc.boolean(),
      inHandler: handlerSourceBatch,
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      type: fc.constant(`edit` as const),
      key: fc.integer({ min: 1, max: 3 }),
      fields: fc
        .record(
          {
            a: fc.integer({ min: -2, max: 2 }),
            b: fc.integer({ min: -2, max: 2 }),
            c: fc.integer({ min: -2, max: 2 }),
          },
          { requiredKeys: [] },
        )
        .filter((fields) => Object.keys(fields).length > 0),
      optimistic: fc.boolean(),
      inHandler: handlerSourceBatch,
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      type: fc.constant(`settle` as const),
      slot: fc.nat(5),
      success: fc.boolean(),
      cascade: fc.boolean(),
    }),
  },
  { weight: 3, arbitrary: sourceBatch },
  // A sync transaction can still be open when an optimistic transaction
  // settles, then commit or abort later.
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant(`open` as const),
      batch: sourceBatch,
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant(`close` as const),
      commit: fc.boolean(),
    }),
  },
)
export const optimisticHistory = fc.record({
  initial: fc.uniqueArray(historyRow, {
    selector: (row) => row.id,
    maxLength: 3,
  }),
  steps: fc.array(optimisticStep, { minLength: 2, maxLength: 24 }),
})
// The core grammar plus store steps. While a hold is outstanding, an
// in-handler batch does not await acceptance.
// A deferred transaction's signal aborts before its turn.
const abortStep: fc.Arbitrary<OptimisticStep> = fc
  .nat(3)
  .map((slot) => ({ type: `abort-deferred` as const, slot }))
// Holds outnumber releases, so a hold often spans several settlements.
const storeStep: fc.Arbitrary<OptimisticStep> = fc.constantFrom(
  { type: `hold-store` as const },
  { type: `hold-store` as const },
  { type: `release-store` as const },
)
function excludeHeldAcceptance(
  steps: Array<OptimisticStep>,
): Array<OptimisticStep> {
  let holding = false
  return steps.map((step) => {
    if (step.type === `hold-store`) holding = true
    if (step.type === `release-store`) holding = false
    if (
      holding &&
      (step.type === `edit` || step.type === `delete`) &&
      step.inHandler?.awaitReceipt
    )
      return { ...step, inHandler: { ...step.inHandler, awaitReceipt: false } }
    return step
  })
}
// A handler that commits its own key's server row and returns at once, the
// way a source acknowledges a write when it commits it. The shared grammar's
// handler batches rarely write their own key.
const acknowledgedEdit: fc.Arbitrary<OptimisticStep> = fc
  .tuple(historyRow, fc.boolean(), fc.boolean())
  .map(([row, isDelete, optimistic]) =>
    isDelete
      ? {
          type: `delete` as const,
          key: row.id,
          optimistic,
          inHandler: {
            type: `sync` as const,
            rows: [],
            deletes: [row.id],
            truncate: false,
            copies: 1,
          },
        }
      : {
          type: `edit` as const,
          key: row.id,
          fields: { a: row.a, b: row.b, c: row.c },
          optimistic,
          inHandler: {
            type: `sync` as const,
            rows: [row],
            truncate: false,
            copies: 1,
          },
        },
  )
const settleAll: Array<OptimisticStep> = Array.from({ length: 24 }, () => ({
  type: `settle` as const,
  slot: 0,
  success: true,
  cascade: false,
}))
// After every hold has ended, one later source transaction writes every key.
// A key that kept attribution or a hold it no longer owns shows it here.
const observeEveryKey: Array<OptimisticStep> = [
  { type: `release-store` },
  {
    type: `sync`,
    rows: [1, 2, 3].map((id) => ({ id, a: 9, b: 9, c: 9 })),
    truncate: false,
    copies: 1,
  },
]
/**
 * The grammar for a wrapping-sync lane: the core grammar plus held durable
 * writes and acknowledged edits.
 */
export const wrappingSyncHistory = fc.record({
  initial: fc.uniqueArray(historyRow, {
    selector: (row) => row.id,
    maxLength: 3,
  }),
  steps: fc
    .array(
      fc.oneof(
        { weight: 6, arbitrary: optimisticStep },
        { weight: 4, arbitrary: acknowledgedEdit },
        { weight: 2, arbitrary: storeStep },
        { weight: 4, arbitrary: abortStep },
      ),
      { minLength: 2, maxLength: 24 },
    )
    // Settle every outstanding transaction before the release, so an
    // outstanding hold meets a drain. A settle with nothing active is skipped.
    // Then observe every key through one later source transaction.
    .map((steps) => [
      ...excludeHeldAcceptance(steps),
      ...settleAll,
      ...observeEveryKey,
    ]),
})

/**
 * A production path that puts a wrapping sync, such as persistence, between
 * the source and the Collection. The model's laws do not change. A wrapping
 * sync may take its own turns, so the driver lets it settle before each
 * comparison. It can also hold a durable step, which is the only way this
 * grammar reaches the model's `deferred` state.
 */
export type WrappingSyncLane = {
  wrap: (config: CollectionConfig<HistoryRow>) => CollectionConfig<HistoryRow>
  // Hold the durable step of the next source transaction that writes.
  holdNextStore: () => void
  releaseStore: () => void
  // Resolve once the wrapping sync has no runnable work.
  settle: () => Promise<void>
  // The DB entry points the wrapping sync itself imports. One runtime must
  // hold one copy of DB, so the Collection is built from the same copy.
  db: HistoryDb
}

export type HistoryDb = {
  createCollection: typeof createCollection
  createLiveQueryCollection: typeof createLiveQueryCollection
  createTransaction: typeof createTransaction
  whenSyncAccepted: typeof whenSyncAccepted
}

export async function runOptimisticHistory(
  initial: Array<HistoryRow>,
  steps: ReadonlyArray<OptimisticStep>,
  mutant?:
    | `wrong-key`
    | `transient-field`
    | `partial-batch`
    | `backwards-cuts`
    | `previous-value`
    | `update-as-insert`
    | `retained-default`
    // Writes the partial lane's rows under `rowUpdateMode: 'full'`, so the
    // Collection replaces the row instead of merging it.
    | `partial-as-full`,
  options: {
    insertDefault?: number
    partialUpdates?: boolean
    wrapping?: WrappingSyncLane
  } = {},
) {
  const partialUpdates = options.partialUpdates === true
  const wrapping = options.wrapping
  const db: HistoryDb = wrapping?.db ?? {
    createCollection,
    createLiveQueryCollection,
    createTransaction,
    whenSyncAccepted,
  }
  if (wrapping && options.insertDefault !== undefined)
    throw new Error(`The wrapping-sync lane has no schema lane`)
  const model = new HistoryModel(initial, options.insertDefault, partialUpdates)
  let sync!: Parameters<SyncConfig<HistoryRow>[`sync`]>[0]
  let starting: ReturnType<typeof createDeferred<void>> | undefined
  // The next handler call writes this batch before it returns.
  let handlerBatch: HandlerBatch | undefined
  let reentrantBatches: Array<SourceBatch> | undefined
  const handler = async () => {
    const batch = handlerBatch
    const done = starting!.promise
    handlerBatch = undefined
    if (batch) {
      const receipt = writeSourceBatch(batch)
      // Handler-facing writes wait for acceptance. Waiting for visibility
      // would wait for this handler's own transaction to settle.
      if (batch.awaitReceipt) await db.whenSyncAccepted(receipt)
    }
    return done
  }
  const config: CollectionConfig<HistoryRow> = {
    getKey: (row) => row.id,
    onInsert: handler,
    onUpdate: handler,
    onDelete: handler,
    sync: {
      // The partial-update lane keeps the default row update mode.
      ...(partialUpdates && mutant !== `partial-as-full`
        ? {}
        : { rowUpdateMode: `full` as const }),
      sync: (actions) => {
        sync = actions
        actions.begin()
        for (const row of initial)
          actions.write({ type: `insert`, value: { ...row } })
        actions.commit()
        actions.markReady()
      },
    },
  }
  const schemaCollection =
    options.insertDefault === undefined
      ? undefined
      : db.createCollection({
          ...config,
          schema: z.object({
            id: z.number(),
            a: z.number(),
            b: z.number(),
            c: z.number().default(options.insertDefault),
          }),
        })
  const collection =
    schemaCollection ??
    db.createCollection<HistoryRow>(wrapping ? wrapping.wrap(config) : config)
  const downstream = db.createLiveQueryCollection({
    query: (q) => q.from({ row: collection }),
  })
  let sub: ReturnType<typeof collection.subscribeChanges> | undefined
  let rawSub: ReturnType<typeof collection.subscribeChanges> | undefined
  const operations: Array<{
    tx:
      | ReturnType<typeof collection.update>
      | ReturnType<typeof collection.insert>
      | ReturnType<typeof createTransaction<HistoryRow>>
    done: ReturnType<typeof createDeferred<void>>
    outcome: ReturnType<typeof observeHistoryPromise<unknown>>
    // Rows visible when `when('settled')` fulfilled or rejected.
    settledRows?: Array<ObservedRow>
    expected: HistoryOutcome<unknown>
    changes: object
    manual: boolean
  }> = []
  // A queued sync transaction's receipt stays pending until it is visible.
  const receipts: Array<{
    batch: SourceBatch
    outcome: ReturnType<typeof observeHistoryPromise<void>>
  }> = []
  const counts = {
    edits: 0,
    deletes: 0,
    settlements: 0,
    completionAttempts: 0,
    completionRejections: 0,
    replacements: 0,
    queued: 0,
    failures: 0,
    snapshotOverrides: 0,
    handlerBatches: 0,
    openBatches: 0,
    abortedBatches: 0,
    awaitedReceipts: 0,
    sourceInserts: 0,
    sourceDeletes: 0,
    absentSourceDeletes: 0,
    // Partial updates whose omitted `c` differs from the source's held row,
    // so only a merge keeps the held value.
    distinguishingPartialUpdates: 0,
    // Drains that kept a settled row held for a deferred transaction.
    deferredHolds: 0,
    abortedDeferred: 0,
    // Discarded aborted transactions that released a settled row's hold.
    abortReleases: 0,
    abortAttributionReleases: 0,
  }
  // The source admits each message against its own rows, including queued
  // batches. An insert names an absent key; an update or delete a present
  // one, except that the source may delete a key it does not hold. Resolve
  // each batch once, in write order, for the model and driver.
  const sourceKeys = new Set(initial.map((row) => row.id))
  let open:
    | {
        batch: SourceBatch
        keysBefore: Set<number>
        rowsBefore: Map<number, HistoryRow>
      }
    | undefined
  const sourceInserts = new WeakMap<SourceBatch, Set<number>>()
  const absentDeletes = new WeakMap<SourceBatch, Set<number>>()
  function resolveSourceBatch(step: SourceBatch): SourceBatch {
    if (step.operations && step.copies !== 1)
      throw new Error(`Ordered source batches have one copy`)
    if (step.operations && (step.rows.length || step.deletes?.length))
      throw new Error(`Ordered source batches use operations alone`)
    if (step.truncate) sourceKeys.clear()
    const inserts = new Set<number>()
    const absent = new Set<number>()
    for (const [index, operation] of sourceOperations(step).entries()) {
      if (operation.type === `row`) {
        if (!sourceKeys.has(operation.row.id)) inserts.add(index)
        sourceKeys.add(operation.row.id)
      } else if (!sourceKeys.delete(operation.key)) {
        absent.add(index)
      }
    }
    sourceInserts.set(step, inserts)
    absentDeletes.set(step, absent)
    return step
  }
  // The source's rows in write order. A partial update needs the held row,
  // and only one whose omitted `c` differs from it can tell a merge from a
  // replacement.
  const sourceRows = new Map(initial.map((row) => [row.id, row]))
  function beginSourceBatch(step: SourceBatch) {
    const inserts = sourceInserts.get(step)!
    sync.begin()
    if (step.truncate) {
      sync.truncate()
      sourceRows.clear()
      counts.replacements++
    }
    for (const [index, operation] of sourceOperations(step).entries()) {
      if (operation.type === `delete`) {
        sync.write({ type: `delete`, key: operation.key })
        sourceRows.delete(operation.key)
        counts.sourceDeletes++
        if (absentDeletes.get(step)!.has(index)) counts.absentSourceDeletes++
        continue
      }
      const { row } = operation
      const type = inserts.has(index) ? `insert` : `update`
      if (type === `insert`) counts.sourceInserts++
      const held = sourceRows.get(row.id)
      if (type === `update` && partialUpdates && step.partial) {
        // An update names a key the source holds, so its row must be known.
        if (!held) throw new Error(`Partial update of unknown source row`)
        const { c: _omitted, ...partialRow } = row
        if (held.c !== row.c) counts.distinguishingPartialUpdates++
        sync.write({ type, value: partialRow as HistoryRow })
        sourceRows.set(row.id, { ...row, c: held.c })
      } else {
        sync.write({ type, value: { ...row } })
        sourceRows.set(row.id, row)
      }
    }
  }
  function writeSourceBatch(step: SourceBatch) {
    beginSourceBatch(step)
    return commitSourceBatch(step)
  }
  // In a wrapping-sync lane each source transaction carries its own signal,
  // so a history can abort it while it is deferred.
  const controllers = new Map<SourceBatch, AbortController>()
  function commitSourceBatch(step: SourceBatch) {
    let signal: AbortSignal | undefined
    if (wrapping) {
      const controller = new AbortController()
      controllers.set(step, controller)
      signal = controller.signal
    }
    const receipt = sync.commit(signal)
    if (receipt !== true)
      receipts.push({ batch: step, outcome: observeHistoryPromise(receipt) })
    if (model.transactions.some((entry) => entry.state === `persisting`)) {
      if (step.truncate) counts.snapshotOverrides++
      else counts.queued++
    }
    return receipt
  }
  return withHistoryCleanup(
    async () => {
      await downstream.preload()
      await wrapping?.settle()
      // includeInitialState supplies inserts; the listener's prior state is empty.
      const replica = new Map<number, ObservedRow>()
      let deliveries = 0
      type Publication = {
        before: Map<number, ObservedRow>
        batch: Array<{
          key: unknown
          type: string
          value: ObservedRow
          previousValue?: ObservedRow
        }>
        replica: Array<ObservedRow>
        source: Array<ObservedRow>
      }
      let publications: Array<Publication> = []
      let cuts = [sorted(model.visible().values())]
      let injected = false
      let initialPublication = true
      let settling = false
      sub = collection.subscribeChanges(
        (batch) => {
          deliveries += batch.length
          const captured = batch.map((change) => ({
            ...change,
            value: observed(change.value),
            ...(`previousValue` in change
              ? {
                  previousValue:
                    change.previousValue === undefined
                      ? undefined
                      : observed(change.previousValue),
                }
              : {}),
          }))
          const record = (entries: typeof captured) => {
            const before = new Map(replica)
            for (const change of entries) {
              if (change.type === `delete`) replica.delete(change.key as number)
              else replica.set(change.key as number, change.value)
            }
            publications.push({
              before,
              batch: entries,
              replica: sorted(replica.values()),
              source: sorted([...collection.values()].map(observed)),
            })
          }
          // Observation mutants alter a copy of a real callback.
          if (initialPublication) {
            record(captured)
            return
          }
          if (!injected && mutant === `wrong-key` && captured.length) {
            injected = true
            record(
              captured.map((change) => ({
                ...change,
                key: String(change.key),
              })),
            )
          } else if (
            !injected &&
            mutant === `transient-field` &&
            captured.length
          ) {
            injected = true
            record(
              captured.map((change) => ({
                ...change,
                value: { ...change.value, c: change.value.c + 100 },
              })),
            )
            record(captured)
          } else if (
            !injected &&
            mutant === `partial-batch` &&
            captured.length > 1
          ) {
            injected = true
            record(captured.slice(0, 1))
            record(captured)
          } else if (
            !injected &&
            (mutant === `previous-value` || mutant === `update-as-insert`) &&
            captured.some((change) => change.type === `update`)
          ) {
            injected = true
            record(
              captured.map((change) =>
                change.type !== `update`
                  ? change
                  : mutant === `previous-value`
                    ? {
                        ...change,
                        previousValue: { ...change.previousValue!, c: 999999 },
                      }
                    : { ...change, type: `insert` as const },
              ),
            )
          } else record(captured)
          if (reentrantBatches) {
            const batches = reentrantBatches
            reentrantBatches = undefined
            for (const suffixBatch of batches) writeSourceBatch(suffixBatch)
          }
        },
        { includeInitialState: true },
      )
      // A raw subscriber starts from the visible rows and receives only later
      // changes. It has no sent-key filter to hide an invalid message.
      const rawReplica = new Map(
        [...model.visible()].map(([key, row]) => [key as unknown, row]),
      )
      let rawPublications: Array<{
        before: Map<unknown, ObservedRow>
        batch: Array<{ key: unknown; type: string; value: ObservedRow }>
      }> = []
      rawSub = collection.subscribeChanges(
        (batch) => {
          const before = new Map(rawReplica)
          const captured = batch.map((change) => ({
            ...change,
            value: observed(change.value),
            ...(change.previousValue === undefined
              ? {}
              : { previousValue: observed(change.previousValue) }),
          }))
          for (const change of captured) {
            if (change.type === `delete`) rawReplica.delete(change.key)
            else rawReplica.set(change.key, change.value)
          }
          rawPublications.push({ before, batch: captured })
        },
        { includeInitialState: false },
      )
      const check = (label: string) => {
        for (const publication of rawPublications) {
          expectHistoryEventSemantics(
            publication.before,
            publication.batch,
            `${label}: raw subscriber`,
          )
        }
        rawPublications = []
        if (
          !injected &&
          mutant === `backwards-cuts` &&
          settling &&
          initialFrame &&
          publications.length > 0 &&
          !isDeepStrictEqual(initialFrame.replica, publications.at(-1)!.replica)
        ) {
          // Replay an earlier real complete callback after the later source cut.
          // The healthy runtime may coalesce the intermediate settlement cut.
          publications.push(initialFrame)
          injected = true
        }
        let cutIndex = 0
        for (const publication of publications) {
          expectHistoryEventSemantics(
            publication.before,
            publication.batch,
            label,
          )
          for (const change of publication.batch) {
            expect(typeof change.key, `${label}: native callback key`).toBe(
              `number`,
            )
            expect(change.key, `${label}: callback key/value identity`).toBe(
              change.value.id,
            )
          }
          const next = cuts.findIndex(
            (cut, index) =>
              index >= cutIndex && isDeepStrictEqual(cut, publication.replica),
          )
          expect(
            next,
            `${label}: whole forward publication ${JSON.stringify(publication.replica)}; allowed ${JSON.stringify(cuts)}`,
          ).toBeGreaterThanOrEqual(0)
          expect(
            publication.source,
            `${label}: callback-time complete source`,
          ).toStrictEqual(cuts[next])
          cutIndex = next
        }
        publications = []
        for (const [index, operation] of operations.entries()) {
          expectHistoryOutcome(
            operation.outcome.read(),
            operation.expected,
            `${label}: request outcome ${index}`,
          )
          expect(
            operation.expected.status,
            `${label}: model outcome ${index}`,
          ).toBe(
            model.transactions[index]!.state === `persisting` ||
              model.transactions[index]!.state === `pending`
              ? `pending`
              : model.transactions[index]!.state === `completed`
                ? `fulfilled`
                : `rejected`,
          )
          expect(
            operation.tx.state,
            `${label}: transaction state ${index}`,
          ).toBe(model.transactions[index]!.state)
          expect(
            operation.tx.mutations[0]!.modified,
            `${label}: immutable request ${index}`,
          ).toMatchObject(plain(model.transactions[index]!.row))
          expect(
            operation.tx.mutations[0]!.changes,
            `${label}: authored request ${index}`,
          ).toStrictEqual(operation.changes)
        }
        for (const [index, receipt] of receipts.entries())
          if (
            model.queue.includes(receipt.batch) ||
            model.deferred.includes(receipt.batch)
          )
            expect(
              receipt.outcome.read().status,
              `${label}: receipt ${index} waits for visibility`,
            ).toBe(`pending`)
        const expected = sorted(model.visible().values())
        const actual = sorted([...collection.values()].map(observed))
        if (
          mutant === `retained-default` &&
          settling &&
          !injected &&
          actual.length
        ) {
          actual[0]!.c = -999999
          injected = true
        }
        expect(
          actual,
          `${label}: reads ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`,
        ).toEqual(expected)
        expect(sorted(replica.values()), `${label}: event replica`).toEqual(
          expected,
        )
        expect(
          sorted(rawReplica.values()),
          `${label}: raw event replica`,
        ).toEqual(expected)
        expect(
          sorted([...downstream.values()].map(plain)),
          `${label}: downstream`,
        ).toEqual(expected.map(plain))
        // Every per-mutation pass walks the tracked transactions, so the
        // Collection tracks exactly its unsettled transactions. A held row
        // outlives its completed transaction in the held-row layer, not here.
        // Compare identities, so a pass that removes the wrong transaction
        // cannot keep the count right.
        const unsettled = operations
          .filter(
            (_, index) =>
              model.transactions[index]?.state === `pending` ||
              model.transactions[index]?.state === `persisting`,
          )
          .map((operation) => operation.tx)
        const tracked = [...collection._state.transactions.values()]
        expect(
          tracked.length === unsettled.length &&
            unsettled.every((transaction) => tracked.includes(transaction)),
          `${label}: tracked transactions are the unsettled ones, by identity`,
        ).toBe(true)
      }
      const releaseStore = () => {
        cuts = [sorted(model.visible().values())]
        model.releaseStore(() => cuts.push(sorted(model.visible().values())))
        wrapping!.releaseStore()
      }
      const initialFrame = publications.at(-1)
      check(`initial`)
      initialPublication = false
      for (const [position, step] of steps.entries()) {
        settling = step.type === `settle`
        const before = sorted(model.visible().values())
        const deliveredBefore = deliveries
        if (step.type === `edit` || step.type === `delete`) {
          if (step.type === `edit` && step.pending && step.inHandler)
            throw new Error(`A pending edit cannot write from its handler yet`)
          const index = model.author(step)
          if (index === undefined) continue
          const intent = model.transactions[index]!
          cuts = [sorted(model.visible().values())]
          if (step.inHandler && !open) {
            const batch: HandlerBatch = resolveSourceBatch(step.inHandler)
            batch.awaitReceipt = step.inHandler.awaitReceipt
            // Acceptance waits for the wrapping sync's durable step, so a
            // handler awaiting it would wait for the held store.
            if (batch.awaitReceipt && (model.storeHeld || model.holdNext))
              throw new Error(`A held store excludes awaited handler receipts`)
            model.sync(batch)
            cuts.push(sorted(model.visible().values()))
            handlerBatch = batch
            counts.handlerBatches++
            if (batch.awaitReceipt) counts.awaitedReceipts++
          }
          const done = createDeferred<void>()
          // Rejection can precede a manual commit. Keep that controlled
          // failure from becoming an unhandled promise during diagnosis.
          void done.promise.catch(() => undefined)
          starting = done
          const performEdit = () =>
            step.type === `delete`
              ? collection.delete(step.key, { optimistic: step.optimistic })
              : intent.kind === `insert`
                ? schemaCollection && step.fields.c === undefined
                  ? schemaCollection.insert(
                      {
                        id: intent.key,
                        a: intent.row.a,
                        b: intent.row.b,
                      },
                      { optimistic: step.optimistic },
                    )
                  : collection.insert(plain(intent.row), {
                      optimistic: step.optimistic,
                    })
                : collection.update(
                    step.key,
                    { optimistic: step.optimistic },
                    (draft) => Object.assign(draft, step.fields),
                  )
          const manual = step.type === `edit` && step.pending === true
          const tx = manual
            ? db.createTransaction<HistoryRow>({
                autoCommit: false,
                // A manual commit can run after later edits replace `starting`.
                mutationFn: () => done.promise,
              })
            : performEdit()
          if (manual) tx.mutate(() => void performEdit())
          // An optimistic mutation is visible in the tick that makes it, on
          // every production path.
          if (step.optimistic) {
            const live = collection.get(step.key)
            expect(
              live && plain(live),
              `${position}: optimistic mutation is live in the same tick`,
            ).toEqual(step.type === `delete` ? undefined : plain(intent.row))
          }
          const operation: (typeof operations)[number] = {
            tx,
            done,
            outcome: observeHistoryPromise<unknown>(
              tx.when(`settled`).finally(() => {
                operation.settledRows = sorted(
                  [...collection.values()].map(observed),
                )
              }),
            ),
            expected: { status: `pending` },
            manual,
            changes:
              step.type === `delete`
                ? plain(intent.row)
                : intent.kind === `insert`
                  ? schemaCollection && step.fields.c === undefined
                    ? {
                        id: intent.key,
                        a: intent.row.a,
                        b: intent.row.b,
                      }
                    : plain(intent.row)
                  : Object.fromEntries(
                      Object.entries(step.fields).filter(
                        ([key, value]) =>
                          before.find((row) => row.id === intent.key)?.[
                            key as keyof Fields
                          ] !== value,
                      ),
                    ),
          }
          operations.push(operation)
          expect(
            tx.mutations[0]!.modified,
            `captured request snapshot`,
          ).toMatchObject(plain(intent.row))
          expect(handlerBatch, `handler wrote its source batch`).toBeUndefined()
          counts.edits++
          if (step.type === `delete`) counts.deletes++
        } else if (step.type === `complete`) {
          if (!operations.length) continue
          const index = step.slot % operations.length
          const op = operations[index]!
          const admitted = model.transactions[index]!.state === `pending`
          counts.completionAttempts++
          if (admitted) {
            model.settle(index, true, false)
            cuts = [sorted(model.visible().values())]
            op.expected = { status: `fulfilled`, value: op.tx }
            op.tx.completeWithoutCommit()
            op.tx.touchCollection()
            await op.outcome.settled
            expect(
              op.settledRows,
              `${position}: rows visible when external completion settled`,
            ).toEqual(cuts[0])
          } else {
            counts.completionRejections++
            expect(
              () => op.tx.completeWithoutCommit(),
              `external completion rejects ${model.transactions[index]!.state}`,
            ).toThrow()
          }
        } else if (step.type === `settle`) {
          const active = model.transactions.flatMap((entry, index) =>
            entry.state === `persisting` || entry.state === `pending`
              ? [index]
              : [],
          )
          if (!active.length) continue
          const index = active[step.slot % active.length]!
          const op = operations[index]!
          const canceled = model.settle(
            index,
            step.success,
            step.failure === `reject` || step.cascade,
          )
          for (const peerIndex of canceled)
            operations[peerIndex]!.expected = { status: `rejected` }
          // The drop and the queued sync transactions publish together.
          cuts = [sorted(model.visible().values())]
          if (step.success) {
            op.expected = { status: `fulfilled`, value: op.tx }
            if (op.manual) void op.tx.commit().catch(() => undefined)
            op.done.resolve()
          } else if (step.failure === `reject`) {
            const error = new Error(`Mutation rejected at step ${position}`)
            op.expected = { status: `rejected`, reason: error }
            if (op.manual) void op.tx.commit().catch(() => undefined)
            op.done.reject(error)
          } else {
            // Manual rollback promises rejection, not a particular reason value.
            op.expected = { status: `rejected` }
            op.tx.rollback({ isSecondaryRollback: !step.cascade })
            op.done.resolve()
          }
          // A receipt that waited for visibility would deadlock the handler.
          await Promise.race([
            op.outcome.settled,
            new Promise((resolve) => setTimeout(resolve, 20)),
          ])
          await Promise.resolve()
          expect(
            op.settledRows,
            `${position}: rows visible when settlement completed`,
          ).toEqual(cuts[0])
          counts.settlements++
          if (!step.success) counts.failures++
        } else if (step.type === `hold-store`) {
          if (!wrapping) throw new Error(`Store steps need a wrapping sync`)
          model.holdStore()
          wrapping.holdNextStore()
        } else if (step.type === `release-store`) {
          if (!wrapping) throw new Error(`Store steps need a wrapping sync`)
          releaseStore()
        } else if (step.type === `abort-deferred`) {
          if (!wrapping) throw new Error(`Store steps need a wrapping sync`)
          const aborted = model.abortDeferred(step.slot)
          if (!aborted) continue
          // The transaction still waits for its turn, so nothing changes yet.
          controllers.get(aborted)!.abort()
          counts.abortedDeferred++
        } else if (step.type === `reentrant`) {
          if (wrapping)
            throw new Error(`The wrapping-sync lane has no reentrant drain`)
          if (open) continue
          if (!step.trigger.truncate)
            throw new Error(`Reentrant trigger must publish a truncate`)
          const trigger = resolveSourceBatch(step.trigger)
          const batches = step.batches.map(resolveSourceBatch)
          if (!batches.some((batch) => batch.truncate))
            throw new Error(`Reentrant suffix must include a truncate`)
          model.sync(trigger)
          cuts = [sorted(model.visible().values())]
          model.syncTogether(batches)
          cuts.push(sorted(model.visible().values()))
          reentrantBatches = batches
          writeSourceBatch(trigger)
          expect(
            reentrantBatches,
            `source callback committed suffix`,
          ).toBeUndefined()
        } else if (step.type === `open`) {
          if (open || step.batch.truncate) continue
          const keysBefore = new Set(sourceKeys)
          const rowsBefore = new Map(sourceRows)
          const batch = resolveSourceBatch(step.batch)
          beginSourceBatch(batch)
          open = { batch, keysBefore, rowsBefore }
          counts.openBatches++
        } else if (step.type === `close`) {
          if (!open) continue
          const { batch, keysBefore, rowsBefore } = open
          open = undefined
          if (step.commit) {
            model.sync(batch)
            cuts = [sorted(model.visible().values())]
            commitSourceBatch(batch)
          } else {
            // Aborted before acceptance: its writes never apply.
            sourceKeys.clear()
            for (const key of keysBefore) sourceKeys.add(key)
            sourceRows.clear()
            for (const [key, row] of rowsBefore) sourceRows.set(key, row)
            const controller = new AbortController()
            controller.abort()
            const receipt = sync.commit(controller.signal)
            expect(receipt, `aborted open batch receipt`).toBeInstanceOf(
              Promise,
            )
            await expect(receipt).rejects.toMatchObject({ name: `AbortError` })
            // Core never accepted the batch, so its acceptance moment rejects too.
            await expect(
              Promise.resolve(db.whenSyncAccepted(receipt)),
              `aborted open batch acceptance`,
            ).rejects.toMatchObject({ name: `AbortError` })
            counts.abortedBatches++
          }
        } else {
          if (open) continue
          const batch = resolveSourceBatch(step)
          model.sync(batch)
          cuts = [sorted(model.visible().values())]
          writeSourceBatch(batch)
        }
        await wrapping?.settle()
        check(`${position}: ${JSON.stringify(step)}`)
        // Count events as well as final values; value-only oracles miss redundant
        // publications when a mutation moves into completed retention.
        if (
          step.type === `settle` &&
          JSON.stringify(before) ===
            JSON.stringify(sorted(model.visible().values()))
        ) {
          expect(deliveries, `unchanged settlement ${position}`).toBe(
            deliveredBefore,
          )
        }
      }
      // Every history ends with its deferred transactions applied.
      if (wrapping && (model.storeHeld || model.holdNext)) {
        releaseStore()
        await wrapping.settle()
        check(`final release-store`)
      }
      counts.deferredHolds = model.deferredHoldsAcrossDrain
      counts.abortReleases = model.abortReleases
      counts.abortAttributionReleases = model.abortAttributionReleases
      // A configuration mutant changes production setup, not an observation.
      if (mutant && mutant !== `partial-as-full`)
        expect(injected, `observation mutant reached its checkpoint`).toBe(true)
      return counts
    },
    () => [
      () => wrapping?.releaseStore(),
      ...operations.flatMap((op, index) => [
        () => {
          if (op.expected.status === `pending`) {
            op.expected = { status: `rejected` }
          }
          // A failed assertion can leave a manual transaction uncommitted.
          // Release it before waiting for its receipt, without hiding the
          // original assertion failure.
          if (op.tx.state === `pending` || op.tx.state === `persisting`) {
            op.tx.rollback({ isSecondaryRollback: true })
          }
        },
        () => op.done.resolve(),
        async () => {
          await op.outcome.settled
          expectHistoryOutcome(
            op.outcome.read(),
            op.expected,
            `cleanup request ${index}`,
          )
        },
      ]),
      () => sub?.unsubscribe(),
      () => rawSub?.unsubscribe(),
      () => downstream.cleanup(),
      () => collection.cleanup(),
      ...receipts.map(({ batch, outcome }, index) => async () => {
        await outcome.settled
        expectHistoryOutcome(
          outcome.read(),
          model.aborted.has(batch)
            ? { status: `rejected` }
            : { status: `fulfilled`, value: undefined },
          `applied sync receipt ${index}`,
        )
      }),
    ],
  )
}

declareOracle({ check: [runOptimisticHistory], model: [HistoryModel] })
