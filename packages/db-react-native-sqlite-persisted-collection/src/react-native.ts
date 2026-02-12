import { createMobileSQLitePersistence } from './mobile-persistence'
import type {
  MobileSQLitePersistenceOptions,
  MobileSQLiteSchemaMismatchPolicy,
} from './mobile-persistence'
import type { PersistedCollectionPersistence } from '@tanstack/db-sqlite-persisted-collection-core'

export type ReactNativeSQLitePersistenceOptions = MobileSQLitePersistenceOptions
export type ReactNativeSQLiteSchemaMismatchPolicy =
  MobileSQLiteSchemaMismatchPolicy
export type { OpSQLiteDatabaseLike } from './mobile-persistence'

export function createReactNativeSQLitePersistence<
  T extends object,
  TKey extends string | number = string | number,
>(
  options: ReactNativeSQLitePersistenceOptions,
): PersistedCollectionPersistence<T, TKey> {
  return createMobileSQLitePersistence<T, TKey>(options)
}
