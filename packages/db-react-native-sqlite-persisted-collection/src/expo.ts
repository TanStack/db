import {
  createReactNativeSQLitePersistence,
  createReactNativeSQLitePersistenceAdapter,
  createReactNativeSQLitePersister,
} from './react-native'
import type {
  ReactNativeSQLitePersistenceAdapterOptions,
  ReactNativeSQLitePersistenceOptions,
  ReactNativeSQLitePersister,
} from './react-native'
import type {
  MobileSQLitePersistenceAdapter,
} from './mobile-persistence'
import type { PersistedCollectionPersistence } from '@tanstack/db-sqlite-persisted-collection-core'

export type ExpoSQLitePersistenceAdapterOptions =
  ReactNativeSQLitePersistenceAdapterOptions
export type ExpoSQLitePersistenceOptions = ReactNativeSQLitePersistenceOptions
export type ExpoSQLitePersister = ReactNativeSQLitePersister

export function createExpoSQLitePersister(
  options: ExpoSQLitePersistenceOptions,
): ExpoSQLitePersister {
  return createReactNativeSQLitePersister(options)
}

export function createExpoSQLitePersistenceAdapter<
  T extends object,
  TKey extends string | number = string | number,
>(
  options: ExpoSQLitePersistenceAdapterOptions,
): MobileSQLitePersistenceAdapter<T, TKey> {
  return createReactNativeSQLitePersistenceAdapter<T, TKey>(options)
}

export function createExpoSQLitePersistence<
  T extends object,
  TKey extends string | number = string | number,
>(
  options: ExpoSQLitePersistenceOptions,
): PersistedCollectionPersistence<T, TKey> {
  return createReactNativeSQLitePersistence<T, TKey>(options)
}
