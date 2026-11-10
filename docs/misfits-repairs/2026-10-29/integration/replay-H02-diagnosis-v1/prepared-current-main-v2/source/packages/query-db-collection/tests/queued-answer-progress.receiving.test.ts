import { readFileSync, writeSync } from 'node:fs'
import { it } from 'vitest'
import type { ProgressHistory } from './queued-answer-progress-oracle.js'

// This ordinary runner registers the production driver. It contains no
// expected answer; the supervising oracle owns every product comparison.
it(`receives a finite queued backend answer`, async () => {
  const path = process.env.H02_PROGRESS_WORKER_HISTORY
  if (!path) throw new Error(`H02_PROGRESS_WORKER_HISTORY is required`)
  try {
    const history = JSON.parse(readFileSync(path, `utf8`)) as ProgressHistory
    const { driveQueuedAnswerHistory } = await import(
      `./queued-answer-progress-driver.js`
    )
    await driveQueuedAnswerHistory(history)
  } catch (error) {
    writeSync(
      1,
      JSON.stringify({
        h02: true,
        phase: `worker-error`,
        message: String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }) + `\n`,
    )
    throw error
  }
})
