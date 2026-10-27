import { codedMessage, devBuild } from './error-message.js'
import { getBuilderFromConfig } from './query/live/collection-registry.js'
import { getPooledLiveQuerySource } from './query/pooled-source.js'
import type { Collection } from './collection/index.js'
import type { DbClient, DehydratedLiveQueryResult } from './client.js'
import type {
  LiveQueryObserver,
  LiveQuerySnapshot,
} from './live-query-observer.js'
import type { ChangeMessage } from './types.js'

/**
 * DbClient supplies transport behavior to the shared observer. Keeping this
 * implementation behind the client means ordinary framework queries do not
 * import server admission, hydration reconciliation, or streaming machinery.
 */
export interface LiveQueryObserverClientHost<
  T extends object,
  TKey extends string | number,
> {
  observer: LiveQueryObserver<T, TKey>
  read: (forServerSnapshot: boolean) => LiveQuerySnapshot<T, TKey>
  entries: () => Array<[TKey, T]>
  isAttached: () => boolean
  isDisposed: () => boolean
  persistedReady: () => boolean
  dirty: () => void
  publish: (
    changes: Array<ChangeMessage<T, TKey>>,
    entries?: Array<[TKey, T]>,
  ) => void
  preload: () => Promise<void>
}

export class LiveQueryObserverClient<
  T extends object,
  TKey extends string | number,
