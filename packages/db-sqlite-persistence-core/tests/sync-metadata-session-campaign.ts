import { fc } from '@fast-check/vitest'
import {
  completedSeedReinsertReloadRegime,
  describeMismatch,
  persistedPeerFullLane,
  persistedPeerLane,
  persistedPeerOnDemandLane,
  seedReinsertReloadHistoryArbitrary,
} from '../../db/tests/sync-metadata-session-oracle'
import {
  oraclePropertyOptions,
  oracleRuns,
  recordOracleReplay,
} from '../../db/tests/oracle-config'
import { createOracleReach } from '../../db/tests/oracle-reach'
import type {
  SessionAction,
  SessionLane,
  runSessionHistory,
} from '../../db/tests/sync-metadata-session-oracle'

/**
 * Both receiving drivers execute the same generated campaign. The shared
 * oracle owns its histories, completed-state classifier and comparison;
 * each host supplies its unchanged runHistory and observation checkpoint.
 * Registration and direct replay selection remain in each host test file.
 */
export async function runSeedReinsertReloadCampaign({
  property,
  campaign,
  runHistory,
}: {
  property: string
  campaign: `fixed` | `random`
  runHistory: (
    history: ReadonlyArray<SessionAction>,
    lane: SessionLane,
  ) => ReturnType<typeof runSessionHistory>
}): Promise<void> {
  const lanes = [
    persistedPeerLane,
    persistedPeerFullLane,
    persistedPeerOnDemandLane,
  ]
  const states = lanes.flatMap((lane) => [
    `${lane.name}: inner commit`,
    `${lane.name}: row`,
    `${lane.name}: reload`,
  ])
  const completedStates = lanes.flatMap((lane) => [
    `${lane.name}: completed kept bare seed reload`,
    `${lane.name}: completed kept non-bare seed reload`,
  ])
  const reach = createOracleReach(property, states)
  const completedReach = createOracleReach(property, completedStates)
  const result = await fc.check(
    fc.asyncProperty(seedReinsertReloadHistoryArbitrary, async (history) => {
      const failures: Array<string> = []
      for (const lane of lanes) {
        reach.beginHistory()
        completedReach.beginHistory()
        const result = await runHistory(history, lane)
        const last = history.at(-1)!
        const innerCommit = history.findIndex(
          (action) => action.type === `commit`,
        )
        if (result.steps > innerCommit)
          reach.reach(`${lane.name}: inner commit`)
        if (last.type === `peer` && result.steps === history.length)
          reach.reach(`${lane.name}: ${last.notice}`)
        const completed = completedSeedReinsertReloadRegime(history, result)
        if (completed !== undefined)
          completedReach.reach(`${lane.name}: ${completed}`)
        if (result.mismatch)
          failures.push(
            `${lane.name}\n${describeMismatch(history, result.mismatch)}`,
          )
      }
      if (failures.length) throw new Error(failures.join(`\n\n`))
    }),
    campaign === `fixed`
      ? { numRuns: oracleRuns(40), seed: 527962096 }
      : oraclePropertyOptions(40, property),
  )
  recordOracleReplay(property, result)
  console.info(
    `ORACLE_REACH ${JSON.stringify({ property, campaign, seed: result.seed, runs: result.numRuns, shrinks: result.numShrinks, completedBranchGuards: campaign === `fixed` ? `enforced` : `measured`, counts: Object.fromEntries([...reach.counts(), ...completedReach.counts()]) })}`,
  )
  if (result.failed)
    throw new Error(
      `${result.error}\nseed=${result.seed} path=${result.counterexamplePath}`,
    )
  reach.assertReached()
  // The bare-key-1 conjunction has probability 1/24: random40 would miss it
  // about 18% of the time. The fixed40 campaign enforces completed branch
  // guards; the identical random40 campaign measures them. Existing
  // inner/row/reload guards apply to both campaigns.
  if (campaign === `fixed`) completedReach.assertReached()
}
