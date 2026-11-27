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
import { fc } from '@fast-check/vitest'
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

// Input rows whose own digests collide share a support bucket. The family's
// four members are whole [key, row] inputs with one digest, found with the
// real hash, under one selection, and their keys collide too. Generated worlds
// add and remove them; a world may first send members with weight zero, and
// the payloads may be cyclic, outside the selection. The model is the multiset
// of live inputs. The output must hold one unit row whose payload a live input
// holds, and keep that payload while every input that held it stays live.
type CollisionWorlds = Array<Array<number>>
type CollisionPlan = {
  worlds: CollisionWorlds
  // Members sent with weight zero at the start of each world's batch.
  zeros: CollisionWorlds
  split: boolean
  cyclic: boolean
}
const COLLISION_STATES = [
  `colliding inputs live`,
  `shown input retired beside a live one`,
  `emptied`,
  // A zero-weight input opened a selection that a live input then supported.
  `zero weight opened a selection`,
  // The live payloads were cyclic.
  `cyclic payloads`,
] as const

function driveSupportCollisions(
  { worlds, zeros, split, cyclic }: CollisionPlan,
  observe: (checkpoint: string, value: unknown) => void,
) {
  const members = (family.slice(0, 4) as Array<[unknown, unknown]>).map(
    ([key, row]): [unknown, unknown] => {
      if (!cyclic) return [key, row]
      const payload: Record<string, unknown> = { row }
      payload.self = payload
      return [key, payload]
    },
  )
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
  // Observations name a payload by its member, since a payload can be cyclic.
  const member = (payload: unknown) =>
    members.findIndex(([, row]) => row === payload)
  let live: Array<number> = []
  let shown: unknown
  let held = new Map<number, number>()
  // How many of each input are live.
  const holders = (world: Array<number>) => {
    const counts = new Map<number, number>()
    for (const index of world) counts.set(index, (counts.get(index) ?? 0) + 1)
    return counts
  }
  const check = (checkpoint: string, world: Array<number>) => {
    const rows = [...net].filter(([, weight]) => weight !== 0)
    const payloads = world.map((index) => members[index]![1])
    const unit =
      world.length === 0
        ? rows.length === 0
        : rows.length === 1 &&
          rows[0]![1] === 1 &&
          payloads.includes(rows[0]![0])
    if (!unit)
      throw new OracleComparisonMismatch(
        `distinct support collision diverged at ${checkpoint}`,
        `distinct representative contribution`,
        checkpoint,
        rows.map(([row, weight]) => [member(row), weight]),
        world,
      )
    const now = holders(world)
    const current = rows[0]?.[0]
    // Every input that held the shown payload is still live, so it stays.
    const kept =
      shown !== undefined &&
      [...held].every(
        ([index, count]) =>
          members[index]![1] !== shown || (now.get(index) ?? 0) >= count,
      )
    if (kept && current !== shown)
      throw new OracleComparisonMismatch(
        `distinct support collision moved while still supported at ${checkpoint}`,
        `distinct representative stability`,
        checkpoint,
        member(current),
        member(shown),
      )
    if (shown !== undefined && current !== shown && world.length > 0)
      observe(`reach`, `shown input retired beside a live one`)
    if (new Set(world).size > 1) observe(`reach`, `colliding inputs live`)
    if (world.length === 0 && live.length > 0) observe(`reach`, `emptied`)
    shown = current
    held = now
  }
  for (const [checkpoint, world] of worlds.entries()) {
    const zero = zeros[checkpoint] ?? []
    if (live.length === 0 && zero.length > 0 && world.length > 0)
      observe(`reach`, `zero weight opened a selection`)
    if (cyclic && world.length > 0) observe(`reach`, `cyclic payloads`)
    const changes: Array<[[unknown, unknown], number]> = [
      ...zero.map(
        (index) => [members[index]!, 0] as [[unknown, unknown], number],
      ),
      ...live.map(
        (index) => [members[index]!, -1] as [[unknown, unknown], number],
      ),
      ...world.map(
        (index) => [members[index]!, 1] as [[unknown, unknown], number],
      ),
    ]
    if (split) {
      const partial = [...live]
      for (const [change, weight] of changes) {
        input.sendData(new MultiSet([[change, weight]]))
        graph.run()
        const index = members.indexOf(change)
        if (weight < 0) partial.splice(partial.indexOf(index), 1)
        else if (weight > 0) partial.push(index)
        check(`${checkpoint}/${index}/${weight}`, partial)
      }
    } else {
      input.sendData(new MultiSet(changes))
      graph.run()
      check(String(checkpoint), world)
    }
    live = world
  }
}

const collisionWorlds = fc.array(
  fc.array(fc.integer({ min: 0, max: 3 }), { maxLength: 4 }),
  { minLength: 1, maxLength: 10 },
)
const collisionConstructions = new WeakMap<
  CollisionPlan,
  ReadonlyArray<string>
>()

oracleProperty<CollisionPlan, ReadonlyArray<string>>({
  id: `ivm.distinct-support-collisions`,
  law: {
    ...cell0.law,
    statement: `${cell0.law.statement} An input of weight zero supports nothing, and a payload outside the selection may be cyclic.`,
    authority: `${cell0.law.authority} PR #2460 review: zero-weight inputs and payloads outside the selected key.`,
    limits: `The four inputs of one verified digest family under one selection; up to ten worlds of up to four inputs, each optionally preceded by up to two zero-weight inputs, with plain or self-referencing payloads, delivered at once or one change at a time.`,
  },
  owns: [`src/operators/distinct.ts#distinct`],
  histories: {
    arbitrary: fc.record({
      worlds: collisionWorlds,
      zeros: fc.array(
        fc.array(fc.integer({ min: 0, max: 3 }), { maxLength: 2 }),
        { maxLength: 10 },
      ),
      split: fc.boolean(),
      cyclic: fc.boolean(),
    }),
    runs: 100,
    fixedSeeds: [2309],
    states: COLLISION_STATES,
    constructed: [
      {
        name: `a shown input is retired beside a colliding live one`,
        enters: COLLISION_STATES,
        build: (generated) => {
          const plan: CollisionPlan = {
            worlds: [[0, 1], [1], [], [3], ...generated.worlds].slice(0, 10),
            zeros: [[], [], [], [2], ...generated.zeros.slice(4)],
            split: generated.split,
            cyclic: true,
          }
          collisionConstructions.set(plan, COLLISION_STATES)
          return plan
        },
      },
    ],
  },
  resolve: (plan) => plan,
  model: (plan) => collisionConstructions.get(plan) ?? [],
  driver: (plan, observe) => {
    driveDistinctChecked(() => driveSupportCollisions(plan, observe), observe)
  },
  check: checkDistinctCampaign,
})
