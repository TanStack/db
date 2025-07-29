import { describe, expect, test } from "vitest"
import { D2 } from "../../src/d2.js"
import { MultiSet } from "../../src/multiset.js"
import { filter, map, output } from "../../src/operators/index.js"

describe(`Operators`, () => {
  describe(`Filter operation`, () => {
    test(`basic filter operation`, () => {
      const graph = new D2()
      const input = graph.newInput<number>()
      const messages: Array<MultiSet<number>> = []

      input.pipe(
        filter((x) => x % 2 === 0),
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

      expect(messages).toEqual([new MultiSet([[2, 1]])])
    })

    test(`filter with complex predicate`, () => {
      const graph = new D2()
      const input = graph.newInput<number>()
      const messages: Array<MultiSet<number>> = []

      input.pipe(
        filter((x) => x > 2 && x < 5),
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
          [4, 1],
          [5, 1],
        ])
      )

      graph.run()

      expect(messages).toEqual([
        new MultiSet([
          [3, 1],
          [4, 1],
        ]),
      ])
    })

    test(`filter with chained operations`, () => {
      const graph = new D2()
      const input = graph.newInput<number>()
      const messages: Array<MultiSet<number>> = []

      input.pipe(
        map((x) => x * 2),
        filter((x) => x % 4 === 0),
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
          [4, 1],
        ])
      )

      graph.run()

      expect(messages).toEqual([
        new MultiSet([
          [4, 1],
          [8, 1],
        ]),
      ])
    })
  })
})
