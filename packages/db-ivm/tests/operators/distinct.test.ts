import { describe, expect, test } from "vitest"
import { D2 } from "../../src/d2.js"
import { MultiSet } from "../../src/multiset.js"
import { distinct } from "../../src/operators/distinct.js"
import { output } from "../../src/operators/output.js"
import { MessageTracker, assertResults } from "../test-utils.js"

describe(`Operators`, () => {
  describe(`Efficient distinct operation`, () => {
    testDistinct()
  })
})

function testDistinct() {
  test(`basic distinct operation`, () => {
    const graph = new D2()
    const input = graph.newInput<[number, string]>()
    const messages: Array<MultiSet<[number, string]>> = []

    input.pipe(
      distinct(),
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(
      new MultiSet([
        [[1, `a`], 2],
        [[2, `b`], 1],
        [[2, `c`], 2],
      ])
    )
    graph.run()

    const data = messages.map((m) => m.getInner())

    expect(data).toEqual([
      [
        [[1, `a`], 1],
        [[2, `b`], 1],
        [[2, `c`], 1],
      ],
    ])
  })

  test(`distinct by certain property`, () => {
    const graph = new D2()
    const input = graph.newInput<[number, { name: string; country: string }]>()
    const messages: Array<
      MultiSet<[number, { name: string; country: string }]>
    > = []

    input.pipe(
      distinct(([_, value]) => value.country),
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(
      new MultiSet([
        [[1, { name: `Valter`, country: `Portugal` }], 1],
        [[2, { name: `Sam`, country: `UK` }], 1],
        [[2, { name: `Kevin`, country: `Belgium` }], 1],
        [[3, { name: `Garry`, country: `UK` }], 1],
        [[4, { name: `Kyle`, country: `USA` }], 1],
      ])
    )

    graph.run()

    const data = messages.map((m) => m.getInner())[0]
    const countries = data
      .map(([[_, value], multiplicity]) => [value.country, multiplicity])
      .sort()

    expect(countries).toEqual(
      [
        [`Belgium`, 1],
        [`Portugal`, 1],
        [`UK`, 1],
        [`USA`, 1],
      ].sort()
    )
  })

  test(`distinct with updates`, () => {
    const graph = new D2()
    const input = graph.newInput<[number, string]>()
    const tracker = new MessageTracker<[number, string]>()

    input.pipe(
      distinct(),
      output((message) => {
        tracker.addMessage(message)
      })
    )

    graph.finalize()

    // Initial batch
    input.sendData(
      new MultiSet([
        [[1, `a`], 1],
        [[1, `b`], 1],
        [[1, `a`], 1], // Duplicate, should only result in 1
      ])
    )
    graph.run()

    const initialResult = tracker.getResult()
    assertResults(
      `distinct with updates - initial`,
      initialResult,
      [
        [1, `a`],
        [1, `b`],
      ], // Should have both distinct values
      4 // Max expected messages
    )

    tracker.reset()

    // Second batch - remove some, add new
    input.sendData(
      new MultiSet([
        [[1, `b`], -1], // Remove 'b'
        [[1, `c`], 2], // Add 'c' (multiplicity should be capped at 1)
        [[1, `a`], -1], // Remove 'a'
      ])
    )
    graph.run()

    const secondResult = tracker.getResult()
    assertResults(
      `distinct with updates - second batch`,
      secondResult,
      [[1, `c`]], // Should only have 'c' remaining
      4 // Max expected messages
    )

    tracker.reset()

    // Third batch - remove remaining
    input.sendData(new MultiSet([[[1, `c`], -2]]))
    graph.run()

    const thirdResult = tracker.getResult()
    assertResults(
      `distinct with updates - third batch`,
      thirdResult,
      [], // Should have no remaining distinct values
      2 // Max expected messages
    )
  })

  test(`distinct with multiple batches of same key`, () => {
    const graph = new D2()
    const input = graph.newInput<[string, number]>()
    const messages: Array<MultiSet<[string, number]>> = []

    input.pipe(
      distinct(),
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(
      new MultiSet([
        [[`key1`, 1], 2],
        [[`key1`, 2], 3],
        [[`key2`, 1], 1],
      ])
    )
    graph.run()

    const data = messages.map((m) => m.getInner())

    expect(data).toEqual([
      [
        [[`key1`, 1], 1],
        [[`key1`, 2], 1],
        [[`key2`, 1], 1],
      ],
    ])
  })

  test(`distinct with multiple batches of same key that cancel out`, () => {
    const graph = new D2()
    const input = graph.newInput<[string, number]>()
    const tracker = new MessageTracker<[string, number]>()

    input.pipe(
      distinct(),
      output((message) => {
        tracker.addMessage(message)
      })
    )

    graph.finalize()

    input.sendData(
      new MultiSet([
        [[`key1`, 1], 2], // Add ['key1', 1] with multiplicity 2 -> should become 1 (distinct)
        [[`key1`, 2], 2], // Add ['key1', 2] with multiplicity 2 -> should become 1 (distinct)
        [[`key1`, 2], 1], // Add more ['key1', 2] with multiplicity 1 -> total 3, still 1 in distinct
        [[`key2`, 1], 1], // Add ['key2', 1] with multiplicity 1 -> should become 1 (distinct)
        [[`key1`, 2], -3], // Remove all ['key1', 2] (total was 3) -> should be removed from distinct
        [[`key2`, 1], 1], // Add more ['key2', 1] -> still 1 in distinct
      ])
    )
    graph.run()

    const result = tracker.getResult()
    assertResults(
      `distinct with multiple batches that cancel out`,
      result,
      [
        [`key1`, 1], // Should remain (multiplicity 2 -> 1 in distinct)
        [`key2`, 1], // Should remain (multiplicity 2 -> 1 in distinct)
      ],
      6 // Max expected messages (generous upper bound)
    )
  })
}
