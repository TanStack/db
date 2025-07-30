import { describe, expect, test, vi } from "vitest"
import { D2 } from "../../src/d2.js"
import { MultiSet } from "../../src/multiset.js"
import { debug } from "../../src/operators/index.js"

describe(`Operators`, () => {
  describe(`Debug operation`, () => {
    test(`basic debug operation`, () => {
      const graph = new D2()
      const input = graph.newInput<number>()
      const consoleSpy = vi.spyOn(console, `log`)

      input.pipe(debug(`test`))

      graph.finalize()

      input.sendData(
        new MultiSet([
          [1, 1],
          [2, 1],
          [3, 1],
        ])
      )

      graph.run()

      expect(consoleSpy).toHaveBeenCalledWith(
        `debug test data: MultiSet([[1,1],[2,1],[3,1]])`
      )
    })

    test(`debug with indentation`, () => {
      const graph = new D2()
      const input = graph.newInput<number>()
      const consoleSpy = vi.spyOn(console, `log`)

      input.pipe(debug(`test`, true))

      graph.finalize()

      input.sendData(
        new MultiSet([
          [1, 1],
          [2, 1],
          [3, 1],
        ])
      )

      graph.run()

      expect(consoleSpy).toHaveBeenCalledWith(
        `debug test data: MultiSet([\n  [\n    1,\n    1\n  ],\n  [\n    2,\n    1\n  ],\n  [\n    3,\n    1\n  ]\n])`
      )
    })

    test(`debug with negative multiplicities`, () => {
      const graph = new D2()
      const input = graph.newInput<number>()
      const consoleSpy = vi.spyOn(console, `log`)

      input.pipe(debug(`test`))

      graph.finalize()

      input.sendData(
        new MultiSet([
          [1, -1],
          [2, -2],
          [3, 1],
        ])
      )

      graph.run()

      expect(consoleSpy).toHaveBeenCalledWith(
        `debug test data: MultiSet([[1,-1],[2,-2],[3,1]])`
      )
    })
  })
})
