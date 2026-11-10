import fc from 'fast-check'
import { describe, it } from 'vitest'
import { createOracleReach } from '../../db/tests/oracle-reach.js'
import {
  oraclePropertyOptions,
  oracleReplayRequested,
  oracleReplayTest,
  oracleRuns,
} from '../../db/tests/oracle-config.js'
import {
  createMetadataReceiptCheck,
  metadataFollowupArbitrary,
  metadataFollowupHistories,
  metadataHistoryStates,
  metadataReceivingHistories,
  metadataReceivingPaths,
} from './queued-answer-metadata-oracle.js'
import {
  checkQueuedAnswerProgress,
  createProgressReceiptCheck,
  queuedAnswerExample,
} from './queued-answer-progress-oracle.js'
import { receiveProgressHistory } from './queued-answer-progress-supervisor.js'
import type { MetadataHistory } from './queued-answer-metadata-oracle.js'

/**
 * Each finite history and generated campaign uses the real QueryClient
 * receiver, the same ordinary payload law, and the existing independent
 * attribution/publication judgment. The optional source update follows the
 * settled reload baseline; it is not a QueryClient-fetched marker update.
 * Each cache/key path owns reach and replay. This source registration supplies
 * no native execution or progress-repair evidence.
 */
function makeReach(history: MetadataHistory, property?: string) {
  return createOracleReach(
    property ??
      `query.queued-answer-metadata/${history.cacheIdentity}/${history.metadataKeys}`,
    metadataHistoryStates(history),
    { replaying: oracleReplayRequested() },
  )
}
async function run(history: MetadataHistory, reach = makeReach(history)) {
  reach.beginHistory()
  const metadata = createMetadataReceiptCheck(history, (state) =>
    reach.reach(state),
  )
  const rootPayload = createProgressReceiptCheck(history)
  const downstreamPayload = createProgressReceiptCheck(history)
  try {
    const outcome = await receiveProgressHistory(history, (receipt) => {
      rootPayload(receipt)
      if (receipt.phase === `downstream-change`)
        downstreamPayload({ ...receipt, phase: `public-change` })
      else if (
        [`reload-start`, `cleanup-start`, `followup-start`].includes(
          receipt.phase,
        )
      )
        downstreamPayload(receipt)
      else if (
        [`final-publication`, `followup-publication`].includes(receipt.phase)
      )
        downstreamPayload({
          ...receipt,
          rows: receipt.downstream as typeof receipt.rows,
        })
      metadata(receipt)
      if (
        receipt.phase === `conflicting-cache-premise` &&
        history.cacheIdentity === `subscription`
      )
        reach.reach(`conflicting-cache-premise`)
    })
    checkQueuedAnswerProgress(history, outcome)
  } finally {
    console.info(`H02 metadata receiving reach`, {
      cacheIdentity: history.cacheIdentity,
      keyLane: history.metadataKeys,
      quarter: history.metadataFollowupQuarter,
      counts: Object.fromEntries(reach.counts()),
    })
  }
}

describe(`queued-answer metadata receiving`, () => {
  oracleReplayTest(it).each(metadataReceivingHistories)(
    `checks metadata $cacheIdentity $metadataKeys`,
    async (history) => {
      const reach = makeReach(history)
      await run(history, reach)
      reach.assertReached()
    },
    60_000,
  )
  oracleReplayTest(it).each(metadataFollowupHistories)(
    `checks source followup $cacheIdentity $metadataKeys quarter $metadataFollowupQuarter`,
    async (history) => {
      const reach = makeReach(history)
      await run(history, reach)
      reach.assertReached()
    },
    60_000,
  )
  describe.each(metadataReceivingPaths)(
    `generated $cacheIdentity $metadataKeys`,
    (path) => {
      const property = `query.queued-answer-metadata.${path.cacheIdentity}.${path.metadataKeys}`
      const historyOf = (facts: {
        keyShift: number
        rankScale: number
        metadataFollowupQuarter: 1 | 2 | 3
      }): MetadataHistory => ({
        ...queuedAnswerExample,
        ...path,
        ...facts,
        nonemptyPrior: true,
      })
      oracleReplayTest(it)(
        `checks the fixed generated campaign`,
        async () => {
          const reach = makeReach(
            historyOf({
              keyShift: 0,
              rankScale: 10,
              metadataFollowupQuarter: 2,
            }),
            property,
          )
          await fc.assert(
            fc.asyncProperty(metadataFollowupArbitrary, async (facts) => {
              await run(historyOf(facts), reach)
            }),
            { numRuns: oracleRuns(8), seed: 20261030 },
          )
          reach.assertReached()
        },
        300_000,
      )
      oracleReplayTest(it, property)(
        `checks the unseeded generated campaign or selected replay`,
        async () => {
          const reach = makeReach(
            historyOf({
              keyShift: 0,
              rankScale: 10,
              metadataFollowupQuarter: 2,
            }),
            property,
          )
          await fc.assert(
            fc.asyncProperty(metadataFollowupArbitrary, async (facts) => {
              await run(historyOf(facts), reach)
            }),
            oraclePropertyOptions(8, property),
          )
          reach.assertReached()
        },
        300_000,
      )
    },
  )
})
