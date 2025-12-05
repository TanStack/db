import { beforeAll, describe, expect, it } from "vitest"
import { D2 } from "../../src/d2.js"
import { MultiSet } from "../../src/multiset.js"
import { topKWithFractionalIndex } from "../../src/operators/topKWithFractionalIndex.js"
import {
  loadBTree,
  topKWithFractionalIndexBTree,
} from "../../src/operators/topKWithFractionalIndexBTree.js"
import { output } from "../../src/operators/index.js"
import {
  MessageTracker,
  assertOnlyKeysAffected,
  compareFractionalIndex,
} from "../test-utils.js"

// Helper function to check if indices are in lexicographic order
function checkLexicographicOrder(results: Array<any>) {
  // Extract values and their indices
  const valuesWithIndices = results.map(([[_, [value, index]]]) => ({
    value,
    index,
  }))

  // Sort by value using the same comparator as in the test
  const sortedByValue = [...valuesWithIndices].sort((a, b) =>
    a.value.value < b.value.value ? -1 : 1
  )

  // Check that indices are in the same order as the sorted values
  for (let i = 0; i < sortedByValue.length - 1; i++) {
    const currentIndex = sortedByValue[i]!.index
    const nextIndex = sortedByValue[i + 1]!.index

    // Indices should be in lexicographic order
    if (!(currentIndex < nextIndex)) {
      return false
    }
  }

  return true
}

// Helper function to verify the expected order of elements
function verifyOrder(results: Array<any>, expectedOrder: Array<string>) {
  // Extract values in the order they appear in the results
  const actualOrder = results.map(([[_, [value, __]]]) => value.value)

  // Sort both arrays to ensure consistent comparison
  const sortedActual = [...actualOrder].sort()
  const sortedExpected = [...expectedOrder].sort()

  // First check that we have the same elements
  expect(sortedActual).toEqual(sortedExpected)

  // Now check that the indices result in the correct order
  const valueToIndex = new Map()
  for (const [[_key, [value, index]]] of results) {
    valueToIndex.set(value.value, index)
  }

  // Sort the values by their indices
  const sortedByIndex = [...valueToIndex.entries()]
    .sort((a, b) => (a[1] < b[1] ? -1 : 1))
    .map(([value]) => value)

  // The order should match the expected order
  expect(sortedByIndex).toEqual(expectedOrder)
}

beforeAll(async () => {
  await loadBTree()
})

