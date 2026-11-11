/**
 * Same-key batches consolidate equal row values, retract old versions before
 * adding replacements, and retain the correct row in an ordered graph. The
 * authored value relations below state equivalence independently of hashing.
 * They include signed-zero replacements and reference-valued leaves.
 *
 * Every history executes every original relation/path cell. The old fixed
 * campaign used the same (n, retractFirst) seed in every cell; 25 histories here
 * therefore still supply 25 generated inputs to each cell, beside the added
 * random campaign. The four other original seeds retain separate properties.
 *
 * Plans hold rich input values and their source references. Observations use
 * source labels, signed weights, counts, and getter reads, so serialization
 * cannot replace an identity comparison with deep equality. The claim remains
 * at direct topKBatch return and the original graph-drain checkpoints.
 */
import { vi } from 'vitest'
import fc from 'fast-check'
import { Temporal } from 'temporal-polyfill'
import { MultiSet } from '../../src/multiset.js'
import * as hashing from '../../src/hashing/index.js'
import { registerOpaqueHash } from '../../src/hashing/hash.js'
import { topKBatch } from '../../src/operators/topKState.js'
import { D2 } from '../../src/d2.js'
import { topKWithFractionalIndex } from '../../src/operators/topKWithFractionalIndex.js'
import { output } from '../../src/operators/index.js'
import { declareOracle } from '../../../db/tests/oracle-declaration'
import {
  differs,
  oracleProperty,
  pass,
  violation,
} from '../../../db/tests/oracle-property.js'
import type {
  ConstructedHistory,
  Observation,
  Verdict,
} from '../../../db/tests/oracle-property.js'

// Keep the existing ownership entry and its package-local reference tree.
declareOracle({ owns: [`src/operators/topKState.ts#topKBatch`] })

