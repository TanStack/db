import { afterEach, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import { Temporal } from 'temporal-polyfill'
import { MultiSet } from '../../src/multiset.js'
import * as hashing from '../../src/hashing/index.js'
import { registerOpaqueHash } from '../../src/hashing/hash.js'
import { topKBatch } from '../../src/operators/topKState.js'
import { D2 } from '../../src/d2.js'
import { topKWithFractionalIndex } from '../../src/operators/topKWithFractionalIndex.js'
import { output } from '../../src/operators/index.js'

afterEach(() => vi.restoreAllMocks())

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
  { name: `signed zero`, pair: () => [-0, 0, true] },
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

it.each(
  valueRelations.flatMap((relation) =>
    [
      [false, false],
      [true, false],
      [true, true],
    ].map(([largeGroup, collision]) => ({
      ...relation,
      largeGroup,
      collision,
    })),
  ),
)(
  `preserves $name cancellation (large group $largeGroup, collision $collision)`,
  ({ pair, largeGroup, collision }) => {
    if (collision) vi.spyOn(hashing, `hash`).mockReturnValue(7)
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 254 }),
        fc.boolean(),
        (n, retractFirst) => {
          const [left, right, equivalent] = pair(n)
          const before: [number, { value: unknown }] = [1, { value: left }]
          const after: [number, { value: unknown }] = [1, { value: right }]
          const transient: [number, { value: unknown }] = [
            1,
            { value: Symbol() },
          ]
          const messages = [
            new MultiSet([[after, 1]]),
            ...(largeGroup
              ? [
                  new MultiSet([
                    [transient, 1],
                    [transient, -1],
                  ]),
                ]
              : []),
            new MultiSet([[before, -1]]),
          ]
          if (retractFirst) messages.reverse()
          const actual = [...topKBatch(messages)]
          if (equivalent) expect(actual).toEqual([])
          else {
            expect(actual).toHaveLength(2)
            expect(actual[0]![0]).toBe(before)
            expect(actual[0]![1]).toBe(-1)
            expect(actual[1]![0]).toBe(after)
            expect(actual[1]![1]).toBe(1)
          }
          // A correct helper alone does not prove the ordered graph retains the
          // replacement. Keep raw signed output; never erase a missed retraction.
          const graph = new D2()
          const input = graph.newInput<typeof before>()
          const retained = new Map<(typeof before)[1], number>()
          input.pipe(
            topKWithFractionalIndex(() => 0, { limit: 1 }),
            output((message) => {
              for (const [[, [row]], weight] of message.getInner())
                retained.set(row, (retained.get(row) ?? 0) + weight)
            }),
          )
          graph.finalize()
          input.sendData(new MultiSet([[before, 1]]))
          graph.run()
          for (const message of messages) input.sendData(message)
          graph.run()
          const live = [...retained].filter(([, weight]) => weight !== 0)
          expect(live).toHaveLength(1)
          expect(live[0]![0]).toBe(equivalent ? before[1] : after[1])
          expect(live[0]![1]).toBe(1)
        },
      ),
      { seed: 409033, numRuns: 25 },
    )
    if (collision) expect(hashing.hash).not.toHaveBeenCalled()
  },
)

it.each([true, false])(
  `replaces ordinary rows with File available=%s`,
  (available) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, `File`)
    if (!available) Reflect.deleteProperty(globalThis, `File`)
    try {
      fc.assert(
        fc.property(fc.integer(), fc.boolean(), (rank, retractFirst) => {
          const graph = new D2()
          const input = graph.newInput<[number, { rank: number }]>()
          const rows = new Map<object, number>()
          input.pipe(
            topKWithFractionalIndex((a, b) => a.rank - b.rank, { limit: 1 }),
            output((message) => {
              for (const [[, [row]], weight] of message.getInner())
                rows.set(row, (rows.get(row) ?? 0) + weight)
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
          const live = [...rows].filter(([, weight]) => weight !== 0)
          expect(live).toHaveLength(1)
          expect(live[0]![0]).toBe(after)
          expect(live[0]![1]).toBe(1)
        }),
        { seed: 409039, numRuns: 25 },
      )
    } finally {
      if (descriptor) Object.defineProperty(globalThis, `File`, descriptor)
    }
  },
)

it(`keeps distinct row keys when structural hashes collide`, () => {
  // A hash is an accelerator, never proof that two keyed rows are equal.
  vi.spyOn(hashing, `hash`).mockReturnValue(7)
  const batch = new MultiSet<[string | number, { id: number }]>([
    [[1, { id: 1 }], 1],
    [[`1`, { id: 2 }], 1],
  ])
  expect([...topKBatch([batch])]).toEqual(batch.getInner())
})

it(`compares shared subtrees without expanding every path`, () => {
  vi.spyOn(hashing, `hash`).mockReturnValue(7)
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 20 }), (depth) => {
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
      expect(actual).toEqual([])
      expect(reads).toBe(2)
    }),
    { seed: 409034, numRuns: 25 },
  )
})

