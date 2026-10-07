import { isDeepStrictEqual } from 'node:util'
import { expect } from 'vitest'
import { z } from 'zod'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { createLiveQueryCollection } from '../src/query/index.js'
import { whenSyncAccepted } from '../src/sync-receipt.js'
import type { CollectionConfig, SyncConfig } from '../src/types.js'

/**
 * # Which rows do optimistic and sync histories expose?
 *
 * While its mutation function runs, an optimistic transaction overlays its
 * optimistic state on the applied synced rows. When the mutation function
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
 * Queued sync
 * transactions apply when no optimistic transaction is persisting, in the
 * same publication that drops the settling transaction's optimistic state.
 * A completed transaction's optimistic row is held only while a queued sync
 * transaction touches its key, so that drop and that sync transaction
 * publish together. A sync write committed while the transaction persists
 * is attributed `$origin: 'local'`; one committed after its optimistic state
 * drops is `'remote'`. `isPersisted` fulfills after that publication. A truncate
 * applies at once, with every queued sync transaction before it, and the
 * still-persisting transactions overlay the replacement.
 *
 * The reference model has three small parts: the applied synced rows, an
 * ordered list of optimistic transactions with one mutation each, and a queue
 * of accepted sync transactions. `visible()` folds held completed
 * transactions, then persisting ones, over the applied rows. It does not reuse
 * production caches, pending-mutation mergers, or publication code. Model
 * alignment: `transactions` are optimistic transactions, `queue` holds
 * accepted sync transactions, and `base` is the applied synced rows. `held` is
 * a model-only flag for the hold described above: it is set when a
 * transaction completes while a queued sync transaction touches its key, and
 * the drain that applies that queue clears it.
 *
 * A sync transaction still open when a transaction settles is not accepted:
 * it holds no completed row and attributes nothing. If it later commits, its
 * writes are `'remote'` unless a persisting transaction touches their key; if
 * it aborts, its writes never apply, and both its receipt and its acceptance
 * moment (`whenSyncAccepted`) reject.
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
 * it succeeded or failed. Every per-mutation pass walks them, so their number
 * is bounded by live work: a persisting transaction, or a completed one whose
 * row a queued sync transaction still holds.
 *
 * `runOptimisticHistory` gives the same edit, delete, settle, and sync history
 * to this model and a real Collection. After every step it compares rows,
 * metadata, immutable handler payloads, promise outcomes, the rows visible
 * when `isPersisted` fulfills, downstream query state, and complete
 * publication cuts. A second subscriber starts without initial state, so no
 * sent-key filter can hide an invalid message. Each of its batches must be
 * valid for its replica: an insert names an absent key, and an update or
 * delete names a present one. Wrong-answer mutants prove these observations
 * reject wrong keys, partial batches, stale previous values, and transient
 * fields.
 */

export type HistoryRow = { id: number; a: number; b: number; c: number }
type Fields = Partial<Omit<HistoryRow, `id`>>
type SourceBatch = {
  type: `sync`
  rows: Array<HistoryRow>
  // Keys the source deletes after writing its rows, held or not.
  deletes?: Array<number> | undefined
  truncate: boolean
  copies: number
  // In the partial-update lane, the source's updates omit `c`.
  partial?: boolean | undefined
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
  | SourceBatch
  // A sync transaction that begins and writes now but commits or aborts at its
  // `close` step. While it is open, other sync batches are skipped, because the
  // sync API writes to the most recent open transaction.
  | { type: `open`; batch: SourceBatch }
  | { type: `close`; commit: boolean }

type ModelTransaction = {
  key: number
  kind: `insert` | `update` | `delete`
  row: HistoryRow
  optimistic: boolean
  state: `persisting` | `completed` | `failed`
  // Settled while a queued sync transaction touched its key. The drain that
  // applies that queue ends the hold.
  held: boolean
  // A held confirmation of this completed transaction is local.
  originPending: boolean
}
type ObservedRow = HistoryRow & {
  $origin: `local` | `remote`
  $hasPendingWrites: boolean
  $synced: boolean
}

/** Pure event-history model. It never reads production caches or callbacks. */
class HistoryModel {
  base = new Map<number, HistoryRow>()
  origins = new Map<number, `local` | `remote`>()
  transactions: Array<ModelTransaction> = []
  queue: Array<SourceBatch> = []

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

  private queuedKeys() {
    return new Set(
      this.queue.flatMap((batch) => [
        ...batch.rows.map((row) => row.id),
        ...(batch.deletes ?? []),
      ]),
    )
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
          $synced: true,
        },
      ]),
    )
    const overlay = [
      ...this.transactions.filter((entry) => entry.held),
      ...this.transactions.filter((entry) => entry.state === `persisting`),
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
        $synced: false,
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
      state: `persisting`,
      held: false,
      originPending: false,
    })
    return this.transactions.length - 1
  }

  settle(index: number, success: boolean) {
    const transaction = this.transactions[index]!
    transaction.state = success ? `completed` : `failed`
    transaction.held = success && this.queuedKeys().has(transaction.key)
    // Only a confirmation committed before the optimistic state drops, and
    // so held at this boundary, is local.
    transaction.originPending = transaction.held
    // This grammar submits direct operations immediately. Rollback cascades
    // affect pending (not already persisting) peer transactions, so none of
    // these independently submitted requests is canceled by a sibling failure.
    if (!this.persisting()) this.drain()
  }

  sync(step: SourceBatch) {
    this.queue.push(step)
    if (step.truncate || !this.persisting()) this.drain()
  }

  private drain() {
    const persistingKeys = new Set(
      this.transactions
        .filter((entry) => entry.state === `persisting`)
        .map((entry) => entry.key),
    )
    const attributed = new Set(
      this.transactions
        .filter((entry) => entry.originPending)
        .map((entry) => entry.key),
    )
    for (const batch of this.queue) {
      if (batch.truncate) {
        this.base.clear()
        this.origins.clear()
      }
      for (const row of batch.rows) {
        const local = attributed.has(row.id) || persistingKeys.has(row.id)
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
        persistingKeys.delete(row.id)
      }
      // A source delete removes the applied row and ends its attribution.
      for (const key of batch.deletes ?? []) {
        this.base.delete(key)
        this.origins.delete(key)
        attributed.delete(key)
        persistingKeys.delete(key)
      }
      // Truncate keeps attribution only for rows in its own replacement.
      if (batch.truncate) attributed.clear()
    }
    for (const transaction of this.transactions) {
      transaction.held = false
      transaction.originPending = false
    }
    this.queue = []
  }
}

