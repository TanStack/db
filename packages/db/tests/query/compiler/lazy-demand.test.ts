import { D2, output } from '@tanstack/db-ivm'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../../src/collection/index.js'
import { compileQuery } from '../../../src/query/compiler/index.js'
import { CollectionRef, Func, PropRef } from '../../../src/query/ir.js'
import type { LazyCollectionCallbacks } from '../../../src/query/compiler/joins.js'

type Row = { id: number; key: unknown; other?: unknown; third?: unknown }
type Change = [[number, Row], number]

function createDemandHarness(
  joinType: `left` | `right` | `full` = `left`,
  fields: Array<keyof Row> = [`key`],
) {
  const source = (id: string) =>
    createCollection<Record<string, unknown>>({
      id,
      getKey: ({ id: key }) => Number(key),
      sync: { sync: () => {} },
    })
  const left = source(`demand-left`)
  const right = source(`demand-right`)
  const graph = new D2()
  const leftInput = graph.newInput<[number, Row]>()
  const rightInput = graph.newInput<[number, Row]>()
  const callbacks: Record<string, LazyCollectionCallbacks> = {}
  const lazySources = new Set<string>()
  const { pipeline } = compileQuery(
    {
      from: new CollectionRef(left, `left`),
      join: [
        {
          type: joinType,
          from: new CollectionRef(right, `right`),
          on:
            fields.length === 1
              ? new Func(`eq`, [
                  new PropRef([`left`, fields[0]!]),
                  new PropRef([`right`, fields[0]!]),
                ])
              : new Func(
                  `and`,
                  fields.map(
                    (field) =>
                      new Func(`eq`, [
                        new PropRef([`left`, field]),
                        new PropRef([`right`, field]),
                      ]),
                  ),
                ),
        },
      ],
    },
    { left: leftInput, right: rightInput },
    { [left.id]: left, [right.id]: right },
    {},
    callbacks,
    lazySources,
    {},
    () => {},
  )
  const transitions: Array<Array<unknown>> = []
  for (const state of Object.values(callbacks)) {
    let previous: Array<unknown> = []
    state.setDemand = (_plan, keys) => {
      const next = [...keys]
      // Ignore redundant notifications, but not an intervening empty demand.
      if (
        next.length === previous.length &&
        next.every((key) => previous.includes(key))
      )
        return
      previous = next
      transitions.push(next)
    }
  }
  let resultWeight = 0
  pipeline.pipe(
    output((data) => {
      for (const [, weight] of data.getInner()) resultWeight += weight
    }),
  )
  graph.finalize()
  const input = joinType === `right` ? rightInput : leftInput
  return {
    graph,
    input,
    transitions,
    lazySources,
    resultWeight: () => resultWeight,
    cleanup: async () => {
      await left.cleanup()
      await right.cleanup()
    },
  }
}

describe(`compiled lazy demand presence`, () => {
  // Characterize the current message boundary before changing batching policy.
  it.each(
    ([`left`, `right`] as const).flatMap((joinType) =>
      ([`one-message`, `queued-messages`, `separate-turns`] as const).map(
        (delivery) => ({ joinType, delivery }),
      ),
    ),
  )(
    `preserves demand transitions for $joinType with $delivery`,
    async ({ joinType, delivery }) => {
      const h = createDemandHarness(joinType)
      const row = { id: 1, key: `shared` }
      const insert: Change = [[row.id, row], 1]
      const retract: Change = [[row.id, row], -1]
      try {
        h.input.sendData([insert])
        h.graph.run()
        expect(h.lazySources.size).toBe(1)
        expect(h.transitions).toEqual([[`shared`]])
        h.transitions.length = 0
        if (delivery === `one-message`) h.input.sendData([retract, insert])
        else {
          h.input.sendData([retract])
          if (delivery === `separate-turns`) h.graph.run()
          h.input.sendData([insert])
        }
        h.graph.run()
        expect(h.transitions).toEqual(
          delivery === `one-message` ? [] : [[], [`shared`]],
        )
        expect(h.resultWeight()).toBe(1)
      } finally {
        await h.cleanup()
      }
    },
  )

  it.each([
    { name: `numbers`, first: 3, second: 3 },
    { name: `signed zero`, first: -0, second: 0 },
    { name: `Date values`, first: new Date(3), second: new Date(3) },
    {
      name: `binary values`,
      first: Buffer.from([3]),
      second: new Uint8Array([3]),
    },
  ])(
    `retains one demand until the last $name contributor leaves`,
    async ({ first, second }) => {
      const h = createDemandHarness()
      const a: Row = { id: 1, key: first }
      const b: Row = { id: 2, key: second }
      try {
        h.input.sendData([
          [[a.id, a], 1],
          [[b.id, b], 1],
        ])
        h.graph.run()
        expect(h.transitions).toHaveLength(1)
        expect(h.transitions[0]).toHaveLength(1)
        expect(h.resultWeight()).toBe(2)
        h.input.sendData([[[a.id, a], -1]])
        h.graph.run()
        expect(h.transitions).toHaveLength(1)
        expect(h.resultWeight()).toBe(1)
        h.input.sendData([[[b.id, b], -1]])
        h.graph.run()
        expect(h.transitions).toHaveLength(2)
        expect(h.transitions[1]).toEqual([])
        expect(h.resultWeight()).toBe(0)
      } finally {
        await h.cleanup()
      }
    },
  )

  it(`does not demand nullish keys or add lazy demand for a full join`, async () => {
    for (const joinType of [`left`, `full`] as const) {
      const h = createDemandHarness(joinType)
      try {
        h.input.sendData([
          [[1, { id: 1, key: null }], 1],
          [[2, { id: 2, key: undefined }], 1],
        ])
        h.graph.run()
        expect(h.transitions).toEqual([])
        expect(h.lazySources.size).toBe(joinType === `full` ? 0 : 1)
      } finally {
        await h.cleanup()
      }
    }
  })
})

