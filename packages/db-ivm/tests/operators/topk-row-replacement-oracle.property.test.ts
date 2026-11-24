/**
 * # Does an ordered window follow a deep-equal row replacement?
 *
 * Law and source: with `replacesRow`, an ordered window holds the latest
 * instance of each key, at the position and in the group that instance sorts
 * to, even when the old and new versions are structurally equal. A fresh
 * wrapper of the same source and a transient pair change nothing. Authority:
 * the "Value classes" section of `docs/guides/live-queries.md`, whose reference
 * and range rules a query must keep after a deep-equal source write.
 *
 * Model: each key holds a source identity, a rank and a group. The expected
 * window sorts each group by rank, then key, and applies the limit.
 *
 * History grammar: up to four keys, a limit, plain or grouped ordering, and up
 * to eight operations: replace the source, replace it with a new rank or group
 * that hashing cannot see, deliver the addition before the retraction, send a
 * fresh wrapper of the same source, add and retract transient versions, cancel
 * a pair for an absent key that names another key's source, or replace a row
 * twice in one batch, or add and later retract two equal versions of a key.
 *
 * Production driver: a real D2 graph with `topKWithFractionalIndex` or
 * `groupedTopKWithFractionalIndex` followed by `consolidate`, as `orderBy`
 * builds it, materialized from its signed output.
 *
 * Refinement check: after every operation the materialized rows hold exactly
 * the model's keys, source identities and order within each group, and an
 * operation that changes nothing sends no output.
 *
 * Known omissions: windows with an offset.
 */
import fc from 'fast-check'
import { expect } from 'vitest'
import { D2 } from '../../src/d2.js'
import { MultiSet } from '../../src/multiset.js'
import { consolidate, output } from '../../src/operators/index.js'
import { groupedTopKWithFractionalIndex } from '../../src/operators/groupedTopKWithFractionalIndex.js'
import { topKWithFractionalIndex } from '../../src/operators/topKWithFractionalIndex.js'
import { oracleProperty } from '../../../db/tests/oracle-property.js'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../../db/tests/oracle-assertion-adapter.js'

const property = `ivm.topk-row-replacement`

const reachStates = [
  // A replacement kept its position with a new instance.
  `replaced-in-place`,
  // A replacement moved its row within the order.
  `replaced-and-moved`,
  // A replacement moved its row to another group.
  `replaced-across-groups`,
  // The addition arrived before the retraction.
  `addition-first`,
  // A fresh wrapper of the same source changed nothing.
  `fresh-wrapper-ignored`,
  // A transient version changed nothing.
  `transient-ignored`,
  // A replacement crossed a limited window's boundary.
  `crossed-window`,
  // A cancelled pair for an absent key named another key's source.
  `absent-key-ignored`,
  // One batch replaced a row twice.
  `replaced-twice`,
  // Equal versions of a key arrived with the same sign.
  `same-sign-versions`,
] as const
type ReachState = (typeof reachStates)[number]

type OperationType =
  | `replace`
  | `move`
  | `regroup`
  | `addition-first`
  | `wrapper`
  | `transient`
  | `absent`
  | `twice`
  | `support`
type Operation = { type: OperationType; key: number; rank: number }
type History = {
  keys: number
  limit: number
  grouped: boolean
  operations: Array<Operation>
}

// Its enumerable field is all hashing reads, so every instance is equal.
class Source {
  readonly kind = `source`
  #rank: number
  #group: number
  constructor(rank: number, group: number) {
    this.#rank = rank
    this.#group = group
  }
  get rank(): number {
    return this.#rank
  }
  get group(): number {
    return this.#group
  }
}
type Row = { source: Source }

const operationArbitrary: fc.Arbitrary<Operation> = fc.record({
  type: fc.constantFrom<OperationType>(
    `replace`,
    `move`,
    `regroup`,
    `addition-first`,
    `wrapper`,
    `transient`,
    `absent`,
    `twice`,
    `support`,
  ),
  key: fc.nat({ max: 3 }),
  rank: fc.nat({ max: 5 }),
})
const historyArbitrary: fc.Arbitrary<History> = fc.record({
  keys: fc.integer({ min: 1, max: 4 }),
  limit: fc.integer({ min: 1, max: 4 }),
  grouped: fc.boolean(),
  operations: fc.array(operationArbitrary, { maxLength: 8 }),
})

