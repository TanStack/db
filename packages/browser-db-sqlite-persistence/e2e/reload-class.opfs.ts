/**
 * Chromium driver for the reload class oracle in
 * `packages/db-sqlite-persistence-core/tests/reload-class-oracle.ts`, which
 * owns the law, model, histories, driver loop, and comparison. It runs every
 * fixed history against real OPFS: each tab is the real Browser persistence
 * over its own OPFS connection and worker, with a real
 * BrowserCollectionCoordinator over Chromium's Web Locks and BroadcastChannel.
 * Statement latency is the real worker round trip, not a driver control. A
 * separate OPFS connection applies setup damage and inspects the result.
 */
import {
  BrowserCollectionCoordinator,
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
} from '../src/index'
import {
  fixedReloadHistories,
  inProcessSeams,
  observeReload,
  reloadViolations,
} from '../../db-sqlite-persistence-core/tests/reload-class-oracle'
import type { BrowserWASQLiteDatabase } from '../src/index'
import type {
  ReloadHistory,
  ReloadHost,
} from '../../db-sqlite-persistence-core/tests/reload-class-oracle'

export type ReloadClassResult =
  | {
      status: `complete`
      /** Every fixed history name in the oracle, in order. */
      expected: Array<string>
      results: Array<{
        name: string
        history: ReloadHistory
        violations: Array<string>
      }>
    }
  | { status: `failed-before-checkpoint`; name: string; primaryFailure: string }

declare global {
  interface Window {
    __tanstackReloadClassOracle?: ReloadClassResult
  }
}

function chromiumHost(databaseName: string): {
  host: ReloadHost
  close: () => Promise<void>
} {
  let recorder: ((sql: string, params: ReadonlyArray<unknown>) => void) | null =
    null
  let raw: Promise<BrowserWASQLiteDatabase> | undefined
  const rawDatabase = () =>
    (raw ??= openBrowserWASQLiteOPFSDatabase({ databaseName }))
  const host: ReloadHost = {
    controlsLatency: false,
    seams: inProcessSeams,
    adapterPerTab: true,
    record: (next) => {
      recorder = next
    },
    setStatementLatency: () => {},
    rawQuery: async (sql, params = []) =>
      [...(await (await rawDatabase()).execute(sql, params))] as Array<
        Record<string, unknown>
      >,
    rawExec: async (sql) => {
      await (await rawDatabase()).execute(sql)
    },
    openTab: async (dbName) => {
      const database = await openBrowserWASQLiteOPFSDatabase({ databaseName })
      const execute = database.execute.bind(database)
      database.execute = <TRow>(
        sql: string,
        params: ReadonlyArray<unknown> = [],
      ) => {
        recorder?.(sql, params)
        return execute<TRow>(sql, params)
      }
      const coordinator = new BrowserCollectionCoordinator({ dbName })
      return {
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
      }
    },
  }
  return {
    host,
    close: async () => {
      if (raw) await (await raw).close?.()
    },
  }
}

async function run(): Promise<void> {
  const status = document.querySelector<HTMLOutputElement>(`#oracle-status`)
  const results = []
  for (const [index, [name, history]] of fixedReloadHistories.entries()) {
    // OPFS database names near 63 characters fail to open; keep them short.
    const databaseName = `rc-${index}-${crypto.randomUUID().slice(0, 8)}.sqlite`
    const { host, close } = chromiumHost(databaseName)
    try {
      const observation = await observeReload(host, history)
      results.push({
        name,
        history,
        violations: reloadViolations(history, observation),
      })
    } catch (error) {
      window.__tanstackReloadClassOracle = {
        status: `failed-before-checkpoint`,
        name,
        primaryFailure: error instanceof Error ? error.message : String(error),
      }
      if (status) status.value = `failed-before-checkpoint`
      return
    } finally {
      await close()
    }
  }
  window.__tanstackReloadClassOracle = {
    status: `complete`,
    expected: fixedReloadHistories.map(([name]) => name),
    results,
  }
  if (status) status.value = `complete`
}

void run()
