import { output, serializeValue } from '@tanstack/db-ivm'
import { createCollection } from '../../collection/index.js'
import { FN_SELECT_STATE, INCLUDES_ROUTING } from '../compiler/index.js'
import { BUCKET_FACADE_REF } from './materialized-pipeline.js'
import type { Collection } from '../../collection/index.js'
import type { SyncConfig } from '../../types.js'
import type { PublicationDeferral } from '../../collection/changes.js'
import type {
  BucketFacadeCompilation,
  BucketFacadeRef,
  BucketRow,
} from './materialized-pipeline.js'

type FacadeSync = Parameters<SyncConfig<any>[`sync`]>[0]

const BUCKET_FACADE_PUBLIC_KEY = Symbol(`bucketFacadePublicKey`)
const BUCKET_FACADE_ORDER = Symbol(`bucketFacadeOrder`)

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

type FacadeSnapshot = {
  activeBuckets: Map<string, Set<string>>
  entries: Map<string, Map<string, FacadeEntry>>
  rows: Map<
    FacadeEntry,
    Array<{
      key: string | number
      value: object
      order: string | undefined
    }>
  >
}

export type FacadePublication = {
  publish: () => void
  rollback: () => void
}

/**
 * The only stateful boundary outside the materialization graph. It turns inert
 * bucket references into stable public Collection facades and applies the
 * graph's canonical bucket-row deltas to those facades.
 */
export class BucketFacadeAdapter {
  private readonly pending = new Map<
    string,
    Map<string, Map<string, PendingRow>>
  >()
  private readonly pendingActivity = new Map<string, Map<string, number>>()
  private readonly activeBuckets = new Map<string, Set<string>>()
  private readonly entries = new Map<string, Map<string, FacadeEntry>>()
  private readonly retiredEntries = new Map<string, Map<string, FacadeEntry>>()
  private resolvedValues = new WeakMap<object, unknown>()

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
    const deferredEntries = new Set<FacadeEntry>()
    const publications: Array<PublicationDeferral> = []
    const deferPublication = (entry: FacadeEntry) => {
      if (deferredEntries.has(entry)) return
      deferredEntries.add(entry)
      publications.push(entry.collection._deferPublication())
    }