describe(`Operators`, () => {
  describe.each([
    [`with array`, { topK: topKWithFractionalIndex }],
    [`with B+ tree`, { topK: topKWithFractionalIndexBTree }],
  ])(`TopKWithFractionalIndex operator %s`, (_name, { topK }) => {
    it(`should assign fractional indices to sorted elements`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      input.pipe(
        topK((a, b) => a.value.localeCompare(b.value)),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // Initial data - a, b, c, d, e
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1],
          [[2, { id: 2, value: `b` }], 1],
          [[3, { id: 3, value: `c` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[5, { id: 5, value: `e` }], 1],
        ])
      )
      graph.run()

      // Initial result should have all elements with fractional indices
      const initialResult = tracker.getResult()
      expect(initialResult.sortedResults.length).toBe(5) // Should have all 5 elements
      expect(initialResult.messageCount).toBeLessThanOrEqual(6) // Should be efficient

      // Check that indices are in lexicographic order by examining raw messages
      const initialMessages = initialResult.messages
      expect(
        checkLexicographicOrder(
          initialMessages.map(([item, mult]) => [item, mult])
        )
      ).toBe(true)

      tracker.reset()

      // Now let's move 'c' to the beginning by changing its value
      input.sendData(
        new MultiSet([
          [[3, { id: 3, value: `c` }], -1], // Remove the old value
          [[3, { id: 3, value: `a-` }], 1], // This should now be first
        ])
      )
      graph.run()

      // Check the incremental changes
      const updateResult = tracker.getResult()
      // Should have reasonable incremental changes (not recomputing everything)
      expect(updateResult.messageCount).toBeLessThanOrEqual(4) // Should be incremental
      expect(updateResult.messageCount).toBeGreaterThan(0) // Should have some changes

      // Check that only the affected key (null) produces messages
      assertOnlyKeysAffected(`topKFractional update`, updateResult.messages, [
        3,
      ])

      // Check that the update messages maintain lexicographic order on their own
      if (updateResult.messages.length > 0) {
        const updateMessages = updateResult.messages.map(([item, mult]) => [
          item,
          mult,
        ])
        expect(checkLexicographicOrder(updateMessages)).toBe(true)
      }
    })

    it(`should support duplicate ordering keys`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      input.pipe(
        topK((a, b) => a.value.localeCompare(b.value)),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // Initial data - a, b, c, d, e
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1],
          [[2, { id: 2, value: `b` }], 1],
          [[3, { id: 3, value: `c` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[5, { id: 5, value: `e` }], 1],
        ])
      )
      graph.run()

      // Initial result should have all elements with fractional indices
      const initialResult = tracker.getResult()
      expect(initialResult.sortedResults.length).toBe(5) // Should have all 5 elements
      expect(
        checkLexicographicOrder(
          initialResult.messages.map(([item, mult]) => [item, mult])
        )
      ).toBe(true)

      tracker.reset()

      // Now let's add a new element with a value that is already in there
      input.sendData(new MultiSet([[[6, { id: 6, value: `c` }], 1]]))
      graph.run()

      // Check the incremental changes
      const updateResult = tracker.getResult()
      // Should have efficient incremental update
      expect(updateResult.messageCount).toBeLessThanOrEqual(2) // Should be incremental (1 addition)
      expect(updateResult.messageCount).toBeGreaterThan(0) // Should have changes

      // Check that only the affected key (null) produces messages
      assertOnlyKeysAffected(
        `topKFractional duplicate keys`,
        updateResult.messages,
        [6]
      )

      // Check that the update messages maintain lexicographic order on their own
      if (updateResult.messages.length > 0) {
        const updateMessages = updateResult.messages.map(([item, mult]) => [
          item,
          mult,
        ])
        expect(checkLexicographicOrder(updateMessages)).toBe(true)
      }

      // The total state should have more elements after adding a duplicate
      expect(updateResult.sortedResults.length).toBeGreaterThan(0) // Should have the new element
    })

    it(`should ignore duplicate values`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const allMessages: Array<any> = []

      input.pipe(
        topK((a, b) => a.value.localeCompare(b.value)),
        output((message) => {
          allMessages.push(message)
        })
      )

      graph.finalize()

      // Initial data - a, b, c, d, e
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1],
          [[2, { id: 2, value: `b` }], 1],
          [[3, { id: 3, value: `c` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[5, { id: 5, value: `e` }], 1],
        ])
      )
      graph.run()

      // Initial result should have all elements with fractional indices
      const initialResult = allMessages[0].getInner()
      expect(initialResult.length).toBe(5)

      // Now add entryForC again
      input.sendData(new MultiSet([[[3, { id: 3, value: `c` }], 1]]))
      graph.run()

      // Check that no message was emitted
      // since there were no changes to the topK
      expect(allMessages.length).toBe(1)
    })

    it(`should handle limit and offset correctly`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      input.pipe(
        topK((a, b) => a.value.localeCompare(b.value), {
          limit: 3,
          offset: 1,
        }),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // Initial data - a, b, c, d, e
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1],
          [[2, { id: 2, value: `b` }], 1],
          [[3, { id: 3, value: `c` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[5, { id: 5, value: `e` }], 1],
        ])
      )
      graph.run()

      // Initial result should be b, c, d (offset 1, limit 3)
      const initialResult = tracker.getResult()
      expect(initialResult.sortedResults.length).toBe(3) // Should have 3 elements
      expect(initialResult.messageCount).toBeLessThanOrEqual(6) // Should be efficient

      // Check that we have the correct elements (b, c, d) when sorted by fractional index
      const sortedByIndex = initialResult.sortedResults.sort((a, b) => {
        const aIndex = a[1][1] // fractional index
        const bIndex = b[1][1] // fractional index
        return aIndex < bIndex ? -1 : aIndex > bIndex ? 1 : 0
      })

      const sortedValues = sortedByIndex.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(sortedValues).toEqual([`b`, `c`, `d`]) // Should be in correct order with offset 1, limit 3

      tracker.reset()

      // Test a few incremental updates to verify limit/offset behavior

      // Add element that should be included (between c and d)
      input.sendData(
        new MultiSet([
          [[6, { id: 6, value: `c+` }], 1], // This should be between c and d
        ])
      )
      graph.run()

      const updateResult = tracker.getResult()
      // Should have efficient incremental update
      expect(updateResult.messageCount).toBeLessThanOrEqual(4) // Should be incremental
      expect(updateResult.messageCount).toBeGreaterThan(0) // Should have changes

      // Check that final results still maintain correct limit/offset behavior
      expect(updateResult.sortedResults.length).toBeLessThanOrEqual(3) // Should respect limit

      // Check that only the affected key produces messages
      // 4 is affected because it is pushed out of the topK
      // by 6 which enters the topK
      assertOnlyKeysAffected(`topK limit+offset`, updateResult.messages, [4, 6])
    })

    it(`should handle elements moving positions correctly`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      input.pipe(
        topK((a, b) => a.value.localeCompare(b.value)),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // Initial data - a, b, c, d, e
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1],
          [[2, { id: 2, value: `b` }], 1],
          [[3, { id: 3, value: `c` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[5, { id: 5, value: `e` }], 1],
        ])
      )
      graph.run()

      const initialResult = tracker.getResult()
      expect(initialResult.sortedResults.length).toBe(5) // Should have all 5 elements
      expect(initialResult.messageCount).toBeLessThanOrEqual(6) // Should be efficient

      // Check that results are in correct order initially
      const initialSortedByIndex = initialResult.sortedResults.sort((a, b) => {
        const aIndex = a[1][1] // fractional index
        const bIndex = b[1][1] // fractional index
        return aIndex < bIndex ? -1 : aIndex > bIndex ? 1 : 0
      })

      const initialSortedValues = initialSortedByIndex.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(initialSortedValues).toEqual([`a`, `b`, `c`, `d`, `e`]) // Should be in lexicographic order

      tracker.reset()

      // Now let's swap 'b' and 'd' by changing their values
      input.sendData(
        new MultiSet([
          [[2, { id: 2, value: `b` }], -1], // Remove old 'b'
          [[2, { id: 2, value: `d+` }], 1], // 'b' becomes 'd+'
          [[4, { id: 4, value: `d` }], -1], // Remove old 'd'
          [[4, { id: 4, value: `b+` }], 1], // 'd' becomes 'b+'
        ])
      )
      graph.run()

      const updateResult = tracker.getResult()
      // Should have efficient incremental update
      expect(updateResult.messageCount).toBeLessThanOrEqual(6) // Should be incremental (4 changes max)
      expect(updateResult.messageCount).toBeGreaterThan(0) // Should have changes

      // Check that only the affected key produces messages
      assertOnlyKeysAffected(
        `topK move positions`,
        updateResult.messages,
        [2, 4]
      )

      // For position swaps, we mainly care that the operation is incremental
      // The exact final state depends on the implementation details of fractional indexing
      expect(updateResult.sortedResults.length).toBeGreaterThan(0) // Should have some final results
    })

    it(`should maintain lexicographic order through multiple updates`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      input.pipe(
        topK((a, b) => a.value.localeCompare(b.value)),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // Initial data - a, c, e, g, i
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1],
          [[3, { id: 3, value: `c` }], 1],
          [[5, { id: 5, value: `e` }], 1],
          [[7, { id: 7, value: `g` }], 1],
          [[9, { id: 9, value: `i` }], 1],
        ])
      )
      graph.run()

      const initialResult = tracker.getResult()
      expect(initialResult.sortedResults.length).toBe(5) // Should have all 5 elements
      expect(initialResult.messageCount).toBeLessThanOrEqual(6) // Should be efficient

      tracker.reset()

      // Update 1: Insert elements between existing ones - b, d, f, h
      input.sendData(
        new MultiSet([
          [[2, { id: 2, value: `b` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[6, { id: 6, value: `f` }], 1],
          [[8, { id: 8, value: `h` }], 1],
        ])
      )
      graph.run()

      const update1Result = tracker.getResult()
      // Should have efficient incremental update
      expect(update1Result.messageCount).toBeLessThanOrEqual(6) // Should be incremental
      expect(update1Result.messageCount).toBeGreaterThan(0) // Should have changes

      tracker.reset()

      // Update 2: Move some elements around
      input.sendData(
        new MultiSet([
          [[3, { id: 3, value: `c` }], -1], // Remove old 'c'
          [[3, { id: 3, value: `j` }], 1], // Move 'c' to after 'i'
          [[7, { id: 7, value: `g` }], -1], // Remove old 'g'
          [[7, { id: 7, value: `a-` }], 1], // Move 'g' to before 'a'
        ])
      )
      graph.run()

      const update2Result = tracker.getResult()
      // Should have efficient incremental update for value changes
      expect(update2Result.messageCount).toBeLessThanOrEqual(6) // Should be incremental
      expect(update2Result.messageCount).toBeGreaterThan(0) // Should have changes

      // Check that only the affected key produces messages
      assertOnlyKeysAffected(
        `topK lexicographic update2`,
        update2Result.messages,
        [3, 7]
      )
    })

    it(`should maintain correct order when cycling through multiple changes`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      input.pipe(
        topK((a, b) => a.value.localeCompare(b.value)),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // Initial data with 5 items: a, b, c, d, e
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1],
          [[2, { id: 2, value: `b` }], 1],
          [[3, { id: 3, value: `c` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[5, { id: 5, value: `e` }], 1],
        ])
      )
      graph.run()

      const initialResult = tracker.getResult()
      expect(initialResult.sortedResults.length).toBe(5) // Should have all 5 elements
      expect(initialResult.messageCount).toBeLessThanOrEqual(6) // Should be efficient

      // Check that results are in correct initial order
      const initialSortedByIndex = initialResult.sortedResults.sort((a, b) => {
        const aIndex = a[1][1] // fractional index
        const bIndex = b[1][1] // fractional index
        return aIndex < bIndex ? -1 : aIndex > bIndex ? 1 : 0
      })

      const initialSortedValues = initialSortedByIndex.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(initialSortedValues).toEqual([`a`, `b`, `c`, `d`, `e`]) // Should be in lexicographic order

      tracker.reset()

      // Cycle 1: Move 'a' to position after 'b' by changing it to 'bb'
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], -1], // Remove old 'a'
          [[1, { id: 1, value: `bb` }], 1], // Move 'a' to after 'b'
        ])
      )
      graph.run()

      const cycle1Result = tracker.getResult()
      // Should have efficient incremental update
      expect(cycle1Result.messageCount).toBeLessThanOrEqual(4) // Should be incremental
      expect(cycle1Result.messageCount).toBeGreaterThan(0) // Should have changes

      tracker.reset()

      // Cycle 2: Move 'bb' to position after 'd' by changing it to 'dd'
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `bb` }], -1], // Remove old 'bb'
          [[1, { id: 1, value: `dd` }], 1], // Move to after 'd'
        ])
      )
      graph.run()

      const cycle2Result = tracker.getResult()
      // Should have efficient incremental update for the repositioning
      expect(cycle2Result.messageCount).toBeLessThanOrEqual(4) // Should be incremental
      expect(cycle2Result.messageCount).toBeGreaterThan(0) // Should have changes

      // Check that only the affected key produces messages
      assertOnlyKeysAffected(`topK cycling update2`, cycle2Result.messages, [1])

      // The key point is that the fractional indexing system can handle
      // multiple repositioning operations efficiently
      expect(cycle2Result.sortedResults.length).toBeGreaterThan(0) // Should have final results
    })

    it(`should handle insertion at the start of the sorted collection`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const allMessages: Array<any> = []

      input.pipe(
        topK((a, b) => a.value.localeCompare(b.value)),
        output((message) => {
          allMessages.push(message)
        })
      )

      graph.finalize()

      // Initial data - b, c, d, e
      input.sendData(
        new MultiSet([
          [[2, { id: 2, value: `b` }], 1],
          [[3, { id: 3, value: `c` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[5, { id: 5, value: `e` }], 1],
        ])
      )
      graph.run()

      // Initial result should have all elements with fractional indices
      const initialResult = allMessages[0].getInner()
      expect(initialResult.length).toBe(4)

      // Check that indices are in lexicographic order
      expect(checkLexicographicOrder(initialResult)).toBe(true)

      // Keep track of the current state
      const currentState = new Map()
      for (const [[_, [value, index]]] of initialResult) {
        currentState.set(JSON.stringify(value), [value, index])
      }

      // Update: Insert element at the start - 'a'
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1], // This should be inserted at the start
        ])
      )
      graph.run()

      // Check the changes
      const changes = allMessages[1].getInner()

      // We should only emit as many changes as we received (1 addition)
      expect(changes.length).toBe(1)

      // Apply the changes to our current state
      for (const [[_, [value, index]], multiplicity] of changes) {
        if (multiplicity < 0) {
          // Remove
          currentState.delete(JSON.stringify(value))
        } else {
          // Add
          currentState.set(JSON.stringify(value), [value, index])
        }
      }

      // Convert to array for lexicographic order check
      const currentStateArray = Array.from(currentState.values()).map(
        ([value, index]) => [[null, [value, index]], 1]
      )

      expect(checkLexicographicOrder(currentStateArray)).toBe(true)

      // Verify the order of elements
      const expectedOrder = [`a`, `b`, `c`, `d`, `e`]
      verifyOrder(currentStateArray, expectedOrder)

      // Check that the new element 'a' has an index that is lexicographically before 'b'
      const aValue = { id: 1, value: `a` }
      const bValue = { id: 2, value: `b` }
      const aIndex = currentState.get(JSON.stringify(aValue))[1]
      const bIndex = currentState.get(JSON.stringify(bValue))[1]

      // Directly check that 'a' comes before 'b' lexicographically
      expect(aIndex < bIndex).toBe(true)
    })

    it(`should handle multiple insertion at the start of the sorted collection`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const allMessages: Array<any> = []

      input.pipe(
        topK((a, b) => a.value.localeCompare(b.value)),
        output((message) => {
          allMessages.push(message)
        })
      )

      graph.finalize()

      // Initial data - b, c, d, e
      input.sendData(
        new MultiSet([
          [[3, { id: 3, value: `c` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[5, { id: 5, value: `e` }], 1],
          [[6, { id: 6, value: `f` }], 1],
        ])
      )
      graph.run()

      // Initial result should have all elements with fractional indices
      const initialResult = allMessages[0].getInner()
      expect(initialResult.length).toBe(4)

      // Check that indices are in lexicographic order
      expect(checkLexicographicOrder(initialResult)).toBe(true)

      // Keep track of the current state
      const currentState = new Map()
      for (const [[_, [value, index]]] of initialResult) {
        currentState.set(JSON.stringify(value), [value, index])
      }

      // Update: Insert element at the start - 'a'
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1], // This should be inserted at the start
          [[2, { id: 2, value: `b` }], 1], // This should be inserted at the start
        ])
      )
      graph.run()

      // Check the changes
      const changes = allMessages[1].getInner()

      // We should only emit as many changes as we received (1 addition)
      expect(changes.length).toBe(2)

      // Apply the changes to our current state
      for (const [[_, [value, index]], multiplicity] of changes) {
        if (multiplicity < 0) {
          // Remove
          currentState.delete(JSON.stringify(value))
        } else {
          // Add
          currentState.set(JSON.stringify(value), [value, index])
        }
      }

      // Convert to array for lexicographic order check
      const currentStateArray = Array.from(currentState.values()).map(
        ([value, index]) => [[null, [value, index]], 1]
      )

      expect(checkLexicographicOrder(currentStateArray)).toBe(true)

      // Verify the order of elements
      const expectedOrder = [`a`, `b`, `c`, `d`, `e`, `f`]
      verifyOrder(currentStateArray, expectedOrder)
    })
  })
})

