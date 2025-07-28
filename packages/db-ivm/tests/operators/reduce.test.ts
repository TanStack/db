import { describe, expect, test } from "vitest"
import { D2 } from "../../src/d2.js"
import { MultiSet } from "../../src/multiset.js"
import { reduce } from "../../src/operators/reduce.js"
import { output } from "../../src/operators/output.js"
import {
  KeyedMessageTracker,
  assertKeyedResults,
  assertOnlyKeysAffected,
} from "../test-utils.js"

describe(`Operators`, () => {
  describe(`Reduce operation`, () => {
    test(`basic reduce operation`, () => {
      const graph = new D2()
      const input = graph.newInput<[string, number]>()
      const tracker = new KeyedMessageTracker<string, number>()

      input.pipe(
        reduce((vals) => {
          let sum = 0
          for (const [val, diff] of vals) {
            sum += val * diff
          }
          return [[sum, 1]]
        }),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      input.sendData(
        new MultiSet([
          [[`a`, 1], 2],
          [[`a`, 2], 1],
          [[`a`, 3], 1],
          [[`b`, 4], 1],
        ])
      )
      input.sendData(new MultiSet([[[`b`, 5], 1]]))
      graph.run()

      const result = tracker.getResult()

      // Assert only keys 'a' and 'b' are affected
      assertOnlyKeysAffected(`basic reduce operation`, result.messages, [
        `a`,
        `b`,
      ])

      // Assert the final materialized results are correct
      assertKeyedResults(
        `basic reduce operation`,
        result,
        [
          [`a`, 7], // 1*2 + 2*1 + 3*1 = 7
          [`b`, 9], // 4*1 + 5*1 = 9
        ],
        4 // Expected message count
      )
    })

    test(`reduce with negative multiplicities`, () => {
      const graph = new D2()
      const input = graph.newInput<[string, number]>()
      const tracker = new KeyedMessageTracker<string, number>()

      input.pipe(
        reduce((vals) => {
          let sum = 0
          for (const [val, diff] of vals) {
            sum += val * diff
          }
          return [[sum, 1]]
        }),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      input.sendData(
        new MultiSet([
          [[`a`, 1], -1],
          [[`a`, 2], 2],
          [[`b`, 3], -2],
        ])
      )
      graph.run()

      const result = tracker.getResult()

      // Assert only keys 'a' and 'b' are affected
      assertOnlyKeysAffected(
        `reduce with negative multiplicities`,
        result.messages,
        [`a`, `b`]
      )

      // Assert the final materialized results are correct
      assertKeyedResults(
        `reduce with negative multiplicities`,
        result,
        [
          [`a`, 3], // 1*(-1) + 2*2 = 3
          [`b`, -6], // 3*(-2) = -6
        ],
        4 // Expected message count
      )
    })

    test(`multiple incremental updates to same key`, () => {
      const graph = new D2()
      const input = graph.newInput<[string, number]>()
      const tracker = new KeyedMessageTracker<string, number>()

      input.pipe(
        reduce((vals) => {
          let sum = 0
          for (const [val, diff] of vals) {
            sum += val * diff
          }
          return [[sum, 1]]
        }),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // First update: a=1, b=2
      input.sendData(
        new MultiSet([
          [[`a`, 1], 1],
          [[`b`, 2], 1],
        ])
      )
      graph.run()

      const firstResult = tracker.getResult()
      assertOnlyKeysAffected(`reduce first update`, firstResult.messages, [
        `a`,
        `b`,
      ])
      assertKeyedResults(
        `reduce first update`,
        firstResult,
        [
          [`a`, 1],
          [`b`, 2],
        ],
        4 // Expected message count
      )

      tracker.reset()

      // Second update: add more to a, modify b
      input.sendData(
        new MultiSet([
          [[`a`, 3], 1],
          [[`b`, 4], 1],
        ])
      )
      graph.run()

      const secondResult = tracker.getResult()
      assertOnlyKeysAffected(`reduce second update`, secondResult.messages, [
        `a`,
        `b`,
      ])
      assertKeyedResults(
        `reduce second update`,
        secondResult,
        [
          [`a`, 4], // 1+3
          [`b`, 6], // 2+4
        ],
        6 // Expected message count (old removed, new added for both keys)
      )

      tracker.reset()

      // Third update: remove some from a only
      input.sendData(new MultiSet([[[`a`, 1], -1]]))
      graph.run()

      const thirdResult = tracker.getResult()
      // Only key 'a' should be affected, not 'b'
      assertOnlyKeysAffected(`reduce third update`, thirdResult.messages, [`a`])
      assertKeyedResults(
        `reduce third update`,
        thirdResult,
        [
          [`a`, 3], // 4-1=3
        ],
        3 // Expected message count (old removed, new added for key a)
      )
    })

    test(`updates that cancel out completely`, () => {
      const graph = new D2()
      const input = graph.newInput<[string, number]>()
      const tracker = new KeyedMessageTracker<string, number>()

      input.pipe(
        reduce((vals) => {
          let sum = 0
          for (const [val, diff] of vals) {
            sum += val * diff
          }
          return [[sum, 1]]
        }),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // First update: add values
      input.sendData(
        new MultiSet([
          [[`a`, 5], 1],
          [[`a`, 3], 1],
          [[`b`, 10], 1],
        ])
      )
      graph.run()

      // Second update: cancel out all values for 'a'
      input.sendData(
        new MultiSet([
          [[`a`, 5], -1],
          [[`a`, 3], -1],
        ])
      )
      graph.run()

      const result = tracker.getResult()

      // Assert only keys 'a' and 'b' are affected
      assertOnlyKeysAffected(
        `updates that cancel out completely`,
        result.messages,
        [`a`, `b`]
      )

      // Assert the final materialized results are correct
      assertKeyedResults(
        `updates that cancel out completely`,
        result,
        [
          [`a`, 0], // 5+3-5-3 = 0
          [`b`, 10], // 10 (unchanged)
        ],
        6 // Expected message count
      )
    })

    test(`mixed positive and negative updates`, () => {
      const graph = new D2()
      const input = graph.newInput<[string, number]>()
      const tracker = new KeyedMessageTracker<string, number>()

      input.pipe(
        reduce((vals) => {
          let sum = 0
          for (const [val, diff] of vals) {
            sum += val * diff
          }
          return [[sum, 1]]
        }),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // First update: establish initial state
      input.sendData(
        new MultiSet([
          [[`a`, 10], 1],
          [[`a`, 5], 2],
          [[`b`, 20], 1],
        ])
      )
      graph.run()

      // Second update: mix of adds and removes
      input.sendData(
        new MultiSet([
          [[`a`, 10], -1], // Remove one 10
          [[`a`, 2], 1], // Add a 2
          [[`b`, 20], -1], // Remove the 20
          [[`b`, 15], 1], // Add a 15
          [[`c`, 100], 1], // Add new key
        ])
      )
      graph.run()

      const result = tracker.getResult()

      // Assert only keys 'a', 'b', and 'c' are affected
      assertOnlyKeysAffected(
        `mixed positive and negative updates`,
        result.messages,
        [`a`, `b`, `c`]
      )

      // Assert the final materialized results are correct
      assertKeyedResults(
        `mixed positive and negative updates`,
        result,
        [
          [`a`, 12], // 10+5+5-10+2 = 12
          [`b`, 15], // 20-20+15 = 15
          [`c`, 100], // 100
        ],
        8 // Expected message count
      )
    })

    test(`complex aggregation with multiple updates`, () => {
      const graph = new D2()
      const input = graph.newInput<[string, { value: number; count: number }]>()
      const tracker = new KeyedMessageTracker<
        string,
        { avg: number; total: number }
      >()

      input.pipe(
        reduce((vals) => {
          let totalSum = 0
          let totalCount = 0
          for (const [val, diff] of vals) {
            totalSum += val.value * val.count * diff
            totalCount += val.count * diff
          }
          const avg = totalCount > 0 ? totalSum / totalCount : 0
          return [[{ avg, total: totalSum }, 1]]
        }),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // First batch: group 'a' has values
      input.sendData(
        new MultiSet([
          [[`a`, { value: 10, count: 2 }], 1], // 2 values of 10
          [[`a`, { value: 20, count: 1 }], 1], // 1 value of 20
        ])
      )
      graph.run()

      // Second batch: add more to 'a' and start 'b'
      input.sendData(
        new MultiSet([
          [[`a`, { value: 30, count: 1 }], 1], // 1 value of 30
          [[`b`, { value: 50, count: 3 }], 1], // 3 values of 50
        ])
      )
      graph.run()

      // Third batch: remove some from 'a'
      input.sendData(
        new MultiSet([
          [[`a`, { value: 10, count: 2 }], -1], // Remove the 2 values of 10
        ])
      )
      graph.run()

      const result = tracker.getResult()

      // Assert only keys 'a' and 'b' are affected
      assertOnlyKeysAffected(
        `complex aggregation with multiple updates`,
        result.messages,
        [`a`, `b`]
      )

      // Assert the final materialized results are correct
      assertKeyedResults(
        `complex aggregation with multiple updates`,
        result,
        [
          [`a`, { avg: 25, total: 50 }], // Final: (20*1+30*1)/(1+1) = 50/2 = 25
          [`b`, { avg: 50, total: 150 }], // Final: 50*3 = 150
        ],
        6 // Expected message count
      )
    })

    test(`updates with zero-multiplicity results`, () => {
      const graph = new D2()
      const input = graph.newInput<[string, number]>()
      const tracker = new KeyedMessageTracker<string, number>()

      input.pipe(
        reduce((vals) => {
          let sum = 0
          for (const [val, diff] of vals) {
            sum += val * diff
          }
          // Only return non-zero sums
          return sum !== 0 ? [[sum, 1]] : []
        }),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // First update: establish values
      input.sendData(
        new MultiSet([
          [[`a`, 5], 1],
          [[`a`, -3], 1],
          [[`b`, 10], 1],
        ])
      )
      graph.run()

      // Second update: make 'a' sum to zero
      input.sendData(new MultiSet([[[`a`, -2], 1]]))
      graph.run()

      // Third update: add back to 'a'
      input.sendData(new MultiSet([[[`a`, 7], 1]]))
      graph.run()

      const result = tracker.getResult()

      // Assert only keys 'a' and 'b' are affected
      assertOnlyKeysAffected(
        `updates with zero-multiplicity results`,
        result.messages,
        [`a`, `b`]
      )

      // Assert the final materialized results are correct
      assertKeyedResults(
        `updates with zero-multiplicity results`,
        result,
        [
          [`a`, 7], // Final: 5-3-2+7 = 7
          [`b`, 10], // Final: 10 (unchanged)
        ],
        5 // Expected message count
      )
    })

    test(`reduce incremental updates - only affected keys produce messages`, () => {
      const graph = new D2()
      const input = graph.newInput<[string, number]>()
      const tracker = new KeyedMessageTracker<string, number>()

      input.pipe(
        reduce((vals) => {
          let sum = 0
          for (const [val, diff] of vals) {
            sum += val * diff
          }
          return [[sum, 1]]
        }),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // Initial data: establish state for keys 'x', 'y', 'z'
      input.sendData(
        new MultiSet([
          [[`x`, 10], 1],
          [[`x`, 20], 1],
          [[`y`, 5], 1],
          [[`y`, 15], 1],
          [[`y`, 25], 1],
          [[`z`, 100], 1],
        ])
      )
      graph.run()

      // Reset tracker to focus on incremental updates
      tracker.reset()

      // Incremental update: only affect keys 'x' and 'z'
      input.sendData(
        new MultiSet([
          [[`x`, 30], 1], // Add to 'x' (30 -> 60)
          [[`z`, 100], -1], // Remove from 'z' (100 -> 0)
        ])
      )
      graph.run()

      const result = tracker.getResult()

      // Assert only keys 'x' and 'z' are affected (NOT 'y')
      assertOnlyKeysAffected(`reduce incremental updates`, result.messages, [
        `x`,
        `z`,
      ])

      // Assert the final materialized results are correct
      assertKeyedResults(
        `reduce incremental updates`,
        result,
        [
          [`x`, 60], // Sum increased from 30 to 60
          [`z`, 0], // Sum decreased from 100 to 0
        ],
        4 // Expected message count: remove old 'x', add new 'x', remove old 'z', add new 'z'
      )
    })

    test(`reduce with object identity - may produce messages for identical content`, () => {
      const graph = new D2()
      const input = graph.newInput<[string, { id: number; value: number }]>()
      const tracker = new KeyedMessageTracker<string, { result: number }>()

      input.pipe(
        reduce((vals) => {
          let sum = 0
          for (const [val, diff] of vals) {
            sum += val.value * diff
          }
          // Return a new object each time - but hash comparison handles this efficiently
          return [[{ result: sum }, 1]]
        }),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // Initial data: establish state for keys 'a', 'b', 'c'
      input.sendData(
        new MultiSet([
          [[`a`, { id: 1, value: 10 }], 1],
          [[`a`, { id: 2, value: 20 }], 1],
          [[`b`, { id: 3, value: 100 }], 1],
          [[`c`, { id: 4, value: 5 }], 1],
          [[`c`, { id: 5, value: 15 }], 1],
        ])
      )
      graph.run()

      // Reset tracker to focus on incremental updates
      tracker.reset()

      // Update that should NOT change the result value for key 'a'
      input.sendData(
        new MultiSet([
          [[`a`, { id: 1, value: 10 }], -1], // Remove 10
          [[`a`, { id: 6, value: 10 }], 1], // Add 10 (same value, different object)
          [[`b`, { id: 3, value: 100 }], -1], // Remove from 'b' (100 -> 0)
        ])
      )
      graph.run()

      const result = tracker.getResult()

      // With object identity: 'a' produces messages even though content is identical
      // This demonstrates the object identity issue, but keysTodo should still limit processing
      const aMessages = result.messages.filter(
        ([[key, _value], _mult]) => key === `a`
      )
      expect(aMessages.length).toBe(2) // Object identity causes 2 messages (remove + add)

      // But the messages cancel out due to identical content
      assertKeyedResults(
        `reduce with object identity`,
        result,
        [
          [`b`, { result: 0 }], // Changed from 100 to 0
        ],
        4 // With object identity: 4 messages total (2 for 'a', 2 for 'b')
      )
    })
  })
})
