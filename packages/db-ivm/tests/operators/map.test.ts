import { describe, expect, test } from "vitest"
import { D2 } from "../../src/d2.js"
import { MultiSet } from "../../src/multiset.js"
import { map, output } from "../../src/operators/index.js"

describe(`Operators`, () => {
  describe(`Map operation`, () => {
    test(`basic map operation`, () => {
      const graph = new D2()
      const input = graph.newInput<number>()
      const messages: Array<MultiSet<number>> = []

      input.pipe(
        map((x) => x + 5),
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
          [6, 1],
          [7, 1],
          [8, 1],
        ]),
      ])
    })

    test(`map with multiple transformations`, () => {
      const graph = new D2()
      const input = graph.newInput<number>()
      const messages: Array<MultiSet<number>> = []

      input.pipe(
        map((x) => x * 2),
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
          [3, 1],
        ])
      )

      graph.run()

      expect(messages).toEqual([
        new MultiSet([
          [3, 1],
          [5, 1],
          [7, 1],
        ]),
      ])
    })

    test(`map with negative multiplicities`, () => {
      const graph = new D2()
      const input = graph.newInput<number>()
      const messages: Array<MultiSet<number>> = []

      input.pipe(
        map((x) => x + 1),
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
          [2, -1],
          [3, -2],
          [4, 1],
        ]),
      ])
    })
  })
})