// Each constructor states a relation independently of hashing. Cross that
// relation with natural/forced collisions and fresh enclosing row allocations.
const valueRelations: Array<{
  name: string
  pair: (value: number) => [unknown, unknown, boolean]
}> = [
  {
    name: `plain key order`,
    pair: (n) => [{ a: n, b: 1 }, { b: 1, a: n }, true],
  },
  {
    name: `different plain values`,
    pair: (n) => [{ a: n }, { a: n + 1 }, false],
  },
  // -0 and 0 are distinct row values, so a version that changes only a
  // zero's sign replaces the old one (maintainer decision 2026-11-02).
  { name: `signed zero`, pair: () => [-0, 0, false] },
  { name: `nested signed zero`, pair: () => [{ a: -0 }, { a: 0 }, false] },
  { name: `NaN`, pair: () => [NaN, Number.NaN, true] },
  { name: `typed scalars`, pair: (n) => [n, String(n), false] },
  { name: `dates`, pair: (n) => [new Date(n), new Date(n), true] },
  {
    name: `different dates`,
    pair: (n) => [new Date(n), new Date(n + 1), false],
  },
  {
    name: `temporal`,
    pair: (n) => [
      Temporal.Instant.fromEpochMilliseconds(n),
      Temporal.Instant.fromEpochMilliseconds(n),
      true,
    ],
  },
  {
    name: `different temporal types`,
    pair: () => [Temporal.PlainDate.from(`2026-01-01`), `2026-01-01`, false],
  },
  {
    name: `small binary`,
    pair: (n) => [Buffer.from([n]), new Uint8Array([n]), true],
  },
  {
    name: `different small binary`,
    pair: (n) => [new Uint8Array([n]), new Uint8Array([n + 1]), false],
  },
  {
    name: `large binary handles`,
    pair: () => [new Uint8Array(129), new Uint8Array(129), false],
  },
  {
    name: `map values`,
    pair: (n) => [new Map([[`x`, { n }]]), new Map([[`x`, { n }]]), true],
  },
  {
    name: `map order`,
    pair: (n) => [
      new Map([
        [`x`, n],
        [`y`, n],
      ]),
      new Map([
        [`y`, n],
        [`x`, n],
      ]),
      false,
    ],
  },
  {
    name: `set values`,
    pair: (n) => [new Set([{ n }]), new Set([{ n }]), true],
  },
  {
    name: `set order`,
    pair: (n) => [new Set([n, n + 1]), new Set([n + 1, n]), false],
  },
  { name: `array versus object`, pair: (n) => [[n], { 0: n }, false] },
  { name: `sparse array length`, pair: (n) => [[], Array(n + 1), false] },
  { name: `equal sparse arrays`, pair: (n) => [Array(n), Array(n), true] },
  { name: `hole versus undefined`, pair: () => [Array(1), [undefined], false] },
  {
    name: `regexp source`,
    pair: (n) => [
      new RegExp(`old${n}`, `g`),
      new RegExp(`new${n}`, `g`),
      false,
    ],
  },
  { name: `regexp flags`, pair: () => [/same/g, /same/i, false] },
  {
    name: `regexp position`,
    pair: (n) => {
      const left = /same/g
      const right = /same/g
      right.lastIndex = n + 1
      return [left, right, false]
    },
  },
  {
    // Headers compare with ===, as in D2 value identity. Core's row equality
    // ignores a RegExp's lastIndex, so a version that changes only it never
    // reaches top-K.
    name: `regexp position signed zero`,
    pair: () => {
      const left = /same/g
      const right = /same/g
      left.lastIndex = -0
      right.lastIndex = 0
      return [left, right, true]
    },
  },
  {
    name: `regexp position NaN`,
    pair: () => {
      const left = /same/g
      const right = /same/g
      left.lastIndex = right.lastIndex = NaN
      return [left, right, false]
    },
  },
  {
    name: `equal regexp state`,
    pair: (n) => {
      const left = /same/g
      const right = /same/g
      left.lastIndex = right.lastIndex = n
      return [left, right, true]
    },
  },
  {
    name: `shared symbol property`,
    pair: (n) => {
      const key = Symbol(`key`)
      return [{ [key]: n }, { [key]: n }, true]
    },
  },
  {
    name: `distinct symbol properties`,
    pair: (n) => [{ [Symbol(`key`)]: n }, { [Symbol(`key`)]: n }, false],
  },
  { name: `distinct functions`, pair: (n) => [() => n, () => n, false] },
  ...[true, false].map((equivalent) => ({
    name: `cyclic values (equivalent ${equivalent})`,
    pair: (n: number): [unknown, unknown, boolean] => {
      const left: { self?: unknown; value: number } = { value: n }
      const right: { self?: unknown; value: number } = {
        value: equivalent ? n : n + 1,
      }
      left.self = left
      right.self = right
      return [left, right, equivalent]
    },
  })),
  {
    name: `opaque handles`,
    pair: (n) => {
      const a = { n }
      const b = { n }
      registerOpaqueHash(a)
      registerOpaqueHash(b)
      return [a, b, false]
    },
  },
  {
    name: `same opaque handle`,
    pair: (n) => {
      const handle = { n }
      registerOpaqueHash(handle)
      return [handle, handle, true]
    },
  },
]

type Observe = (checkpoint: string, value: unknown) => void
type ExpectedObservation = { checkpoint: string; value: unknown }
type ExpectedTrace = {
  observations: ReadonlyArray<ExpectedObservation>
  requiredStates: ReadonlyArray<string>
}

