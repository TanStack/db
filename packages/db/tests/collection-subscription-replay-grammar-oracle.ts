import { fc } from '@fast-check/vitest'
import { oracleFixedSeed } from './oracle-config.js'
import type { ReplayRow } from './collection-subscription-replay-support.js'

/**
 * The replay scenario grammar of
 * collection-subscription-replay-oracle.property.test.ts: source rows,
 * logical demands, replay attempts, settlement order, release points, and
 * later source actions. That file holds the law, the reducers that compute
 * the expected publications, and the production driver. This module holds
 * only the scenario records and their arbitraries, so the grammar census in
 * collection-subscription-replay.test.ts samples the same grammar. It
 * registers no tests.
 */

export type ReplayDemandId = ReplayRow[`id`]

export type ReplayLoad = {
  demandId: ReplayDemandId
  rows: ReadonlyArray<ReplayRow>
  outcome: `resolve` | `reject`
  writeBeforeSettlement?: boolean
}

type ReplayAttempt = {
  loads: ReadonlyArray<ReplayLoad>
}

export type SourceAction =
  | { type: `put`; row: ReplayRow }
  | { type: `delete`; id: ReplayRow[`id`] }
  | { type: `request`; demandId: ReplayDemandId }

export type ReplayScenario = {
  initialRows: ReadonlyArray<ReplayRow>
  demandIds: ReadonlyArray<ReplayDemandId>
  attempts: ReadonlyArray<ReplayAttempt>
  settlementOrder: ReadonlyArray<number>
  settlementPhases: ReadonlyArray<number>
  releaseOnLastAttempt?: ReplayDemandId
  afterSettlement: ReadonlyArray<SourceAction>
}

// Values include -0, a distinct row value from 0 (maintainer decision,
// 2026-10-29), so a replay can replace a row that differs only by a zero's
// sign.
const replayValue = fc.oneof(fc.integer({ min: -2, max: 2 }), fc.constant(-0))

export const rowArbitrary: fc.Arbitrary<ReplayRow> = fc.record({
  id: fc.constantFrom(`one` as const, `two` as const),
  value: replayValue,
})

export const rowsArbitrary = fc.uniqueArray(rowArbitrary, {
  minLength: 0,
  maxLength: 2,
  selector: ({ id }) => id,
})

function replayLoadArbitrary(
  demandId: ReplayDemandId,
): fc.Arbitrary<ReplayLoad> {
  return fc.record({
    demandId: fc.constant(demandId),
    rows: fc
      .option(replayValue, { nil: undefined })
      .map((value) => (value === undefined ? [] : [{ id: demandId, value }])),
    outcome: fc.constantFrom(`resolve` as const, `reject` as const),
    writeBeforeSettlement: fc.boolean(),
  })
}

function sourceActionArbitrary(
  demandIds: ReadonlyArray<ReplayDemandId>,
): fc.Arbitrary<SourceAction> {
  return fc.oneof(
    fc
      .tuple(fc.constantFrom(...demandIds), replayValue)
      .map(([id, value]) => ({ type: `put` as const, row: { id, value } })),
    fc
      .constantFrom(...demandIds)
      .map((id) => ({ type: `delete` as const, id })),
  )
}

export const replayScenarioArbitrary: fc.Arbitrary<ReplayScenario> = fc
  .uniqueArray(fc.constantFrom<ReplayDemandId>(`one`, `two`), {
    minLength: 1,
    maxLength: 2,
  })
  .chain((demandIds) =>
    fc
      .record({
        initialRows: rowsArbitrary,
        attempts: fc.array(
          fc
            .tuple(
              ...demandIds.map((demandId) => replayLoadArbitrary(demandId)),
            )
            .map((loads) => ({ loads })),
          { minLength: 1, maxLength: 3 },
        ),
        releaseOnLastAttempt: fc.option(fc.constantFrom(...demandIds), {
          nil: undefined,
        }),
      })
      .chain(({ initialRows, attempts, releaseOnLastAttempt }) => {
        const replayCount = attempts.length * demandIds.length
        const lastAttemptIndex = attempts.length - 1
        return fc
          .record({
            settlementOrder: fc.shuffledSubarray(
              Array.from({ length: replayCount }, (_, index) => index),
              { minLength: replayCount, maxLength: replayCount },
            ),
            rawSettlementPhases: fc.array(
              fc.integer({ min: 0, max: lastAttemptIndex }),
              { minLength: replayCount, maxLength: replayCount },
            ),
            afterSettlement:
              releaseOnLastAttempt === undefined
                ? fc.array(sourceActionArbitrary(demandIds), {
                    minLength: 0,
                    maxLength: 3,
                  })
                : fc
                    .tuple(
                      fc.constant<SourceAction>({
                        type: `request`,
                        demandId: releaseOnLastAttempt,
                      }),
                      fc.array(sourceActionArbitrary(demandIds), {
                        minLength: 0,
                        maxLength: 2,
                      }),
                    )
                    .map(([request, actions]) => [request, ...actions]),
          })
          .map(({ settlementOrder, rawSettlementPhases, afterSettlement }) => ({
            initialRows,
            demandIds,
            attempts,
            settlementOrder,
            settlementPhases: rawSettlementPhases.map((phase, replayIndex) =>
              Math.max(phase, Math.floor(replayIndex / demandIds.length)),
            ),
            releaseOnLastAttempt,
            afterSettlement,
          }))
      }),
  )

/**
 * The fixed-seed sample of the grammar census in
 * collection-subscription-replay.test.ts. The census asserts that this sample
 * holds shared, failed, stale, released, and post-replay histories. Its seed
 * and run budget stay here, in a module that the oracle imports, so the run
 * budget check still tracks them.
 */
export function sampleReplayGrammarCensus(): Array<ReplayScenario> {
  return fc.sample(
    replayScenarioArbitrary,
    oracleFixedSeed(1755, { numRuns: 300 }),
  )
}
