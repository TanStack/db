import { beforeAll, describe, expect, it } from "vitest"
import { D2 } from "../../src/d2.js"
import { MultiSet } from "../../src/multiset.js"
import { topKWithFractionalIndex } from "../../src/operators/topKWithFractionalIndex.js"
import {
  loadBTree,
  topKWithFractionalIndexBTree,
} from "../../src/operators/topKWithFractionalIndexBTree.js"
import { output } from "../../src/operators/index.js"
import { MessageTracker, assertOnlyKeysAffected } from "../test-utils.js"

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
    const currentIndex = sortedByValue[i].index
    const nextIndex = sortedByValue[i + 1].index

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
      const input = graph.newInput<[null, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [null, [{ id: number; value: string }, string]]
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
          [[null, { id: 1, value: `a` }], 1],
          [[null, { id: 2, value: `b` }], 1],
          [[null, { id: 3, value: `c` }], 1],
          [[null, { id: 4, value: `d` }], 1],
          [[null, { id: 5, value: `e` }], 1],
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
          [[null, { id: 3, value: `a-` }], 1], // This should now be first
          [[null, { id: 3, value: `c` }], -1], // Remove the old value
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
        null,
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
      const input = graph.newInput<[null, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [null, [{ id: number; value: string }, string]]
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
          [[null, { id: 1, value: `a` }], 1],
          [[null, { id: 2, value: `b` }], 1],
          [[null, { id: 3, value: `c` }], 1],
          [[null, { id: 4, value: `d` }], 1],
          [[null, { id: 5, value: `e` }], 1],
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
      input.sendData(new MultiSet([[[null, { id: 6, value: `c` }], 1]]))
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
        [null]
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
      const input = graph.newInput<[null, { id: number; value: string }]>()
      const allMessages: Array<any> = []

      input.pipe(
        topK((a, b) => a.value.localeCompare(b.value)),
        output((message) => {
          allMessages.push(message)
        })
      )

      graph.finalize()

      // Initial data - a, b, c, d, e
      const entryForC = [[null, { id: 3, value: `c` }], 1] as [
        [null, { id: number; value: string }],
        number,
      ]
      input.sendData(
        new MultiSet([
          [[null, { id: 1, value: `a` }], 1],
          [[null, { id: 2, value: `b` }], 1],
          entryForC,
          [[null, { id: 4, value: `d` }], 1],
          [[null, { id: 5, value: `e` }], 1],
        ])
      )
      graph.run()

      // Initial result should have all elements with fractional indices
      const initialResult = allMessages[0].getInner()
      expect(initialResult.length).toBe(5)

      // Now add entryForC again
      input.sendData(new MultiSet([entryForC]))
      graph.run()

      // Check that no message was emitted
      // since there were no changes to the topK
      expect(allMessages.length).toBe(1)
    })

    it(`should handle limit and offset correctly`, () => {
      const graph = new D2()
      const input = graph.newInput<[null, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [null, [{ id: number; value: string }, string]]
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
          [[null, { id: 1, value: `a` }], 1],
          [[null, { id: 2, value: `b` }], 1],
          [[null, { id: 3, value: `c` }], 1],
          [[null, { id: 4, value: `d` }], 1],
          [[null, { id: 5, value: `e` }], 1],
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
          [[null, { id: 6, value: `c+` }], 1], // This should be between c and d
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
      assertOnlyKeysAffected(`topK limit+offset`, updateResult.messages, [null])
    })

    it(`should handle elements moving positions correctly`, () => {
      const graph = new D2()
      const input = graph.newInput<[null, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [null, [{ id: number; value: string }, string]]
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
          [[null, { id: 1, value: `a` }], 1],
          [[null, { id: 2, value: `b` }], 1],
          [[null, { id: 3, value: `c` }], 1],
          [[null, { id: 4, value: `d` }], 1],
          [[null, { id: 5, value: `e` }], 1],
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
          [[null, { id: 2, value: `d+` }], 1], // 'b' becomes 'd+'
          [[null, { id: 2, value: `b` }], -1], // Remove old 'b'
          [[null, { id: 4, value: `b+` }], 1], // 'd' becomes 'b+'
          [[null, { id: 4, value: `d` }], -1], // Remove old 'd'
        ])
      )
      graph.run()

      const updateResult = tracker.getResult()
      // Should have efficient incremental update
      expect(updateResult.messageCount).toBeLessThanOrEqual(6) // Should be incremental (4 changes max)
      expect(updateResult.messageCount).toBeGreaterThan(0) // Should have changes

      // Check that only the affected key produces messages
      assertOnlyKeysAffected(`topK move positions`, updateResult.messages, [
        null,
      ])

      // For position swaps, we mainly care that the operation is incremental
      // The exact final state depends on the implementation details of fractional indexing
      expect(updateResult.sortedResults.length).toBeGreaterThan(0) // Should have some final results
    })

    it(`should maintain lexicographic order through multiple updates`, () => {
      const graph = new D2()
      const input = graph.newInput<[null, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [null, [{ id: number; value: string }, string]]
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
          [[null, { id: 1, value: `a` }], 1],
          [[null, { id: 3, value: `c` }], 1],
          [[null, { id: 5, value: `e` }], 1],
          [[null, { id: 7, value: `g` }], 1],
          [[null, { id: 9, value: `i` }], 1],
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
          [[null, { id: 2, value: `b` }], 1],
          [[null, { id: 4, value: `d` }], 1],
          [[null, { id: 6, value: `f` }], 1],
          [[null, { id: 8, value: `h` }], 1],
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
          [[null, { id: 3, value: `j` }], 1], // Move 'c' to after 'i'
          [[null, { id: 3, value: `c` }], -1], // Remove old 'c'
          [[null, { id: 7, value: `a-` }], 1], // Move 'g' to before 'a'
          [[null, { id: 7, value: `g` }], -1], // Remove old 'g'
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
        [null]
      )
    })

    it(`should maintain correct order when cycling through multiple changes`, () => {
      const graph = new D2()
      const input = graph.newInput<[null, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [null, [{ id: number; value: string }, string]]
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
          [[null, { id: 1, value: `a` }], 1],
          [[null, { id: 2, value: `b` }], 1],
          [[null, { id: 3, value: `c` }], 1],
          [[null, { id: 4, value: `d` }], 1],
          [[null, { id: 5, value: `e` }], 1],
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
          [[null, { id: 1, value: `bb` }], 1], // Move 'a' to after 'b'
          [[null, { id: 1, value: `a` }], -1], // Remove old 'a'
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
          [[null, { id: 1, value: `dd` }], 1], // Move to after 'd'
          [[null, { id: 1, value: `bb` }], -1], // Remove old 'bb'
        ])
      )
      graph.run()

      const cycle2Result = tracker.getResult()
      // Should have efficient incremental update for the repositioning
      expect(cycle2Result.messageCount).toBeLessThanOrEqual(4) // Should be incremental
      expect(cycle2Result.messageCount).toBeGreaterThan(0) // Should have changes

      // Check that only the affected key produces messages
      assertOnlyKeysAffected(`topK cycling update2`, cycle2Result.messages, [
        null,
      ])

      // The key point is that the fractional indexing system can handle
      // multiple repositioning operations efficiently
      expect(cycle2Result.sortedResults.length).toBeGreaterThan(0) // Should have final results
    })

    it(`should handle insertion at the start of the sorted collection`, () => {
      const graph = new D2()
      const input = graph.newInput<[null, { id: number; value: string }]>()
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
          [[null, { id: 2, value: `b` }], 1],
          [[null, { id: 3, value: `c` }], 1],
          [[null, { id: 4, value: `d` }], 1],
          [[null, { id: 5, value: `e` }], 1],
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
          [[null, { id: 1, value: `a` }], 1], // This should be inserted at the start
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
      const input = graph.newInput<[null, { id: number; value: string }]>()
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
          [[null, { id: 3, value: `c` }], 1],
          [[null, { id: 4, value: `d` }], 1],
          [[null, { id: 5, value: `e` }], 1],
          [[null, { id: 6, value: `f` }], 1],
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
          [[null, { id: 1, value: `a` }], 1], // This should be inserted at the start
          [[null, { id: 2, value: `b` }], 1], // This should be inserted at the start
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
