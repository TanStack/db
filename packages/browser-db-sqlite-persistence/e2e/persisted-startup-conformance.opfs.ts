// Chromium OPFS receives the same shared startup comparison as both Node
// hosts. The real QueryClient and Convex SDK supply their adapter boundaries;
// this page supplies only actual worker/OPFS storage and result reporting.
import {
  PersistedStartupViolation,
  persistedStartupHistories,
  persistedStartupViolations,
} from '../../db-adapter-conformance/src/persisted-startup-oracle'
import {
  isStartupRowRead,
  observePersistedStartup,
} from '../../db-adapter-conformance/tests/persisted-startup-driver'
import {
  queryStartupAdapter,
  queryStartupHistories,
} from '../../query-db-collection/tests/persisted-startup-driver'
import { convexStartupAdapter } from '../../convex-db-collection/tests/persisted-startup-driver'
import { inProcessSeams } from '../../db-sqlite-persistence-core/tests/reload-class-oracle'
import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
} from '../src'
import type { PersistedStartupHistory } from '../../db-adapter-conformance/src/persisted-startup-oracle'
import type { PersistedStartupAdapter } from '../../db-adapter-conformance/tests/persisted-startup-driver'

export type StartupConformanceResult = {
  results: Array<{
    adapter: string
    history: unknown
    violations: Array<string>
  }>
  error?: string
}
declare global {
  interface Window {
    __persistedStartupConformance?: StartupConformanceResult
  }
}
async function run() {
  const results: StartupConformanceResult[`results`] = []
  let sequence = 0
  async function receive<H extends PersistedStartupHistory>(
    name: string,
    adapter: PersistedStartupAdapter<H>,
    histories: Array<H>,
  ) {
    for (const history of histories) {
      const index = sequence++
      const database = await openBrowserWASQLiteOPFSDatabase({
        databaseName: `ps-${index}.sqlite`,
      })
      try {
        let rowReads = 0
        const execute = database.execute.bind(database)
        database.execute = (sql, params) => {
          if (isStartupRowRead(sql)) rowReads++
          return execute(sql, params)
        }
        try {
          const observation = await observePersistedStartup(
            adapter,
            createBrowserWASQLitePersistence({ database }),
            inProcessSeams.holdFirstRowSnapshot,
            history,
            `startup-${index}`,
            () => rowReads,
          )
          results.push({
            adapter: name,
            history,
            violations: persistedStartupViolations(
              history,
              adapter.scope,
              observation,
            ),
          })
        } catch (error) {
          if (!(error instanceof PersistedStartupViolation)) throw error
          results.push({ adapter: name, history, violations: error.violations })
        }
      } finally {
        await database.close?.()
      }
    }
  }
  try {
    await receive(`query`, queryStartupAdapter, queryStartupHistories)
    await receive(`convex`, convexStartupAdapter, persistedStartupHistories)
    window.__persistedStartupConformance = { results }
  } catch (error) {
    window.__persistedStartupConformance = {
      results,
      error:
        error instanceof Error
          ? `${error.stack} ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`
          : String(error),
    }
  }
}
void run()
