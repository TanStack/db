// Chromium OPFS receives the same shared startup comparison as both Node
// hosts. The real QueryClient and Convex SDK supply their adapter boundaries;
// this page supplies only actual worker/OPFS storage and result reporting.
import {
  PersistedStartupViolation,
  persistedStartupHistories,
  persistedStartupViolations,
} from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import {
  isStartupRowRead,
  observePersistedStartup,
} from '../../db-adapter-conformance/tests/persisted-startup-driver'
import {
  queryStartupAdapter,
  queryStartupHistories,
} from '../../query-db-collection/tests/persisted-startup-driver'
import { convexStartupAdapter } from '../../convex-db-collection/tests/persisted-startup-driver'
import { electricStartupAdapter } from '../../electric-db-collection/tests/persisted-startup-driver'
import { trailBaseStartupAdapter } from '../../trailbase-db-collection/tests/persisted-startup-driver'
import { rxdbStartupAdapter } from '../../rxdb-db-collection/tests/persisted-startup-driver'
import { powerSyncBrowserStartupAdapter } from '../../powersync-db-collection/tests/persisted-startup-browser'
import { inProcessSeams } from '../../db-sqlite-persistence-core/tests/reload-class-oracle'
import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
} from '../src'
import type { PersistedStartupHistory } from '../../db-adapter-conformance/tests/persisted-startup-oracle'
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
    // This page has no Node oracle runner. Each completed history calls its
    // startup observer once; fail locally if any required receiving state is absent.
    const reach: Record<string, number> = Object.fromEntries(
      [
        `response-before-restore`,
        `restore-before-response`,
        `persisting-mutation`,
        `empty-baseline`,
      ].map((state) => [state, 0]),
    )
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
            () => {
              reach[
                history.response === `before-restore`
                  ? `response-before-restore`
                  : `restore-before-response`
              ]!++
              if (history.mutation) reach[`persisting-mutation`]!++
              if (history.previous === 0) reach[`empty-baseline`]!++
            },
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
    for (const [state, count] of Object.entries(reach))
      if (!count) throw new Error(`${name}.opfs did not reach ${state}`)
    console.info(`${name}.opfs ${JSON.stringify(reach)}`)
  }
  try {
    await receive(`query`, queryStartupAdapter, queryStartupHistories)
    await receive(`convex`, convexStartupAdapter, persistedStartupHistories)
    await receive(`electric`, electricStartupAdapter, persistedStartupHistories)
    await receive(
      `trailbase`,
      trailBaseStartupAdapter,
      persistedStartupHistories,
    )
    await receive(`rxdb`, rxdbStartupAdapter, persistedStartupHistories)
    await receive(
      `powersync`,
      powerSyncBrowserStartupAdapter,
      persistedStartupHistories,
    )
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
