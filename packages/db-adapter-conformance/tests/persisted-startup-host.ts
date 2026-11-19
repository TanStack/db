// Controlled and real Node SQLite hosts for the same startup production path.
// Full row reads are counted before the driver's own diagnostic durable read.
import { DatabaseSync } from 'node:sqlite'
import { createSQLiteCorePersistenceAdapter } from '../../db-sqlite-persistence-core/src'
import { inProcessSeams } from '../../db-sqlite-persistence-core/tests/reload-class-oracle'
import { BrowserWASQLiteDriver } from '../../browser-db-sqlite-persistence/src/wa-sqlite-driver'
import { createAdapter } from './memory-persistence'
import { isStartupRowRead } from './persisted-startup-driver'
import type { SQLInputValue } from 'node:sqlite'

export function createStartupHost(host: `controlled` | `node-sqlite`) {
  const database =
    host === `node-sqlite` ? new DatabaseSync(`:memory:`) : undefined
  let rowReads = 0
  const adapter = createAdapter([])
  const loadSnapshot = adapter.loadResumeSnapshot
  adapter.loadResumeSnapshot = (...args) => {
    if (args[1]?.includeRows !== false) rowReads++
    return loadSnapshot(...args)
  }
  const scanRows = adapter.scanRows
  adapter.scanRows = (...args) => {
    rowReads++
    return scanRows(...args)
  }
  const persistence = database
    ? {
        adapter: createSQLiteCorePersistenceAdapter({
          driver: new BrowserWASQLiteDriver({
            database: {
              execute: <T>(
                sql: string,
                params: ReadonlyArray<unknown> = [],
              ) => {
                if (isStartupRowRead(sql)) rowReads++
                if (
                  !/^\s*(select|with|pragma)/i.test(sql) &&
                  params.length === 0
                ) {
                  database.exec(sql)
                  return Promise.resolve([])
                }
                return Promise.resolve(
                  database
                    .prepare(sql)
                    .all(
                      ...(params.map((value) =>
                        value === undefined
                          ? null
                          : typeof value === `boolean`
                            ? Number(value)
                            : value,
                      ) as Array<SQLInputValue>),
                    ) as Array<T>,
                )
              },
            },
          }),
        }),
      }
    : { adapter }
  const holdBaseline = database
    ? inProcessSeams.holdFirstRowSnapshot
    : () => {
        const original = adapter.loadResumeSnapshot
        let release!: () => void
        const gate = new Promise<void>((resolve) => {
          release = resolve
        })
        let held = false
        let used = false
        adapter.loadResumeSnapshot = async (...args) => {
          if (!used && args[1]?.includeRows !== false) {
            used = true
            held = true
            await gate
            held = false
          }
          return original(...args)
        }
        return {
          isHeld: () => held,
          release,
          uninstall: () => {
            release()
            adapter.loadResumeSnapshot = original
          },
        }
      }
  return {
    persistence,
    holdBaseline,
    readRowCount: () => rowReads,
    close: () => database?.close(),
  }
}
