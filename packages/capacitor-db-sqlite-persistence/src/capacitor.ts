import { createCapacitorSQLitePersistence as createPersistence } from './capacitor-persistence'
import type {
  CapacitorSQLitePersistenceOptions as CapacitorSQLitePersistenceOptionsBase,
  CapacitorSQLiteSchemaMismatchPolicy as CapacitorSQLiteSchemaMismatchPolicyBase,
} from './capacitor-persistence'
import type { PersistedCollectionPersistence } from '@tanstack/db-sqlite-persistence-core'

export type CapacitorSQLitePersistenceOptions =
  CapacitorSQLitePersistenceOptionsBase
export type CapacitorSQLiteSchemaMismatchPolicy =
  CapacitorSQLiteSchemaMismatchPolicyBase
export type { CapacitorSQLiteDatabaseLike } from './capacitor-persistence'
export type { SQLiteDBConnection } from './capacitor-persistence'

export function createCapacitorSQLitePersistence(
  options: CapacitorSQLitePersistenceOptions,
): PersistedCollectionPersistence {
  return createPersistence(options)
}
