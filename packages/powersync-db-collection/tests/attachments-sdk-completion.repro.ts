import { fc } from '@fast-check/vitest'
import { describe, it } from 'vitest'
import {
  historyArbitrary,
  runHistory,
  sdkCompletionCorpus,
} from './attachments-lifecycle-fixture'
import { TEST_DATABASE_IMPLEMENTATION } from './test-db-implementation'

const describePowerSync = TEST_DATABASE_IMPLEMENTATION
  ? describe
  : describe.skip

// Desired contract, deliberately not test.fails: run separately until the SDK
// preserves newer deletion intent in both successful and failed upload writes.
describePowerSync(`upstream attachment completion contract`, () => {
  it.each(sdkCompletionCorpus)(`$name`, async (history) => {
    await runHistory({ ...history, bytes: [0, 7, 128, 255] })
  })

  it(`preserves deletion across all generated completion schedules`, async () => {
    await fc.assert(fc.asyncProperty(historyArbitrary(true), runHistory), {
      seed: Number(process.env.POWERSYNC_ATTACHMENT_ORACLE_SEED ?? 1616),
      numRuns: 12,
      ...(process.env.POWERSYNC_ATTACHMENT_ORACLE_PATH
        ? { path: process.env.POWERSYNC_ATTACHMENT_ORACLE_PATH }
        : {}),
    })
  }, 30000)
})
