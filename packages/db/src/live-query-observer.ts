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
 * reference. `state`/`data` are computed lazily and cached per snapshot.
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
  private cachedRevision = -1
  private cachedStatus: CollectionStatus | undefined
  private cachedSnapshot: LiveQuerySnapshot<T, TKey> = DISABLED_SNAPSHOT
  private readonly subscriptions = new Set<SubscriptionRecord<T, TKey>>()
  // Publications are dispatched FIFO: an emit that happens while another
  // publication is being delivered (a listener mutating the collection
  // synchronously) is queued, never delivered reentrantly.
  private readonly publicationQueue: Array<
    Array<ChangeMessage<T, TKey>> | undefined
  > = []
  private dispatching = false
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

    // The semantic clock: rebuild only when the collection's own state
    // revision or status moved. The revision advances on every committed
    // change — even while nothing is subscribed, so a detached snapshot never
    // goes stale — and is untouched by subscription bootstrap replays, so
    // resubscribing never manufactures a new snapshot identity.
    if (
      this.cachedRevision !== collection._stateRevision ||
      this.cachedStatus !== collection.status
    ) {
      this.cachedRevision = collection._stateRevision
      this.cachedStatus = collection.status
      const singleResult = isSingleResultCollection(collection)
      // Rows are materialized lazily on first `state`/`data` access, so a
      // consumer that only reads `status` never enumerates the collection.
      let entriesCache: Array<[TKey, T]> | null = null
      let stateCache: Map<TKey, T> | null = null
      let dataCache: Array<T> | null = null
      const readEntries = () =>
        (entriesCache ??= Array.from(collection.entries()) as Array<[TKey, T]>)

      this.cachedSnapshot = {
        get state() {
          return (stateCache ??= new Map(readEntries()))
        },
        get data() {
          dataCache ??= readEntries().map(([, value]) => value)
          return singleResult ? dataCache[0] : dataCache
        },
        collection,
        status: collection.status,
        ...getLiveQueryStatusFlags(collection.status),
        isEnabled: true,
      }
    }
    return this.cachedSnapshot
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

    record.listener(seedChanges)
  }

  private attach(): void {
    const collection = this.collection
    if (!collection || this.disposed) return

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
    const notify = (changes: Array<ChangeMessage<T, TKey>> | undefined) => {
      if (this.disposed || this.subscriptions.size === 0) return
      // An empty batch carries no semantic change (e.g. the collection's
      // empty-ready flush); only real deltas and the synthetic ready notify
      // (undefined) are published.
      if (changes !== undefined && changes.length === 0) return
      this.emit(changes)
    }

    // Status transitions that carry no change events (loading→ready with no
    // rows, error, cleaned-up) are part of the canonical publication path:
    // any status change publishes a synthetic notify so consumers re-read the
    // snapshot. Unlike onFirstReady, `on` returns a real unsubscribe, so a
    // detached attachment leaves nothing behind.
    const statusUnsub = collection.on(`status:change`, () => notify(undefined))

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
    if (this.collectionUnsub !== release) {
      subscription.unsubscribe()
      return
    }
  }

  private detach(): void {
    this.collectionUnsub?.()
    this.collectionUnsub = null
  }

  private emit(changes: Array<ChangeMessage<T, TKey>> | undefined): void {
    this.publicationQueue.push(changes)
    if (this.dispatching) return

    this.dispatching = true
    try {
      // A dispose() during dispatch empties the queue, ending this loop.
      while (this.publicationQueue.length > 0) {
        const publication = this.publicationQueue.shift()!
        // Deliver over a snapshot of the records taken when this publication
        // is dispatched: a subscription removed mid-delivery still receives
        // the in-flight publication; one added mid-delivery does not.
        const records = Array.from(this.subscriptions)
        for (const subRecord of records) {
          if (this.disposed) return
          subRecord.listener(publication)
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
