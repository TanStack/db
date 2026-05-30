import { createCollection } from './collection/index.js'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { Collection } from './collection/index.js'
import type {
  CollectionConfig,
  InferSchemaInput,
  InferSchemaOutput,
  NonSingleResult,
  SingleResult,
  UtilsRecord,
} from './types.js'

const collectionOptionsBrand: unique symbol = Symbol.for(
  `@tanstack/db.collectionOptions`,
) as never

export type CollectionOptions<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
  TSchema extends StandardSchemaV1 = never,
  TUtils extends UtilsRecord = UtilsRecord,
> = CollectionConfig<T, TKey, TSchema, TUtils> & {
  readonly [collectionOptionsBrand]: true
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
  updatedAt?: number
}

export type DehydratedCollectionChunk<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
> = {
  collectionId: string
  rows: Array<DehydratedCollectionRow<T, TKey>>
  syncMeta?: unknown
}

export type DehydratedDbState = {
  collections: Array<DehydratedCollectionChunk>
}

type CollectionRecord = {
  collection: Collection<any, string | number, any, any, any>
  hasExplicitId: boolean
}

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
export function collectionOptions(
  options: CollectionConfig<any, string | number, any, UtilsRecord>,
): CollectionOptions<any, string | number, any, UtilsRecord> {
  Object.defineProperty(options, collectionOptionsBrand, {
    value: true,
    enumerable: false,
  })
  return options as CollectionOptions<any, string | number, any, UtilsRecord>
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
  private collectionsByOptions = new WeakMap<
    object,
    Collection<any, string | number, any, any, any>
  >()
  private collectionsById = new Map<string, CollectionRecord>()
  private pendingHydration = new Map<string, Array<DehydratedCollectionChunk>>()

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
    options: CollectionOptions<any, string | number, any, UtilsRecord>,
    materializeOptions?: CollectionMaterializeOptions<any>,
  ): Collection<any, string | number, UtilsRecord, any, any> {
    const existing = this.collectionsByOptions.get(options)
    if (existing) {
      return existing
    }

    const collection = createCollection(options as any)
    this.collectionsByOptions.set(options, collection)
    this.collectionsById.set(collection.id, {
      collection,
      hasExplicitId: options.id !== undefined,
    })

    if (materializeOptions?.initialData?.length) {
      this.applyRows(collection, {
        collectionId: collection.id,
        rows: materializeOptions.initialData.map((value) => ({
          key: options.getKey(value),
          value,
        })),
      })
    }

    const pendingChunks = this.pendingHydration.get(collection.id)
    if (pendingChunks) {
      for (const chunk of pendingChunks) {
        this.applyRows(collection, chunk)
      }
      this.pendingHydration.delete(collection.id)
    }

    return collection
  }

  dehydrate(): DehydratedDbState {
    const collections: Array<DehydratedCollectionChunk> = []

    for (const { collection, hasExplicitId } of this.collectionsById.values()) {
      if (!hasExplicitId) {
        throw new Error(
          `Cannot dehydrate collection "${collection.id}" because it was created without an explicit id. SSR hydration requires stable collection ids.`,
        )
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

    return { collections }
  }

  hydrate(state: DehydratedDbState): void {
    for (const chunk of state.collections) {
      const record = this.collectionsById.get(chunk.collectionId)
      if (record) {
        this.applyRows(record.collection, chunk)
        continue
      }

      const pendingChunks = this.pendingHydration.get(chunk.collectionId) ?? []
      pendingChunks.push(chunk)
      this.pendingHydration.set(chunk.collectionId, pendingChunks)
    }
  }

  applyCollectionChunk(chunk: DehydratedCollectionChunk): void {
    this.hydrate({ collections: [chunk] })
  }

  private applyRows(
    collection: Collection<any, string | number, any, any, any>,
    chunk: DehydratedCollectionChunk,
  ): void {
    const rowMetadataWrites = new Map<
      string | number,
      { type: `set`; value: unknown } | { type: `delete` }
    >()

    collection._state.pendingSyncedTransactions.push({
      committed: true,
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
    })

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
