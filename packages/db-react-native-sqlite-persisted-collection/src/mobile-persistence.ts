import {
  SingleProcessCoordinator,
  createSQLiteCorePersistenceAdapter,
} from '@tanstack/db-sqlite-persisted-collection-core'
import { createOpSQLiteDriver } from './op-sqlite-driver'
import type {
  PersistedCollectionCoordinator,
  PersistedCollectionMode,
  PersistedCollectionPersistence,
  PersistenceAdapter,
  SQLiteCoreAdapterOptions,
  SQLiteDriver,
  SQLitePullSinceResult,
} from '@tanstack/db-sqlite-persisted-collection-core'
import type { OpSQLiteDriverOptions } from './op-sqlite-driver'

type MobileSQLiteDriverInput = SQLiteDriver | OpSQLiteDriverOptions

type MobileSQLiteCoreSchemaMismatchPolicy =
  | `sync-present-reset`
  | `sync-absent-error`
  | `reset`

export type MobileSQLiteSchemaMismatchPolicy =
  | MobileSQLiteCoreSchemaMismatchPolicy
  | `throw`

export type MobileSQLitePersistenceAdapterOptions = Omit<
  SQLiteCoreAdapterOptions,
  `driver` | `schemaMismatchPolicy`
> & {
  driver: MobileSQLiteDriverInput
  schemaMismatchPolicy?: MobileSQLiteSchemaMismatchPolicy
}

export type MobileSQLitePersistenceOptions =
  MobileSQLitePersistenceAdapterOptions & {
    coordinator?: PersistedCollectionCoordinator
  }

export type MobileSQLitePersistenceAdapter<
  T extends object,
  TKey extends string | number = string | number,
> = PersistenceAdapter<T, TKey> & {
  pullSince: (
    collectionId: string,
    fromRowVersion: number,
  ) => Promise<SQLitePullSinceResult<TKey>>
}

function isSQLiteDriver(
  candidate: MobileSQLiteDriverInput,
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
  driverInput: MobileSQLiteDriverInput,
): SQLiteDriver {
  if (isSQLiteDriver(driverInput)) {
    return driverInput
  }

  return createOpSQLiteDriver(driverInput)
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

export class MobileSQLitePersister {
  private readonly coordinator: PersistedCollectionCoordinator
  private readonly explicitSchemaMismatchPolicy:
    | MobileSQLiteSchemaMismatchPolicy
    | undefined
  private readonly adapterBaseOptions: Omit<
    MobileSQLitePersistenceAdapterOptions,
    `driver` | `schemaMismatchPolicy`
  >
  private readonly driver: SQLiteDriver
  private readonly adaptersBySchemaPolicy = new Map<
    MobileSQLiteCoreSchemaMismatchPolicy,
    PersistenceAdapter<Record<string, unknown>, string | number>
  >()

  constructor(options: MobileSQLitePersistenceOptions) {
    const { coordinator, driver, schemaMismatchPolicy, ...adapterBaseOptions } =
      options
    this.coordinator = coordinator ?? new SingleProcessCoordinator()
    this.explicitSchemaMismatchPolicy = schemaMismatchPolicy
    this.adapterBaseOptions = adapterBaseOptions
    this.driver = resolveSQLiteDriver(driver)
  }

  getAdapter<
    T extends object,
    TKey extends string | number = string | number,
  >(
    mode: PersistedCollectionMode = `sync-absent`,
  ): MobileSQLitePersistenceAdapter<T, TKey> {
    const resolvedSchemaPolicy = resolveSchemaMismatchPolicy(
      this.explicitSchemaMismatchPolicy,
      mode,
    )
    const cachedAdapter = this.adaptersBySchemaPolicy.get(resolvedSchemaPolicy)
    if (cachedAdapter) {
      return cachedAdapter as unknown as MobileSQLitePersistenceAdapter<T, TKey>
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
    return adapter as unknown as MobileSQLitePersistenceAdapter<T, TKey>
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

export function createMobileSQLitePersister(
  options: MobileSQLitePersistenceOptions,
): MobileSQLitePersister {
  return new MobileSQLitePersister(options)
}

export function createMobileSQLitePersistenceAdapter<
  T extends object,
  TKey extends string | number = string | number,
>(
  options: MobileSQLitePersistenceAdapterOptions,
): MobileSQLitePersistenceAdapter<T, TKey> {
  const { driver, schemaMismatchPolicy: rawSchemaMismatchPolicy, ...adapterOptions } =
    options
  const schemaMismatchPolicy = rawSchemaMismatchPolicy
    ? normalizeSchemaMismatchPolicy(rawSchemaMismatchPolicy)
    : undefined
  const resolvedDriver = resolveSQLiteDriver(driver)

  return createSQLiteCorePersistenceAdapter<T, TKey>({
    ...adapterOptions,
    driver: resolvedDriver,
    schemaMismatchPolicy,
  }) as unknown as MobileSQLitePersistenceAdapter<T, TKey>
}

export function createMobileSQLitePersistence<
  T extends object,
  TKey extends string | number = string | number,
>(
  options: MobileSQLitePersistenceOptions,
): PersistedCollectionPersistence<T, TKey> {
  const persister = createMobileSQLitePersister(options)
  const defaultPersistence = persister.getPersistence<T, TKey>(`sync-absent`)

  return {
    ...defaultPersistence,
    resolvePersistenceForMode: (mode) =>
      persister.getPersistence<T, TKey>(mode),
  }
}
