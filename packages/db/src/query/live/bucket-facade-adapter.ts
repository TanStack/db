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
  currentOrder: Map<string | number, string | undefined>
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
          this.beginWrite(entry, sync, snapshot, publications)
          for (const change of changes.values()) {
            this.applyChange(entry, sync, change, compilation.hasOrderBy)
          }
          sync.commit()
        }
        for (const [bucketKey, multiplicity] of activity ?? []) {
          if (multiplicity >= 0) continue
          active.delete(bucketKey)
          this.retireEntry(
            compilation.edgeId,
            bucketKey,
            snapshot,
            publications,
          )
        }
      }
    } catch (error) {
      this.restore(snapshot)
      this.retiredEntries.clear()
      for (const publication of publications) publication.discard()
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
        for (const publication of publications) publication.publish()
        // Drop only the adapter's strong reference. External holders keep an
        // empty, ready facade; a later active interval receives a new one.
        this.retiredEntries.clear()
      },
      rollback: () => {
        if (closed || this.cleanedUp) return
        closed = true
        this.restore(snapshot)
        this.retiredEntries.clear()
        for (const publication of publications) publication.discard()
        // The flush runs inside the graph run, so no graph output can reach
        // the adapter before its rollback. Restoring the consumed deltas over
        // new ones would lose them, so keep the new ones and fail instead.
        if (this.hasPendingChanges()) {
          throw new Error(
            devBuild() && process.env.NODE_ENV !== `production`
              ? `Bucket facade received graph output between a flush and its rollback`
              : codedMessage(233),
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
    return [...entry.collection._state.syncedData].map(([key, value]) => ({
      key,
      value,
      order: entry.currentOrder.get(key),
    }))
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
      const restoredKeys = new Set(rows.map((row) => row.key))
      sync.begin()
      for (const key of entry.collection.keys()) {
        if (!restoredKeys.has(key)) sync.write({ type: `delete`, key })
      }
      entry.currentOrder.clear()
      for (const row of rows) {
        entry.keys.set(row.value, row.key)
        if (row.order !== undefined) entry.order.set(row.value, row.order)
        entry.currentOrder.set(row.key, row.order)
        sync.write({
          type: entry.collection.has(row.key) ? `update` : `insert`,
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
   * flush wrote. A bucket written and then retired in one flush copies once.
   */
  private beginWrite(
    entry: FacadeEntry,
    sync: FacadeSync,
    snapshot: FacadeSnapshot,
    publications: Array<PublicationDeferral>,
  ): void {
    if (!snapshot.rows.has(entry)) {
      snapshot.rows.set(entry, this.copyRows(entry))
      publications.push(entry.collection._deferPublication())
    }
    sync.begin()
  }

  private retireEntry(
    edgeId: string,
    bucketKey: string,
    snapshot: FacadeSnapshot,
    publications: Array<PublicationDeferral>,
  ): void {
    const byBucket = this.entries.get(edgeId)
    const entry = byBucket?.get(bucketKey)
    if (!entry) return

    // The graph retracts a bucket's rows when it retires it, but the facade
    // can still show rows it never sent: an optimistic row from a pending
    // transaction, or a sync commit held behind a persisting one. Retract
    // whatever it still holds.
    const sync = entry.sync
    const keys = [...entry.collection.keys()]
    if (sync && keys.length > 0) {
      this.beginWrite(entry, sync, snapshot, publications)
      for (const key of keys) sync.write({ type: `delete`, key })
      sync.commit()
    }
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
      currentOrder: new Map(),
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
    const previousOrder = entry.currentOrder.get(key)
    const nextOrder = change.value.order
    const orderChanged = sync.collection.has(key) && previousOrder !== nextOrder
    const resolvedRow = this.resolve(change.value.value)
    const row = orderChanged ? { ...resolvedRow } : resolvedRow
    entry.keys.set(row, key)
    if (nextOrder !== undefined) {
      entry.order.set(row, nextOrder)
    }

    if (change.inserts > change.deletes) {
      sync.write({
        type: sync.collection.has(key) ? `update` : `insert`,
        value: row,
      })
    } else if (change.inserts === change.deletes && sync.collection.has(key)) {
      sync.write({ type: `update`, value: row })
    } else if (change.deletes > 0) {
      sync.write({ type: `delete`, key })
      entry.currentOrder.delete(key)
      return
    }

    entry.currentOrder.set(key, nextOrder)
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
