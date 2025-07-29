import { describe, expect, test } from "vitest"
import { D2 } from "../../src/d2.js"
import { MultiSet } from "../../src/multiset.js"
import { consolidate } from "../../src/operators/consolidate.js"
import { output } from "../../src/operators/output.js"

describe(`Operators`, () => {
  describe(`Consolidate operation`, () => {
    testConsolidate()
  })
})

function testConsolidate() {
  test(`basic consolidate operation`, () => {
    const graph = new D2()
    const input = graph.newInput<number>()
    const messages: Array<MultiSet<number>> = []

    input.pipe(
      consolidate(),
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
    input.sendData(
      new MultiSet([
        [3, 1],
        [4, 1],
      ])
    )
    input.sendData(
      new MultiSet([
        [3, 2],
        [2, -1],
      ])
    )
    graph.run()

    const data = messages.map((m) => m.getInner())

    expect(data).toEqual([
      [
        [1, 1],
        [3, 3],
        [4, 1],
      ],
    ])
  })

  test(`consolidate with all removed`, () => {
    const graph = new D2()
    const input = graph.newInput<number>()
    const messages: Array<MultiSet<number>> = []

    input.pipe(
      consolidate(),
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(
      new MultiSet([
        [1, 1],
        [2, 2],
      ])
    )
    input.sendData(
      new MultiSet([
        [1, -1],
        [2, -2],
      ])
    )
    graph.run()

    const data = messages.map((m) => m.getInner())

    expect(data).toEqual([])
  })

  test(`consolidate with multiple batches`, () => {
    const graph = new D2()
    const input = graph.newInput<number>()
    const messages: Array<MultiSet<number>> = []

    input.pipe(
      consolidate(),
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

    input.sendData(
      new MultiSet([
        [2, 1],
        [3, 1],
      ])
    )
    graph.run()

    const data = messages.map((m) => m.getInner())

    expect(data).toEqual([
      [
        [1, 1],
        [2, 1],
      ],
      [
        [2, 1],
        [3, 1],
      ],
    ])
  })
}
