import { D2, MultiSet } from '@tanstack/db-ivm'
import { expect } from 'vitest'
import { BucketFacadeAdapter } from '../../src/query/live/bucket-facade-adapter.js'
import { createTransaction } from '../../src/transactions.js'
import { stripVirtualProps } from '../utils.js'
import type { Collection } from '../../src/collection/index.js'
import type { ChangeMessage, SyncConfig } from '../../src/types.js'
import type { Transaction } from '../../src/transactions.js'
import type { BucketRow } from '../../src/query/live/materialized-pipeline.js'

/**
 * Shared adapter driver for the bucket-facade rollback oracle
 * (bucket-facade-rollback-oracle.property.test.ts), which owns the law. The
 * Driver runs the real BucketFacadeAdapter over a D2 graph and observes the
 * facades it holds. Its check method compares what it observes with a model
 * that the oracle supplies, so the oracle's runHistory is the declared check.
 * The helpers here do not declare any part of their own.
 */

export const BUCKETS = [`b0`, `b1`, `b2`, `b3`] as const

export type BucketKey = string
export type Row = { id: number; v: number }
export type ModelRow = { value: Row; order: string }
export type Model = Map<BucketKey, Map<number, ModelRow>>

export type Op =
  | { type: `activate`; bucket: BucketKey }
  | { type: `insert`; bucket: BucketKey; id: number; v: number; rank: number }
  | { type: `update`; bucket: BucketKey; id: number; v: number; rank: number }
  | { type: `delete`; bucket: BucketKey; id: number }
  | { type: `retire`; bucket: BucketKey }

type FacadeSync = Parameters<SyncConfig<Record<string, unknown>>[`sync`]>[0]
export type FacadeEntry = {
  collection: Collection<Row, number>
  sync: FacadeSync | undefined
}

/** The rows a facade must show, in order. */
export function expectedRows(
  rows: Map<number, ModelRow> | undefined,
): Array<Row> {
  return [...(rows?.values() ?? [])]
    .sort((left, right) => (left.order < right.order ? -1 : 1))
    .map((row) => row.value)
}

/**
 * Run `body`, then `cleanup`. When both throw, keep the body's failure as the
 * primary error: an AggregateError whose `cause` is that failure and whose
 * `errors` list it before the cleanup error (ORC-010).
 */
export async function withCleanup(
  body: () => void | Promise<void>,
  cleanup: () => Promise<void>,
): Promise<void> {
  let failure: { error: unknown } | undefined
  try {
    await body()
  } catch (error) {
    failure = { error }
  }
  try {
    await cleanup()
  } catch (cleanupError) {
    if (!failure) throw cleanupError
    throw new AggregateError(
      [failure.error, cleanupError],
      `oracle failure, then cleanup failure`,
      { cause: failure.error },
    )
  }
  if (failure) throw failure.error
}

export function orderOf(rank: number, id: number): string {
  return `${rank}:${id}`
}

/**
 * Make the next `commit` or `write` of a facade's sync throw once. A `write`
 * failure leaves the facade's sync transaction open, as a validation error
 * from a real write would.
 */
export function injectFailure(
  sync: FacadeSync,
  method: `commit` | `write` | `staged`,
): void {
  if (method === `staged`) {
    // The facade's writes are staged, then the commit throws before it
    // commits, so the sync transaction stays open with those writes.
    const commit = sync.commit
    sync.commit = () => {
      sync.commit = commit
      throw new Error(`injected facade write failure`)
    }
    return
  }
  if (method === `commit`) {
    const commit = sync.commit
    sync.commit = () => {
      sync.commit = commit
      commit()
      throw new Error(`injected facade write failure`)
    }
    return
  }
  const write = sync.write
  sync.write = () => {
    sync.write = write
    throw new Error(`injected facade write failure`)
  }
}

export class Driver {
  private readonly graph = new D2()
  private readonly rows = this.graph.newInput<[string, BucketRow]>()
  private readonly activity = this.graph.newInput<[string, true]>()
  readonly adapter: BucketFacadeAdapter
  private readonly events = new Map<object, number>()
  private changes = new Map<object, Array<ChangeMessage<Row, number>>>()
  private readonly wrapped = new WeakSet<object>()
  private reads = new Map<object, number>()
  private readonly sent = new Map<BucketKey, Map<number, BucketRow>>()
  // Rows a user transaction inserted into a facade. They are optimistic, so
  // the graph never sent them and the model's synced rows do not hold them.
  /** Optimistic row ids per facade, and whether the row is visible. */
  private localIds = new WeakMap<object, Map<number, boolean>>()
  private readonly localTransactions: Array<Transaction> = []
  private nextLocalId = 100
  // Rows of a persisting user transaction that holds a facade's sync commits.
  // The transaction settles without a sync write, so its row then leaves.
  readonly heldIds = new Set<number>()
  private nextHeldId = 1000

