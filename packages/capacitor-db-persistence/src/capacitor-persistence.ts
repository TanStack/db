import {
  SingleProcessCoordinator,
  createSQLiteCorePersistenceAdapter,
} from '@tanstack/db-persistence-core'
import { CapacitorSQLiteDriver } from './capacitor-sqlite-driver'
import type { SQLiteDBConnection } from '@capacitor-community/sqlite'
import type {
  PersistedCollectionCoordinator,
  PersistedCollectionMode,
  PersistedCollectionPersistence,
  SQLiteCoreAdapterOptions,
  SQLiteDriver,
} from '@tanstack/db-persistence-core'

export type { CapacitorSQLiteDatabaseLike } from './capacitor-sqlite-driver'
export type { SQLiteDBConnection } from '@capacitor-community/sqlite'

type CapacitorSQLiteCoreSchemaMismatchPolicy =
  | `sync-present-reset`
  | `sync-absent-error`
  | `reset`

export type CapacitorSQLiteSchemaMismatchPolicy =
  | CapacitorSQLiteCoreSchemaMismatchPolicy
  | `throw`

type CapacitorSQLitePersistenceBaseOptions = Omit<
  SQLiteCoreAdapterOptions,
  `driver` | `schemaVersion` | `schemaMismatchPolicy`
> & {
  database: SQLiteDBConnection
  coordinator?: PersistedCollectionCoordinator
  schemaMismatchPolicy?: CapacitorSQLiteSchemaMismatchPolicy
}

export type CapacitorSQLitePersistenceOptions =
  CapacitorSQLitePersistenceBaseOptions

function normalizeSchemaMismatchPolicy(
  policy: CapacitorSQLiteSchemaMismatchPolicy,
): CapacitorSQLiteCoreSchemaMismatchPolicy {
  if (policy === `throw`) {
    return `sync-absent-error`
  }

  return policy
}

function resolveSchemaMismatchPolicy(
  explicitPolicy: CapacitorSQLiteSchemaMismatchPolicy | undefined,
  mode: PersistedCollectionMode,
): CapacitorSQLiteCoreSchemaMismatchPolicy {
  if (explicitPolicy) {
    return normalizeSchemaMismatchPolicy(explicitPolicy)
  }

  return mode === `sync-present` ? `sync-present-reset` : `sync-absent-error`
}

function createAdapterCacheKey(
  schemaMismatchPolicy: CapacitorSQLiteCoreSchemaMismatchPolicy,
  schemaVersion: number | undefined,
): string {
  const schemaVersionKey =
    schemaVersion === undefined ? `schema:default` : `schema:${schemaVersion}`
  return `${schemaMismatchPolicy}|${schemaVersionKey}`
}

function createInternalSQLiteDriver(
  options: CapacitorSQLitePersistenceOptions,
): SQLiteDriver {
  return new CapacitorSQLiteDriver({
    database: options.database,
  })
}

function resolveAdapterBaseOptions(
  options: CapacitorSQLitePersistenceOptions,
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

export function createCapacitorSQLitePersistence<
  T extends object,
  TKey extends string | number = string | number,
>(
  options: CapacitorSQLitePersistenceOptions,
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