function modelRows(
  sources: ReadonlyMap<number, Source>,
  limit: number,
  grouped: boolean,
) {
  const byGroup = new Map<number, Array<[number, Source]>>()
  for (const entry of sources) {
    const group = grouped ? entry[1].group : 0
    byGroup.set(group, [...(byGroup.get(group) ?? []), entry])
  }
  return [...byGroup.entries()]
    .sort(([a], [b]) => a - b)
    .map(
      ([group, entries]) =>
        [
          group,
          entries
            .sort(([aKey, a], [bKey, b]) => a.rank - b.rank || aKey - bKey)
            .slice(0, limit),
        ] as const,
    )
}

function runHistory(
  history: History,
  reach: (state: ReachState) => void,
): void {
  const graph = new D2()
  const input = graph.newInput<[number, Row]>()
  const materialized = new Map<number, [Row, string]>()
  let outputs = 0
  const options = {
    limit: history.limit,
    replacesRow: (previous: Row, next: Row) => previous.source !== next.source,
  }
  const comparator = (a: Row, b: Row) => a.source.rank - b.source.rank
  input.pipe(
    history.grouped
      ? groupedTopKWithFractionalIndex<number, Row>(comparator, {
          ...options,
          groupKeyFn: (_key, row) => row.source.group,
        })
      : topKWithFractionalIndex<number, Row>(comparator, options),
    consolidate(),
    output((message) => {
      const entries = message.getInner()
      outputs += entries.length
      for (const [[key, [row]], weight] of entries) {
        if (weight < 0 && materialized.get(key)?.[0] === row) {
          materialized.delete(key)
        }
      }
      for (const [[key, indexed], weight] of entries) {
        if (weight > 0) materialized.set(key, indexed)
      }
    }),
  )
  graph.finalize()

  const sources = new Map<number, Source>()
  const rows = new Map<number, Row>()
  const seed: Array<[[number, Row], number]> = []
  for (let key = 0; key < history.keys; key++) {
    const source = new Source(key, key % 2)
    const row = { source }
    sources.set(key, source)
    rows.set(key, row)
    seed.push([[key, row], 1])
  }
  const send = (changes: Array<[[number, Row], number]>) => {
    input.sendData(new MultiSet(changes))
    graph.run()
  }
  const check = (label: string) => {
    const expected = modelRows(sources, history.limit, history.grouped)
    const actualGroups = new Map<number, Array<[number, string, Source]>>()
    for (const [key, [row, index]] of materialized) {
      const group = history.grouped ? row.source.group : 0
      actualGroups.set(group, [
        ...(actualGroups.get(group) ?? []),
        [key, index, row.source],
      ])
    }
    expect(
      [...actualGroups.keys()].sort((a, b) => a - b),
      `${label}: groups`,
    ).toEqual(expected.map(([group]) => group))
    for (const [group, entries] of expected) {
      const actual = [...actualGroups.get(group)!].sort(([, a], [, b]) =>
        a < b ? -1 : 1,
      )
      expect(
        actual.map(([key]) => key),
        `${label}: group ${group} order`,
      ).toEqual(entries.map(([key]) => key))
      for (const [position, [, source]] of entries.entries()) {
        expect(
          actual[position]![2] === source,
          `${label}: group ${group} position ${position} instance`,
        ).toBe(true)
      }
    }
  }

  const unchanged = (
    label: string,
    changes: Array<[[number, Row], number]>,
  ) => {
    const before = outputs
    send(changes)
    expect(outputs, `${label}: output`).toBe(before)
    check(label)
  }

  send(seed)
  check(`seed`)
  for (const [step, operation] of history.operations.entries()) {
    const key = operation.key % history.keys
    const current = sources.get(key)!
    const row = rows.get(key)!
    const windowBefore = new Set(materialized.keys())
    let next = current
    switch (operation.type) {
      case `replace`:
      case `addition-first`:
        next = new Source(current.rank, current.group)
        break
      case `move`:
        next = new Source(operation.rank, current.group)
        break
      case `regroup`:
        next = new Source(current.rank, 1 - current.group)
        break
      case `wrapper`:
        unchanged(`step ${step} wrapper`, [
          [[key, { source: current }], -1],
          [[key, { source: current }], 1],
        ])
        reach(`fresh-wrapper-ignored`)
        continue
      case `transient`:
        // Two versions that are neither the stored row nor each other.
        unchanged(`step ${step} transient`, [
          [[key, { source: new Source(current.rank, current.group) }], 1],
          [[key, { source: new Source(current.rank, current.group) }], -1],
        ])
        reach(`transient-ignored`)
        continue
      case `absent`:
        // Sorts to this key's position, under a key the window does not hold.
        unchanged(`step ${step} absent`, [
          [[-1, { source: current }], -1],
          [[-1, { source: new Source(current.rank, current.group) }], 1],
        ])
        reach(`absent-key-ignored`)
        continue
      case `support`: {
        const versions = () => [
          { source: new Source(current.rank, current.group) },
          { source: new Source(current.rank, current.group) },
        ]
        send(versions().map((version) => [[-1, version], 1]))
        const [first, second] = versions()
        send([
          [[-1, first!], -1],
          [[-1, second!], -1],
        ])
        reach(`same-sign-versions`)
        check(`step ${step} support`)
        continue
      }
      case `twice`: {
        const between = { source: new Source(current.rank, current.group) }
        const last = { source: new Source(current.rank, current.group) }
        send([
          [[key, row], -1],
          [[key, between], 1],
          [[key, { source: between.source }], -1],
          [[key, last], 1],
        ])
        sources.set(key, last.source)
        rows.set(key, last)
        reach(`replaced-twice`)
        check(`step ${step} twice`)
        continue
      }
    }
    const nextRow = { source: next }
    send(
      operation.type === `addition-first`
        ? [
            [[key, nextRow], 1],
            [[key, row], -1],
          ]
        : [
            [[key, row], -1],
            [[key, nextRow], 1],
          ],
    )
    sources.set(key, next)
    rows.set(key, nextRow)
    if (operation.type === `addition-first`) reach(`addition-first`)
    if (operation.type === `replace`) reach(`replaced-in-place`)
    if (operation.type === `move` && next.rank !== current.rank) {
      reach(`replaced-and-moved`)
    }
    if (operation.type === `regroup` && history.grouped) {
      reach(`replaced-across-groups`)
    }
    const windowAfter = new Set(materialized.keys())
    if (
      windowBefore.size !== windowAfter.size ||
      [...windowBefore].some((held) => !windowAfter.has(held))
    ) {
      reach(`crossed-window`)
    }
    check(`step ${step} ${operation.type}`)
  }
}

