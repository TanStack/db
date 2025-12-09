import { describe, expect, it } from 'vitest'
import { D2 } from '../../src/d2.js'
import { MultiSet } from '../../src/multiset.js'
import { groupedTopKWithFractionalIndex } from '../../src/operators/groupedTopKWithFractionalIndex.js'
import { output } from '../../src/operators/index.js'
import { MessageTracker, compareFractionalIndex } from '../test-utils.js'

describe(`Operators`, () => {
  describe(`GroupedTopKWithFractionalIndex operator`, () => {
    it(`should maintain separate topK per group`, () => {
      const graph = new D2()
      const input =
        graph.newInput<[string, { id: string; group: string; value: number }]>()
      const tracker = new MessageTracker<
        [string, [{ id: string; group: string; value: number }, string]]
      >()

      input.pipe(
        groupedTopKWithFractionalIndex((a, b) => a.value - b.value, {
          limit: 2,
          groupKeyFn: (_key, value) => value.group,
        }),
        output((message) => {
          tracker.addMessage(message)
        }),
      )

      graph.finalize()

      // Initial data - 3 items per group
      input.sendData(
        new MultiSet([
          [[`g1-a`, { id: `g1-a`, group: `group1`, value: 5 }], 1],
          [[`g1-b`, { id: `g1-b`, group: `group1`, value: 1 }], 1],
          [[`g1-c`, { id: `g1-c`, group: `group1`, value: 3 }], 1],
          [[`g2-a`, { id: `g2-a`, group: `group2`, value: 4 }], 1],
          [[`g2-b`, { id: `g2-b`, group: `group2`, value: 2 }], 1],
          [[`g2-c`, { id: `g2-c`, group: `group2`, value: 6 }], 1],
        ]),
      )
      graph.run()

      const result = tracker.getResult(compareFractionalIndex)

      // Each group should have limit 2, so 4 total results
      expect(result.sortedResults.length).toBe(4)

      // Group by group key and verify each group's results
      const groupedValues = new Map<string, Array<number>>()
      for (const [_key, [value, _index]] of result.sortedResults) {
        const group = value.group
        const list = groupedValues.get(group) ?? []
        list.push(value.value)
        groupedValues.set(group, list)
      }

      // Sort values within each group for consistent comparison
      for (const [group, values] of groupedValues) {
        values.sort((a, b) => a - b)
        groupedValues.set(group, values)
      }

      // group1 should have values 1, 3 (top 2 by ascending value)
      expect(groupedValues.get(`group1`)).toEqual([1, 3])
      // group2 should have values 2, 4 (top 2 by ascending value)
      expect(groupedValues.get(`group2`)).toEqual([2, 4])
    })

    it(`should handle incremental updates within a group`, () => {
      const graph = new D2()
      const input =
        graph.newInput<[string, { id: string; group: string; value: number }]>()
      const tracker = new MessageTracker<
        [string, [{ id: string; group: string; value: number }, string]]
      >()

      input.pipe(
        groupedTopKWithFractionalIndex((a, b) => a.value - b.value, {
          limit: 2,
          groupKeyFn: (_key, value) => value.group,
        }),
        output((message) => {
          tracker.addMessage(message)
        }),
      )

      graph.finalize()

      // Initial data
      input.sendData(
        new MultiSet([
          [[`g1-a`, { id: `g1-a`, group: `group1`, value: 5 }], 1],
          [[`g1-b`, { id: `g1-b`, group: `group1`, value: 1 }], 1],
          [[`g1-c`, { id: `g1-c`, group: `group1`, value: 3 }], 1],
        ]),
      )
      graph.run()

      // Initial should have 2 items (limit 2): values 1 and 3
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(initialResult.sortedResults.length).toBe(2)
      const initialValues = initialResult.sortedResults
        .map(([_key, [value, _index]]) => value.value)
        .sort((a, b) => a - b)
      expect(initialValues).toEqual([1, 3])

      const initialMessageCount = initialResult.messageCount

      // Insert a better value (0) which should evict value 3
      input.sendData(
        new MultiSet([
          [[`g1-d`, { id: `g1-d`, group: `group1`, value: 0 }], 1],
        ]),
      )
      graph.run()

      const updateResult = tracker.getResult(compareFractionalIndex)
      // Should have 2 new messages: add 0, remove 3
      expect(updateResult.messageCount - initialMessageCount).toBe(2)

      // Check final state (cumulative)
      const finalValues = updateResult.sortedResults
        .map(([_key, [value, _index]]) => value.value)
        .sort((a, b) => a - b)
      expect(finalValues).toEqual([0, 1])
    })

    it(`should handle removal of elements from topK`, () => {
      const graph = new D2()
      const input =
        graph.newInput<[string, { id: string; group: string; value: number }]>()
      const tracker = new MessageTracker<
        [string, [{ id: string; group: string; value: number }, string]]
      >()

      input.pipe(
        groupedTopKWithFractionalIndex((a, b) => a.value - b.value, {
          limit: 2,
          groupKeyFn: (_key, value) => value.group,
        }),
        output((message) => {
          tracker.addMessage(message)
        }),
      )

      graph.finalize()

      // Initial data
      input.sendData(
        new MultiSet([
          [[`g1-a`, { id: `g1-a`, group: `group1`, value: 5 }], 1],
          [[`g1-b`, { id: `g1-b`, group: `group1`, value: 1 }], 1],
          [[`g1-c`, { id: `g1-c`, group: `group1`, value: 3 }], 1],
        ]),
      )
      graph.run()

      const initialMessageCount = tracker.getResult().messageCount

      // Remove the element with value 1 (which is in topK)
      input.sendData(
        new MultiSet([
          [[`g1-b`, { id: `g1-b`, group: `group1`, value: 1 }], -1],
        ]),
      )
      graph.run()

      const updateResult = tracker.getResult(compareFractionalIndex)
      // Should have 2 new messages: remove 1, add 5
      expect(updateResult.messageCount - initialMessageCount).toBe(2)

      // Final state should have values 3 and 5
      const finalValues = updateResult.sortedResults
        .map(([_key, [value, _index]]) => value.value)
        .sort((a, b) => a - b)
      expect(finalValues).toEqual([3, 5])
    })

    it(`should handle multiple groups independently`, () => {
      const graph = new D2()
      const input =
        graph.newInput<[string, { id: string; group: string; value: number }]>()
      const tracker = new MessageTracker<
        [string, [{ id: string; group: string; value: number }, string]]
      >()

      input.pipe(
        groupedTopKWithFractionalIndex((a, b) => a.value - b.value, {
          limit: 2,
          groupKeyFn: (_key, value) => value.group,
        }),
        output((message) => {
          tracker.addMessage(message)
        }),
      )

      graph.finalize()

      // Initial data for two groups
      input.sendData(
        new MultiSet([
          [[`g1-a`, { id: `g1-a`, group: `group1`, value: 10 }], 1],
          [[`g1-b`, { id: `g1-b`, group: `group1`, value: 20 }], 1],
          [[`g2-a`, { id: `g2-a`, group: `group2`, value: 5 }], 1],
          [[`g2-b`, { id: `g2-b`, group: `group2`, value: 15 }], 1],
        ]),
      )
      graph.run()

      tracker.reset()

      // Update only group1 - add a better value
      input.sendData(
        new MultiSet([
          [[`g1-c`, { id: `g1-c`, group: `group1`, value: 5 }], 1],
        ]),
      )
      graph.run()

      const updateResult = tracker.getResult()
      // Only group1 should be affected
      const affectedGroups = new Set(
        updateResult.messages.map(
          ([[_key, [value, _idx]], _mult]) => value.group,
        ),
      )
      expect(affectedGroups.size).toBe(1)
      expect(affectedGroups.has(`group1`)).toBe(true)
      expect(affectedGroups.has(`group2`)).toBe(false)
    })

    it(`should support offset within groups`, () => {
      const graph = new D2()
      const input =
        graph.newInput<[string, { id: string; group: string; value: number }]>()
      const tracker = new MessageTracker<
        [string, [{ id: string; group: string; value: number }, string]]
      >()

      input.pipe(
        groupedTopKWithFractionalIndex((a, b) => a.value - b.value, {
          limit: 2,
          offset: 1,
          groupKeyFn: (_key, value) => value.group,
        }),
        output((message) => {
          tracker.addMessage(message)
        }),
      )

      graph.finalize()

      // Initial data - 4 items per group
      input.sendData(
        new MultiSet([
          [[`g1-a`, { id: `g1-a`, group: `group1`, value: 1 }], 1],
          [[`g1-b`, { id: `g1-b`, group: `group1`, value: 2 }], 1],
          [[`g1-c`, { id: `g1-c`, group: `group1`, value: 3 }], 1],
          [[`g1-d`, { id: `g1-d`, group: `group1`, value: 4 }], 1],
        ]),
      )
      graph.run()

      const result = tracker.getResult(compareFractionalIndex)

      // With offset 1 and limit 2, should get values 2 and 3
      const values = result.sortedResults
        .map(([_key, [value, _index]]) => value.value)
        .sort((a, b) => a - b)
      expect(values).toEqual([2, 3])
    })

    it(`should use groupKeyFn to extract group from key with delimiter`, () => {
      const graph = new D2()
      // Use keys with format "group:itemId"
      const input = graph.newInput<[string, { id: string; value: number }]>()
      const tracker = new MessageTracker<
        [string, [{ id: string; value: number }, string]]
      >()

      input.pipe(
        groupedTopKWithFractionalIndex((a, b) => a.value - b.value, {
          limit: 2,
          // Extract group from key "group:itemId"
          groupKeyFn: (key, _value) => key.split(`:`)[0],
        }),
        output((message) => {
          tracker.addMessage(message)
        }),
      )

      graph.finalize()

      input.sendData(
        new MultiSet([
          [[`group1:a`, { id: `g1-a`, value: 5 }], 1],
          [[`group1:b`, { id: `g1-b`, value: 1 }], 1],
          [[`group1:c`, { id: `g1-c`, value: 3 }], 1],
          [[`group2:a`, { id: `g2-a`, value: 4 }], 1],
          [[`group2:b`, { id: `g2-b`, value: 2 }], 1],
          [[`group2:c`, { id: `g2-c`, value: 6 }], 1],
        ]),
      )
      graph.run()

      const result = tracker.getResult(compareFractionalIndex)

      // Group results by group extracted from key
      const groupedValues = new Map<string, Array<number>>()
      for (const [key, [value, _index]] of result.sortedResults) {
        const group = key.split(`:`)[0]!
        const list = groupedValues.get(group) ?? []
        list.push(value.value)
        groupedValues.set(group, list)
      }

      for (const [group, values] of groupedValues) {
        values.sort((a, b) => a - b)
        groupedValues.set(group, values)
      }

      expect(groupedValues.get(`group1`)).toEqual([1, 3])
      expect(groupedValues.get(`group2`)).toEqual([2, 4])
    })

    it(`should support infinite limit (no limit)`, () => {
      const graph = new D2()
      const input =
        graph.newInput<[string, { id: string; group: string; value: number }]>()
      const tracker = new MessageTracker<
        [string, [{ id: string; group: string; value: number }, string]]
      >()

      input.pipe(
        groupedTopKWithFractionalIndex((a, b) => a.value - b.value, {
          // No limit specified - defaults to Infinity
          groupKeyFn: (_key, value) => value.group,
        }),
        output((message) => {
          tracker.addMessage(message)
        }),
      )

      graph.finalize()

      input.sendData(
        new MultiSet([
          [[`g1-a`, { id: `g1-a`, group: `group1`, value: 5 }], 1],
          [[`g1-b`, { id: `g1-b`, group: `group1`, value: 1 }], 1],
          [[`g1-c`, { id: `g1-c`, group: `group1`, value: 3 }], 1],
        ]),
      )
      graph.run()

      const result = tracker.getResult(compareFractionalIndex)

      // All 3 items should be in the result
      expect(result.sortedResults.length).toBe(3)
      const values = result.sortedResults
        .map(([_key, [value, _index]]) => value.value)
        .sort((a, b) => a - b)
      expect(values).toEqual([1, 3, 5])
    })

    it(`should maintain fractional indices correctly within groups`, () => {
      const graph = new D2()
      const input =
        graph.newInput<[string, { id: string; group: string; value: number }]>()
      const tracker = new MessageTracker<
        [string, [{ id: string; group: string; value: number }, string]]
      >()

      input.pipe(
        groupedTopKWithFractionalIndex((a, b) => a.value - b.value, {
          limit: 3,
          groupKeyFn: (_key, value) => value.group,
        }),
        output((message) => {
          tracker.addMessage(message)
        }),
      )

      graph.finalize()

      input.sendData(
        new MultiSet([
          [[`g1-a`, { id: `g1-a`, group: `group1`, value: 1 }], 1],
          [[`g1-b`, { id: `g1-b`, group: `group1`, value: 3 }], 1],
          [[`g1-c`, { id: `g1-c`, group: `group1`, value: 5 }], 1],
        ]),
      )
      graph.run()

      const result = tracker.getResult(compareFractionalIndex)

      // Check fractional indices are in correct order
      const indexedItems = result.sortedResults.map(
        ([key, [value, index]]) => ({
          key,
          value: value.value,
          index,
        }),
      )

      // Sort by value to verify fractional indices match sort order
      indexedItems.sort((a, b) => a.value - b.value)

      // Verify indices are in lexicographic order
      for (let i = 0; i < indexedItems.length - 1; i++) {
        expect(indexedItems[i]!.index < indexedItems[i + 1]!.index).toBe(true)
      }
    })

    it(`should handle setSizeCallback correctly`, () => {
      const graph = new D2()
      const input =
        graph.newInput<[string, { id: string; group: string; value: number }]>()
      let getSize: (() => number) | undefined

      input.pipe(
        groupedTopKWithFractionalIndex((a, b) => a.value - b.value, {
          limit: 2,
          groupKeyFn: (_key, value) => value.group,
          setSizeCallback: (fn) => {
            getSize = fn
          },
        }),
        output(() => {}),
      )

      graph.finalize()

      expect(getSize).toBeDefined()
      expect(getSize!()).toBe(0) // Initially empty

      input.sendData(
        new MultiSet([
          [[`g1-a`, { id: `g1-a`, group: `group1`, value: 5 }], 1],
          [[`g1-b`, { id: `g1-b`, group: `group1`, value: 1 }], 1],
          [[`g1-c`, { id: `g1-c`, group: `group1`, value: 3 }], 1],
          [[`g2-a`, { id: `g2-a`, group: `group2`, value: 4 }], 1],
          [[`g2-b`, { id: `g2-b`, group: `group2`, value: 2 }], 1],
        ]),
      )
      graph.run()

      // group1 has 2 items in topK, group2 has 2 items
      expect(getSize!()).toBe(4)
    })

    it(`should handle moving window with setWindowFn`, () => {
      const graph = new D2()
      const input =
        graph.newInput<[string, { id: string; group: string; value: number }]>()
      const tracker = new MessageTracker<
        [string, [{ id: string; group: string; value: number }, string]]
      >()
      let windowFn:
        | ((options: { offset?: number; limit?: number }) => void)
        | undefined

      input.pipe(
        groupedTopKWithFractionalIndex((a, b) => a.value - b.value, {
          limit: 2,
          offset: 0,
          groupKeyFn: (_key, value) => value.group,
          setWindowFn: (fn) => {
            windowFn = fn
          },
        }),
        output((message) => {
          tracker.addMessage(message)
        }),
      )

      graph.finalize()

      input.sendData(
        new MultiSet([
          [[`g1-a`, { id: `g1-a`, group: `group1`, value: 1 }], 1],
          [[`g1-b`, { id: `g1-b`, group: `group1`, value: 2 }], 1],
          [[`g1-c`, { id: `g1-c`, group: `group1`, value: 3 }], 1],
          [[`g1-d`, { id: `g1-d`, group: `group1`, value: 4 }], 1],
        ]),
      )
      graph.run()

      // Initial: values 1, 2
      const initialResult = tracker.getResult(compareFractionalIndex)
      const initialValues = initialResult.sortedResults
        .map(([_key, [value, _index]]) => value.value)
        .sort((a, b) => a - b)
      expect(initialValues).toEqual([1, 2])

      // Move window to offset 1
      windowFn!({ offset: 1 })
      graph.run()

      // Now should have values 2, 3
      const movedResult = tracker.getResult(compareFractionalIndex)
      const movedValues = movedResult.sortedResults
        .map(([_key, [value, _index]]) => value.value)
        .sort((a, b) => a - b)
      expect(movedValues).toEqual([2, 3])
    })

    it(`should cleanup empty groups`, () => {
      const graph = new D2()
      const input =
        graph.newInput<[string, { id: string; group: string; value: number }]>()
      const tracker = new MessageTracker<
        [string, [{ id: string; group: string; value: number }, string]]
      >()

      input.pipe(
        groupedTopKWithFractionalIndex((a, b) => a.value - b.value, {
          limit: 2,
          groupKeyFn: (_key, value) => value.group,
        }),
        output((message) => {
          tracker.addMessage(message)
        }),
      )

      graph.finalize()

      // Add items to two groups
      input.sendData(
        new MultiSet([
          [[`g1-a`, { id: `g1-a`, group: `group1`, value: 1 }], 1],
          [[`g2-a`, { id: `g2-a`, group: `group2`, value: 2 }], 1],
        ]),
      )
      graph.run()

      expect(tracker.getResult().sortedResults.length).toBe(2)

      // Remove all items from group1
      input.sendData(
        new MultiSet([
          [[`g1-a`, { id: `g1-a`, group: `group1`, value: 1 }], -1],
        ]),
      )
      graph.run()

      // Should have only group2 left in materialized results
      const updateResult = tracker.getResult(compareFractionalIndex)
      expect(updateResult.sortedResults.length).toBe(1)
      expect(updateResult.sortedResults[0]![1][0].group).toBe(`group2`)
    })
  })
})
