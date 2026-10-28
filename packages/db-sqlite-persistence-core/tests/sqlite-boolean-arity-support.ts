import { DatabaseSync } from 'node:sqlite'
import type { SQLiteDriver } from '../src'

// Fixtures for the boolean-arity oracle and its ordinary scenario tests. The
// oracle in `sqlite-boolean-arity-oracle.test.ts` owns the law.

export type Read = { sql: string; rawRows: number; parameters: number }

export class CountingDriver implements SQLiteDriver {
  readonly db = new DatabaseSync(':memory:')
  reads: Array<Read> = []
  private depth = 0
  mutantUnaryValue: 'x' | 1 | undefined
  mutantDropWhere = false
  mutantPushUnsafeOr = false

  exec(sql: string): Promise<void> {
    this.db.exec(sql)
    return Promise.resolve()
  }
  run(sql: string, params: ReadonlyArray<unknown> = []): Promise<void> {
    this.db
      .prepare(sql)
      .run(...(params as Array<string | number | bigint | null>))
    return Promise.resolve()
  }
  query<T>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<ReadonlyArray<T>> {
    const collectionRead = sql.startsWith(
      'SELECT key, value, metadata, row_version FROM',
    )
    if (
      collectionRead &&
      this.mutantUnaryValue !== undefined &&
      !sql.includes(' WHERE ')
    ) {
      sql += ' WHERE (?)'
      params = [...params, this.mutantUnaryValue]
    }
    if (collectionRead && this.mutantDropWhere && sql.includes(' WHERE ')) {
      sql = sql.slice(0, sql.indexOf(' WHERE '))
      params = []
    }
    if (collectionRead && this.mutantPushUnsafeOr && !sql.includes(' WHERE ')) {
      sql += ` WHERE LOWER(json_extract(value, '$.name')) LIKE LOWER(?)`
      params = [...params, 'ä']
    }
    const rows = this.db
      .prepare(sql)
      .all(...(params as Array<string | number | bigint | null>)) as Array<T>
    if (collectionRead)
      this.reads.push({
        sql,
        rawRows: rows.length,
        parameters: params.length,
      })
    return Promise.resolve(rows)
  }
  async transaction<T>(fn: (driver: SQLiteDriver) => Promise<T>): Promise<T> {
    const depth = this.depth++
    this.db.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT nested_${depth}`)
    try {
      const result = await fn(this)
      this.db.exec(depth === 0 ? 'COMMIT' : `RELEASE SAVEPOINT nested_${depth}`)
      return result
    } catch (error) {
      this.db.exec(
        depth === 0 ? 'ROLLBACK' : `ROLLBACK TO SAVEPOINT nested_${depth}`,
      )
      if (depth > 0) this.db.exec(`RELEASE SAVEPOINT nested_${depth}`)
      throw error
    } finally {
      this.depth--
    }
  }
}
