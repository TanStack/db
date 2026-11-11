import fc from 'fast-check'
import { afterEach, beforeEach, describe } from 'vitest'
import { oracleProperty } from '../oracle-config.js'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../oracle-assertion-adapter.js'
import type { GeneratedHistories } from '../oracle-config.js'

export type IncludesCampaign<THistory extends ReadonlyArray<unknown>> = {
  property: string
  runs: number
  fixedSeed: number
  examples?: ReadonlyArray<THistory>
  /** The calling owner's production code, forwarded unchanged to oracleProperty. */
  owns?: ReadonlyArray<string>
  beforeCampaign?: () => void
  afterCampaign?: () => void
}

// Each existing named helper retains its independent recomputations and
// comparisons at their original public checkpoints. This wrapper only adapts
// registration; the helper remains the semantic model and refinement check.
export function registerIncludesProperty<THistory extends Array<unknown>>(
  arbitraries: { [K in keyof THistory]: fc.Arbitrary<THistory[K]> },
  campaign: IncludesCampaign<THistory>,
  statement: string,
  judge: (...history: THistory) => unknown,
  timeout?: number,
): void {
  let campaignFailed = false
  const generated: GeneratedHistories<THistory> = {
    arbitrary: fc.tuple<THistory>(...arbitraries),
    runs: campaign.runs,
    fixedSeeds: [campaign.fixedSeed],
  }
  // Earlier campaigns supplied examples outside their bounded arbitrary.
  // Retain those exact inputs as finite replays of the same helper. The
  // generated source and its full run budget remain unchanged.
  const sources: Array<GeneratedHistories<THistory> | ReadonlyArray<THistory>> =
    [generated]
  if (campaign.examples?.length) sources.push(campaign.examples)
  describe(statement, () => {
    const isGeneratedCampaign = (name: string) =>
      name === `random seed` || name.startsWith(`fixed seed `)
    beforeEach(({ task }) => {
      if (!isGeneratedCampaign(task.name)) return
      campaignFailed = false
      campaign.beforeCampaign?.()
    })
    afterEach(({ task }) => {
      if (isGeneratedCampaign(task.name) && !campaignFailed)
        campaign.afterCampaign?.()
    })
    for (const histories of sources)
      oracleProperty({
        id: campaign.property,
        law: {
          statement,
          authority: `The existing independent includes judgments and the live-query materialization architecture cited by the calling owner.`,
          limits: `The calling owner's unchanged histories, production paths, comparison checkpoints, and stated limits. This registration migration adds no semantic coverage.`,
        },
        owns: campaign.owns,
        histories,
        label: (history) =>
          `retained history ${campaign.examples!.indexOf(history) + 1}`,
        resolve: (history) => ({ history }),
        model: recordedAssertionJudgment,
        driver: async (plan, observe) => {
          try {
            await recordAssertionJudgment(
              statement,
              plan,
              observe,
              async () => {
                await judge(...plan.history)
              },
            )
          } catch (error) {
            campaignFailed = true
            throw error
          }
        },
        check: (plan, trace, judgment) => {
          if (judgment.kind === `violation`) campaignFailed = true
          return forwardAssertionJudgment(plan, trace, judgment)
        },
        timeout,
      })
  })
}
