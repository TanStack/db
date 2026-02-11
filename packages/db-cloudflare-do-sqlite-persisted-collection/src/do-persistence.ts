import {
  InvalidPersistedCollectionConfigError,
  SingleProcessCoordinator,
  createSQLiteCorePersistenceAdapter,
} from '@tanstack/db-sqlite-persisted-collection-core'
import { createCloudflareDOSQLiteDriver } from './do-driver'
import type {
  CloudflareDOSQLiteDriverOptions,
  DurableObjectSqlStorageLike,
  DurableObjectStorageLike,
} from './do-driver'
import type {
  PersistedCollectionCoordinator,
  PersistedCollectionPersistence,
  PersistenceAdapter,
  SQLiteCoreAdapterOptions,
  SQLiteDriver,
  SQLitePullSinceResult,
} from '@tanstack/db-sqlite-persisted-collection-core'

type CloudflareDOSQLiteDriverInput =
  | SQLiteDriver
  | CloudflareDOSQLiteDriverOptions

export type CloudflareDOPersistenceMode = `local` | `sync`
export type CloudflareDOCoreSchemaMismatchPolicy =
  | `sync-present-reset`
  | `sync-absent-error`
  | `reset`
export type CloudflareDOSchemaMismatchPolicy =
  | CloudflareDOCoreSchemaMismatchPolicy
  | `throw`

export type CloudflareDOSQLitePersistenceAdapterOptions = Omit<
  SQLiteCoreAdapterOptions,
  `driver` | `schemaMismatchPolicy`
> & {
  driver: CloudflareDOSQLiteDriverInput
  mode?: CloudflareDOPersistenceMode
  schemaMismatchPolicy?: CloudflareDOSchemaMismatchPolicy
}

export type CloudflareDOSQLitePersistenceOptions =
  CloudflareDOSQLitePersistenceAdapterOptions & {
    coordinator?: PersistedCollectionCoordinator
  }

export type CloudflareDOCollectionConfig = {
  collectionId: string
  mode?: CloudflareDOPersistenceMode
  adapterOptions?: Omit<
    CloudflareDOSQLitePersistenceAdapterOptions,
    `driver` | `mode`
  >
}

type CloudflareDOCollectionEntry = {
  mode: CloudflareDOPersistenceMode
  adapterOptions?: Omit<
    CloudflareDOSQLitePersistenceAdapterOptions,
    `driver` | `mode`
  >
}

export type CloudflareDOSQLitePersistenceAdapter<
  T extends object,
  TKey extends string | number = string | number,
> = PersistenceAdapter<T, TKey> & {
  pullSince: (
    collectionId: string,
    fromRowVersion: number,
  ) => Promise<SQLitePullSinceResult<TKey>>
}

function isSQLiteDriver(
  candidate: CloudflareDOSQLiteDriverInput,
): candidate is SQLiteDriver {
  return (
    `exec` in candidate &&
    `query` in candidate &&
    `run` in candidate &&
    `transaction` in candidate &&
    typeof candidate.exec === `function` &&
    typeof candidate.query === `function` &&
    typeof candidate.run === `function` &&
    typeof candidate.transaction === `function`
  )
}

function resolveSQLiteDriver(
  driverInput: CloudflareDOSQLiteDriverInput,
): SQLiteDriver {
  if (isSQLiteDriver(driverInput)) {
    return driverInput
  }

  return createCloudflareDOSQLiteDriver(driverInput)
}

export function resolveCloudflareDOSchemaMismatchPolicy(
  mode: CloudflareDOPersistenceMode,
): CloudflareDOCoreSchemaMismatchPolicy {
  return mode === `sync` ? `sync-present-reset` : `sync-absent-error`
}

function normalizeSchemaMismatchPolicy(
  policy: CloudflareDOSchemaMismatchPolicy,
): CloudflareDOCoreSchemaMismatchPolicy {
  if (policy === `throw`) {
    return `sync-absent-error`
  }
  return policy
}

export function createCloudflareDOSQLitePersistenceAdapter<
  T extends object,
  TKey extends string | number = string | number,
>(
  options: CloudflareDOSQLitePersistenceAdapterOptions,
): CloudflareDOSQLitePersistenceAdapter<T, TKey> {
  const {
    driver,
    mode = `local`,
    schemaMismatchPolicy: rawSchemaMismatchPolicy,
    ...adapterOptions
  } = options
  const schemaMismatchPolicy = rawSchemaMismatchPolicy
    ? normalizeSchemaMismatchPolicy(rawSchemaMismatchPolicy)
    : resolveCloudflareDOSchemaMismatchPolicy(mode)

  const resolvedDriver = resolveSQLiteDriver(driver)
  return createSQLiteCorePersistenceAdapter<T, TKey>({
    ...adapterOptions,
    driver: resolvedDriver,
    schemaMismatchPolicy,
  }) as CloudflareDOSQLitePersistenceAdapter<T, TKey>
}