/**
 * Compound demand refines the current active rows. A row with any nullish
 * component cannot match and contributes no demand. Every satisfiable row
 * contributes its first operand until its last equal contributor leaves.
 *
 * This compiler-boundary model is a plain keyed table. It recomputes the
 * first-field set from all nonnull tuples, independently of encoded join keys
 * or incremental weights. The finite history grammar crosses LEFT/RIGHT,
 * two/three fields, both orders, distinct primary keys sharing null components,
 * shared primary keys with different later values, null/undefined, and
 * put/remove/restore. Each graph.run is a checkpoint for demand and unmatched
 * outer-row weight. Adapter requests and public events have a separate owner.
 */
describe(`compound lazy demand oracle`, () => {
  for (const joinType of [`left`, `right`] as const) {
    for (const width of [2, 3]) {
      for (const reverse of [false, true]) {
        it(`retains exactly the satisfiable contributors: ${joinType}, width=${width}, reverse=${reverse}`, async () => {
          const fields: Array<keyof Row> =
            width === 2 ? [`key`, `other`] : [`key`, `other`, `third`]
          if (reverse) fields.reverse()
          const h = createDemandHarness(joinType, fields)
          const model = new Map<number, Row>()
          const rows: Array<Row> = [
            { id: 1, key: 1, other: null, third: 7 },
            { id: 2, key: 2, other: null, third: 7 },
            { id: 3, key: 1, other: 9, third: null },
            { id: 4, key: 2, other: 8, third: 7 },
            { id: 5, key: 2, other: 9, third: 7 },
            { id: 6, key: null, other: 9, third: 7 },
            { id: 7, key: 3, other: undefined, third: 7 },
          ]
          const step = (row: Row, remove = false) => {
            const previous = model.get(row.id)
            const changes: Array<Change> = []
            if (previous) changes.push([[previous.id, previous], -1])
            if (remove) model.delete(row.id)
            else {
              model.set(row.id, row)
              changes.push([[row.id, row], 1])
            }
            h.input.sendData(changes)
            h.graph.run()
            const expected = new Set(
              [...model.values()]
                .filter((value) =>
                  fields.every((field) => value[field] != null),
                )
                .map((value) => value[fields[0]!]),
            )
            expect(
              new Set(h.transitions.at(-1) ?? []),
              `satisfiable demand`,
            ).toEqual(expected)
            expect(h.resultWeight(), `unmatched outer rows`).toBe(model.size)
          }
          try {
            for (const row of rows) step(row)
            step(rows[0]!, true)
            step({ ...rows[1]!, other: 9 })
            step(rows[3]!, true)
            step(rows[4]!, true)
            step(rows[1]!)
            for (const row of [...rows].reverse()) step(row, true)
            for (const row of rows) step({ ...row, key: 2, other: 9, third: 7 })
            for (const row of rows) step(row, true)
          } finally {
            await h.cleanup()
          }
        })
      }
    }
  }
})
