import {
  SingleProcessCoordinator,
  createSQLiteCorePersistenceAdapter,
} from '@tanstack/db-sqlite-persistence-core'
import { ExpoSQLiteDriver } from './expo-sqlite-driver'
import type {
  PersistedCollectionCoordinator,
  PersistedCollectionMode,
  PersistedCollectionPersistence,
  SQLiteCoreAdapterOptions,
  SQLiteDriver,
} from '@tanstack/db-sqlite-persistence-core'
import type { ExpoSQLiteDatabaseLike } from './expo-sqlite-driver'

export type { ExpoSQLiteDatabaseLike } from './expo-sqlite-driver'

type ExpoSQLiteCoreSchemaMismatchPolicy =
  | `sync-present-reset`
  | `sync-absent-error`
  | `reset`

export type ExpoSQLiteSchemaMismatchPolicy =
  | ExpoSQLiteCoreSchemaMismatchPolicy
  | `throw`

export type ExpoSQLitePersistenceOptions = Omit<
  SQLiteCoreAdapterOptions,
  `driver` | `schemaVersion` | `schemaMismatchPolicy`
> & {
  database: ExpoSQLiteDatabaseLike
  coordinator?: PersistedCollectionCoordinator
  schemaMismatchPolicy?: ExpoSQLiteSchemaMismatchPolicy
}

function normalizeSchemaMismatchPolicy(
  policy: ExpoSQLiteSchemaMismatchPolicy,
): ExpoSQLiteCoreSchemaMismatchPolicy {
  if (policy === `throw`) {
    return `sync-absent-error`
  }

  return policy
}

function resolveSchemaMismatchPolicy(
  explicitPolicy: ExpoSQLiteSchemaMismatchPolicy | undefined,
  mode: PersistedCollectionMode,
): ExpoSQLiteCoreSchemaMismatchPolicy {
  if (explicitPolicy) {
    return normalizeSchemaMismatchPolicy(explicitPolicy)
  }

  return mode === `sync-present` ? `sync-present-reset` : `sync-absent-error`
}

function createAdapterCacheKey(
  schemaMismatchPolicy: ExpoSQLiteCoreSchemaMismatchPolicy,
  schemaVersion: number | undefined,
): string {
  const schemaVersionKey =
    schemaVersion === undefined ? `schema:default` : `schema:${schemaVersion}`
  return `${schemaMismatchPolicy}|${schemaVersionKey}`
}

function createInternalSQLiteDriver(
  options: ExpoSQLitePersistenceOptions,
): SQLiteDriver {
  return new ExpoSQLiteDriver({
    database: options.database,
  })
}

function resolveAdapterBaseOptions(
  options: ExpoSQLitePersistenceOptions,
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

export function createExpoSQLitePersistence<
  T extends object,
  TKey extends string | number = string | number,
>(
  options: ExpoSQLitePersistenceOptions,
): PersistedCollectionPersistence<T, TKey> {
  const { coordinator, schemaMismatchPolicy } = options
  const driver = createInternalSQLiteDriver(options)
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
    resolvePersistenceForMode: (mode) =>
      createCollectionPersistence(mode, undefined),
  }
}
