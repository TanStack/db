import { describe, expect, it } from 'vitest'
import { D2 } from '../../src/d2.js'
import { MultiSet } from '../../src/multiset.js'
import { groupedOrderByWithFractionalIndex } from '../../src/operators/groupedOrderBy.js'
import { output } from '../../src/operators/index.js'
import { MessageTracker, compareFractionalIndex } from '../test-utils.js'
import type { KeyValue } from '../../src/types.js'

describe(`Operators`, () => {
  describe(`GroupedOrderByWithFractionalIndex operator`, () => {
    it(`should maintain separate ordering per group with array key`, () => {
      const graph = new D2()
      const input = graph.newInput<
        KeyValue<
          [string, string],
          {
            id: string
            value: number
          }
        >
      >()
      const tracker = new MessageTracker<
        [[string, string], [{ id: string; value: number }, string]]
      >()

      const groupKeyFn = (key: [string, string]) => key[0]

      input.pipe(
        groupedOrderByWithFractionalIndex((item) => item.value, {
          limit: 2,
          groupKeyFn,
        }),
        output((message) => {
          tracker.addMessage(message)
        }),
      )

      graph.finalize()

      input.sendData(
        new MultiSet([
          [[[`group1`, `a`], { id: `g1-a`, value: 5 }], 1],
          [[[`group1`, `b`], { id: `g1-b`, value: 1 }], 1],
          [[[`group1`, `c`], { id: `g1-c`, value: 3 }], 1],
          [[[`group2`, `a`], { id: `g2-a`, value: 4 }], 1],
          [[[`group2`, `b`], { id: `g2-b`, value: 2 }], 1],
          [[[`group2`, `c`], { id: `g2-c`, value: 6 }], 1],
        ]),
      )

      graph.run()

      const result = tracker.getResult(compareFractionalIndex)

      // Each group should have limit 2, so 4 total results
      expect(result.sortedResults.length).toBe(4)

      // Sort all results by fractional index first, then group by group key
      const sortedResults = sortByKeyAndIndex(result.sortedResults)
      const groupedValues = groupResultsByKey(sortedResults, groupKeyFn)

      // group1 should have values 1, 3 (top 2 by ascending value, ordered by fractional index)
      expect(groupedValues.get(`group1`)).toEqual([1, 3])
      // group2 should have values 2, 4 (top 2 by ascending value, ordered by fractional index)
      expect(groupedValues.get(`group2`)).toEqual([2, 4])
    })

    it(`should group by value property using groupKeyFn`, () => {
      const graph = new D2()
      const input =
        graph.newInput<
          KeyValue<string, { id: string; group: string; value: number }>
        >()
      const tracker = new MessageTracker<
        [string, [{ id: string; group: string; value: number }, string]]
      >()

      const groupKeyFn = (
        _key: string,
        value: { id: string; group: string; value: number },
      ) => value.group

      input.pipe(
        groupedOrderByWithFractionalIndex((item) => item.value, {
          limit: 2,
          groupKeyFn,
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
          [[`g2-a`, { id: `g2-a`, group: `group2`, value: 4 }], 1],
          [[`g2-b`, { id: `g2-b`, group: `group2`, value: 2 }], 1],
          [[`g1-c`, { id: `g1-c`, group: `group1`, value: 3 }], 1],
          [[`g2-c`, { id: `g2-c`, group: `group2`, value: 6 }], 1],
        ]),
      )
      graph.run()

      const result = tracker.getResult(compareFractionalIndex)

      // Each group should have limit 2, so 4 total results
      expect(result.sortedResults.length).toBe(4)

      // Sort all results by fractional index first, then group by group key
      const sortedResults = sortByKeyAndIndex(result.sortedResults)
      const groupedValues = groupResultsByKey(sortedResults, groupKeyFn)

      // group1 should have values 1, 3 (top 2 by ascending value, ordered by fractional index)
      expect(groupedValues.get(`group1`)).toEqual([1, 3])
      // group2 should have values 2, 4 (top 2 by ascending value, ordered by fractional index)
      expect(groupedValues.get(`group2`)).toEqual([2, 4])
    })

    it(`should handle incremental updates within a group`, () => {
      const graph = new D2()
      const input =
        graph.newInput<
          KeyValue<string, { id: string; group: string; value: number }>
        >()
      const tracker = new MessageTracker<
        [string, [{ id: string; group: string; value: number }, string]]
      >()

      input.pipe(
        groupedOrderByWithFractionalIndex((item) => item.value, {
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
      const sortedInitialResults = sortByKeyAndIndex(
        initialResult.sortedResults,
      )
      const initialValues = sortedInitialResults.map(
        ([_key, [value, _index]]) => value.value,
      )
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
      const sortedFinalResults = sortByKeyAndIndex(updateResult.sortedResults)
      const finalValues = sortedFinalResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(finalValues).toEqual([0, 1])
    })

    it(`should handle removal of elements from topK`, () => {
      const graph = new D2()
      const input =
        graph.newInput<
          KeyValue<string, { id: string; group: string; value: number }>
        >()
      const tracker = new MessageTracker<
        [string, [{ id: string; group: string; value: number }, string]]
      >()

      input.pipe(
        groupedOrderByWithFractionalIndex((item) => item.value, {
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
      const sortedFinalResults = sortByKeyAndIndex(updateResult.sortedResults)
      const finalValues = sortedFinalResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(finalValues).toEqual([3, 5])
    })

    it(`should handle multiple groups independently`, () => {
      const graph = new D2()
      const input =
        graph.newInput<
          KeyValue<string, { id: string; group: string; value: number }>
        >()
      const tracker = new MessageTracker<
        [string, [{ id: string; group: string; value: number }, string]]
      >()

      const groupKeyFn = (
        _key: string,
        value: { id: string; group: string; value: number },
      ) => value.group

      input.pipe(
        groupedOrderByWithFractionalIndex((item) => item.value, {
          limit: 2,
          groupKeyFn,
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

      // Check initial output: each group should have limit 2
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(initialResult.sortedResults.length).toBe(4)

      // Sort all results by fractional index first, then group by group key
      const sortedInitialResults = sortByKeyAndIndex(
        initialResult.sortedResults,
      )
      const initialGroupedValues = groupResultsByKey(
        sortedInitialResults,
        groupKeyFn,
      )

      // group1 should have values 10, 20 (top 2 by ascending value, ordered by fractional index)
      expect(initialGroupedValues.get(`group1`)).toEqual([10, 20])
      // group2 should have values 5, 15 (top 2 by ascending value, ordered by fractional index)
      expect(initialGroupedValues.get(`group2`)).toEqual([5, 15])

      // Capture the fractional index of value 10 before reset
      const value10Entry = sortedInitialResults.find(
        ([_key, [value, _index]]) =>
          value.value === 10 && value.group === `group1`,
      )
      expect(value10Entry).toBeDefined()
      const [_value10Key, [_value10Value, value10Idx]] = value10Entry!

      tracker.reset()

      // Update only group1 - add a better value
      input.sendData(
        new MultiSet([
          [[`g1-c`, { id: `g1-c`, group: `group1`, value: 5 }], 1],
        ]),
      )
      graph.run()

      const updateResult = tracker.getResult()

      // Should have exactly 2 messages: one removal and one addition
      expect(updateResult.messages.length).toBe(2)

      // Find the removal message (multiplicity -1) and addition message (multiplicity 1)
      const removalMessage = updateResult.messages.find(
        ([_item, mult]) => mult === -1,
      )
      const additionMessage = updateResult.messages.find(
        ([_item, mult]) => mult === 1,
      )

      expect(removalMessage).toBeDefined()
      expect(additionMessage).toBeDefined()

      // Check that removal is for value 20 (g1-b)
      const [_removalKey, [removalValue, _removalIdx]] = removalMessage![0]
      expect(removalValue.value).toBe(20)
      expect(removalValue.id).toBe(`g1-b`)

      // Check that addition is for value 5 (g1-c)
      const [_additionKey, [additionValue, additionIdx]] = additionMessage![0]
      expect(additionValue.value).toBe(5)
      expect(additionValue.id).toBe(`g1-c`)

      // Check that the fractional index of the added value (5) is smaller than the index of value 10
      expect(additionIdx < value10Idx).toBe(true)
    })

    it(`should support offset within groups`, () => {
      const graph = new D2()
      const input =
        graph.newInput<
          KeyValue<string, { id: string; group: string; value: number }>
        >()
      const tracker = new MessageTracker<
        [string, [{ id: string; group: string; value: number }, string]]
      >()

      input.pipe(
        groupedOrderByWithFractionalIndex((item) => item.value, {
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
      const sortedResults = sortByKeyAndIndex(result.sortedResults)
      const values = sortedResults.map(([_key, [value, _index]]) => value.value)
      expect(values).toEqual([2, 3])
    })

    it(`should use custom comparator`, () => {
      const graph = new D2()
      const input =
        graph.newInput<
          KeyValue<string, { id: string; group: string; value: number }>
        >()
      const tracker = new MessageTracker<
        [string, [{ id: string; group: string; value: number }, string]]
      >()

      input.pipe(
        groupedOrderByWithFractionalIndex((item) => item.value, {
          limit: 2,
          groupKeyFn: (_key, value) => value.group,
          // Descending order
          comparator: (a, b) => b - a,
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
        ]),
      )
      graph.run()

      const result = tracker.getResult(compareFractionalIndex)

      // With descending order and limit 2, should get values 3 and 2
      const sortedResults = sortByKeyAndIndex(result.sortedResults)
      const values = sortedResults.map(([_key, [value, _index]]) => value.value)
      expect(values).toEqual([3, 2])
    })

    it(`should use groupKeyFn to extract group from key with delimiter`, () => {
      const graph = new D2()
      // Use keys with format "group:itemId"
      const input =
        graph.newInput<KeyValue<string, { id: string; value: number }>>()
      const tracker = new MessageTracker<
        [string, [{ id: string; value: number }, string]]
      >()

      const groupKeyFn = (key: string, _value: { id: string; value: number }) =>
        key.split(`:`)[0]!

      input.pipe(
        groupedOrderByWithFractionalIndex((item) => item.value, {
          limit: 2,
          // Extract group from key "group:itemId"
          groupKeyFn,
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

      // Sort all results by fractional index first, then group by group key
      const sortedResults = sortByKeyAndIndex(result.sortedResults)
      const groupedValues = groupResultsByKey(sortedResults, groupKeyFn)

      expect(groupedValues.get(`group1`)).toEqual([1, 3])
      expect(groupedValues.get(`group2`)).toEqual([2, 4])
    })

    it(`should support infinite limit (no limit)`, () => {
      const graph = new D2()
      const input =
        graph.newInput<
          KeyValue<string, { id: string; group: string; value: number }>
        >()
      const tracker = new MessageTracker<
        [string, [{ id: string; group: string; value: number }, string]]
      >()

      input.pipe(
        groupedOrderByWithFractionalIndex((item) => item.value, {
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
      const sortedResults = sortByKeyAndIndex(result.sortedResults)
      const values = sortedResults.map(([_key, [value, _index]]) => value.value)
      expect(values).toEqual([1, 3, 5])
    })

    it(`should handle setSizeCallback correctly`, () => {
      const graph = new D2()
      const input =
        graph.newInput<
          KeyValue<string, { id: string; group: string; value: number }>
        >()
      let getSize: (() => number) | undefined

      input.pipe(
        groupedOrderByWithFractionalIndex((item) => item.value, {
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
        graph.newInput<
          KeyValue<string, { id: string; group: string; value: number }>
        >()
      const tracker = new MessageTracker<
        [string, [{ id: string; group: string; value: number }, string]]
      >()
      let windowFn:
        | ((options: { offset?: number; limit?: number }) => void)
        | undefined

      input.pipe(
        groupedOrderByWithFractionalIndex((item) => item.value, {
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
      const sortedInitialResults = sortByKeyAndIndex(
        initialResult.sortedResults,
      )
      const initialValues = sortedInitialResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(initialValues).toEqual([1, 2])

      // Move window to offset 1
      windowFn!({ offset: 1 })
      graph.run()

      // Now should have values 2, 3
      const movedResult = tracker.getResult(compareFractionalIndex)
      const sortedMovedResults = sortByKeyAndIndex(movedResult.sortedResults)
      const movedValues = sortedMovedResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(movedValues).toEqual([2, 3])
    })

    it(`should cleanup empty groups`, () => {
      const graph = new D2()
      const input =
        graph.newInput<
          KeyValue<string, { id: string; group: string; value: number }>
        >()
      const tracker = new MessageTracker<
        [string, [{ id: string; group: string; value: number }, string]]
      >()

      input.pipe(
        groupedOrderByWithFractionalIndex((item) => item.value, {
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

    it(`should order by string property`, () => {
      const graph = new D2()
      const input =
        graph.newInput<
          KeyValue<string, { id: string; group: string; name: string }>
        >()
      const tracker = new MessageTracker<
        [string, [{ id: string; group: string; name: string }, string]]
      >()

      input.pipe(
        groupedOrderByWithFractionalIndex((item) => item.name, {
          limit: 2,
          groupKeyFn: (_key, value) => value.group,
        }),
        output((message) => {
          tracker.addMessage(message)
        }),
      )

      graph.finalize()

      input.sendData(
        new MultiSet([
          [[`g1-a`, { id: `g1-a`, group: `group1`, name: `charlie` }], 1],
          [[`g1-b`, { id: `g1-b`, group: `group1`, name: `alice` }], 1],
          [[`g1-c`, { id: `g1-c`, group: `group1`, name: `bob` }], 1],
        ]),
      )
      graph.run()

      const result = tracker.getResult(compareFractionalIndex)
      const sortedResults = sortByKeyAndIndex(result.sortedResults)
      const names = sortedResults.map(([_key, [value, _index]]) => value.name)
      expect(names).toEqual([`alice`, `bob`])
    })
  })
})

/**
 * Helper function to sort results by key and then index
 */
function sortByKeyAndIndex(results: Array<any>) {
  return [...results]
    .sort(
      (
        [[_aKey, [_aValue, _aIndex]], aMultiplicity],
        [[_bKey, [_bValue, _bIndex]], bMultiplicity],
      ) => aMultiplicity - bMultiplicity,
    )
    .sort(
      (
        [[aKey, [_aValue, _aIndex]], _aMultiplicity],
        [[bKey, [_bValue, _bIndex]], _bMultiplicity],
      ) => {
        // Compare keys - handle string, array, and numeric keys
        if (typeof aKey === 'number' && typeof bKey === 'number') {
          return aKey - bKey
        }
        // For string or array keys, convert to string for comparison
        const aKeyStr = Array.isArray(aKey) ? aKey.join(',') : String(aKey)
        const bKeyStr = Array.isArray(bKey) ? bKey.join(',') : String(bKey)
        return aKeyStr < bKeyStr ? -1 : aKeyStr > bKeyStr ? 1 : 0
      },
    )
    .sort(
      (
        [[_aKey, [_aValue, aIndex]], _aMultiplicity],
        [[_bKey, [_bValue, bIndex]], _bMultiplicity],
      ) => {
        // lexically compare the index
        return aIndex < bIndex ? -1 : aIndex > bIndex ? 1 : 0
      },
    )
}

/**
 * Helper function to group sorted results by group key and extract values.
 * Results should already be sorted by fractional index.
 * Returns a Map of group key -> array of values (ordered by fractional index).
 */
function groupResultsByKey<TGroupKey extends string | number>(
  sortedResults: Array<any>,
  groupKeyFn: (key: any, value: any) => TGroupKey,
): Map<TGroupKey, Array<number>> {
  const groupedValues = new Map<TGroupKey, Array<number>>()
  for (const [key, [value, _index]] of sortedResults) {
    const group = groupKeyFn(key, value)
    const list = groupedValues.get(group) ?? []
    // Extract the numeric value from the value object
    list.push((value as { value: number }).value)
    groupedValues.set(group, list)
  }
  return groupedValues
}
