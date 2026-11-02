/**
 * Distinct obeys incremental/full-recompute equivalence across real hash
 * collisions. Shared law, model and grammar: distinct-incrementalization-oracle.
 * The existing incrementalization checker observes weighted deltas and retained
 * rows after every logical batch, in atomic and legal unit-split deliveries.
 * Public Collection identity has its own receiving driver in db/tests/query.
 */
import { fc } from '@fast-check/vitest'
import { expect, it } from 'vitest'
import { hash } from '../src/hashing/hash.js'
import { distinct } from '../src/operators/distinct.js'
import { map } from '../src/operators/map.js'
import { createOracleReach } from '../../db/tests/oracle-reach.js'
import {
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from '../../db/tests/oracle-config.js'
import { declareOracle } from '../../db/tests/oracle-declaration.js'
import {
  assertUnaryIncrementalization,
  jsonLawValuePolicy,
  weightedTransitions,
} from './incrementalization-law-oracle.js'
import {
  DISTINCT_REACH_STATES,
  checkDistinctSnapshot,
  distinctCollisionValues,
  distinctHistory,
  distinctReachStates,
  distinctValueIdentity,
  recomputeDistinct,
} from './distinct-incrementalization-oracle.js'
import type { DistinctValue } from './distinct-incrementalization-oracle.js'
import type { Weighted } from './incrementalization-law-oracle.js'

const PROPERTY = `ivm.distinct-collisions`
const policy = {
  identity: distinctValueIdentity,
  clone: (value: DistinctValue) => ({ ...value }),
}

declareOracle({ check: [assertUnaryIncrementalization, checkDistinctSnapshot] })

for (const mode of [`selected`, `tuple`] as const) {
  const values = distinctCollisionValues((value) =>
    hash(mode === `selected` ? value : [0, value]),
  )
  for (const campaign of [`fixed`, `random`] as const)
    oracleReplayTest(it, ...(campaign === `random` ? [PROPERTY] : []))(
      `preserves distinct collisions by ${mode} (${campaign})`,
      () => {
        const reach = createOracleReach(PROPERTY, DISTINCT_REACH_STATES)
        fc.assert(
          fc.property(distinctHistory, (worlds) => {
            reach.beginHistory()
            const states: Array<Weighted<[number, DistinctValue]>> = worlds.map(
              (world) => world.map((label) => [[0, { ...values[label]! }], 1]),
            )
            const inputPolicy = jsonLawValuePolicy<[number, DistinctValue]>()
            // One cancellation pair tests net-zero support in each batch.
            const batches = weightedTransitions<[number, DistinctValue]>(
              states,
              inputPolicy,
              [0, values[2]!],
            )
            assertUnaryIncrementalization({
              name: `distinct ${mode}`,
              initial: states[0]!,
              batches,
              inputPolicy,
              outputPolicy: policy,
              build: (input) =>
                input.pipe(
                  distinct(
                    mode === `selected` ? ([, value]) => value : undefined,
                  ),
                  map(([, value]) => value),
                ),
              evaluate: (input) =>
                recomputeDistinct(
                  input.map(([[, value], weight]) => [value, weight]),
                ),
            })
            // Both successful delivery paths checked these input conditions.
            for (const state of distinctReachStates(worlds)) reach.reach(state)
          }),
          campaign === `fixed`
            ? { numRuns: oracleRuns(100), seed: 2306 }
            : oraclePropertyOptions(100, PROPERTY),
        )
        reach.assertReached()
        process.stdout.write(
          `distinct ${mode} ${campaign} reach ${JSON.stringify(Object.fromEntries(reach.counts()))}\n`,
        )
      },
    )
}

it(`rejects omitted, duplicate and wrong-member snapshots`, () => {
  const values = distinctCollisionValues(hash)
  const input: Weighted<DistinctValue> = values.map((value) => [value, 1])
  for (const bad of [
    values.slice(1),
    [...values, values[0]!],
    [values[0]!, values[0]!, values[2]!],
  ])
    expect(() => checkDistinctSnapshot(bad, input, 0)).toThrow(
      /snapshot diverged/,
    )
})
