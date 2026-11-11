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
import { onTestFinished } from 'vitest'
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import { declareOracle } from '../../db/tests/oracle-declaration'
import {
  expectedReload,
  fixedReloadHistories,
  inProcessSeams,
  observeReload,
  reloadHistoryArb,
  reloadViolations,
} from '../../db-sqlite-persistence-core/tests/reload-class-oracle'
import { BrowserCollectionCoordinator } from '../src/browser-coordinator'
import { createBrowserWASQLitePersistence } from '../src'
import { createWASQLiteTestDatabase } from './helpers/wa-sqlite-test-db'
import type { Observation, Verdict } from '../../db/tests/oracle-property'
import type {
  ReloadHistory,
  ReloadHost,
  ReloadObservation,
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
    seams: inProcessSeams,
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

// Keep the shared independent model and the host's declared topology. The
// checker still applies every existing setup, budget, row, and ordering law.
function model(history: ReloadHistory) {
  return expectedReload(history, { adapterPerTab: true })
}

function check(
  history: ReloadHistory,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof model>,
): Verdict {
  const observed = trace.find((entry) => entry.checkpoint === `reload`)
    ?.value as ReloadObservation | undefined
  if (!observed)
    return violation(
      `reload`,
      `reload observation is missing`,
      `reload work and rows`,
    )
  const violations = reloadViolations(history, observed, expected)
  if (violations.length > 0 && process.env.RELOAD_ORACLE_DEBUG) {
    console.log(JSON.stringify(violations))
  }
  return violations.length === 0
    ? pass
    : violation(`reload`, violations.join(`; `), `reload work and rows`)
}

// The full SQL recorder includes generated cache/claim IDs, table-name hashes,
// clock readings, and host statement interleavings. Their exact spelling and
// timing are not reload laws. Judge the unchanged raw record with the shared
// independent model and comparison at the same reload checkpoint, then expose
// that complete judgment to the native runner. This preserves every existing
// count, identity relation, ordering check, and bounded-settlement comparison
// without making the determinism check compare incidental host details.
async function driveReload(
  history: ReloadHistory,
  observe: (checkpoint: string, value: unknown) => void,
): Promise<void> {
  const observed = await observeReload(nodeBrowserHost(), history)
  observe(
    `reload`,
    check(history, [{ checkpoint: `reload`, value: observed }], model(history)),
  )
}

function checkRecordedReload(
  _history: ReloadHistory,
  trace: ReadonlyArray<Observation>,
  _expected: ReturnType<typeof model>,
): Verdict {
  return (
    (trace.find((entry) => entry.checkpoint === `reload`)?.value as
      Verdict | undefined) ??
    violation(`reload`, `reload observation is missing`, `reload work and rows`)
  )
}

declareOracle({
  owns: [`src/browser-coordinator.ts`, `src/browser-persistence.ts`],
  model: [model],
  check: [check, checkRecordedReload],
  grammar: [reloadHistoryArb],
})

oracleProperty({
  id: `sqlite-reload.class`,
  law: {
    statement: `A reload repairs missing setup and preserves lawful rows while performing only the setup, snapshot, registry, and election work allowed by the shared reload model.`,
    authority: `The shared reload-class contract in db-sqlite-persistence-core/tests/reload-class-oracle.ts.`,
    limits: `Node Browser receiving driver with the existing in-process host controls; no claim about real cross-process scheduling or physical OPFS.`,
  },
  histories: {
    arbitrary: reloadHistoryArb,
    runs: 12,
    fixedSeeds: [2204],
  },
  model,
  driver: driveReload,
  check: checkRecordedReload,
  timeout: 300_000,
})

// Retain the fixed host histories separately from the bounded random grammar.
oracleProperty({
  id: `sqlite-reload.class-fixed`,
  law: {
    statement: `The retained host reload histories satisfy every existing setup, row, budget, and ordering comparison.`,
    authority: `The shared reload-class contract in db-sqlite-persistence-core/tests/reload-class-oracle.ts.`,
    limits: `The named fixed histories on this existing in-process receiving driver.`,
  },
  histories: fixedReloadHistories.map(([name, history]) => ({ name, history })),
  label: (entry) => entry.name,
  resolve: (entry) => entry.history,
  model,
  driver: driveReload,
  check: checkRecordedReload,
  timeout: 30_000,
})
