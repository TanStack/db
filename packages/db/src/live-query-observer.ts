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
 * the shared lifecycle every framework adapter needs: start sync, subscribe to
 * changes, handle the already-ready race, expose a stable snapshot for
 * wholesale consumers, and deliver the raw change set for granular consumers.
 *
 * Input resolution (query fn / config / collection / disabled) stays in the
 * adapter — it is framework-reactive. The observer owns everything after the
 * input is resolved to a concrete collection.
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
  private readonly deferInitialNotify: boolean
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
  // Bumped on each attach. `onFirstReady` can't be unsubscribed, so a callback
  // from a superseded attach checks this to no-op instead of double-notifying.
  private attachGeneration = 0
  private disposed = false

  constructor(
    collection: Collection<T, TKey, any> | null,
    deferInitialNotify: boolean,
  ) {
    this.collection = collection
    this.deferInitialNotify = deferInitialNotify
    // Starting sync during resolution matches every adapter's eager behavior.
    collection?.startSyncImmediate()
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
      const entries = Array.from(collection.entries()) as Array<[TKey, T]>
      const singleResult = isSingleResultCollection(collection)
      let stateCache: Map<TKey, T> | null = null
      let dataCache: Array<T> | null = null

      this.cachedSnapshot = {
        get state() {
          if (!stateCache) stateCache = new Map(entries)
          return stateCache
        },
        get data() {
          if (!dataCache) dataCache = entries.map(([, value]) => value)
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
      // The initial-state replay only happens on attach, so a subscriber that
      // arrives while already attached is seeded with the current rows —
      // delivered to this subscription alone, without advancing the observer's
      // revision (the collection state did not change).
      this.seed(record)
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

    const deliver = () => {
      if (record.active) record.listener(seedChanges)
    }
    if (this.deferInitialNotify) queueMicrotask(deliver)
    else deliver()
  }

  private attach(): void {
    const collection = this.collection
    if (!collection || this.disposed) return

    const generation = ++this.attachGeneration

    // Subscribe with initial state so granular consumers receive the current
    // rows as inserts followed by deltas through one consistent channel — the
    // same contract the adapters used before the observer existed (the
    // collection's per-subscriber change stream requires this to align deltes).
    //
    // When `deferInitialNotify` is set, emits that fire synchronously while
    // attaching (the initial-state batch and an immediately-ready `onFirstReady`)
    // are deferred to a microtask, so a wholesale consumer like React's
    // `useSyncExternalStore` never receives a synchronous notify during
    // `subscribe`. Effect/watcher-based adapters want the initial state
    // synchronously, so by default it is not deferred. Later changes always emit
    // synchronously.
    let attaching = this.deferInitialNotify
    const deferred: Array<Array<ChangeMessage<T, TKey>> | undefined> = []
    const notify = (changes: Array<ChangeMessage<T, TKey>> | undefined) => {
      if (this.disposed || this.subscriptions.size === 0) return
      // An empty batch carries no semantic change (e.g. the collection's
      // empty-ready flush); only real deltas and the synthetic ready notify
      // (undefined) are published.
      if (changes !== undefined && changes.length === 0) return
      if (attaching) deferred.push(changes)
      else this.emit(changes)
    }

    // `subscribeChanges` delivers the initial state synchronously, so a
    // listener can dispose the observer while the collection subscription is
    // still being created. Register the release hook up front; if detach()
    // ran during that replay (collectionUnsub no longer points at our hook),
    // undo the subscription as soon as the call returns.
    let subscription: { unsubscribe: () => void } | null = null
    const release = () => subscription?.unsubscribe()
    this.collectionUnsub = release
    subscription = collection.subscribeChanges(
      (changes) => notify(changes as Array<ChangeMessage<T, TKey>>),
      { includeInitialState: true },
    )
    if (this.collectionUnsub !== release) {
      subscription.unsubscribe()
      return
    }

    // Catch a *later* loading→ready transition that carries no change events
    // (e.g. `markReady()` with no rows). Skip when already ready — the initial
    // state batch above already covers that, and `onFirstReady` would fire an
    // immediate duplicate.
    //
    // `onFirstReady` returns no unsubscribe, so a callback left behind by an
    // earlier attach (subscribe → unsubscribe-before-ready → subscribe) would
    // still fire on `markReady`. Guard with the attach generation so only the
    // current attachment's callback notifies.
    if (collection.status !== `ready`) {
      collection.onFirstReady(() => {
        if (generation !== this.attachGeneration) return
        notify(undefined)
      })
    }

    attaching = false
    if (deferred.length > 0) {
      queueMicrotask(() => {
        // Skip if the observer was disposed, has no listeners, or a newer
        // attach superseded this one before the flush — otherwise a stale
        // initial batch would reach the current listener.
        if (
          this.disposed ||
          this.subscriptions.size === 0 ||
          generation !== this.attachGeneration
        ) {
          return
        }
        for (const changes of deferred.splice(0)) this.emit(changes)
      })
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
   * Defer the initial-state notify to a microtask instead of emitting it
   * synchronously during `subscribe`. Set this for `useSyncExternalStore`-style
   * consumers (React) that must not receive a store notify during subscribe.
   * Effect/watcher-based adapters leave it off to get initial state synchronously.
   */
  deferInitialNotify?: boolean
}

/**
 * Create a {@link LiveQueryObserver} for a resolved live-query collection, or a
 * disabled observer when `collection` is `null`/`undefined`.
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
    options.deferInitialNotify ?? false,
  )
}