  constructor() {
    this.adapter = new BucketFacadeAdapter(
      `rollback-oracle-${Math.random()}`,
      [
        {
          edgeId: `children`,
          rows: this.rows,
          activeBuckets: this.activity,
          hasOrderBy: true,
        },
      ],
      () => {},
    )
    this.graph.finalize()
  }

  private entries(): Map<string, FacadeEntry> {
    return (
      (
        this.adapter as unknown as {
          entries: Map<string, Map<string, FacadeEntry>>
        }
      ).entries.get(`children`) ?? new Map()
    )
  }

  entry(bucket: BucketKey): FacadeEntry | undefined {
    return this.entries().get(bucket)
  }

  /** Send operations to the graph as the materialization graph would. */
  send(ops: ReadonlyArray<Op>): void {
    for (const op of ops) {
      const sent = this.sent.get(op.bucket)
      if (op.type === `activate`) {
        this.activity.sendData(new MultiSet([[[op.bucket, true], 1]]))
        this.sent.set(op.bucket, new Map())
      } else if (op.type === `retire`) {
        for (const row of sent?.values() ?? []) {
          this.rows.sendData(new MultiSet([[[op.bucket, row], -1]]))
        }
        this.activity.sendData(new MultiSet([[[op.bucket, true], -1]]))
        this.sent.delete(op.bucket)
      } else if (op.type === `delete`) {
        this.rows.sendData(new MultiSet([[[op.bucket, sent!.get(op.id)!], -1]]))
        sent!.delete(op.id)
      } else {
        const previous = sent!.get(op.id)
        if (previous) {
          this.rows.sendData(new MultiSet([[[op.bucket, previous], -1]]))
        }
        const row: BucketRow = [
          op.id,
          { id: op.id, v: op.v },
          orderOf(op.rank, op.id),
        ]
        this.rows.sendData(new MultiSet([[[op.bucket, row], 1]]))
        sent!.set(op.id, row)
      }
    }
    this.graph.run()
  }

  /** Retire a bucket without retracting its rows, which a legal graph never does. */
  retireWithoutRetractions(bucket: BucketKey): void {
    this.activity.sendData(new MultiSet([[[bucket, true], -1]]))
    this.graph.run()
  }

  /** Cancel a contradictory retirement that a failed flush kept pending. */
  cancelRetirement(bucket: BucketKey): void {
    this.activity.sendData(new MultiSet([[[bucket, true], 1]]))
    this.graph.run()
  }

  /**
   * Insert a row into a shown facade inside a user transaction that stays
   * pending, as an application may with a Collection-valued include. The
   * facade then shows an optimistic row the graph never sent.
   */
  addLocal(
    bucket: BucketKey,
    sharedId?: number,
    shown?: { id: number; type: `delete` | `update` },
  ): void {
    const facade = this.entry(bucket)?.collection
    if (!facade) return
    if (shown && !facade.has(shown.id)) return
    const id = shown?.id ?? sharedId ?? this.nextLocalId++
    const transaction = createTransaction({
      autoCommit: false,
      mutationFn: () => new Promise<void>(() => {}),
    })
    // An optimistic delete or update of a graph row makes the visible rows
    // differ from the projected synced rows without any hold.
    transaction.mutate(() => {
      if (shown?.type === `delete`) facade.delete(id)
      else if (shown?.type === `update`)
        // A fresh value, so the update always records a mutation: an empty
        // transaction is tracked by no Collection, and its rollback would
        // reject with no handler (core behavior, outside this oracle).
        facade.update(id, (draft) => {
          draft.v = 100 + this.nextLocalId++
        })
      else facade.insert({ id, v: 0, $key: id } as unknown as Row)
    })
    this.localTransactions.push(transaction)
    const ids = this.localIds.get(facade) ?? new Map()
    ids.set(id, shown?.type !== `delete`)
    this.localIds.set(facade, ids)
  }

