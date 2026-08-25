import { createCollection } from './collection/index.js'
import {
  collectionOptionsBrand,
  collectionOptionsFactory,
  hasCollectionOptionsBrand,
} from './collection-options.js'
import { TransactionScope } from './transactions.js'
import { getBuilderFromConfig } from './query/live/collection-registry.js'
import { createLiveQueryCollection } from './query/live-query-collection.js'
import { createLiveQueryObserver } from './live-query-observer.js'
import { createDeferred } from './deferred.js'
import {
  getLiveQueryHash,
  prepareLiveQueryValue,
} from './live-query-options.js'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { Collection } from './collection/index.js'
import type { CollectionOptionsIdentity } from './collection-options.js'
import type {
  CollectionConfig,
  InferSchemaInput,
  InferSchemaOutput,
  NonSingleResult,
  SingleResult,
  TransactionConfig,
  UtilsRecord,
} from './types.js'
import type {
  DeferredLiveQueryCollections,
  LiveQueryOptions,
} from './live-query-options.js'

const collectionConfigFactory: unique symbol = Symbol.for(
  `@tanstack/db.collectionConfig.factory`,
) as never

type AnyCollectionConfig = CollectionConfig<any, any, any, any>

export type CollectionOptions<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
  TSchema extends StandardSchemaV1 = never,
  TUtils extends UtilsRecord = UtilsRecord,
> = CollectionOptionsIdentity<T, TKey, TSchema, TUtils, DbClient>

type AnyCollectionOptions = CollectionOptions<any, any, any, any>
type AnyCollection = Collection<any, any, any, any, any>

type DescriptorFromConfig<TConfig extends AnyCollectionConfig> =
  TConfig extends {
    getKey: (item: infer T) => infer TKey
  }
    ? CollectionOptions<
        Extract<T, object>,
        Extract<TKey, string | number>,
        TConfig extends {
          schema: infer TSchema extends StandardSchemaV1
        }
          ? TSchema
          : never,
        TConfig extends {
          utils: infer TUtils extends UtilsRecord
        }
          ? TUtils
          : UtilsRecord
      > &
        (TConfig extends SingleResult ? SingleResult : NonSingleResult)
    : never

type CollectionConfigWithFactory<TConfig extends AnyCollectionConfig> =
  TConfig & {
    readonly [collectionConfigFactory]: (client: DbClient) => TConfig
  }

/**
 * Adds a fresh-config materializer to an adapter options object.
 *
 * Adapter option creators should use this so a module-scoped descriptor can be
 * materialized safely by more than one DbClient.
 */
export function withCollectionConfigFactory<
  TConfig extends AnyCollectionConfig,
>(
  config: TConfig,
  factory: (client: DbClient) => TConfig,
): CollectionConfigWithFactory<TConfig> {
  Object.defineProperty(config, collectionConfigFactory, {
    value: factory,
    enumerable: false,
  })
  return config as CollectionConfigWithFactory<TConfig>
}

export type CollectionMaterializeOptions<T extends object> = {
  initialData?: Array<T>
}

export type DehydratedCollectionRow<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
> = {
  key: TKey
  value: T
  metadata?: unknown
}

export type DehydratedCollectionChunk<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
> = {
  collectionId: string
  rows: Array<DehydratedCollectionRow<T, TKey>>
  syncMeta?: unknown
}

export type DehydratedLiveQuery = {
  queryHash: string
  dehydratedAt: number
  snapshot?: DehydratedLiveQueryResult
  promise?: Promise<DehydratedLiveQueryResult>
}

export type DehydratedLiveQueryResult<
  T extends object = object,
  TKey extends string | number = string | number,
> = {
  rows: Array<DehydratedCollectionRow<T, TKey>>
}

export type DehydratedDbState = {
  collections: Array<DehydratedCollectionChunk>
  liveQueries?: Array<DehydratedLiveQuery>
}

export type DbClientLiveQueryState = `pending` | `success` | `error`

