import { LiveQueryObserverDisposedError } from './errors.js'
import { runAllCallbacks } from './utils/callbacks.js'
import {
  getLiveQueryStatusFlags,
  getPublicCollection,
  isFailedStatus,
  isSingleResultCollection,
} from './live-query-primitives.js'
import { describeProblem } from './collection/lifecycle.js'
import type { Collection } from './collection/index.js'
import type { LiveQueryObserverClient } from './live-query-observer-client.js'
import type { DbClient, DehydratedLiveQueryResult } from './client.js'
import type { ChangeMessage, CollectionStatus, HealthNode } from './types.js'

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
  /** The first load failed: there is nothing to show. */
  isLoadingError: boolean
  /** Local storage or an invariant broke. Only a cascade cleanup and a fresh start recover. */
  isCrashed: boolean
  isCleanedUp: boolean
  isEnabled: boolean
  /**
   * The data is shown, and something keeps it from staying current: a sync
   * problem or a failed request somewhere in `health`.
   */
  isSyncError: boolean
  /**
   * The health tree for the query and every Collection it depends on, or
   * `undefined` for a disabled query. After the first ready, a source
   * problem shows here and the data stays.
   */
  health: HealthNode | undefined
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
  /** Server snapshot. preloadRequested marks an explicit streaming Suspense load. */
  getServerSnapshot: (preloadRequested?: boolean) => LiveQuerySnapshot<T, TKey>
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
  isLoadingError: false,
  isCrashed: false,
  isCleanedUp: false,
  isEnabled: false,
  isSyncError: false,
  health: undefined,
}

class LiveQueryObserverImpl<
  T extends object,
  TKey extends string | number,
