import { beforeAll, describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { D2 } from '../../src/d2.js'
import { MultiSet } from '../../src/multiset.js'
import { output } from '../../src/operators/index.js'
import { topKWithFractionalIndex } from '../../src/operators/topKWithFractionalIndex.js'
import { groupedTopKWithFractionalIndex } from '../../src/operators/groupedTopKWithFractionalIndex.js'
import {
  loadBTree,
  topKWithFractionalIndexBTree,
} from '../../src/operators/topKWithFractionalIndexBTree.js'
import { topK, topKWithIndex } from '../../src/operators/topK.js'
import { TopKRelation } from './topk-relation-oracle.js'

const keys = [1, `1`, 2, `2`, `a`] as const
type Key = (typeof keys)[number]
type Row = { id: number; value: string }
const grouped: typeof topKWithFractionalIndex = (compare, options) =>
  groupedTopKWithFractionalIndex(compare, {
    ...options,
    groupKeyFn: () => `one`,
  })

beforeAll(loadBTree)

it.each([false, true])(
  `preserves selected multiplicity in ordinary top-K (indexed %s)`,
  (indexed) => {
    const graph = new D2()
    const input = graph.newInput<[null, Row]>()
    const observed = new Map<string, number>()
    const capture = (message: MultiSet<unknown>) => {
      for (const [value, weight] of message.getInner()) {
        const identity = JSON.stringify(value)
        const count = (observed.get(identity) ?? 0) + weight
        if (count === 0) observed.delete(identity)
        else observed.set(identity, count)
      }
    }
    const comparator = (a: Row, b: Row) => a.id - b.id
    if (indexed)
      input.pipe(topKWithIndex(comparator, { limit: 1 }), output(capture))
    else input.pipe(topK(comparator, { limit: 1 }), output(capture))
    graph.finalize()
    const row = { id: 1, value: `a` }
    let prior = 0
    for (const count of [1, 2, 1, 0, 2, 1, 0]) {
      input.sendData(new MultiSet([[[null, row], count - prior]]))
      prior = count
      graph.run()
      expect([...observed]).toEqual(
        count === 0
          ? []
          : [[JSON.stringify([null, indexed ? [row, 0] : row]), count]],
      )
    }
  },
)

describe.each([
  { name: `array`, operator: topKWithFractionalIndex, movable: true },
  { name: `grouped`, operator: grouped, movable: true },
  { name: `BTree`, operator: topKWithFractionalIndexBTree, movable: false },
])(`Signed support and window oracle: $name`, ({ operator, movable }) => {
  it.each([409033, undefined])(
    `matches counted typed keys at every cut (seed %s)`,
    (seed) => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              slot: fc.integer({ min: 0, max: keys.length - 1 }),
              support: fc.integer({ min: 0, max: 3 }),
              offset: fc.integer({ min: 0, max: 6 }),
              limit: fc.integer({ min: 0, max: 6 }),
            }),
            { minLength: 1, maxLength: 35 },
          ),
          (steps) => {
            const graph = new D2()
            const input = graph.newInput<[Key, Row]>()
            const relation = new TopKRelation<Key, string>()
            const counts = new Map<Key, number>()
            let window = { offset: 0, limit: 3 }
            let size!: () => number
            let move!: (options: typeof window) => void
            const rowFor = (key: Key): Row => ({
              id: 10 - keys.indexOf(key),
              value: `tie`,
            })
            input.pipe(
              operator(() => 0, {
                ...window,
                setSizeCallback: (getSize) => {
                  size = getSize
                },
                setWindowFn: (setWindow) => {
                  move = setWindow
                },
              }),
              output((message) => relation.add(message.getInner())),
            )
            graph.finalize()
            const check = () => {
              const selected = [...counts]
                .filter(([, count]) => count > 0)
                .map(([key]) => key)
                .sort((a, b) =>
                  typeof a !== typeof b
                    ? typeof a === `string`
                      ? -1
                      : 1
                    : a < b
                      ? -1
                      : a > b
                        ? 1
                        : 0,
                )
                .slice(window.offset, window.offset + window.limit)
              relation.expectRows(
                selected.map((key) => [key, rowFor(key).id, `tie`]),
              )
              expect(size()).toBe(selected.length)
            }
            // Pin positivity crossings and partial withdrawals before generated cuts.
            const history = [1, 2, 1, 0, 2, 1, 0].map((support) => ({
              slot: 0,
              support,
              offset: 0,
              limit: 3,
            }))
            for (const step of [...history, ...steps]) {
              const key = keys[step.slot]!
              const weight = step.support - (counts.get(key) ?? 0)
              counts.set(key, step.support)
              input.sendData(new MultiSet([[[key, rowFor(key)], weight]]))
              graph.run()
              check()
              if (movable) {
                window = { offset: step.offset, limit: step.limit }
                move(window)
                graph.run()
                check()
              }
            }
          },
        ),
        { seed, numRuns: 100 },
      )
    },
  )
})

it.each([-2, 2])(
  `rejects excess signed weight %s across a moved window`,
  (weight) => {
    const check = (corrupt: boolean) => {
      const relation = new TopKRelation<Key, string>()
      relation.add([[[1, [{ id: 9, value: `tie` }, `a0`]], 1]])
      relation.expectRows([[1, 9, `tie`]])
      relation.add([
        [
          [1, [{ id: 9, value: `tie` }, `a0`]],
          corrupt && weight < 0 ? weight : -1,
        ],
        [
          [`1`, [{ id: 8, value: `tie` }, `a1`]],
          corrupt && weight > 0 ? weight : 1,
        ],
      ])
      relation.expectRows([[`1`, 8, `tie`]])
    }
    check(false)
    expect(() => check(true)).toThrowError(
      expect.objectContaining({ name: `AssertionError` }),
    )
  },
)