// e1fb504 associates only seeded constructions with their builders. Remember
// every build, including generated and shrunk results, without changing the
// history language. Each primitive registry has one builder, so equal numeric
// histories never carry conflicting obligations. The model records declarations;
// the production driver independently records whether each state was entered.
function requireConstructionReach<History>(
  builders: ReadonlyArray<ConstructedHistory<History>>,
) {
  const required = new Map<History, ReadonlyArray<string>>()
  return {
    constructed: builders.map((builder) => ({
      ...builder,
      build: (history: History) => {
        const built = builder.build(history)
        required.set(built, builder.enters)
        return built
      },
    })),
    calibration: {
      name: `omits constructed-state observations`,
      law: `constructed reach`,
      corrupt: (trace: ReadonlyArray<Observation>, history: History) =>
        required.has(history)
          ? trace.filter(({ checkpoint }) => checkpoint !== `reach`)
          : undefined,
    },
    model: (
      history: History,
      observations: ReadonlyArray<ExpectedObservation>,
    ): ExpectedTrace => ({
      observations,
      requiredStates: required.get(history) ?? [],
    }),
  }
}
type RowLabel = `before` | `after` | `transient` | `other`
type Payload = { value: unknown }
type InputRow = [number, Payload]
type MatrixHistory = { n: number; retractFirst: boolean }
type Cell = {
  name: string
  equivalent: boolean
  largeGroup: boolean
  collision: boolean
  before: InputRow
  after: InputRow
  transient: InputRow
}
type MatrixPlan = {
  sourceHistory: MatrixHistory
  retractFirst: boolean
  cells: Array<Cell>
}

const authority = `topKBatch's existing cancellation/replacement contract and oracle-coverage.md, Ordered relations and BTree; signed-zero decision 2026-11-02.`
const limits = `The original authored relation families, controlled forced-hash collisions, direct batch return and finite graph drains. No provider scheduling or new value-identity policy.`

// Compare observations in order and require every promised checkpoint. Reach
// markers carry no product answer. Extra or missing observations fail the check.
// Each matrix/path checkpoint has a distinct name. If production throws before
// that checkpoint, its missing result cannot name an earlier recorded result.
// Product exceptions propagate, so a crash cannot masquerade as a law verdict.
function checkTrace(
  trace: ReadonlyArray<Observation>,
  expected: ExpectedTrace,
  law: string,
): Verdict {
  let at = 0
  for (const actual of trace) {
    if (actual.checkpoint === `reach`) continue
    const owed = expected.observations[at++]
    if (owed === undefined)
      return violation(
        actual.checkpoint,
        `an unpromised result was observed`,
        law,
      )
    const mismatch = differs(actual.checkpoint, law, actual, owed)
    if (mismatch) return mismatch
  }
  if (at !== expected.observations.length)
    return violation(
      expected.observations[at]!.checkpoint,
      `the result was not observed`,
      law,
    )
  // Preserve a recorded product-law mismatch before judging reach metadata.
  // A generated construction owes the same declared entries as its seed.
  const reached = new Set(
    trace
      .filter(({ checkpoint }) => checkpoint === `reach`)
      .map(({ value }) => value),
  )
  for (const state of expected.requiredStates)
    if (!reached.has(state))
      return violation(
        `completed`,
        `the constructed history did not enter ${state}`,
        `constructed reach`,
      )
  return pass
}

// Realization uses the authored constructor's equivalence bit, never a
// production equality function. Registering an opaque handle prepares the
// production input; it does not decide the expected contribution.
function matrixPlan(history: MatrixHistory): MatrixPlan {
  return {
    sourceHistory: history,
    retractFirst: history.retractFirst,
    cells: valueRelations.flatMap(({ name, pair }) =>
      [
        [false, false],
        [true, false],
        [true, true],
      ].map(([largeGroup, collision]) => {
        const [left, right, equivalent] = pair(history.n)
        return {
          name: `${name}/large=${largeGroup}/collision=${collision}`,
          equivalent,
          largeGroup: largeGroup!,
          collision: collision!,
          before: [1, { value: left }],
          after: [1, { value: right }],
          transient: [1, { value: Symbol() }],
        }
      }),
    ),
  }
}

