import fc from 'fast-check'
import { describe, it } from 'vitest'
import {
  oraclePropertyOptions,
  oracleReplayRequested,
  oracleReplayTest,
  oracleRuns,
} from '../../db/tests/oracle-config.js'
import { createOracleReach } from '../../db/tests/oracle-reach.js'
import {
  checkProgressValue,
  checkQueuedAnswerProgress,
  progressExamples,
  progressHistoryArbitrary,
  progressHistoryFamily,
  queuedAnswerExample,
} from './queued-answer-progress-oracle.js'
import { receiveProgressHistory } from './queued-answer-progress-supervisor.js'
import type { ProgressHistory } from './queued-answer-progress-oracle.js'

/**
 * Fixed inputs and generated families use one model/driver/checker. Shared
 * oracle controls scale both 8-family campaigns and supply seed/path replay.
 * Root must register query.queued-answer-progress before admitting generated
 * campaigns or path replay; no reserved config/manifest is edited here.
 * The first unchanged-main recipe selects the canonical fixed test by name.
 */
describe(`queued backend answer progress`, () => {
  const property = `query.queued-answer-progress`
  const makeReach = () =>
    createOracleReach(
      property,
      [
        `conflicting-cache-premise`,
        `answer-queued`,
        `answer-executed`,
        `nonempty-retained-publication`,
        `final-publication`,
      ],
      { replaying: oracleReplayRequested() },
    )
  const run = async (history: ProgressHistory, reach = makeReach()) => {
    reach.beginHistory()
    const outcome = await receiveProgressHistory(history, (receipt) => {
      checkProgressValue(history, receipt)
      if (receipt.phase === `conflicting-cache-premise`)
        reach.reach(`conflicting-cache-premise`)
      if (receipt.phase === `answer-queued`) reach.reach(`answer-queued`)
      if (receipt.phase === `answer-executed`) reach.reach(`answer-executed`)
      if (
        receipt.phase === `retained-publication` &&
        receipt.rows &&
        receipt.rows.length > 0
      )
        reach.reach(`nonempty-retained-publication`)
      if (receipt.phase === `final-publication`)
        reach.reach(`final-publication`)
    })
    checkQueuedAnswerProgress(history, outcome)
  }
  oracleReplayTest(it)(
    `replays the finite five-root queued-answer history`,
    async () => {
      await run(queuedAnswerExample)
    },
    60_000,
  )
  oracleReplayTest(it)(
    `replays lawful neighboring controls through the shared judgment`,
    async () => {
      for (const history of progressExamples.slice(1)) await run(history)
    },
    300_000,
  )
  oracleReplayTest(it)(
    `checks the fixed generated campaign`,
    async () => {
      const reach = makeReach()
      await fc.assert(
        fc.asyncProperty(progressHistoryArbitrary, async (history) => {
          for (const member of progressHistoryFamily(history))
            await run(member, reach)
        }),
        { numRuns: oracleRuns(8), seed: 20261029 },
      )
      reach.assertReached()
      console.info(`H02 fixed reach`, Object.fromEntries(reach.counts()))
    },
    300_000,
  )
  it(`checks the unseeded generated campaign or selected replay`, async () => {
    const reach = makeReach()
    await fc.assert(
      fc.asyncProperty(progressHistoryArbitrary, async (history) => {
        for (const member of progressHistoryFamily(history))
          await run(member, reach)
      }),
      oraclePropertyOptions(8, property),
    )
    reach.assertReached()
    console.info(
      `H02 unseeded/replay reach`,
      Object.fromEntries(reach.counts()),
    )
  }, 300_000)
})
