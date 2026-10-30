import type { DatabaseSync } from 'node:sqlite'
import type { SQLiteDriver } from '../../src/index.js'

function toBinding(value: unknown): string | number | bigint | null {
  if (value === null || value === undefined) return null
  if (typeof value === `boolean`) return value ? 1 : 0
  if (
    typeof value === `string` ||
    typeof value === `number` ||
    typeof value === `bigint`
  ) {
    return value
  }
  return String(value)
}

/**
 * A `node:sqlite` driver for tests that meets the driver contract's
 * serialization rule (`tests/contracts/sqlite-driver-contract.ts`): work
 * outside a transaction waits behind an active transaction, so several
 * Collections can share one connection. Work inside a transaction uses the
 * transaction driver directly.
 */
export function createSerializedNodeSqliteDriver(
  database: DatabaseSync,
): SQLiteDriver {
  let tail: Promise<unknown> = Promise.resolve()
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task, task)
    tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
  const direct: SQLiteDriver = {
    exec: (sql) => {
      database.exec(sql)
      return Promise.resolve()
    },
    query: (sql, params = []) =>
      Promise.resolve(
        database
          .prepare(sql)
          .all(...params.map(toBinding))
          .map((row) => ({ ...row })) as Array<never>,
      ),
    run: (sql, params = []) => {
      database.prepare(sql).run(...params.map(toBinding))
      return Promise.resolve()
    },
    transaction: (transaction) => transaction(direct),
  }
  return {
    exec: (sql) => serialize(() => direct.exec(sql)),
    query: (sql, params) => serialize(() => direct.query(sql, params)),
    run: (sql, params) => serialize(() => direct.run(sql, params)),
    transaction: (transaction) =>
      serialize(async () => {
        database.exec(`BEGIN IMMEDIATE`)
        try {
          const result = await transaction(direct)
          database.exec(`COMMIT`)
          return result
        } catch (error) {
          database.exec(`ROLLBACK`)
          throw error
        }
      }),
  }
}