export type DbClientLiveQuery = {
  readonly queryHash: string
  readonly dehydratedAt: number
  readonly status: DbClientLiveQueryState
  readonly promise: Promise<void>
  readonly snapshot?: DehydratedLiveQueryResult
  readonly error?: unknown
}

export type DbClientEvent =
  | {
      type: `liveQueryAdded` | `liveQueryUpdated`
      query: DbClientLiveQuery
    }
  | {
      type: `liveQueryStreamError`
      error: unknown
    }

export type DehydrateDbClientOptions = {
  shouldDehydrateCollection?: (collection: Collection) => boolean
  shouldDehydrateLiveQuery?: (query: DbClientLiveQuery) => boolean
}

type CollectionRecord = {
  collection: AnyCollection
  shouldDehydrate: boolean
}

type LiveQueryRecord = {
  queryHash: string
  dehydratedAt: number
  status: DbClientLiveQueryState
  promise: Promise<void>
  resultPromise: Promise<DehydratedLiveQueryResult>
  succeed: (snapshot: DehydratedLiveQueryResult) => void
  fail: (error: unknown) => void
  snapshot?: DehydratedLiveQueryResult
  error?: unknown
}

export type DbClientOptions = Record<string, unknown>

export function collectionOptions<
  T extends StandardSchemaV1,
  TKey extends string | number,
  TUtils extends UtilsRecord,
>(
  options: CollectionConfig<InferSchemaOutput<T>, TKey, T, TUtils> & {
    schema: T
  } & NonSingleResult,
): CollectionOptions<InferSchemaOutput<T>, TKey, T, TUtils> & NonSingleResult
export function collectionOptions<
  T extends StandardSchemaV1,
  TKey extends string | number,
  TUtils extends UtilsRecord,
>(
  options: CollectionConfig<InferSchemaOutput<T>, TKey, T, TUtils> & {
    schema: T
  } & SingleResult,
): CollectionOptions<InferSchemaOutput<T>, TKey, T, TUtils> & SingleResult
export function collectionOptions<
  T extends object,
  TKey extends string | number = string | number,
  TUtils extends UtilsRecord = UtilsRecord,
>(
  options: CollectionConfig<T, TKey, never, TUtils> & {
    schema?: never
  } & NonSingleResult,
): CollectionOptions<T, TKey, never, TUtils> & NonSingleResult
export function collectionOptions<
  T extends object,
  TKey extends string | number = string | number,
  TUtils extends UtilsRecord = UtilsRecord,
>(
  options: CollectionConfig<T, TKey, never, TUtils> & {
    schema?: never
  } & SingleResult,
): CollectionOptions<T, TKey, never, TUtils> & SingleResult
export function collectionOptions<TConfig extends AnyCollectionConfig>(
  id: string,
  factory: (client: DbClient) => TConfig,
): DescriptorFromConfig<TConfig>
export function collectionOptions(
  optionsOrId: AnyCollectionConfig | string,
  explicitFactory?: (client: DbClient) => unknown,
): any {
  const config = typeof optionsOrId === `string` ? undefined : optionsOrId
  const id = typeof optionsOrId === `string` ? optionsOrId : optionsOrId.id

  if (!id) {
    throw new Error(
      `collectionOptions requires a non-empty explicit id so the descriptor is stable across DbClient instances and SSR boundaries.`,
    )
  }

  if (typeof optionsOrId === `string` && !explicitFactory) {
    throw new Error(
      `collectionOptions("${id}") requires a factory as its second argument.`,
    )
  }

  const reusableFactory:
    | ((client: DbClient) => AnyCollectionConfig)
    | undefined = config
    ? (config as CollectionConfigWithFactory<AnyCollectionConfig>)[
        collectionConfigFactory
      ]
    : (explicitFactory as
        | ((client: DbClient) => AnyCollectionConfig)
        | undefined)

  let owner: DbClient | undefined
  const materialize = (client: DbClient): AnyCollectionConfig => {
    let materialized: AnyCollectionConfig

    if (reusableFactory) {
      materialized = reusableFactory(client)
    } else {
      if (owner && owner !== client) {
        throw new Error(
          `Collection descriptor "${id}" was created from a concrete config that cannot be safely reused across DbClient instances. ` +
            `Use collectionOptions("${id}", (client) => adapterCollectionOptions(...)) or an adapter options creator that supports DbClient materialization.`,
        )
      }
      owner = client
      materialized = config!
    }

    if (materialized.id !== undefined && materialized.id !== id) {
      throw new Error(
        `Collection descriptor "${id}" materialized a config with id "${materialized.id}". Descriptor and collection ids must match.`,
      )
    }

    return materialized.id === id ? materialized : { ...materialized, id }
  }

  const descriptor = {
    id,
    ...((config as { singleResult?: boolean } | undefined)?.singleResult ===
    true
      ? { singleResult: true as const }
      : {}),
  } as Record<PropertyKey, unknown>

  Object.defineProperties(descriptor, {
    [collectionOptionsBrand]: {
      value: true,
      enumerable: false,
    },
    [collectionOptionsFactory]: {
      value: materialize,
      enumerable: false,
    },
  })

  return Object.freeze(descriptor) as CollectionOptions<
    any,
    string | number,
    any,
    UtilsRecord
  >
}

