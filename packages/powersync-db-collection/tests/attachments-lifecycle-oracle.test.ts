import { fc } from '@fast-check/vitest'
import { describe, it } from 'vitest'
import {
  historyArbitrary,
  runHistory,
  supportedCorpus,
} from './attachments-lifecycle-fixture'
import { TEST_DATABASE_IMPLEMENTATION } from './test-db-implementation'

const describePowerSync = TEST_DATABASE_IMPLEMENTATION
  ? describe
  : describe.skip

describePowerSync(`attachment lifecycle intent oracle`, () => {
  it.each(supportedCorpus)(`$name`, async (history) => {
    await runHistory({ ...history, bytes: [0, 7, 128, 255] })
  })

  it.each([`fixed`, `random`] as const)(
    `preserves intent across %s command histories`,
    async (campaign) => {
      const replaySeed = process.env.POWERSYNC_ATTACHMENT_ORACLE_SEED
      await fc.assert(fc.asyncProperty(historyArbitrary(false), runHistory), {
        ...(replaySeed
          ? { seed: Number(replaySeed) }
          : campaign === `fixed`
            ? { seed: 1616 }
            : {}),
        numRuns: 12,
        ...(process.env.POWERSYNC_ATTACHMENT_ORACLE_PATH
          ? { path: process.env.POWERSYNC_ATTACHMENT_ORACLE_PATH }
          : {}),
      })
    },
    30000,
  )
})