> implements LiveQueryObserver<T, TKey> {
  private readonly collection: Collection<T, TKey, any> | null
  private readonly wholesale: boolean
  private readonly clientBinding: LiveQueryObserverClient<T, TKey> | undefined
  private readonly onPreload: (() => void) | undefined
  private visibleStatus: CollectionStatus | undefined
  private cachedEntries: Array<[TKey, T]> | undefined
  private cachedCollectionRevision: number | undefined
  private cachedCollectionLayoutRevision: number | undefined
  private snapshotDirty = true
  // While attached, the tree from the last status or health change. Every
  // tree change is announced, so a snapshot reuses it instead of rebuilding.
  private publishedHealth: { tree: HealthNode | undefined } | undefined
  // Whether the cached snapshot was built for the hydration read.
  private cachedServerView = false
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
    suspendUntilReady: boolean,
  ) {
    this.collection = collection
    this.wholesale = wholesale
    this.onPreload = onPreload
    this.clientBinding = client?._bindLiveQueryObserver(
      collection,
      queryHash,
      suspendUntilReady,
      {
        observer: this,
        read: (server) => this.getSnapshot(server),
        entries: () => (collection ? this.getVisibleEntries(collection) : []),
        isAttached: () => this.attached,
        isDisposed: () => this.disposed,
        dirty: () => {
          this.snapshotDirty = true
        },
        publish: (changes, entries) => {
          const revision =
            entries && collection
              ? this.getCollectionRevision(collection)
              : undefined
          if (entries) {
            this.updateCachedEntries(entries, revision)
            this.snapshotDirty = true
          }
          this.emit(
            this.wholesale ? undefined : changes,
            undefined,
            entries,
            collection?.status,
            revision,
            entries && collection
              ? this.getCollectionLayoutRevision(collection)
              : undefined,
            entries !== undefined,
          )
        },
        preload: () => this.preloadCollection(),
      },
    )
    this.clientBinding?.registerResource()
  }

  getSnapshot(forServerSnapshot = false): LiveQuerySnapshot<T, TKey> {
    const collection = this.collection
    if (!collection) return DISABLED_SNAPSHOT

    this.clientBinding?.sync(forServerSnapshot)
    if (!this.attached) this.refreshDetachedState(collection)

    // The hydration read and an ordinary read differ only while a seed
    // stands in front of a failure.
    if (
      this.cachedServerView !== forServerSnapshot &&
      this.clientBinding?.seed &&
      isFailedStatus(this.visibleStatus ?? collection.status)
    ) {
      this.snapshotDirty = true
    }

    if (this.snapshotDirty) {
      const entries = this.getVisibleEntries(collection)
      const data = entries.map(([, value]) => value)
      const singleResult = isSingleResultCollection(collection)
      const liveStatus = this.visibleStatus ?? collection.status
      // The seed stands in only for a result that is still coming, so an
      // ordinary read never hides a failure behind it. The hydration read
      // keeps the server's view: it must reproduce what the server rendered.
      const status = this.clientBinding?.failed
        ? (`error` as const)
        : this.clientBinding?.seed &&
            (forServerSnapshot || !isFailedStatus(liveStatus))
          ? (this.clientBinding.seed.snapshot.status ?? `ready`)
          : liveStatus
      this.cachedServerView = forServerSnapshot

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

      const health = this.publishedHealth
        ? this.publishedHealth.tree
        : (collection as { health?: HealthNode }).health
      // Most consumers read only `data`; build the keyed view on first read.
      let state: Map<TKey, T> | undefined
      this.cachedSnapshot = {
        get state() {
          return (state ??= new Map(entries))
        },
        data: singleResult ? data[0] : data,
        collection: getPublicCollection(collection),
        layoutRevision: this.layoutRevision,
        status,
        ...getLiveQueryStatusFlags(status, health),
        isEnabled: true,
      }
      this.snapshotDirty = false
    }
    return this.cachedSnapshot
  }

  getServerSnapshot(preloadRequested = false): LiveQuerySnapshot<T, TKey> {
    return (
      this.clientBinding?.getServerSnapshot(preloadRequested) ??
      this.getSnapshot()
    )
  }

  getError(): unknown {
    this.clientBinding?.sync()
    return this.clientBinding?.error
  }

  dehydrate(): DehydratedLiveQueryResult<T, TKey> {
    const collection = this.collection
    if (!collection) return { rows: [] }

    const entries =
      this.clientBinding?.seed &&
      this.clientBinding.seed.snapshot.status === undefined
        ? this.clientBinding.seed.entries
        : this.readEntries(collection).entries

    return {
      rows: entries.map(([key, value]) => ({
        key,
        value,
      })),
    }
  }

  private getVisibleEntries(
    collection: Collection<T, TKey, any>,
  ): Array<[TKey, T]> {
    if (this.clientBinding?.seed) return this.clientBinding.seed.entries
    return this.cachedEntries ?? this.captureEntries(collection).entries
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

    // A health-only change moves no row or status. Trees keep their identity
    // until their content changes, so identity tells whether it went stale.
    if (
      this.visibleStatus !== status ||
      this.cachedSnapshot.health !==
        (collection as { health?: HealthNode }).health
    ) {
      this.visibleStatus = status
      this.snapshotDirty = true
    }
  }

  subscribe(listener: LiveQueryObserverListener<T, TKey>): () => void {
    if (this.disposed) throw new LiveQueryObserverDisposedError()
    if (this.subscriptions.size === 0) this.clientBinding?.assertSources()

    const record: SubscriptionRecord<T, TKey> = { listener, active: true }
    const release = () => {
      if (!record.active) return
      record.active = false
      this.subscriptions.delete(record)
      if (this.subscriptions.size === 0) this.detach()
    }
    this.subscriptions.add(record)
    const attaching = !this.attached
    try {
      if (attaching) {
        this.attach()
      } else {
        // Seed only this late granular listener; a failed seed releases its
        // record without detaching peers that already own subscriptions.
        if (!this.wholesale) this.seed(record)
      }
    } catch (error) {
      // Setup returned no ownership handle. Release every acquired channel
      // and the logical record, so a later explicit subscription can attach.
      if (attaching) this.detach()
      release()
      throw error
    }
    return release
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
    // Install ownership before any registration can call back or throw.
    const releases: Array<() => void> = []
    const release = () => runAllCallbacks(releases.splice(0))
    this.collectionUnsub = release
    const ownRelease = (unsubscribe: () => void) => {
      if (this.collectionUnsub === release) releases.push(unsubscribe)
      else unsubscribe()
    }
    this.clientBinding?.registerResource()
    this.clientBinding?.sync()
    this.refreshDetachedState(collection)
    this.attached = true
    this.visibleStatus ??= collection.status
    this.deliveredLayoutRevision = this.getCollectionLayoutRevision(collection)
    const attachedWithHydrationSeed = !!this.clientBinding?.seed
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

      if (this.clientBinding?.seed) {
        // Startup remains behind the hydration cut. A later failure ends the
        // sync run whose result the seed stood in for, and is already an
        // owned publication, so it must be visible synchronously.
        if (isFailedStatus(status) && !this.blockDelivery)
          this.clientBinding.handoff()
        else if (status === `ready` || isFailedStatus(status))
          this.clientBinding.scheduleHandoff()
        return
      }

      if (status === `ready` && !collection.isLoadingSubset) {
        this.clientBinding?.markAuthoritative()
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
    // A health change below the query changes its health tree, not its rows.
    // Each status change is followed by a health change; tree identity
    // tells whether the health change has anything left to publish.
    const healthOf = () => (collection as { health?: HealthNode }).health
    this.publishedHealth = { tree: healthOf() }
    ownRelease(() => {
      this.publishedHealth = undefined
    })
    ownRelease(
      collection.on(`status:change`, ({ status }) => {
        this.publishedHealth = { tree: healthOf() }
        notify(undefined, status)
      }),
    )
    ownRelease(
      collection.on(`health:change`, () => {
        const health = healthOf()
        if (health === this.publishedHealth?.tree) return
        this.publishedHealth = { tree: health }
        // No rows or status changed, so only this marks the snapshot stale.
        this.snapshotDirty = true
        notify(undefined, collection.status)
      }),
    )
    const subscribeLayoutChanges = (
      collection as Collection<T, TKey, any> & {
        _subscribeLayoutChanges?: (listener: () => void) => () => void
      }
    )._subscribeLayoutChanges
    if (typeof subscribeLayoutChanges === `function`) {
      ownRelease(
        subscribeLayoutChanges.call(collection, () =>
          notify([], collection.status, true),
        ),
      )
    }
    // `subscribeChanges` delivers the initial state synchronously, so a
    // listener can dispose the observer while the collection subscription is
    // still being created. Register the release hook up front; if detach()
    // ran during that replay (collectionUnsub no longer points at our hook),
    // undo the subscription as soon as the call returns.
    if (this.clientBinding) ownRelease(this.clientBinding.subscribe())
    const subscription = collection.subscribeChanges(
      (changes) => notify(changes as Array<ChangeMessage<T, TKey>>),
      { includeInitialState: !this.wholesale && !attachedWithHydrationSeed },
    )
    ownRelease(() => subscription.unsubscribe())
    this.blockDelivery = false
    if (this.collectionUnsub !== release) return
    if (this.wholesale || attachedWithHydrationSeed) {
      // Publications raised while subscribeChanges starts sync are part of the
      // subscribe handshake. Apply their final snapshot state now, but suppress
      // listener delivery: useSyncExternalStore performs its consistency read
      // immediately after subscribe returns.
      this.flushPublications(!this.wholesale)
      // The render-time read is still current unless the handshake published.
      const revision = this.getCollectionRevision(collection)
      const layoutRevision = this.getCollectionLayoutRevision(collection)
      if (
        revision === undefined ||
        this.cachedEntries === undefined ||
        revision !== this.cachedCollectionRevision ||
        layoutRevision !== this.cachedCollectionLayoutRevision
      ) {
        const { entries } = this.readEntries(collection)
        this.updateCachedEntries(entries, revision)
        this.cachedCollectionLayoutRevision = layoutRevision
      }
    }
    if (this.clientBinding?.seed) {
      if (!this.wholesale) this.seed(Array.from(this.subscriptions)[0]!)
      if (collection.status === `ready` || isFailedStatus(collection.status)) {
        this.clientBinding.scheduleHandoff()
      }
    }
  }

  private detach(): void {
    const release = this.collectionUnsub
    const unregister = this.clientBinding?.takeResourceRelease()
    this.collectionUnsub = null
    this.attached = false
    this.blockDelivery = false
    this.publicationQueue.length = 0
    runAllCallbacks([() => release?.(), () => unregister?.()])
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

    let failure: { error: unknown } | undefined
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
            if (this.disposed) break
            try {
              subRecord.listener(publication.changes)
            } catch (error) {
              failure ??= { error }
            }
          }
        }
      }
    } finally {
      this.dispatching = false
    }
    if (failure) throw failure.error
  }

  preload(): Promise<void> {
    return this.clientBinding?.preload() ?? this.preloadCollection()
  }

  private preloadCollection(): Promise<void> {
    if (this.preloadPromise) return this.preloadPromise
    this.onPreload?.()
    const promise = this.collection?.preload() ?? Promise.resolve()
    this.preloadPromise = promise
    const clear = () => {
      if (this.preloadPromise === promise) this.preloadPromise = undefined
    }
    void promise.then(clear, clear)
    return promise
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
  /** Read the completed stream rather than an earlier ordinary loading view. */
  suspendUntilReady?: boolean
}

/**
 * The Error an adapter sends to an error boundary for a failed first load or
 * a crash: the cause itself when it is an Error, otherwise an Error with the
 * problem's message (as in `health.error.message`) whose `cause` is the value
 * the sync adapter reported.
 *
 * @internal Shared by TanStack DB's official framework adapters.
 */
export const toBoundaryError = (cause: unknown): Error =>
  cause instanceof Error
    ? cause
    : new Error(describeProblem(cause).message, { cause })

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
    options.suspendUntilReady === true,
  )
}
