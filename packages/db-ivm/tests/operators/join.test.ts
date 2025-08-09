import { describe, expect, test } from "vitest"
import { D2 } from "../../src/d2.js"
import { MultiSet } from "../../src/multiset.js"
import { join } from "../../src/operators/join.js"
import { output } from "../../src/operators/output.js"
import {
  KeyedMessageTracker,
  assertKeyedResults,
  assertOnlyKeysAffected,
} from "../test-utils.js"

describe(`Operators`, () => {
  describe(`Join operation`, () => {
    testJoin()
  })
})

function testJoin() {
  test(`basic join operation`, () => {
    const graph = new D2()
    const inputA = graph.newInput<[number, string]>()
    const inputB = graph.newInput<[number, string]>()
    const tracker = new KeyedMessageTracker<number, [string, string]>()

    inputA.pipe(
      join(inputB),
      output((message) => {
        tracker.addMessage(message as MultiSet<[number, [string, string]]>)
      })
    )

    graph.finalize()

    inputA.sendData(
      new MultiSet([
        [[1, `a`], 1],
        [[2, `b`], 1],
      ])
    )

    inputB.sendData(
      new MultiSet([
        [[1, `x`], 1],
        [[2, `y`], 1],
        [[3, `z`], 1], // key 3 only exists in B, so no join output expected
      ])
    )

    graph.run()

    const result = tracker.getResult()

    // Assert only keys that can actually join (1, 2) are affected, not key 3
    assertOnlyKeysAffected(`basic join operation`, result.messages, [1, 2])

    // Assert the final materialized results are correct
    assertKeyedResults(
      `basic join operation`,
      result,
      [
        [1, [`a`, `x`]],
        [2, [`b`, `y`]],
      ],
      4 // Expected message count
    )
  })

  test(`join with late arriving data`, () => {
    const graph = new D2()
    const inputA = graph.newInput<[number, string]>()
    const inputB = graph.newInput<[number, string]>()
    const tracker = new KeyedMessageTracker<number, [string, string]>()

    inputA.pipe(
      join(inputB),
      output((message) => {
        tracker.addMessage(message as MultiSet<[number, [string, string]]>)
      })
    )

    graph.finalize()

    inputA.sendData(
      new MultiSet([
        [[1, `a`], 1],
        [[2, `b`], 1],
      ])
    )

    graph.run()

    inputB.sendData(
      new MultiSet([
        [[1, `x`], 1],
        [[2, `y`], 1],
      ])
    )

    graph.run()

    const result = tracker.getResult()

    // Assert only expected keys (1, 2) are affected in the join output
    assertOnlyKeysAffected(
      `join with late arriving data`,
      result.messages,
      [1, 2]
    )

    // Assert the final materialized results are correct
    assertKeyedResults(
      `join with late arriving data`,
      result,
      [
        [1, [`a`, `x`]],
        [2, [`b`, `y`]],
      ],
      4 // Expected message count
    )
  })

  test(`join with negative multiplicities`, () => {
    const graph = new D2()
    const inputA = graph.newInput<[number, string]>()
    const inputB = graph.newInput<[number, string]>()
    const tracker = new KeyedMessageTracker<number, [string, string]>()

    inputA.pipe(
      join(inputB),
      output((message) => {
        tracker.addMessage(message as MultiSet<[number, [string, string]]>)
      })
    )

    graph.finalize()

    inputA.sendData(
      new MultiSet([
        [[1, `a`], 1],
        [[2, `b`], -1], // Negative multiplicity
      ])
    )
    inputB.sendData(
      new MultiSet([
        [[1, `x`], 1],
        [[2, `y`], 1],
      ])
    )

    graph.run()

    const result = tracker.getResult()

    // Assert only keys that participate in join (1, 2) are affected
    assertOnlyKeysAffected(
      `join with negative multiplicities`,
      result.messages,
      [1, 2]
    )

    // Verify that key 2 produces a message but with negative multiplicity
    const key2Messages = result.messages.filter(
      ([[key, _value], _mult]) => key === 2
    )
    expect(key2Messages.length).toBeGreaterThan(0) // Key 2 should produce messages
    expect(key2Messages[0][1]).toBeLessThan(0) // But with negative multiplicity

    // Assert the final materialized results (only positive multiplicities remain)
    assertKeyedResults(
      `join with negative multiplicities`,
      result,
      [
        [1, [`a`, `x`]], // Only key 1 should remain in final results
      ],
      4 // Expected message count
    )
  })

  test(`join with multiple batches sent before running - regression test for data loss bug`, () => {
    const graph = new D2()
    const inputA = graph.newInput<[string, string]>()
    const inputB = graph.newInput<[string, string]>()
    const tracker = new KeyedMessageTracker<string, [string, string]>()

    inputA.pipe(
      join(inputB),
      output((message) => {
        tracker.addMessage(message as MultiSet<[string, [string, string]]>)
      })
    )

    graph.finalize()

    // Send multiple batches to inputA before running
    inputA.sendData(
      new MultiSet([
        [[`key1`, `batch1_a`], 1],
        [[`key2`, `batch1_b`], 1],
      ])
    )

    inputA.sendData(
      new MultiSet([
        [[`key3`, `batch2_a`], 1],
        [[`key4`, `batch2_b`], 1],
      ])
    )

    inputA.sendData(new MultiSet([[[`key5`, `batch3_a`], 1]]))

    // Send corresponding data to inputB
    inputB.sendData(
      new MultiSet([
        [[`key1`, `x1`], 1],
        [[`key2`, `x2`], 1],
        [[`key3`, `x3`], 1],
        [[`key4`, `x4`], 1],
        [[`key5`, `x5`], 1],
      ])
    )

    // Run the graph - should process all batches
    graph.run()

    const result = tracker.getResult()

    // Assert only expected keys are affected - all keys that can join
    const expectedKeys = [`key1`, `key2`, `key3`, `key4`, `key5`]
    assertOnlyKeysAffected(
      `join multiple batches`,
      result.messages,
      expectedKeys
    )

    // Assert the final materialized results are correct
    assertKeyedResults(
      `join multiple batches`,
      result,
      [
        [`key1`, [`batch1_a`, `x1`]],
        [`key2`, [`batch1_b`, `x2`]],
        [`key3`, [`batch2_a`, `x3`]],
        [`key4`, [`batch2_b`, `x4`]],
        [`key5`, [`batch3_a`, `x5`]],
      ],
      10 // Expected message count
    )
  })

  test(`join comparison: step-by-step vs batch processing should give same results`, () => {
    // Step-by-step processing
    const graph1 = new D2()
    const inputA1 = graph1.newInput<[string, string]>()
    const inputB1 = graph1.newInput<[string, string]>()
    const stepTracker = new KeyedMessageTracker<string, [string, string]>()

    inputA1.pipe(
      join(inputB1),
      output((message) => {
        stepTracker.addMessage(message as MultiSet<[string, [string, string]]>)
      })
    )

    graph1.finalize()

    // Set up inputB data first
    inputB1.sendData(
      new MultiSet([
        [[`item1`, `x1`], 1],
        [[`item2`, `x2`], 1],
        [[`item3`, `x3`], 1],
      ])
    )

    // Send and process inputA one batch at a time
    inputA1.sendData(new MultiSet([[[`item1`, `a1`], 1]]))
    graph1.run()

    inputA1.sendData(new MultiSet([[[`item2`, `a2`], 1]]))
    graph1.run()

    inputA1.sendData(new MultiSet([[[`item3`, `a3`], 1]]))
    graph1.run()

    // Batch processing
    const graph2 = new D2()
    const inputA2 = graph2.newInput<[string, string]>()
    const inputB2 = graph2.newInput<[string, string]>()
    const batchTracker = new KeyedMessageTracker<string, [string, string]>()

    inputA2.pipe(
      join(inputB2),
      output((message) => {
        batchTracker.addMessage(message as MultiSet<[string, [string, string]]>)
      })
    )

    graph2.finalize()

    // Set up inputB data
    inputB2.sendData(
      new MultiSet([
        [[`item1`, `x1`], 1],
        [[`item2`, `x2`], 1],
        [[`item3`, `x3`], 1],
      ])
    )

    // Send all inputA batches then run once
    inputA2.sendData(new MultiSet([[[`item1`, `a1`], 1]]))
    inputA2.sendData(new MultiSet([[[`item2`, `a2`], 1]]))
    inputA2.sendData(new MultiSet([[[`item3`, `a3`], 1]]))
    graph2.run()

    const stepResult = stepTracker.getResult()
    const batchResult = batchTracker.getResult()

    // Both approaches should affect exactly the same keys
    const expectedKeys = [`item1`, `item2`, `item3`]
    assertOnlyKeysAffected(
      `join step-by-step`,
      stepResult.messages,
      expectedKeys
    )
    assertOnlyKeysAffected(
      `join batch processing`,
      batchResult.messages,
      expectedKeys
    )

    // Both approaches should produce the same final materialized results
    expect(stepResult.sortedResults).toEqual(batchResult.sortedResults)

    // Both should have the expected final results
    const expectedResults: Array<[string, [string, string]]> = [
      [`item1`, [`a1`, `x1`]],
      [`item2`, [`a2`, `x2`]],
      [`item3`, [`a3`, `x3`]],
    ]

    assertKeyedResults(`join step-by-step`, stepResult, expectedResults, 6)
    assertKeyedResults(`join batch processing`, batchResult, expectedResults, 6)
  })
}
