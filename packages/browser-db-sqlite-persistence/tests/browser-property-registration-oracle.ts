import fc from 'fast-check'
import { afterEach, beforeEach, describe } from 'vitest'
import { oracleProperty } from '../../db/tests/oracle-config'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import type { GeneratedHistories } from '../../db/tests/oracle-config'

type BrowserCampaign<THistory> = {
  id: string
  runs: number
  fixedSeed: number
  examples?: ReadonlyArray<THistory>
  beforeCampaign?: () => void
  afterCampaign?: () => void
  failedCampaign?: () => void
}

// The caller's complete existing helper retains its independent model and
// comparisons at the original checkpoints. This is registration transport;
// it adds no product law or coverage claim.
export function registerBrowserProperty<THistory>(
  arbitrary: fc.Arbitrary<THistory>,
  campaign: BrowserCampaign<THistory>,
  statement: string,
  judge: (history: THistory) => void | Promise<void>,
  timeout?: number,
): void {
  const sources: Array<GeneratedHistories<THistory> | ReadonlyArray<THistory>> =
    [
      {
        arbitrary,
        runs: campaign.runs,
        fixedSeeds: [campaign.fixedSeed],
      },
    ]
  // Historical examples need not belong to the bounded random arbitrary.
  // Retain them as finite replays through the same independent helper.
  if (campaign.examples?.length) sources.push(campaign.examples)
  describe(statement, () => {
    let failed = false
    beforeEach(() => {
      failed = false
      campaign.beforeCampaign?.()
    })
    afterEach(({ task }) => {
      if (task.name !== `random seed` && !task.name.startsWith(`fixed seed `))
        return
      if (failed) campaign.failedCampaign?.()
      else campaign.afterCampaign?.()
    })
    for (const histories of sources)
      oracleProperty({
        id: campaign.id,
        law: {
          statement,
          authority: `The calling owner's existing RFC #1659 and persistence contract citations.`,
          limits: `The calling owner's unchanged histories, paths, checkpoints and stated limits; this registration migration adds no coverage.`,
          owner: `SQLite persistence and native hosts`,
        },
        histories,
        label: (history) =>
          `retained history ${campaign.examples!.indexOf(history) + 1}`,
        resolve: (history) => ({ history }),
        model: recordedAssertionJudgment,
        driver: async (plan, observe) => {
          try {
            await recordAssertionJudgment(statement, observe, () =>
              judge(plan.history),
            )
          } catch (error) {
            // A documented known-limit rejection remains a fast-check
            // discard. It does not make a successfully completed campaign
            // skip its original aggregate reach requirement.
            if (!(error instanceof fc.PreconditionFailure)) failed = true
            throw error
          }
        },
        check: (plan, trace, judgment) => {
          if (judgment.kind === `violation`) failed = true
          return forwardAssertionJudgment(plan, trace, judgment)
        },
        timeout,
      })
  })
}

// Preserve the former package-specific replay spellings. Validation stays in
// their existing readers. Conflicting canonical coordinates cannot silently
// select another campaign.
export function browserReplayAlias(
  replay: { property: string; seed: number; path: string } | undefined,
): void {
  if (!replay) return
  for (const [key, value] of [
    [`TANSTACK_DB_ORACLE_PROPERTY`, replay.property],
    [`TANSTACK_DB_ORACLE_SEED`, String(replay.seed)],
    [`TANSTACK_DB_ORACLE_PATH`, replay.path],
  ]) {
    const existing = process.env[key!]
    if (existing !== undefined && existing !== value)
      throw new Error(
        `Conflicting legacy and canonical oracle replay coordinate: ${key}`,
      )
    process.env[key!] = value
  }
}