const plain = ({ id, a, b, c }: HistoryRow): HistoryRow => ({ id, a, b, c })
const observed = (
  row: HistoryRow & {
    $origin: `local` | `remote`
    $hasPendingWrites: boolean
    $synced: boolean
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
  $synced: row.$synced,
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
  options: { insertDefault?: number; partialUpdates?: boolean } = {},
) {
  const partialUpdates = options.partialUpdates === true
  const model = new HistoryModel(initial, options.insertDefault, partialUpdates)
  let sync!: Parameters<SyncConfig<HistoryRow>[`sync`]>[0]
  let starting: ReturnType<typeof createDeferred<void>> | undefined
  // The next handler call writes this batch before it returns.
  let handlerBatch: HandlerBatch | undefined
  const handler = async () => {
    const batch = handlerBatch
    const done = starting!.promise
    handlerBatch = undefined
    if (batch) {
      const receipt = writeSourceBatch(batch)
      // Handler-facing writes wait for acceptance. Waiting for visibility
      // would wait for this handler's own transaction to settle.
      if (batch.awaitReceipt) await whenSyncAccepted(receipt)
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
      : createCollection({
          ...config,
          schema: z.object({
            id: z.number(),
            a: z.number(),
            b: z.number(),
            c: z.number().default(options.insertDefault),
          }),
        })
  const collection = schemaCollection ?? createCollection<HistoryRow>(config)
  const downstream = createLiveQueryCollection({
    query: (q) => q.from({ row: collection }),
  })
  let sub: ReturnType<typeof collection.subscribeChanges> | undefined
  let rawSub: ReturnType<typeof collection.subscribeChanges> | undefined
  const operations: Array<{
    tx:
      | ReturnType<typeof collection.update>
      | ReturnType<typeof collection.insert>
    done: ReturnType<typeof createDeferred<void>>
    outcome: ReturnType<typeof observeHistoryPromise<unknown>>
    // Rows visible when `isPersisted` fulfilled or rejected.
    settledRows?: Array<ObservedRow>
    expected: HistoryOutcome<unknown>
    changes: object
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
  }
  // The source admits each message against its own rows, including queued
  // batches. An insert names an absent key; an update or delete a present
  // one, except that the source may delete a key it does not hold. Resolve
  // each batch once, in write order, for the model and driver.
  const sourceKeys = new Set(initial.map((row) => row.id))
  let open: { batch: SourceBatch; keysBefore: Set<number> } | undefined
  const sourceInserts = new WeakMap<SourceBatch, Set<number>>()
  const absentDeletes = new WeakMap<SourceBatch, Set<number>>()
  function resolveSourceBatch(step: SourceBatch): SourceBatch {
    if (step.truncate) sourceKeys.clear()
    const inserts = new Set<number>()
    for (const row of step.rows) {
      if (!sourceKeys.has(row.id)) inserts.add(row.id)
      sourceKeys.add(row.id)
    }
    const absent = new Set<number>()
    for (const key of step.deletes ?? []) {
      if (!sourceKeys.delete(key)) absent.add(key)
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
    for (let copy = 0; copy < step.copies; copy++) {
      for (const row of step.rows) {
        const type = copy === 0 && inserts.has(row.id) ? `insert` : `update`
        if (type === `insert`) counts.sourceInserts++
        const held = sourceRows.get(row.id)
        if (type === `update` && partialUpdates && step.partial && held) {
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
    for (const key of step.deletes ?? []) {
      sync.write({ type: `delete`, key })
      sourceRows.delete(key)
      counts.sourceDeletes++
      if (absentDeletes.get(step)!.has(key)) counts.absentSourceDeletes++
    }
  }
  function writeSourceBatch(step: SourceBatch) {
    beginSourceBatch(step)
    return commitSourceBatch(step)
  }
  function commitSourceBatch(step: SourceBatch) {
    const receipt = sync.commit()
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
            model.transactions[index]!.state === `persisting`
              ? `pending`
              : model.transactions[index]!.state === `completed`
                ? `fulfilled`
                : `rejected`,
          )
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
          if (model.queue.includes(receipt.batch))
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
        // Every per-mutation pass walks the tracked transactions, so their
        // number is bounded by live work, not by history: a persisting
        // transaction, or a completed one whose row a queued sync
        // transaction still holds. A settled or failed one is gone.
        const live = model.transactions.filter(
          (entry) => entry.state === `persisting` || entry.held,
        ).length
        expect(
          collection._state.transactions.size,
          `${label}: tracked transactions are live`,
        ).toBeLessThanOrEqual(live)
      }
      const initialFrame = publications.at(-1)
      check(`initial`)
      initialPublication = false
      for (const [position, step] of steps.entries()) {
        settling = step.type === `settle`
        const before = sorted(model.visible().values())
        const deliveredBefore = deliveries
        if (step.type === `edit` || step.type === `delete`) {
          const index = model.author(step)
          if (index === undefined) continue
          const intent = model.transactions[index]!
          cuts = [sorted(model.visible().values())]
          if (step.inHandler && !open) {
            const batch: HandlerBatch = resolveSourceBatch(step.inHandler)
            batch.awaitReceipt = step.inHandler.awaitReceipt
            model.sync(batch)
            cuts.push(sorted(model.visible().values()))
            handlerBatch = batch
            counts.handlerBatches++
            if (batch.awaitReceipt) counts.awaitedReceipts++
          }
          const done = createDeferred<void>()
          starting = done
          const tx =
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
          const operation: (typeof operations)[number] = {
            tx,
            done,
            outcome: observeHistoryPromise<unknown>(
              tx.isPersisted.promise.finally(() => {
                operation.settledRows = sorted(
                  [...collection.values()].map(observed),
                )
              }),
            ),
            expected: { status: `pending` },
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
        } else if (step.type === `settle`) {
          const active = model.transactions.flatMap((entry, index) =>
            entry.state === `persisting` ? [index] : [],
          )
          if (!active.length) continue
          const index = active[step.slot % active.length]!
          const op = operations[index]!
          model.settle(index, step.success)
          // The drop and the queued sync transactions publish together.
          cuts = [sorted(model.visible().values())]
          if (step.success) {
            op.expected = { status: `fulfilled`, value: op.tx }
            op.done.resolve()
          } else if (step.failure === `reject`) {
            const error = new Error(`Mutation rejected at step ${position}`)
            op.expected = { status: `rejected`, reason: error }
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
            `${position}: rows visible when isPersisted settled`,
          ).toEqual(cuts[0])
          counts.settlements++
          if (!step.success) counts.failures++
        } else if (step.type === `open`) {
          if (open || step.batch.truncate) continue
          const keysBefore = new Set(sourceKeys)
          const batch = resolveSourceBatch(step.batch)
          beginSourceBatch(batch)
          open = { batch, keysBefore }
          counts.openBatches++
        } else if (step.type === `close`) {
          if (!open) continue
          const { batch, keysBefore } = open
          open = undefined
          if (step.commit) {
            model.sync(batch)
            cuts = [sorted(model.visible().values())]
            commitSourceBatch(batch)
          } else {
            // Aborted before acceptance: its writes never apply.
            sourceKeys.clear()
            for (const key of keysBefore) sourceKeys.add(key)
            const controller = new AbortController()
            controller.abort()
            const receipt = sync.commit(controller.signal)
            expect(receipt, `aborted open batch receipt`).toBeInstanceOf(
              Promise,
            )
            await expect(receipt).rejects.toMatchObject({ name: `AbortError` })
            // Core never accepted the batch, so its acceptance moment rejects too.
            await expect(
              Promise.resolve(whenSyncAccepted(receipt)),
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
      // A configuration mutant changes production setup, not an observation.
      if (mutant && mutant !== `partial-as-full`)
        expect(injected, `observation mutant reached its checkpoint`).toBe(true)
      return counts
    },
    () => [
      ...operations.flatMap((op, index) => [
        () => {
          if (op.expected.status === `pending`) {
            op.expected = { status: `rejected` }
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
      ...receipts.map(({ outcome }, index) => async () => {
        await outcome.settled
        expectHistoryOutcome(
          outcome.read(),
          { status: `fulfilled`, value: undefined },
          `applied sync receipt ${index}`,
        )
      }),
    ],
  )
}
