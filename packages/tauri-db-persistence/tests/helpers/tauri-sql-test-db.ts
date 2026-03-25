import BetterSqlite3 from 'better-sqlite3'
import type { TauriSQLiteDatabaseLike } from '../../src/tauri-sql-driver'

function convertTauriPlaceholdersToSqlite(sql: string): string {
  return sql.replace(/\$\d+/g, `?`)
}

export function createTauriSQLiteTestDatabase(options: {
  filename: string
}): TauriSQLiteDatabaseLike & {
  close: (db?: string) => Promise<boolean>
} {
  const database = new BetterSqlite3(options.filename)

  return {
    path: options.filename,
    execute: async (sql, bindValues: Array<unknown> = []) => {
      const normalizedSql = convertTauriPlaceholdersToSqlite(sql)
      const statement = database.prepare(normalizedSql)
      const result =
        bindValues.length > 0 ? statement.run(...bindValues) : statement.run()

      return {
        rowsAffected: result.changes,
        lastInsertId:
          typeof result.lastInsertRowid === `bigint`
            ? Number(result.lastInsertRowid)
            : result.lastInsertRowid,
      }
    },
    select: async <TRow>(
      sql: string,
      bindValues: Array<unknown> = [],
    ): Promise<TRow> => {
      const normalizedSql = convertTauriPlaceholdersToSqlite(sql)
      const statement = database.prepare(normalizedSql)
      const rows =
        bindValues.length > 0 ? statement.all(...bindValues) : statement.all()
      return rows as TRow
    },
    close: async () => {
      database.close()
      return true
    },
  }
}
