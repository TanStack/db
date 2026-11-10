// Real Chromium OPFS receives the ownership oracle's held baseline / fast
// Query response premise. It supplies storage only, never expected results.
import {
  StartupOwnershipViolationError,
  isStartupRowRead,
  observeStartupOwnership,
  startupOwnershipHistories,
  startupOwnershipViolations,
} from '../../query-db-collection/tests/persisted-startup-ownership-oracle'
import { inProcessSeams } from '../../db-sqlite-persistence-core/tests/reload-class-oracle'
import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
} from '../src'

export type QueryStartupResult = {
  results: Array<{ history: unknown; violations: Array<string> }>
  error?: string
}
declare global {
  interface Window {
    __queryStartupOwnership?: QueryStartupResult
  }
}
async function run() {
  const results: QueryStartupResult[`results`] = []
  try {
    for (const [index, history] of startupOwnershipHistories.entries()) {
      const database = await openBrowserWASQLiteOPFSDatabase({
        databaseName: `qs-${index}.sqlite`,
      })
      try {
        let rowReads = 0
        const execute = database.execute.bind(database)
        database.execute = (sql, params) => {
          if (isStartupRowRead(sql)) rowReads++
          return execute(sql, params)
        }
        try {
          const observation = await observeStartupOwnership(
            createBrowserWASQLitePersistence({ database }),
            inProcessSeams.holdFirstRowSnapshot,
            history,
            `startup-${index}`,
            () => rowReads,
          )
          results.push({
            history,
            violations: startupOwnershipViolations(history, observation),
          })
        } catch (error) {
          if (!(error instanceof StartupOwnershipViolationError)) throw error
          results.push({ history, violations: error.violations })
        }
      } finally {
        await database.close?.()
      }
    }
    window.__queryStartupOwnership = { results }
  } catch (error) {
    window.__queryStartupOwnership = {
      results,
      error:
        error instanceof Error
          ? `${error.stack} ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`
          : String(error),
    }
  }
}
void run()