  /**
   * Start a persisting user transaction on a shown facade. While it persists,
   * the facade holds every sync commit, including the adapter's flush and
   * rollback writes. Returns a function that settles it.
   */
  hold(bucket: BucketKey): (() => Promise<void>) | undefined {
    const facade = this.entry(bucket)?.collection
    if (!facade) return undefined
    const id = this.nextHeldId++
    this.heldIds.add(id)
    let settle!: () => void
    const transaction = createTransaction({
      autoCommit: false,
      mutationFn: () =>
        new Promise<void>((resolve) => {
          settle = resolve
        }),
    })
    transaction.mutate(() => {
      facade.insert({ id, v: 0, $key: id } as unknown as Row)
    })
    const committed = transaction.commit()
    return async () => {
      settle()
      await committed
    }
  }

  /** Count events and stored-row reads for every facade that exists now. */
  instrument(): void {
    for (const entry of this.entries().values()) {
      const facade = entry.collection
      if (!this.events.has(facade)) {
        this.events.set(facade, 0)
        const seen = new Set<number>()
        facade.subscribeChanges(
          (messages) => {
            this.events.set(facade, (this.events.get(facade) ?? 0) + 1)
            // Change-message protocol: an insert names a key this subscriber
            // does not have, and an update or delete names one it has.
            for (const message of messages) {
              if (seen.has(message.key) === (message.type === `insert`))
                this.protocolViolations.push(
                  `${facade.id}: ${message.type} of ${message.key} while ${seen.has(message.key) ? `present` : `absent`}`,
                )
              if (message.type === `delete`) seen.delete(message.key)
              else seen.add(message.key)
            }
            const changes = this.changes.get(facade) ?? []
            changes.push(...messages)
            this.changes.set(facade, changes)
            // Start from the facade's current rows, so the replay begins from
            // what this subscriber has seen. A subscriber without initial state
            // never hears of rows it was not sent.
          },
          { includeInitialState: true },
        )
      }
      const stored = facade._state.syncedData as unknown as Record<
        PropertyKey,
        (...args: Array<unknown>) => unknown
      >
      if (this.wrapped.has(stored)) continue
      this.wrapped.add(stored)
      // The adapter also reads the projected synced rows, held writes included.
      const state = facade._state as unknown as Record<
        string,
        (...args: Array<unknown>) => unknown
      >
      for (const method of [`acceptedSyncedEntries`, `getAcceptedSyncedRow`]) {
        const original = state[method]!.bind(state)
        state[method] = (...args: Array<unknown>) => {
          this.reads.set(facade, (this.reads.get(facade) ?? 0) + 1)
          return original(...args)
        }
      }
      // Every read path of the stored rows: iteration and lookups.
      for (const method of [
        Symbol.iterator,
        `entries`,
        `keys`,
        `values`,
        `get`,
        `has`,
      ]) {
        const original = stored[method]!.bind(stored)
        stored[method] = (...args: Array<unknown>) => {
          this.reads.set(facade, (this.reads.get(facade) ?? 0) + 1)
          return original(...args)
        }
      }
    }
  }

  /**
   * Make the facade the flush creates for `bucket` throw from its first
   * commit. The facade does not exist before the flush, so wrap the adapter's
   * entry factory for this one flush.
   */
  failNewFacade(bucket: BucketKey): void {
    const adapter = this.adapter as unknown as {
      getEntry: (edgeId: string, bucketKey: string) => FacadeEntry
    }
    const getEntry = adapter.getEntry
    adapter.getEntry = (edgeId, bucketKey) => {
      const existed = this.entries().has(bucketKey)
      const entry = getEntry.call(this.adapter, edgeId, bucketKey)
      if (!existed && bucketKey === bucket) {
        adapter.getEntry = getEntry
        injectFailure(entry.sync!, `commit`)
      }
      return entry
    }
  }

  /**
   * Record every facade the next flush creates. A failed flush must dispose
   * of them, which a holder sees as the facade's public `cleaned-up` status.
   */
  recordCreated(): Array<Collection<Row, number>> {
    const created: Array<Collection<Row, number>> = []
    const adapter = this.adapter as unknown as {
      getEntry: (edgeId: string, bucketKey: string) => FacadeEntry
    }
    const getEntry = adapter.getEntry
    const recording = (edgeId: string, bucketKey: string) => {
      const existed = this.entries().has(bucketKey)
      const entry = getEntry.call(this.adapter, edgeId, bucketKey)
      if (!existed) created.push(entry.collection)
      return entry
    }
    adapter.getEntry = recording
    this.restoreGetEntry = () => {
      // A one-shot failure wrapper underneath may already have removed both.
      if (adapter.getEntry === recording) adapter.getEntry = getEntry
    }
    return created
  }

  restoreGetEntry: () => void = () => {}

  eventCounts(): Map<object, number> {
    return new Map(this.events)
  }

