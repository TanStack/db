import {
  SingleProcessCoordinator,
  createSQLiteCorePersistenceAdapter,
} from '@tanstack/db-sqlite-persistence-core'
import { TauriSQLiteDriver } from './tauri-sql-driver'
import type {
  PersistedCollectionCoordinator,
  PersistedCollectionMode,
  PersistedCollectionPersistence,
  SQLiteCoreAdapterOptions,
  SQLiteDriver,
} from '@tanstack/db-sqlite-persistence-core'
import type { TauriSQLiteDatabaseLike } from './tauri-sql-driver'

export type { TauriSQLiteDatabaseLike } from './tauri-sql-driver'

type TauriSQLiteCoreSchemaMismatchPolicy =
  | `sync-present-reset`
  | `sync-absent-error`
  | `reset`

export type TauriSQLiteSchemaMismatchPolicy =
  | TauriSQLiteCoreSchemaMismatchPolicy
  | `throw`

type TauriSQLitePersistenceBaseOptions = Omit<
  SQLiteCoreAdapterOptions,
  `driver` | `schemaVersion` | `schemaMismatchPolicy`
> & {
  database: TauriSQLiteDatabaseLike
  coordinator?: PersistedCollectionCoordinator
  schemaMismatchPolicy?: TauriSQLiteSchemaMismatchPolicy
}

export type TauriSQLitePersistenceOptions = TauriSQLitePersistenceBaseOptions

const tauriDriverCache = new WeakMap<
  TauriSQLiteDatabaseLike,
  TauriSQLiteDriver
>()

function normalizeSchemaMismatchPolicy(
  policy: TauriSQLiteSchemaMismatchPolicy,
): TauriSQLiteCoreSchemaMismatchPolicy {
  if (policy === `throw`) {
    return `sync-absent-error`
  }

  return policy
}

function resolveSchemaMismatchPolicy(
  explicitPolicy: TauriSQLiteSchemaMismatchPolicy | undefined,
  mode: PersistedCollectionMode,
): TauriSQLiteCoreSchemaMismatchPolicy {
  if (explicitPolicy) {
    return normalizeSchemaMismatchPolicy(explicitPolicy)
  }

  return mode === `sync-present` ? `sync-present-reset` : `sync-absent-error`
}

function createAdapterCacheKey(
  schemaMismatchPolicy: TauriSQLiteCoreSchemaMismatchPolicy,
  schemaVersion: number | undefined,
): string {
  const schemaVersionKey =
    schemaVersion === undefined ? `schema:default` : `schema:${schemaVersion}`
  return `${schemaMismatchPolicy}|${schemaVersionKey}`
}

function createInternalSQLiteDriver(
  options: TauriSQLitePersistenceOptions,
): SQLiteDriver {
  const cachedDriver = tauriDriverCache.get(options.database)
  if (cachedDriver) {
    return cachedDriver
  }

  const driver = new TauriSQLiteDriver({
    database: options.database,
  })
  tauriDriverCache.set(options.database, driver)
  return driver
}

function resolveAdapterBaseOptions(
  options: TauriSQLitePersistenceOptions,
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

export function createTauriSQLitePersistence(
  options: TauriSQLitePersistenceOptions,
): PersistedCollectionPersistence {
  const { coordinator, schemaMismatchPolicy } = options
  const driver = createInternalSQLiteDriver(options)
  const adapterBaseOptions = resolveAdapterBaseOptions(options)
  const resolvedCoordinator = coordinator ?? new SingleProcessCoordinator()
  const adapterCache = new Map<
    string,
    ReturnType<typeof createSQLiteCorePersistenceAdapter>
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

    const adapter = createSQLiteCorePersistenceAdapter({
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
  ): PersistedCollectionPersistence => ({
    adapter: getAdapterForCollection(mode, schemaVersion),
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
