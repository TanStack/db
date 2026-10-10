import { output, serializeValue } from '@tanstack/db-ivm'
import { isPlainObject } from '../../utils/type-guards.js'
import { getOrCreate } from '../../utils/get-or-create.js'
import { createCollection } from '../../collection/index.js'
import {
  INCLUDES_ROUTING,
  transformPublicContainers,
} from '../compiler/route-metadata.js'
import { codedMessage, devBuild } from '../../error-message.js'
import { BUCKET_FACADE_REF } from './materialized-pipeline.js'
import type { Collection } from '../../collection/index.js'
import type { SyncConfig } from '../../types.js'
import type { PublicationDeferral } from '../../collection/changes.js'
import type {
  BucketFacadeCompilation,
  BucketFacadeRef,
  BucketRow,
} from './materialized-pipeline.js'

const PRIVATE_RESULT_KEYS = new Set<PropertyKey>([INCLUDES_ROUTING])

type FacadeSync = Parameters<SyncConfig<any>[`sync`]>[0]

type PendingRow = {
  deletes: number
  inserts: number
  value: BucketRow
}

type FacadeEntry = {
  collection: Collection<any, any, any>
  sync: FacadeSync | undefined
  keys: WeakMap<object, string | number>
  order: WeakMap<object, string>
}

type SnapshotRow = {
  key: string | number
  value: object
  order: string | undefined
}

type FacadeSnapshot = {
  activeBuckets: Map<string, Set<string>>
  entries: Map<string, Map<string, FacadeEntry>>
  rows: Map<FacadeEntry, Array<SnapshotRow>>
  /** Keys the flush wrote to each facade, including writes a facade holds. */
  written: Map<FacadeEntry, Set<string | number>>
}

const NO_FACADE_CHANGES: FacadePublication = {
  prepare: () => {},
  publish: () => {},
  rollback: () => {},
}

export type FacadePublication = {
  prepare: () => void
  publish: () => void
  rollback: () => void
}

/**
 * The only stateful boundary outside the materialization graph. It turns inert
 * bucket references into stable public Collection facades and applies the
 * graph's canonical bucket-row deltas to those facades.
 */
export class BucketFacadeAdapter {
  private pending = new Map<string, Map<string, Map<string, PendingRow>>>()
  private pendingActivity = new Map<string, Map<string, number>>()
  private readonly activeBuckets = new Map<string, Set<string>>()
  private readonly entries = new Map<string, Map<string, FacadeEntry>>()
  private readonly retiredEntries = new Map<string, Map<string, FacadeEntry>>()
  private resolvedValues = new WeakMap<object, unknown>()
  private cleanedUp = false

  constructor(
    private readonly parentId: string,
    private readonly compilations: Array<BucketFacadeCompilation>,
    onMessages: (count: number) => void,
  ) {
    for (const compilation of compilations) {
      compilation.rows.pipe(
        output((data) => {
          const messages = data.getInner()
          onMessages(messages.length)
          for (const [[bucketKey, row], multiplicity] of messages) {
            this.accumulate(compilation.edgeId, bucketKey, row, multiplicity)
          }
        }),
      )
      compilation.activeBuckets.pipe(
        output((data) => {
          const messages = data.getInner()
          onMessages(messages.length)
          for (const [[bucketKey], multiplicity] of messages) {
            this.accumulateActivity(compilation.edgeId, bucketKey, multiplicity)
          }
        }),
      )
    }
  }

  hasPendingChanges(): boolean {
    return this.pending.size > 0 || this.pendingActivity.size > 0
  }