    // Compilations are child-first, so nested facade references resolve before
    // their containing rows are written to the next facade.
    try {
      for (const compilation of this.compilations) {
        const activity = this.pendingActivity.get(compilation.edgeId)
        const active = this.getActiveBuckets(compilation.edgeId)
        const newBaselines: Array<FacadeEntry> = []
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
          deferPublication(entry)
          // The graph is already quiescent. Install this complete child
          // publication beneath any pending optimistic facade overlay instead
          // of parking source progress behind that mutation.
          sync.begin({ immediate: true })
          for (const change of changes.values()) {
            this.applyChange(entry, sync, change, compilation.hasOrderBy)
          }
          sync.commit()
        }
        for (const entry of newBaselines) entry.sync?.markReady()

        for (const [bucketKey, multiplicity] of activity ?? []) {
          if (multiplicity >= 0) continue
          active.delete(bucketKey)
          this.retireEntry(compilation.edgeId, bucketKey, deferPublication)
        }
      }
    } catch (error) {
      this.restore(snapshot, deferredEntries)
      this.retiredEntries.clear()
      for (const publication of publications) publication.discard()
      throw error
    }
    this.pending.clear()
    this.pendingActivity.clear()

    let closed = false
    return {
      publish: () => {
        if (closed) return
        closed = true
        for (const publication of publications) publication.publish()
        // Drop only the adapter's strong reference. External holders keep an
        // empty, ready facade; a later active interval receives a new one.
        this.retiredEntries.clear()
      },
      rollback: () => {
        if (closed) return
        closed = true
        this.restore(snapshot, deferredEntries)
        this.retiredEntries.clear()
        for (const publication of publications) publication.discard()
      },
    }
  }

  resolve<T>(value: T): T {
    return this.resolveValue(value) as T
  }

  cleanup(): void {
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
    let buckets = this.pending.get(edgeId)
    if (!buckets) {
      buckets = new Map()
      this.pending.set(edgeId, buckets)
    }
    let rows = buckets.get(bucketKey)
    if (!rows) {
      rows = new Map()
      buckets.set(bucketKey, rows)
    }

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

  private snapshot(): FacadeSnapshot {
    const rows = new Map<
      FacadeEntry,
      Array<{
        key: string | number
        value: object
        order: string | undefined
      }>
    >()
    for (const byBucket of this.entries.values()) {
      for (const entry of byBucket.values()) {
        rows.set(
          entry,
          [...entry.collection._state.syncedData].map(([key, value]) => ({
            key,
            value,
            order: entry.currentOrder.get(key),
          })),
        )
      }
    }
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
      rows,
    }
  }

  private restore(
    snapshot: FacadeSnapshot,
    changedEntries: Set<FacadeEntry>,
  ): void {
    const previousEntries = new Set(
      [...snapshot.entries.values()].flatMap((byBucket) => [
        ...byBucket.values(),
      ]),
    )
    const currentEntries = new Set(
      [...this.entries.values()].flatMap((byBucket) => [...byBucket.values()]),
    )

    for (const entry of changedEntries) {
      if (!previousEntries.has(entry)) continue
      const sync = entry.sync
      if (!sync) continue
      sync.begin()
      sync.truncate()
      entry.currentOrder.clear()
      for (const row of snapshot.rows.get(entry) ?? []) {
        entry.keys.set(row.value, row.key)
        if (row.order !== undefined) entry.order.set(row.value, row.order)
        entry.currentOrder.set(row.key, row.order)
        sync.write({ type: `insert`, value: row.value })
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
    let activity = this.pendingActivity.get(edgeId)
    if (!activity) {
      activity = new Map()
      this.pendingActivity.set(edgeId, activity)
    }
    activity.set(bucketKey, (activity.get(bucketKey) ?? 0) + multiplicity)
  }

  private getActiveBuckets(edgeId: string): Set<string> {
    let active = this.activeBuckets.get(edgeId)
    if (!active) {
      active = new Set()
      this.activeBuckets.set(edgeId, active)
    }
    return active
  }

  private retireEntry(
    edgeId: string,
    bucketKey: string,
    deferPublication: (entry: FacadeEntry) => void,
  ): void {
    const byBucket = this.entries.get(edgeId)
    const entry = byBucket?.get(bucketKey)
    if (!entry) return

    const sync = entry.sync
    const keys = [...entry.collection.keys()]
    if (sync && keys.length > 0) {
      deferPublication(entry)
      // Route retirement precedes the root or containing-facade change that
      // removed its final consumer. That later immediate transaction drains
      // this earlier transaction as part of the same FIFO causal prefix.
      sync.begin()
      for (const key of keys) sync.write({ type: `delete`, key })
      sync.commit()
    }
    byBucket!.delete(bucketKey)
    if (byBucket!.size === 0) this.entries.delete(edgeId)
    let retired = this.retiredEntries.get(edgeId)
    if (!retired) {
      retired = new Map()
      this.retiredEntries.set(edgeId, retired)
    }
    retired.set(bucketKey, entry)
  }

  private getEntry(edgeId: string, bucketKey: string): FacadeEntry {
    let byBucket = this.entries.get(edgeId)
    if (!byBucket) {
      byBucket = new Map()
      this.entries.set(edgeId, byBucket)
    }
    const existing = byBucket.get(bucketKey)
    if (existing) return existing

    const keys = new WeakMap<object, string | number>()
    const order = new WeakMap<object, string>()
    let sync: FacadeSync | undefined
    const collection = createCollection<any, string | number>({
      id: `__bucket-facade:${this.parentId}:${edgeId}:${bucketKey}`,
      getKey: (row) => {
        const key =
          keys.get(row) ?? row?.[BUCKET_FACADE_PUBLIC_KEY] ?? row?.$key
        if (typeof key !== `string` && typeof key !== `number`) {
          throw new Error(`Bucket facade row has no public key`)
        }
        return key
      },
      compare: (left, right) => {
        const leftOrder = order.get(left) ?? left?.[BUCKET_FACADE_ORDER]
        const rightOrder = order.get(right) ?? right?.[BUCKET_FACADE_ORDER]
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
    // Graph deltas update the synced base. The public Collection view may be
    // hiding that row beneath a pending optimistic delete, so it cannot tell
    // us whether this delta is an insert, update, or delete of the base row.
    const hasSyncedRow = entry.collection._state.syncedData.has(key)
    const previousSyncedRow = entry.collection._state.syncedData.get(key)
    const orderChanged = hasSyncedRow && previousOrder !== nextOrder
    const resolvedRow = this.resolve(change.value.value)
    // Order metadata lives in a WeakMap keyed by row identity. Never attach a
    // new base order to an object that may also back the optimistic overlay.
    const row =
      orderChanged && previousSyncedRow === resolvedRow
        ? { ...resolvedRow }
        : resolvedRow
    entry.keys.set(row, key)
    // Collection updates clone the public row. Keep its route key on an
    // internal symbol so projected facade rows retain their identity.
    Object.defineProperty(row, BUCKET_FACADE_PUBLIC_KEY, {
      configurable: true,
      value: key,
    })
    if (nextOrder !== undefined) {
      entry.order.set(row, nextOrder)
      Object.defineProperty(row, BUCKET_FACADE_ORDER, {
        configurable: true,
        value: nextOrder,
      })
    }

    if (change.inserts > change.deletes) {
      sync.write({
        type: hasSyncedRow ? `update` : `insert`,
        value: row,
      })
    } else if (change.inserts === change.deletes && hasSyncedRow) {
      sync.write({ type: `update`, value: row })
    } else if (change.deletes > 0) {
      sync.write({ type: `delete`, key })
      entry.currentOrder.delete(key)
      // Deleting the synced base moves a still-visible optimistic upsert out
      // of the base ordering and into the optimistic-only suffix.
      if (hasOrderBy && entry.collection._state.optimisticUpserts.has(key)) {
        sync.collection._markLayoutChange()
      }
      return
    }

    entry.currentOrder.set(key, nextOrder)
    if (
      hasOrderBy &&
      orderChanged &&
      !entry.collection._state.optimisticDeletes.has(key)
    ) {
      sync.collection._markLayoutChange()
    }
  }

  /** Resolve and validate every public key before opening a sync transaction. */
  private prepareChange(entry: FacadeEntry, change: PendingRow): void {
    const key = change.value.publicKey as string | number
    const row = this.resolve(change.value.value)
    entry.keys.set(row, key)
    entry.collection.getKeyFromItem(row)
  }

  private resolveValue(value: unknown): unknown {
    if (value !== null && typeof value === `object`) {
      const cached = this.resolvedValues.get(value)
      if (cached !== undefined) return cached
    }
    if (isBucketFacadeRef(value)) {
      const { edgeId, bucketKey } = value[BUCKET_FACADE_REF]
      const facade =
        this.entries.get(edgeId)?.get(bucketKey)?.collection ??
        this.retiredEntries.get(edgeId)?.get(bucketKey)?.collection ??
        this.getEntry(edgeId, bucketKey).collection
      this.resolvedValues.set(value, facade)
      return facade
    }
    if (Array.isArray(value)) {
      const result: Array<unknown> = []
      this.resolvedValues.set(value, result)
      result.push(...value.map((item) => this.resolveValue(item)))
      return result
    }
    if (!isPlainObject(value)) return value

    const result: Record<PropertyKey, unknown> = {}
    this.resolvedValues.set(value, result)
    for (const key of Reflect.ownKeys(value)) {
      if (key === INCLUDES_ROUTING || key === FN_SELECT_STATE) continue
      result[key] = this.resolveValue(value[key])
    }
    return result
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

function isPlainObject(value: unknown): value is Record<PropertyKey, unknown> {
  if (value === null || typeof value !== `object`) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
