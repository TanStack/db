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
  PersistedCollectionMode,
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
  mode?: CloudflareDOPersistenceMode
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

function resolveCloudflarePersistenceMode(
  persistedMode: PersistedCollectionMode,
  explicitMode?: CloudflareDOPersistenceMode,
): CloudflareDOPersistenceMode {
  if (explicitMode) {
    return explicitMode
  }

  return persistedMode === `sync-present` ? `sync` : `local`
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
  const persister = createCloudflareDOSQLitePersister(options)
  return persister.getAdapter<T, TKey>(`sync-absent`)
}

export class CloudflareDOSQLitePersister {
  private readonly coordinator: PersistedCollectionCoordinator
  private readonly explicitMode: CloudflareDOPersistenceMode | undefined
  private readonly explicitSchemaMismatchPolicy:
    | CloudflareDOSchemaMismatchPolicy
    | undefined
  private readonly adapterBaseOptions: Omit<
    CloudflareDOSQLitePersistenceAdapterOptions,
    `driver` | `mode` | `schemaMismatchPolicy`
  >
  private readonly driver: SQLiteDriver
  private readonly adaptersBySchemaPolicy = new Map<
    CloudflareDOCoreSchemaMismatchPolicy,
    PersistenceAdapter<Record<string, unknown>, string | number>
  >()

  constructor(options: CloudflareDOSQLitePersistenceOptions) {
    const {
      coordinator,
      driver,
      mode,
      schemaMismatchPolicy,
      ...adapterBaseOptions
    } = options

    this.coordinator = coordinator ?? new SingleProcessCoordinator()
    this.explicitMode = mode
    this.explicitSchemaMismatchPolicy = schemaMismatchPolicy
    this.adapterBaseOptions = adapterBaseOptions
    this.driver = resolveSQLiteDriver(driver)
  }

  getAdapter<
    T extends object,
    TKey extends string | number = string | number,
  >(
    mode: PersistedCollectionMode = `sync-absent`,
  ): CloudflareDOSQLitePersistenceAdapter<T, TKey> {
    const runtimeMode = resolveCloudflarePersistenceMode(mode, this.explicitMode)
    const resolvedSchemaPolicy = this.explicitSchemaMismatchPolicy
      ? normalizeSchemaMismatchPolicy(this.explicitSchemaMismatchPolicy)
      : resolveCloudflareDOSchemaMismatchPolicy(runtimeMode)
    const cachedAdapter = this.adaptersBySchemaPolicy.get(resolvedSchemaPolicy)
    if (cachedAdapter) {
      return cachedAdapter as unknown as CloudflareDOSQLitePersistenceAdapter<
        T,
        TKey
      >
    }

    const adapter = createSQLiteCorePersistenceAdapter<
      Record<string, unknown>,
      string | number
    >({
      ...this.adapterBaseOptions,
      driver: this.driver,
      schemaMismatchPolicy: resolvedSchemaPolicy,
    })
    this.adaptersBySchemaPolicy.set(resolvedSchemaPolicy, adapter)
    return adapter as unknown as CloudflareDOSQLitePersistenceAdapter<T, TKey>
  }

  getPersistence<
    T extends object,
    TKey extends string | number = string | number,
  >(
    mode: PersistedCollectionMode = `sync-absent`,
    coordinator: PersistedCollectionCoordinator = this.coordinator,
  ): PersistedCollectionPersistence<T, TKey> {
    return {
      adapter: this.getAdapter<T, TKey>(mode),
      coordinator,
    }
  }
}

export function createCloudflareDOSQLitePersister(
  options: CloudflareDOSQLitePersistenceOptions,
): CloudflareDOSQLitePersister {
  return new CloudflareDOSQLitePersister(options)
}

export function createCloudflareDOSQLitePersistence<
  T extends object,
  TKey extends string | number = string | number,
>(
  options: CloudflareDOSQLitePersistenceOptions,
): PersistedCollectionPersistence<T, TKey> {
  const persister = createCloudflareDOSQLitePersister(options)
  const defaultPersistence = persister.getPersistence<T, TKey>(`sync-absent`)

  return {
    ...defaultPersistence,
    resolvePersistenceForMode: (mode) =>
      persister.getPersistence<T, TKey>(mode),
  }
}

export class CloudflareDOCollectionRegistry {
  private readonly driver: SQLiteDriver
  private readonly collections = new Map<string, CloudflareDOCollectionEntry>()
  private readonly adapters = new Map<string, PersistenceAdapter<any, any>>()
  private readonly persisters = new Map<string, CloudflareDOSQLitePersister>()

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
        mode: collection.mode,
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

    const persister = this.getOrCreatePersister(collectionId, entry)
    const adapter = persister.getAdapter<T, TKey>(`sync-absent`)
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
    const entry = this.collections.get(collectionId)
    if (!entry) {
      return undefined
    }

    const persister = this.getOrCreatePersister(collectionId, entry)
    const resolvedCoordinator = coordinator ?? new SingleProcessCoordinator()
    const defaultPersistence = persister.getPersistence<T, TKey>(
      `sync-absent`,
      resolvedCoordinator,
    )

    return {
      ...defaultPersistence,
      resolvePersistenceForMode: (mode) =>
        persister.getPersistence<T, TKey>(mode, resolvedCoordinator),
    }
  }

  private getOrCreatePersister(
    collectionId: string,
    entry: CloudflareDOCollectionEntry,
  ): CloudflareDOSQLitePersister {
    const cachedPersister = this.persisters.get(collectionId)
    if (cachedPersister) {
      return cachedPersister
    }

    const persister = createCloudflareDOSQLitePersister({
      driver: this.driver,
      mode: entry.mode,
      ...entry.adapterOptions,
    })
    this.persisters.set(collectionId, persister)
    return persister
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
