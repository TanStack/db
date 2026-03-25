import { Capacitor } from '@capacitor/core'
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite'
import { createNativeCapacitorSQLiteTestDatabaseFactory } from './native-capacitor-sqlite-test-db'
import { registerCapacitorNativeE2ESuite } from './register-capacitor-e2e-suite'
import {
  getRegisteredTestCount,
  resetRegisteredTests,
  runRegisteredTests,
} from './runtime-vitest'

const statusElement = document.querySelector(`#status`) as HTMLParagraphElement
const detailsElement = document.querySelector(`#details`) as HTMLPreElement
const runtimeRunId =
  import.meta.env.VITE_TANSTACK_DB_CAPACITOR_E2E_RUN_ID ??
  Date.now().toString(36)
const resultsDatabaseName = `tanstack_db_capacitor_e2e_results_${runtimeRunId}`

function setStatus(status: string, details?: unknown): void {
  statusElement.textContent = status
  if (details !== undefined) {
    detailsElement.textContent = JSON.stringify(details, null, 2)
  }
}

async function persistRunResult(
  sqlite: SQLiteConnection,
  result: {
    status: `passed` | `failed`
    payload: unknown
  },
): Promise<void> {
  const resultsDatabase = await sqlite.createConnection(
    resultsDatabaseName,
    false,
    `no-encryption`,
    1,
    false,
  )

  try {
    await resultsDatabase.open()
    await resultsDatabase.execute(
      `CREATE TABLE IF NOT EXISTS test_run_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );`,
      false,
    )
    await resultsDatabase.run(`DELETE FROM test_run_results`, [], false)
    await resultsDatabase.run(
      `INSERT INTO test_run_results (status, payload_json) VALUES (?, ?)`,
      [result.status, JSON.stringify(result.payload)],
      false,
    )
  } finally {
    try {
      await resultsDatabase.close()
    } catch {}

    try {
      await sqlite.closeConnection(resultsDatabaseName, false)
    } catch {}
  }
}

async function run(): Promise<void> {
  const platform = Capacitor.getPlatform()
  const sqlite = new SQLiteConnection(CapacitorSQLite)

  setStatus(`Starting native e2e runtime on ${platform}`)

  if (platform === `web`) {
    setStatus(`Expected a native Capacitor runtime but got web`, {
      platform,
      runId: runtimeRunId,
    })
    return
  }

  try {
    resetRegisteredTests()
    registerCapacitorNativeE2ESuite({
      suiteName: `capacitor persisted collection conformance`,
      createDatabase: createNativeCapacitorSQLiteTestDatabaseFactory({
        sqlite,
        runId: runtimeRunId,
      }),
    })

    const totalTests = getRegisteredTestCount()
    setStatus(`Running native e2e suite`, {
      totalTests,
      runId: runtimeRunId,
    })

    const result = await runRegisteredTests({
      onTestStart: ({ index, name, total }) => {
        setStatus(`Running test ${String(index)}/${String(total)}`, {
          currentTest: name,
        })
      },
    })

    const failedResults = result.results.filter(
      (entry) => entry.status === `failed`,
    )
    const summary = {
      passed: result.passed,
      failed: result.failed,
      skipped: result.skipped,
      total: result.total,
      failures: failedResults.slice(0, 10),
    }

    if (result.failed > 0) {
      await persistRunResult(sqlite, {
        status: `failed`,
        payload: summary,
      })
      setStatus(`Native e2e failed`, summary)
      return
    }

    await persistRunResult(sqlite, {
      status: `passed`,
      payload: summary,
    })
    setStatus(`Native e2e passed`, summary)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    try {
      await persistRunResult(sqlite, {
        status: `failed`,
        payload: {
          error: message,
          runId: runtimeRunId,
          step: statusElement.textContent,
        },
      })
    } catch {}

    setStatus(`Native e2e failed: ${message}`, {
      step: statusElement.textContent,
      runId: runtimeRunId,
    })
  }
}

void run()
