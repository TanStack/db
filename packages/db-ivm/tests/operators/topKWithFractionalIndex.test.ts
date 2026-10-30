// Ordinary top-K window tests: a duplicate-value case and window moves that
// compare emitted rows with literal expectations. Each reaches no declared part.
// topKWithFractionalIndex-oracle.test.ts owns the signed top-K law and its checks.
import { describe, expect, it } from 'vitest'
import { D2 } from '../../src/d2.js'
import { MultiSet } from '../../src/multiset.js'
import { topKWithFractionalIndex } from '../../src/operators/topKWithFractionalIndex.js'
import { output } from '../../src/operators/index.js'
import { MessageTracker, compareFractionalIndex } from '../test-utils.js'

describe(`Operators`, () => {
  describe(`TopKWithFractionalIndex operator`, () => {
    const topK = topKWithFractionalIndex

    it(`should ignore duplicate values`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const allMessages: Array<any> = []

      input.pipe(
        topK((a, b) => a.value.localeCompare(b.value)),
        output((message) => {
          allMessages.push(message)
        }),
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
        ]),
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
  })
})

describe(`Operators`, () => {
  describe(`TopKWithFractionalIndex operator window moves without rows`, () => {
    // A lazy source loads rows only after a window move reports a change, so
    // the ungrouped window must report it even after every row has left.
    it(`reports a changed window after all rows were retracted`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { value: string }]>()
      const messages: Array<Array<unknown>> = []
      let windowFn:
        ((options: { offset?: number; limit?: number }) => void) | undefined

      input.pipe(
        topKWithFractionalIndex((a, b) => a.value.localeCompare(b.value), {
          limit: 2,
          offset: 0,
          setWindowFn: (fn) => {
            windowFn = fn
          },
        }),
        output((message) => {
          messages.push(message.getInner())
        }),
      )
      graph.finalize()

      const row = { value: `a` }
      input.sendData(new MultiSet([[[1, row], 1]]))
      graph.run()
      input.sendData(new MultiSet([[[1, row], -1]]))
      graph.run()
      const beforeMove = messages.length

      windowFn!({ offset: 2, limit: 2 })
      graph.run()

      expect(messages.slice(beforeMove)).toEqual([[]])
    })
  })

  describe(`TopKWithFractionalIndex operator with array`, () => {
    it(`should support moving topK window past current window using setWindowFn callback`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        ((options: { offset?: number; limit?: number }) => void) | undefined

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
        }),
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
        ]),
      )
      graph.run()

      // Initial result should have first 3 elements (a, b, c)
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(initialResult.sortedResults.length).toBe(3)
      expect(initialResult.deltaCount).toBeLessThanOrEqual(6)

      // Verify initial order
      const initialSortedValues = initialResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(initialSortedValues).toEqual([`a`, `b`, `c`])

      // Verify windowFn was set
      expect(windowFn).toBeDefined()

      const priorDeltaCount = tracker.getResult().deltaCount

      // Move the window to show elements d, e, f (offset: 3, limit: 3)
      windowFn!({ offset: 3, limit: 3 })
      graph.run()

      const moveResult = tracker.getResult(compareFractionalIndex)

      // Should now show d, e, f
      const moveSortedValues = moveResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(moveSortedValues).toEqual([`d`, `e`, `f`])

      // Check that only the affected keys produce weighted deltas
      const affectedKeys = moveResult.weightedDeltas.map(([key, _]) => key[0])
      expect(affectedKeys.length).toBe(priorDeltaCount + 6)
      expect(affectedKeys).toEqual(expect.arrayContaining([1, 2, 3, 4, 5, 6]))
    })

    it(`should support moving topK window before current window using setWindowFn callback`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        ((options: { offset?: number; limit?: number }) => void) | undefined

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
        }),
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
        ]),
      )
      graph.run()

      // Initial result should have first 3 elements (a, b, c)
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(initialResult.sortedResults.length).toBe(3)
      expect(initialResult.deltaCount).toBeLessThanOrEqual(6)

      // Verify initial order
      const initialSortedValues = initialResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(initialSortedValues).toEqual([`d`, `e`, `f`])

      // Verify windowFn was set
      expect(windowFn).toBeDefined()

      const priorDeltaCount = tracker.getResult().deltaCount

      // Move the window to show elements d, e, f (offset: 3, limit: 3)
      windowFn!({ offset: 0, limit: 3 })
      graph.run()

      const moveResult = tracker.getResult(compareFractionalIndex)

      // Should now show d, e, f
      const moveSortedValues = moveResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(moveSortedValues).toEqual([`a`, `b`, `c`])

      // Check that only the affected keys produce weighted deltas
      const affectedKeys = moveResult.weightedDeltas.map(([key, _]) => key[0])
      expect(affectedKeys.length).toBe(priorDeltaCount + 6)
      expect(affectedKeys).toEqual(expect.arrayContaining([1, 2, 3, 4, 5, 6]))
    })

    it(`should support moving offset while keeping limit constant`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        ((options: { offset?: number; limit?: number }) => void) | null = null

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
        }),
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
        ]),
      )
      graph.run()

      // Initial result should have first 2 elements (a, b)
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(initialResult.sortedResults.length).toBe(2)

      const initialSortedValues = initialResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(initialSortedValues).toEqual([`a`, `b`])

      // tracker.reset()

      // Move offset to 1, keeping limit at 2 (should show b, c)
      windowFn!({ offset: 1, limit: 2 })
      graph.run()

      const moveResult = tracker.getResult(compareFractionalIndex)

      const moveSortedValues = moveResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(moveSortedValues).toEqual([`b`, `c`])

      // tracker.reset()

      // Move offset to 2, keeping limit at 2 (should show c, d)
      windowFn!({ offset: 2, limit: 2 })
      graph.run()

      const moveResult2 = tracker.getResult(compareFractionalIndex)

      const moveSortedValues2 = moveResult2.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(moveSortedValues2).toEqual([`c`, `d`])

      // Move offset back to 0, keeping limit at 2 (should show a, b)
      windowFn!({ offset: 0, limit: 2 })
      graph.run()

      const moveResult3 = tracker.getResult(compareFractionalIndex)

      const moveSortedValues3 = moveResult3.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
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
        ((options: { offset?: number; limit?: number }) => void) | null = null

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
        }),
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
        ]),
      )
      graph.run()

      // Initial result should have 2 elements starting from offset 1 (b, c)
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(initialResult.sortedResults.length).toBe(2)

      const initialSortedValues = initialResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(initialSortedValues).toEqual([`b`, `c`])

      // Increase limit to 3, keeping offset at 1 (should show b, c, d)
      windowFn!({ offset: 1, limit: 3 })
      graph.run()

      const moveResult = tracker.getResult(compareFractionalIndex)

      const moveSortedValues = moveResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(moveSortedValues).toEqual([`b`, `c`, `d`])

      // Decrease limit to 1, keeping offset at 1 (should show just b)
      windowFn!({ offset: 1, limit: 1 })
      graph.run()

      const moveResult2 = tracker.getResult(compareFractionalIndex)

      const moveSortedValues2 = moveResult2.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
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
        ((options: { offset?: number; limit?: number }) => void) | null = null

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
        }),
      )

      graph.finalize()

      // Initial data - only 3 elements: a, b, c
      input.sendData(
        new MultiSet([
          [[1, { id: 1, value: `a` }], 1],
          [[2, { id: 2, value: `b` }], 1],
          [[3, { id: 3, value: `c` }], 1],
        ]),
      )
      graph.run()

      // Initial result should have first 2 elements (a, b)
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(initialResult.sortedResults.length).toBe(2)

      const initialSortedValues = initialResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(initialSortedValues).toEqual([`a`, `b`])

      // Move to offset 2, limit 2 (should show only c, since we only have 3 total elements)
      windowFn!({ offset: 2, limit: 2 })
      graph.run()

      const moveResult = tracker.getResult(compareFractionalIndex)

      const moveSortedValues = moveResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(moveSortedValues).toEqual([`c`]) // Only 1 element available at offset 2

      // Move to offset 5, limit 2 (should show no elements, beyond available data)
      windowFn!({ offset: 5, limit: 2 })
      graph.run()

      const moveResult2 = tracker.getResult(compareFractionalIndex)

      const moveSortedValues2 = moveResult2.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(moveSortedValues2).toEqual([]) // No elements available at offset 5

      // Move to a negative offset and limit (should show no elements)
      windowFn!({ offset: -5, limit: 2 })
      graph.run()

      const moveResult3 = tracker.getResult(compareFractionalIndex)

      const moveSortedValues3 = moveResult3.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(moveSortedValues3).toEqual([])

      // Move back to a valid window
      windowFn!({ offset: 0, limit: 2 })
      graph.run()

      const moveResult4 = tracker.getResult(compareFractionalIndex)

      const moveSortedValues4 = moveResult4.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
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
        ((options: { offset?: number; limit?: number }) => void) | null = null

      // Start with no limit (infinite limit)
      input.pipe(
        topKWithFractionalIndex((a, b) => a.value.localeCompare(b.value), {
          setWindowFn: (fn) => {
            windowFn = fn
          },
        }),
        output((message) => {
          tracker.addMessage(message)
        }),
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
        ]),
      )
      graph.run()

      // Initial result should have all 6 elements (no limit)
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(initialResult.sortedResults.length).toBe(6)

      const initialSortedValues = initialResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
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
        ([_key, [value, _index]]) => value.value,
      )
      expect(moveSortedValues).toEqual([`a`, `b`, `c`])

      // Check that we have changes (elements d, e, f should be removed)
      expect(moveResult.deltaCount).toBeGreaterThan(0)
    })

    it(`should handle moving window from infinite limit to finite limit while moving offset forward`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        ((options: { offset?: number; limit?: number }) => void) | null = null

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
        }),
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
        ]),
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
        ([_key, [value, _index]]) => value.value,
      )
      expect(moveSortedValues).toEqual([`c`, `d`, `e`])

      // Check that we have changes
      expect(moveResult.deltaCount).toBeGreaterThan(0)
    })

    it(`should handle moving window from infinite limit to finite limit while moving offset backward`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        ((options: { offset?: number; limit?: number }) => void) | null = null

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
        }),
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
        ]),
      )
      graph.run()

      // Initial result should have elements d, e, f (no limit, offset 3)
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(initialResult.sortedResults.length).toBe(3)

      const initialSortedValues = initialResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(initialSortedValues).toEqual([`d`, `e`, `f`])

      // Move to finite limit of 2, moving offset backward to 1 (should show b, c)
      windowFn!({ offset: 1, limit: 2 })
      graph.run()

      const moveResult = tracker.getResult(compareFractionalIndex)

      // Should now show elements b, c (offset 1, limit 2)
      const moveSortedValues = moveResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(moveSortedValues).toEqual([`b`, `c`])

      // Check that we have changes (elements d, e, f should be removed, b, c should be added)
      expect(moveResult.deltaCount).toBeGreaterThan(0)
    })

    it(`should handle moving window from infinite limit to infinite limit with same offset (no-op)`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        ((options: { offset?: number; limit?: number }) => void) | null = null

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
        }),
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
        ]),
      )
      graph.run()

      // Initial result should have elements c, d, e, f (no limit, offset 2)
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(initialResult.sortedResults.length).toBe(4)

      const initialSortedValues = initialResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(initialSortedValues).toEqual([`c`, `d`, `e`, `f`])

      // Move to same offset, still no limit (should show same elements c, d, e, f)
      windowFn!({ offset: 2 })
      graph.run()

      const moveResult = tracker.getResult(compareFractionalIndex)

      // Should show same elements c, d, e, f (offset 2, no limit)
      const moveSortedValues = moveResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(moveSortedValues).toEqual([`c`, `d`, `e`, `f`])

      // Check that we have no more changes (this should be a no-op)
      expect(moveResult.deltaCount).toBe(initialResult.deltaCount)
    })

    it(`should handle moving window from infinite limit to infinite limit while moving offset forward`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        ((options: { offset?: number; limit?: number }) => void) | null = null

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
        }),
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
        ]),
      )
      graph.run()

      // Initial result should have all 6 elements (no limit, offset 0)
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(initialResult.sortedResults.length).toBe(6)

      const initialSortedValues = initialResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(initialSortedValues).toEqual([`a`, `b`, `c`, `d`, `e`, `f`])

      // Move to offset 2, still no limit (should show c, d, e, f)
      windowFn!({ offset: 2 })
      graph.run()

      const moveResult = tracker.getResult(compareFractionalIndex)

      // Should now show elements c, d, e, f (offset 2, no limit)
      const moveSortedValues = moveResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(moveSortedValues).toEqual([`c`, `d`, `e`, `f`])

      // Check that we have changes (elements a, b should be removed)
      expect(moveResult.deltaCount).toBeGreaterThan(0)
    })

    it(`should handle moving window from infinite limit to infinite limit while moving offset backward`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        ((options: { offset?: number; limit?: number }) => void) | null = null

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
        }),
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
        ]),
      )
      graph.run()

      // Initial result should have elements d, e, f (no limit, offset 3)
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(initialResult.sortedResults.length).toBe(3)

      const initialSortedValues = initialResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(initialSortedValues).toEqual([`d`, `e`, `f`])

      // Move to offset 1, still no limit (should show b, c, d, e, f)
      windowFn!({ offset: 1 })
      graph.run()

      const moveResult = tracker.getResult(compareFractionalIndex)

      // Should now show elements b, c, d, e, f (offset 1, no limit)
      const moveSortedValues = moveResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(moveSortedValues).toEqual([`b`, `c`, `d`, `e`, `f`])

      // Check that we have changes (elements b, c should be added)
      expect(moveResult.deltaCount).toBeGreaterThan(0)
    })

    it(`should handle moving window from finite limit to infinite limit with same offset`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        ((options: { offset?: number; limit?: number }) => void) | null = null

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
        }),
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
        ]),
      )
      graph.run()

      // Initial result should have 2 elements starting from offset 2 (c, d)
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(initialResult.sortedResults.length).toBe(2)

      const initialSortedValues = initialResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(initialSortedValues).toEqual([`c`, `d`])

      // Move to infinite limit, keeping offset 2 (should show c, d, e, f)
      windowFn!({ offset: 2, limit: Infinity })
      graph.run()

      const moveResult = tracker.getResult(compareFractionalIndex)

      // Should now show elements c, d, e, f (offset 2, no limit)
      const moveSortedValues = moveResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(moveSortedValues).toEqual([`c`, `d`, `e`, `f`])

      // Check that we have changes (elements e, f should be added)
      expect(moveResult.deltaCount).toBeGreaterThan(0)
    })

    it(`should handle moving window from finite limit to infinite limit while moving offset forward`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        ((options: { offset?: number; limit?: number }) => void) | null = null

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
        }),
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
        ]),
      )
      graph.run()

      // Initial result should have 2 elements starting from offset 1 (b, c)
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(initialResult.sortedResults.length).toBe(2)

      const initialSortedValues = initialResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(initialSortedValues).toEqual([`b`, `c`])

      // Move to infinite limit, moving offset forward to 3 (should show d, e, f)
      windowFn!({ offset: 3, limit: Infinity })
      graph.run()

      const moveResult = tracker.getResult(compareFractionalIndex)

      // Should now show elements d, e, f (offset 3, no limit)
      const moveSortedValues = moveResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(moveSortedValues).toEqual([`d`, `e`, `f`])

      // Check that we have changes (elements b, c should be removed, d, e, f should be added)
      expect(moveResult.deltaCount).toBeGreaterThan(0)
    })

    it(`should handle moving window from finite limit to infinite limit while moving offset backward`, () => {
      const graph = new D2()
      const input = graph.newInput<[number, { id: number; value: string }]>()
      const tracker = new MessageTracker<
        [number, [{ id: number; value: string }, string]]
      >()

      let windowFn:
        ((options: { offset?: number; limit?: number }) => void) | null = null

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
        }),
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
        ]),
      )
      graph.run()

      // Initial result should have 2 elements starting from offset 3 (d, e)
      const initialResult = tracker.getResult(compareFractionalIndex)
      expect(initialResult.sortedResults.length).toBe(2)

      const initialSortedValues = initialResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(initialSortedValues).toEqual([`d`, `e`])

      // Move to infinite limit, moving offset backward to 1 (should show b, c, d, e, f)
      windowFn!({ offset: 1, limit: Infinity })
      graph.run()

      const moveResult = tracker.getResult(compareFractionalIndex)

      // Should now show elements b, c, d, e, f (offset 1, no limit)
      const moveSortedValues = moveResult.sortedResults.map(
        ([_key, [value, _index]]) => value.value,
      )
      expect(moveSortedValues).toEqual([`b`, `c`, `d`, `e`, `f`])

      // Check that we have changes (elements b, c, f should be added, d, e should remain)
      expect(moveResult.deltaCount).toBeGreaterThan(0)
    })
  })
})
