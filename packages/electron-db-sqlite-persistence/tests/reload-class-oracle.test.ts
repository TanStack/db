/**
 * Electron driver for the reload class oracle in
 * `packages/db-sqlite-persistence-core/tests/reload-class-oracle.ts`, which
 * owns the law, model, histories, driver loop, and comparison.
 *
 * Each tab is a renderer: the real renderer persistence and an
 * ElectronCollectionCoordinator over Node's Web Locks and BroadcastChannel.
 * Renderers share one main process, as windows of one app do: the real main
 * handler and Node persistence over one better-sqlite3 connection. A main
 * process starts with the first renderer of a session and closes with the
 * last, so the fill and the reload are separate app sessions. The `ipcMain`
 * double forwards each envelope in process. With latency, each IPC round trip
 * takes a task. The recorder logs every statement the main connection runs,
 * with its parameters. A real Electron process and real IPC latency are not
 * run here.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test as fcTest } from '@fast-check/vitest'
import { describe, expect, onTestFinished } from 'vitest'
import { createNodeSQLitePersistence } from '@tanstack/node-db-sqlite-persistence'
import { BetterSqlite3SQLiteDriver } from '../../node-db-sqlite-persistence/src/node-driver'
import { oraclePropertyOptions, oracleRuns } from '../../db/tests/oracle-config'
import {
  fixedReloadHistories,
  inProcessSeams,
  observeReload,
  reloadHistoryArb,
  reloadViolations,
} from '../../db-sqlite-persistence-core/tests/reload-class-oracle'
import {
  createElectronSQLitePersistence,
  exposeElectronSQLitePersistence,
} from '../src'
import { ElectronCollectionCoordinator } from '../src/electron-coordinator'
import type {
  ReloadHistory,
  ReloadHost,
} from '../../db-sqlite-persistence-core/tests/reload-class-oracle'
import type { BetterSqlite3Database } from '@tanstack/node-db-sqlite-persistence'
import type {
  ElectronPersistenceInvoke,
  ElectronPersistenceRequestEnvelope,
  ElectronPersistenceResponseEnvelope,
} from '../src/protocol'

type Recorder = (sql: string, params: ReadonlyArray<unknown>) => void
type IpcHandler = (
  event: unknown,
  request: ElectronPersistenceRequestEnvelope,
) => Promise<ElectronPersistenceResponseEnvelope>

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

// Records each statement the main connection runs, with its parameters.
function recordingDatabase(
  database: BetterSqlite3Database,
  record: () => Recorder | null,
): BetterSqlite3Database {
  const statement = (
    sql: string,
    prepared: ReturnType<BetterSqlite3Database[`prepare`]>,
  ) =>
    new Proxy(prepared, {
      get(target, property) {
        const value = Reflect.get(target, property, target) as unknown
        if (
          typeof value === `function` &&
          (property === `all` || property === `run` || property === `get`)
        ) {
          return (...params: Array<unknown>) => {
            record()?.(sql, params)
            return (value as (...args: Array<unknown>) => unknown).apply(
              target,
              params,
            )
          }
        }
        return typeof value === `function` ? value.bind(target) : value
      },
    })
  return new Proxy(database, {
    get(target, property) {
      if (property === `prepare`) {
        return (sql: string) => statement(sql, target.prepare(sql))
      }
      if (property === `exec`) {
        return (sql: string) => {
          record()?.(sql, [])
          return target.exec(sql)
        }
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === `function` ? value.bind(target) : value
    },
  })
}

function openConnection(filename: string): BetterSqlite3Database {
  return new BetterSqlite3SQLiteDriver({ filename }).getDatabase()
}

function electronHost(): ReloadHost {
  const directory = mkdtempSync(join(tmpdir(), `electron-reload-class-`))
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }))
  const filename = join(directory, `state.sqlite`)
  let recorder: Recorder | null = null
  let latency: 0 | 1 = 0
  let main: { invoke: ElectronPersistenceInvoke; close: () => void } | null =
    null
  let renderers = 0

  const startMain = () => {
    const database = openConnection(filename)
    let handler: IpcHandler | undefined
    const dispose = exposeElectronSQLitePersistence({
      ipcMain: {
        handle: (_channel: string, listener: IpcHandler) => {
          handler = listener
        },
        removeHandler: () => {},
      },
      persistence: createNodeSQLitePersistence({
        database: recordingDatabase(database, () => recorder),
        schemaMismatchPolicy: `reset`,
      }),
    })
    return {
      invoke: (async (_channel, request) => {
        if (latency === 1) await nextTask()
        const response = await handler!(undefined, request)
        if (latency === 1) await nextTask()
        return response
      }) satisfies ElectronPersistenceInvoke,
      close: () => {
        dispose()
        database.close()
      },
    }
  }

  const raw = <T>(use: (database: BetterSqlite3Database) => T): T => {
    const database = openConnection(filename)
    try {
      return use(database)
    } finally {
      database.close()
    }
  }

  return {
    controlsLatency: true,
    seams: inProcessSeams,
    adapterPerTab: false,
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
      main ??= startMain()
      renderers++
      const session = main
      const coordinator = new ElectronCollectionCoordinator({ dbName })
      return Promise.resolve({
        persistence: createElectronSQLitePersistence({
          coordinator,
          invoke: (channel, request) => session.invoke(channel, request),
        }),
        isLeader: (storageId) => coordinator.isLeader(storageId),
        close: () => {
          coordinator.dispose()
          if (--renderers === 0) {
            session.close()
            main = null
          }
          return Promise.resolve()
        },
      })
    },
  }
}

async function expectLawful(history: ReloadHistory) {
  const observed = await observeReload(electronHost(), history)
  const violations = reloadViolations(history, observed)
  if (violations.length > 0 && process.env.RELOAD_ORACLE_DEBUG) {
    console.log(JSON.stringify(violations))
  }
  expect(violations).toEqual([])
}

describe(`reload class oracle (Electron driver)`, () => {
  fcTest.each(
    fixedReloadHistories.map(([name, history]) => ({ name, history })),
  )(
    `keeps a reload free of avoidable work: $name`,
    async ({ history }) => {
      await expectLawful(history)
    },
    30_000,
  )

  fcTest.prop([reloadHistoryArb], { seed: 2205, numRuns: oracleRuns(12) })(
    `keeps generated reloads lawful (fixed seed)`,
    expectLawful,
    300_000,
  )

  fcTest.prop(
    [reloadHistoryArb],
    oraclePropertyOptions(12, `sqlite-reload.class.electron`),
  )(
    `keeps generated reloads lawful (random or replayed)`,
    expectLawful,
    300_000,
  )
})