  flush(): FacadePublication {
    if (!this.hasPendingChanges()) return NO_FACADE_CHANGES
    const snapshot = this.snapshot()
    const publications: Array<PublicationDeferral> = []
    const newBaselines: Array<FacadeEntry> = []

    // Compilations are child-first, so nested facade references resolve before
    // their containing rows are written to the next facade.
    try {
      for (const compilation of this.compilations) {
        const activity = this.pendingActivity.get(compilation.edgeId)
        const active = this.getActiveBuckets(compilation.edgeId)
        for (const [bucketKey, multiplicity] of activity ?? []) {
          if (multiplicity > 0 && !active.has(bucketKey)) {
            active.add(bucketKey)
            newBaselines.push(this.getEntry(compilation.edgeId, bucketKey))
          }
        }

        const buckets = this.pending.get(compilation.edgeId)
        for (const [bucketKey, changes] of buckets ?? []) {
          const existing = this.entries.get(compilation.edgeId)?.get(bucketKey)
          if (!active.has(bucketKey) && !existing) continue
          const entry = this.getEntry(compilation.edgeId, bucketKey)
          const sync = entry.sync
          if (!sync || changes.size === 0) continue

          for (const change of changes.values()) {
            this.prepareChange(entry, change)
          }
          this.beginWrite(
            entry,
            sync,
            snapshot,
            publications,
            [...changes.values()].map(
              (change) => change.value.publicKey as string | number,
            ),
          )
          for (const change of changes.values()) {
            this.applyChange(entry, sync, change, compilation.hasOrderBy)
          }
          sync.commit()
        }
        for (const [bucketKey, multiplicity] of activity ?? []) {
          if (multiplicity >= 0) continue
          active.delete(bucketKey)
          this.retireEntry(compilation.edgeId, bucketKey)
        }
      }
    } catch (error) {
      this.abort(snapshot, publications)
      throw error
    }
    // A failed root commit keeps the builder's pending root rows, so keep the
    // facade rows they refer to: a rollback puts them back for the next flush.
    const pending = this.pending
    const pendingActivity = this.pendingActivity
    this.pending = new Map()
    this.pendingActivity = new Map()

    let closed = false
    let prepared = false
    const prepare = () => {
      if (closed || prepared) return
      prepared = true
      for (const entry of newBaselines) entry.sync?.markReady()
    }
    return {
      prepare,
      publish: () => {
        if (closed) return
        prepare()
        closed = true
        // A throwing subscriber of one facade must not hold back the others.
        let publicationError: { error: unknown } | undefined
        for (const publication of publications) {
          try {
            publication.publish()
          } catch (error) {
            publicationError ??= { error }
          }
        }
        // Drop only the adapter's strong reference. External holders keep an
        // empty, ready facade; a later active interval receives a new one.
        this.retiredEntries.clear()
        if (publicationError) throw publicationError.error
      },
      rollback: () => {
        if (closed || this.cleanedUp) return
        closed = true
        this.abort(snapshot, publications)
        // The flush runs inside the graph run, so no graph output can reach
        // the adapter before its rollback. Restoring the consumed deltas over
        // new ones would lose them, so keep the new ones and fail instead.
        if (this.hasPendingChanges()) {
          throw new Error(
            devBuild() && process.env.NODE_ENV !== `production`
              ? `Bucket facade received graph output between a flush and its rollback`
              : codedMessage(235),
          )
        }
        this.pending = pending
        this.pendingActivity = pendingActivity
      },
    }
  }

  resolve<T>(value: T): T {
    return this.resolveValue(value) as T
  }

  cleanup(): void {
    this.cleanedUp = true
    for (const byBucket of this.entries.values()) {
      for (const entry of byBucket.values()) {
        void entry.collection.cleanup()
      }
    }
    this.entries.clear()
    this.cleanupRetiredEntries()
    this.pending.clear()
    this.pendingActivity.clear()
    this.activeBuckets.clear()
  }

  private accumulate(
    edgeId: string,
    bucketKey: string,
    row: BucketRow,
    multiplicity: number,
  ): void {
    const buckets = getOrCreate(this.pending, edgeId, () => new Map())
    const rows = getOrCreate(buckets, bucketKey, () => new Map())

    const key = serializeValue(row.publicKey)
    const change = rows.get(key) ?? {
      deletes: 0,
      inserts: 0,
      value: row,
    }
    if (multiplicity < 0) {
      change.deletes += -multiplicity
    } else if (multiplicity > 0) {
      change.inserts += multiplicity
      change.value = row
    }
    rows.set(key, change)
  }

  private copyRows(entry: FacadeEntry): Array<SnapshotRow> {
    // The projected synced rows include every queued sync write, held or
    // still open; the visible rows can lag behind them.
    return [...entry.collection._state.acceptedSyncedEntries()].map(
      ([key, value]) => ({ key, value, order: entry.order.get(value) }),
    )
  }

  private snapshot(): FacadeSnapshot {
    return {
      activeBuckets: new Map(
        [...this.activeBuckets].map(([edgeId, buckets]) => [
          edgeId,
          new Set(buckets),
        ]),
      ),
      entries: new Map(
        [...this.entries].map(([edgeId, byBucket]) => [
          edgeId,
          new Map(byBucket),
        ]),
      ),
      rows: new Map(),
      written: new Map(),
    }
  }

