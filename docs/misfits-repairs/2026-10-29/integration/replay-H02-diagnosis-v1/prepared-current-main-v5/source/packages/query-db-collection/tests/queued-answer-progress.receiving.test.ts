import { readFileSync } from 'node:fs'
import { it } from 'vitest'
import {
  closeProgressReceipts,
  recordWorkerError,
} from '../../../scripts/h02-progress/receipt-transport.mjs'
import type { ProgressHistory } from './queued-answer-progress-oracle.js'

// This ordinary runner registers the production driver. It contains no
// expected answer; the supervising oracle owns every product comparison.
it(`receives a finite queued backend answer`, async () => {
  const path = process.env.H02_PROGRESS_WORKER_HISTORY
  if (!path) throw new Error(`H02_PROGRESS_WORKER_HISTORY is required`)
  let failed = false
  let failure: unknown
  try {
    const history = JSON.parse(readFileSync(path, `utf8`)) as ProgressHistory
    const { driveQueuedAnswerHistory } = await import(
      `./queued-answer-progress-driver.js`
    )
    await driveQueuedAnswerHistory(history)
  } catch (error) {
    failed = true
    failure = recordWorkerError(error)
  }
  try {
    closeProgressReceipts()
  } catch (error) {
    // A close failure is secondary when the driver already failed. Keep it
    // in stderr diagnostics without replacing that original error.
    if (!failed) {
      failed = true
      failure = error
    } else {
      try {
        console.error({ receiptCloseFailure: String(error) })
      } catch {
        // The original driver error remains primary if stderr also fails.
      }
    }
  }
  if (failed) throw failure
})