export function createCloudflareDOSQLitePersistence<
  T extends object,
  TKey extends string | number = string | number,
>(
  options: CloudflareDOSQLitePersistenceOptions,
): PersistedCollectionPersistence<T, TKey> {
  const { coordinator, ...adapterOptions } = options
  return {
    adapter: createCloudflareDOSQLitePersistenceAdapter<T, TKey>(adapterOptions),
    coordinator: coordinator ?? new SingleProcessCoordinator(),
  }
}

export class CloudflareDOCollectionRegistry {
  private readonly driver: SQLiteDriver
  private readonly collections = new Map<string, CloudflareDOCollectionEntry>()
  private readonly adapters = new Map<string, PersistenceAdapter<any, any>>()

  constructor(options: {
    driver: CloudflareDOSQLiteDriverInput
    collections: ReadonlyArray<CloudflareDOCollectionConfig>
  }) {
    this.driver = resolveSQLiteDriver(options.driver)

    for (const collection of options.collections) {
      const collectionId = collection.collectionId.trim()
      if (collectionId.length === 0) {
        throw new InvalidPersistedCollectionConfigError(
          `Cloudflare DO collectionId cannot be empty`,
        )
      }

      this.collections.set(collectionId, {
        mode: collection.mode ?? `local`,
        adapterOptions: collection.adapterOptions,
      })
    }
  }

  listCollectionIds(): ReadonlyArray<string> {
    return [...this.collections.keys()]
  }

  getAdapter<
    T extends object = Record<string, unknown>,
    TKey extends string | number = string | number,
  >(collectionId: string): PersistenceAdapter<T, TKey> | undefined {
    const entry = this.collections.get(collectionId)
    if (!entry) {
      return undefined
    }

    const cachedAdapter = this.adapters.get(collectionId)
    if (cachedAdapter) {
      return cachedAdapter as PersistenceAdapter<T, TKey>
    }

    const adapter = createCloudflareDOSQLitePersistenceAdapter<T, TKey>({
      driver: this.driver,
      mode: entry.mode,
      ...entry.adapterOptions,
    })
    this.adapters.set(collectionId, adapter)
    return adapter
  }

  getPersistence<
    T extends object = Record<string, unknown>,
    TKey extends string | number = string | number,
  >(
    collectionId: string,
    coordinator?: PersistedCollectionCoordinator,
  ): PersistedCollectionPersistence<T, TKey> | undefined {
    const adapter = this.getAdapter<T, TKey>(collectionId)
    if (!adapter) {
      return undefined
    }

    return {
      adapter,
      coordinator: coordinator ?? new SingleProcessCoordinator(),
    }
  }
}

export function createCloudflareDOCollectionRegistry(options: {
  storage: DurableObjectStorageLike
  collections: ReadonlyArray<CloudflareDOCollectionConfig>
}): CloudflareDOCollectionRegistry
export function createCloudflareDOCollectionRegistry(options: {
  sql: DurableObjectSqlStorageLike
  transaction?: DurableObjectStorageLike[`transaction`]
  collections: ReadonlyArray<CloudflareDOCollectionConfig>
}): CloudflareDOCollectionRegistry
export function createCloudflareDOCollectionRegistry(options: {
  storage?: DurableObjectStorageLike
  sql?: DurableObjectSqlStorageLike
  transaction?: DurableObjectStorageLike[`transaction`]
  collections: ReadonlyArray<CloudflareDOCollectionConfig>
}): CloudflareDOCollectionRegistry {
  if (options.storage) {
    return new CloudflareDOCollectionRegistry({
      driver: { storage: options.storage },
      collections: options.collections,
    })
  }

  if (!options.sql) {
    throw new InvalidPersistedCollectionConfigError(
      `Cloudflare DO registry requires either storage or sql`,
    )
  }

  return new CloudflareDOCollectionRegistry({
    driver: {
      sql: options.sql,
      transaction: options.transaction,
    },
    collections: options.collections,
  })
}

export async function initializeCloudflareDOCollections(
  registry: CloudflareDOCollectionRegistry,
  collectionIds: ReadonlyArray<string> = registry.listCollectionIds(),
): Promise<void> {
  for (const collectionId of collectionIds) {
    const adapter = registry.getAdapter(collectionId)
    if (!adapter) {
      throw new InvalidPersistedCollectionConfigError(
        `Unknown Cloudflare DO collection "${collectionId}"`,
      )
    }
    // loadSubset with limit 0 forces schema checks without retaining rows in memory.
    await adapter.loadSubset(collectionId, { limit: 0 })
  }
}
