import { createTauriSQLitePersistence as createPersistence } from './tauri-persistence'
import type {
  TauriSQLitePersistenceOptions as TauriSQLitePersistenceOptionsBase,
  TauriSQLiteSchemaMismatchPolicy as TauriSQLiteSchemaMismatchPolicyBase,
} from './tauri-persistence'
import type { PersistedCollectionPersistence } from '@tanstack/db-sqlite-persistence-core'

export type TauriSQLitePersistenceOptions = TauriSQLitePersistenceOptionsBase
export type TauriSQLiteSchemaMismatchPolicy =
  TauriSQLiteSchemaMismatchPolicyBase
export type { TauriSQLiteDatabaseLike } from './tauri-persistence'

export function createTauriSQLitePersistence<
  T extends object,
  TKey extends string | number = string | number,
>(
  options: TauriSQLitePersistenceOptions,
): PersistedCollectionPersistence<T, TKey> {
  return createPersistence<T, TKey>(options)
}
