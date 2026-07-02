import { beforeEach, describe, expect, test } from 'vitest'
import { D2 } from '../src/d2.js'
import { DifferenceStreamWriter } from '../src/graph.js'
import { MultiSet } from '../src/multiset.js'
import { output } from '../src/operators/index.js'
import type { DifferenceStreamReader } from '../src/graph.js'

describe(`DifferenceStreamReader and DifferenceStreamWriter`, () => {
  let writer: DifferenceStreamWriter<number>
  let reader: DifferenceStreamReader<number>

  beforeEach(() => {
    writer = new DifferenceStreamWriter<number>()
    reader = writer.newReader()
  })

  test(`isEmpty returns true for empty queue`, () => {
    expect(reader.isEmpty()).toBe(true)
  })

  test(`isEmpty returns false when queue has messages`, () => {
    writer.sendData(new MultiSet())
    expect(reader.isEmpty()).toBe(false)
  })

  test(`drain returns all messages`, () => {
    writer.sendData(new MultiSet([[1, 1]]))
    writer.sendData(new MultiSet([[2, 1]]))

    const messages = reader.drain()
    expect(messages).toHaveLength(2)
    expect(messages[0]).toBeInstanceOf(MultiSet)
    expect(messages[1]).toBeInstanceOf(MultiSet)
    expect(reader.isEmpty()).toBe(true)
  })

  test(`multiple readers receive the same data`, () => {
    const reader2 = writer.newReader()

    writer.sendData(new MultiSet([[1, 1]]))
    writer.sendData(new MultiSet([[2, 1]]))

    const messages1 = reader.drain()
    const messages2 = reader2.drain()

    expect(messages1).toHaveLength(2)
    expect(messages2).toHaveLength(2)
    expect(messages1[0].getInner()).toEqual([[1, 1]])
    expect(messages2[0].getInner()).toEqual([[1, 1]])
    expect(messages1[1].getInner()).toEqual([[2, 1]])
    expect(messages2[1].getInner()).toEqual([[2, 1]])
  })

  test(`drain empties the queue`, () => {
    writer.sendData(new MultiSet([[1, 1]]))
    writer.sendData(new MultiSet([[2, 1]]))

    expect(reader.isEmpty()).toBe(false)
    reader.drain()
    expect(reader.isEmpty()).toBe(true)
  })
})

describe(`D2`, () => {
  test(`runWithPendingWork drains pending input after an explicit pending check`, () => {
    const graph = new D2()
    const input = graph.newInput<number>()
    const messages: Array<MultiSet<number>> = []

    input.pipe(output((message) => messages.push(message)))
    graph.finalize()

    input.sendData(new MultiSet([[1, 1]]))

    expect(graph.pendingWork()).toBe(true)
    graph.runWithPendingWork()

    expect(graph.pendingWork()).toBe(false)
    expect(messages).toEqual([new MultiSet([[1, 1]])])
  })
})
