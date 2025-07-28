import { describe, expect, it } from "vitest"
import { D2 } from "../../src/d2.js"
import { keyBy, rekey, unkey } from "../../src/operators/keying.js"
import { output } from "../../src/operators/index.js"
import { MultiSet } from "../../src/multiset.js"

interface TestItem {
  id: number
  name: string
  value: number
}

describe(`keying operators`, () => {
  it(`should key a stream by a property`, () => {
    const d2 = new D2()
    const input = d2.newInput<TestItem>()
    const messages: Array<MultiSet<TestItem>> = []

    const keyed = input.pipe(keyBy((item) => item.id))
    const outputStream = keyed.pipe(unkey())
    outputStream.pipe(output((message) => messages.push(message)))

    input.sendData(new MultiSet([[{ id: 1, name: `a`, value: 10 }, 1]]))
    input.sendData(new MultiSet([[{ id: 2, name: `b`, value: 20 }, 1]]))
    d2.finalize()
    d2.run()

    expect(messages).toEqual([
      new MultiSet([[{ id: 1, name: `a`, value: 10 }, 1]]),
      new MultiSet([[{ id: 2, name: `b`, value: 20 }, 1]]),
    ])
  })

  it(`should rekey a stream with new keys`, () => {
    const d2 = new D2()
    const input = d2.newInput<TestItem>()
    const messages: Array<MultiSet<TestItem>> = []

    // First key by id
    const keyed = input.pipe(keyBy((item) => item.id))
    // Then rekey by name
    const rekeyed = keyed.pipe(rekey((item) => item.name))
    const outputStream = rekeyed.pipe(unkey())
    outputStream.pipe(output((message) => messages.push(message)))

    input.sendData(new MultiSet([[{ id: 1, name: `a`, value: 10 }, 1]]))
    input.sendData(new MultiSet([[{ id: 2, name: `b`, value: 20 }, 1]]))
    d2.finalize()
    d2.run()

    expect(messages).toEqual([
      new MultiSet([[{ id: 1, name: `a`, value: 10 }, 1]]),
      new MultiSet([[{ id: 2, name: `b`, value: 20 }, 1]]),
    ])
  })

  it(`should handle multiple updates to the same key`, () => {
    const d2 = new D2()
    const input = d2.newInput<TestItem>()
    const messages: Array<MultiSet<TestItem>> = []

    const keyed = input.pipe(keyBy((item) => item.id))
    const outputStream = keyed.pipe(unkey())
    outputStream.pipe(output((message) => messages.push(message)))

    input.sendData(new MultiSet([[{ id: 1, name: `a`, value: 10 }, 1]]))
    input.sendData(new MultiSet([[{ id: 1, name: `a`, value: 20 }, 1]]))
    d2.finalize()
    d2.run()

    expect(messages).toEqual([
      new MultiSet([[{ id: 1, name: `a`, value: 10 }, 1]]),
      new MultiSet([[{ id: 1, name: `a`, value: 20 }, 1]]),
    ])
  })
})
