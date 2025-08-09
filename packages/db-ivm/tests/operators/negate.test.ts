import { describe, expect, test } from "vitest"
import { D2 } from "../../src/d2.js"
import { MultiSet } from "../../src/multiset.js"
import { map, negate, output } from "../../src/operators/index.js"

describe(`Operators`, () => {
  describe(`Negate operation`, () => {
    test(`basic negate operation`, () => {
      const graph = new D2()
      const input = graph.newInput<number>()
      const messages: Array<MultiSet<number>> = []

      input.pipe(
        negate(),
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      input.sendData(
        new MultiSet([
          [1, 1],
          [2, 1],
          [3, 1],
        ])
      )

      graph.run()

      expect(messages).toEqual([
        new MultiSet([
          [1, -1],
          [2, -1],
          [3, -1],
        ]),
      ])
    })

    test(`negate with mixed multiplicities`, () => {
      const graph = new D2()
      const input = graph.newInput<number>()
      const messages: Array<MultiSet<number>> = []

      input.pipe(
        negate(),
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      input.sendData(
        new MultiSet([
          [1, -1],
          [2, -2],
          [3, 1],
        ])
      )

      graph.run()

      expect(messages).toEqual([
        new MultiSet([
          [1, 1],
          [2, 2],
          [3, -1],
        ]),
      ])
    })

    test(`negate with already negative multiplicities`, () => {
      const graph = new D2()
      const input = graph.newInput<number>()
      const messages: Array<MultiSet<number>> = []

      input.pipe(
        negate(),
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      input.sendData(
        new MultiSet([
          [1, -2],
          [2, 1],
          [3, -3],
        ])
      )

      graph.run()

      expect(messages).toEqual([
        new MultiSet([
          [1, 2],
          [2, -1],
          [3, 3],
        ]),
      ])
    })

    test(`negate with chained operations`, () => {
      const graph = new D2()
      const input = graph.newInput<number>()
      const messages: Array<MultiSet<number>> = []

      input.pipe(
        map((x) => x * 2),
        negate(),
        map((x) => x + 1),
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      input.sendData(
        new MultiSet([
          [1, 1],
          [2, 1],
        ])
      )

      graph.run()

      expect(messages).toEqual([
        new MultiSet([
          [3, -1],
          [5, -1],
        ]),
      ])
    })
  })
})
