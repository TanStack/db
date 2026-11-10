import { readFileSync } from 'node:fs'
import { it } from 'vitest'
import {
  closeProgressReceipts,
  recordWorkerError,
} from '../../../scripts/h02-progress/receipt-transport.mjs'
import type { CompletionBaselineProgram } from './queued-answer-completion-baseline-history-oracle.js'

// An ordinary process-bound recorder. Shared models and checks belong to the
// parent oracle. This file contains no hand-written expected product result.
// A failed constructor is an operational failure. Preserve it, close transport,
// and leave this single-program worker; never recover into another fixture.
it(`records a source-bound completion receiving gate`, async () => {
  let failed = false
  let failure: unknown
  try {
    const path = process.env.H02_PROGRESS_WORKER_HISTORY
    if (!path) throw new Error(`H02_PROGRESS_WORKER_HISTORY is required`)
    const mode = process.env.H02_COMPLETION_WORKER_MODE
    if (mode !== `baseline-constituent`)
      throw new Error(
        `candidate program has no approved exact implementation binding`,
      )
    const program = JSON.parse(
      readFileSync(path, `utf8`),
    ) as CompletionBaselineProgram
    const { driveCompletionBaselineProgram } =
      await import('./queued-answer-completion-driver.js')
    const seal: unknown = Reflect.get(globalThis, `__h02SealBindings`)
    if (typeof seal !== `function`)
      throw new Error(`startup binding seal is missing`)
    await seal()
    await driveCompletionBaselineProgram(program)
  } catch (error) {
    failed = true
    failure = recordWorkerError(error)
  }
  try {
    closeProgressReceipts()
  } catch (error) {
    if (!failed) {
      failed = true
      failure = error
    } else console.error({ receiptCloseFailure: String(error) })
  }
  if (failed) throw failure
})
