import { LiveQueryObserverDisposedError } from './errors.js'
import {
  getLiveQueryStatusFlags,
  isSingleResultCollection,
} from './live-query-adapter.js'
import { getBuilderFromConfig } from './query/live/collection-registry.js'
import type { Collection } from './collection/index.js'
import type { DbClient, DehydratedLiveQueryResult } from './client.js'
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
  /**
   * Monotonic counter bumped whenever the visible layout (the ordered key
   * sequence) changes — membership, ordering, or an order-only move. Lets
   * consumers detect a reorder that changed no row value (which `data`/`state`
   * identity alone can't express once row values are structurally shared).
   *
   * It is NOT in lockstep with snapshot identity: a value-only update produces a
   * new snapshot while `layoutRevision` stays put. A `layoutRevision` change
   * always accompanies a new snapshot, but not vice versa.
   */
  layoutRevision: number
  status: CollectionStatus | `disabled`
  isLoading: boolean
  isReady: boolean
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
  isEnabled: boolean
}

/**
 * Listener payload: changes, `[]` for an internal layout-only publication, or
 * `undefined` for a synthetic status/ready notification.
 */
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
  /** Stable server snapshot used by useSyncExternalStore-style adapters. */
  getServerSnapshot: () => LiveQuerySnapshot<T, TKey>
  /**
   * Subscribe to changes. The listener receives the change set (or `undefined`
   * for the synthetic notify a ready collection emits on attach). Granular
   * adapters apply the changes; wholesale adapters can ignore them and re-read
   * `getSnapshot()`. Returns an unsubscribe function.
   */
  subscribe: (listener: LiveQueryObserverListener<T, TKey>) => () => void
  /** Resolve once the collection has loaded its first data. */
  preload: () => Promise<void>
  /** The transport or preload error for this query, if it has not produced data. */
  getError: () => unknown
  /** Capture the ordered query result without serializing its source collections. */
  dehydrate: () => DehydratedLiveQueryResult<T, TKey>
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
  collectionLayoutRevision?: number
  layoutChanged: boolean
}