const op = (type: OperationType, key = 0, rank = 0): Operation => ({
  type,
  key,
  rank,
})

oracleProperty({
  id: property,
  law: {
    statement: `With replacesRow, an ordered window holds the latest instance of each key at the position and in the group it sorts to, through structurally equal replacements in either delta order, while a fresh wrapper of the same source and a transient pair change nothing.`,
    authority: `The "Value classes" section of docs/guides/live-queries.md.`,
    limits: `Up to four keys and eight operations, plain or grouped windows with a limit, and no offset.`,
  },
  owns: [
    `src/operators/topKState.ts#topKBatch`,
    `src/operators/topKState.ts#TopKState.holdsVersion`,
    `src/operators/topKState.ts#TopKState.replaceElement`,
    `src/operators/topKArray.ts#TopKArray.find`,
    `src/operators/topKWithFractionalIndex.ts#TopKWithFractionalIndexOperator.run`,
    `src/operators/groupedTopKWithFractionalIndex.ts#GroupedTopKWithFractionalIndexOperator.run`,
  ],
  histories: {
    arbitrary: historyArbitrary,
    runs: 60,
    fixedSeeds: [2460],
    states: reachStates,
    constructed: [
      {
        name: `replacements keep, move and cross the window`,
        enters: [`replaced-in-place`, `replaced-and-moved`, `crossed-window`],
        build: (): History => ({
          keys: 3,
          limit: 2,
          grouped: false,
          operations: [op(`replace`, 1), op(`move`, 0, 5)],
        }),
      },
      {
        name: `a replacement moves its row to another group`,
        enters: [`replaced-across-groups`],
        build: (): History => ({
          keys: 4,
          limit: 2,
          grouped: true,
          operations: [op(`regroup`, 2)],
        }),
      },
      {
        name: `the addition arrives first`,
        enters: [`addition-first`],
        build: (generated: History): History => ({
          ...generated,
          operations: [op(`addition-first`)],
        }),
      },
      {
        name: `wrappers, transients and absent keys change nothing`,
        enters: [
          `fresh-wrapper-ignored`,
          `transient-ignored`,
          `absent-key-ignored`,
        ],
        build: (generated: History): History => ({
          ...generated,
          operations: [op(`wrapper`), op(`transient`), op(`absent`)],
        }),
      },
      {
        name: `equal versions arrive with the same sign`,
        enters: [`same-sign-versions`],
        build: (generated: History): History => ({
          ...generated,
          operations: [op(`support`)],
        }),
      },
      {
        name: `one batch replaces a row twice`,
        enters: [`replaced-twice`],
        build: (generated: History): History => ({
          ...generated,
          operations: [op(`twice`)],
        }),
      },
    ],
  },
  resolve: (history: History) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan: { history: History }, observe) =>
    recordAssertionJudgment(property, plan, observe, () =>
      runHistory(plan.history, (state) => observe(`reach`, state)),
    ),
  check: forwardAssertionJudgment,
})
