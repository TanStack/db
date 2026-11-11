/**
 * Distinct obeys incremental/full-recompute equivalence across real digest
 * collisions. The independent model and original weighted-delta, retained-row,
 * and atomic/unit-split comparisons stay in the named shared helpers. The two
 * selector modes each keep 100 histories at seed 2306 and 100 at a fresh seed.
 * Limits: immutable two-member collision fixtures plus an anchor; no public
 * Collection key policy, ordering, or intermediate transaction publications.
 */
import { expect, it } from 'vitest'
import { hash } from '../src/hashing/hash.js'
import { distinct } from '../src/operators/distinct.js'
import { map } from '../src/operators/map.js'
import { oracleRoute } from '../../db/tests/oracle-config.js'
import { declareOracle } from '../../db/tests/oracle-declaration.js'
import { oracleProperty } from '../../db/tests/oracle-property.js'
import {
  assertUnaryIncrementalization,
  jsonLawValuePolicy,
  weightedTransitions,
} from './incrementalization-law-oracle.js'
import {
  DISTINCT_REACH_STATES,
  checkDistinctSnapshot,
  distinctCollisionValues,
  distinctReachStates,
  distinctRecipe,
  distinctValueIdentity,
  recomputeDistinct,
  resolveDistinctRecipe,
} from './distinct-incrementalization-oracle.js'
import {
  checkDistinctCampaign,
  driveDistinctChecked,
} from './distinct-property-oracle.js'
import type {
  GeneratedHistories,
  OraclePropertyOptions,
} from '../../db/tests/oracle-property.js'
import type {
  DistinctHistory,
  DistinctRecipe,
  DistinctValue,
} from './distinct-incrementalization-oracle.js'
import type { Weighted } from './incrementalization-law-oracle.js'

const policy = {
  identity: distinctValueIdentity,
  clone: (value: DistinctValue) => ({ ...value }),
}

declareOracle({
  check: [assertUnaryIncrementalization, checkDistinctSnapshot],
})

type Plan = { worlds: DistinctHistory; requiredStates: ReadonlyArray<string> }
type CellOptions = Omit<
  OraclePropertyOptions<DistinctRecipe, ReadonlyArray<string>, Plan>,
  `id` | `histories`
> & {
  histories: Omit<GeneratedHistories<DistinctRecipe>, `runs` | `fixedSeeds`>
}

function distinctOptions(mode: `selected` | `tuple`): CellOptions {
  const values = distinctCollisionValues((value) =>
    hash(mode === `selected` ? value : [0, value]),
  )
  // Every builder invocation clones the generated recipe. Its unchanged
  // support cycle enters all five states; the random suffix stays generated.
  // Resolve transfers obligations for constructed generated/shrunk recipes,
  // which this framework does not associate with constructionOf metadata.
  const constructionStates = new WeakMap<
    DistinctRecipe,
    ReadonlyArray<string>
  >()
  return {
    law: {
      statement: `Distinct emits the weighted difference of positive-support full recomputations and retains one of every unique selected combination under atomic and legal unit-split delivery.`,
      authority: `docs/guides/live-queries.md#distinct; DBSP incremental/full-recompute law in incrementalization-law-oracle.ts.`,
      limits: `Two unequal immutable {id, value} collision members and one anchor; source worlds have zero to eight slots and zero to twelve random suffix worlds. No ordering, representative policy, public Collection keys, or intermediate transaction publication.`,
    },
    histories: {
      arbitrary: distinctRecipe,
      states: [...DISTINCT_REACH_STATES],
      constructed: [
        {
          name: `collision support cycle`,
          enters: [...DISTINCT_REACH_STATES],
          build: (generated) => {
            const recipe = structuredClone(generated)
            constructionStates.set(recipe, DISTINCT_REACH_STATES)
            return recipe
          },
        },
      ],
    },
    resolve: (recipe) => ({
      worlds: resolveDistinctRecipe(recipe),
      requiredStates: constructionStates.get(recipe) ?? [],
    }),
    // Expected relation values are still recomputed by the existing checker;
    // this outer model only carries construction obligations, never outputs.
    model: (plan) => plan.requiredStates,
    driver: ({ worlds }, observe) => {
      driveDistinctChecked(() => {
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
              distinct(mode === `selected` ? ([, value]) => value : undefined),
              map(([, value]) => value),
            ),
          evaluate: (input) =>
            recomputeDistinct(
              input.map(([[, value], weight]) => [value, weight]),
            ),
        })
      }, observe)
      for (const state of distinctReachStates(worlds)) observe(`reach`, state)
    },
    check: checkDistinctCampaign,
    calibrations: [
      {
        name: `omits a constructed state`,
        law: `constructed reach`,
        corrupt: (trace, plan) => {
          const state = plan.requiredStates[0]
          return state === undefined
            ? undefined
            : trace.filter(
                (entry) =>
                  entry.checkpoint !== `reach` || entry.value !== state,
              )
        },
      },
    ],
  }
}

const cell0 = distinctOptions(`selected`)
oracleProperty({
  ...cell0,
  check: checkDistinctCampaign,
  id: `ivm.distinct-collisions`,
  owns: [`src/operators/distinct.ts#distinct`],
  histories: { ...cell0.histories, runs: 100, fixedSeeds: [2306] },
})

const cell1 = distinctOptions(`tuple`)
oracleProperty({
  ...cell1,
  check: checkDistinctCampaign,
  id: `ivm.distinct-collisions-tuple`,
  owns: [`src/operators/distinct.ts#distinct`],
  histories: { ...cell1.histories, runs: 100, fixedSeeds: [2306] },
})

it(`rejects omitted, duplicate and wrong-member snapshots`, () => {
  oracleRoute(`calibration`)
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
