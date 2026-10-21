/**
 * Node Browser driver for the reload class oracle in
 * `packages/db-sqlite-persistence-core/tests/reload-class-oracle.ts`, which
 * owns the law, model, histories, driver loop, and comparison.
 *
 * Each tab is the real Browser persistence over its own connection to one
 * SQLite file, with a real BrowserCollectionCoordinator over Node's Web Locks
 * and BroadcastChannel. The driver records every statement each connection
 * runs and can delay each one by a task, like a worker round trip. Browser
 * connections live in separate workers and wait for a database lock without
 * blocking each other. These share one thread, so a busy statement retries on
 * the next task instead of blocking the thread on SQLite's busy timeout.
 * Raw setup damage and final inspection use a separate better-sqlite3
 * connection. Real OPFS and a real browser lock manager are the Chromium
 * driver's premises.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { test as fcTest } from '@fast-check/vitest'
import { describe, expect, onTestFinished } from 'vitest'
import { oraclePropertyOptions, oracleRuns } from '../../db/tests/oracle-config'
import {
  fixedReloadHistories,
  observeReload,
  reloadHistoryArb,
  reloadViolations,
} from '../../db-sqlite-persistence-core/tests/reload-class-oracle'
import { BrowserCollectionCoordinator } from '../src/browser-coordinator'
import { createBrowserWASQLitePersistence } from '../src'
import { createWASQLiteTestDatabase } from './helpers/wa-sqlite-test-db'
import type {
  ReloadHistory,
  ReloadHost,
} from '../../db-sqlite-persistence-core/tests/reload-class-oracle'

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function nodeBrowserHost(): ReloadHost {
  const directory = mkdtempSync(join(tmpdir(), `reload-class-`))
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }))
  const filename = join(directory, `state.sqlite`)
  let recorder: ((sql: string, params: ReadonlyArray<unknown>) => void) | null =
    null
  let latency: 0 | 1 = 0
  const raw = <T>(use: (database: BetterSqlite3.Database) => T): T => {
    const database = new BetterSqlite3(filename)
    try {
      return use(database)
    } finally {
      database.close()
    }
  }
  return {
    controlsLatency: true,
    adapterPerTab: true,
    record: (next) => {
      recorder = next
    },
    setStatementLatency: (next) => {
      latency = next
    },
    rawQuery: (sql, params = []) =>
      Promise.resolve(
        raw(
          (database) =>
            database.prepare(sql).all(...params) as Array<
              Record<string, unknown>
            >,
        ),
      ),
    rawExec: (sql) => {
      raw((database) => database.exec(sql))
      return Promise.resolve()
    },
    openTab: (dbName) => {
      const database = createWASQLiteTestDatabase({ filename, timeout: 0 })
      const execute = database.execute.bind(database)
      database.execute = async <TRow>(
        sql: string,
        params: ReadonlyArray<unknown> = [],
      ) => {
        if (latency === 1) await nextTask()
        recorder?.(sql, params)
        for (;;) {
          try {
            return await execute<TRow>(sql, params)
          } catch (error) {
            if ((error as { code?: string }).code !== `SQLITE_BUSY`) throw error
            await nextTask()
          }
        }
      }
      const coordinator = new BrowserCollectionCoordinator({ dbName })
      return Promise.resolve({
        persistence: createBrowserWASQLitePersistence({
          database,
          coordinator,
          schemaMismatchPolicy: `reset`,
        }),
        isLeader: (storageId) => coordinator.isLeader(storageId),
        close: async () => {
          coordinator.dispose()
          await database.close?.()
        },
      })
    },
  }
}

async function expectLawful(history: ReloadHistory) {
  const observed = await observeReload(nodeBrowserHost(), history)
  const violations = reloadViolations(history, observed)
  if (violations.length > 0 && process.env.RELOAD_ORACLE_DEBUG) {
    console.log(JSON.stringify(violations))
  }
  expect(violations).toEqual([])
}

describe(`reload class oracle (Node Browser driver)`, () => {
  fcTest.each(
    fixedReloadHistories.map(([name, history]) => ({ name, history })),
  )(
    `keeps a reload free of avoidable work: $name`,
    async ({ history }) => {
      await expectLawful(history)
    },
    30_000,
  )

  fcTest.prop([reloadHistoryArb], { seed: 2204, numRuns: oracleRuns(12) })(
    `keeps generated reloads lawful (fixed seed)`,
    expectLawful,
    300_000,
  )

  fcTest.prop(
    [reloadHistoryArb],
    oraclePropertyOptions(12, `sqlite-reload.class`),
  )(
    `keeps generated reloads lawful (random or replayed)`,
    expectLawful,
    300_000,
  )
})