export function isCollectionOptions(
  value: unknown,
): value is CollectionOptions<any, string | number, any, UtilsRecord> {
  return hasCollectionOptionsBrand(value)
}

export class DbClient {
  private collectionsByOptions = new WeakMap<object, AnyCollection>()
  private collectionsById = new Map<string, CollectionRecord>()
  private pendingHydration = new Map<string, Array<DehydratedCollectionChunk>>()
  private liveQueries = new Map<string, LiveQueryRecord>()
  private preloadedLiveQueries = new Map<
    string,
    {
      collection: AnyCollection
      observer: { dispose: () => void }
    }
  >()
  private liveQueryResources = new Map<object, () => Promise<void>>()
  private listeners = new Set<(event: DbClientEvent) => void>()
  private ssrStreamingEnabled = false
  private ssrServerCleanupEnabled = false
  private lastLiveQueryTimestamp = 0
  private readonly transactionScope = new TransactionScope()

  constructor(private readonly options: DbClientOptions = {}) {}

  getDependency<T>(key: string): T | undefined {
    return this.options[key] as T | undefined
  }

  requireDependency<T>(key: string): T {
    const dependency = this.getDependency<T>(key)
    if (dependency === undefined) {
      throw new Error(
        `DbClient is missing the required "${key}" dependency. Pass it explicitly when constructing the client: new DbClient({ ${key} }).`,
      )
    }
    return dependency
  }

  get activeTransaction() {
    return this.transactionScope.getActiveTransaction()
  }

  createTransaction<T extends object = Record<string, unknown>>(
    config: TransactionConfig<T>,
  ) {
    return this.transactionScope.createTransaction(config)
  }

  preloadLiveQuery(options: LiveQueryOptions): Promise<void> {
    const deferredCollections: DeferredLiveQueryCollections = new Set()
    try {
      const prepared = prepareLiveQueryValue(options, this, deferredCollections)
      const queryHash = getLiveQueryHash(prepared, options.queryKey)
      const existing = this.liveQueries.get(queryHash)
      if (existing && existing.status !== `error`) return existing.promise

      const failedPreload = this.preloadedLiveQueries.get(queryHash)
      if (failedPreload) {
        failedPreload.observer.dispose()
        void failedPreload.collection.cleanup().catch(() => {})
        this.preloadedLiveQueries.delete(queryHash)
      }

      const collection = createLiveQueryCollection({
        ...(prepared as LiveQueryOptions),
        startSync: true,
      }) as AnyCollection
      const observer = createLiveQueryObserver(collection, {
        client: this,
        queryHash,
        mode: `wholesale`,
      })
      this.preloadedLiveQueries.set(queryHash, { collection, observer })

      return this._registerLiveQuery(
        queryHash,
        collection.preload().then(() => observer.dehydrate()),
      )
    } finally {
      for (const source of deferredCollections) source._resumeSyncStart()
      deferredCollections.clear()
    }
  }

