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

export type ReactNativeSQLitePersistenceAdapterOptions =
  MobileSQLitePersistenceAdapterOptions
export type ReactNativeSQLitePersistenceOptions = MobileSQLitePersistenceOptions

export function createReactNativeSQLitePersistenceAdapter<
  T extends object,
  TKey extends string | number = string | number,
>(
  options: ReactNativeSQLitePersistenceAdapterOptions,
): PersistenceAdapter<T, TKey> {
  return createMobileSQLitePersistenceAdapter<T, TKey>(options)
}

export function createReactNativeSQLitePersistence<
  T extends object,
  TKey extends string | number = string | number,
>(
  options: ReactNativeSQLitePersistenceOptions,
): PersistedCollectionPersistence<T, TKey> {
  return createMobileSQLitePersistence<T, TKey>(options)
}
