import {
  createMobileSQLitePersistence,
  createMobileSQLitePersistenceAdapter,
} from './mobile-persistence'
import type {
  MobileSQLitePersistenceAdapter,
  MobileSQLitePersistenceAdapterOptions,
  MobileSQLitePersistenceOptions,
} from './mobile-persistence'
import type { PersistedCollectionPersistence } from '@tanstack/db-sqlite-persisted-collection-core'

export type ExpoSQLitePersistenceAdapterOptions =
  MobileSQLitePersistenceAdapterOptions
export type ExpoSQLitePersistenceOptions = MobileSQLitePersistenceOptions

export function createExpoSQLitePersistenceAdapter<
  T extends object,
  TKey extends string | number = string | number,
>(
  options: ExpoSQLitePersistenceAdapterOptions,
): MobileSQLitePersistenceAdapter<T, TKey> {
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
