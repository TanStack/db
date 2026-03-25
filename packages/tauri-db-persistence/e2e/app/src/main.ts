import { createNativeTauriSQLiteTestDatabase } from './native-tauri-sql-test-db'
import { registerTauriNativeE2ESuite } from './register-tauri-e2e-suite'
import {
  getRegisteredTestCount,
  resetRegisteredTests,
  runRegisteredTests,
} from './runtime-vitest'

const statusElement = document.querySelector(`#status`) as HTMLParagraphElement
const detailsElement = document.querySelector(`#details`) as HTMLPreElement
const runtimeRunId =
  import.meta.env.VITE_TANSTACK_DB_TAURI_E2E_RUN_ID ?? Date.now().toString(36)
const reportUrl = import.meta.env.VITE_TANSTACK_DB_TAURI_E2E_REPORT_URL

function setStatus(status: string, details?: unknown): void {
  statusElement.textContent = status
  if (details !== undefined) {
    detailsElement.textContent = JSON.stringify(details, null, 2)
  }
}

async function postHarnessMessage(
  payload: Record<string, unknown>,
): Promise<void> {
  if (!reportUrl) {
    return
  }

  await fetch(reportUrl, {
    method: `POST`,
    headers: {
      'content-type': `application/json`,
    },
    body: JSON.stringify(payload),
  })
}

async function reportRunResult(result: {
  status: `passed` | `failed`
  payload: unknown
}): Promise<void> {
  await postHarnessMessage({
    kind: `result`,
    ...result,
  })
}

async function reportStatus(phase: string, details?: unknown): Promise<void> {
  await postHarnessMessage({
    kind: `status`,
    phase,
    details,
  })
}

async function run(): Promise<void> {
  setStatus(`Starting Tauri e2e runtime`)

  try {
    await reportStatus(`starting`, { runId: runtimeRunId })
    const database = await createNativeTauriSQLiteTestDatabase({
      runId: runtimeRunId,
    })
    await reportStatus(`database-loaded`)

    resetRegisteredTests()
    registerTauriNativeE2ESuite({
      suiteName: `tauri persisted collection conformance`,
      database,
      runId: runtimeRunId,
    })
    await reportStatus(`suite-registered`)

    const totalTests = getRegisteredTestCount()
    setStatus(`Running Tauri e2e suite`, {
      totalTests,
      runId: runtimeRunId,
    })
    await reportStatus(`tests-starting`, {
      totalTests,
    })

    const result = await runRegisteredTests({
      onTestStart: ({ index, name, total }) => {
        setStatus(`Running test ${String(index)}/${String(total)}`, {
          currentTest: name,
        })
      },
    })
    await reportStatus(`tests-finished`, {
      total: result.total,
      failed: result.failed,
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
      await reportRunResult({
        status: `failed`,
        payload: summary,
      })
      setStatus(`Tauri e2e failed`, summary)
      return
    }

    await reportRunResult({
      status: `passed`,
      payload: summary,
    })
    setStatus(`Tauri e2e passed`, summary)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const payload = {
      error: message,
      runId: runtimeRunId,
      step: statusElement.textContent,
    }

    try {
      await reportRunResult({
        status: `failed`,
        payload,
      })
    } catch {}

    setStatus(`Tauri e2e failed: ${message}`, payload)
  }
}

void run()
