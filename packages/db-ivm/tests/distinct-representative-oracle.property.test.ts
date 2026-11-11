/**
 * Receiving driver for the wider distinct owner. Real D2 hashes select a
 * verified four-member collision family. Generated slot worlds are legal
 * nonnegative source relations. Atomic deliveries and unit-split deliveries
 * check the full accumulated output after each graph drain; the shared checker
 * permits representative freedom while rejecting a wrong full-row retraction.
 * Each selector call constructs a fresh equal selection. Independent model
 * copies preserve input provenance even if production mutates a source row.
 * Limits: immutable fixture selections, four colliding members plus an anchor,
 * eight slots and twelve random tail worlds; no external source scheduling.
 */
import { expect, it } from 'vitest'
import { D2 } from '../src/d2.js'
import { hash } from '../src/hashing/hash.js'
import { distinct } from '../src/operators/distinct.js'
import { declareOracle } from '../../db/tests/oracle-declaration.js'
import { oracleReplayTest } from '../../db/tests/oracle-config.js'
import { oracleProperty } from '../../db/tests/oracle-property.js'
import {
  DISTINCT_BUCKET_REACH_STATES,
  checkDistinctRepresentatives,
  distinctBucketReachStates,
  distinctBucketRecipe,
  distinctCollisionFamily,
  resolveDistinctBucketRecipe,
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
  DistinctBucketHistory,
  DistinctBucketRecipe,
  DistinctBucketRow,
} from './distinct-incrementalization-oracle.js'
import type { Weighted } from './incrementalization-law-oracle.js'

const family = distinctCollisionFamily(hash)

declareOracle({
  owns: [`src/operators/distinct.ts#distinct`],
  check: [checkDistinctRepresentatives],
  grammar: [distinctBucketRecipe],
})

function drive(worlds: DistinctBucketHistory, split: boolean) {
  const graph = new D2()
  const input = graph.newInput<[number, DistinctBucketRow]>()
  const selected = new Set<number>()
  let freshEqualSelections = false
  const reader = input
    .pipe(
      distinct(([, row]) => {
        if (selected.has(row.member)) freshEqualSelections = true
        selected.add(row.member)
        // The fixture domain is immutable arrays of plain records. Rebuilding
        // it preserves its model identity while changing every object reference.
        return structuredClone(family[row.member])
      }),
    )
    .connectReader()
  graph.finalize()
  const output: Weighted<[number, DistinctBucketRow]> = []
  const source = new Map<number, DistinctBucketRow>()
  const introduced: Array<DistinctBucketRow> = []
  let previous: Array<DistinctBucketRow> = []
  const check = (checkpoint: string) => {
    for (const message of reader.drain()) output.push(...message.getInner())
    checkDistinctRepresentatives(
      output,
      [...source.values()],
      introduced,
      checkpoint,
    )
  }
  for (const [checkpoint, world] of worlds.entries()) {
    const changes: Weighted<[number, DistinctBucketRow]> = []
    for (const [slot, row] of previous.entries())
      changes.push([[slot, row], -1])
    for (const [slot, row] of world.entries()) changes.push([[slot, row], 1])
    for (const [[slot, row], weight] of changes) {
      if (weight < 0) source.delete(slot)
      else {
        source.set(slot, { ...row })
        introduced.push({ ...row })
      }
      input.sendData([[[slot, { ...row }], weight]])
      if (split) {
        graph.run()
        check(`${checkpoint}/slot=${slot}/weight=${weight}`)
      }
    }
    graph.run()
    check(String(checkpoint))
    previous = world
  }
  return freshEqualSelections
}

const states = [...DISTINCT_BUCKET_REACH_STATES, `fresh equal selections`]
type Plan = {
  worlds: DistinctBucketHistory
  requiredStates: ReadonlyArray<string>
}
type CellOptions = Omit<
  OraclePropertyOptions<DistinctBucketRecipe, ReadonlyArray<string>, Plan>,
  `id` | `histories`
> & {
  histories: Omit<
    GeneratedHistories<DistinctBucketRecipe>,
    `runs` | `fixedSeeds`
  >
}

function representativeOptions(split: boolean): CellOptions {
  // Preserve the original permutation/copies/tail grammar. Fresh equal
  // selections is recorded only after the actual selector executes twice.
  const constructionStates = new WeakMap<
    DistinctBucketRecipe,
    ReadonlyArray<string>
  >()
  return {
    law: {
      statement: `The full accumulated distinct output has exactly one unit contribution for each supported selection, no negative residues, distinct simultaneous keys, and only historically introduced source payloads.`,
      authority: `docs/guides/live-queries.md#distinct; packages/db/src/query/live/ARCHITECTURE.md, Weighted relations and public keys; 2026-10-30 distinct provenance review.`,
      limits: `Four immutable native-collision selections plus an anchor; variants 0..3, at most eight slots and twelve random suffix worlds. Representative choice and cross-build key stability remain unspecified; no external source scheduling.`,
    },
    histories: {
      arbitrary: distinctBucketRecipe,
      states,
      constructed: [
        {
          name: `full representative support cycle`,
          enters: states,
          build: (generated) => {
            const recipe = structuredClone(generated)
            constructionStates.set(recipe, states)
            return recipe
          },
        },
      ],
    },
    resolve: (recipe) => ({
      worlds: resolveDistinctBucketRecipe(recipe),
      requiredStates: constructionStates.get(recipe) ?? [],
    }),
    model: (plan) => plan.requiredStates,
    driver: ({ worlds }, observe) => {
      const freshEqualSelections = driveDistinctChecked(
        () => drive(worlds, split),
        observe,
      )
      if (freshEqualSelections) observe(`reach`, `fresh equal selections`)
      for (const state of distinctBucketReachStates(worlds))
        observe(`reach`, state)
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

const cell0 = representativeOptions(false)
oracleProperty({
  ...cell0,
  check: checkDistinctCampaign,
  id: `ivm.distinct-representatives`,
  histories: { ...cell0.histories, runs: 100, fixedSeeds: [2309] },
})

const cell1 = representativeOptions(true)
oracleProperty({
  ...cell1,
  check: checkDistinctCampaign,
  id: `ivm.distinct-representatives-unit-split`,
  histories: { ...cell1.histories, runs: 100, fixedSeeds: [2309] },
})

// Small replay of differing unselected fields through the same driver and
// comparison as the generated campaign; no hand-authored expected answer.
oracleReplayTest(it)(
  `retracts the contribution it emitted for an equal selection`,
  () => {
    drive(
      [
        [],
        [
          { member: 0, variant: 0 },
          { member: 0, variant: 1 },
        ],
        [{ member: 0, variant: 1 }],
        [],
      ],
      false,
    )
  },
)

// Checker calibration supplies a wrong observation to the same refinement
// check. Correct selected membership alone cannot authorize invented payloads.
oracleReplayTest(it)(
  `rejects a representative absent from source inputs`,
  () => {
    const source = [{ member: 0, variant: 0 }]
    expect(() =>
      checkDistinctRepresentatives(
        [[[0, { member: 0, variant: 999 }], 1]],
        source,
        source,
        `fabricated representative`,
      ),
    ).toThrow(/distinct representative contribution diverged/)
  },
)
