import { describe, expect, test } from "vitest"
import { D2 } from "../../src/d2.js"
import { MultiSet } from "../../src/multiset.js"
import { output } from "../../src/operators/index.js"

describe(`Operators`, () => {
  describe(`Output operation`, () => {
    test(`basic output operation`, () => {
      const graph = new D2()
      const input = graph.newInput<number>()
      const messages: Array<MultiSet<number>> = []

      input.pipe(
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
          [1, 1],
          [2, 1],
          [3, 1],
        ]),
      ])
    })

    test(`output with negative multiplicities`, () => {
      const graph = new D2()
      const input = graph.newInput<number>()
      const messages: Array<MultiSet<number>> = []

      input.pipe(
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
          [1, -1],
          [2, -2],
          [3, 1],
        ]),
      ])
    })
  })
})