it(`does not inspect payloads when each key occurs once`, () => {
  let reads = 0
  const rows = Array.from({ length: 100 }, (_, id) => ({
    id,
    get unused() {
      reads++
      return id
    },
  }))
  const batch = new MultiSet<[number, (typeof rows)[number]]>(
    rows.map((row) => [[row.id, row], 1]),
  )
  const actual = [...topKBatch([batch])]
  expect(reads).toBe(0)
  expect(actual).toHaveLength(rows.length)
  for (const [index, [[key, row], weight]] of actual.entries()) {
    expect(key).toBe(index)
    expect(row).toBe(rows[index])
    expect(weight).toBe(1)
  }
})

it(`short-circuits replacements without hashing unrelated payloads`, () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 100 }), (count) => {
      let reads = 0
      const make = (rank: number) => ({
        rank,
        get unrelated() {
          reads++
          return new Array(100).fill(rank)
        },
      })
      const batch: Array<[[number, ReturnType<typeof make>], number]> = []
      for (let key = 0; key < count; key++) {
        batch.push([[key, make(1)], 1], [[key, make(0)], -1])
      }
      expect([...topKBatch([new MultiSet(batch)])]).toHaveLength(count * 2)
      expect(reads).toBe(0)
    }),
    { seed: 409035, numRuns: 25 },
  )
})

it(`cancels long same-key histories with independently allocated values`, () => {
  fc.assert(
    fc.property(fc.integer({ min: 10, max: 150 }), (count) => {
      const make = (value: number) => ({ value })
      const changes: Array<[[number, ReturnType<typeof make>], number]> = []
      for (let value = 0; value < count; value++)
        changes.push([[1, make(value)], 1])
      for (let value = count - 1; value >= 0; value--)
        changes.push([[1, make(value)], -1])
      expect([...topKBatch([new MultiSet(changes)])]).toEqual([])
    }),
    { seed: 409037, numRuns: 25 },
  )
})

it.each([TypeError, RangeError])(
  `does not swallow user %s exceptions while bucketing`,
  (ErrorType) => {
    const error = new ErrorType(`Cannot hash cyclic structural values`)
    const row = {
      get value(): number {
        throw error
      },
    }
    let observed: unknown
    try {
      Array.from(
        topKBatch([
          new MultiSet<[number, object]>([
            [[1, row], 1],
            [[1, row], -1],
            [[1, { value: 2 }], 1],
          ]),
        ]),
      )
    } catch (caught) {
      observed = caught
    }
    expect(observed).toBe(error)
  },
)

it.each([`plain cycle`, `class cycle`, `large payload`] as const)(
  `orders a unique key without imposing a structural hash domain: %s`,
  (kind) => {
    class Row {
      id = 1
      payload: unknown
    }
    const row =
      kind === `class cycle`
        ? new Row()
        : { id: 1, payload: undefined as unknown }
    row.payload = kind === `large payload` ? new Array(1_000_001).fill(0) : row
    const entries = [
      ...topKBatch([new MultiSet<[number, typeof row]>([[[1, row], 1]])]),
    ]
    expect(entries).toHaveLength(1)
    expect(entries[0]![0][1]).toBe(row)
    expect(entries[0]![1]).toBe(1)
    const graph = new D2()
    const input = graph.newInput<[number, typeof row]>()
    const observed: Array<[[number, [typeof row, string]], number]> = []
    input.pipe(
      topKWithFractionalIndex((a, b) => a.id - b.id, { limit: 1 }),
      output((message) => observed.push(...message.getInner())),
    )
    graph.finalize()
    input.sendData(new MultiSet([[[1, row], 1]]))
    graph.run()
    expect(observed).toHaveLength(1)
    expect(observed[0]![0][1][0]).toBe(row)
    expect(observed[0]![1]).toBe(1)
  },
)

it(`consolidates structurally equal fresh transient values before replacements`, () => {
  const batch = new MultiSet<[number, { value: string }]>([
    [[1, { value: `new` }], 1],
    [[1, { value: `temporary` }], 1],
    [[1, { value: `old` }], -1],
    [[1, { value: `temporary` }], -1],
  ])
  expect([...topKBatch([batch])]).toEqual([
    [[1, { value: `old` }], -1],
    [[1, { value: `new` }], 1],
  ])
})