function expectedMatrix(plan: MatrixPlan): Array<ExpectedObservation> {
  return plan.cells.flatMap((cell) => [
    {
      checkpoint: `${cell.name}: batch`,
      value: {
        cell: cell.name,
        entries: cell.equivalent
          ? []
          : [
              { row: `before`, weight: -1 },
              { row: `after`, weight: 1 },
            ],
      },
    },
    {
      checkpoint: `${cell.name}: retained rows`,
      value: {
        cell: cell.name,
        rows: [{ row: cell.equivalent ? `before` : `after`, weight: 1 }],
      },
    },
    ...(cell.collision
      ? [
          {
            checkpoint: `${cell.name}: hash calls`,
            value: { cell: cell.name, calls: 0 },
          },
        ]
      : []),
  ])
}

function inputLabel(value: unknown, cell: Cell): RowLabel {
  if (value === cell.before) return `before`
  if (value === cell.after) return `after`
  if (value === cell.transient) return `transient`
  return `other`
}

function payloadLabel(value: unknown, before: object, after: object): RowLabel {
  return value === before ? `before` : value === after ? `after` : `other`
}

function driveMatrix(
  plan: MatrixPlan,
  observe: Observe,
  omitRetraction = false,
) {
  for (const cell of plan.cells) {
    const spy = cell.collision
      ? vi.spyOn(hashing, `hash`).mockReturnValue(7)
      : undefined
    try {
      const messages = [
        new MultiSet([[cell.after, 1]]),
        ...(cell.largeGroup
          ? [
              new MultiSet([
                [cell.transient, 1],
                [cell.transient, -1],
              ]),
            ]
          : []),
        new MultiSet([[cell.before, -1]]),
      ]
      if (plan.retractFirst) messages.reverse()
      const entries = [...topKBatch(messages)].map(([row, weight]) => ({
        row: inputLabel(row, cell),
        weight,
      }))
      observe(`${cell.name}: batch`, {
        cell: cell.name,
        entries:
          omitRetraction && !cell.equivalent
            ? entries.filter(({ weight }) => weight >= 0)
            : entries,
      })

      // Preserve the original raw signed output accumulation and source-row
      // identity check after the graph drains. Zero weights alone disappear.
      const graph = new D2()
      const input = graph.newInput<InputRow>()
      const retained = new Map<Payload, number>()
      input.pipe(
        topKWithFractionalIndex(() => 0, { limit: 1 }),
        output((message) => {
          for (const [[, [row]], weight] of message.getInner())
            retained.set(row, (retained.get(row) ?? 0) + weight)
        }),
      )
      graph.finalize()
      input.sendData(new MultiSet([[cell.before, 1]]))
      graph.run()
      for (const message of messages) input.sendData(message)
      graph.run()
      observe(`${cell.name}: retained rows`, {
        cell: cell.name,
        rows: [...retained]
          .filter(([, weight]) => weight !== 0)
          .map(([row, weight]) => ({
            row: payloadLabel(row, cell.before[1], cell.after[1]),
            weight,
          })),
      })
      if (spy)
        observe(`${cell.name}: hash calls`, {
          cell: cell.name,
          calls: spy.mock.calls.length,
        })
      observe(`reach`, plan.retractFirst ? `retract first` : `add first`)
      observe(
        `reach`,
        cell.equivalent ? `equal versions` : `replacement versions`,
      )
      observe(
        `reach`,
        cell.largeGroup ? `transient cancellation` : `ordinary batch`,
      )
      if (cell.collision) observe(`reach`, `forced collision`)
    } finally {
      spy?.mockRestore()
    }
  }
}

