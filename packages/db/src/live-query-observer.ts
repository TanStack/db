import { LiveQueryObserverDisposedError } from './errors.js'
import {
  getLiveQueryStatusFlags,
  isSingleResultCollection,
} from './live-query-adapter.js'
import type { Collection } from './collection/index.js'
import type { ChangeMessage, CollectionStatus } from './types.js'

/**
 * The canonical, adapter-agnostic view of a live query at a point in time.
 *
 * `getSnapshot()` returns a stable object identity that only changes when the
 * query changes, so `useSyncExternalStore`-style consumers can compare by
 * reference. Each snapshot owns a captured view of `state`/`data`, so reading
 * an older snapshot cannot expose rows from a later revision.
 */
export interface LiveQuerySnapshot<
  T extends object,
  TKey extends string | number,
> {
  /** Keyed results, or `undefined` for a disabled query. */
  state: ReadonlyMap<TKey, T> | undefined
  /** Ordered results (single row for `findOne`), or `undefined` when disabled. */
  data: T | ReadonlyArray<T> | undefined
  /** The underlying collection, or `undefined` when disabled. */
  collection: Collection<T, TKey, any> | undefined
  status: CollectionStatus | `disabled`
  isLoading: boolean
  isReady: boolean
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
  isEnabled: boolean
}

/** Listener payload: the change set, or `undefined` for the synthetic ready notify. */
export type LiveQueryObserverListener<
  T extends object,
  TKey extends string | number,
> = (changes: Array<ChangeMessage<T, TKey>> | undefined) => void

/**
 * Wraps a resolved live-query `Collection` (or `null` for a disabled query) with
 * the shared lifecycle every framework adapter needs: start sync on first
 * subscribe, subscribe to changes and status transitions, expose a stable
 * snapshot for wholesale consumers, and deliver the raw change set for
 * granular consumers.
 *
 * Input resolution (query fn / config / collection / disabled) stays in the
 * adapter — it is framework-reactive. The observer owns everything after the
 * input is resolved to a concrete collection.
 *
 * @internal Unstable contract for TanStack DB's official framework adapters —
 * not a public extension point yet; may change in any release.
 */
export interface LiveQueryObserver<
  T extends object,
  TKey extends string | number,
> {
  /** Stable per-revision snapshot for wholesale materialization. */
  getSnapshot: () => LiveQuerySnapshot<T, TKey>
  /**
   * Subscribe to changes. The listener receives the change set (or `undefined`
   * for the synthetic notify a ready collection emits on attach). Granular
   * adapters apply the changes; wholesale adapters can ignore them and re-read
   * `getSnapshot()`. Returns an unsubscribe function.
   */
  subscribe: (listener: LiveQueryObserverListener<T, TKey>) => () => void
  /** Resolve once the collection has loaded its first data. */
  preload: () => Promise<void>
  /** Idempotent teardown. */
  dispose: () => void
}

/**
 * One logical subscription. Records — not raw callbacks — identify
 * subscriptions, so the same listener function can be subscribed twice and
 * each subscription tears down independently.
 */
interface SubscriptionRecord<T extends object, TKey extends string | number> {
  listener: LiveQueryObserverListener<T, TKey>
  active: boolean
}

interface Publication<T extends object, TKey extends string | number> {
  changes: Array<ChangeMessage<T, TKey>> | undefined
  targets: Array<SubscriptionRecord<T, TKey>>
  entries?: Array<[TKey, T]>
  status: CollectionStatus
  collectionRevision?: number
}

const DISABLED_SNAPSHOT: LiveQuerySnapshot<any, any> = {
  state: undefined,
  data: undefined,
  collection: undefined,
  status: `disabled`,
  isLoading: false,
  isReady: true,
  isIdle: false,
  isError: false,
  isCleanedUp: false,
  isEnabled: false,
}

class LiveQueryObserverImpl<
  T extends object,
  TKey extends string | number,
