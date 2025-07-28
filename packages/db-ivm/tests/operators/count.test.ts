import { describe, test } from "vitest"
import { D2 } from "../../src/d2.js"
import { MultiSet } from "../../src/multiset.js"
import { count } from "../../src/operators/count.js"
import { output } from "../../src/operators/output.js"
import {
  KeyedMessageTracker,
  assertKeyedResults,
  assertOnlyKeysAffected,
} from "../test-utils.js"

describe(`Operators`, () => {
  describe(`Count operation`, () => {
    testCount()
  })
})

function testCount() {
  test(`basic count operation`, () => {
    const graph = new D2()
    const input = graph.newInput<[number, string]>()
    const tracker = new KeyedMessageTracker<number, number>()

    input.pipe(
      count(),
      output((message) => {
        tracker.addMessage(message)
      })
    )

    graph.finalize()

    input.sendData(
      new MultiSet([
        [[1, `a`], 2],
        [[2, `b`], 1],
        [[2, `c`], 1],
        [[2, `d`], 1],
        [[3, `x`], 1],
        [[3, `y`], -1],
      ])
    )
    input.sendData(new MultiSet([[[3, `z`], 1]]))
    graph.run()

    const result = tracker.getResult()

    // Assert only keys that have values are affected
    assertOnlyKeysAffected(`basic count operation`, result.messages, [1, 2, 3])

    // Assert the final materialized results are correct
    assertKeyedResults(
      `basic count operation`,
      result,
      [
        [1, 2], // 2 values for key 1
        [2, 3], // 3 values for key 2
        [3, 1], // 1 value for key 3 (1 + (-1) + 1 = 1)
      ],
      6 // Expected message count
    )
  })

  test(`count with all negative multiplicities`, () => {
    const graph = new D2()
    const input = graph.newInput<[number, string]>()
    const tracker = new KeyedMessageTracker<number, number>()

    input.pipe(
      count(),
      output((message) => {
        tracker.addMessage(message)
      })
    )

    graph.finalize()

    input.sendData(
      new MultiSet([
        [[1, `a`], -1],
        [[1, `b`], -2],
      ])
    )
    graph.run()

    const result = tracker.getResult()

    // Assert only key 1 is affected
    assertOnlyKeysAffected(
      `count with all negative multiplicities`,
      result.messages,
      [1]
    )

    // Assert the final materialized results are correct
    assertKeyedResults(
      `count with all negative multiplicities`,
      result,
      [
        [1, -3], // -1 + (-2) = -3
      ],
      2 // Expected message count
    )
  })

  test(`count with multiple batches`, () => {
    const graph = new D2()
    const input = graph.newInput<[string, string]>()
    const tracker = new KeyedMessageTracker<string, number>()

    input.pipe(
      count(),
      output((message) => {
        tracker.addMessage(message)
      })
    )

    graph.finalize()

    input.sendData(
      new MultiSet([
        [[`one`, `a`], 1],
        [[`one`, `b`], 1],
      ])
    )
    graph.run()

    input.sendData(
      new MultiSet([
        [[`one`, `c`], 1],
        [[`two`, `a`], 1],
      ])
    )
    graph.run()

    const result = tracker.getResult()

    // Assert only keys 'one' and 'two' are affected
    assertOnlyKeysAffected(`count with multiple batches`, result.messages, [
      `one`,
      `two`,
    ])

    // Assert the final materialized results are correct
    assertKeyedResults(
      `count with multiple batches`,
      result,
      [
        [`one`, 3], // 2 + 1 = 3
        [`two`, 1], // 1
      ],
      5 // Expected message count
    )
  })

  test(`count incremental updates - only affected keys produce messages`, () => {
    const graph = new D2()
    const input = graph.newInput<[string, string]>()
    const tracker = new KeyedMessageTracker<string, number>()

    input.pipe(
      count(),
      output((message) => {
        tracker.addMessage(message)
      })
    )

    graph.finalize()

    // Initial data: establish state for keys 'a', 'b', 'c'
    input.sendData(
      new MultiSet([
        [[`a`, `item1`], 1],
        [[`a`, `item2`], 1],
        [[`b`, `item1`], 1],
        [[`b`, `item2`], 1],
        [[`b`, `item3`], 1],
        [[`c`, `item1`], 1],
      ])
    )
    graph.run()

    // Reset tracker to focus on incremental updates
    tracker.reset()

    // Incremental update: only affect keys 'a' and 'c'
    input.sendData(
      new MultiSet([
        [[`a`, `item3`], 1], // Add to 'a' (2 -> 3)
        [[`c`, `item1`], -1], // Remove from 'c' (1 -> 0)
      ])
    )
    graph.run()

    const result = tracker.getResult()

    // Assert only keys 'a' and 'c' are affected (NOT 'b')
    assertOnlyKeysAffected(`count incremental updates`, result.messages, [
      `a`,
      `c`,
    ])

    // Assert the final materialized results are correct
    assertKeyedResults(
      `count incremental updates`,
      result,
      [
        [`a`, 3], // Count increased from 2 to 3
        [`c`, 0], // Count decreased from 1 to 0
      ],
      4 // Expected message count: remove old 'a', add new 'a', remove old 'c', add new 'c'
    )
  })
}
