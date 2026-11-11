import { afterEach, beforeEach, describe, expect, vi } from 'vitest'
import fc from 'fast-check'
import * as hashing from '../../src/hashing/index.js'
import { D2 } from '../../src/d2.js'
import { MultiSet } from '../../src/multiset.js'
import { topKWithFractionalIndex } from '../../src/operators/topKWithFractionalIndex.js'
import { groupedTopKWithFractionalIndex } from '../../src/operators/groupedTopKWithFractionalIndex.js'
import { join, map, output } from '../../src/operators/index.js'
import { oracleProperty } from '../../../db/tests/oracle-property.js'
import { TopKRelation } from './topk-relation-oracle.js'
import {
  checkTopKComparisons,
  topKRecorder,
  topKReferences,
} from './topk-property-oracle.js'

/**
 * Fractional windows preserve the independently recomputed selected relation.
 * The existing operator contracts require unit signed output, strict index
 * order, payload-reference fidelity for cycles, and keyed replacement behavior.
 * Each grammar below retains its original constructors, fixed regressions,
 * callback observations and graph-run cuts. Cyclic payloads use three keys;
 * outer joins use four; keyed histories use eight, including forced hash
 * collisions. Multiple groups and downstream acquisition remain outside this
 * owner. The ordinary examples live in topKWithFractionalIndex-examples.test.ts.
 */

afterEach(() => vi.restoreAllMocks())

const groupedWindow: typeof topKWithFractionalIndex = (comparator, options) =>
  groupedTopKWithFractionalIndex(comparator, {
    ...options,
    groupKeyFn: () => `group`,
  })

type CyclicHistory = [
  boolean,
  number,
  Array<{ key: number; value: number | null; additionFirst: boolean }>,
]
type OuterJoinHistory = [number, Array<{ key: number; value: string | null }>]
type KeyedHistory = {
  limit: number
  offset: number
  split: boolean
  transient: boolean
  mapped: boolean
  transientValue: string
  steps: Array<{
    key: number
    value: string
    remove: boolean
    insertFirst: boolean
  }>
}

