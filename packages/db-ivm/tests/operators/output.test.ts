import { describe, expect, test } from 'vitest'
import { D2 } from '../../src/d2.js'
import { MultiSet } from '../../src/multiset.js'
import {
  OutputOperator,
  TapOperator,
  output,
} from '../../src/operators/index.js'
import { DifferenceStreamWriter, LinearUnaryOperator } from '../../src/graph.js'

describe(`Operators`, () => {
  describe(`Output operation`, () => {
    test(`basic output operation`, () => {
      const graph = new D2()
      const input = graph.newInput<number>()
      const messages: Array<MultiSet<number>> = []

      input.pipe(
        output((message) => {
          messages.push(message)
        }),
      )

      graph.finalize()

      input.sendData(
        new MultiSet([
          [1, 1],
          [2, 1],
          [3, 1],
        ]),
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
        }),
      )

      graph.finalize()

      input.sendData(
        new MultiSet([
          [1, -1],
          [2, -2],
          [3, 1],
        ]),
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

test(`output preserves its public constructor and independent subclass methods`, () => {
  const writer = new DifferenceStreamWriter<number>()
  const forwarded = new DifferenceStreamWriter<number>()
  const reader = forwarded.newReader()
  let callbacks = 0
  let consumerCalls = 0
  // OutputOperator previously owned run(), without a virtual inner() hook.
  // A consumer may already use that name for unrelated work.
  class Consumer extends OutputOperator<number> {
    inner(message: MultiSet<number>) {
      consumerCalls++
      return message
    }
  }
  const operator = new Consumer(
    0,
    writer.newReader(),
    forwarded,
    () => callbacks++,
  )
  const message = new MultiSet([[1, 1]])
  writer.sendData(message)
  operator.run()
  expect(callbacks).toBe(1)
  expect(consumerCalls).toBe(0)
  expect(reader.drain()).toEqual([message])
  expect(OutputOperator.name).toBe(`OutputOperator`)
  expect(operator).not.toBeInstanceOf(TapOperator)
  expect(operator).not.toBeInstanceOf(LinearUnaryOperator)
})
