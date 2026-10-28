import { describe, expect, it } from 'vitest'
import { D2 } from '../src/d2.js'
import { DifferenceStreamWriter, UnaryOperator } from '../src/graph.js'
import { MultiSet } from '../src/multiset.js'

/**
 * # Does a graph update execute disconnected idle operators?
 *
 * D2 operators consume queued input. A direct input on one branch must not run
 * operators on disconnected branches. The independent reference is a per-branch
 * input ledger: a branch with no messages has zero operator work, while a branch
 * with one message forwards that message once. The production driver constructs
 * a finalized D2 graph with the active branch before, among, or after idle
 * branches. A second case reverses a connected pair’s registration order so
 * the graph must make another pass. At each graph.run() checkpoint it compares
 * exact output messages and operator invocations. This bounded oracle does not
 * measure elapsed time or prove a general graph complexity bound.
 */
class CountingOperator extends UnaryOperator<number> {
  calls = 0

  run(): void {
    this.calls++
    for (const message of this.inputMessages()) {
      this.output.sendData(message)
    }
  }
}

function addBranch(graph: D2) {
  const input = graph.newInput<number>()
  const output = new DifferenceStreamWriter<number>()
  const operator = new CountingOperator(
    graph.getNextOperatorId(),
    input.connectReader(),
    output,
  )
  graph.addOperator(operator)
  return { input, output: output.newReader(), operator }
}

describe(`D2 operator work oracle`, () => {
  it(`rejects an unfinalized graph with no pending input`, () => {
    expect(() => new D2().run()).toThrow(`Graph not finalized`)
  })

  it.each([0, 32, 64])(
    `runs only branches with queued input when the active branch is at position %i`,
    (activePosition) => {
      const graph = new D2()
      const branches = Array.from({ length: 65 }, () => addBranch(graph))
      const active = branches[activePosition]!
      const expectedCalls = Array<number>(branches.length).fill(0)
      graph.finalize()

      active.input.sendData(new MultiSet([[7, 1]]))
      graph.run()
      expect(
        active.output.drain().map((message) => message.getInner()),
      ).toEqual([[[7, 1]]])
      expectedCalls[activePosition] = 1
      expect(branches.map((branch) => branch.operator.calls)).toEqual(
        expectedCalls,
      )

      const secondPosition = (activePosition + 1) % branches.length
      const second = branches[secondPosition]!
      second.input.sendData(new MultiSet([[9, 1]]))
      graph.run()
      expect(
        second.output.drain().map((message) => message.getInner()),
      ).toEqual([[[9, 1]]])
      expectedCalls[secondPosition] = 1
      expect(branches.map((branch) => branch.operator.calls)).toEqual(
        expectedCalls,
      )
    },
  )

  it(`drains work that a later registered operator sends to an earlier one`, () => {
    const graph = new D2()
    const middle = new DifferenceStreamWriter<number>()
    const output = new DifferenceStreamWriter<number>()
    const outputReader = output.newReader()
    const downstream = new CountingOperator(
      graph.getNextOperatorId(),
      middle.newReader(),
      output,
    )
    graph.addOperator(downstream)
    const input = graph.newInput<number>()
    const upstream = new CountingOperator(
      graph.getNextOperatorId(),
      input.connectReader(),
      middle,
    )
    graph.addOperator(upstream)
    graph.finalize()

    input.sendData(new MultiSet([[3, 1]]))
    graph.run()
    expect(outputReader.drain().map((message) => message.getInner())).toEqual([
      [[3, 1]],
    ])
    expect([upstream.calls, downstream.calls]).toEqual([1, 1])
  })
})
