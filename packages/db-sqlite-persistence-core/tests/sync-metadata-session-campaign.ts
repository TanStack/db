import { fc } from '@fast-check/vitest'
import {
  completedSeedReinsertReloadRegime,
  describeMismatch,
  keptMetadataDurabilityHistoriesArbitrary,
  persistedPeerFullGrammar,
  persistedPeerGrammar,
  persistedPeerOnDemandGrammar,
  seedReinsertReloadHistoryArbitrary,
} from '../../db/tests/sync-metadata-session-oracle'
import {
  oracleFixedSeed,
  oraclePropertyOptions,
  oracleRoute,
  oracleRouteOf,
  oracleRuns,
  recordOracleReplay,
} from '../../db/tests/oracle-config'
import { createOracleReach } from '../../db/tests/oracle-reach'
import { requireExecutedHistory } from './sync-metadata-campaign-result'
import type {
  SessionAction,
  SessionGrammar,
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
    productionPath: SessionGrammar,
  ) => ReturnType<typeof runSessionHistory>
}): Promise<void> {
  const productionPaths = [
    persistedPeerGrammar,
    persistedPeerFullGrammar,
    persistedPeerOnDemandGrammar,
  ]
  const states = productionPaths.flatMap((productionPath) => [
    `${productionPath.name}: inner commit`,
    `${productionPath.name}: row`,
    `${productionPath.name}: reload`,
  ])
  const completedStates = productionPaths.flatMap((productionPath) => [
    `${productionPath.name}: completed kept bare seed reload`,
    `${productionPath.name}: completed kept non-bare seed reload`,
  ])
  const reach = createOracleReach(property, states)
  const completedReach = createOracleReach(property, completedStates)
  const parameters =
    campaign === `fixed`
      ? oracleFixedSeed(527962096, { numRuns: oracleRuns(40) })
      : oraclePropertyOptions(40, property)
  oracleRoute(oracleRouteOf(parameters))
  const result = await fc.check(
    fc.asyncProperty(seedReinsertReloadHistoryArbitrary, async (history) => {
      const failures: Array<string> = []
      for (const productionPath of productionPaths) {
        reach.beginHistory()
        completedReach.beginHistory()
        const result = await runHistory(history, productionPath)
        if (!result.mismatch && result.steps !== history.length)
          throw new Error(`constructive history skipped an authored action`)
        const last = history.at(-1)!
        const innerCommit = history.findIndex(
          (action) => action.type === `commit`,
        )
        if (result.steps > innerCommit)
          reach.reach(`${productionPath.name}: inner commit`)
        if (last.type === `peer` && result.steps === history.length)
          reach.reach(`${productionPath.name}: ${last.notice}`)
        const completed = completedSeedReinsertReloadRegime(history, result)
        if (completed !== undefined)
          completedReach.reach(`${productionPath.name}: ${completed}`)
        if (result.mismatch)
          failures.push(
            `${productionPath.name}\n${describeMismatch(history, result.mismatch)}`,
          )
      }
      if (failures.length) throw new Error(failures.join(`\n\n`))
    }),
    parameters,
  )
  recordOracleReplay(property, result)
  requireExecutedHistory(property, result)
  console.info(
    `ORACLE_REACH ${JSON.stringify({ property, campaign, seed: result.seed, runs: result.numRuns, shrinks: result.numShrinks, completedBranchGuards: campaign === `fixed` ? `enforced` : `measured`, counts: Object.fromEntries([...reach.counts(), ...completedReach.counts()]) })}`,
  )
  if (result.failed)
    throw new Error(
      `${String(result.errorInstance)}\nseed=${result.seed} path=${result.counterexamplePath}`,
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
    productionPath: SessionGrammar,
  ) => ReturnType<typeof runSessionHistory>
  extraStates?: ReadonlyArray<string>
  extraReached?: (
    productionPath: SessionGrammar,
    result: Awaited<ReturnType<typeof runSessionHistory>>,
  ) => ReadonlyArray<string>
}): Promise<void> {
  const productionPaths = [
    persistedPeerGrammar,
    persistedPeerFullGrammar,
    persistedPeerOnDemandGrammar,
  ]
  const name = (
    productionPath: SessionGrammar,
    write: string,
    bare: boolean,
    metadata: boolean,
    notice: string,
  ) =>
    `${productionPath.name}: ${write}: ${bare ? `bare` : `metadata`} seed: ${metadata ? `explicit` : `implicit`}: ${notice}`
  const states = productionPaths.flatMap((productionPath) =>
    [`update`, `reinsert`, `inner-reinsert`].flatMap((write) =>
      [false, true].flatMap((bare) =>
        [false, true].flatMap((metadata) =>
          [`none`, `row`, `reload`].map((notice) =>
            name(productionPath, write, bare, metadata, notice),
          ),
        ),
      ),
    ),
  )
  const reach = createOracleReach(property, [...states, ...extraStates])
  const campaignParameters =
    campaign === `fixed`
      ? oracleFixedSeed(2220031, { numRuns: oracleRuns(8) })
      : oraclePropertyOptions(8, property)
  oracleRoute(oracleRouteOf(campaignParameters))
  const result = await fc.check(
    fc.asyncProperty(
      keptMetadataDurabilityHistoriesArbitrary,
      async (batch) => {
        const failures: Array<string> = []
        for (const productionPath of productionPaths) {
          for (const { write, bare, metadata, notice, history } of batch) {
            reach.beginHistory()
            const result = await runHistory(history, productionPath)
            if (result.mismatch)
              failures.push(
                `${productionPath.name}\n${describeMismatch(history, result.mismatch)}`,
              )
            else {
              if (result.steps !== history.length)
                throw new Error(
                  `constructive history skipped an authored action`,
                )
              reach.reach(name(productionPath, write, bare, metadata, notice))
              for (const state of extraReached(productionPath, result))
                reach.reach(state)
            }
          }
        }
        if (failures.length) throw new Error(failures.join(`\n\n`))
      },
    ),
    campaignParameters,
  )
  recordOracleReplay(property, result)
  requireExecutedHistory(property, result)
  console.info(
    `ORACLE_REACH ${JSON.stringify({ property, campaign, seed: result.seed, runs: result.numRuns, counts: Object.fromEntries(reach.counts()) })}`,
  )
  if (result.failed)
    throw new Error(
      `${String(result.errorInstance)}\nseed=${result.seed} path=${result.counterexamplePath}`,
    )
  reach.assertReached()
}
