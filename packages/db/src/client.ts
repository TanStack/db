import { createCollection } from './collection/index.js'
import { TransactionScope } from './transactions.js'
import { getBuilderFromConfig } from './query/live/collection-registry.js'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { Collection } from './collection/index.js'
import type {
  CollectionConfig,
  InferSchemaInput,
  InferSchemaOutput,
  NonSingleResult,
  SingleResult,
  TransactionConfig,
  UtilsRecord,
} from './types.js'

const collectionOptionsBrand: unique symbol = Symbol.for(
  `@tanstack/db.collectionOptions`,
) as never
const collectionOptionsFactory: unique symbol = Symbol.for(
  `@tanstack/db.collectionOptions.factory`,
) as never
const collectionConfigFactory: unique symbol = Symbol.for(
  `@tanstack/db.collectionConfig.factory`,
) as never

type AnyCollectionConfig = CollectionConfig<any, any, any, any>

export type CollectionOptions<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
  TSchema extends StandardSchemaV1 = never,
  TUtils extends UtilsRecord = UtilsRecord,
> = {
  readonly id: string
  readonly [collectionOptionsBrand]: true
  readonly [collectionOptionsFactory]: (
    client: DbClient,
  ) => CollectionConfig<T, TKey, TSchema, TUtils>
}

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
  promise: Promise<DehydratedDbState>
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
  readonly error?: unknown
}

export type DbClientEvent = {
  type: `liveQueryAdded`
  query: DbClientLiveQuery
}

export type DehydrateDbClientOptions = {
  shouldDehydrateCollection?: (collection: Collection) => boolean
  shouldDehydrateLiveQuery?: (query: DbClientLiveQuery) => boolean
}

type CollectionRecord = {
  collection: AnyCollection
}

type LiveQueryRecord = {
  queryHash: string
  dehydratedAt: number
  status: DbClientLiveQueryState
  promise: Promise<void>
  dehydratedPromise: Promise<DehydratedDbState>
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
  return (
    typeof value === `object` &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[collectionOptionsBrand] === true
  )
}

export class DbClient {
  private collectionsByOptions = new WeakMap<object, AnyCollection>()
  private collectionsById = new Map<string, CollectionRecord>()
  private pendingHydration = new Map<string, Array<DehydratedCollectionChunk>>()
  private liveQueries = new Map<string, LiveQueryRecord>()
  private listeners = new Set<(event: DbClientEvent) => void>()
  private ssrStreamingEnabled = false
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
    })

    if (materializeOptions?.initialData?.length) {
      this.applyRows(
        collection,
        {
          collectionId: collection.id,
          rows: materializeOptions.initialData.map((value) => {
            const validated = collection.validateData(value, `insert`)
            return {
              key: config.getKey(validated),
              value: validated,
            }
          }),
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

    for (const { collection } of this.collectionsById.values()) {
      if (
        getBuilderFromConfig(collection.config) ||
        options.shouldDehydrateCollection?.(collection) === false
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
      (query) =>
        options.shouldDehydrateLiveQuery?.(query) === true
          ? [
              {
                queryHash: query.queryHash,
                dehydratedAt: query.dehydratedAt,
                promise: query.dehydratedPromise,
              },
            ]
          : [],
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
        this.applyRows(
          record.collection,
          chunk,
          record.collection.status !== `ready` ? `hydration` : undefined,
        )
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
  _getLiveQuery(queryHash: string): DbClientLiveQuery | undefined {
    return this.liveQueries.get(queryHash)
  }

  /** @internal */
  _registerLiveQuery(queryHash: string, promise: Promise<void>): Promise<void> {
    const existing = this.liveQueries.get(queryHash)
    if (existing) {
      return existing.promise
    }

    const record: LiveQueryRecord = {
      queryHash,
      dehydratedAt: Date.now(),
      status: `pending`,
      promise: undefined as unknown as Promise<void>,
      dehydratedPromise: undefined as unknown as Promise<DehydratedDbState>,
    }

    record.promise = Promise.resolve(promise).then(
      () => {
        record.status = `success`
      },
      (error: unknown) => {
        record.status = `error`
        record.error = error
        throw error
      },
    )
    record.promise.catch(() => {})
    record.dehydratedPromise = record.promise.then(() => this.dehydrate())
    record.dehydratedPromise.catch(() => {})

    this.liveQueries.set(queryHash, record)
    this.emit({ type: `liveQueryAdded`, query: record })
    return record.promise
  }

  async cleanup(): Promise<void> {
    try {
      await Promise.all(
        Array.from(this.collectionsById.values(), ({ collection }) =>
          collection.cleanup(),
        ),
      )
    } finally {
      this.transactionScope.clear()
      this.collectionsByOptions = new WeakMap()
      this.collectionsById.clear()
      this.pendingHydration.clear()
      this.liveQueries.clear()
      this.listeners.clear()
    }
  }

  private hydrateLiveQuery(dehydratedQuery: DehydratedLiveQuery): void {
    const existing = this.liveQueries.get(dehydratedQuery.queryHash)
    if (
      existing?.status === `pending` ||
      (existing && existing.dehydratedAt >= dehydratedQuery.dehydratedAt)
    ) {
      return
    }

    const record: LiveQueryRecord = {
      queryHash: dehydratedQuery.queryHash,
      dehydratedAt: dehydratedQuery.dehydratedAt,
      status: `pending`,
      promise: undefined as unknown as Promise<void>,
      dehydratedPromise: Promise.resolve(dehydratedQuery.promise),
    }

    record.promise = record.dehydratedPromise.then(
      (resolvedState) => {
        this.hydrate(resolvedState)
        record.status = `success`
      },
      (error: unknown) => {
        record.status = `error`
        record.error = error
        throw error
      },
    )
    record.promise.catch(() => {})

    this.liveQueries.set(record.queryHash, record)
    this.emit({ type: `liveQueryAdded`, query: record })
  }

  private emit(event: DbClientEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  private applyRows(
    collection: Collection<any, string | number, any, any, any>,
    chunk: DehydratedCollectionChunk,
    seedKind?: `initialData` | `hydration`,
  ): void {
    const rowMetadataWrites = new Map<
      string | number,
      { type: `set`; value: unknown } | { type: `delete` }
    >()

    collection._state.pendingSyncedTransactions.push({
      committed: true,
      layoutChanged: false,
      operations: chunk.rows.map((row) => {
        rowMetadataWrites.set(
          row.key,
          row.metadata === undefined
            ? { type: `delete` as const }
            : { type: `set` as const, value: row.metadata },
        )

        return {
          type: collection._state.syncedData.has(row.key) ? `update` : `insert`,
          key: row.key,
          value: row.value,
        }
      }),
      deletedKeys: new Set(),
      rowMetadataWrites,
      collectionMetadataWrites: new Map(),
      immediate: true,
      preserveHydrationSeedKeys: seedKind !== undefined,
    })

    if (seedKind) {
      for (const row of chunk.rows) {
        collection._state.hydrationSeedKeys.add(row.key)
        if (seedKind === `hydration`) {
          collection._state.hydratedKeys.add(row.key)
        }
      }
    }

    collection._state.commitPendingTransactions()

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