> implements LiveQueryObserver<T, TKey> {
  private readonly collection: Collection<T, TKey, any> | null
  private readonly wholesale: boolean
  private visibleStatus: CollectionStatus | undefined
  private cachedEntries: Array<[TKey, T]> | undefined
  private cachedCollectionRevision: number | undefined
  private snapshotDirty = true
  private cachedSnapshot: LiveQuerySnapshot<T, TKey> = DISABLED_SNAPSHOT
  private readonly subscriptions = new Set<SubscriptionRecord<T, TKey>>()
  // Publications are dispatched FIFO: an emit that happens while another
  // publication is being delivered (a listener mutating the collection
  // synchronously) is queued, never delivered reentrantly.
  private readonly publicationQueue: Array<Publication<T, TKey>> = []
  private dispatching = false
  private blockDelivery = false
  private attached = false
  private collectionUnsub: (() => void) | null = null
  private disposed = false

  // Construction is side-effect-free: sync activation belongs to the first
  // subscription (attach), so building an observer — e.g. in a React render
  // that may be abandoned — cannot activate resources on its own.
  constructor(collection: Collection<T, TKey, any> | null, wholesale: boolean) {
    this.collection = collection
    this.wholesale = wholesale
  }

  getSnapshot(): LiveQuerySnapshot<T, TKey> {
    const collection = this.collection
    if (!collection) return DISABLED_SNAPSHOT

    if (!this.attached) this.refreshDetachedState(collection)

    if (this.snapshotDirty) {
      const entries =
        this.cachedEntries ?? this.captureEntries(collection).entries
      const state = new Map(entries)
      const data = entries.map(([, value]) => value)
      const singleResult = isSingleResultCollection(collection)
      const status = this.visibleStatus ?? collection.status

      this.cachedSnapshot = {
        state,
        data: singleResult ? data[0] : data,
        collection,
        status,
        ...getLiveQueryStatusFlags(status),
        isEnabled: true,
      }
      this.snapshotDirty = false
    }
    return this.cachedSnapshot
  }

  private getCollectionRevision(
    collection: Collection<T, TKey, any>,
  ): number | undefined {
    const revision = (collection as { _stateRevision?: unknown })._stateRevision
    return typeof revision === `number` ? revision : undefined
  }

  private readEntries(collection: Collection<T, TKey, any>): {
    entries: Array<[TKey, T]>
    revision?: number
  } {
    const entries = Array.from(collection.entries()) as Array<[TKey, T]>
    const revision = this.getCollectionRevision(collection)
    return { entries, revision }
  }

  private captureEntries(collection: Collection<T, TKey, any>): {
    entries: Array<[TKey, T]>
    revision?: number
  } {
    const { entries, revision } = this.readEntries(collection)
    this.updateCachedEntries(entries, revision)
    return { entries, revision }
  }

  private updateCachedEntries(
    entries: Array<[TKey, T]>,
    revision: number | undefined,
  ): void {
    const changed =
      revision !== undefined
        ? this.cachedEntries === undefined ||
          revision !== this.cachedCollectionRevision
        : !this.entriesEqual(this.cachedEntries, entries)

    this.cachedEntries = entries
    this.cachedCollectionRevision = revision
    if (changed) this.snapshotDirty = true
  }

  private entriesEqual(
    left: Array<[TKey, T]> | undefined,
    right: Array<[TKey, T]>,
  ): boolean {
    if (!left || left.length !== right.length) return false
    return left.every(
      ([key, value], index) =>
        right[index]![0] === key && right[index]![1] === value,
    )
  }

  /**
   * While detached there is no delivered-publication clock, so fall back to
   * the collection revision. Compatible cross-copy collections that predate
   * `_stateRevision` are compared structurally instead.
   */
  private refreshDetachedState(collection: Collection<T, TKey, any>): void {
    const status = collection.status
    const revision = this.getCollectionRevision(collection)

    if (revision !== undefined) {
      if (
        this.cachedEntries === undefined ||
        revision !== this.cachedCollectionRevision
      ) {
        this.captureEntries(collection)
        this.snapshotDirty = true
      }
    } else {
      const entries = Array.from(collection.entries()) as Array<[TKey, T]>
      this.updateCachedEntries(entries, undefined)
    }

    if (this.visibleStatus !== status) {
      this.visibleStatus = status
      this.snapshotDirty = true
    }
  }

  subscribe(listener: LiveQueryObserverListener<T, TKey>): () => void {
    if (this.disposed) throw new LiveQueryObserverDisposedError()

    const record: SubscriptionRecord<T, TKey> = { listener, active: true }
    this.subscriptions.add(record)
    if (this.subscriptions.size === 1) {
      this.attach()
    } else {
      // The initial-state replay only happens on attach, so a granular
      // subscriber that arrives while already attached is seeded with the
      // current rows — delivered to this subscription alone, without advancing
      // the observer's revision (the collection state did not change).
      // Wholesale consumers read getSnapshot() instead and need no seed.
      if (!this.wholesale) this.seed(record)
    }

    return () => {
      if (!record.active) return
      record.active = false
      this.subscriptions.delete(record)
      if (this.subscriptions.size === 0) this.detach()
    }
  }

  /** Deliver the collection's current rows to one late subscription as inserts. */
  private seed(record: SubscriptionRecord<T, TKey>): void {
    const collection = this.collection
    if (!collection) return

    const seedChanges: Array<ChangeMessage<T, TKey>> = []
    for (const [key, value] of collection.entries() as IterableIterator<
      [TKey, T]
    >) {
      seedChanges.push({ type: `insert`, key, value })
    }
    if (seedChanges.length === 0) return

    this.emit(seedChanges, [record])
  }

  private attach(): void {
    const collection = this.collection
    if (!collection || this.disposed) return
    this.attached = true
    this.visibleStatus ??= collection.status
    this.blockDelivery = this.wholesale

    // Sync activation happens inside subscribeChanges (addSubscriber starts
    // an idle/cleaned-up collection) — the same startSync path the old
    // constructor-time startSyncImmediate() took, but now owned by the first
    // committed subscription and observed by the status listener below.

    // Granular consumers subscribe with initial state so they receive the
    // current rows as inserts followed by deltas through one consistent
    // channel (the collection's per-subscriber change stream requires this to
    // align deltas). Wholesale consumers subscribe WITHOUT initial state —
    // preserving their pre-observer loading policy: no snapshot request means
    // no unfiltered loadSubset({ where: undefined }) against on-demand
    // collections. The explicit `false` marks all state as seen so deletes
    // still flow through as notifies.
    let receivingInitialState = true
    const notify = (
      changes: Array<ChangeMessage<T, TKey>> | undefined,
      status: CollectionStatus = collection.status,
    ) => {
      if (this.disposed || this.subscriptions.size === 0) return
      // An empty batch carries no semantic change (e.g. the collection's
      // empty-ready flush); only real deltas and the synthetic ready notify
      // (undefined) are published.
      if (changes !== undefined && changes.length === 0) return
      const isInitialReplay = receivingInitialState && changes !== undefined
      const captured =
        changes !== undefined && !isInitialReplay
          ? this.readEntries(collection)
          : status === `cleaned-up`
            ? this.readEntries(collection)
            : undefined
      this.emit(
        changes,
        undefined,
        captured?.entries,
        status,
        captured?.revision,
      )
    }

    // Status transitions that carry no change events (loading→ready with no
    // rows, error, cleaned-up) are part of the canonical publication path:
    // any status change publishes a synthetic notify so consumers re-read the
    // snapshot. Unlike onFirstReady, `on` returns a real unsubscribe, so a
    // detached attachment leaves nothing behind.
    const statusUnsub = collection.on(`status:change`, ({ status }) =>
      notify(undefined, status),
    )

    // `subscribeChanges` delivers the initial state synchronously, so a
    // listener can dispose the observer while the collection subscription is
    // still being created. Register the release hook up front; if detach()
    // ran during that replay (collectionUnsub no longer points at our hook),
    // undo the subscription as soon as the call returns.
    let subscription: { unsubscribe: () => void } | null = null
    const release = () => {
      statusUnsub()
      subscription?.unsubscribe()
    }
    this.collectionUnsub = release
    subscription = collection.subscribeChanges(
      (changes) => notify(changes as Array<ChangeMessage<T, TKey>>),
      { includeInitialState: !this.wholesale },
    )
    receivingInitialState = false
    this.blockDelivery = false
    if (this.collectionUnsub !== release) {
      subscription.unsubscribe()
      return
    }
    if (this.wholesale) {
      // Publications raised while subscribeChanges starts sync are part of the
      // subscribe handshake. Apply their final snapshot state now, but suppress
      // listener delivery: useSyncExternalStore performs its consistency read
      // immediately after subscribe returns.
      this.flushPublications(false)
      const { entries, revision } = this.readEntries(collection)
      this.updateCachedEntries(entries, revision)
    }
  }

  private detach(): void {
    this.collectionUnsub?.()
    this.collectionUnsub = null
    this.attached = false
    this.blockDelivery = false
    this.publicationQueue.length = 0
  }

  private emit(
    changes: Array<ChangeMessage<T, TKey>> | undefined,
    targets = Array.from(this.subscriptions),
    entries?: Array<[TKey, T]>,
    status = this.collection?.status ?? `cleaned-up`,
    collectionRevision?: number,
  ): void {
    this.publicationQueue.push({
      changes,
      targets,
      entries,
      status,
      collectionRevision,
    })
    if (this.dispatching || this.blockDelivery) return

    this.flushPublications()
  }

  private flushPublications(deliver = true): void {
    if (this.dispatching) return

    this.dispatching = true
    try {
      // A dispose() during dispatch empties the queue, ending this loop.
      while (this.publicationQueue.length > 0) {
        const publication = this.publicationQueue.shift()!
        if (publication.entries) {
          this.updateCachedEntries(
            publication.entries,
            publication.collectionRevision,
          )
        }
        if (this.visibleStatus !== publication.status) {
          this.visibleStatus = publication.status
          this.snapshotDirty = true
        }
        // Targets are captured when the publication is queued: a subscription
        // removed mid-delivery still receives the in-flight publication, and
        // one added later does not. Late-subscriber seeds use the same queue.
        if (deliver) {
          for (const subRecord of publication.targets) {
            if (this.disposed) return
            subRecord.listener(publication.changes)
          }
        }
      }
    } finally {
      this.dispatching = false
    }
  }

  async preload(): Promise<void> {
    await this.collection?.preload()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.detach()
    for (const subRecord of this.subscriptions) subRecord.active = false
    this.subscriptions.clear()
    this.publicationQueue.length = 0
  }
}

