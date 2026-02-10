import {
  SingleProcessCoordinator,
  createSQLiteCorePersistenceAdapter,
} from '@tanstack/db-sqlite-persisted-collection-core'
import { createOpSQLiteDriver } from './op-sqlite-driver'
import type {
  PersistedCollectionCoordinator,
  PersistedCollectionPersistence,
  PersistenceAdapter,
  SQLiteCoreAdapterOptions,
  SQLiteDriver,
  SQLitePullSinceResult,
} from '@tanstack/db-sqlite-persisted-collection-core'
import type { OpSQLiteDriverOptions } from './op-sqlite-driver'

type MobileSQLiteDriverInput = SQLiteDriver | OpSQLiteDriverOptions

export type MobileSQLitePersistenceAdapterOptions = Omit<
  SQLiteCoreAdapterOptions,
  `driver`
> & {
  driver: MobileSQLiteDriverInput
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

export function createMobileSQLitePersistenceAdapter<
  T extends object,
  TKey extends string | number = string | number,
>(
  options: MobileSQLitePersistenceAdapterOptions,
): MobileSQLitePersistenceAdapter<T, TKey> {
  const { driver, ...adapterOptions } = options
  const resolvedDriver = resolveSQLiteDriver(driver)

  return createSQLiteCorePersistenceAdapter<T, TKey>({
    ...adapterOptions,
    driver: resolvedDriver,
  }) as MobileSQLitePersistenceAdapter<T, TKey>
}

export function createMobileSQLitePersistence<
  T extends object,
  TKey extends string | number = string | number,
>(
  options: MobileSQLitePersistenceOptions,
): PersistedCollectionPersistence<T, TKey> {
  const { coordinator, ...adapterOptions } = options
  return {
    adapter: createMobileSQLitePersistenceAdapter<T, TKey>(adapterOptions),
    coordinator: coordinator ?? new SingleProcessCoordinator(),
  }
}
