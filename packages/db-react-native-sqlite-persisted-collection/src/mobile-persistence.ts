import {
  SingleProcessCoordinator,
  createSQLiteCorePersistenceAdapter,
} from '@tanstack/db-sqlite-persisted-collection-core'
import type {
  PersistedCollectionCoordinator,
  PersistedCollectionMode,
  PersistedCollectionPersistence,
  SQLiteCoreAdapterOptions,
  SQLiteDriver,
} from '@tanstack/db-sqlite-persisted-collection-core'

type MobileSQLiteCoreSchemaMismatchPolicy =
  | `sync-present-reset`
  | `sync-absent-error`
  | `reset`

export type MobileSQLiteSchemaMismatchPolicy =
  | MobileSQLiteCoreSchemaMismatchPolicy
  | `throw`

export type MobileSQLitePersistenceOptions = Omit<
  SQLiteCoreAdapterOptions,
  `driver` | `schemaVersion` | `schemaMismatchPolicy`
> & {
  driver: SQLiteDriver
  coordinator?: PersistedCollectionCoordinator
  schemaMismatchPolicy?: MobileSQLiteSchemaMismatchPolicy
}

function normalizeSchemaMismatchPolicy(
  policy: MobileSQLiteSchemaMismatchPolicy,
): MobileSQLiteCoreSchemaMismatchPolicy {
  if (policy === `throw`) {
    return `sync-absent-error`
  }

  return policy
}

function resolveSchemaMismatchPolicy(
  explicitPolicy: MobileSQLiteSchemaMismatchPolicy | undefined,
  mode: PersistedCollectionMode,
): MobileSQLiteCoreSchemaMismatchPolicy {
  if (explicitPolicy) {
    return normalizeSchemaMismatchPolicy(explicitPolicy)
  }

  return mode === `sync-present` ? `sync-present-reset` : `sync-absent-error`
}

function createAdapterCacheKey(
  schemaMismatchPolicy: MobileSQLiteCoreSchemaMismatchPolicy,
  schemaVersion: number | undefined,
): string {
  const schemaVersionKey =
    schemaVersion === undefined ? `schema:default` : `schema:${schemaVersion}`
  return `${schemaMismatchPolicy}|${schemaVersionKey}`
}

export function createMobileSQLitePersistence<
  T extends object,
  TKey extends string | number = string | number,
>(
  options: MobileSQLitePersistenceOptions,
): PersistedCollectionPersistence<T, TKey> {
  const { coordinator, driver, schemaMismatchPolicy, ...adapterBaseOptions } =
    options
  const resolvedCoordinator = coordinator ?? new SingleProcessCoordinator()
  const adapterCache = new Map<
    string,
    ReturnType<
      typeof createSQLiteCorePersistenceAdapter<Record<string, unknown>, string | number>
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
    ) as PersistedCollectionPersistence<T, TKey>[`adapter`],
    coordinator: resolvedCoordinator,
  })

  const defaultPersistence = createCollectionPersistence(`sync-absent`, undefined)

  return {
    ...defaultPersistence,
    resolvePersistenceForCollection: ({ mode, schemaVersion }) =>
      createCollectionPersistence(mode, schemaVersion),
    // Backward compatible fallback for older callers.
    resolvePersistenceForMode: (mode) =>
      createCollectionPersistence(mode, undefined),
  }
}
