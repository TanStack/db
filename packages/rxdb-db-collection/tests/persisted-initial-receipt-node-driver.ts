/** Isolated native processes record detached rejections outside Vitest. */
import { spawn } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import type {
  InitialReceiptHistory,
  InitialReceiptObservation,
} from '../../powersync-direct-collection/tests/initial-receipt-oracle'

export async function observeNodeRxdbPersistedInitialReceipt(
  history: InitialReceiptHistory,
  host: `controlled` | `node-sqlite`,
  injectDetachedRejection = false,
  failAfterRecord = false,
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
      reject(new Error(`RxDB persisted receipt worker timed out: ${stderr}`))
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
      if (!record) {
        reject(
          new Error(
            `RxDB persisted receipt worker failed before observation (${code}): ${stderr}\n${stdout}`,
          ),
        )
        return
      }
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
    })
    child.stdin.end(
      JSON.stringify({
        history,
        host,
        injectDetachedRejection,
        failAfterRecord,
      }),
    )
  })
}
