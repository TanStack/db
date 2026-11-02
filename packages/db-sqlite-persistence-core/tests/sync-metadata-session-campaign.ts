import { fc } from '@fast-check/vitest'
import {
  completedSeedReinsertReloadRegime,
  describeMismatch,
  keptMetadataDurabilityHistoriesArbitrary,
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
        if (!result.mismatch && result.steps !== history.length)
          throw new Error(`constructive history skipped an authored action`)
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
  if (result.numRuns === 0)
    throw new Error(`oracle replay executed no history: ${property}`)
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

/**
 * Every batch reaches every write/seed/metadata/notice premise on each host.
 * Drivers own their real entry point and recovery evidence; this runner shares
 * only campaign mechanics, the common comparison and successful reach checks.
 */
export async function runKeptMetadataDurabilityCampaign({
  property,
  campaign,
  runHistory,
  extraStates = [],
  extraReached = () => [],
}: {
  property: string
  campaign: `fixed` | `random`
  runHistory: (
    history: ReadonlyArray<SessionAction>,
    lane: SessionLane,
  ) => ReturnType<typeof runSessionHistory>
  extraStates?: ReadonlyArray<string>
  extraReached?: (
    lane: SessionLane,
    result: Awaited<ReturnType<typeof runSessionHistory>>,
  ) => ReadonlyArray<string>
}): Promise<void> {
  const lanes = [
    persistedPeerLane,
    persistedPeerFullLane,
    persistedPeerOnDemandLane,
  ]
  const name = (
    lane: SessionLane,
    write: string,
    bare: boolean,
    metadata: boolean,
    notice: string,
  ) =>
    `${lane.name}: ${write}: ${bare ? `bare` : `metadata`} seed: ${metadata ? `explicit` : `implicit`}: ${notice}`
  const states = lanes.flatMap((lane) =>
    [`update`, `reinsert`, `inner-reinsert`].flatMap((write) =>
      [false, true].flatMap((bare) =>
        [false, true].flatMap((metadata) =>
          [`none`, `row`, `reload`].map((notice) =>
            name(lane, write, bare, metadata, notice),
          ),
        ),
      ),
    ),
  )
  const reach = createOracleReach(property, [...states, ...extraStates])
  const result = await fc.check(
    fc.asyncProperty(
      keptMetadataDurabilityHistoriesArbitrary,
      async (batch) => {
        const failures: Array<string> = []
        for (const lane of lanes) {
          for (const { write, bare, metadata, notice, history } of batch) {
            reach.beginHistory()
            const result = await runHistory(history, lane)
            if (result.mismatch)
              failures.push(
                `${lane.name}\n${describeMismatch(history, result.mismatch)}`,
              )
            else {
              if (result.steps !== history.length)
                throw new Error(
                  `constructive history skipped an authored action`,
                )
              reach.reach(name(lane, write, bare, metadata, notice))
              for (const state of extraReached(lane, result)) reach.reach(state)
            }
          }
        }
        if (failures.length) throw new Error(failures.join(`\n\n`))
      },
    ),
    campaign === `fixed`
      ? { numRuns: oracleRuns(8), seed: 2220031 }
      : oraclePropertyOptions(8, property),
  )
  recordOracleReplay(property, result)
  if (result.numRuns === 0)
    throw new Error(`oracle replay executed no history: ${property}`)
  console.info(
    `ORACLE_REACH ${JSON.stringify({ property, campaign, seed: result.seed, runs: result.numRuns, counts: Object.fromEntries(reach.counts()) })}`,
  )
  if (result.failed)
    throw new Error(
      `${result.error}\nseed=${result.seed} path=${result.counterexamplePath}`,
    )
  reach.assertReached()
}