  collection<
    T extends StandardSchemaV1,
    TKey extends string | number,
    TUtils extends UtilsRecord,
  >(
    options: CollectionOptions<InferSchemaOutput<T>, TKey, T, TUtils> &
      NonSingleResult,
    materializeOptions?: CollectionMaterializeOptions<InferSchemaInput<T>>,
  ): Collection<InferSchemaOutput<T>, TKey, TUtils, T, InferSchemaInput<T>> &
    NonSingleResult
  collection<
    T extends StandardSchemaV1,
    TKey extends string | number,
    TUtils extends UtilsRecord,
  >(
    options: CollectionOptions<InferSchemaOutput<T>, TKey, T, TUtils> &
      SingleResult,
    materializeOptions?: CollectionMaterializeOptions<InferSchemaInput<T>>,
  ): Collection<InferSchemaOutput<T>, TKey, TUtils, T, InferSchemaInput<T>> &
    SingleResult
  collection<
    T extends object,
    TKey extends string | number = string | number,
    TUtils extends UtilsRecord = UtilsRecord,
  >(
    options: CollectionOptions<T, TKey, never, TUtils> & NonSingleResult,
    materializeOptions?: CollectionMaterializeOptions<T>,
  ): Collection<T, TKey, TUtils, never, T> & NonSingleResult
  collection<
    T extends object,
    TKey extends string | number = string | number,
    TUtils extends UtilsRecord = UtilsRecord,
  >(
    options: CollectionOptions<T, TKey, never, TUtils> & SingleResult,
    materializeOptions?: CollectionMaterializeOptions<T>,
  ): Collection<T, TKey, TUtils, never, T> & SingleResult
  collection(
    options: AnyCollectionOptions,
    materializeOptions?: CollectionMaterializeOptions<any>,
  ): AnyCollection {
    return this.materializeCollection(options, materializeOptions, false)
  }

  /** @internal */
  _materializeCollectionForRender<
    T extends object,
    TKey extends string | number,
    TSchema extends StandardSchemaV1,
    TUtils extends UtilsRecord,
  >(
    options: CollectionOptions<T, TKey, TSchema, TUtils>,
  ): Collection<
    T,
    TKey,
    TUtils,
    TSchema,
    [TSchema] extends [never] ? T : InferSchemaInput<TSchema>
  > {
    return this.materializeCollection(options, undefined, true)
  }

  private materializeCollection(
    options: AnyCollectionOptions,
    materializeOptions: CollectionMaterializeOptions<any> | undefined,
    deferSyncStart: boolean,
  ): AnyCollection {
    const existing = this.collectionsByOptions.get(options)
    if (existing) {
      if (!deferSyncStart) {
        this.collectionsById.get(existing.id)!.shouldDehydrate = true
      }
      if (deferSyncStart) {
        existing._deferSyncStart()
      }
      return existing
    }

    if (this.collectionsById.has(options.id)) {
      throw new Error(
        `Cannot materialize collection "${options.id}" because this DbClient already has a different collection with that id. SSR hydration requires collection ids to be unique per DbClient.`,
      )
    }

    const config = options[collectionOptionsFactory](this)
    const shouldStartSync = config.startSync === true
    const collection = createCollection({
      ...config,
      startSync: false,
    } as any)
    collection._setTransactionScope(this.transactionScope)
    if (deferSyncStart) {
      collection._deferSyncStart()
    }

    this.collectionsByOptions.set(options, collection)
    this.collectionsById.set(collection.id, {
      collection,
      shouldDehydrate: !deferSyncStart,
    })

    if (materializeOptions?.initialData?.length) {
      this.applyRows(
        collection,
        {
          collectionId: collection.id,
          rows: materializeOptions.initialData.map((value) => ({ value })),
        },
        `initialData`,
      )
    }

    const pendingChunks = this.pendingHydration.get(collection.id)
    if (pendingChunks) {
      for (const chunk of pendingChunks) {
        this.applyRows(collection, chunk, `hydration`)
      }
      this.pendingHydration.delete(collection.id)
    }

    if (shouldStartSync) {
      collection.startSyncImmediate()
    }

    return collection
  }