const matrixConstructions = requireConstructionReach<MatrixHistory>([
  {
    name: `retractions arrive first`,
    enters: [
      `retract first`,
      `equal versions`,
      `replacement versions`,
      `transient cancellation`,
      `ordinary batch`,
      `forced collision`,
    ],
    build: (history) => ({ ...history, retractFirst: true }),
  },
  {
    name: `additions arrive first`,
    enters: [`add first`],
    build: (history) => ({ ...history, retractFirst: false }),
  },
])
oracleProperty({
  id: `ivm.topk-batch-relations`,
  law: {
    statement: `Equal versions cancel; unequal versions retract before insertion; the ordered graph retains the exact owed source row with unit weight, and forced collisions use no hash call.`,
    authority,
    limits,
  },
  histories: {
    arbitrary: fc.record({
      n: fc.integer({ min: 0, max: 254 }),
      retractFirst: fc.boolean(),
    }),
    runs: 25,
    fixedSeeds: [409033],
    states: [
      `retract first`,
      `add first`,
      `equal versions`,
      `replacement versions`,
      `transient cancellation`,
      `ordinary batch`,
      `forced collision`,
    ],
    constructed: matrixConstructions.constructed,
  },
  resolve: matrixPlan,
  model: (plan) =>
    matrixConstructions.model(plan.sourceHistory, expectedMatrix(plan)),
  driver: driveMatrix,
  check: (_plan, trace, expected) =>
    checkTrace(trace, expected, `same-key contributions`),
  calibrations: [
    {
      ...matrixConstructions.calibration,
      corrupt: (trace, plan) =>
        matrixConstructions.calibration.corrupt(trace, plan.sourceHistory),
    },
    {
      name: `drops replacement retractions`,
      law: `same-key contributions`,
      driver: (plan, observe) => driveMatrix(plan, observe, true),
    },
  ],
})

const ordinaryRowHistory = fc.record({
  rank: fc.integer(),
  retractFirst: fc.boolean(),
})
const ordinaryConstructions = requireConstructionReach<{
  rank: number
  retractFirst: boolean
}>([
  {
    name: `retractions first`,
    enters: [`File present`, `File absent`, `retract first`],
    build: (history) => ({ ...history, retractFirst: true }),
  },
  {
    name: `additions first`,
    enters: [`add first`],
    build: (history) => ({ ...history, retractFirst: false }),
  },
])
oracleProperty({
  id: `ivm.topk-batch-file-independent`,
  law: {
    statement: `An ordinary row replacement retains the exact new row with unit weight with File present or absent.`,
    authority,
    limits,
  },
  histories: {
    arbitrary: ordinaryRowHistory,
    runs: 25,
    fixedSeeds: [409039],
    states: [`File present`, `File absent`, `retract first`, `add first`],
    constructed: ordinaryConstructions.constructed,
  },
  model: (history) =>
    ordinaryConstructions.model(
      history,
      [true, false].map((available) => ({
        checkpoint: `File available=${available}: retained rows`,
        value: { available, rows: [{ row: `after`, weight: 1 }] },
      })),
    ),
  driver: ({ rank, retractFirst }, observe) => {
    for (const available of [true, false]) {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, `File`)
      if (!available) Reflect.deleteProperty(globalThis, `File`)
      try {
        const graph = new D2()
        const input = graph.newInput<[number, { rank: number }]>()
        const retained = new Map<object, number>()
        input.pipe(
          topKWithFractionalIndex((a, b) => a.rank - b.rank, { limit: 1 }),
          output((message) => {
            for (const [[, [row]], weight] of message.getInner())
              retained.set(row, (retained.get(row) ?? 0) + weight)
          }),
        )
        graph.finalize()
        const before = { rank }
        const after = { rank: rank + 1 }
        input.sendData(new MultiSet([[[1, before], 1]]))
        graph.run()
        const changes: Array<[[number, typeof before], number]> = [
          [[1, after], 1],
          [[1, before], -1],
        ]
        if (retractFirst) changes.reverse()
        input.sendData(new MultiSet(changes))
        graph.run()
        observe(`File available=${available}: retained rows`, {
          available,
          rows: [...retained]
            .filter(([, weight]) => weight !== 0)
            .map(([row, weight]) => ({
              row: payloadLabel(row, before, after),
              weight,
            })),
        })
        observe(
          `reach`,
          typeof File === `function` ? `File present` : `File absent`,
        )
        observe(`reach`, retractFirst ? `retract first` : `add first`)
      } finally {
        if (descriptor) Object.defineProperty(globalThis, `File`, descriptor)
      }
    }
  },
  check: (_history, trace, expected) =>
    checkTrace(trace, expected, `ordinary replacement`),
  calibrations: [
    ordinaryConstructions.calibration,
    {
      name: `omits the replacement observation`,
      law: `ordinary replacement`,
      corrupt: () => [],
    },
  ],
})