  /** Restore the facades, then discard their events even if restore throws. */
  private abort(
    snapshot: FacadeSnapshot,
    publications: Array<PublicationDeferral>,
  ): void {
    try {
      this.restore(snapshot)
    } finally {
      this.retiredEntries.clear()
      for (const publication of publications) publication.discard()
    }
  }

  private restore(snapshot: FacadeSnapshot): void {
    const previousEntries = new Set(
      [...snapshot.entries.values()].flatMap((byBucket) => [
        ...byBucket.values(),
      ]),
    )
    const currentEntries = new Set(
      [...this.entries.values()].flatMap((byBucket) => [...byBucket.values()]),
    )

    for (const [entry, rows] of snapshot.rows) {
      if (!previousEntries.has(entry)) continue
      const sync = entry.sync
      if (!sync) continue
      const before = new Map(rows.map((row) => [row.key, row]))
      // A failed write or commit can leave the facade's sync transaction
      // open with staged writes. Restore into it and commit it, so its
      // writes cannot reappear in the projected synced rows later.
      const pending = entry.collection._state.pendingSyncedTransactions
      if (pending[pending.length - 1]?.committed !== false) sync.begin()
      // Undo only the keys the flush wrote, held writes included; a row it did
      // not touch is still the one the facade showed before the flush.
      for (const key of snapshot.written.get(entry)!) {
        const row = before.get(key)
        if (!row) {
          sync.write({ type: `delete`, key })
          continue
        }
        entry.keys.set(row.value, row.key)
        if (row.order !== undefined) entry.order.set(row.value, row.order)
        sync.write({
          type:
            entry.collection._state.getAcceptedSyncedRow(key) === undefined
              ? `insert`
              : `update`,
          value: row.value,
        })
      }
      sync.commit()
    }

    this.entries.clear()
    for (const [edgeId, byBucket] of snapshot.entries) {
      this.entries.set(edgeId, new Map(byBucket))
    }
    this.activeBuckets.clear()
    for (const [edgeId, buckets] of snapshot.activeBuckets) {
      this.activeBuckets.set(edgeId, new Set(buckets))
    }
    this.resolvedValues = new WeakMap()

    for (const entry of currentEntries) {
      if (!previousEntries.has(entry)) void entry.collection.cleanup()
    }
  }

  private accumulateActivity(
    edgeId: string,
    bucketKey: string,
    multiplicity: number,
  ): void {
    const activity = getOrCreate(this.pendingActivity, edgeId, () => new Map())
    activity.set(bucketKey, (activity.get(bucketKey) ?? 0) + multiplicity)
  }

  private getActiveBuckets(edgeId: string): Set<string> {
    return getOrCreate(this.activeBuckets, edgeId, () => new Set())
  }

  /**
   * Begin a facade write. Copy the facade's rows and defer its events before
   * its first write in the flush, so a rollback reads only the facades the
   * flush wrote.
   */
  private beginWrite(
    entry: FacadeEntry,
    sync: FacadeSync,
    snapshot: FacadeSnapshot,
    publications: Array<PublicationDeferral>,
    keys: Array<string | number>,
  ): void {
    if (!snapshot.rows.has(entry)) {
      snapshot.rows.set(entry, this.copyRows(entry))
      snapshot.written.set(entry, new Set())
      publications.push(entry.collection._deferPublication())
    }
    for (const key of keys) snapshot.written.get(entry)!.add(key)
    sync.begin()
  }

  private retireEntry(edgeId: string, bucketKey: string): void {
    const byBucket = this.entries.get(edgeId)
    const entry = byBucket?.get(bucketKey)
    if (!entry) return
    // The graph retracts every row it sent before it retires a bucket, and
    // the projected synced rows include that retraction even while a
    // persisting transaction holds it. A row left there is a contradictory
    // graph signal.
    if (!entry.collection._state.acceptedSyncedEntries().next().done) {
      throw new Error(
        devBuild() && process.env.NODE_ENV !== `production`
          ? `Bucket facade retired with rows the graph did not retract`
          : codedMessage(237),
      )
    }

    // The facade can still show rows the graph never sent, such as an
    // optimistic row or a held sync commit. It has no synced row to retract,
    // so those rows leave when their transactions settle.
    byBucket!.delete(bucketKey)
    if (byBucket!.size === 0) this.entries.delete(edgeId)
    const retired = getOrCreate(this.retiredEntries, edgeId, () => new Map())
    retired.set(bucketKey, entry)
  }