  /**
   * Each existing facade's layout revision. The live-query observer compares
   * it to detect a reorder of a Collection-valued include. A committed batch
   * advances it when it marks a layout change and the visible key order
   * changes; a discarded publication restores it.
   */
  layoutCounts(): Map<object, number> {
    return new Map(
      [...this.entries().values()].map((entry) => [
        entry.collection,
        entry.collection._layoutRevision,
      ]),
    )
  }

  /** Change events each facade published since the last call. */
  takeChanges(): Map<object, Array<ChangeMessage<Row, number>>> {
    const changes = this.changes
    this.changes = new Map()
    return changes
  }

  /** Facades read since the last call. */
  takeReads(): Map<object, number> {
    const reads = this.reads
    this.reads = new Map()
    return reads
  }

  /** The adapter holds exactly the facades the model shows. */
  checkHeld(model: Model, label: string): void {
    expect(
      [...this.entries().keys()].sort(),
      `${label}: facades held by the adapter`,
    ).toEqual([...model.keys()].sort())
  }

  check(model: Model, label: string): void {
    expect(
      this.protocolViolations,
      `${label}: change-message protocol`,
    ).toEqual([])
    // The adapter holds exactly the facades the model shows: a failed flush
    // removes the facades it created, and a retired bucket has no facade.
    expect(
      [...this.entries().keys()].sort(),
      `${label}: facades held by the adapter`,
    ).toEqual([...model.keys()].sort())
    // A retired or replaced facade shows only its visible optimistic rows,
    // including one retired while a hold spanned several flushes.
    const held = new Set([...this.entries().values()].map((e) => e.collection))
    for (const facade of held) this.shownFacades.add(facade)
    for (const facade of this.shownFacades) {
      if (held.has(facade)) continue
      const visible = [...this.local(facade)]
        .filter(([, shown]) => shown)
        .map(([id]) => id)
      expect(
        [...facade.keys()].sort(),
        `${label}: rows of a retired facade`,
      ).toEqual(visible.sort())
    }
    for (const bucket of BUCKETS) {
      const rows = model.get(bucket)
      const facade = this.entry(bucket)?.collection
      if (!rows) continue
      expect(facade, `${label}: facade ${bucket}`).toBeDefined()
      // A facade the model shows has been made ready by the flush that
      // created it.
      expect(facade!.status, `${label}: status of ${bucket}`).toBe(`ready`)
      // An optimistic row overlays a graph row with the same id, so neither is
      // compared by value.
      const local = this.local(facade!)
      expect(
        facade!.toArray
          .map(stripVirtualProps)
          .filter((row) => !local.has(row.id)),
        `${label}: rows of ${bucket}`,
      ).toEqual(expectedRows(rows).filter((row) => !local.has(row.id)))
      for (const [id, visible] of local) {
        expect(facade!.has(id), `${label}: local row ${bucket}/${id}`).toBe(
          visible,
        )
      }
      for (const id of rows.keys()) {
        if (local.has(id)) continue
        const stored = facade!.get(id)
        expect(stored, `${label}: row ${bucket}/${id}`).toBeDefined()
        expect(facade!.getKeyFromItem(stored!), `${label}: key ${id}`).toBe(id)
      }
    }
  }

  /** Change messages that were invalid for the subscriber that got them. */
  readonly protocolViolations: Array<string> = []

  /** Every facade a check has seen the adapter hold. */
  private readonly shownFacades = new Set<Collection<any, any, any>>()

  /**
   * Try to clean up a shown facade from outside the adapter, as a holder
   * might. Its live query owns it, so the call throws and the facade keeps
   * receiving the graph's writes.
   */
  async attemptCleanup(bucket: BucketKey): Promise<void> {
    const facade = this.entry(bucket)?.collection
    if (!facade) return
    await expect(facade.cleanup(), `holder cleanup`).rejects.toThrow(
      /cannot be cleaned up directly/,
    )
    expect(facade.status, `status after a refused cleanup`).toBe(`ready`)
  }

  /**
   * Roll back every open optimistic transaction. Its rows leave, so a graph
   * row that shared one of their ids is compared by value from now on.
   */
  settleLocals(): void {
    for (const transaction of this.localTransactions.splice(0))
      transaction.rollback()
    this.localIds = new WeakMap()
  }

  /** Optimistic row ids on a facade. */
  local(facade: object): Map<number, boolean> {
    return this.localIds.get(facade) ?? new Map()
  }

  async cleanup(): Promise<void> {
    for (const transaction of this.localTransactions) transaction.rollback()
    this.adapter.cleanup()
    await Promise.resolve()
  }
}
