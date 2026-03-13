import Database from '@tauri-apps/plugin-sql'
import type { TauriSQLiteDatabaseLike } from '../../../src'

export async function createNativeTauriSQLiteTestDatabase(options: {
  runId: string
}): Promise<TauriSQLiteDatabaseLike> {
  return Database.load(`sqlite:tanstack_db_tauri_e2e_${options.runId}.db`)
}
