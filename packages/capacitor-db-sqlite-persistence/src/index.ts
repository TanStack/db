export { createCapacitorSQLitePersistence } from './capacitor'
export type {
  CapacitorSQLiteDatabaseLike,
  CapacitorSQLitePersistenceOptions,
  CapacitorSQLiteSchemaMismatchPolicy,
  SQLiteDBConnection,
} from './capacitor'
export {
  DEFAULT_APPLIED_TX_PRUNE_MAX_AGE_SECONDS,
  DEFAULT_APPLIED_TX_PRUNE_MAX_ROWS,
  persistedCollectionOptions,
} from '@tanstack/db-sqlite-persistence-core'
export type {
  PersistedCollectionCoordinator,
  PersistedCollectionPersistence,
} from '@tanstack/db-sqlite-persistence-core'
