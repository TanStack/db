/** A child process preserves actual Node detached errors without Vitest hooks. */
import { spawn } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import type {
  InitialReceiptHistory,
  InitialReceiptObservation,
} from '../../powersync-direct-db-collection/tests/initial-receipt-oracle'

export function observeRxdbInitialReceiptNode(
  history: InitialReceiptHistory,
  teardownFault: boolean | `detached` = false,
): Promise<InitialReceiptObservation> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        `--import`,
        `tsx`,
        fileURLToPath(new URL(`initial-receipt-worker.ts`, import.meta.url)),
      ],
      {
        cwd: fileURLToPath(new URL(`..`, import.meta.url)),
        stdio: [`pipe`, `pipe`, `pipe`],
      },
    )
    let stdout = ``
    let stderr = ``
    child.stdout.setEncoding(`utf8`).on(`data`, (value: string) => {
      stdout += value
    })
    child.stderr.setEncoding(`utf8`).on(`data`, (value: string) => {
      stderr += value
    })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`RxDB receipt worker timeout: ${stderr}`))
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
      if (code !== 0 || !record)
        reject(
          new Error(
            `RxDB receipt setup/execution failed (${code}): ${stderr}\n${stdout}`,
          ),
        )
      else
        resolve(
          JSON.parse(
            record.slice(`RECEIPT_OBSERVATION:`.length),
          ) as InitialReceiptObservation,
        )
    })
    child.stdin.end(JSON.stringify({ history, teardownFault }))
  })
}
