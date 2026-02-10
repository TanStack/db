import {
  
  
  
  
  
  SingleProcessCoordinator,
  createSQLiteCorePersistenceAdapter
} from '@tanstack/db-sqlite-persisted-collection-core'
import {
  
  createBetterSqlite3Driver
} from './node-driver'
import type {PersistedCollectionCoordinator, PersistedCollectionPersistence, PersistenceAdapter, SQLiteCoreAdapterOptions, SQLiteDriver} from '@tanstack/db-sqlite-persisted-collection-core';
import type {BetterSqlite3DriverOptions} from './node-driver';

type NodeSQLiteDriverInput = SQLiteDriver | BetterSqlite3DriverOptions

export type NodeSQLitePersistenceAdapterOptions = Omit<
  SQLiteCoreAdapterOptions,
  `driver`
> & {
  driver: NodeSQLiteDriverInput
}

export type NodeSQLitePersistenceOptions = NodeSQLitePersistenceAdapterOptions & {
  coordinator?: PersistedCollectionCoordinator
}

function isSQLiteDriver(candidate: NodeSQLiteDriverInput): candidate is SQLiteDriver {
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

function resolveSQLiteDriver(driverInput: NodeSQLiteDriverInput): SQLiteDriver {
  if (isSQLiteDriver(driverInput)) {
    return driverInput
  }

  return createBetterSqlite3Driver(driverInput)
}

export function createNodeSQLitePersistenceAdapter<
  T extends object,
  TKey extends string | number = string | number,
>(
  options: NodeSQLitePersistenceAdapterOptions,
): PersistenceAdapter<T, TKey> {
  const { driver, ...adapterOptions } = options
  const resolvedDriver = resolveSQLiteDriver(driver)

  return createSQLiteCorePersistenceAdapter<T, TKey>({
    ...adapterOptions,
    driver: resolvedDriver,
  })
}

export function createNodeSQLitePersistence<
  T extends object,
  TKey extends string | number = string | number,
>(
  options: NodeSQLitePersistenceOptions,
): PersistedCollectionPersistence<T, TKey> {
  const { coordinator, ...adapterOptions } = options
  return {
    adapter: createNodeSQLitePersistenceAdapter<T, TKey>(adapterOptions),
    coordinator: coordinator ?? new SingleProcessCoordinator(),
  }
}
