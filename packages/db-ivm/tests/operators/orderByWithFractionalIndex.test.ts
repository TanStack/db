import { beforeAll, describe, expect, test } from "vitest"
import { D2 } from "../../src/d2.js"
import { MultiSet } from "../../src/multiset.js"
import {
  orderByWithFractionalIndex,
  output,
} from "../../src/operators/index.js"
import { orderByWithFractionalIndexBTree } from "../../src/operators/orderByBTree.js"
import { loadBTree } from "../../src/operators/topKWithFractionalIndexBTree.js"
import { MessageTracker, compareFractionalIndex } from "../test-utils.js"
import type { KeyValue } from "../../src/types.js"

const stripFractionalIndex = ([[key, [value, _index]], multiplicity]: any) => [
  key,
  value,
  multiplicity,
]

const stripFractionalIndexWithoutMultiplicity = (
  r: [string, [{ id: number; value: string }, string]]
) => [r[0], r[1][0]]

beforeAll(async () => {
  await loadBTree()
})

describe(`Operators`, () => {
  describe.each([
    [`with array`, { orderBy: orderByWithFractionalIndex }],
    [`with B+ tree`, { orderBy: orderByWithFractionalIndexBTree }],
  ])(`OrderByWithFractionalIndex operator %s`, (_, { orderBy }) => {
    test(`initial results with default comparator`, () => {
      const graph = new D2()
      const input = graph.newInput<
        KeyValue<
          string,
          {
            id: number
            value: string
          }
        >
      >()
      let latestMessage: any = null

      input.pipe(
        orderBy((item) => item.value, { groupByKey: false }),
        output((message) => {
          latestMessage = message
        })
      )

      graph.finalize()

      input.sendData(
        new MultiSet([
          [[`key1`, { id: 1, value: `a` }], 1],
          [[`key2`, { id: 2, value: `z` }], 1],
          [[`key3`, { id: 3, value: `b` }], 1],
          [[`key4`, { id: 4, value: `y` }], 1],
          [[`key5`, { id: 5, value: `c` }], 1],
        ])
      )

      graph.run()

      expect(latestMessage).not.toBeNull()

      const result = latestMessage.getInner()
      const sortedResult = sortByKeyAndIndex(result).map(stripFractionalIndex)

      expect(sortedResult).toEqual([
        [`key1`, { id: 1, value: `a` }, 1],
        [`key3`, { id: 3, value: `b` }, 1],
        [`key5`, { id: 5, value: `c` }, 1],
        [`key4`, { id: 4, value: `y` }, 1],
        [`key2`, { id: 2, value: `z` }, 1],
      ])
    })

    test(`initial results with custom comparator`, () => {
      const graph = new D2()
      const input = graph.newInput<
        KeyValue<
          string,
          {
            id: number
            value: string
          }
        >
      >()
      let latestMessage: any = null

      input.pipe(
        orderBy((item) => item.value, {
          comparator: (a, b) => b.localeCompare(a), // reverse order
          groupByKey: false,
        }),
        output((message) => {
          latestMessage = message
        })
      )

      graph.finalize()

      input.sendData(
        new MultiSet([
          [[`key1`, { id: 1, value: `a` }], 1],
          [[`key2`, { id: 2, value: `z` }], 1],
          [[`key3`, { id: 3, value: `b` }], 1],
          [[`key4`, { id: 4, value: `y` }], 1],
          [[`key5`, { id: 5, value: `c` }], 1],
        ])
      )

      graph.run()

      expect(latestMessage).not.toBeNull()

      const result = latestMessage.getInner()
      const sortedResult = sortByKeyAndIndex(result).map(stripFractionalIndex)

      expect(sortedResult).toEqual([
        [`key2`, { id: 2, value: `z` }, 1],
        [`key4`, { id: 4, value: `y` }, 1],
        [`key5`, { id: 5, value: `c` }, 1],
        [`key3`, { id: 3, value: `b` }, 1],
        [`key1`, { id: 1, value: `a` }, 1],
      ])
    })

    test(`initial results with limit`, () => {
      const graph = new D2()
      const input = graph.newInput<
        KeyValue<
          string,
          {
            id: number
            value: string
          }
        >
      >()
      let latestMessage: any = null

      input.pipe(
        orderBy((item) => item.value, { limit: 3, groupByKey: false }),
        output((message) => {
          latestMessage = message
        })
      )

      graph.finalize()

      input.sendData(
        new MultiSet([
          [[`key1`, { id: 1, value: `a` }], 1],
          [[`key2`, { id: 2, value: `z` }], 1],
          [[`key3`, { id: 3, value: `b` }], 1],
          [[`key4`, { id: 4, value: `y` }], 1],
          [[`key5`, { id: 5, value: `c` }], 1],
        ])
      )

      graph.run()

      expect(latestMessage).not.toBeNull()

      const result = latestMessage.getInner()
      const sortedResult = sortByKeyAndIndex(result).map(stripFractionalIndex)

      expect(sortedResult).toEqual([
        [`key1`, { id: 1, value: `a` }, 1],
        [`key3`, { id: 3, value: `b` }, 1],
        [`key5`, { id: 5, value: `c` }, 1],
      ])
    })

    test(`initial results with limit and offset`, () => {
      const graph = new D2()
      const input = graph.newInput<
        KeyValue<
          string,
          {
            id: number
            value: string
          }
        >
      >()
      let latestMessage: any = null

      input.pipe(
        orderBy((item) => item.value, {
          limit: 2,
          offset: 2,
          groupByKey: false,
        }),
        output((message) => {
          latestMessage = message
        })
      )

      graph.finalize()

      input.sendData(
        new MultiSet([
          [[`key1`, { id: 1, value: `a` }], 1],
          [[`key2`, { id: 2, value: `z` }], 1],
          [[`key3`, { id: 3, value: `b` }], 1],
          [[`key4`, { id: 4, value: `y` }], 1],
          [[`key5`, { id: 5, value: `c` }], 1],
        ])
      )

      graph.run()

      expect(latestMessage).not.toBeNull()

      const result = latestMessage.getInner()
      const sortedResult = sortByKeyAndIndex(result).map(stripFractionalIndex)

      expect(sortedResult).toEqual([
        [`key5`, { id: 5, value: `c` }, 1],
        [`key4`, { id: 4, value: `y` }, 1],
      ])
    })

    test(`per-key limits applied by default`, () => {
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
      let latestMessage: any = null

      input.pipe(
        orderBy((item) => item.value, { limit: 2 }),
        output((message) => {
          latestMessage = message
        })
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
        ])
      )

      graph.run()

      expect(latestMessage).not.toBeNull()

      const result = latestMessage.getInner()
      const groupedValues = new Map<string, Array<number>>()

      for (const [[key, [value]], multiplicity] of result) {
        if (multiplicity !== 1) continue
        const group = Array.isArray(key)
          ? (key as Array<string>)[0]!
          : String(key)
        const list = groupedValues.get(group) ?? []
        list.push((value as { value: number }).value)
        groupedValues.set(group, list)
      }

      for (const [group, values] of groupedValues) {
        values.sort((a, b) => a - b)
        groupedValues.set(group, values)
      }

      expect(groupedValues.get(`group1`)).toEqual([1, 3])
      expect(groupedValues.get(`group2`)).toEqual([2, 4])
    })

    test(`per-key limits stay correct through incremental updates`, () => {
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

      input.pipe(
        orderBy((item) => item.value, { limit: 2 }),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      const seedData: Array<
        [[[string, string], { id: string; value: number }], number]
      > = [
        [[[`group1`, `a`], { id: `g1-a`, value: 5 }], 1],
        [[[`group1`, `b`], { id: `g1-b`, value: 1 }], 1],
        [[[`group1`, `c`], { id: `g1-c`, value: 3 }], 1],
        [[[`group2`, `a`], { id: `g2-a`, value: 4 }], 1],
        [[[`group2`, `b`], { id: `g2-b`, value: 2 }], 1],
        [[[`group2`, `c`], { id: `g2-c`, value: 6 }], 1],
      ]

      const collectStateFromResults = (
        entries: Array<
          [[string, string], [{ id: string; value: number }, string]]
        >
      ) => {
        const grouped = new Map<string, Array<number>>()
        for (const [keyLike, [value]] of entries) {
          const group = Array.isArray(keyLike) ? keyLike[0] : String(keyLike)
          const list = grouped.get(group) ?? []
          list.push(value.value)
          grouped.set(group, list)
        }
        for (const [group, values] of grouped) {
          values.sort((a, b) => a - b)
          grouped.set(group, values)
        }
        return grouped
      }

      // Seed the data
      input.sendData(new MultiSet(seedData))
      graph.run()

      const initial = tracker.getResult(compareFractionalIndex)
      let messageOffset = initial.messages.length
      let currentGroups = collectStateFromResults(initial.sortedResults)
      expect(currentGroups.get(`group1`)).toEqual([1, 3])
      expect(currentGroups.get(`group2`)).toEqual([2, 4])

      // Insert a better value into group1 - should evict the previous second entry
      input.sendData(
        new MultiSet([[[[`group1`, `d`], { id: `g1-d`, value: 0 }], 1]])
      )
      graph.run()

      const afterInsert = tracker.getResult(compareFractionalIndex)
      const group1Delta = afterInsert.messages.slice(messageOffset)
      messageOffset = afterInsert.messages.length

      const group1Messages = sortByKeyAndIndex(
        group1Delta as Array<
          [[[string, string], [{ id: string; value: number }, string]], number]
        >
      ).map(stripFractionalIndex)
      expect(group1Messages).toHaveLength(2)
      expect(group1Messages).toEqual(
        expect.arrayContaining([
          [[`group1`, `c`], { id: `g1-c`, value: 3 }, -1],
          [[`group1`, `d`], { id: `g1-d`, value: 0 }, 1],
        ])
      )

      currentGroups = collectStateFromResults(afterInsert.sortedResults)
      expect(currentGroups.get(`group1`)).toEqual([0, 1])
      expect(currentGroups.get(`group2`)).toEqual([2, 4])
    })

    test(`ordering by numeric property`, () => {
      const graph = new D2()
      const input = graph.newInput<
        KeyValue<
          string,
          {
            id: number
            value: string
          }
        >
      >()
      let latestMessage: any = null

      input.pipe(
        orderBy((item) => item.id, { groupByKey: false }),
        output((message) => {
          latestMessage = message
        })
      )

      graph.finalize()

      input.sendData(
        new MultiSet([
          [[`key5`, { id: 5, value: `e` }], 1],
          [[`key3`, { id: 3, value: `c` }], 1],
          [[`key1`, { id: 1, value: `a` }], 1],
          [[`key4`, { id: 4, value: `d` }], 1],
          [[`key2`, { id: 2, value: `b` }], 1],
        ])
      )

      graph.run()

      expect(latestMessage).not.toBeNull()

      const result = latestMessage.getInner()
      const sortedResult = sortByKeyAndIndex(result).map(stripFractionalIndex)

      expect(sortedResult).toEqual([
        [`key1`, { id: 1, value: `a` }, 1],
        [`key2`, { id: 2, value: `b` }, 1],
        [`key3`, { id: 3, value: `c` }, 1],
        [`key4`, { id: 4, value: `d` }, 1],
        [`key5`, { id: 5, value: `e` }, 1],
      ])
    })

    test(`incremental update - adding a new row`, () => {
      const graph = new D2()
      const input = graph.newInput<
        KeyValue<
          string,
          {
            id: number
            value: string
          }
        >
      >()
      let latestMessage: any = null

      input.pipe(
        orderBy((item) => item.value, { limit: 3, groupByKey: false }),
        output((message) => {
          latestMessage = message
        })
      )

      graph.finalize()

      // Initial data
      input.sendData(
        new MultiSet([
          [[`key1`, { id: 1, value: `a` }], 1],
          [[`key3`, { id: 3, value: `c` }], 1],
          [[`key2`, { id: 2, value: `b` }], 1],
        ])
      )
      graph.run()

      expect(latestMessage).not.toBeNull()

      const initialResult = latestMessage.getInner()
      const sortedInitialResult =
        sortByKeyAndIndex(initialResult).map(stripFractionalIndex)

      expect(sortedInitialResult).toEqual([
        [`key1`, { id: 1, value: `a` }, 1],
        [`key2`, { id: 2, value: `b` }, 1],
        [`key3`, { id: 3, value: `c` }, 1],
      ])

      // Add a new row that should be included in the top 3
      input.sendData(
        new MultiSet([
          [[`key4`, { id: 4, value: `aa` }], 1], // Should be second in order
        ])
      )
      graph.run()

      expect(latestMessage).not.toBeNull()

      const result = latestMessage.getInner()
      const sortedResult = sortByKeyAndIndex(result).map(stripFractionalIndex)

      expect(sortedResult).toEqual([
        // We dont get key1 as its not changed or moved
        [`key4`, { id: 4, value: `aa` }, 1], // New row
        [`key3`, { id: 3, value: `c` }, -1], // key3 is removed as its moved out of top 3
      ])
    })

    test(`incremental update - removing a row`, () => {
      const graph = new D2()
      const input = graph.newInput<
        KeyValue<
          string,
          {
            id: number
            value: string
          }
        >
      >()
      const tracker = new MessageTracker<
        [string, [{ id: number; value: string }, string]]
      >()

      input.pipe(
        orderBy((item) => item.value, { limit: 3, groupByKey: false }),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // Initial data
      input.sendData(
        new MultiSet([
          [[`key1`, { id: 1, value: `a` }], 1],
          [[`key3`, { id: 3, value: `c` }], 1],
          [[`key2`, { id: 2, value: `b` }], 1],
          [[`key4`, { id: 4, value: `d` }], 1],
        ])
      )
      graph.run()

      const initialResult = tracker.getResult(compareFractionalIndex)
      // Should have the top 3 items by value
      expect(initialResult.sortedResults.length).toBe(3)
      expect(initialResult.messageCount).toBeLessThanOrEqual(4) // Should be efficient

      expect(
        initialResult.sortedResults.map(stripFractionalIndexWithoutMultiplicity)
      ).toEqual([
        [`key1`, { id: 1, value: `a` }],
        [`key2`, { id: 2, value: `b` }],
        [`key3`, { id: 3, value: `c` }],
      ])

      tracker.reset()

      // Remove a row that was in the top 3
      input.sendData(
        new MultiSet([
          [[`key1`, { id: 1, value: `a` }], -1], // Remove the first item
        ])
      )
      graph.run()

      const updateResult = tracker.getResult(compareFractionalIndex)

      // The incremental messages should tell us that key1 is no longer in the top K
      // and that key4 entered the top K
      expect(updateResult.messages.length).toBe(2)
      const sortedKeysAndMultiplicities = updateResult.messages
        .map(([[key, _v], multiplicity]) => [key, multiplicity])
        .sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0))
      expect(sortedKeysAndMultiplicities).toEqual([
        [`key1`, -1],
        [`key4`, 1],
      ])
    })

    test(`incremental update - modifying a row`, () => {
      const graph = new D2()
      const input = graph.newInput<
        KeyValue<
          string,
          {
            id: number
            value: string
          }
        >
      >()
      const tracker = new MessageTracker<
        [string, [{ id: number; value: string }, string]]
      >()

      input.pipe(
        orderBy((item) => item.value, { limit: 3, groupByKey: false }),
        output((message) => {
          tracker.addMessage(message)
        })
      )

      graph.finalize()

      // Initial data
      input.sendData(
        new MultiSet([
          [[`key1`, { id: 1, value: `a` }], 1],
          [[`key2`, { id: 2, value: `c` }], 1],
          [[`key3`, { id: 3, value: `b` }], 1],
          [[`key4`, { id: 4, value: `d` }], 1],
        ])
      )
      graph.run()

      // Should have the top 3 items by value
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(
        initialResult.sortedResults.map(stripFractionalIndexWithoutMultiplicity)
      ).toEqual([
        [`key1`, { id: 1, value: `a` }],
        [`key3`, { id: 3, value: `b` }],
        [`key2`, { id: 2, value: `c` }],
      ])
      expect(initialResult.messageCount).toBeLessThanOrEqual(4) // Should be efficient

      tracker.reset()

      // Modify an existing row by removing it and adding a new version
      input.sendData(
        new MultiSet([
          [[`key2`, { id: 2, value: `c` }], -1], // Remove old version
          [[`key2`, { id: 2, value: `z` }], 1], // Add new version with different value
        ])
      )
      graph.run()

      const updateResult = tracker.getResult(compareFractionalIndex)
      // Should have efficient incremental update
      expect(updateResult.messageCount).toBeLessThanOrEqual(6) // Should be incremental (modify operation)
      expect(updateResult.messageCount).toBeGreaterThan(0) // Should have changes

      // The incremental messages should tell us that key2 is no longer in the top K
      // and that key4 entered the top K
      expect(updateResult.messages.length).toBe(2)
      const sortedKeysAndMultiplicities = updateResult.messages
        .map(([[key, _v], multiplicity]) => [key, multiplicity])
        .sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0))
      expect(sortedKeysAndMultiplicities).toEqual([
        [`key2`, -1],
        [`key4`, 1],
      ])
    })
  })

  describe(`OrderByWithFractionalIndex operator with array`, () => {
    test(`should support moving orderBy window past current window using setWindowFn callback`, () => {
      const graph = new D2()
      const input = graph.newInput<
        KeyValue<
          string,
          {
            id: number
            value: string
          }
        >
      >()
      const tracker = new MessageTracker<
        [string, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        | ((options: { offset?: number; limit?: number }) => void)
        | undefined

      input.pipe(
        orderByWithFractionalIndex((item) => item.value, {
          limit: 3,
          offset: 0,
          groupByKey: false,
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
          [[`key1`, { id: 1, value: `a` }], 1],
          [[`key2`, { id: 2, value: `b` }], 1],
          [[`key3`, { id: 3, value: `c` }], 1],
          [[`key4`, { id: 4, value: `d` }], 1],
          [[`key5`, { id: 5, value: `e` }], 1],
          [[`key6`, { id: 6, value: `f` }], 1],
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

      // Move the window to show elements d, e, f (offset: 3, limit: 3)
      windowFn!({ offset: 3, limit: 3 })
      graph.run()

      const moveResult = tracker.getResult(compareFractionalIndex)

      // Should now show d, e, f
      const moveSortedValues = moveResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(moveSortedValues).toEqual([`d`, `e`, `f`])
    })

    test(`should support moving orderBy window before current window using setWindowFn callback`, () => {
      const graph = new D2()
      const input = graph.newInput<
        KeyValue<
          string,
          {
            id: number
            value: string
          }
        >
      >()
      const tracker = new MessageTracker<
        [string, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        | ((options: { offset?: number; limit?: number }) => void)
        | undefined

      input.pipe(
        orderByWithFractionalIndex((item) => item.value, {
          limit: 3,
          offset: 3,
          groupByKey: false,
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
          [[`key1`, { id: 1, value: `a` }], 1],
          [[`key2`, { id: 2, value: `b` }], 1],
          [[`key3`, { id: 3, value: `c` }], 1],
          [[`key4`, { id: 4, value: `d` }], 1],
          [[`key5`, { id: 5, value: `e` }], 1],
          [[`key6`, { id: 6, value: `f` }], 1],
        ])
      )
      graph.run()

      // Initial result should have elements d, e, f
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

      // Move the window to show elements a, b, c (offset: 0, limit: 3)
      windowFn!({ offset: 0, limit: 3 })
      graph.run()

      const moveResult = tracker.getResult(compareFractionalIndex)

      // Should now show a, b, c
      const moveSortedValues = moveResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(moveSortedValues).toEqual([`a`, `b`, `c`])
    })

    test(`should support moving offset while keeping limit constant`, () => {
      const graph = new D2()
      const input = graph.newInput<
        KeyValue<
          string,
          {
            id: number
            value: string
          }
        >
      >()
      const tracker = new MessageTracker<
        [string, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        | ((options: { offset?: number; limit?: number }) => void)
        | null = null

      input.pipe(
        orderByWithFractionalIndex((item) => item.value, {
          limit: 2,
          offset: 0,
          groupByKey: false,
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
          [[`key1`, { id: 1, value: `a` }], 1],
          [[`key2`, { id: 2, value: `b` }], 1],
          [[`key3`, { id: 3, value: `c` }], 1],
          [[`key4`, { id: 4, value: `d` }], 1],
          [[`key5`, { id: 5, value: `e` }], 1],
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

      // Move offset to 1, keeping limit at 2 (should show b, c)
      windowFn!({ offset: 1, limit: 2 })
      graph.run()

      const moveResult = tracker.getResult(compareFractionalIndex)

      const moveSortedValues = moveResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value
      )
      expect(moveSortedValues).toEqual([`b`, `c`])

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

    test(`should support moving limit while keeping offset constant`, () => {
      const graph = new D2()
      const input = graph.newInput<
        KeyValue<
          string,
          {
            id: number
            value: string
          }
        >
      >()
      const tracker = new MessageTracker<
        [string, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        | ((options: { offset?: number; limit?: number }) => void)
        | null = null

      input.pipe(
        orderByWithFractionalIndex((item) => item.value, {
          limit: 2,
          offset: 1,
          groupByKey: false,
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
          [[`key1`, { id: 1, value: `a` }], 1],
          [[`key2`, { id: 2, value: `b` }], 1],
          [[`key3`, { id: 3, value: `c` }], 1],
          [[`key4`, { id: 4, value: `d` }], 1],
          [[`key5`, { id: 5, value: `e` }], 1],
          [[`key6`, { id: 6, value: `f` }], 1],
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

    test(`should handle edge cases when moving beyond available data`, () => {
      const graph = new D2()
      const input = graph.newInput<
        KeyValue<
          string,
          {
            id: number
            value: string
          }
        >
      >()
      const tracker = new MessageTracker<
        [string, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        | ((options: { offset?: number; limit?: number }) => void)
        | null = null

      input.pipe(
        orderByWithFractionalIndex((item) => item.value, {
          limit: 2,
          offset: 0,
          groupByKey: false,
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
          [[`key1`, { id: 1, value: `a` }], 1],
          [[`key2`, { id: 2, value: `b` }], 1],
          [[`key3`, { id: 3, value: `c` }], 1],
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
        [[_bKey, [_bValue, _bIndex]], bMultiplicity]
      ) => aMultiplicity - bMultiplicity
    )
    .sort(
      (
        [[aKey, [_aValue, _aIndex]], _aMultiplicity],
        [[bKey, [_bValue, _bIndex]], _bMultiplicity]
      ) => String(aKey).localeCompare(String(bKey))
    )
    .sort(
      (
        [[_aKey, [_aValue, aIndex]], _aMultiplicity],
        [[_bKey, [_bValue, bIndex]], _bMultiplicity]
      ) => {
        return aIndex < bIndex ? -1 : aIndex > bIndex ? 1 : 0
      }
    )
}
