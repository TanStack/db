/**
 * Each native process isolates its detached-error recorder from Vitest. The
 * child exercises the real adapter/SDK with a controlled asynchronous commit
 * boundary. Exit/setup failures stay distinct from a raw oracle observation.
 */
import { spawn } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import type {
  InitialReceiptHistory,
  InitialReceiptObservation,
} from '../../powersync-direct-collection/tests/initial-receipt-oracle'

export async function observeInitialReceipt(
  history: InitialReceiptHistory,
  client: `javascript` | `react` | `wrapped`,
  fault?: `cleanup-only` | `mismatch-and-cleanup`,
): Promise<InitialReceiptObservation> {
  const directory = fileURLToPath(new URL(`..`, import.meta.url))
  const worker = fileURLToPath(
    new URL(`initial-receipt-worker.ts`, import.meta.url),
  )
  return new Promise<InitialReceiptObservation>((resolve, reject) => {
    const child = spawn(process.execPath, [`--import`, `tsx`, worker], {
      cwd: directory,
      stdio: [`pipe`, `pipe`, `pipe`],
    })
    let stdout = ``
    let stderr = ``
    child.stdout.setEncoding(`utf8`).on(`data`, (data: string) => {
      stdout += data
    })
    child.stderr.setEncoding(`utf8`).on(`data`, (data: string) => {
      stderr += data
    })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`Receipt worker timed out before comparison: ${stderr}`))
    }, 10_000)
    child.on(`error`, (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on(`close`, (code) => {
      clearTimeout(timer)
      const record = stdout
        .split(`\n`)
        .find((line) => line.startsWith(`RECEIPT_OBSERVATION:`))
      if (!record) {
        reject(
          new Error(
            `Receipt worker setup/execution failed (${code}): ${stderr}\n${stdout}`,
          ),
        )
      } else {
        const observed = JSON.parse(
          record.slice(`RECEIPT_OBSERVATION:`.length),
        ) as InitialReceiptObservation
        // A completed native cut precedes any later process failure. Preserve
        // it for the shared comparison and attach the exit as secondary data.
        if (code !== 0)
          observed.cleanupErrors = [
            ...(observed.cleanupErrors ?? []),
            `Receipt worker exited after observation (${code}): ${stderr}`,
          ]
        resolve(observed)
      }
    })
    child.stdin.end(JSON.stringify({ ...history, client, fault }))
  })
}
