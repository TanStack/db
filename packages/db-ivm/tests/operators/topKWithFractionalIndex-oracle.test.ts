import { afterEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import * as hashing from '../../src/hashing/index.js'
import { D2 } from '../../src/d2.js'
import { MultiSet } from '../../src/multiset.js'
import { topKWithFractionalIndex } from '../../src/operators/topKWithFractionalIndex.js'
import { groupedTopKWithFractionalIndex } from '../../src/operators/groupedTopKWithFractionalIndex.js'
import { join, map, output } from '../../src/operators/index.js'
import { assertOnlyKeysAffected } from '../test-utils.js'
import { oracleRuns } from '../../../db/tests/oracle-config.js'
import { TopKMessageTracker, TopKRelation } from './topk-relation-oracle.js'

// Helper function to check if indices are in lexicographic order
function checkLexicographicOrder(results: Array<any>) {
  // Extract values and their indices
  const valuesWithIndices = results.map(([[_, [value, index]]]) => ({
    value,
    index,
  }))

  // Sort by value using the same comparator as in the test
  const sortedByValue = [...valuesWithIndices].sort((a, b) =>
    a.value.value < b.value.value ? -1 : 1,
  )

  // Check that indices are in the same order as the sorted values
  for (let i = 0; i < sortedByValue.length - 1; i++) {
    const currentIndex = sortedByValue[i]!.index
    const nextIndex = sortedByValue[i + 1]!.index

    // Indices should be in lexicographic order
    if (!(currentIndex < nextIndex)) {
      return false
    }
  }

  return true
}

// Helper function to verify the expected order of elements
function verifyOrder(results: Array<any>, expectedOrder: Array<string>) {
  // Extract values in the order they appear in the results
  const actualOrder = results.map(([[_, [value, __]]]) => value.value)

  // Sort both arrays to ensure consistent comparison
  const sortedActual = [...actualOrder].sort()
  const sortedExpected = [...expectedOrder].sort()

  // First check that we have the same elements
  expect(sortedActual).toEqual(sortedExpected)

  // Now check that the indices result in the correct order
  const valueToIndex = new Map()
  for (const [[_key, [value, index]]] of results) {
    valueToIndex.set(value.value, index)
  }

  // Sort the values by their indices
  const sortedByIndex = [...valueToIndex.entries()]
    .sort((a, b) => (a[1] < b[1] ? -1 : 1))
    .map(([value]) => value)

  // The order should match the expected order
  expect(sortedByIndex).toEqual(expectedOrder)
}

afterEach(() => vi.restoreAllMocks())

const groupedWindow: typeof topKWithFractionalIndex = (comparator, options) =>
  groupedTopKWithFractionalIndex(comparator, {
    ...options,
    groupKeyFn: () => `group`,
  })

describe.each([
  { name: `array`, topK: topKWithFractionalIndex },
  { name: `grouped array`, topK: groupedWindow },
])('Generated fractional $name windows', ({ topK }) => {
  it.each([409036, undefined])(
    `preserves cyclic payloads through replacements and fresh transients (seed %s)`,
    (seed) => {
      fc.assert(
        fc.property(
          fc.boolean(),
          fc.integer({ min: 0, max: 3 }),
          fc.array(
            fc.record({
              key: fc.integer({ min: 1, max: 3 }),
              value: fc.option(fc.integer({ min: 0, max: 5 }), { nil: null }),
              additionFirst: fc.boolean(),
            }),
            { minLength: 1, maxLength: 20 },
          ),
          (useClass, limit, steps) => {
            class Row {
              payload: unknown
              constructor(
                public id: number,
                public value: string,
              ) {
                this.payload = this
              }
            }
            const make = (id: number, value: string) => {
              if (useClass) return new Row(id, value)
              const row = { id, value, payload: undefined as unknown }
              row.payload = row
              return row
            }
            const graph = new D2()
            const input = graph.newInput<[number, Row]>()
            const rows = new TopKRelation<number>()
            const values = new Map<number, string>([[1, `0`]])
            const live = new Map([[1, make(1, `0`)]])
            input.pipe(
              topK((a, b) => a.value.localeCompare(b.value) || a.id - b.id, {
                limit,
              }),
              output((message) => {
                for (const [[, [row]]] of message.getInner())
                  expect(row.payload).toBe(row)
                rows.add(message.getInner())
              }),
            )
            graph.finalize()
            const check = () =>
              rows.expectRows(
                [...values]
                  .sort(([a, av], [b, bv]) => av.localeCompare(bv) || a - b)
                  .slice(0, limit)
                  .map(([id, value]) => [id, id, value]),
              )
            input.sendData(new MultiSet([[[1, live.get(1)!], 1]]))
            graph.run()
            check()
            for (const { key, value, additionFirst } of steps) {
              const changes: Array<[[number, Row], number]> = []
              const before = live.get(key)
              if (before) changes.push([[key, before], -1])
              if (value === null) {
                values.delete(key)
                live.delete(key)
              } else {
                const next = make(key, String(value))
                values.set(key, String(value))
                live.set(key, next)
                changes.push([[key, next], 1])
              }
              // Independently allocated equal cycles must cancel even when
              // their deltas straddle a real replacement in separate messages.
              changes.push([[key, make(key, `transient`)], 1])
              changes.unshift([[key, make(key, `transient`)], -1])
              if (additionFirst) changes.reverse()
              for (const change of changes)
                input.sendData(new MultiSet([change]))
              graph.run()
              check()
            }
          },
        ),
        {
          seed,
          numRuns: oracleRuns(30),
          examples: [
            [
              false,
              1,
              [
                { key: 1, value: 2, additionFirst: true },
                { key: 1, value: null, additionFirst: false },
                { key: 1, value: 3, additionFirst: false },
              ],
            ],
          ],
        },
      )
    },
  )

  it.each([409032, undefined])(
    `matches outer-join replacements (seed %s)`,
    (seed) => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 4 }),
          fc.array(
            fc.record({
              key: fc.integer({ min: 1, max: 4 }),
              value: fc.option(fc.constantFrom(`a`, `b`, `c`, `d`), {
                nil: null,
              }),
            }),
            { minLength: 1, maxLength: 20 },
          ),
          (limit, steps) => {
            const graph = new D2()
            const left = graph.newInput<[number, string]>()
            const right = graph.newInput<[number, string]>()
            const rows = new TopKRelation<number>()
            const matches = new Map<number, string>()
            left.pipe(
              join(right, `left`),
              map(
                ([id, [fallback, matched]]) =>
                  [id, { id, value: matched ?? fallback }] as [
                    number,
                    { id: number; value: string },
                  ],
              ),
              topK((a, b) => a.value.localeCompare(b.value), { limit }),
              output((message) => rows.add(message.getInner())),
            )
            graph.finalize()
            left.sendData(
              new MultiSet([1, 2, 3, 4].map((key) => [[key, `z`], 1])),
            )
            graph.run()
            for (const step of steps) {
              const changes: Array<[[number, string], number]> = []
              const old = matches.get(step.key)
              if (old !== undefined) changes.push([[step.key, old], -1])
              if (step.value === null) matches.delete(step.key)
              else {
                matches.set(step.key, step.value)
                changes.push([[step.key, step.value], 1])
              }
              right.sendData(new MultiSet(changes))
              graph.run()
              // Recompute the full left join, then sort and slice. No incremental
              // state or top-K helper determines the expected result.
              rows.expectRows(
                [1, 2, 3, 4]
                  .map((id) => ({ id, value: matches.get(id) ?? `z` }))
                  .sort((a, b) => a.value.localeCompare(b.value) || a.id - b.id)
                  .slice(0, limit)
                  .map(({ id, value }) => [id, id, value]),
              )
            }
          },
        ),
        {
          seed,
          numRuns: oracleRuns(100),
          examples: [
            [
              1,
              [
                { key: 1, value: `a` },
                { key: 1, value: null },
              ],
            ],
          ],
        },
      )
    },
  )
  it.each(
    [409031, undefined].flatMap((seed) =>
      [false, true].map((collision) => ({ seed, collision })),
    ),
  )(
    `matches a signed cumulative relation through keyed histories (seed $seed, collision $collision)`,
    ({ seed, collision }) => {
      // The reference relation observes full rows and signed weights. Forcing
      // every bucket to collide must not change what the graph publishes.
      if (collision) vi.spyOn(hashing, `hash`).mockReturnValue(7)
      fc.assert(
        fc.property(
          fc.record({
            limit: fc.integer({ min: 0, max: 6 }),
            offset: fc.integer({ min: 0, max: 3 }),
            split: fc.boolean(),
            transient: fc.boolean(),
            mapped: fc.boolean(),
            transientValue: fc.constantFrom(`a`, `b`, `c`, `d`, `transient`),
            steps: fc.array(
              fc.record({
                key: fc.integer({ min: 1, max: 8 }),
                value: fc.constantFrom(`a`, `b`, `c`, `d`),
                remove: fc.boolean(),
                insertFirst: fc.boolean(),
              }),
              { minLength: 1, maxLength: 30 },
            ),
          }),
          ({
            limit,
            offset,
            split,
            transient,
            mapped,
            transientValue,
            steps,
          }) => {
            type Row = { id: number; value: string }
            const graph = new D2()
            const input = graph.newInput<[number, Row]>()
            const relation = new TopKRelation<number>()
            const source = new Map<number, Row>()
            const projected = mapped
              ? input.pipe(
                  map(([key, row]) => [key, { ...row }] as [number, Row]),
                )
              : input
            projected.pipe(
              topK((a, b) => a.value.localeCompare(b.value), {
                limit,
                offset,
              }),
              output((message) => {
                // An always-empty window needs no transfer work. Signed
                // consolidation alone would hide a cancelling in/out pair.
                if (limit === 0) expect(message.getInner()).toEqual([])
                relation.add(message.getInner())
              }),
            )
            graph.finalize()
            const initial = [1, 2, 3].map((key) => ({
              key,
              value: `b`,
              remove: false,
              insertFirst: false,
            }))
            for (const step of [...initial, ...steps]) {
              const changes: Array<[[number, Row], number]> = []
              const old = source.get(step.key)
              if (old) changes.push([[step.key, { ...old }], -1])
              source.delete(step.key)
              if (!step.remove) {
                const row = { id: step.key, value: step.value }
                source.set(step.key, row)
                changes.push([[step.key, { ...row }], 1])
              }
              if (transient) {
                const intermediate: [number, Row] = [
                  step.key,
                  { id: step.key, value: transientValue },
                ]
                changes.push([intermediate, 1], [intermediate, -1])
              }
              if (step.insertFirst) changes.reverse()
              if (split) {
                for (const change of changes)
                  input.sendData(new MultiSet([change]))
              } else input.sendData(new MultiSet(changes))
              graph.run()
              const expected = [...source.values()]
                .sort((a, b) => a.value.localeCompare(b.value) || a.id - b.id)
                .slice(offset, offset + limit)
                .map((row): [number, number, string] => [
                  row.id,
                  row.id,
                  row.value,
                ])
              relation.expectRows(expected)
            }
          },
        ),
        {
          seed,
          numRuns: oracleRuns(100),
          examples: [
            [
              {
                offset: 1,
                limit: 1,
                split: true,
                transient: true,
                mapped: true,
                transientValue: `a`,
                steps: [
                  { key: 2, value: `b`, remove: true, insertFirst: false },
                  { key: 1, value: `a`, remove: false, insertFirst: true },
                ],
              },
            ],
            ...[0, 1, 3].flatMap((offset) =>
              [0, 1].map((limit) => [
                {
                  offset,
                  limit,
                  split: true,
                  transient: true,
                  mapped: true,
                  transientValue: `a`,
                  steps: [
                    { key: 4, value: `a`, remove: false, insertFirst: true },
                    { key: 2, value: `c`, remove: false, insertFirst: true },
                    { key: 1, value: `b`, remove: true, insertFirst: false },
                    { key: 1, value: `d`, remove: false, insertFirst: false },
                  ],
                },
              ]),
            ),
          ],
        },
      )
    },
  )
})