  private getEntry(edgeId: string, bucketKey: string): FacadeEntry {
    const byBucket = getOrCreate(this.entries, edgeId, () => new Map())
    const existing = byBucket.get(bucketKey)
    if (existing) return existing

    const keys = new WeakMap<object, string | number>()
    const order = new WeakMap<object, string>()
    let sync: FacadeSync | undefined
    const collection = createCollection<any, string | number>({
      id: `__bucket-facade:${this.parentId}:${edgeId}:${bucketKey}`,
      getKey: (row) => {
        const key = keys.get(row) ?? row?.$key
        if (typeof key !== `string` && typeof key !== `number`) {
          throw new Error(
            devBuild() && process.env.NODE_ENV !== `production`
              ? `Bucket facade row has no public key`
              : codedMessage(146),
          )
        }
        return key
      },
      compare: (left, right) => {
        const leftOrder = order.get(left)
        const rightOrder = order.get(right)
        if (leftOrder === rightOrder) return 0
        if (leftOrder === undefined) return 1
        if (rightOrder === undefined) return -1
        return leftOrder < rightOrder ? -1 : 1
      },
      sync: {
        rowUpdateMode: `full`,
        sync: (methods) => {
          sync = methods
          return () => {
            sync = undefined
          }
        },
      },
      startSync: true,
      gcTime: 0,
    })
    const entry: FacadeEntry = {
      collection,
      get sync() {
        return sync
      },
      keys,
      order,
    }
    byBucket.set(bucketKey, entry)
    return entry
  }

  private applyChange(
    entry: FacadeEntry,
    sync: FacadeSync,
    change: PendingRow,
    hasOrderBy: boolean,
  ): void {
    const key = change.value.publicKey as string | number
    const accepted = entry.collection._state.getAcceptedSyncedRow(key)
    const present = accepted !== undefined
    const previousOrder = present ? entry.order.get(accepted) : undefined
    const nextOrder = change.value.order
    const orderChanged = present && previousOrder !== nextOrder
    const resolvedRow = this.resolve(change.value.value)
    const row = orderChanged ? { ...resolvedRow } : resolvedRow
    entry.keys.set(row, key)
    if (nextOrder !== undefined) {
      entry.order.set(row, nextOrder)
    }

    if (change.inserts > change.deletes) {
      sync.write({ type: present ? `update` : `insert`, value: row })
    } else if (change.inserts === change.deletes && present) {
      sync.write({ type: `update`, value: row })
    } else if (change.deletes > 0) {
      sync.write({ type: `delete`, key })
      return
    }

    if (hasOrderBy && orderChanged) sync.collection._markLayoutChange()
  }

  /** Resolve and validate every public key before opening a sync transaction. */
  private prepareChange(entry: FacadeEntry, change: PendingRow): void {
    const key = change.value.publicKey as string | number
    const row = this.resolve(change.value.value)
    entry.keys.set(row, key)
    entry.collection.getKeyFromItem(row)
  }

  private resolveValue(value: unknown): unknown {
    if (value === null || typeof value !== `object`) return value
    const cached = this.resolvedValues.get(value)
    if (cached !== undefined) return cached
    if (isBucketFacadeRef(value)) {
      const { edgeId, bucketKey } = value[BUCKET_FACADE_REF]
      const facade =
        this.entries.get(edgeId)?.get(bucketKey)?.collection ??
        this.retiredEntries.get(edgeId)?.get(bucketKey)?.collection ??
        this.getEntry(edgeId, bucketKey).collection
      this.resolvedValues.set(value, facade)
      return facade
    }
    if (Array.isArray(value) || isPlainObject(value)) {
      const result = transformPublicContainers(
        value,
        (leaf) => (isBucketFacadeRef(leaf) ? this.resolveValue(leaf) : leaf),
        PRIVATE_RESULT_KEYS,
      )
      this.resolvedValues.set(value, result)
      return result
    }
    return value
  }

  private cleanupRetiredEntries(): void {
    for (const byBucket of this.retiredEntries.values()) {
      for (const entry of byBucket.values()) {
        void entry.collection.cleanup()
      }
    }
    this.retiredEntries.clear()
  }
}

function isBucketFacadeRef(value: unknown): value is BucketFacadeRef {
  return (
    value !== null && typeof value === `object` && BUCKET_FACADE_REF in value
  )
}
