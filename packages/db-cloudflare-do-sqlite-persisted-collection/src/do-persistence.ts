import {
  SingleProcessCoordinator,
  createSQLiteCorePersistenceAdapter,
} from '@tanstack/db-sqlite-persisted-collection-core'
import { CloudflareDOSQLiteDriver } from './do-driver'
import type {
  PersistedCollectionCoordinator,
  PersistedCollectionMode,
  PersistedCollectionPersistence,
  SQLiteCoreAdapterOptions,
  SQLiteDriver,
} from '@tanstack/db-sqlite-persisted-collection-core'
import type { DurableObjectStorageLike } from './do-driver'

export type { DurableObjectStorageLike } from './do-driver'

type CloudflareDOCoreSchemaMismatchPolicy =
  | `sync-present-reset`
  | `sync-absent-error`
  | `reset`

export type CloudflareDOSchemaMismatchPolicy =
  | CloudflareDOCoreSchemaMismatchPolicy
  | `throw`

type CloudflareDOSQLitePersistenceBaseOptions = Omit<
  SQLiteCoreAdapterOptions,
  `driver` | `schemaVersion` | `schemaMismatchPolicy`
> & {
  storage: DurableObjectStorageLike
  coordinator?: PersistedCollectionCoordinator
  schemaMismatchPolicy?: CloudflareDOSchemaMismatchPolicy
}

export type CloudflareDOSQLitePersistenceOptions =
  CloudflareDOSQLitePersistenceBaseOptions

function normalizeSchemaMismatchPolicy(
  policy: CloudflareDOSchemaMismatchPolicy,
): CloudflareDOCoreSchemaMismatchPolicy {
  if (policy === `throw`) {
    return `sync-absent-error`
  }
  return policy
}

function resolveSchemaMismatchPolicy(
  explicitPolicy: CloudflareDOSchemaMismatchPolicy | undefined,
  mode: PersistedCollectionMode,
): CloudflareDOCoreSchemaMismatchPolicy {
  if (explicitPolicy) {
    return normalizeSchemaMismatchPolicy(explicitPolicy)
  }

  return mode === `sync-present` ? `sync-present-reset` : `sync-absent-error`
}

function createAdapterCacheKey(
  schemaMismatchPolicy: CloudflareDOCoreSchemaMismatchPolicy,
  schemaVersion: number | undefined,
): string {
  const schemaVersionKey =
    schemaVersion === undefined ? `schema:default` : `schema:${schemaVersion}`
  return `${schemaMismatchPolicy}|${schemaVersionKey}`
}

function resolveSQLiteDriver(
  options: CloudflareDOSQLitePersistenceOptions,
): SQLiteDriver {
  return new CloudflareDOSQLiteDriver({
    storage: options.storage,
  })
}

function resolveAdapterBaseOptions(
  options: CloudflareDOSQLitePersistenceOptions,
): Omit<
  SQLiteCoreAdapterOptions,
  `driver` | `schemaVersion` | `schemaMismatchPolicy`
> {
  return {
    appliedTxPruneMaxRows: options.appliedTxPruneMaxRows,
    appliedTxPruneMaxAgeSeconds: options.appliedTxPruneMaxAgeSeconds,
    pullSinceReloadThreshold: options.pullSinceReloadThreshold,
  }
}

/**
 * Creates a shared Durable Object SQLite persistence instance that can be reused
 * by many collections in a single Durable Object storage.
 */
export function createCloudflareDOSQLitePersistence<
  T extends object,
  TKey extends string | number = string | number,
>(
  options: CloudflareDOSQLitePersistenceOptions,
): PersistedCollectionPersistence<T, TKey> {
  const { coordinator, schemaMismatchPolicy } = options
  const driver = resolveSQLiteDriver(options)
  const adapterBaseOptions = resolveAdapterBaseOptions(options)
  const resolvedCoordinator = coordinator ?? new SingleProcessCoordinator()
  const adapterCache = new Map<
    string,
    ReturnType<
      typeof createSQLiteCorePersistenceAdapter<
        Record<string, unknown>,
        string | number
      >
    >
  >()

  const getAdapterForCollection = (
    mode: PersistedCollectionMode,
    schemaVersion: number | undefined,
  ) => {
    const resolvedSchemaMismatchPolicy = resolveSchemaMismatchPolicy(
      schemaMismatchPolicy,
      mode,
    )
    const cacheKey = createAdapterCacheKey(
      resolvedSchemaMismatchPolicy,
      schemaVersion,
    )
    const cachedAdapter = adapterCache.get(cacheKey)
    if (cachedAdapter) {
      return cachedAdapter
    }

    const adapter = createSQLiteCorePersistenceAdapter<
      Record<string, unknown>,
      string | number
    >({
      ...adapterBaseOptions,
      driver,
      schemaMismatchPolicy: resolvedSchemaMismatchPolicy,
      ...(schemaVersion === undefined ? {} : { schemaVersion }),
    })
    adapterCache.set(cacheKey, adapter)
    return adapter
  }

  const createCollectionPersistence = (
    mode: PersistedCollectionMode,
    schemaVersion: number | undefined,
  ): PersistedCollectionPersistence<T, TKey> => ({
    adapter: getAdapterForCollection(
      mode,
      schemaVersion,
    ) as unknown as PersistedCollectionPersistence<T, TKey>[`adapter`],
    coordinator: resolvedCoordinator,
  })

  const defaultPersistence = createCollectionPersistence(
    `sync-absent`,
    undefined,
  )

  return {
    ...defaultPersistence,
    resolvePersistenceForCollection: ({ mode, schemaVersion }) =>
      createCollectionPersistence(mode, schemaVersion),
    // Backward compatible fallback for older callers.
    resolvePersistenceForMode: (mode) =>
      createCollectionPersistence(mode, undefined),
  }
}
