import {
  createMobileSQLitePersistence,
  createMobileSQLitePersistenceAdapter,
} from './mobile-persistence'
import type {
  MobileSQLitePersistenceAdapterOptions,
  MobileSQLitePersistenceOptions,
} from './mobile-persistence'
import type {
  PersistedCollectionPersistence,
  PersistenceAdapter,
} from '@tanstack/db-sqlite-persisted-collection-core'

export type ExpoSQLitePersistenceAdapterOptions =
  MobileSQLitePersistenceAdapterOptions
export type ExpoSQLitePersistenceOptions = MobileSQLitePersistenceOptions

export function createExpoSQLitePersistenceAdapter<
  T extends object,
  TKey extends string | number = string | number,
>(options: ExpoSQLitePersistenceAdapterOptions): PersistenceAdapter<T, TKey> {
  return createMobileSQLitePersistenceAdapter<T, TKey>(options)
}

export function createExpoSQLitePersistence<
  T extends object,
  TKey extends string | number = string | number,
>(
  options: ExpoSQLitePersistenceOptions,
): PersistedCollectionPersistence<T, TKey> {
  return createMobileSQLitePersistence<T, TKey>(options)
}
