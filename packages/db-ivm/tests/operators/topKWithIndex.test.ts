import { describe, expect, test } from "vitest"
import { D2 } from "../../src/d2.js"
import { MultiSet } from "../../src/multiset.js"
import { output } from "../../src/operators/index.js"
import { topKWithIndex } from "../../src/operators/topK.js"
import {
  MessageTracker,
  assertOnlyKeysAffected,
  assertResults,
} from "../test-utils.js"

describe(`Operators`, () => {
  describe(`TopKWithIndex operation`, () => {
    test(`initial results with limit - no key`, () => {
      const graph = new D2()
      const input = graph.newInput<
        [
          null,
          {
            id: number
            value: string
          },
        ]
      >()
      let latestMessage: any = null

      input.pipe(
        topKWithIndex((a, b) => a.value.localeCompare(b.value), { limit: 3 }),
        output((message) => {
          latestMessage = message
        })
      )

      graph.finalize()

      input.sendData(
        new MultiSet([
          [[null, { id: 1, value: `a` }], 1],
          [[null, { id: 2, value: `z` }], 1],
          [[null, { id: 3, value: `b` }], 1],
          [[null, { id: 4, value: `y` }], 1],
          [[null, { id: 5, value: `c` }], 1],
        ])
      )
      graph.run()

      expect(latestMessage).not.toBeNull()

      const result = latestMessage.getInner()
      const sortedResult = sortByIndexAndId(result)

      expect(sortedResult).toEqual([
        [[null, [{ id: 1, value: `a` }, 0]], 1],
        [[null, [{ id: 3, value: `b` }, 1]], 1],
        [[null, [{ id: 5, value: `c` }, 2]], 1],
      ])
    })

    test(`initial results with limit and offset - no key`, () => {
      const graph = new D2()
      const input = graph.newInput<
        [
          null,
          {
            id: number
            value: string
          },
        ]
      >()
      let latestMessage: any = null
      input.pipe(
        topKWithIndex((a, b) => a.value.localeCompare(b.value), {
          limit: 3,
          offset: 2,
        }),
        output((message) => {
          latestMessage = message
        })
      )

      graph.finalize()

      input.sendData(
        new MultiSet([
          [[null, { id: 1, value: `a` }], 1],
          [[null, { id: 2, value: `z` }], 1],
          [[null, { id: 3, value: `b` }], 1],
          [[null, { id: 4, value: `y` }], 1],
          [[null, { id: 5, value: `c` }], 1],
        ])
      )
      graph.run()

      expect(latestMessage).not.toBeNull()

      const result = latestMessage.getInner()
      const sortedResult = sortByIndexAndId(result)

      expect(sortedResult).toEqual([
        [[null, [{ id: 5, value: `c` }, 2]], 1],
        [[null, [{ id: 4, value: `y` }, 3]], 1],
        [[null, [{ id: 2, value: `z` }, 4]], 1],
      ])
    })

    test(`initial results with limit - with key`, () => {
      const graph = new D2()
      const input = graph.newInput<
        [
          string,
          {
            id: number
            value: string
          },
        ]
      >()
      let latestMessage: any = null

      input.pipe(
        topKWithIndex((a, b) => a.value.localeCompare(b.value), { limit: 3 }),
        output((message) => {
          latestMessage = message
        })
      )

      graph.finalize()

      input.sendData(
        new MultiSet([
          [[`one`, { id: 1, value: `9` }], 1],
          [[`one`, { id: 2, value: `8` }], 1],
          [[`one`, { id: 3, value: `7` }], 1],
          [[`one`, { id: 4, value: `6` }], 1],
          [[`one`, { id: 5, value: `5` }], 1],
          [[`two`, { id: 6, value: `4` }], 1],
          [[`two`, { id: 7, value: `3` }], 1],
          [[`two`, { id: 8, value: `2` }], 1],
          [[`two`, { id: 9, value: `1` }], 1],
          [[`two`, { id: 10, value: `0` }], 1],
        ])
      )
      graph.run()

      expect(latestMessage).not.toBeNull()

      const result = latestMessage.getInner()
      const sortedResult = sortByKeyIndexAndId(result)

      expect(sortedResult).toEqual([
        [[`one`, [{ id: 5, value: `5` }, 0]], 1],
        [[`one`, [{ id: 4, value: `6` }, 1]], 1],
        [[`one`, [{ id: 3, value: `7` }, 2]], 1],
        [[`two`, [{ id: 10, value: `0` }, 0]], 1],
        [[`two`, [{ id: 9, value: `1` }, 1]], 1],
        [[`two`, [{ id: 8, value: `2` }, 2]], 1],
      ])
    })

    test(`incremental update - removing a row`, () => {
      const graph = new D2()
      const input = graph.newInput<
        [
          null,
          {
            id: number
            value: string
          },
        ]
      >()
      const tracker = new MessageTracker<
        [null, [{ id: number; value: string }, number]]
      >()

      input.pipe(
        topKWithIndex((a, b) => a.value.localeCompare(b.value), { limit: 3 }),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // Initial data
      input.sendData(
        new MultiSet([
          [[null, { id: 1, value: `a` }], 1],
          [[null, { id: 2, value: `b` }], 1],
          [[null, { id: 3, value: `c` }], 1],
          [[null, { id: 4, value: `d` }], 1],
        ])
      )
      graph.run()

      // Check initial state - should have top 3 items with indices
      const initialResult = tracker.getResult()
      assertResults(
        `topK initial - remove row test`,
        initialResult,
        [
          [null, [{ id: 1, value: `a` }, 0]],
          [null, [{ id: 2, value: `b` }, 1]],
          [null, [{ id: 3, value: `c` }, 2]],
        ],
        4 // Max expected messages for initial data
      )

      tracker.reset()

      // Remove 'b' from the result set
      input.sendData(new MultiSet([[[null, { id: 2, value: `b` }], -1]]))
      graph.run()

      // After removing 'b', we should get incremental changes
      // The important thing is that we get a reasonable number of messages
      // and that only the affected key (null) produces output
      const updateResult = tracker.getResult()

      // Verify we got a reasonable number of messages (not the entire dataset)
      expect(updateResult.messageCount).toBeLessThanOrEqual(8) // Should be incremental, not full recompute
      expect(updateResult.messageCount).toBeGreaterThan(0) // Should have some changes

      // The materialized result should have some entries (items with positive multiplicity)
      expect(updateResult.sortedResults.length).toBeGreaterThan(0)

      // Check that the messages only affect the null key (verify incremental processing)
      assertOnlyKeysAffected(`topK remove row`, updateResult.messages, [null])
    })

    test(`incremental update - adding rows that push existing rows out of limit window`, () => {
      const graph = new D2()
      const input = graph.newInput<
        [
          null,
          {
            id: number
            value: string
          },
        ]
      >()
      let latestMessage: any = null

      input.pipe(
        topKWithIndex((a, b) => a.value.localeCompare(b.value), { limit: 3 }),
        output((message) => {
          latestMessage = message
        })
      )

      graph.finalize()

      // Initial data
      input.sendData(
        new MultiSet([
          [[null, { id: 1, value: `c` }], 1],
          [[null, { id: 2, value: `d` }], 1],
          [[null, { id: 3, value: `e` }], 1],
        ])
      )
      graph.run()

      // Initial result should be all three items with indices
      let result = latestMessage.getInner()
      let sortedResult = sortByIndexAndId(result)
      expect(sortedResult).toEqual([
        [[null, [{ id: 1, value: `c` }, 0]], 1],
        [[null, [{ id: 2, value: `d` }, 1]], 1],
        [[null, [{ id: 3, value: `e` }, 2]], 1],
      ])

      // Add two new rows that should appear before existing rows
      input.sendData(
        new MultiSet([
          [[null, { id: 4, value: `a` }], 1],
          [[null, { id: 5, value: `b` }], 1],
        ])
      )
      graph.run()

      // Result should show:
      // - 'a' and 'b' being added at indices 0 and 1
      // - 'c' moving from index 0 to 2
      // - 'd' and 'e' being removed as they're pushed out of the limit window
      result = latestMessage.getInner()
      sortedResult = sortByMultiplicityIndexAndId(result)

      expect(sortedResult).toEqual([
        [[null, [{ id: 1, value: `c` }, 0]], -1], // 'c' removed from old index 0
        [[null, [{ id: 2, value: `d` }, 1]], -1], // 'd' removed from index 1
        [[null, [{ id: 3, value: `e` }, 2]], -1], // 'e' removed from index 2
        [[null, [{ id: 4, value: `a` }, 0]], 1], // New row at index 0
        [[null, [{ id: 5, value: `b` }, 1]], 1], // New row at index 1
        [[null, [{ id: 1, value: `c` }, 2]], 1], // 'c' added at new index 2
      ])
    })

    test(`incremental update - changing a value that affects ordering`, () => {
      const graph = new D2()
      const input = graph.newInput<
        [
          null,
          {
            id: number
            value: string
          },
        ]
      >()
      let latestMessage: any = null

      input.pipe(
        topKWithIndex((a, b) => a.value.localeCompare(b.value), { limit: 3 }),
        output((message) => {
          latestMessage = message
        })
      )

      graph.finalize()

      // Initial data
      input.sendData(
        new MultiSet([
          [[null, { id: 1, value: `a` }], 1],
          [[null, { id: 2, value: `b` }], 1],
          [[null, { id: 3, value: `c` }], 1],
        ])
      )
      graph.run()

      // Initial result should be all three items with indices
      let result = latestMessage.getInner()
      let sortedResult = sortByIndexAndId(result)
      expect(sortedResult).toEqual([
        [[null, [{ id: 1, value: `a` }, 0]], 1],
        [[null, [{ id: 2, value: `b` }, 1]], 1],
        [[null, [{ id: 3, value: `c` }, 2]], 1],
      ])

      // Change 'a' to 'z' which should move it to the end, outside the limit
      input.sendData(
        new MultiSet([
          [[null, { id: 1, value: `a` }], -1],
          [[null, { id: 1, value: `z` }], 1],
        ])
      )
      graph.run()

      // Result should show:
      // - 'a' being removed from index 0
      // - 'b' moving from index 1 to 0
      // - 'c' moving from index 2 to 1
      // - 'z' being added at index 2
      result = latestMessage.getInner()
      sortedResult = sortByMultiplicityIndexAndId(result)

      expect(sortedResult).toEqual([
        [[null, [{ id: 1, value: `a` }, 0]], -1], // 'a' removed from index 0
        [[null, [{ id: 2, value: `b` }, 1]], -1], // 'b' removed from old index 1
        [[null, [{ id: 3, value: `c` }, 2]], -1], // 'c' removed from old index 2
        [[null, [{ id: 2, value: `b` }, 0]], 1], // 'b' added at new index 0
        [[null, [{ id: 3, value: `c` }, 1]], 1], // 'c' added at new index 1
        [[null, [{ id: 1, value: `z` }, 2]], 1], // 'z' added at index 2
      ])
    })

    test(`incremental update with offset - items moving in and out of window`, () => {
      const graph = new D2()
      const input = graph.newInput<
        [
          null,
          {
            id: number
            value: string
          },
        ]
      >()
      let latestMessage: any = null

      input.pipe(
        topKWithIndex((a, b) => a.value.localeCompare(b.value), {
          limit: 2,
          offset: 1,
        }),
        output((message) => {
          latestMessage = message
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

      // Initial result should be b, c (offset 1, limit 2)
      let result = latestMessage.getInner()
      let sortedResult = sortByIndexAndId(result)
      expect(sortedResult).toEqual([
        [[null, [{ id: 2, value: `b` }, 1]], 1],
        [[null, [{ id: 3, value: `c` }, 2]], 1],
      ])

      // Add a new item 'aa' that should be between 'a' and 'b'
      input.sendData(new MultiSet([[[null, { id: 6, value: `aa` }], 1]]))
      graph.run()

      // Result should show:
      // - 'aa' being added at index 1
      // - 'b' moving from index 1 to 2
      // - 'c' being removed as it's pushed out of the window
      result = latestMessage.getInner()
      sortedResult = sortByMultiplicityIndexAndId(result)

      expect(sortedResult).toEqual([
        [[null, [{ id: 2, value: `b` }, 1]], -1], // 'b' removed from old index 1
        [[null, [{ id: 3, value: `c` }, 2]], -1], // 'c' removed from index 2
        [[null, [{ id: 6, value: `aa` }, 1]], 1], // 'aa' added at index 1
        [[null, [{ id: 2, value: `b` }, 2]], 1], // 'b' added at new index 2
      ])
    })
  })
})

/**
 * Helper function to sort results by index and then id
 */
function sortByIndexAndId(results: Array<any>) {
  return [...results].sort(
    (
      [[_aKey, [aValue, aIndex]], _aMultiplicity],
      [[_bKey, [bValue, bIndex]], _bMultiplicity]
    ) => {
      // First sort by index
      if (aIndex !== bIndex) {
        return aIndex - bIndex
      }
      // Then by id if indices are the same
      return aValue.id - bValue.id
    }
  )
}

/**
 * Helper function to sort results by key, then index, then id
 */
function sortByKeyIndexAndId(results: Array<any>) {
  return [...results].sort(
    (
      [[aKey, [aValue, aIndex]], _aMultiplicity],
      [[bKey, [bValue, bIndex]], _bMultiplicity]
    ) => {
      // First sort by key
      if (aKey !== bKey) {
        return aKey < bKey ? -1 : 1
      }
      // Then by index
      if (aIndex !== bIndex) {
        return aIndex - bIndex
      }
      // Then by id if indices are the same
      return aValue.id - bValue.id
    }
  )
}

/**
 * Helper function to sort results by multiplicity, then index, then id
 */
function sortByMultiplicityIndexAndId(results: Array<any>) {
  return [...results].sort(
    (
      [[_aKey, [aValue, aIndex]], aMultiplicity],
      [[_bKey, [bValue, bIndex]], bMultiplicity]
    ) => {
      // First sort by multiplicity
      if (aMultiplicity !== bMultiplicity) {
        return aMultiplicity - bMultiplicity
      }
      // Then by index
      if (aIndex !== bIndex) {
        return aIndex - bIndex
      }
      // Then by id if indices are the same
      return aValue.id - bValue.id
    }
  )
}
