import { D2, output } from '@tanstack/db-ivm'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../../src/collection/index.js'
import { compileQuery } from '../../../src/query/compiler/index.js'
import { CollectionRef, PropRef } from '../../../src/query/ir.js'
import type { LazyCollectionCallbacks } from '../../../src/query/compiler/joins.js'

type Row = { id: number; key: unknown }
type Change = [[number, Row], number]

function createDemandHarness(joinType: `left` | `right` | `full` = `left`) {
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
          left: new PropRef([`left`, `key`]),
          right: new PropRef([`right`, `key`]),
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