  dehydrate(options: DehydrateDbClientOptions = {}): DehydratedDbState {
    const collections: Array<DehydratedCollectionChunk> = []

    for (const {
      collection,
      shouldDehydrate,
    } of this.collectionsById.values()) {
      const collectionDecision = options.shouldDehydrateCollection?.(collection)
      if (
        getBuilderFromConfig(collection.config) ||
        collectionDecision === false ||
        (!shouldDehydrate && collectionDecision !== true)
      ) {
        continue
      }

      const rows = Array.from(collection._state.syncedData.entries()).map(
        ([key, value]) => {
          const metadata = collection._state.syncedMetadata.get(key)
          return {
            key,
            value,
            ...(metadata === undefined ? {} : { metadata }),
          }
        },
      )

      collections.push({
        collectionId: collection.id,
        rows,
        syncMeta: collection.config.sync.exportSyncMeta?.(),
      })
    }

    const liveQueries = Array.from(this.liveQueries.values()).flatMap(
      (query): Array<DehydratedLiveQuery> => {
        const shouldDehydrate =
          options.shouldDehydrateLiveQuery?.(query) ??
          query.status === `success`
        if (!shouldDehydrate || query.status === `error`) {
          return []
        }

        return [
          {
            queryHash: query.queryHash,
            dehydratedAt: query.dehydratedAt,
            ...(query.snapshot
              ? { snapshot: query.snapshot }
              : { promise: query.resultPromise }),
          },
        ]
      },
    )

    return {
      collections,
      ...(liveQueries.length > 0 ? { liveQueries } : {}),
    }
  }

  hydrate(state: DehydratedDbState): void {
    for (const chunk of state.collections) {
      const record = this.collectionsById.get(chunk.collectionId)
      if (record) {
        this.applyRows(record.collection, chunk, `hydration`)
        continue
      }

      const pendingChunks = this.pendingHydration.get(chunk.collectionId) ?? []
      pendingChunks.push(chunk)
      this.pendingHydration.set(chunk.collectionId, pendingChunks)
    }

    for (const dehydratedQuery of state.liveQueries ?? []) {
      this.hydrateLiveQuery(dehydratedQuery)
    }
  }

  applyCollectionChunk(chunk: DehydratedCollectionChunk): void {
    this.hydrate({ collections: [chunk] })
  }

