import { output, serializeValue } from '@tanstack/db-ivm'
import { createCollection } from '../../collection/index.js'
import { runAllCallbacks } from '../../utils/callbacks.js'
import { FN_SELECT_STATE, INCLUDES_ROUTING } from '../compiler/index.js'
import { BUCKET_FACADE_REF } from './materialized-pipeline.js'
import type { Collection } from '../../collection/index.js'
import type { SyncConfig } from '../../types.js'
import type { PublicationDeferral } from '../../collection/changes.js'
import type { CollectionPublicationStateSnapshot } from '../../collection/state.js'
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

type FacadeEntrySnapshot = {
  publicationState: CollectionPublicationStateSnapshot<
    Record<PropertyKey, unknown>,
    string | number
  >
  currentOrder: Map<string | number, string | undefined>
  rows: Array<{
    key: string | number
    value: object
    order: string | undefined
  }>
}

type FacadeSnapshot = {
  activeBuckets: Map<string, Set<string>>
  entries: Map<string, Map<string, FacadeEntry>>
  entryStates: Map<FacadeEntry, FacadeEntrySnapshot>
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
  private readonly recoveryStates = new Map<FacadeEntry, FacadeEntrySnapshot>()
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

  recover(): void {
    this.recoverEntries()
  }

  flush(): FacadePublication {
    this.recover()
    const snapshot = this.snapshot()
    const installedPending = this.pending
    const installedActivity = this.pendingActivity
    const deferredEntries = new Set<FacadeEntry>()
    const publications: Array<PublicationDeferral> = []
    const readyEntries = new Set<FacadeEntry>()
    const deferPublication = (entry: FacadeEntry) => {
      if (deferredEntries.has(entry)) return
      deferredEntries.add(entry)
      publications.push(entry.collection._deferPublication())
    }

    // Compilations are child-first, so nested facade references resolve before
    // their containing rows are written to the next facade.
    try {
      for (const compilation of this.compilations) {
        const activity = installedActivity.get(compilation.edgeId)
        const active = this.getActiveBuckets(compilation.edgeId)
        const newBaselines: Array<FacadeEntry> = []
        for (const [bucketKey, multiplicity] of activity ?? []) {
          if (multiplicity > 0 && !active.has(bucketKey)) {
            active.add(bucketKey)
            newBaselines.push(this.getEntry(compilation.edgeId, bucketKey))
          }
        }

        const buckets = installedPending.get(compilation.edgeId)
        for (const [bucketKey, changes] of buckets ?? []) {
          const existing = this.entries.get(compilation.edgeId)?.get(bucketKey)
          if (!active.has(bucketKey) && !existing) continue
          const entry = this.getEntry(compilation.edgeId, bucketKey)
          const sync = entry.sync
          if (!sync || changes.size === 0) continue

          for (const change of changes.values()) {
            this.prepareChange(entry, change)
          }
          const mayChangeVisibleOrder =
            compilation.hasOrderBy &&
            [...changes.values()].some((change) =>
              this.mayChangeVisibleOrder(entry, change),
            )
          deferPublication(entry)
          // The graph is already quiescent. Install this complete child
          // publication beneath any pending optimistic facade overlay instead
          // of parking source progress behind that mutation.
          sync.begin({ immediate: true })
          for (const change of changes.values()) {
            this.applyChange(entry, sync, change)
          }
          if (mayChangeVisibleOrder) {
            sync.collection._markLayoutChange()
          }
          sync.commit()
          if (entry.collection.status !== `ready`) readyEntries.add(entry)
        }
        for (const entry of newBaselines) readyEntries.add(entry)

        for (const [bucketKey, multiplicity] of activity ?? []) {
          if (multiplicity >= 0) continue
          active.delete(bucketKey)
          this.retireEntry(compilation.edgeId, bucketKey, deferPublication)
        }
      }
    } catch (error) {
      try {
        this.rollbackInstallation(snapshot, deferredEntries, publications)
      } catch {
        // Preserve the graph-install failure. A failed state restore marks its
        // facade as recoverably errored before this rollback closes every
        // publication handle.
      }
      throw error
    }
    // Detach, rather than clear, the deltas installed by this attempt. The
    // containing root publication decides whether they commit or must be
    // replayed with the next graph turn.
    this.pending = new Map()
    this.pendingActivity = new Map()

    let prepared = false
    let closed = false
    const prepare = () => {
      if (prepared || closed) return
      prepared = true
      runAllCallbacks([
        ...publications.map((publication) => publication.prepare),
        ...[...readyEntries].map((entry) => () => entry.sync?.markReady()),
      ])
    }
    return {
      prepare,
      publish: () => {
        if (closed) return
        let firstFailure: { error: unknown } | undefined
        try {
          prepare()
        } catch (error) {
          firstFailure = { error }
        }
        closed = true
        try {
          runAllCallbacks(
            publications.map((publication) => publication.publish),
          )
        } catch (error) {
          firstFailure ??= { error }
        }
        // Drop only the adapter's strong reference. External holders keep an
        // empty, ready facade; a later active interval receives a new one.
        this.retiredEntries.clear()
        if (firstFailure) throw firstFailure.error
      },
      rollback: () => {
        if (closed || prepared) return
        closed = true
        runAllCallbacks([
          () => {
            this.pending = mergePendingRows(installedPending, this.pending)
            this.pendingActivity = mergePendingActivity(
              installedActivity,
              this.pendingActivity,
            )
          },
          () =>
            this.rollbackInstallation(snapshot, deferredEntries, publications),
        ])
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
    this.recoveryStates.clear()
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
    const entryStates = new Map<FacadeEntry, FacadeEntrySnapshot>()
    for (const [edgeId, byBucket] of this.entries) {
      for (const [bucketKey, entry] of byBucket) {
        const affectedKeys = new Set(entry.collection._state.syncedData.keys())
        for (const change of this.pending
          .get(edgeId)
          ?.get(bucketKey)
          ?.values() ?? []) {
          const key = change.value.publicKey
          if (typeof key === `string` || typeof key === `number`) {
            affectedKeys.add(key)
          }
        }
        entryStates.set(entry, {
          publicationState:
            entry.collection._snapshotPublicationState(affectedKeys),
          currentOrder: new Map(entry.currentOrder),
          rows: [...entry.collection._state.syncedData].map(([key, value]) => ({
            key,
            value,
            order: entry.currentOrder.get(key),
          })),
        })
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
      entryStates,
    }
  }

  private restore(
    snapshot: FacadeSnapshot,
    changedEntries: Set<FacadeEntry>,
    failedEntries: Map<FacadeEntry, unknown>,
  ): void {
    let firstFailure: { error: unknown } | undefined
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
      const entryState = snapshot.entryStates.get(entry)
      if (!entryState) continue
      try {
        this.restoreEntryState(entry, entryState)
        this.recoveryStates.delete(entry)
      } catch (error) {
        firstFailure ??= { error }
        failedEntries.set(entry, error)
        this.recoveryStates.set(entry, entryState)
      }
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
    if (firstFailure) throw firstFailure.error
  }

  private restoreEntryState(
    entry: FacadeEntry,
    entryState: FacadeEntrySnapshot,
  ): void {
    try {
      entry.collection._restorePublicationState(entryState.publicationState)
    } finally {
      entry.currentOrder.clear()
      for (const [key, order] of entryState.currentOrder) {
        entry.currentOrder.set(key, order)
      }
      for (const row of entryState.rows) {
        entry.keys.set(row.value, row.key)
        if (row.order !== undefined) entry.order.set(row.value, row.order)
      }
    }
  }

  private recoverEntries(): void {
    let firstFailure: { error: unknown } | undefined
    const failedEntries = new Map<FacadeEntry, unknown>()
    for (const [entry, entryState] of this.recoveryStates) {
      try {
        this.restoreEntryState(entry, entryState)
        this.recoveryStates.delete(entry)
      } catch (error) {
        firstFailure ??= { error }
        failedEntries.set(entry, error)
      }
    }
    if (!firstFailure) return

    try {
      runAllCallbacks(
        [...failedEntries].map(([entry, error]) => () => {
          if (entry.collection.status !== `error`) entry.sync?.markError(error)
        }),
      )
    } catch {
      // The index recovery failure remains authoritative and retryable.
    }
    throw firstFailure.error
  }

  private rollbackInstallation(
    snapshot: FacadeSnapshot,
    changedEntries: Set<FacadeEntry>,
    publications: Array<PublicationDeferral>,
  ): void {
    const failedEntries = new Map<FacadeEntry, unknown>()
    runAllCallbacks([
      () => this.restore(snapshot, changedEntries, failedEntries),
      () => this.retiredEntries.clear(),
      ...publications.map((publication) => publication.discard),
      () =>
        runAllCallbacks(
          [...failedEntries].map(([entry, error]) => () => {
            if (entry.collection.status !== `error`) {
              entry.sync?.markError(error)
            }
          }),
        ),
    ])
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
      return
    }

    entry.currentOrder.set(key, nextOrder)
  }

  /** Identify graph changes that can move a visible key. Collection state
   * validates the final public sequence before publishing the layout signal. */
  private mayChangeVisibleOrder(
    entry: FacadeEntry,
    change: PendingRow,
  ): boolean {
    const key = change.value.publicKey as string | number
    const hasSyncedRow = entry.collection._state.syncedData.has(key)
    const nextHasSyncedRow =
      change.inserts > change.deletes ||
      (change.inserts === change.deletes && hasSyncedRow)
    const orderChanged =
      hasSyncedRow &&
      nextHasSyncedRow &&
      entry.currentOrder.get(key) !== change.value.order
    const movesBetweenBaseAndOptimisticSuffix =
      hasSyncedRow !== nextHasSyncedRow &&
      entry.collection._state.optimisticUpserts.has(key)
    return orderChanged || movesBetweenBaseAndOptimisticSuffix
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

function mergePendingRows(
  earlier: Map<string, Map<string, Map<string, PendingRow>>>,
  later: Map<string, Map<string, Map<string, PendingRow>>>,
): Map<string, Map<string, Map<string, PendingRow>>> {
  const merged = new Map<string, Map<string, Map<string, PendingRow>>>()

  for (const [edgeId, buckets] of earlier) {
    const mergedBuckets = new Map<string, Map<string, PendingRow>>()
    merged.set(edgeId, mergedBuckets)
    for (const [bucketKey, rows] of buckets) {
      mergedBuckets.set(
        bucketKey,
        new Map(
          [...rows].map(([key, change]) => [key, { ...change }] as const),
        ),
      )
    }
  }

  for (const [edgeId, buckets] of later) {
    let mergedBuckets = merged.get(edgeId)
    if (!mergedBuckets) {
      mergedBuckets = new Map()
      merged.set(edgeId, mergedBuckets)
    }
    for (const [bucketKey, rows] of buckets) {
      let mergedRows = mergedBuckets.get(bucketKey)
      if (!mergedRows) {
        mergedRows = new Map()
        mergedBuckets.set(bucketKey, mergedRows)
      }
      for (const [key, laterChange] of rows) {
        const earlierChange = mergedRows.get(key)
        if (!earlierChange) {
          mergedRows.set(key, { ...laterChange })
          continue
        }
        earlierChange.deletes += laterChange.deletes
        earlierChange.inserts += laterChange.inserts
        if (laterChange.inserts > 0) earlierChange.value = laterChange.value
      }
    }
  }

  return merged
}

function mergePendingActivity(
  earlier: Map<string, Map<string, number>>,
  later: Map<string, Map<string, number>>,
): Map<string, Map<string, number>> {
  const merged = new Map(
    [...earlier].map(
      ([edgeId, buckets]) => [edgeId, new Map(buckets)] as const,
    ),
  )
  for (const [edgeId, buckets] of later) {
    let mergedBuckets = merged.get(edgeId)
    if (!mergedBuckets) {
      mergedBuckets = new Map()
      merged.set(edgeId, mergedBuckets)
    }
    for (const [bucketKey, multiplicity] of buckets) {
      mergedBuckets.set(
        bucketKey,
        (mergedBuckets.get(bucketKey) ?? 0) + multiplicity,
      )
    }
  }
  return merged
}
