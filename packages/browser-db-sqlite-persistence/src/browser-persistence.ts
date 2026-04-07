import {
  SingleProcessCoordinator,
  createSQLiteCorePersistenceAdapter,
} from '@tanstack/db-sqlite-persistence-core'
import { BrowserCollectionCoordinator } from './browser-coordinator'
import { BrowserWASQLiteDriver } from './wa-sqlite-driver'
import type {
  PersistedCollectionCoordinator,
  PersistedCollectionMode,
  PersistedCollectionPersistence,
  SQLiteCoreAdapterOptions,
  SQLiteDriver,
} from '@tanstack/db-sqlite-persistence-core'
import type { BrowserWASQLiteDatabase } from './wa-sqlite-driver'

export type { BrowserWASQLiteDatabase } from './wa-sqlite-driver'

type BrowserSQLiteCoreSchemaMismatchPolicy =
  | `sync-present-reset`
  | `sync-absent-error`
  | `reset`

export type BrowserWASQLiteSchemaMismatchPolicy =
  | BrowserSQLiteCoreSchemaMismatchPolicy
  | `throw`

export type BrowserWASQLitePersistenceOptions = Omit<
  SQLiteCoreAdapterOptions,
  `driver` | `schemaVersion` | `schemaMismatchPolicy`
> & {
  database: BrowserWASQLiteDatabase
  coordinator?: PersistedCollectionCoordinator
  schemaMismatchPolicy?: BrowserWASQLiteSchemaMismatchPolicy
}

function normalizeSchemaMismatchPolicy(
  policy: BrowserWASQLiteSchemaMismatchPolicy,
): BrowserSQLiteCoreSchemaMismatchPolicy {
  if (policy === `throw`) {
    return `sync-absent-error`
  }

  return policy
}

function resolveSchemaMismatchPolicy(
  explicitPolicy: BrowserWASQLiteSchemaMismatchPolicy | undefined,
  mode: PersistedCollectionMode,
): BrowserSQLiteCoreSchemaMismatchPolicy {
  if (explicitPolicy) {
    return normalizeSchemaMismatchPolicy(explicitPolicy)
  }

  return mode === `sync-present` ? `sync-present-reset` : `sync-absent-error`
}

function createAdapterCacheKey(
  schemaMismatchPolicy: BrowserSQLiteCoreSchemaMismatchPolicy,
  schemaVersion: number | undefined,
): string {
  const schemaVersionKey =
    schemaVersion === undefined ? `schema:default` : `schema:${schemaVersion}`
  return `${schemaMismatchPolicy}|${schemaVersionKey}`
}

function createInternalSQLiteDriver(
  options: BrowserWASQLitePersistenceOptions,
): SQLiteDriver {
  return new BrowserWASQLiteDriver({
    database: options.database,
  })
}

function resolveAdapterBaseOptions(
  options: BrowserWASQLitePersistenceOptions,
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
 * Creates a shared browser wa-sqlite persistence instance that can be reused by
 * many collections on the same database. This is single-tab wiring using
 * SingleProcessCoordinator semantics (no election required).
 */
export function createBrowserWASQLitePersistence(
  options: BrowserWASQLitePersistenceOptions,
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

    // Wire the adapter into the multi-tab coordinator so it can handle
    // leader-side RPCs (applyCommittedTx, pullSince, ensureIndex, etc.)
    if (resolvedCoordinator instanceof BrowserCollectionCoordinator) {
      resolvedCoordinator.setAdapter(adapter)
    }

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
