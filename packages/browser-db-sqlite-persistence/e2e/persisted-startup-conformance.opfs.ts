// Chromium OPFS receives the same shared startup comparison as both Node
// hosts. The real QueryClient and Convex SDK supply their adapter boundaries;
// this page supplies only actual worker/OPFS storage and result reporting.
import {
  PersistedStartupViolation,
  persistedStartupHistories,
  persistedStartupViolations,
  startupReachedStates,
  startupRequiredStates,
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
import {
  capabilityHistories,
  capabilityViolations,
  observeCapability,
} from '../../db-adapter-conformance/tests/persisted-capability-oracle'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import {
  removeStartupOPFSArtifacts,
  startupOPFSArtifacts,
} from './persisted-startup-opfs-cleanup'
import type { PersistedStartupHistory } from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import type { PersistedStartupAdapter } from '../../db-adapter-conformance/tests/persisted-startup-driver'

export type StartupConformanceResult = {
  results: Array<{
    adapter: string
    history: unknown
    violations: Array<string>
  }>
  capabilities: Array<{
    adapter: string
    history: unknown
    violations: Array<string>
  }>
  artifacts: Array<string>
  error?: string
}
declare global {
  interface Window {
    __persistedStartupConformance?: StartupConformanceResult
  }
}
async function run() {
  const results: StartupConformanceResult[`results`] = []
  const capabilities: StartupConformanceResult[`capabilities`] = []
  let artifacts: Array<string> = []
  let sequence = 0
  async function receive<H extends PersistedStartupHistory>(
    name: string,
    adapter: PersistedStartupAdapter<H>,
    histories: Array<H>,
  ) {
    // This page has no Node oracle runner. Each completed history calls its
    // startup observer once; fail locally if any required receiving state is absent.
    const reach: Record<string, number> = Object.fromEntries(
      startupRequiredStates(adapter.scope).map((state) => [state, 0]),
    )
    for (const history of histories) {
      const index = sequence++
      const databaseName = `ps-${index}.sqlite`
      await removeStartupOPFSArtifacts(databaseName)
      const database = await openBrowserWASQLiteOPFSDatabase({ databaseName })
      await withOracleCleanup(async () => {
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
              for (const state of startupReachedStates(history)) reach[state]!++
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
      }, [
        () => database.close?.(),
        () => removeStartupOPFSArtifacts(databaseName),
      ])
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
    for (const [name, adapter] of [
      [`rxdb`, rxdbStartupAdapter],
      [`powersync`, powerSyncBrowserStartupAdapter],
    ] as const) {
      for (const history of capabilityHistories) {
        const databaseName = `ps-${sequence++}.sqlite`
        await removeStartupOPFSArtifacts(databaseName)
        const database = await openBrowserWASQLiteOPFSDatabase({ databaseName })
        await withOracleCleanup(async () => {
          const error = await observeCapability(
            adapter,
            createBrowserWASQLitePersistence({ database }),
            history,
            `capability-${sequence}`,
          )
          capabilities.push({
            adapter: name,
            history,
            violations: capabilityViolations(history, error),
          })
        }, [
          () => database.close?.(),
          () => removeStartupOPFSArtifacts(databaseName),
        ])
      }
    }
    artifacts = await startupOPFSArtifacts()
    window.__persistedStartupConformance = { results, capabilities, artifacts }
  } catch (error) {
    window.__persistedStartupConformance = {
      results,
      capabilities,
      artifacts,
      error:
        error instanceof Error
          ? `${error.stack} ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`
          : String(error),
    }
  }
}
void run()
