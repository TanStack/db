/**
 * Child processes keep Node detached-rejection events outside Vitest. A worker
 * setup failure stays distinct from a completed public cleanup observation.
 */
import { spawn } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import type {
  InitialReceiptHistory,
  InitialReceiptObservation,
} from '../../powersync-direct-collection/tests/initial-receipt-oracle'

export async function observeNodePowerSyncInitialReceipt(
  history: InitialReceiptHistory,
  host: `controlled` | `node-sqlite`,
  teardownFault?: `cleanup-only` | `mismatch-and-cleanup`,
): Promise<InitialReceiptObservation> {
  const directory = fileURLToPath(new URL(`..`, import.meta.url))
  const worker = fileURLToPath(
    new URL(`initial-receipt-worker.ts`, import.meta.url),
  )
  const tsconfig = fileURLToPath(
    new URL(`initial-receipt.tsconfig.json`, import.meta.url),
  )
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`--import`, `tsx`, worker], {
      cwd: directory,
      env: { ...process.env, TSX_TSCONFIG_PATH: tsconfig },
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
      reject(
        new Error(
          `Native PowerSync receipt worker timed out before comparison: ${stderr}`,
        ),
      )
    }, 15_000)
    child.on(`error`, (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on(`close`, (code) => {
      clearTimeout(timer)
      const record = stdout
        .split(`\n`)
        .find((line) => line.startsWith(`RECEIPT_OBSERVATION:`))
      if (!record)
        reject(
          new Error(
            `Native PowerSync receipt worker setup/execution failed (${code}): ${stderr}\n${stdout}`,
          ),
        )
      else {
        const observation = JSON.parse(
          record.slice(`RECEIPT_OBSERVATION:`.length),
        ) as InitialReceiptObservation
        resolve(
          code === 0
            ? observation
            : {
                ...observation,
                cleanupErrors: [
                  ...(observation.cleanupErrors ?? []),
                  `Receipt worker exited after observation (${code}): ${stderr}`,
                ],
              },
        )
      }
    })
    child.stdin.end(JSON.stringify({ history, host, teardownFault }))
  })
}
