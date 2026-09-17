import { createMobileSQLitePersistence } from './mobile-persistence'
import type {
  MobileSQLitePersistenceOptions,
  MobileSQLiteSchemaMismatchPolicy,
} from './mobile-persistence'
import type { PersistedCollectionPersistence } from '@tanstack/db-sqlite-persistence-core'

export type ReactNativeSQLitePersistenceOptions = MobileSQLitePersistenceOptions
export type ReactNativeSQLiteSchemaMismatchPolicy =
  MobileSQLiteSchemaMismatchPolicy
export type { OpSQLiteDatabaseLike } from './mobile-persistence'

export function createReactNativeSQLitePersistence(
  options: ReactNativeSQLitePersistenceOptions,
): PersistedCollectionPersistence {
  return createMobileSQLitePersistence(options)
}
