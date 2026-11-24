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
import { D2 } from '../src/d2.js'
import { MultiSet } from '../src/multiset.js'
import { output as outputOperator } from '../src/operators/output.js'
import { hash } from '../src/hashing/hash.js'
import { distinct } from '../src/operators/distinct.js'
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
import { OracleComparisonMismatch } from './incrementalization-law-oracle.js'
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

// The visible payload for each selection in the accumulated output.
function shownRows(
  output: Weighted<[number, DistinctBucketRow]>,
): Map<number, string> {
  const counts = new Map<string, number>()
  for (const [[key, row], weight] of output) {
    const id = JSON.stringify([key, row])
    counts.set(id, (counts.get(id) ?? 0) + weight)
  }
  const shown = new Map<number, string>()
  for (const [id, count] of counts) {
    if (count === 0) continue
    const row = (JSON.parse(id) as [number, DistinctBucketRow])[1]
    shown.set(row.member, JSON.stringify(row))
  }
  return shown
}

// Slots holding each payload.
function holders(source: Map<number, DistinctBucketRow>) {
  const slots = new Map<string, Set<number>>()
  for (const [slot, row] of source) {
    const id = JSON.stringify(row)
    if (!slots.has(id)) slots.set(id, new Set())
    slots.get(id)!.add(slot)
  }
  return slots
}

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
  let previous: Array<DistinctBucketRow> = []
  let shown = new Map<number, string>()
  let held = new Map<string, Set<number>>()
  const check = (checkpoint: string) => {
    for (const message of reader.drain()) output.push(...message.getInner())
    checkDistinctRepresentatives(output, [...source.values()], checkpoint)
    // A shown payload whose every slot still holds it is still supported by
    // the input it came from, so it stays.
    const nowShown = shownRows(output)
    const nowHeld = holders(source)
    for (const [member, row] of shown) {
      const before = held.get(row) ?? new Set<number>()
      const after = nowHeld.get(row) ?? new Set<number>()
      if (
        [...before].every((slot) => after.has(slot)) &&
        nowShown.get(member) !== row
      )
        throw new OracleComparisonMismatch(
          `distinct representative moved while still supported at ${checkpoint}: ${JSON.stringify({ member, before: row, after: nowShown.get(member) })}`,
          `distinct representative stability`,
          checkpoint,
          nowShown.get(member),
          row,
        )
    }
    shown = nowShown
    held = nowHeld
  }
  for (const [checkpoint, world] of worlds.entries()) {
    const changes: Weighted<[number, DistinctBucketRow]> = []
    for (const [slot, row] of previous.entries())
      changes.push([[slot, row], -1])
    for (const [slot, row] of world.entries()) changes.push([[slot, row], 1])
    for (const [[slot, row], weight] of changes) {
      if (weight < 0) source.delete(slot)
      else source.set(slot, { ...row })
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
      statement: `The full accumulated distinct output has exactly one unit contribution for each supported selection, no negative residues, distinct simultaneous keys, and only payloads a source row still holds; a shown payload stays while the inputs that hold it do.`,
      authority: `docs/guides/live-queries.md#distinct; packages/db/src/query/live/ARCHITECTURE.md, Weighted relations and public keys; 2026-10-30 distinct provenance review.`,
      limits: `Four immutable native-collision selections plus an anchor; variants 0..3, at most eight slots and twelve random suffix worlds. Choice among live representatives and cross-build key stability remain unspecified; no external source scheduling.`,
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
  owns: [`src/operators/distinct.ts#distinct`],
  histories: { ...cell0.histories, runs: 100, fixedSeeds: [2309] },
})

const cell1 = representativeOptions(true)
oracleProperty({
  ...cell1,
  check: checkDistinctCampaign,
  id: `ivm.distinct-representatives-unit-split`,
  owns: [`src/operators/distinct.ts#distinct`],
  histories: { ...cell1.histories, runs: 100, fixedSeeds: [2309] },
})

// Small replay of differing unselected fields through the same driver and
// comparison as the generated campaign; no hand-authored expected answer.
// The recipe grammar cannot take a resolved history back, so it is one
// enumerated property.
// The shared check takes any plan, so the history type is given here rather
// than inferred from it.
oracleProperty<
  { name: string; worlds: DistinctBucketHistory },
  ReadonlyArray<string>
>({
  id: `ivm.distinct-representatives-fixed`,
  law: cell0.law,
  owns: [`src/operators/distinct.ts#distinct`],
  histories: [
    {
      name: `retracts the contribution it emitted for an equal selection`,
      worlds: [
        [],
        [
          { member: 0, variant: 0 },
          { member: 0, variant: 1 },
        ],
        [{ member: 0, variant: 1 }],
        [],
      ] satisfies DistinctBucketHistory,
    },
  ],
  label: ({ name }) => name,
  model: (): ReadonlyArray<string> => [],
  driver: ({ worlds }, observe) => {
    driveDistinctChecked(() => drive(worlds, false), observe)
  },
  check: checkDistinctCampaign,
})

// Rows whose own hashes collide share a support bucket. Retiring the shown one
// must leave the other supporting the selection, and the output must follow it.
// The collision is searched with the real digest, as distinctCollisionFamily
// does for selections.
function driveSupportCollision() {
  const [retired, live] = family as Array<[unknown, unknown]>
  const graph = new D2()
  const input = graph.newInput<[unknown, unknown]>()
  const net = new Map<unknown, number>()
  input.pipe(
    distinct(() => `one selection`),
    outputOperator((message) => {
      for (const [[, row], weight] of message.getInner())
        net.set(row, (net.get(row) ?? 0) + weight)
    }),
  )
  graph.finalize()
  // One unit row, drawn from the payloads still live.
  const check = (checkpoint: string, allowed: Array<unknown>) => {
    const rows = [...net].filter(([, weight]) => weight !== 0)
    const ok =
      allowed.length === 0
        ? rows.length === 0
        : rows.length === 1 &&
          rows[0]![1] === 1 &&
          allowed.includes(rows[0]![0])
    if (!ok)
      throw new OracleComparisonMismatch(
        `distinct support collision diverged at ${checkpoint}`,
        `distinct representative contribution`,
        checkpoint,
        rows,
        allowed,
      )
  }
  input.sendData(
    new MultiSet([
      [retired!, 1],
      [live!, 1],
    ]),
  )
  graph.run()
  check(`both rows`, [retired![1], live![1]])
  input.sendData(new MultiSet([[retired!, -1]]))
  graph.run()
  check(`colliding row retired`, [live![1]])
  input.sendData(new MultiSet([[live!, -1]]))
  graph.run()
  check(`empty`, [])
}

oracleProperty<{ name: string }, ReadonlyArray<string>>({
  id: `ivm.distinct-support-collisions`,
  law: {
    ...cell0.law,
    limits: `One verified pair of input rows with the same digest under one selection; no generated histories.`,
  },
  owns: [`src/operators/distinct.ts#distinct`],
  histories: [{ name: `a retired row whose hash collides with a live one` }],
  label: ({ name }) => name,
  model: (): ReadonlyArray<string> => [],
  driver: (_plan, observe) => {
    driveDistinctChecked(driveSupportCollision, observe)
  },
  check: checkDistinctCampaign,
})
