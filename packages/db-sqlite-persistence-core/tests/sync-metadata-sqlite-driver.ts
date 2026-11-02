import { AsyncLocalStorage } from 'node:async_hooks'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { SQLiteDriver } from '../src'

/**
 * One SQLite connection admits root calls in order. A transaction's scoped
 * driver executes its calls inside that admission, so another adapter's read
 * cannot observe it before commit or become part of its rollback.
 * Nested scopes use savepoints. Root calls in the transaction's async context
 * reenter its scope, rather than queue behind the callback that awaits them.
 */
export function createMetadataSQLiteDriver(database: DatabaseSync) {
  let queue: Promise<unknown> = Promise.resolve()
  const context = new AsyncLocalStorage<boolean>()
  let nextSavepoint = 0
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work)
    queue = next.catch(() => undefined)
    return next
  }
  const scoped: SQLiteDriver = {
    exec: async (sql) => database.exec(sql),
    query: async <T>(sql: string, params: ReadonlyArray<unknown> = []) =>
      database
        .prepare(sql)
        .all(...(params as Array<SQLInputValue>)) as Array<T>,
    run: async (sql, params = []) => {
      database.prepare(sql).run(...(params as Array<SQLInputValue>))
    },
    transaction: async (work) => {
      const savepoint = `metadata_${nextSavepoint++}`
      database.exec(`SAVEPOINT ${savepoint}`)
      try {
        const result = await work(scoped)
        database.exec(`RELEASE SAVEPOINT ${savepoint}`)
        return result
      } catch (error) {
        database.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)
        database.exec(`RELEASE SAVEPOINT ${savepoint}`)
        throw error
      }
    },
  }
  const transaction: SQLiteDriver[`transaction`] = (work) =>
    context.getStore()
      ? scoped.transaction(work)
      : enqueue(async () => {
          database.exec(`BEGIN IMMEDIATE`)
          try {
            const result = await context.run(true, () => work(scoped))
            database.exec(`COMMIT`)
            return result
          } catch (error) {
            database.exec(`ROLLBACK`)
            throw error
          }
        })
  const driver: SQLiteDriver = {
    exec: (sql) =>
      context.getStore() ? scoped.exec(sql) : enqueue(() => scoped.exec(sql)),
    query: <T>(sql: string, params?: ReadonlyArray<unknown>) =>
      context.getStore()
        ? scoped.query<T>(sql, params)
        : enqueue(() => scoped.query<T>(sql, params)),
    run: (sql, params) =>
      context.getStore()
        ? scoped.run(sql, params)
        : enqueue(() => scoped.run(sql, params)),
    transaction,
    transactionWithDriver: transaction,
  }
  return { driver, drained: () => queue }
}
