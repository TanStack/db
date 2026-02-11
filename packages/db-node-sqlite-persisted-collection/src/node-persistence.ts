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

type NodeSQLiteCoreSchemaMismatchPolicy =
  | `sync-present-reset`
  | `sync-absent-error`
  | `reset`

export type NodeSQLiteSchemaMismatchPolicy =
  | NodeSQLiteCoreSchemaMismatchPolicy
  | `throw`

export type NodeSQLitePersistenceOptions = Omit<
  SQLiteCoreAdapterOptions,
  `driver` | `schemaVersion` | `schemaMismatchPolicy`
> & {
  driver: SQLiteDriver
  coordinator?: PersistedCollectionCoordinator
  schemaMismatchPolicy?: NodeSQLiteSchemaMismatchPolicy
}

function normalizeSchemaMismatchPolicy(
  policy: NodeSQLiteSchemaMismatchPolicy,
): NodeSQLiteCoreSchemaMismatchPolicy {
  if (policy === `throw`) {
    return `sync-absent-error`
  }

  return policy
}

function resolveSchemaMismatchPolicy(
  explicitPolicy: NodeSQLiteSchemaMismatchPolicy | undefined,
  mode: PersistedCollectionMode,
): NodeSQLiteCoreSchemaMismatchPolicy {
  if (explicitPolicy) {
    return normalizeSchemaMismatchPolicy(explicitPolicy)
  }

  return mode === `sync-present` ? `sync-present-reset` : `sync-absent-error`
}

function createAdapterCacheKey(
  schemaMismatchPolicy: NodeSQLiteCoreSchemaMismatchPolicy,
  schemaVersion: number | undefined,
): string {
  const schemaVersionKey =
    schemaVersion === undefined ? `schema:default` : `schema:${schemaVersion}`
  return `${schemaMismatchPolicy}|${schemaVersionKey}`
}

/**
 * Creates a shared SQLite persistence instance that can be reused by many
 * collections on the same database. Collection-specific schema versions are
 * resolved by `persistedCollectionOptions` via `resolvePersistenceForCollection`.
 */
export function createNodeSQLitePersistence<
  T extends object,
  TKey extends string | number = string | number,
>(
  options: NodeSQLitePersistenceOptions,
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
    adapter: getAdapterForCollection(mode, schemaVersion) as unknown as PersistedCollectionPersistence<
      T,
      TKey
    >[`adapter`],
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