const cyclicExamples: Array<CyclicHistory> = [
  [
    false,
    1,
    [
      { key: 1, value: 2, additionFirst: true },
      { key: 1, value: null, additionFirst: false },
      { key: 1, value: 3, additionFirst: false },
    ],
  ],
]
const outerJoinExamples: Array<OuterJoinHistory> = [
  [
    1,
    [
      { key: 1, value: `a` },
      { key: 1, value: null },
    ],
  ],
]
const keyedExamples: Array<[KeyedHistory]> = [
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
    [0, 1].map((limit): [KeyedHistory] => [
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
]

describe.each([
  {
    name: `array`,
    topK: topKWithFractionalIndex,
    cyclicPayloads: `ivm.topk-cyclic-payloads-array`,
    outerJoinReplacements: `ivm.topk-outer-join-replacements-array`,
    keyedHistory: `ivm.topk-fractional-keyed-array`,
  },
  {
    name: `grouped array`,
    topK: groupedWindow,
    cyclicPayloads: `ivm.topk-cyclic-payloads-grouped`,
    outerJoinReplacements: `ivm.topk-outer-join-replacements-grouped`,
    keyedHistory: `ivm.topk-fractional-keyed-grouped`,
  },
])(
  `Generated fractional $name windows`,
  ({ topK, cyclicPayloads, outerJoinReplacements, keyedHistory }) => {
    oracleProperty<CyclicHistory, Array<unknown>>({
      id: cyclicPayloads,
      law: {
        statement: `Preserve cyclic payload references through replacements and independently allocated equal transients.`,
        authority: `The existing fractional-window contract and independent recomputation documented above.`,
        limits: `The original bounded history and value domain for this cell; no new operator or observation path is introduced.`,
      },
      owns: [
        `src/operators/topKWithFractionalIndex.ts#topKWithFractionalIndex`,
        `src/operators/join.ts#join`,
      ],
      histories: {
        arbitrary: fc.tuple(
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
        ),
        runs: 30,
        fixedSeeds: [409036],
        fixed: cyclicExamples.map((history, index) => ({
          name: `regression ${index}`,
          history,
        })),
      },
      model: topKReferences,
      driver: (history, observe) => {
        const recorder = topKRecorder(observe)
        const [useClass, limit, steps] = history

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
        const rows = new TopKRelation<number>(recorder.record)
        const values = new Map<number, string>([[1, `0`]])
        const live = new Map([[1, make(1, `0`)]])
        input.pipe(
          topK((a, b) => a.value.localeCompare(b.value) || a.id - b.id, {
            limit,
          }),
          output((message) => {
            for (const [[, [row]]] of message.getInner()) {
              recorder.record(
                `cyclic payload reference`,
                Object.is(row.payload, row),
                true,
              )
              expect(row.payload).toBe(row)
            }
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
        recorder.at(`graph run`)
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
          for (const change of changes) input.sendData(new MultiSet([change]))
          recorder.at(`graph run`)
          graph.run()
          check()
        }
      },
      check: checkTopKComparisons,
    })
    oracleProperty<OuterJoinHistory, Array<unknown>>({
      id: outerJoinReplacements,
      law: {
        statement: `Match full outer-join recomputation after every replacement.`,
        authority: `The existing fractional-window contract and independent recomputation documented above.`,
        limits: `The original bounded history and value domain for this cell; no new operator or observation path is introduced.`,
      },
      owns: [
        `src/operators/topKWithFractionalIndex.ts#topKWithFractionalIndex`,
        `src/operators/join.ts#join`,
      ],
      histories: {
        arbitrary: fc.tuple(
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
        ),
        runs: 100,
        fixedSeeds: [409032],
        fixed: outerJoinExamples.map((history, index) => ({
          name: `regression ${index}`,
          history,
        })),
      },
      model: topKReferences,
      driver: (history, observe) => {
        const recorder = topKRecorder(observe)
        const [limit, steps] = history

        const graph = new D2()
        const left = graph.newInput<[number, string]>()
        const right = graph.newInput<[number, string]>()
        const rows = new TopKRelation<number>(recorder.record)
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
        left.sendData(new MultiSet([1, 2, 3, 4].map((key) => [[key, `z`], 1])))
        recorder.at(`graph run`)
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
          recorder.at(`graph run`)
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
      check: checkTopKComparisons,
    })
    describe.each([false, true])(
      `keyed histories with collision %s`,
      (collision) => {
        beforeEach(() => {
          if (collision) vi.spyOn(hashing, `hash`).mockReturnValue(7)
        })
        oracleProperty<KeyedHistory, Array<unknown>>({
          id: keyedHistory,
          law: {
            statement: `Match the signed cumulative selected relation through keyed histories and digest collisions.`,
            authority: `The existing fractional-window contract and independent recomputation documented above.`,
            limits: `The original bounded history and value domain for this cell; no new operator or observation path is introduced.`,
          },
          owns: [
            `src/operators/topKWithFractionalIndex.ts#topKWithFractionalIndex`,
            `src/operators/join.ts#join`,
          ],
          histories: {
            arbitrary: fc.record({
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
            runs: 100,
            fixedSeeds: [409031],
            fixed: keyedExamples.map(([history], index) => ({
              name: `regression ${index}`,
              history,
            })),
          },
          model: topKReferences,
          driver: (history, observe) => {
            const recorder = topKRecorder(observe)
            const {
              limit,
              offset,
              split,
              transient,
              mapped,
              transientValue,
              steps,
            } = history

            type Row = { id: number; value: string }
            const graph = new D2()
            const input = graph.newInput<[number, Row]>()
            const relation = new TopKRelation<number>(recorder.record)
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
                if (limit === 0) {
                  recorder.record(
                    `zero-width transfer`,
                    message.getInner(),
                    [],
                    true,
                  )
                  expect(message.getInner()).toEqual([])
                }
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
              recorder.at(`graph run`)
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
          check: checkTopKComparisons,
        })
      },
    )
  },
)