describe(`Operators`, () => {
  describe(`TopKWithFractionalIndex operator with array`, () => {
    it(`should support moving topK window past current window using setWindowFn callback`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        | ((options: { offset?: number; limit?: number }) => void)
        | undefined

      input.pipe(
        topKWithFractionalIndex((a, b) => a.value.localeCompare(b.value), {
          limit: 3,
          offset: 0,
          setWindowFn: (fn) => {
            windowFn = fn
          },
        }),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // Initial data - a, b, c, d, e, f
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1],
          [[2, { id: 2, value: `b` }], 1],
          [[3, { id: 3, value: `c` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[5, { id: 5, value: `e` }], 1],
          [[6, { id: 6, value: `f` }], 1],
        ])
      )
      graph.run()

      // Initial result should have first 3 elements (a, b, c)
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(initialResult.sortedResults.length).toBe(3)
      expect(initialResult.messageCount).toBeLessThanOrEqual(6)

      // Verify initial order
      const initialSortedValues = initialResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(initialSortedValues).toEqual([`a`, `b`, `c`])

      // Verify windowFn was set
      expect(windowFn).toBeDefined()

      const numberOfMessages = tracker.getResult().messageCount

      // Move the window to show elements d, e, f (offset: 3, limit: 3)
      windowFn!({ offset: 3, limit: 3 })
      graph.run()

      const moveResult = tracker.getResult(compareFractionalIndex)

      // Should now show d, e, f
      const moveSortedValues = moveResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(moveSortedValues).toEqual([`d`, `e`, `f`])

      // Check that only the affected keys produce messages
      const affectedKeys = moveResult.messages.map(([key, _]) => key[0])
      expect(affectedKeys.length).toBe(numberOfMessages + 6)
      expect(affectedKeys).toEqual(expect.arrayContaining([1, 2, 3, 4, 5, 6]))
    })

    it(`should support moving topK window before current window using setWindowFn callback`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        | ((options: { offset?: number; limit?: number }) => void)
        | undefined

      input.pipe(
        topKWithFractionalIndex((a, b) => a.value.localeCompare(b.value), {
          limit: 3,
          offset: 3,
          setWindowFn: (fn) => {
            windowFn = fn
          },
        }),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // Initial data - a, b, c, d, e, f
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1],
          [[2, { id: 2, value: `b` }], 1],
          [[3, { id: 3, value: `c` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[5, { id: 5, value: `e` }], 1],
          [[6, { id: 6, value: `f` }], 1],
        ])
      )
      graph.run()

      // Initial result should have first 3 elements (a, b, c)
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(initialResult.sortedResults.length).toBe(3)
      expect(initialResult.messageCount).toBeLessThanOrEqual(6)

      // Verify initial order
      const initialSortedValues = initialResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(initialSortedValues).toEqual([`d`, `e`, `f`])

      // Verify windowFn was set
      expect(windowFn).toBeDefined()

      const numberOfMessages = tracker.getResult().messageCount

      // Move the window to show elements d, e, f (offset: 3, limit: 3)
      windowFn!({ offset: 0, limit: 3 })
      graph.run()

      const moveResult = tracker.getResult(compareFractionalIndex)

      // Should now show d, e, f
      const moveSortedValues = moveResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(moveSortedValues).toEqual([`a`, `b`, `c`])

      // Check that only the affected keys produce messages
      const affectedKeys = moveResult.messages.map(([key, _]) => key[0])
      expect(affectedKeys.length).toBe(numberOfMessages + 6)
      expect(affectedKeys).toEqual(expect.arrayContaining([1, 2, 3, 4, 5, 6]))
    })

    it(`should support moving offset while keeping limit constant`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        | ((options: { offset?: number; limit?: number }) => void)
        | null = null

      input.pipe(
        topKWithFractionalIndex((a, b) => a.value.localeCompare(b.value), {
          limit: 2,
          offset: 0,
          setWindowFn: (fn) => {
            windowFn = fn
          },
        }),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // Initial data - a, b, c, d, e
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1],
          [[2, { id: 2, value: `b` }], 1],
          [[3, { id: 3, value: `c` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[5, { id: 5, value: `e` }], 1],
        ])
      )
      graph.run()

      // Initial result should have first 2 elements (a, b)
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(initialResult.sortedResults.length).toBe(2)

      const initialSortedValues = initialResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(initialSortedValues).toEqual([`a`, `b`])

      // tracker.reset()

      // Move offset to 1, keeping limit at 2 (should show b, c)
      windowFn!({ offset: 1, limit: 2 })
      graph.run()

      const moveResult = tracker.getResult(compareFractionalIndex)

      const moveSortedValues = moveResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(moveSortedValues).toEqual([`b`, `c`])

      // tracker.reset()

      // Move offset to 2, keeping limit at 2 (should show c, d)
      windowFn!({ offset: 2, limit: 2 })
      graph.run()

      const moveResult2 = tracker.getResult(compareFractionalIndex)

      const moveSortedValues2 = moveResult2.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(moveSortedValues2).toEqual([`c`, `d`])

      // Move offset back to 0, keeping limit at 2 (should show a, b)
      windowFn!({ offset: 0, limit: 2 })
      graph.run()

      const moveResult3 = tracker.getResult(compareFractionalIndex)

      const moveSortedValues3 = moveResult3.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(moveSortedValues3).toEqual([`a`, `b`])
    })

    it(`should support moving limit while keeping offset constant`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        | ((options: { offset?: number; limit?: number }) => void)
        | null = null

      input.pipe(
        topKWithFractionalIndex((a, b) => a.value.localeCompare(b.value), {
          limit: 2,
          offset: 1,
          setWindowFn: (fn) => {
            windowFn = fn
          },
        }),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // Initial data - a, b, c, d, e, f
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1],
          [[2, { id: 2, value: `b` }], 1],
          [[3, { id: 3, value: `c` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[5, { id: 5, value: `e` }], 1],
          [[6, { id: 6, value: `f` }], 1],
        ])
      )
      graph.run()

      // Initial result should have 2 elements starting from offset 1 (b, c)
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(initialResult.sortedResults.length).toBe(2)

      const initialSortedValues = initialResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(initialSortedValues).toEqual([`b`, `c`])

      // Increase limit to 3, keeping offset at 1 (should show b, c, d)
      windowFn!({ offset: 1, limit: 3 })
      graph.run()

      const moveResult = tracker.getResult(compareFractionalIndex)

      const moveSortedValues = moveResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(moveSortedValues).toEqual([`b`, `c`, `d`])

      // Decrease limit to 1, keeping offset at 1 (should show just b)
      windowFn!({ offset: 1, limit: 1 })
      graph.run()

      const moveResult2 = tracker.getResult(compareFractionalIndex)

      const moveSortedValues2 = moveResult2.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(moveSortedValues2).toEqual([`b`])
    })

    it(`should handle edge cases when moving beyond available data`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        | ((options: { offset?: number; limit?: number }) => void)
        | null = null

      input.pipe(
        topKWithFractionalIndex((a, b) => a.value.localeCompare(b.value), {
          limit: 2,
          offset: 0,
          setWindowFn: (fn) => {
            windowFn = fn
          },
        }),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // Initial data - only 3 elements: a, b, c
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1],
          [[2, { id: 2, value: `b` }], 1],
          [[3, { id: 3, value: `c` }], 1],
        ])
      )
      graph.run()

      // Initial result should have first 2 elements (a, b)
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(initialResult.sortedResults.length).toBe(2)

      const initialSortedValues = initialResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(initialSortedValues).toEqual([`a`, `b`])

      // Move to offset 2, limit 2 (should show only c, since we only have 3 total elements)
      windowFn!({ offset: 2, limit: 2 })
      graph.run()

      const moveResult = tracker.getResult(compareFractionalIndex)

      const moveSortedValues = moveResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(moveSortedValues).toEqual([`c`]) // Only 1 element available at offset 2

      // Move to offset 5, limit 2 (should show no elements, beyond available data)
      windowFn!({ offset: 5, limit: 2 })
      graph.run()

      const moveResult2 = tracker.getResult(compareFractionalIndex)

      const moveSortedValues2 = moveResult2.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(moveSortedValues2).toEqual([]) // No elements available at offset 5

      // Move to a negative offset and limit (should show no elements)
      windowFn!({ offset: -5, limit: 2 })
      graph.run()

      const moveResult3 = tracker.getResult(compareFractionalIndex)

      const moveSortedValues3 = moveResult3.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(moveSortedValues3).toEqual([])

      // Move back to a valid window
      windowFn!({ offset: 0, limit: 2 })
      graph.run()

      const moveResult4 = tracker.getResult(compareFractionalIndex)

      const moveSortedValues4 = moveResult4.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(moveSortedValues4).toEqual([`a`, `b`])
    })

    it(`should handle moving window from infinite limit to finite limit with same offset`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        | ((options: { offset?: number; limit?: number }) => void)
        | null = null

      // Start with no limit (infinite limit)
      input.pipe(
        topKWithFractionalIndex((a, b) => a.value.localeCompare(b.value), {
          setWindowFn: (fn) => {
            windowFn = fn
          },
        }),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // Initial data - a, b, c, d, e, f
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1],
          [[2, { id: 2, value: `b` }], 1],
          [[3, { id: 3, value: `c` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[5, { id: 5, value: `e` }], 1],
          [[6, { id: 6, value: `f` }], 1],
        ])
      )
      graph.run()

      // Initial result should have all 6 elements (no limit)
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(initialResult.sortedResults.length).toBe(6)

      const initialSortedValues = initialResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(initialSortedValues).toEqual([`a`, `b`, `c`, `d`, `e`, `f`])

      // Verify windowFn was set
      expect(windowFn).toBeDefined()

      // Move to finite limit of 3 (should show a, b, c)
      windowFn!({ offset: 0, limit: 3 })
      graph.run()

      const moveResult = tracker.getResult(compareFractionalIndex)

      // Should now show only first 3 elements
      const moveSortedValues = moveResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(moveSortedValues).toEqual([`a`, `b`, `c`])

      // Check that we have changes (elements d, e, f should be removed)
      expect(moveResult.messageCount).toBeGreaterThan(0)
    })

    it(`should handle moving window from infinite limit to finite limit while moving offset forward`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        | ((options: { offset?: number; limit?: number }) => void)
        | null = null

      // Start with no limit (infinite limit)
      input.pipe(
        topKWithFractionalIndex((a, b) => a.value.localeCompare(b.value), {
          offset: 0,
          setWindowFn: (fn) => {
            windowFn = fn
          },
        }),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // Initial data - a, b, c, d, e, f
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1],
          [[2, { id: 2, value: `b` }], 1],
          [[3, { id: 3, value: `c` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[5, { id: 5, value: `e` }], 1],
          [[6, { id: 6, value: `f` }], 1],
        ])
      )
      graph.run()

      // Initial result should have all 6 elements (no limit)
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(initialResult.sortedResults.length).toBe(6)

      // Move to offset 2, limit 3 (should show c, d, e)
      windowFn!({ offset: 2, limit: 3 })
      graph.run()

      const moveResult = tracker.getResult(compareFractionalIndex)

      // Should now show elements c, d, e
      const moveSortedValues = moveResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(moveSortedValues).toEqual([`c`, `d`, `e`])

      // Check that we have changes
      expect(moveResult.messageCount).toBeGreaterThan(0)
    })

    it(`should handle moving window from infinite limit to finite limit while moving offset backward`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        | ((options: { offset?: number; limit?: number }) => void)
        | null = null

      // Start with no limit (infinite limit) and offset 3
      input.pipe(
        topKWithFractionalIndex((a, b) => a.value.localeCompare(b.value), {
          offset: 3,
          setWindowFn: (fn) => {
            windowFn = fn
          },
        }),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // Initial data - a, b, c, d, e, f
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1],
          [[2, { id: 2, value: `b` }], 1],
          [[3, { id: 3, value: `c` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[5, { id: 5, value: `e` }], 1],
          [[6, { id: 6, value: `f` }], 1],
        ])
      )
      graph.run()

      // Initial result should have elements d, e, f (no limit, offset 3)
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(initialResult.sortedResults.length).toBe(3)

      const initialSortedValues = initialResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(initialSortedValues).toEqual([`d`, `e`, `f`])

      // Move to finite limit of 2, moving offset backward to 1 (should show b, c)
      windowFn!({ offset: 1, limit: 2 })
      graph.run()

      const moveResult = tracker.getResult(compareFractionalIndex)

      // Should now show elements b, c (offset 1, limit 2)
      const moveSortedValues = moveResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(moveSortedValues).toEqual([`b`, `c`])

      // Check that we have changes (elements d, e, f should be removed, b, c should be added)
      expect(moveResult.messageCount).toBeGreaterThan(0)
    })

    it(`should handle moving window from infinite limit to infinite limit with same offset (no-op)`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        | ((options: { offset?: number; limit?: number }) => void)
        | null = null

      // Start with no limit (infinite limit) and offset 2
      input.pipe(
        topKWithFractionalIndex((a, b) => a.value.localeCompare(b.value), {
          offset: 2,
          setWindowFn: (fn) => {
            windowFn = fn
          },
        }),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // Initial data - a, b, c, d, e, f
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1],
          [[2, { id: 2, value: `b` }], 1],
          [[3, { id: 3, value: `c` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[5, { id: 5, value: `e` }], 1],
          [[6, { id: 6, value: `f` }], 1],
        ])
      )
      graph.run()

      // Initial result should have elements c, d, e, f (no limit, offset 2)
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(initialResult.sortedResults.length).toBe(4)

      const initialSortedValues = initialResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(initialSortedValues).toEqual([`c`, `d`, `e`, `f`])

      // Move to same offset, still no limit (should show same elements c, d, e, f)
      windowFn!({ offset: 2 })
      graph.run()

      const moveResult = tracker.getResult(compareFractionalIndex)

      // Should show same elements c, d, e, f (offset 2, no limit)
      const moveSortedValues = moveResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(moveSortedValues).toEqual([`c`, `d`, `e`, `f`])

      // Check that we have no more changes (this should be a no-op)
      expect(moveResult.messageCount).toBe(initialResult.messageCount)
    })

    it(`should handle moving window from infinite limit to infinite limit while moving offset forward`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        | ((options: { offset?: number; limit?: number }) => void)
        | null = null

      // Start with no limit (infinite limit) and offset 0
      input.pipe(
        topKWithFractionalIndex((a, b) => a.value.localeCompare(b.value), {
          offset: 0,
          setWindowFn: (fn) => {
            windowFn = fn
          },
        }),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // Initial data - a, b, c, d, e, f
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1],
          [[2, { id: 2, value: `b` }], 1],
          [[3, { id: 3, value: `c` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[5, { id: 5, value: `e` }], 1],
          [[6, { id: 6, value: `f` }], 1],
        ])
      )
      graph.run()

      // Initial result should have all 6 elements (no limit, offset 0)
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(initialResult.sortedResults.length).toBe(6)

      const initialSortedValues = initialResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(initialSortedValues).toEqual([`a`, `b`, `c`, `d`, `e`, `f`])

      // Move to offset 2, still no limit (should show c, d, e, f)
      windowFn!({ offset: 2 })
      graph.run()

      const moveResult = tracker.getResult(compareFractionalIndex)

      // Should now show elements c, d, e, f (offset 2, no limit)
      const moveSortedValues = moveResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(moveSortedValues).toEqual([`c`, `d`, `e`, `f`])

      // Check that we have changes (elements a, b should be removed)
      expect(moveResult.messageCount).toBeGreaterThan(0)
    })

    it(`should handle moving window from infinite limit to infinite limit while moving offset backward`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        | ((options: { offset?: number; limit?: number }) => void)
        | null = null

      // Start with no limit (infinite limit) and offset 3
      input.pipe(
        topKWithFractionalIndex((a, b) => a.value.localeCompare(b.value), {
          offset: 3,
          setWindowFn: (fn) => {
            windowFn = fn
          },
        }),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // Initial data - a, b, c, d, e, f
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1],
          [[2, { id: 2, value: `b` }], 1],
          [[3, { id: 3, value: `c` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[5, { id: 5, value: `e` }], 1],
          [[6, { id: 6, value: `f` }], 1],
        ])
      )
      graph.run()

      // Initial result should have elements d, e, f (no limit, offset 3)
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(initialResult.sortedResults.length).toBe(3)

      const initialSortedValues = initialResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(initialSortedValues).toEqual([`d`, `e`, `f`])

      // Move to offset 1, still no limit (should show b, c, d, e, f)
      windowFn!({ offset: 1 })
      graph.run()

      const moveResult = tracker.getResult(compareFractionalIndex)

      // Should now show elements b, c, d, e, f (offset 1, no limit)
      const moveSortedValues = moveResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(moveSortedValues).toEqual([`b`, `c`, `d`, `e`, `f`])

      // Check that we have changes (elements b, c should be added)
      expect(moveResult.messageCount).toBeGreaterThan(0)
    })

    it(`should handle moving window from finite limit to infinite limit with same offset`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        | ((options: { offset?: number; limit?: number }) => void)
        | null = null

      // Start with finite limit of 2 and offset 2
      input.pipe(
        topKWithFractionalIndex((a, b) => a.value.localeCompare(b.value), {
          limit: 2,
          offset: 2,
          setWindowFn: (fn) => {
            windowFn = fn
          },
        }),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // Initial data - a, b, c, d, e, f
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1],
          [[2, { id: 2, value: `b` }], 1],
          [[3, { id: 3, value: `c` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[5, { id: 5, value: `e` }], 1],
          [[6, { id: 6, value: `f` }], 1],
        ])
      )
      graph.run()

      // Initial result should have 2 elements starting from offset 2 (c, d)
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(initialResult.sortedResults.length).toBe(2)

      const initialSortedValues = initialResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(initialSortedValues).toEqual([`c`, `d`])

      // Move to infinite limit, keeping offset 2 (should show c, d, e, f)
      windowFn!({ offset: 2, limit: Infinity })
      graph.run()

      const moveResult = tracker.getResult(compareFractionalIndex)

      // Should now show elements c, d, e, f (offset 2, no limit)
      const moveSortedValues = moveResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(moveSortedValues).toEqual([`c`, `d`, `e`, `f`])

      // Check that we have changes (elements e, f should be added)
      expect(moveResult.messageCount).toBeGreaterThan(0)
    })

    it(`should handle moving window from finite limit to infinite limit while moving offset forward`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        | ((options: { offset?: number; limit?: number }) => void)
        | null = null

      // Start with finite limit of 2 and offset 1
      input.pipe(
        topKWithFractionalIndex((a, b) => a.value.localeCompare(b.value), {
          limit: 2,
          offset: 1,
          setWindowFn: (fn) => {
            windowFn = fn
          },
        }),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // Initial data - a, b, c, d, e, f
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1],
          [[2, { id: 2, value: `b` }], 1],
          [[3, { id: 3, value: `c` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[5, { id: 5, value: `e` }], 1],
          [[6, { id: 6, value: `f` }], 1],
        ])
      )
      graph.run()

      // Initial result should have 2 elements starting from offset 1 (b, c)
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(initialResult.sortedResults.length).toBe(2)

      const initialSortedValues = initialResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(initialSortedValues).toEqual([`b`, `c`])

      // Move to infinite limit, moving offset forward to 3 (should show d, e, f)
      windowFn!({ offset: 3, limit: Infinity })
      graph.run()

      const moveResult = tracker.getResult(compareFractionalIndex)

      // Should now show elements d, e, f (offset 3, no limit)
      const moveSortedValues = moveResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(moveSortedValues).toEqual([`d`, `e`, `f`])

      // Check that we have changes (elements b, c should be removed, d, e, f should be added)
      expect(moveResult.messageCount).toBeGreaterThan(0)
    })

    it(`should handle moving window from finite limit to infinite limit while moving offset backward`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        | ((options: { offset?: number; limit?: number }) => void)
        | null = null

      // Start with finite limit of 2 and offset 3
      input.pipe(
        topKWithFractionalIndex((a, b) => a.value.localeCompare(b.value), {
          limit: 2,
          offset: 3,
          setWindowFn: (fn) => {
            windowFn = fn
          },
        }),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // Initial data - a, b, c, d, e, f
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1],
          [[2, { id: 2, value: `b` }], 1],
          [[3, { id: 3, value: `c` }], 1],
          [[4, { id: 4, value: `d` }], 1],
          [[5, { id: 5, value: `e` }], 1],
          [[6, { id: 6, value: `f` }], 1],
        ])
      )
      graph.run()

      // Initial result should have 2 elements starting from offset 3 (d, e)
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(initialResult.sortedResults.length).toBe(2)

      const initialSortedValues = initialResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(initialSortedValues).toEqual([`d`, `e`])

      // Move to infinite limit, moving offset backward to 1 (should show b, c, d, e, f)
      windowFn!({ offset: 1, limit: Infinity })
      graph.run()

      const moveResult = tracker.getResult(compareFractionalIndex)

      // Should now show elements b, c, d, e, f (offset 1, no limit)
      const moveSortedValues = moveResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(moveSortedValues).toEqual([`b`, `c`, `d`, `e`, `f`])

      // Check that we have changes (elements b, c, f should be added, d, e should remain)
      expect(moveResult.messageCount).toBeGreaterThan(0)
    })
  })
})
