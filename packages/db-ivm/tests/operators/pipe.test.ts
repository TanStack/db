import { describe, expect, test } from "vitest"
import { D2 } from "../../src/d2.js"
import { MultiSet } from "../../src/multiset.js"
import { map, output, pipe } from "../../src/operators/index.js"

describe(`Operators`, () => {
  describe(`Pipe operation`, () => {
    test(`basic pipe operation`, () => {
      const graph = new D2()
      const input = graph.newInput<number>()
      const messages: Array<MultiSet<number>> = []

      input.pipe(
        pipe(
          map((x) => x + 5),
          map((x) => x * 2)
        ),
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
          [12, 1],
          [14, 1],
          [16, 1],
        ]),
      ])
    })
  })
})
