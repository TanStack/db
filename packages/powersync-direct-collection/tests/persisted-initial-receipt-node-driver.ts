/** Native storage hosts keep process-level detached errors outside Vitest. */
import { spawn } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import type {
  InitialReceiptHistory,
  InitialReceiptObservation,
} from './initial-receipt-oracle'

export async function observeNodePersistedInitialReceipt(
  history: InitialReceiptHistory,
  host: `controlled` | `node-sqlite`,
  teardownFault?: `close` | `after-record`,
): Promise<InitialReceiptObservation> {
  const directory = fileURLToPath(new URL(`..`, import.meta.url))
  const worker = fileURLToPath(
    new URL(`persisted-initial-receipt-worker.ts`, import.meta.url),
  )
  const tsconfig = fileURLToPath(
    new URL(`persisted-initial-receipt.tsconfig.json`, import.meta.url),
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
          `Persisted receipt worker timed out before comparison: ${stderr}`,
        ),
      )
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
      if (!record)
        reject(
          new Error(
            `Persisted receipt worker setup/execution failed (${code}): ${stderr}\n${stdout}`,
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
                  `Receipt worker exited after completed observation (${code}): ${stderr}`,
                ],
              },
        )
      }
    })
    child.stdin.end(JSON.stringify({ history, host, teardownFault }))
  })
}
