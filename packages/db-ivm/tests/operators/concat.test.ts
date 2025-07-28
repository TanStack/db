import { describe, expect, test } from "vitest"
import { D2 } from "../../src/d2.js"
import { MultiSet } from "../../src/multiset.js"
import { concat, output } from "../../src/operators/index.js"

describe(`Operators`, () => {
  describe(`Concat operation`, () => {
    test(`basic concat operation`, () => {
      const graph = new D2()
      const input1 = graph.newInput<number>()
      const input2 = graph.newInput<number>()
      const messages: Array<MultiSet<number>> = []

      input1.pipe(
        concat(input2),
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      input1.sendData(
        new MultiSet([
          [1, 1],
          [2, 1],
        ])
      )

      input2.sendData(
        new MultiSet([
          [3, 1],
          [4, 1],
        ])
      )

      graph.run()

      expect(messages).toEqual([
        new MultiSet([
          [1, 1],
          [2, 1],
        ]),
        new MultiSet([
          [3, 1],
          [4, 1],
        ]),
      ])
    })

    test(`concat with mixed multiplicities`, () => {
      const graph = new D2()
      const input1 = graph.newInput<number>()
      const input2 = graph.newInput<number>()
      const messages: Array<MultiSet<number>> = []

      input1.pipe(
        concat(input2),
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      input1.sendData(
        new MultiSet([
          [1, -1],
          [2, 2],
        ])
      )

      input2.sendData(
        new MultiSet([
          [3, -2],
          [4, 1],
        ])
      )

      graph.run()

      expect(messages).toEqual([
        new MultiSet([
          [1, -1],
          [2, 2],
        ]),
        new MultiSet([
          [3, -2],
          [4, 1],
        ]),
      ])
    })

    test(`concat with different types`, () => {
      const graph = new D2()
      const input1 = graph.newInput<number>()
      const input2 = graph.newInput<string>()
      const messages: Array<MultiSet<number | string>> = []

      input1.pipe(
        concat(input2),
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      input1.sendData(
        new MultiSet([
          [1, 1],
          [2, 1],
        ])
      )

      input2.sendData(
        new MultiSet([
          [`a`, 1],
          [`b`, 1],
        ])
      )

      graph.run()

      expect(messages).toEqual([
        new MultiSet([
          [1, 1],
          [2, 1],
        ]),
        new MultiSet([
          [`a`, 1],
          [`b`, 1],
        ]),
      ])
    })

    test(`concat with overlapping data`, () => {
      const graph = new D2()
      const input1 = graph.newInput<number>()
      const input2 = graph.newInput<number>()
      const messages: Array<MultiSet<number>> = []

      input1.pipe(
        concat(input2),
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      input1.sendData(
        new MultiSet([
          [1, 1],
          [2, 1],
          [3, 1],
        ])
      )

      input2.sendData(
        new MultiSet([
          [2, 2],
          [3, -1],
          [4, 1],
        ])
      )

      graph.run()

      expect(messages).toEqual([
        new MultiSet([
          [1, 1],
          [2, 1],
          [3, 1],
        ]),
        new MultiSet([
          [2, 2],
          [3, -1],
          [4, 1],
        ]),
      ])
    })
  })
})