describe(`Operators`, () => {
  describe(`TopKWithFractionalIndex operator`, () => {
    const topK = topKWithFractionalIndex
    it(`should assign fractional indices to sorted elements`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new TopKMessageTracker<number>()

      input.pipe(
        topK((a, b) => a.value.localeCompare(b.value)),
        output((message) => {
          tracker.addMessage(message)
        }),
      )

      graph.finalize()

      // Initial data - a, b, c, d, e
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1],
          [[2, { id: 2, value: `b` }], 1],
          [[3, { id: 3, value: `c` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[5, { id: 5, value: `e` }], 1],
        ]),
      )
      graph.run()

      // Initial result should have all elements with fractional indices
      const initialResult = tracker.getResult()
      expect(initialResult.sortedResults.length).toBe(5) // Should have all 5 elements
      expect(initialResult.deltaCount).toBeLessThanOrEqual(6) // Should be efficient

      // Check that indices are in lexicographic order by examining raw weighted deltas
      const initialDeltas = initialResult.weightedDeltas
      expect(
        checkLexicographicOrder(
          initialDeltas.map(([item, mult]) => [item, mult]),
        ),
      ).toBe(true)

      tracker.reset()

      // Now let's move 'c' to the beginning by changing its value
      tracker.relation.expectRows([
        [1, 1, `a`],
        [2, 2, `b`],
        [3, 3, `c`],
        [4, 4, `d`],
        [5, 5, `e`],
      ])
      input.sendData(
        new MultiSet([
          [[3, { id: 3, value: `c` }], -1], // Remove the old value
          [[3, { id: 3, value: `a-` }], 1], // This should now be first
        ]),
      )
      graph.run()

      // Check the incremental changes
      const updateResult = tracker.getResult()
      // Should have reasonable incremental changes (not recomputing everything)
      tracker.relation.expectRows([
        [1, 1, `a`],
        [3, 3, `a-`],
        [2, 2, `b`],
        [4, 4, `d`],
        [5, 5, `e`],
      ])
      expect(updateResult.deltaCount).toBeLessThanOrEqual(4) // Should be incremental
      expect(updateResult.deltaCount).toBeGreaterThan(0) // Should have some changes

      // Check that only the affected key (null) produces weighted deltas
      assertOnlyKeysAffected(
        `topKFractional update`,
        updateResult.weightedDeltas,
        [3],
      )

      // Check that the update weighted deltas maintain lexicographic order on their own
      if (updateResult.weightedDeltas.length > 0) {
        const updateDeltas = updateResult.weightedDeltas.map(([item, mult]) => [
          item,
          mult,
        ])
        expect(checkLexicographicOrder(updateDeltas)).toBe(true)
      }
    })

    it(`should support duplicate ordering keys`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new TopKMessageTracker<number>()

      input.pipe(
        topK((a, b) => a.value.localeCompare(b.value)),
        output((message) => {
          tracker.addMessage(message)
        }),
      )

      graph.finalize()

      // Initial data - a, b, c, d, e
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1],
          [[2, { id: 2, value: `b` }], 1],
          [[3, { id: 3, value: `c` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[5, { id: 5, value: `e` }], 1],
        ]),
      )
      graph.run()

      // Initial result should have all elements with fractional indices
      const initialResult = tracker.getResult()
      expect(initialResult.sortedResults.length).toBe(5) // Should have all 5 elements
      expect(
        checkLexicographicOrder(
          initialResult.weightedDeltas.map(([item, mult]) => [item, mult]),
        ),
      ).toBe(true)

      tracker.reset()

      // Now let's add a new element with a value that is already in there
      tracker.relation.expectRows([
        [1, 1, `a`],
        [2, 2, `b`],
        [3, 3, `c`],
        [4, 4, `d`],
        [5, 5, `e`],
      ])
      input.sendData(new MultiSet([[[6, { id: 6, value: `c` }], 1]]))
      graph.run()

      // Check the incremental changes
      const updateResult = tracker.getResult()
      // Should have efficient incremental update
      tracker.relation.expectRows([
        [1, 1, `a`],
        [2, 2, `b`],
        [3, 3, `c`],
        [6, 6, `c`],
        [4, 4, `d`],
        [5, 5, `e`],
      ])
      expect(updateResult.deltaCount).toBeLessThanOrEqual(2) // Should be incremental (1 addition)
      expect(updateResult.deltaCount).toBeGreaterThan(0) // Should have changes

      // Check that only the affected key (null) produces weighted deltas
      assertOnlyKeysAffected(
        `topKFractional duplicate keys`,
        updateResult.weightedDeltas,
        [6],
      )

      // Check that the update weighted deltas maintain lexicographic order on their own
      if (updateResult.weightedDeltas.length > 0) {
        const updateDeltas = updateResult.weightedDeltas.map(([item, mult]) => [
          item,
          mult,
        ])
        expect(checkLexicographicOrder(updateDeltas)).toBe(true)
      }

      // The total state should have more elements after adding a duplicate
      expect(updateResult.sortedResults.length).toBeGreaterThan(0) // Should have the new element
    })

    it(`should handle limit and offset correctly`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new TopKMessageTracker<number>()

      input.pipe(
        topK((a, b) => a.value.localeCompare(b.value), {
          limit: 3,
          offset: 1,
        }),
        output((message) => {
          tracker.addMessage(message)
        }),
      )

      graph.finalize()

      // Initial data - a, b, c, d, e
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1],
          [[2, { id: 2, value: `b` }], 1],
          [[3, { id: 3, value: `c` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[5, { id: 5, value: `e` }], 1],
        ]),
      )
      graph.run()

      // Initial result should be b, c, d (offset 1, limit 3)
      const initialResult = tracker.getResult()
      expect(initialResult.sortedResults.length).toBe(3) // Should have 3 elements
      expect(initialResult.deltaCount).toBeLessThanOrEqual(6) // Should be efficient

      // Check that we have the correct elements (b, c, d) when sorted by fractional index
      const sortedByIndex = initialResult.sortedResults.sort((a, b) => {
        const aIndex = a[1][1] // fractional index
        const bIndex = b[1][1] // fractional index
        return aIndex < bIndex ? -1 : aIndex > bIndex ? 1 : 0
      })

      const sortedValues = sortedByIndex.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(sortedValues).toEqual([`b`, `c`, `d`]) // Should be in correct order with offset 1, limit 3

      tracker.reset()

      // Test a few incremental updates to verify limit/offset behavior
      tracker.relation.expectRows([
        [2, 2, `b`],
        [3, 3, `c`],
        [4, 4, `d`],
      ])

      // Add element that should be included (between c and d)
      input.sendData(
        new MultiSet([
          [[6, { id: 6, value: `c+` }], 1], // This should be between c and d
        ]),
      )
      graph.run()

      const updateResult = tracker.getResult()
      // Should have efficient incremental update
      expect(updateResult.deltaCount).toBeLessThanOrEqual(4) // Should be incremental
      expect(updateResult.deltaCount).toBeGreaterThan(0) // Should have changes

      // Check that final results still maintain correct limit/offset behavior
      expect(updateResult.sortedResults.length).toBeLessThanOrEqual(3) // Should respect limit

      // Check that only the affected key produces weighted deltas
      // 4 is affected because it is pushed out of the topK
      // by 6 which enters the topK
      assertOnlyKeysAffected(
        `topK limit+offset`,
        updateResult.weightedDeltas,
        [4, 6],
      )
      tracker.relation.expectRows([
        [2, 2, `b`],
        [3, 3, `c`],
        [6, 6, `c+`],
      ])
    })

    it(`should handle elements moving positions correctly`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new TopKMessageTracker<number>()

      input.pipe(
        topK((a, b) => a.value.localeCompare(b.value)),
        output((message) => {
          tracker.addMessage(message)
        }),
      )

      graph.finalize()

      // Initial data - a, b, c, d, e
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1],
          [[2, { id: 2, value: `b` }], 1],
          [[3, { id: 3, value: `c` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[5, { id: 5, value: `e` }], 1],
        ]),
      )
      graph.run()

      const initialResult = tracker.getResult()
      expect(initialResult.sortedResults.length).toBe(5) // Should have all 5 elements
      expect(initialResult.deltaCount).toBeLessThanOrEqual(6) // Should be efficient

      // Check that results are in correct order initially
      const initialSortedByIndex = initialResult.sortedResults.sort((a, b) => {
        const aIndex = a[1][1] // fractional index
        const bIndex = b[1][1] // fractional index
        return aIndex < bIndex ? -1 : aIndex > bIndex ? 1 : 0
      })

      const initialSortedValues = initialSortedByIndex.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(initialSortedValues).toEqual([`a`, `b`, `c`, `d`, `e`]) // Should be in lexicographic order

      tracker.reset()

      // Now let's swap 'b' and 'd' by changing their values
      tracker.relation.expectRows([
        [1, 1, `a`],
        [2, 2, `b`],
        [3, 3, `c`],
        [4, 4, `d`],
        [5, 5, `e`],
      ])
      input.sendData(
        new MultiSet([
          [[2, { id: 2, value: `b` }], -1], // Remove old 'b'
          [[2, { id: 2, value: `d+` }], 1], // 'b' becomes 'd+'
          [[4, { id: 4, value: `d` }], -1], // Remove old 'd'
          [[4, { id: 4, value: `b+` }], 1], // 'd' becomes 'b+'
        ]),
      )
      graph.run()

      const updateResult = tracker.getResult()
      // Should have efficient incremental update
      expect(updateResult.deltaCount).toBeLessThanOrEqual(6) // Should be incremental (4 changes max)
      expect(updateResult.deltaCount).toBeGreaterThan(0) // Should have changes

      // Check that only the affected key produces weighted deltas
      assertOnlyKeysAffected(
        `topK move positions`,
        updateResult.weightedDeltas,
        [2, 4],
      )

      // Tokens may vary; complete row contents and their order may not.
      tracker.relation.expectRows([
        [1, 1, `a`],
        [4, 4, `b+`],
        [3, 3, `c`],
        [2, 2, `d+`],
        [5, 5, `e`],
      ])
      expect(updateResult.sortedResults.length).toBeGreaterThan(0) // Should have some final results
    })

    it(`should maintain lexicographic order through multiple updates`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new TopKMessageTracker<number>()

      input.pipe(
        topK((a, b) => a.value.localeCompare(b.value)),
        output((message) => {
          tracker.addMessage(message)
        }),
      )

      graph.finalize()

      // Initial data - a, c, e, g, i
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1],
          [[3, { id: 3, value: `c` }], 1],
          [[5, { id: 5, value: `e` }], 1],
          [[7, { id: 7, value: `g` }], 1],
          [[9, { id: 9, value: `i` }], 1],
        ]),
      )
      graph.run()

      const initialResult = tracker.getResult()
      expect(initialResult.sortedResults.length).toBe(5) // Should have all 5 elements
      expect(initialResult.deltaCount).toBeLessThanOrEqual(6) // Should be efficient

      tracker.reset()

      // Update 1: Insert elements between existing ones - b, d, f, h
      tracker.relation.expectRows([
        [1, 1, `a`],
        [3, 3, `c`],
        [5, 5, `e`],
        [7, 7, `g`],
        [9, 9, `i`],
      ])
      input.sendData(
        new MultiSet([
          [[2, { id: 2, value: `b` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[6, { id: 6, value: `f` }], 1],
          [[8, { id: 8, value: `h` }], 1],
        ]),
      )
      graph.run()

      const update1Result = tracker.getResult()
      tracker.relation.expectRows([
        [1, 1, `a`],
        [2, 2, `b`],
        [3, 3, `c`],
        [4, 4, `d`],
        [5, 5, `e`],
        [6, 6, `f`],
        [7, 7, `g`],
        [8, 8, `h`],
        [9, 9, `i`],
      ])
      // Should have efficient incremental update
      expect(update1Result.deltaCount).toBeLessThanOrEqual(6) // Should be incremental
      expect(update1Result.deltaCount).toBeGreaterThan(0) // Should have changes

      tracker.reset()

      // Update 2: Move some elements around
      input.sendData(
        new MultiSet([
          [[3, { id: 3, value: `c` }], -1], // Remove old 'c'
          [[3, { id: 3, value: `j` }], 1], // Move 'c' to after 'i'
          [[7, { id: 7, value: `g` }], -1], // Remove old 'g'
          [[7, { id: 7, value: `a-` }], 1], // Move 'g' to before 'a'
        ]),
      )
      graph.run()

      const update2Result = tracker.getResult()
      tracker.relation.expectRows([
        [1, 1, `a`],
        [7, 7, `a-`],
        [2, 2, `b`],
        [4, 4, `d`],
        [5, 5, `e`],
        [6, 6, `f`],
        [8, 8, `h`],
        [9, 9, `i`],
        [3, 3, `j`],
      ])
      // Should have efficient incremental update for value changes
      expect(update2Result.deltaCount).toBeLessThanOrEqual(6) // Should be incremental
      expect(update2Result.deltaCount).toBeGreaterThan(0) // Should have changes

      // Check that only the affected key produces weighted deltas
      assertOnlyKeysAffected(
        `topK lexicographic update2`,
        update2Result.weightedDeltas,
        [3, 7],
      )
    })

    it(`should maintain correct order when cycling through multiple changes`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new TopKMessageTracker<number>()

      input.pipe(
        topK((a, b) => a.value.localeCompare(b.value)),
        output((message) => {
          tracker.addMessage(message)
        }),
      )

      graph.finalize()

      // Initial data with 5 items: a, b, c, d, e
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1],
          [[2, { id: 2, value: `b` }], 1],
          [[3, { id: 3, value: `c` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[5, { id: 5, value: `e` }], 1],
        ]),
      )
      graph.run()

      const initialResult = tracker.getResult()
      expect(initialResult.sortedResults.length).toBe(5) // Should have all 5 elements
      expect(initialResult.deltaCount).toBeLessThanOrEqual(6) // Should be efficient

      // Check that results are in correct initial order
      const initialSortedByIndex = initialResult.sortedResults.sort((a, b) => {
        const aIndex = a[1][1] // fractional index
        const bIndex = b[1][1] // fractional index
        return aIndex < bIndex ? -1 : aIndex > bIndex ? 1 : 0
      })

      const initialSortedValues = initialSortedByIndex.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(initialSortedValues).toEqual([`a`, `b`, `c`, `d`, `e`]) // Should be in lexicographic order

      tracker.reset()

      // Cycle 1: Move 'a' to position after 'b' by changing it to 'bb'
      tracker.relation.expectRows([
        [1, 1, `a`],
        [2, 2, `b`],
        [3, 3, `c`],
        [4, 4, `d`],
        [5, 5, `e`],
      ])
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], -1], // Remove old 'a'
          [[1, { id: 1, value: `bb` }], 1], // Move 'a' to after 'b'
        ]),
      )
      graph.run()

      const cycle1Result = tracker.getResult()
      tracker.relation.expectRows([
        [2, 2, `b`],
        [1, 1, `bb`],
        [3, 3, `c`],
        [4, 4, `d`],
        [5, 5, `e`],
      ])
      // Should have efficient incremental update
      expect(cycle1Result.deltaCount).toBeLessThanOrEqual(4) // Should be incremental
      expect(cycle1Result.deltaCount).toBeGreaterThan(0) // Should have changes

      tracker.reset()

      // Cycle 2: Move 'bb' to position after 'd' by changing it to 'dd'
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `bb` }], -1], // Remove old 'bb'
          [[1, { id: 1, value: `dd` }], 1], // Move to after 'd'
        ]),
      )
      graph.run()

      const cycle2Result = tracker.getResult()
      tracker.relation.expectRows([
        [2, 2, `b`],
        [3, 3, `c`],
        [4, 4, `d`],
        [1, 1, `dd`],
        [5, 5, `e`],
      ])
      // Should have efficient incremental update for the repositioning
      expect(cycle2Result.deltaCount).toBeLessThanOrEqual(4) // Should be incremental
      expect(cycle2Result.deltaCount).toBeGreaterThan(0) // Should have changes

      // Check that only the affected key produces weighted deltas
      assertOnlyKeysAffected(
        `topK cycling update2`,
        cycle2Result.weightedDeltas,
        [1],
      )

      // The key point is that the fractional indexing system can handle
      // multiple repositioning operations efficiently
      expect(cycle2Result.sortedResults.length).toBeGreaterThan(0) // Should have final results
    })

    it(`should handle insertion at the start of the sorted collection`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const allMessages: Array<any> = []
      const relation = new TopKRelation<number>()

      input.pipe(
        topK((a, b) => a.value.localeCompare(b.value)),
        output((message) => {
          allMessages.push(message)
          relation.add(message.getInner())
        }),
      )

      graph.finalize()

      // Initial data - b, c, d, e
      input.sendData(
        new MultiSet([
          [[2, { id: 2, value: `b` }], 1],
          [[3, { id: 3, value: `c` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[5, { id: 5, value: `e` }], 1],
        ]),
      )
      graph.run()

      // Initial result should have all elements with fractional indices
      const initialResult = allMessages[0].getInner()
      expect(initialResult.length).toBe(4)

      // Check that indices are in lexicographic order
      expect(checkLexicographicOrder(initialResult)).toBe(true)

      // Keep track of the current state
      const currentState = new Map()
      for (const [[_, [value, index]]] of initialResult) {
        currentState.set(JSON.stringify(value), [value, index])
      }

      // Update: Insert element at the start - 'a'
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1], // This should be inserted at the start
        ]),
      )
      graph.run()

      // Check the changes
      const changes = allMessages[1].getInner()
      expect(allMessages).toHaveLength(2)
      relation.expectRows([
        [1, 1, `a`],
        [2, 2, `b`],
        [3, 3, `c`],
        [4, 4, `d`],
        [5, 5, `e`],
      ])

      // We should only emit as many changes as we received (1 addition)
      expect(changes.length).toBe(1)

      // Apply the changes to our current state
      for (const [[_, [value, index]], multiplicity] of changes) {
        if (multiplicity < 0) {
          // Remove
          currentState.delete(JSON.stringify(value))
        } else {
          // Add
          currentState.set(JSON.stringify(value), [value, index])
        }
      }

      // Convert to array for lexicographic order check
      const currentStateArray = Array.from(currentState.values()).map(
        ([value, index]) => [[null, [value, index]], 1],
      )

      expect(checkLexicographicOrder(currentStateArray)).toBe(true)

      // Verify the order of elements
      const expectedOrder = [`a`, `b`, `c`, `d`, `e`]
      verifyOrder(currentStateArray, expectedOrder)

      // Check that the new element 'a' has an index that is lexicographically before 'b'
      const aValue = { id: 1, value: `a` }
      const bValue = { id: 2, value: `b` }
      const aIndex = currentState.get(JSON.stringify(aValue))[1]
      const bIndex = currentState.get(JSON.stringify(bValue))[1]

      // Directly check that 'a' comes before 'b' lexicographically
      expect(aIndex < bIndex).toBe(true)
    })

    it(`should handle multiple insertion at the start of the sorted collection`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const allMessages: Array<any> = []
      const relation = new TopKRelation<number>()

      input.pipe(
        topK((a, b) => a.value.localeCompare(b.value)),
        output((message) => {
          allMessages.push(message)
          relation.add(message.getInner())
        }),
      )

      graph.finalize()

      // Initial data - b, c, d, e
      input.sendData(
        new MultiSet([
          [[3, { id: 3, value: `c` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[5, { id: 5, value: `e` }], 1],
          [[6, { id: 6, value: `f` }], 1],
        ]),
      )
      graph.run()

      // Initial result should have all elements with fractional indices
      const initialResult = allMessages[0].getInner()
      expect(initialResult.length).toBe(4)

      // Check that indices are in lexicographic order
      expect(checkLexicographicOrder(initialResult)).toBe(true)

      // Keep track of the current state
      const currentState = new Map()
      for (const [[_, [value, index]]] of initialResult) {
        currentState.set(JSON.stringify(value), [value, index])
      }

      // Update: Insert element at the start - 'a'
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1], // This should be inserted at the start
          [[2, { id: 2, value: `b` }], 1], // This should be inserted at the start
        ]),
      )
      graph.run()

      // Check the changes
      const changes = allMessages[1].getInner()
      expect(allMessages).toHaveLength(2)
      relation.expectRows([
        [1, 1, `a`],
        [2, 2, `b`],
        [3, 3, `c`],
        [4, 4, `d`],
        [5, 5, `e`],
        [6, 6, `f`],
      ])

      // We should only emit as many changes as we received (1 addition)
      expect(changes.length).toBe(2)

      // Apply the changes to our current state
      for (const [[_, [value, index]], multiplicity] of changes) {
        if (multiplicity < 0) {
          // Remove
          currentState.delete(JSON.stringify(value))
        } else {
          // Add
          currentState.set(JSON.stringify(value), [value, index])
        }
      }

      // Convert to array for lexicographic order check
      const currentStateArray = Array.from(currentState.values()).map(
        ([value, index]) => [[null, [value, index]], 1],
      )

      expect(checkLexicographicOrder(currentStateArray)).toBe(true)

      // Verify the order of elements
      const expectedOrder = [`a`, `b`, `c`, `d`, `e`, `f`]
      verifyOrder(currentStateArray, expectedOrder)
    })
  })
})