const DISABLED_SNAPSHOT: LiveQuerySnapshot<any, any> = {
  state: undefined,
  data: undefined,
  collection: undefined,
  layoutRevision: 0,
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
  private readonly client: DbClient | undefined
  private readonly queryHash: string | undefined
  private readonly onPreload: (() => void) | undefined
  private visibleStatus: CollectionStatus | undefined
  private cachedEntries: Array<[TKey, T]> | undefined
  private cachedCollectionRevision: number | undefined
  private cachedCollectionLayoutRevision: number | undefined
  private snapshotDirty = true
  private cachedSnapshot: LiveQuerySnapshot<T, TKey> = DISABLED_SNAPSHOT
  private layoutRevision = 0
  private lastLayoutKeys: Array<TKey> | undefined
  private deliveredLayoutRevision: number | undefined
  private readonly subscriptions = new Set<SubscriptionRecord<T, TKey>>()
  // Publications are dispatched FIFO: an emit that happens while another
  // publication is being delivered (a listener mutating the collection
  // synchronously) is queued, never delivered reentrantly.
  private readonly publicationQueue: Array<Publication<T, TKey>> = []
  private dispatching = false
  private blockDelivery = false
  private attached = false
  private collectionUnsub: (() => void) | null = null
  private unregisterClientResource: (() => void) | undefined
  private hydrationSeed:
    | {
        dehydratedAt: number
        entries: Array<[TKey, T]>
      }
    | undefined
  private hydrationError: unknown
  private hasHydrationError = false
  private liveResultIsAuthoritative = false
  private handoffScheduled = false
  private preloadPromise: Promise<void> | undefined
  private disposed = false

  // Sync activation belongs to the first subscription (attach), so building
  // an observer cannot activate collection resources on its own. Server
  // request clients still record ownership here because React may render an
  // observer without ever subscribing to it.
  constructor(
    collection: Collection<T, TKey, any> | null,
    wholesale: boolean,
    client: DbClient | undefined,
    queryHash: string | undefined,
    onPreload: (() => void) | undefined,
  ) {
    this.collection = collection
    this.wholesale = wholesale
    this.client = client
    this.queryHash = queryHash
    this.onPreload = onPreload
    this.registerClientResource()
  }

  getSnapshot(): LiveQuerySnapshot<T, TKey> {
    const collection = this.collection
    if (!collection) return DISABLED_SNAPSHOT

    this.syncHydrationState()
    if (!this.attached) this.refreshDetachedState(collection)

    if (this.snapshotDirty) {
      const entries = this.getVisibleEntries(collection)
      const state = new Map(entries)
      const data = entries.map(([, value]) => value)
      const singleResult = isSingleResultCollection(collection)
      const liveStatus = this.visibleStatus ?? collection.status
      const status =
        this.hasHydrationError || liveStatus === `error`
          ? (`error` as const)
          : this.hasHydrationSeed()
            ? (`ready` as const)
            : liveStatus

      // Bump the layout revision when the ordered key sequence changes
      // (membership, ordering, or an order-only move). Compare the key sequence
      // directly rather than via a serialized signature: a joined-with-separator
      // signature can collide when a key value equals the concatenation of
      // neighboring keys around the separator. Comparing keys also avoids
      // materializing a large string on every rebuild; a new key array is only
      // allocated when the layout actually moved.
      const prevKeys = this.lastLayoutKeys
      let layoutChanged =
        prevKeys === undefined || prevKeys.length !== entries.length
      if (!layoutChanged) {
        for (let i = 0; i < entries.length; i++) {
          if (prevKeys![i] !== entries[i]![0]) {
            layoutChanged = true
            break
          }
        }
      }
      if (layoutChanged) {
        this.lastLayoutKeys = entries.map(([key]) => key)
        this.layoutRevision++
      }

      this.cachedSnapshot = {
        state,
        data: singleResult ? data[0] : data,
        collection,
        layoutRevision: this.layoutRevision,
        status,
        ...getLiveQueryStatusFlags(status),
        isEnabled: true,
      }
      this.snapshotDirty = false
    }
    return this.cachedSnapshot
  }

  getServerSnapshot(): LiveQuerySnapshot<T, TKey> {
    return this.getSnapshot()
  }

  getError(): unknown {
    this.syncHydrationState()
    return this.hasHydrationError ? this.hydrationError : undefined
  }

  dehydrate(): DehydratedLiveQueryResult<T, TKey> {
    const collection = this.collection
    if (!collection) return { rows: [] }

    const entries = this.hasHydrationSeed()
      ? this.hydrationSeed!.entries
      : this.readEntries(collection).entries

    return {
      rows: entries.map(([key, value]) => ({
        key,
        value,
      })),
    }
  }

  private hasHydrationSeed(): boolean {
    return this.hydrationSeed !== undefined && !this.liveResultIsAuthoritative
  }

  private getVisibleEntries(
    collection: Collection<T, TKey, any>,
  ): Array<[TKey, T]> {
    if (this.hasHydrationSeed()) return this.hydrationSeed!.entries
    return this.cachedEntries ?? this.captureEntries(collection).entries
  }

  private syncHydrationState(): boolean {
    if (!this.client || !this.queryHash || this.liveResultIsAuthoritative) {
      return false
    }

    const query = this.client._getLiveQuery(this.queryHash)
    if (!query) return false

    if (
      this.attached &&
      !this.hydrationSeed &&
      this.collection?.status === `ready` &&
      !this.collection.isLoadingSubset
    ) {
      return this.markLiveResultAuthoritative(query.dehydratedAt)
    }

    if (query.status === `error`) {
      const changed =
        !this.hasHydrationError || this.hydrationError !== query.error
      this.hydrationError = query.error
      this.hasHydrationError = true
      if (changed) this.snapshotDirty = true
      return changed
    }

    if (
      query.status !== `success` ||
      !query.snapshot ||
      (this.hydrationSeed &&
        this.hydrationSeed.dehydratedAt >= query.dehydratedAt)
    ) {
      return false
    }

    this.hydrationSeed = {
      dehydratedAt: query.dehydratedAt,
      entries: query.snapshot.rows.map((row) => [
        row.key as TKey,
        row.value as T,
      ]),
    }
    this.hydrationError = undefined
    this.hasHydrationError = false
    this.snapshotDirty = true
    return true
  }

  private diffEntries(
    previous: Array<[TKey, T]>,
    next: Array<[TKey, T]>,
  ): Array<ChangeMessage<T, TKey>> {
    const previousByKey = new Map(previous)
    const nextByKey = new Map(next)
    const changes: Array<ChangeMessage<T, TKey>> = []

    for (const [key, value] of previous) {
      if (!nextByKey.has(key)) changes.push({ type: `delete`, key, value })
    }
    for (const [key, value] of next) {
      const previousValue = previousByKey.get(key)
      if (previousValue === undefined) {
        changes.push({ type: `insert`, key, value })
      } else if (previousValue !== value) {
        changes.push({
          type: `update`,
          key,
          value,
          previousValue,
        })
      }
    }

    return changes
  }

  private handoffHydrationSeed(collection: Collection<T, TKey, any>): {
    changes: Array<ChangeMessage<T, TKey>>
    entries: Array<[TKey, T]>
    revision?: number
  } {
    const previous = this.hydrationSeed?.entries ?? []
    const dehydratedAt = this.hydrationSeed?.dehydratedAt
    const { entries, revision } = this.readEntries(collection)
    this.hydrationSeed = undefined
    this.markLiveResultAuthoritative(dehydratedAt)
    this.updateCachedEntries(entries, revision)
    this.snapshotDirty = true
    return {
      changes: this.diffEntries(previous, entries),
      entries,
      revision,
    }
  }

  private markLiveResultAuthoritative(dehydratedAt?: number): boolean {
    const changed = this.hasHydrationError
    this.hydrationError = undefined
    this.hasHydrationError = false
    this.liveResultIsAuthoritative = true
    if (dehydratedAt !== undefined && this.queryHash) {
      this.client?._consumeLiveQueryResult(this.queryHash, dehydratedAt)
    }
    if (changed) this.snapshotDirty = true
    return changed
  }

  private scheduleHydrationHandoff(): void {
    if (this.handoffScheduled) return
    this.handoffScheduled = true

    queueMicrotask(() => {
      this.handoffScheduled = false
      const collection = this.collection
      if (
        this.disposed ||
        !this.attached ||
        !collection ||
        !this.hasHydrationSeed() ||
        collection.status !== `ready` ||
        collection.isLoadingSubset
      ) {
        return
      }

      const handoff = this.handoffHydrationSeed(collection)
      this.emit(
        this.wholesale ? undefined : handoff.changes,
        undefined,
        handoff.entries,
        collection.status,
        handoff.revision,
        this.getCollectionLayoutRevision(collection),
        true,
      )
    })
  }

  private getCollectionRevision(
    collection: Collection<T, TKey, any>,
  ): number | undefined {
    const revision = (collection as { _stateRevision?: unknown })._stateRevision
    return typeof revision === `number` ? revision : undefined
  }

  private getCollectionLayoutRevision(
    collection: Collection<T, TKey, any>,
  ): number | undefined {
    const revision = (collection as { _layoutRevision?: unknown })
      ._layoutRevision
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
    const layoutRevision = this.getCollectionLayoutRevision(collection)

    if (revision !== undefined) {
      if (
        this.cachedEntries === undefined ||
        revision !== this.cachedCollectionRevision ||
        layoutRevision !== this.cachedCollectionLayoutRevision
      ) {
        this.captureEntries(collection)
        this.cachedCollectionLayoutRevision = layoutRevision
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
    for (const [key, value] of this.getVisibleEntries(collection)) {
      seedChanges.push({ type: `insert`, key, value })
    }
    if (seedChanges.length === 0) return

    this.emit(seedChanges, [record])
  }

  private attach(): void {
    const collection = this.collection
    if (!collection || this.disposed) return
    this.registerClientResource()
    this.syncHydrationState()
    this.refreshDetachedState(collection)
    this.attached = true
    this.visibleStatus ??= collection.status
    this.deliveredLayoutRevision = this.getCollectionLayoutRevision(collection)
    const attachedWithHydrationSeed = this.hasHydrationSeed()
    this.blockDelivery = this.wholesale || attachedWithHydrationSeed

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
    const notify = (
      changes: Array<ChangeMessage<T, TKey>> | undefined,
      status: CollectionStatus = collection.status,
      explicitLayoutChange = false,
    ) => {
      if (this.disposed || this.subscriptions.size === 0) return

      if (this.hasHydrationSeed()) {
        if (status === `ready`) this.scheduleHydrationHandoff()
        if (status !== `error`) return
      }

      if (
        status === `ready` &&
        !collection.isLoadingSubset &&
        !this.liveResultIsAuthoritative &&
        this.client &&
        this.queryHash
      ) {
        const query = this.client._getLiveQuery(this.queryHash)
        this.markLiveResultAuthoritative(query?.dehydratedAt)
      }

      const layoutRevision = this.getCollectionLayoutRevision(collection)
      let layoutChanged = explicitLayoutChange
      if (
        !explicitLayoutChange &&
        changes !== undefined &&
        changes.length === 0
      ) {
        // Empty ready events predate the explicit layout signal and share its
        // empty-array payload. Only forward an empty batch when the collection
        // confirms that a new layout-only publication occurred.
        if (
          layoutRevision === undefined ||
          layoutRevision === this.deliveredLayoutRevision
        ) {
          return
        }
        layoutChanged = true
      }
      if (changes !== undefined && layoutRevision !== undefined) {
        this.deliveredLayoutRevision = layoutRevision
      }
      const captured =
        changes !== undefined
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
        layoutRevision,
        layoutChanged,
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
    const subscribeLayoutChanges = (
      collection as Collection<T, TKey, any> & {
        _subscribeLayoutChanges?: (listener: () => void) => () => void
      }
    )._subscribeLayoutChanges
    const layoutUnsub =
      typeof subscribeLayoutChanges === `function`
        ? subscribeLayoutChanges.call(collection, () =>
            notify([], collection.status, true),
          )
        : () => {}

    // `subscribeChanges` delivers the initial state synchronously, so a
    // listener can dispose the observer while the collection subscription is
    // still being created. Register the release hook up front; if detach()
    // ran during that replay (collectionUnsub no longer points at our hook),
    // undo the subscription as soon as the call returns.
    let subscription: { unsubscribe: () => void } | null = null
    const clientUnsub =
      this.client && this.queryHash
        ? this.client.subscribe((event) => {
            if (
              event.type === `liveQueryStreamError` ||
              event.query.queryHash !== this.queryHash
            ) {
              return
            }

            const previousEntries = this.getVisibleEntries(collection)
            if (!this.syncHydrationState()) return
            const nextEntries = this.getVisibleEntries(collection)
            this.emit(
              this.wholesale
                ? undefined
                : this.diffEntries(previousEntries, nextEntries),
            )
          })
        : () => {}
    const release = () => {
      clientUnsub()
      statusUnsub()
      layoutUnsub()
      subscription?.unsubscribe()
    }
    this.collectionUnsub = release
    subscription = collection.subscribeChanges(
      (changes) => notify(changes as Array<ChangeMessage<T, TKey>>),
      { includeInitialState: !this.wholesale && !attachedWithHydrationSeed },
    )
    this.blockDelivery = false
    if (this.collectionUnsub !== release) {
      subscription.unsubscribe()
      return
    }
    if (this.wholesale || attachedWithHydrationSeed) {
      // Publications raised while subscribeChanges starts sync are part of the
      // subscribe handshake. Apply their final snapshot state now, but suppress
      // listener delivery: useSyncExternalStore performs its consistency read
      // immediately after subscribe returns.
      this.flushPublications(!this.wholesale)
      const { entries, revision } = this.readEntries(collection)
      this.updateCachedEntries(entries, revision)
    }
    if (this.hasHydrationSeed()) {
      if (!this.wholesale) this.seed(Array.from(this.subscriptions)[0]!)
      if (collection.status === `ready`) this.scheduleHydrationHandoff()
    }
  }

  private detach(): void {
    this.collectionUnsub?.()
    this.collectionUnsub = null
    this.attached = false
    this.blockDelivery = false
    this.publicationQueue.length = 0
    this.unregisterClientResource?.()
    this.unregisterClientResource = undefined
  }

  private registerClientResource(): void {
    if (
      this.unregisterClientResource ||
      !this.client?._isSsrServerCleanupEnabled() ||
      !this.collection ||
      !getBuilderFromConfig(this.collection.config)
    ) {
      return
    }

    this.unregisterClientResource = this.client._registerLiveQueryResource(
      this,
      async () => {
        const collection = this.collection
        this.dispose()
        await collection?.cleanup()
      },
    )
  }

  private emit(
    changes: Array<ChangeMessage<T, TKey>> | undefined,
    targets = Array.from(this.subscriptions),
    entries?: Array<[TKey, T]>,
    status = this.collection?.status ?? `cleaned-up`,
    collectionRevision?: number,
    collectionLayoutRevision?: number,
    layoutChanged = false,
  ): void {
    this.publicationQueue.push({
      changes,
      targets,
      entries,
      status,
      collectionRevision,
      collectionLayoutRevision,
      layoutChanged,
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
        if (publication.collectionLayoutRevision !== undefined) {
          this.cachedCollectionLayoutRevision =
            publication.collectionLayoutRevision
        }
        if (publication.layoutChanged) {
          this.snapshotDirty = true
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

  preload(): Promise<void> {
    if (this.preloadPromise) return this.preloadPromise

    if (this.client && this.queryHash) {
      const query = this.client._getLiveQuery(this.queryHash)
      if (query?.status === `pending`) return query.promise
      if (query?.status === `success`) return Promise.resolve()
    }

    this.registerClientResource()
    this.onPreload?.()
    const collectionPromise = this.collection?.preload() ?? Promise.resolve()
    const preloadPromise =
      this.client?._isSsrStreamingEnabled() && this.queryHash
        ? this.client._registerLiveQuery(
            this.queryHash,
            collectionPromise.then(() => this.dehydrate()),
          )
        : collectionPromise
    this.preloadPromise = preloadPromise
    const clearPreload = () => {
      if (this.preloadPromise === preloadPromise) {
        this.preloadPromise = undefined
      }
    }
    void preloadPromise.then(clearPreload, clearPreload)
    return preloadPromise
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
  /** DbClient cache that owns SSR snapshots for this query identity. */
  client?: DbClient
  /** Stable live-query identity used for dehydration and hydration. */
  queryHash?: string
  /** Resume framework-deferred query sources before a server preload. */
  onPreload?: () => void
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
    options.client,
    options.queryHash,
    options.onPreload,
  )
}
