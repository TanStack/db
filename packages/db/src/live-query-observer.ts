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
  private version = 0
  private cachedVersion = -1
  private cachedSnapshot: LiveQuerySnapshot<T, TKey> = DISABLED_SNAPSHOT
  private readonly listeners = new Set<LiveQueryObserverListener<T, TKey>>()
  private collectionUnsub: (() => void) | null = null
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

    // Rebuild only when the version advanced, so identity stays stable.
    if (this.cachedVersion !== this.version) {
      this.cachedVersion = this.version
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
    this.listeners.add(listener)
    if (this.listeners.size === 1) this.attach()

    let active = true
    return () => {
      if (!active) return
      active = false
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.detach()
    }
  }

  private attach(): void {
    const collection = this.collection
    if (!collection || this.disposed) return

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
      if (this.disposed || this.listeners.size === 0) return
      if (attaching) deferred.push(changes)
      else this.emit(changes)
    }

    const subscription = collection.subscribeChanges(
      (changes) => notify(changes as Array<ChangeMessage<T, TKey>>),
      { includeInitialState: true },
    )
    this.collectionUnsub = () => subscription.unsubscribe()

    // Catch a *later* loading→ready transition that carries no change events
    // (e.g. `markReady()` with no rows). Skip when already ready — the initial
    // state batch above already covers that, and `onFirstReady` would fire an
    // immediate duplicate.
    if (collection.status !== `ready`) {
      collection.onFirstReady(() => notify(undefined))
    }

    attaching = false
    if (deferred.length > 0) {
      queueMicrotask(() => {
        if (this.disposed) return
        for (const changes of deferred.splice(0)) this.emit(changes)
      })
    }
  }

  private detach(): void {
    this.collectionUnsub?.()
    this.collectionUnsub = null
  }

  private emit(changes: Array<ChangeMessage<T, TKey>> | undefined): void {
    this.version++
    this.listeners.forEach((listener) => listener(changes))
  }

  async preload(): Promise<void> {
    await this.collection?.preload()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.detach()
    this.listeners.clear()
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