> {
  private hydrationSeed:
    | {
        dehydratedAt: number
        entries: Array<[TKey, T]>
        snapshot: DehydratedLiveQueryResult
      }
    | undefined
  error: unknown
  failed = false
  private authoritative = false
  private handoffScheduled = false
  private unregisterResource: (() => void) | undefined
  private preloadPromise: Promise<void> | undefined

  constructor(
    private readonly client: DbClient,
    private readonly collection: Collection<T, TKey, any> | null,
    private readonly queryHash: string | undefined,
    private readonly usesSettledHydration: boolean,
    private readonly host: LiveQueryObserverClientHost<T, TKey>,
  ) {}

  get seed() {
    return this.authoritative ? undefined : this.hydrationSeed
  }

  get query() {
    return this.queryHash
      ? this.client._getLiveQuery(this.queryHash)
      : undefined
  }

  sync(forServerSnapshot = false): boolean {
    if (!this.queryHash || this.authoritative) return false
    this.client._waitForSsrLiveQuery(this.queryHash)
    const query = this.client._getLiveQuery(this.queryHash, forServerSnapshot)
    if (!query) return false
    if (
      this.host.isAttached() &&
      !this.hydrationSeed &&
      this.collection?.status === `ready` &&
      !this.collection.isLoadingSubset
    ) {
      return this.markAuthoritative(query.dehydratedAt)
    }
    if (
      query.status === `error` &&
      (this.usesSettledHydration ||
        !forServerSnapshot ||
        !query.initialSnapshot)
    ) {
      const changed = !this.failed || this.error !== query.error
      this.error = query.error
      this.failed = true
      if (changed) this.host.dirty()
      return changed
    }
    const snapshot =
      (!this.usesSettledHydration && query.initialSnapshot) || query.snapshot
    if (!snapshot || this.hydrationSeed?.snapshot === snapshot) return false
    this.hydrationSeed = {
      dehydratedAt: query.dehydratedAt,
      snapshot,
      entries: snapshot.rows.map((row) => [row.key as TKey, row.value as T]),
    }
    this.error = undefined
    this.failed = false
    this.host.dirty()
    return true
  }

  getServerSnapshot(preloadRequested: boolean): LiveQuerySnapshot<T, TKey> {
    preloadRequested &&= this.client._isSsrStreamingEnabled()
    if (
      typeof window !== `undefined` &&
      !this.authoritative &&
      this.queryHash
    ) {
      const waiting = this.client._waitForSsrLiveQuery(this.queryHash, true)
      if (waiting) throw waiting
      const query = this.client._getLiveQuery(this.queryHash, true)
      const snapshot = this.usesSettledHydration
        ? query?.snapshot
        : (query?.initialSnapshot ?? query?.snapshot)
      // A later boundary may hydrate before its result promise arrives.
      // Local rows cannot substitute for the missing server-rendered view.
      if (query?.status === `pending` && !snapshot) {
        if (this.usesSettledHydration)
          void this.host.observer.preloadForInitialRender().catch(() => {})
        throw query.promise
      }
    }
    if (preloadRequested) {
      void this.host.observer.preloadForInitialRender().catch(() => {})
    }
    const snapshot = this.host.read(true)
    const collection = this.collection
    if (!collection || this.seed) return snapshot
    // React also calls this getter in the browser during hydration. Only
    // server reads perform admission; transported seeds win over local activity.
    if (typeof window !== `undefined`) return snapshot
    // A suspended component has not rendered this loading view. Its settled
    // stream will supply the first rendered result.
    if (preloadRequested && !snapshot.isReady) return snapshot

    const { sources } = this.getSourceInfo()
    const entries = this.host.entries()
    if (
      !this.queryHash ||
      (!preloadRequested &&
        (entries.length > 0 || snapshot.isReady) &&
        !(sources ?? [collection]).every((source) =>
          this.client._hasSsrCollectionSnapshot(source),
        ))
    ) {
      throw new Error(
        devBuild() && process.env.NODE_ENV !== `production`
          ? `SSR cannot render server-only live-query rows or readiness. Await DbClient.preloadLiveQuery() for this query, or explicitly preload its source Collections for hydration. Opaque queries require an explicit serializable queryKey.`
          : codedMessage(252),
      )
    }
    // Capture at render, rather than sampling mutable source rows at dehydrate.
    // Loading views transfer rows without answering a later data preload.
    this.client._captureServerQuery(
      this.queryHash,
      {
        rows: entries.map(([key, value]) => ({ key, value })),
        ...(snapshot.isReady
          ? {}
          : {
              status: snapshot.isError
                ? (`error` as const)
                : (`loading` as const),
            }),
      },
      sources,
    )
    return this.host.read(true)
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
      if (previousValue === undefined)
        changes.push({ type: `insert`, key, value })
      else if (previousValue !== value)
        changes.push({ type: `update`, key, value, previousValue })
    }
    return changes
  }

  markAuthoritative(dehydratedAt?: number): boolean {
    if (this.authoritative) return false
    dehydratedAt ??= this.query?.dehydratedAt
    const changed = this.failed
    this.error = undefined
    this.failed = false
    this.authoritative = true
    if (dehydratedAt !== undefined && this.queryHash)
      this.client._consumeLiveQueryResult(this.queryHash, dehydratedAt)
    if (changed) this.host.dirty()
    return changed
  }

  scheduleHandoff(): void {
    if (this.handoffScheduled) return
    this.handoffScheduled = true
    queueMicrotask(() => {
      this.handoffScheduled = false
      this.handoff()
    })
  }

  handoff(): void {
    const collection = this.collection
    if (
      this.host.isDisposed() ||
      !this.host.isAttached() ||
      !collection ||
      !this.seed ||
      (collection.status !== `error` &&
        ((collection.status !== `ready` && !this.host.persistedReady()) ||
          collection.isLoadingSubset))
    )
      return
    const previous = this.seed.entries
    const dehydratedAt = this.seed.dehydratedAt
    const entries = Array.from(collection.entries()) as Array<[TKey, T]>
    this.hydrationSeed = undefined
    this.markAuthoritative(dehydratedAt)
    this.host.publish(this.diffEntries(previous, entries), entries)
  }

  assertSources(): void {
    const { sources } = this.getSourceInfo()
    if (this.queryHash && sources)
      this.client._assertLiveQuerySources(this.queryHash, sources)
  }

  subscribe(): () => void {
    if (!this.queryHash) return () => {}
    return this.client.subscribe((event) => {
      if (
        event.type === `liveQueryStreamError` ||
        event.query.queryHash !== this.queryHash
      )
        return
      const previous = this.host.entries()
      if (this.sync())
        this.host.publish(this.diffEntries(previous, this.host.entries()))
    })
  }

  registerResource(): void {
    const config: object | undefined = this.collection?.config
    if (
      this.unregisterResource ||
      !this.client._isSsrServerCleanupEnabled() ||
      !config ||
      !getBuilderFromConfig(config)
    )
      return
    this.unregisterResource = this.client._registerLiveQueryResource(
      this.host.observer,
      async () => {
        this.host.observer.dispose()
        await this.collection?.cleanup()
      },
    )
  }

  takeResourceRelease(): (() => void) | undefined {
    const release = this.unregisterResource
    this.unregisterResource = undefined
    return release
  }

  private getSourceInfo() {
    const collection = this.collection
    const config = collection?.config
    const pooledSource = collection && getPooledLiveQuerySource(collection)
    const sources = config
      ? getBuilderFromConfig(config)?.getSourceCollections()
      : pooledSource
        ? [pooledSource]
        : undefined
    return { sources, pooledSource: pooledSource || undefined }
  }

  preload(): Promise<void> {
    if (this.preloadPromise) return this.preloadPromise
    const { sources, pooledSource } = this.getSourceInfo()
    if (this.queryHash) {
      const query = this.query
      try {
        this.client._waitForSsrLiveQuery(this.queryHash)
        if (sources)
          this.client._assertLiveQuerySources(this.queryHash, sources)
        if (
          query?.status === `pending` ||
          (query?.status === `success` && query.snapshot?.status === undefined)
        ) {
          if (pooledSource && this.collection)
            return Promise.all([query.promise, this.collection.preload()]).then(
              () => {},
            )
          // Stream reuse remains explicit demand for the local Collection.
          this.collection?._markPreload()
          return query.status === `pending` ? query.promise : Promise.resolve()
        }
      } catch (error) {
        return Promise.reject(error)
      }
    }
    this.registerResource()
    const collectionPromise = this.host.preload()
    const promise =
      this.client._isSsrStreamingEnabled() && this.queryHash
        ? this.client._registerLiveQuery(
            this.queryHash,
            collectionPromise.then(() => this.host.observer.dehydrate()),
            sources,
          )
        : collectionPromise
    this.preloadPromise = promise
    const clear = () => {
      if (this.preloadPromise === promise) this.preloadPromise = undefined
    }
    void promise.then(clear, clear)
    return promise
  }
}