export interface CreateLiveQueryObserverOptions {
  /**
   * How subscribers consume the observer:
   *
   * - `granular` (default): subscribers apply the delivered `ChangeMessage[]`
   *   deltas to their own keyed state (Vue/Svelte/Solid). The observer
   *   subscribes with initial state and seeds late subscribers, so every
   *   subscriber converges from deltas alone.
   * - `wholesale`: subscribers treat notifications as a wake-up and re-read
   *   `getSnapshot()` (React/Angular). The observer subscribes WITHOUT initial
   *   state, preserving those adapters' loading policy — no snapshot request,
   *   so no unfiltered `loadSubset` against on-demand collections. Nothing is
   *   delivered synchronously during `subscribe`, which keeps
   *   `useSyncExternalStore`-style consumers safe by construction.
   */
  mode?: `granular` | `wholesale`
}

/**
 * Create a {@link LiveQueryObserver} for a resolved live-query collection, or a
 * disabled observer when `collection` is `null`/`undefined`.
 *
 * @internal This is an unstable contract shared by TanStack DB's official
 * framework adapters. It is exported so the adapter packages can use it, but
 * it is not a public extension point yet: its API may change in any release
 * without a semver major.
 */
export function createLiveQueryObserver<
  T extends object,
  TKey extends string | number,
>(
  collection: Collection<T, TKey, any> | null | undefined,
  options: CreateLiveQueryObserverOptions = {},
): LiveQueryObserver<T, TKey> {
  return new LiveQueryObserverImpl<T, TKey>(
    collection ?? null,
    options.mode === `wholesale`,
  )
}