  subscribe(listener: (event: DbClientEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** @internal */
  _setSsrStreamingEnabled(enabled: boolean): void {
    this.ssrStreamingEnabled = enabled
  }

  /** @internal */
  _isSsrStreamingEnabled(): boolean {
    return this.ssrStreamingEnabled
  }

  /** @internal */
  _setSsrServerCleanupEnabled(enabled: boolean): void {
    this.ssrServerCleanupEnabled = enabled
  }

  /** @internal */
  _isSsrServerCleanupEnabled(): boolean {
    return this.ssrServerCleanupEnabled
  }

  /** @internal */
  _getLiveQuery(queryHash: string): DbClientLiveQuery | undefined {
    return this.liveQueries.get(queryHash)
  }

  /** @internal */
  _consumeLiveQueryResult(queryHash: string, dehydratedAt: number): void {
    const record = this.liveQueries.get(queryHash)
    if (record?.dehydratedAt === dehydratedAt) {
      this.liveQueries.delete(queryHash)
    }
  }

  /** @internal */
  _registerLiveQuery(
    queryHash: string,
    promise: Promise<DehydratedLiveQueryResult>,
  ): Promise<void> {
    const existing = this.liveQueries.get(queryHash)
    if (existing && existing.status !== `error`) {
      void Promise.resolve(promise).catch(() => {})
      return existing.promise
    }

    const record = this.createLiveQueryRecord(
      queryHash,
      this.nextLiveQueryTimestamp(),
    )

    this.liveQueries.set(queryHash, record)
    this.emit({ type: `liveQueryAdded`, query: record })
    Promise.resolve(promise).then(record.succeed, record.fail)
    return record.promise
  }

  /** @internal */
  _registerLiveQueryResource(
    owner: object,
    cleanup: () => Promise<void>,
  ): () => void {
    this.liveQueryResources.set(owner, cleanup)
    return () => {
      if (this.liveQueryResources.get(owner) === cleanup) {
        this.liveQueryResources.delete(owner)
      }
    }
  }

  /** @internal */
  _failPendingLiveQueries(error: unknown): void {
    for (const record of this.liveQueries.values()) {
      if (record.status === `pending`) record.fail(error)
    }
    this.emit({ type: `liveQueryStreamError`, error })
  }

  async cleanup(): Promise<void> {
    try {
      const materializedCollections = Array.from(
        this.collectionsById.values(),
        ({ collection }) => collection,
      )
      const preloadedQueries = Array.from(this.preloadedLiveQueries.values())
      const liveQueryCollections = new Set([
        ...preloadedQueries.map(({ collection }) => collection),
        ...materializedCollections.filter((collection) =>
          getBuilderFromConfig(collection.config),
        ),
      ])

      for (const { observer } of preloadedQueries) observer.dispose()

      const cleanupResults = [
        ...(await Promise.allSettled(
          Array.from(this.liveQueryResources.values(), (cleanup) => cleanup()),
        )),
        ...(await Promise.allSettled(
          Array.from(liveQueryCollections, (collection) =>
            collection.cleanup(),
          ),
        )),
        ...(await Promise.allSettled(
          materializedCollections
            .filter((collection) => !liveQueryCollections.has(collection))
            .map((collection) => collection.cleanup()),
        )),
      ]
      const failure = cleanupResults.find(
        (result): result is PromiseRejectedResult =>
          result.status === `rejected`,
      )
      if (failure) throw failure.reason
    } finally {
      this.transactionScope.clear()
      this.collectionsByOptions = new WeakMap()
      this.collectionsById.clear()
      this.pendingHydration.clear()
      this.liveQueries.clear()
      this.preloadedLiveQueries.clear()
      this.liveQueryResources.clear()
      this.listeners.clear()
      this.ssrStreamingEnabled = false
      this.ssrServerCleanupEnabled = false
      this.lastLiveQueryTimestamp = 0
    }
  }

  private hydrateLiveQuery(dehydratedQuery: DehydratedLiveQuery): void {
    const existing = this.liveQueries.get(dehydratedQuery.queryHash)
    if (existing && existing.dehydratedAt >= dehydratedQuery.dehydratedAt) {
      return
    }

    const record = this.createLiveQueryRecord(
      dehydratedQuery.queryHash,
      dehydratedQuery.dehydratedAt,
    )
    this.liveQueries.set(record.queryHash, record)
    if (existing?.status === `pending`) {
      void record.resultPromise.then(existing.succeed, existing.fail)
    }
    this.emit({ type: `liveQueryAdded`, query: record })

    if (dehydratedQuery.snapshot) {
      record.succeed(dehydratedQuery.snapshot)
    } else if (dehydratedQuery.promise) {
      Promise.resolve(dehydratedQuery.promise).then(record.succeed, record.fail)
    } else {
      record.fail(
        new Error(
          `Dehydrated live query "${dehydratedQuery.queryHash}" has neither a snapshot nor a promise.`,
        ),
      )
    }
  }

  private nextLiveQueryTimestamp(): number {
    this.lastLiveQueryTimestamp = Math.max(
      Date.now(),
      this.lastLiveQueryTimestamp + 1,
    )
    return this.lastLiveQueryTimestamp
  }

  private createLiveQueryRecord(
    queryHash: string,
    dehydratedAt: number,
  ): LiveQueryRecord {
    this.lastLiveQueryTimestamp = Math.max(
      this.lastLiveQueryTimestamp,
      dehydratedAt,
    )

    let resolveResult!: (snapshot: DehydratedLiveQueryResult) => void
    let rejectResult!: (error: unknown) => void
    let settled = false
    const resultPromise = new Promise<DehydratedLiveQueryResult>(
      (resolve, reject) => {
        resolveResult = resolve
        rejectResult = reject
      },
    )
    const promise = resultPromise.then(() => undefined)
    resultPromise.catch(() => {})
    promise.catch(() => {})

    const record: LiveQueryRecord = {
      queryHash,
      dehydratedAt,
      status: `pending`,
      promise,
      resultPromise,
      succeed: (snapshot) => {
        if (settled) return
        settled = true
        record.status = `success`
        record.snapshot = snapshot
        resolveResult(snapshot)
        if (this.liveQueries.get(queryHash) === record) {
          this.emit({ type: `liveQueryUpdated`, query: record })
        }
      },
      fail: (error) => {
        if (settled) return
        settled = true
        record.status = `error`
        record.error = error
        rejectResult(error)
        if (this.liveQueries.get(queryHash) === record) {
          this.emit({ type: `liveQueryUpdated`, query: record })
        }
      },
    }

    return record
  }

  private emit(event: DbClientEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  private applyRows(
    collection: Collection<any, string | number, any, any, any>,
    chunk: Omit<DehydratedCollectionChunk, `rows`> & {
      rows: Array<
        Omit<DehydratedCollectionRow, `key`> & {
          key?: string | number
        }
      >
    },
    seedKind?: `initialData` | `hydration`,
  ): void {
    const rows = chunk.rows.flatMap((row) => {
      const value = collection.validateData(row.value, `insert`)
      const key = collection.config.getKey(value)
      const isAdapterAuthoritative =
        seedKind === `hydration` &&
        collection._state.syncedData.has(key) &&
        !collection._state.hydrationSeedKeys.has(key)

      return isAdapterAuthoritative ? [] : [{ ...row, key, value }]
    })
    const rowMetadataWrites = new Map<
      string | number,
      { type: `set`; value: unknown } | { type: `delete` }
    >()

    for (const row of rows) {
      if (row.metadata !== undefined) {
        rowMetadataWrites.set(row.key, { type: `set`, value: row.metadata })
      }
    }

    if (seedKind) {
      for (const row of rows) {
        collection._state.hydrationSeedKeys.add(row.key)
        if (seedKind === `hydration`) {
          collection._state.hydratedKeys.add(row.key)
        }
      }
    }

    if (rows.length > 0) {
      collection._state.pendingSyncedTransactions.push({
        committed: true,
        applicationStarted: false,
        layoutChanged: false,
        operations: rows.map((row) => ({
          type: collection._state.syncedData.has(row.key)
            ? (`update` as const)
            : (`insert` as const),
          key: row.key,
          value: row.value,
        })),
        deletedKeys: new Set(),
        rowMetadataWrites,
        collectionMetadataWrites: new Map(),
        applied: createDeferred<void>(),
        immediate: true,
        preserveHydrationSeedKeys: seedKind !== undefined,
      })
      collection._state.commitPendingTransactions()
    }

    if (chunk.syncMeta !== undefined) {
      const currentMeta = collection.config.sync.exportSyncMeta?.()
      const mergedMeta =
        currentMeta === undefined
          ? chunk.syncMeta
          : (collection.config.sync.mergeSyncMeta?.(
              currentMeta,
              chunk.syncMeta,
            ) ?? chunk.syncMeta)
      collection.config.sync.importSyncMeta?.(mergedMeta)
    }
  }
}