const sharedConstructions = requireConstructionReach<number>([
  {
    name: `shared siblings`,
    enters: [`shared subtree comparison`],
    build: (depth) => Math.max(1, depth),
  },
])
oracleProperty({
  id: `ivm.topk-batch-shared-subtrees`,
  law: {
    statement: `Equal shared subtrees cancel with exactly one leaf read per input tree.`,
    authority,
    limits,
  },
  histories: {
    arbitrary: fc.integer({ min: 0, max: 20 }),
    runs: 25,
    fixedSeeds: [409034],
    states: [`shared subtree comparison`],
    constructed: sharedConstructions.constructed,
  },
  model: (depth) =>
    sharedConstructions.model(depth, [
      { checkpoint: `batch and leaf reads`, value: { length: 0, reads: 2 } },
    ]),
  driver: (depth, observe) => {
    const spy = vi.spyOn(hashing, `hash`).mockReturnValue(7)
    try {
      let reads = 0
      function tree(): object {
        let node: object = {
          get value() {
            reads++
            return 1
          },
        }
        for (let level = 0; level < depth; level++)
          node = { left: node, right: node }
        return node
      }
      const actual = [
        ...topKBatch([
          new MultiSet<[number, object]>([
            [[1, tree()], 1],
            [[1, tree()], -1],
          ]),
        ]),
      ]
      observe(`batch and leaf reads`, { length: actual.length, reads })
      if (depth > 0) observe(`reach`, `shared subtree comparison`)
    } finally {
      spy.mockRestore()
    }
  },
  check: (_depth, trace, expected) =>
    checkTrace(trace, expected, `bounded shared-tree reads`),
  calibrations: [
    sharedConstructions.calibration,
    {
      name: `omits the leaf-read result`,
      law: `bounded shared-tree reads`,
      corrupt: () => [],
    },
  ],
})

// Each generated key owes its own old-row retraction and new-row insertion.
// Key order is not promised. Compare a sorted copy of the contribution bag;
// do not sum weights or discard duplicate, missing, zero, or negative entries.
function expectedUnrelated(count: number): Array<ExpectedObservation> {
  return [
    {
      checkpoint: `batch and unrelated reads`,
      value: {
        length: count * 2,
        entries: Array.from({ length: count }, (_, key) => [
          { key, row: `before`, weight: -1 },
          { key, row: `after`, weight: 1 },
        ]).flat(),
        reads: 0,
      },
    },
  ]
}

// Calibration can duplicate the first key's contributions while retaining the
// output length and getter reads. This must not stand in for another key.
function driveUnrelated(
  count: number,
  observe: Observe,
  duplicateFirstKey = false,
): void {
  let reads = 0
  const make = (rank: number) => ({
    rank,
    get unrelated() {
      reads++
      return new Array(100).fill(rank)
    },
  })
  type Row = [number, ReturnType<typeof make>]
  const sources = new Map<Row, RowLabel>()
  const batch: Array<[Row, number]> = []
  for (let key = 0; key < count; key++) {
    const before: Row = [key, make(0)]
    const after: Row = [key, make(1)]
    sources.set(before, `before`)
    sources.set(after, `after`)
    batch.push([after, 1], [before, -1])
  }
  const actual = [...topKBatch([new MultiSet(batch)])]
  const firstKeyEntries = actual.filter(([[key]]) => key === 0)
  const observed = duplicateFirstKey
    ? actual.map(
        (entry) =>
          firstKeyEntries.find(([, weight]) => weight === entry[1]) ?? entry,
      )
    : actual
  observe(`batch and unrelated reads`, {
    length: observed.length,
    entries: observed
      .map(([row, weight]) => ({
        key: row[0],
        row: sources.get(row) ?? `other`,
        weight,
      }))
      .sort(
        (left, right) =>
          left.key - right.key ||
          left.weight - right.weight ||
          (left.row < right.row ? -1 : left.row > right.row ? 1 : 0),
      ),
    reads,
  })
  observe(`reach`, `unrelated payload getters`)
  if (count > 1) observe(`reach`, `multiple unrelated keys`)
}

const unrelatedConstructions = requireConstructionReach<number>([
  {
    name: `generated unrelated keys and getters`,
    enters: [`unrelated payload getters`, `multiple unrelated keys`],
    build: (count) => Math.max(2, count),
  },
])
oracleProperty({
  id: `ivm.topk-batch-unrelated-payloads`,
  law: {
    statement: `Unrelated replacement payload getters are not read and each source key emits its retraction and insertion.`,
    authority,
    limits,
  },
  histories: {
    arbitrary: fc.integer({ min: 1, max: 100 }),
    runs: 25,
    fixedSeeds: [409035],
    states: [`unrelated payload getters`, `multiple unrelated keys`],
    constructed: unrelatedConstructions.constructed,
    fixed: [
      { name: `each of two keys contributes its own replacement`, history: 2 },
    ],
  },
  model: (count) =>
    unrelatedConstructions.model(count, expectedUnrelated(count)),
  driver: driveUnrelated,
  check: (_count, trace, expected) =>
    checkTrace(trace, expected, `unread unrelated payloads`),
  calibrations: [
    unrelatedConstructions.calibration,
    {
      name: `omits the unrelated-read result`,
      law: `unread unrelated payloads`,
      corrupt: () => [],
    },
    {
      name: `duplicates one source key and omits another`,
      law: `unread unrelated payloads`,
      driver: (count, observe) => driveUnrelated(count, observe, true),
    },
  ],
})

const cancellationConstructions = requireConstructionReach<number>([
  {
    name: `generated cancelling history`,
    enters: [`independently allocated cancellation`],
    build: (count) => count,
  },
])
oracleProperty({
  id: `ivm.topk-batch-long-cancellation`,
  law: {
    statement: `Long same-key histories cancel independently allocated equal values completely.`,
    authority,
    limits,
  },
  histories: {
    arbitrary: fc.integer({ min: 10, max: 150 }),
    runs: 25,
    fixedSeeds: [409037],
    states: [`independently allocated cancellation`],
    constructed: cancellationConstructions.constructed,
  },
  model: (count) =>
    cancellationConstructions.model(count, [
      { checkpoint: `cancelled batch`, value: { length: 0 } },
    ]),
  driver: (count, observe) => {
    const make = (value: number) => ({ value })
    const changes: Array<[[number, ReturnType<typeof make>], number]> = []
    for (let value = 0; value < count; value++)
      changes.push([[1, make(value)], 1])
    for (let value = count - 1; value >= 0; value--)
      changes.push([[1, make(value)], -1])
    observe(`cancelled batch`, {
      length: [...topKBatch([new MultiSet(changes)])].length,
    })
    observe(`reach`, `independently allocated cancellation`)
  },
  check: (_count, trace, expected) =>
    checkTrace(trace, expected, `complete cancellation`),
  calibrations: [
    cancellationConstructions.calibration,
    {
      name: `omits the cancellation result`,
      law: `complete cancellation`,
      corrupt: () => [],
    },
  ],
})
