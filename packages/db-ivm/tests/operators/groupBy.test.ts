import { describe, expect, test } from 'vitest'
import { D2 } from '../../src/d2.js'
import { MultiSet } from '../../src/multiset.js'
import {
  avg,
  count,
  groupBy,
  max,
  median,
  min,
  mode,
  sum,
} from '../../src/operators/groupBy.js'
import { output } from '../../src/operators/index.js'

/**
 * Helper to track all messages (inserts/deletes) emitted by the groupBy operator.
 * This is useful for debugging issues where the operator might emit incorrect
 * sequences of operations.
 */
function createMessageTracker() {
  const allMessages: Array<{
    key: string
    value: Record<string, unknown>
    multiplicity: number
  }> = []

  return {
    track: (message: MultiSet<any>) => {
      for (const [item, multiplicity] of message.getInner()) {
        const [key, value] = item
        allMessages.push({ key, value, multiplicity })
      }
    },
    getMessages: () => allMessages,
    clear: () => {
      allMessages.length = 0
    },
  }
}

describe(`Operators`, () => {
  describe(`GroupBy operation`, () => {
    test(`with no aggregate`, () => {
      const graph = new D2()
      const input = graph.newInput<{
        category: string
        amount: number
      }>()
      let latestMessage: any = null

      input.pipe(
        groupBy((data) => ({ category: data.category })),
        output((message) => {
          latestMessage = message
        }),
      )

      graph.finalize()

      // Initial data
      input.sendData(
        new MultiSet([
          [{ category: `A`, amount: 10 }, 1],
          [{ category: `A`, amount: 20 }, 1],
          [{ category: `B`, amount: 30 }, 1],
        ]),
      )
      graph.run()

      // Verify we have the latest message
      expect(latestMessage).not.toBeNull()

      const result = latestMessage.getInner()

      const expectedResult = [
        [
          [
            `{"category":"A"}`,
            {
              category: `A`,
            },
          ],
          1,
        ],
        [
          [
            `{"category":"B"}`,
            {
              category: `B`,
            },
          ],
          1,
        ],
      ]

      expect(result).toEqual(expectedResult)
    })

    test(`with single sum aggregate`, () => {
      const graph = new D2()
      const input = graph.newInput<{
        category: string
        amount: number
      }>()
      let latestMessage: any = null

      input.pipe(
        groupBy((data) => ({ category: data.category }), {
          total: sum((data) => data.amount),
        }),
        output((message) => {
          latestMessage = message
        }),
      )

      graph.finalize()

      // Initial data
      input.sendData(
        new MultiSet([
          [{ category: `A`, amount: 10 }, 1],
          [{ category: `A`, amount: 20 }, 1],
          [{ category: `B`, amount: 30 }, 1],
        ]),
      )
      graph.run()

      // Verify we have the latest message
      expect(latestMessage).not.toBeNull()

      const result = latestMessage.getInner()

      const expectedResult = [
        [
          [
            `{"category":"A"}`,
            {
              total: 30,
              category: `A`,
            },
          ],
          1,
        ],
        [
          [
            `{"category":"B"}`,
            {
              total: 30,
              category: `B`,
            },
          ],
          1,
        ],
      ]

      expect(result).toEqual(expectedResult)
    })

    test(`with sum and count aggregates`, () => {
      const graph = new D2()
      const input = graph.newInput<{
        category: string
        region: string
        amount: number
      }>()
      let latestMessage: any = null
      const messages: Array<MultiSet<any>> = []

      input.pipe(
        groupBy(
          (data) => ({
            category: data.category,
            region: data.region,
          }),
          {
            total: sum((data) => data.amount),
            count: count(),
          },
        ),
        output((message) => {
          latestMessage = message
          messages.push(message)
        }),
      )

      graph.finalize()

      // Initial data
      input.sendData(
        new MultiSet([
          [{ category: `A`, region: `East`, amount: 10 }, 1],
          [{ category: `A`, region: `East`, amount: 20 }, 1],
          [{ category: `A`, region: `West`, amount: 30 }, 1],
          [{ category: `B`, region: `East`, amount: 40 }, 1],
        ]),
      )
      graph.run()

      // Verify we have the latest message
      expect(latestMessage).not.toBeNull()

      const expectedResult = [
        [
          [
            `{"category":"A","region":"East"}`,
            {
              total: 30,
              count: 2,
              category: `A`,
              region: `East`,
            },
          ],
          1,
        ],
        [
          [
            `{"category":"A","region":"West"}`,
            {
              total: 30,
              count: 1,
              category: `A`,
              region: `West`,
            },
          ],
          1,
        ],
        [
          [
            `{"category":"B","region":"East"}`,
            {
              total: 40,
              count: 1,
              category: `B`,
              region: `East`,
            },
          ],
          1,
        ],
      ]

      expect(latestMessage.getInner()).toEqual(expectedResult)

      // --- Add a new record ---
      input.sendData(
        new MultiSet([
          [{ category: `A`, region: `East`, amount: 15 }, 1],
          [{ category: `B`, region: `West`, amount: 25 }, 1],
        ]),
      )

      graph.run()

      const expectedAddResult = [
        [
          [
            `{"category":"A","region":"East"}`,
            {
              category: `A`,
              region: `East`,
              total: 30,
              count: 2,
            },
          ],
          -1,
        ],
        [
          [
            `{"category":"A","region":"East"}`,
            {
              category: `A`,
              region: `East`,
              total: 45,
              count: 3,
            },
          ],
          1,
        ],
        [
          [
            `{"category":"B","region":"West"}`,
            {
              category: `B`,
              region: `West`,
              total: 25,
              count: 1,
            },
          ],
          1,
        ],
      ]

      expect(latestMessage.getInner()).toEqual(expectedAddResult)

      // --- Delete a record ---
      input.sendData(
        new MultiSet([
          [{ category: `A`, region: `East`, amount: 20 }, -1], // Remove one of the A/East records
        ]),
      )
      graph.run()

      const expectedDeleteResult = [
        [
          [
            `{"category":"A","region":"East"}`,
            {
              category: `A`,
              region: `East`,
              total: 45,
              count: 3,
            },
          ],
          -1,
        ],
        [
          [
            `{"category":"A","region":"East"}`,
            {
              category: `A`,
              region: `East`,
              total: 25,
              count: 2,
            },
          ],
          1,
        ],
      ]

      expect(latestMessage.getInner()).toEqual(expectedDeleteResult)
    })

    test(`with count (only not-null values)`, () => {
      const graph = new D2()
      const input = graph.newInput<{
        category: string
        amount: number | null
      }>()
      let latestMessage: any = null
      const messages: Array<MultiSet<any>> = []

      input.pipe(
        groupBy(
          (data) => ({
            category: data.category,
          }),
          {
            countNotNull: count((data) => data.amount),
            count: count(),
          },
        ),
        output((message) => {
          latestMessage = message
          messages.push(message)
        }),
      )

      graph.finalize()

      // Initial data
      input.sendData(
        new MultiSet([
          [{ category: `A`, amount: 10 }, 1],
          [{ category: `B`, amount: 10 }, 1],
          [{ category: `A`, amount: null }, 1],
          [{ category: `B`, amount: null }, 1],
        ]),
      )

      graph.run()

      // Verify we have the latest message
      expect(latestMessage).not.toBeNull()

      const expectedResult = [
        [
          [
            `{"category":"A"}`,
            {
              category: `A`,
              countNotNull: 1,
              count: 2,
            },
          ],
          1,
        ],
        [
          [
            `{"category":"B"}`,
            {
              category: `B`,
              countNotNull: 1,
              count: 2,
            },
          ],
          1,
        ],
      ]

      expect(latestMessage.getInner()).toEqual(expectedResult)
    })

    test(`with avg and count aggregates`, () => {
      const graph = new D2()
      const input = graph.newInput<{
        category: string
        amount: number
      }>()
      let latestMessage: any = null
      const messages: Array<MultiSet<any>> = []

      input.pipe(
        groupBy((data) => ({ category: data.category }), {
          average: avg((data) => data.amount),
          count: count(),
        }),
        output((message) => {
          latestMessage = message
          messages.push(message)
        }),
      )

      graph.finalize()

      // Initial data
      input.sendData(
        new MultiSet([
          [{ category: `A`, amount: 10 }, 1],
          [{ category: `A`, amount: 20 }, 1],
          [{ category: `B`, amount: 30 }, 1],
        ]),
      )
      graph.run()

      // Verify we have the latest message
      expect(latestMessage).not.toBeNull()

      const expectedResult = [
        [
          [
            `{"category":"A"}`,
            {
              category: `A`,
              average: 15,
              count: 2,
            },
          ],
          1,
        ],
        [
          [
            `{"category":"B"}`,
            {
              category: `B`,
              average: 30,
              count: 1,
            },
          ],
          1,
        ],
      ]

      expect(latestMessage.getInner()).toEqual(expectedResult)

      // --- Add a new record ---
      input.sendData(
        new MultiSet([
          [{ category: `A`, amount: 30 }, 1],
          [{ category: `C`, amount: 50 }, 1],
        ]),
      )
      graph.run()

      const expectedAddResult = [
        [
          [
            `{"category":"A"}`,
            {
              category: `A`,
              average: 15,
              count: 2,
            },
          ],
          -1,
        ],
        [
          [
            `{"category":"A"}`,
            {
              category: `A`,
              average: 20,
              count: 3,
            },
          ],
          1,
        ],
        [
          [
            `{"category":"C"}`,
            {
              category: `C`,
              average: 50,
              count: 1,
            },
          ],
          1,
        ],
      ]

      expect(latestMessage.getInner()).toEqual(expectedAddResult)

      // --- Delete a record ---
      input.sendData(
        new MultiSet([
          [{ category: `A`, amount: 10 }, -1], // Remove the first A record
        ]),
      )
      graph.run()

      const expectedDeleteResult = [
        [
          [
            `{"category":"A"}`,
            {
              category: `A`,
              average: 20,
              count: 3,
            },
          ],
          -1,
        ],
        [
          [
            `{"category":"A"}`,
            {
              category: `A`,
              average: 25,
              count: 2,
            },
          ],
          1,
        ],
      ]

      expect(latestMessage.getInner()).toEqual(expectedDeleteResult)
    })

    test(`with min and max aggregates`, () => {
      const graph = new D2()
      const input = graph.newInput<{
        category: string
        amount: number
        date: Date
      }>()
      let latestMessage: any = null

      input.pipe(
        groupBy((data) => ({ category: data.category }), {
          minimum: min((data) => data.amount),
          maximum: max((data) => data.amount),
          min_date: min((data) => data.date),
          max_date: max((data) => data.date),
        }),
        output((message) => {
          latestMessage = message
        }),
      )

      graph.finalize()

      // Initial data
      input.sendData(
        new MultiSet([
          [{ category: `A`, amount: 10, date: new Date(`2025/12/13`) }, 1],
          [{ category: `A`, amount: 20, date: new Date(`2025/12/15`) }, 1],
          [{ category: `A`, amount: 5, date: new Date(`2025/12/12`) }, 1],
          [{ category: `B`, amount: 30, date: new Date(`2025/12/12`) }, 1],
          [{ category: `B`, amount: 15, date: new Date(`2025/12/13`) }, 1],
        ]),
      )

      // Run the graph to process all messages
      graph.run()

      expect(latestMessage).not.toBeNull()

      const expectedResult = [
        [
          [
            `{"category":"A"}`,
            {
              category: `A`,
              minimum: 5,
              maximum: 20,
              min_date: new Date(`2025/12/12`),
              max_date: new Date(`2025/12/15`),
            },
          ],
          1,
        ],
        [
          [
            `{"category":"B"}`,
            {
              category: `B`,
              minimum: 15,
              maximum: 30,
              min_date: new Date(`2025/12/12`),
              max_date: new Date(`2025/12/13`),
            },
          ],
          1,
        ],
      ]

      expect(latestMessage.getInner()).toEqual(expectedResult)
    })

    test(`with median and mode aggregates`, () => {
      const graph = new D2()
      const input = graph.newInput<{
        category: string
        amount: number
      }>()
      let latestMessage: any = null

      input.pipe(
        groupBy((data) => ({ category: data.category }), {
          middle: median((data) => data.amount),
          mostFrequent: mode((data) => data.amount),
        }),
        output((message) => {
          latestMessage = message
        }),
      )

      graph.finalize()

      // Initial data with pattern designed to test median and mode
      input.sendData(
        new MultiSet([
          // Category A: [10, 20, 20, 30, 50]
          // Median: 20, Mode: 20
          [{ category: `A`, amount: 10 }, 1],
          [{ category: `A`, amount: 20 }, 2], // Added twice to test mode
          [{ category: `A`, amount: 30 }, 1],
          [{ category: `A`, amount: 50 }, 1],

          // Category B: [5, 10, 15, 20]
          // Median: 12.5 (average of 10 and 15), Mode: 5, 10, 15, 20 (all appear once)
          [{ category: `B`, amount: 5 }, 1],
          [{ category: `B`, amount: 10 }, 1],
          [{ category: `B`, amount: 15 }, 1],
          [{ category: `B`, amount: 20 }, 1],
        ]),
      )

      // Run the graph to process all messages
      graph.run()

      expect(latestMessage).not.toBeNull()

      const expectedResult = [
        [
          [
            `{"category":"A"}`,
            {
              category: `A`,
              middle: 20,
              mostFrequent: 20,
            },
          ],
          1,
        ],
        [
          [
            `{"category":"B"}`,
            {
              category: `B`,
              middle: 12.5,
              mostFrequent: 5, // First encountered value with highest frequency (all values appear once)
            },
          ],
          1,
        ],
      ]

      expect(latestMessage.getInner()).toEqual(expectedResult)
    })

    test(`complete group removal with sum aggregate`, () => {
      const graph = new D2()
      const input = graph.newInput<{
        category: string
        amount: number
      }>()
      let latestMessage: any = null

      input.pipe(
        groupBy((data) => ({ category: data.category }), {
          total: sum((data) => data.amount),
        }),
        output((message) => {
          latestMessage = message
        }),
      )

      graph.finalize()

      // Initial data
      input.sendData(
        new MultiSet([
          [{ category: `A`, amount: 10 }, 1],
          [{ category: `A`, amount: 20 }, 1],
          [{ category: `B`, amount: 30 }, 1],
          [{ category: `C`, amount: 40 }, 1],
        ]),
      )
      graph.run()

      // Verify initial state
      expect(latestMessage).not.toBeNull()
      let result = latestMessage.getInner()
      expect(result).toHaveLength(3) // Should have 3 groups

      // Find the group for category A
      const categoryAGroup = result.find(
        ([key]: any) => key[0] === `{"category":"A"}`,
      )
      expect(categoryAGroup).toBeDefined()
      expect(categoryAGroup[0][1].total).toBe(30) // Sum of 10 + 20

      // Now remove ALL records from category A
      input.sendData(
        new MultiSet([
          [{ category: `A`, amount: 10 }, -1],
          [{ category: `A`, amount: 20 }, -1],
        ]),
      )
      graph.run()

      // After removing all A records, the group should be completely removed
      // NOT return a group with total: 0
      result = latestMessage.getInner()

      // The result should contain the removal of the old group
      // but NOT the creation of a new group with total: 0
      const expectedResult = [
        [
          [
            `{"category":"A"}`,
            {
              category: `A`,
              total: 30,
            },
          ],
          -1, // This should be removed
        ],
      ]

      expect(result).toEqual(expectedResult)

      // Verify no new group with total: 0 was created by checking that
      // we don't have any positive weight entries for category A
      const positiveCategoryAEntries = result.filter(
        ([key, , weight]: any) => key[0] === `{"category":"A"}` && weight > 0,
      )
      expect(positiveCategoryAEntries).toHaveLength(0)
    })

    test(`complete group removal with multiple aggregates`, () => {
      const graph = new D2()
      const input = graph.newInput<{
        category: string
        region: string
        amount: number
      }>()
      let latestMessage: any = null

      input.pipe(
        groupBy(
          (data) => ({
            category: data.category,
            region: data.region,
          }),
          {
            total: sum((data) => data.amount),
            count: count(),
            average: avg((data) => data.amount),
          },
        ),
        output((message) => {
          latestMessage = message
        }),
      )

      graph.finalize()

      // Initial data
      input.sendData(
        new MultiSet([
          [{ category: `A`, region: `East`, amount: 10 }, 1],
          [{ category: `A`, region: `East`, amount: 20 }, 1],
          [{ category: `A`, region: `West`, amount: 30 }, 1],
          [{ category: `B`, region: `East`, amount: 40 }, 1],
        ]),
      )
      graph.run()

      // Verify initial state
      expect(latestMessage).not.toBeNull()
      let result = latestMessage.getInner()
      expect(result).toHaveLength(3) // Should have 3 groups

      // Find the group for category A, region East
      const categoryAEastGroup = result.find(
        ([key]: any) => key[0] === `{"category":"A","region":"East"}`,
      )
      expect(categoryAEastGroup).toBeDefined()
      expect(categoryAEastGroup[0][1]).toEqual({
        category: `A`,
        region: `East`,
        total: 30, // 10 + 20
        count: 2,
        average: 15, // 30 / 2
      })

      // Now remove ALL records from category A, region East
      input.sendData(
        new MultiSet([
          [{ category: `A`, region: `East`, amount: 10 }, -1],
          [{ category: `A`, region: `East`, amount: 20 }, -1],
        ]),
      )
      graph.run()

      // After removing all A/East records, that group should be completely removed
      // NOT return a group with total: 0, count: 0, average: 0 (or NaN)
      result = latestMessage.getInner()

      // The result should contain the removal of the old group
      const expectedResult = [
        [
          [
            `{"category":"A","region":"East"}`,
            {
              category: `A`,
              region: `East`,
              total: 30,
              count: 2,
              average: 15,
            },
          ],
          -1, // This should be removed
        ],
      ]

      expect(result).toEqual(expectedResult)

      // Verify no new group with zero/empty values was created
      const positiveCategoryAEastEntries = result.filter(
        ([key, , weight]: any) =>
          key[0] === `{"category":"A","region":"East"}` && weight > 0,
      )
      expect(positiveCategoryAEastEntries).toHaveLength(0)
    })

    test(`group removal and re-addition with sum aggregate`, () => {
      const graph = new D2()
      const input = graph.newInput<{
        category: string
        amount: number
      }>()
      let latestMessage: any = null

      input.pipe(
        groupBy((data) => ({ category: data.category }), {
          total: sum((data) => data.amount),
        }),
        output((message) => {
          latestMessage = message
        }),
      )

      graph.finalize()

      // Step 1: Initial data
      input.sendData(
        new MultiSet([
          [{ category: `A`, amount: 10 }, 1],
          [{ category: `A`, amount: 20 }, 1],
          [{ category: `B`, amount: 30 }, 1],
        ]),
      )
      graph.run()

      // Verify initial state
      expect(latestMessage).not.toBeNull()
      let result = latestMessage.getInner()
      expect(result).toHaveLength(2) // Should have 2 groups

      // Find the group for category A
      const categoryAGroup = result.find(
        ([key]: any) => key[0] === `{"category":"A"}`,
      )
      expect(categoryAGroup).toBeDefined()
      expect(categoryAGroup[0][1].total).toBe(30) // Sum of 10 + 20

      // Step 2: Remove ALL records from category A
      input.sendData(
        new MultiSet([
          [{ category: `A`, amount: 10 }, -1],
          [{ category: `A`, amount: 20 }, -1],
        ]),
      )
      graph.run()

      // Verify group A is completely removed
      result = latestMessage.getInner()
      const expectedRemovalResult = [
        [
          [
            `{"category":"A"}`,
            {
              category: `A`,
              total: 30,
            },
          ],
          -1, // Group should be removed
        ],
      ]
      expect(result).toEqual(expectedRemovalResult)

      // Step 3: Re-add records to category A with different values
      input.sendData(
        new MultiSet([
          [{ category: `A`, amount: 50 }, 1],
          [{ category: `A`, amount: 25 }, 1],
        ]),
      )
      graph.run()

      // Verify group A is recreated with correct new aggregate values
      result = latestMessage.getInner()
      const expectedReAdditionResult = [
        [
          [
            `{"category":"A"}`,
            {
              category: `A`,
              total: 75, // 50 + 25 (new values, not the old 30)
            },
          ],
          1, // New group should be added
        ],
      ]
      expect(result).toEqual(expectedReAdditionResult)

      // Step 4: Verify no lingering effects by adding more data
      input.sendData(new MultiSet([[{ category: `A`, amount: 15 }, 1]]))
      graph.run()

      // Verify aggregate is updated correctly from the new baseline
      result = latestMessage.getInner()
      const expectedUpdateResult = [
        [
          [
            `{"category":"A"}`,
            {
              category: `A`,
              total: 75, // Previous total
            },
          ],
          -1, // Remove old state
        ],
        [
          [
            `{"category":"A"}`,
            {
              category: `A`,
              total: 90, // 75 + 15
            },
          ],
          1, // Add new state
        ],
      ]
      expect(result).toEqual(expectedUpdateResult)
    })

    test(`incremental updates should emit paired delete+insert for aggregate changes`, () => {
      // This test verifies that when an aggregate value changes due to incremental updates,
      // the groupBy operator correctly emits BOTH a delete for the old value AND an insert
      // for the new value. This is critical for downstream consumers that track state.
      //
      // Bug scenario: When multiple items with the same groupBy key are added incrementally,
      // the pipeline might emit only an insert without the corresponding delete, causing
      // "already exists" errors in downstream collections.

      const graph = new D2()
      const input = graph.newInput<{
        id: string
        category: string
        amount: number
      }>()
      const tracker = createMessageTracker()

      input.pipe(
        groupBy((data) => ({ category: data.category }), {
          total: sum((data) => data.amount),
          count: count(),
        }),
        output((message) => {
          tracker.track(message)
        }),
      )

      graph.finalize()

      // Initial data: one item for category A
      input.sendData(
        new MultiSet([[{ id: `1`, category: `A`, amount: 10 }, 1]]),
      )
      graph.run()

      // Verify initial state
      const initialMessages = tracker.getMessages()
      expect(initialMessages).toHaveLength(1)
      expect(initialMessages[0]?.multiplicity).toBe(1) // Insert
      expect(initialMessages[0]?.value).toMatchObject({
        category: `A`,
        total: 10,
        count: 1,
      })

      tracker.clear()

      // Incremental update: add another item with same category
      // This should emit BOTH a delete for the old aggregate AND an insert for the new one
      input.sendData(
        new MultiSet([[{ id: `2`, category: `A`, amount: 20 }, 1]]),
      )
      graph.run()

      const updateMessages = tracker.getMessages()

      // Should have exactly 2 messages: one delete (-1) and one insert (+1)
      expect(updateMessages).toHaveLength(2)

      // Find the delete and insert messages
      const deleteMsg = updateMessages.find((m) => m.multiplicity === -1)
      const insertMsg = updateMessages.find((m) => m.multiplicity === 1)

      // Verify we have both a delete and an insert
      expect(deleteMsg).toBeDefined()
      expect(insertMsg).toBeDefined()

      // The delete should be for the old aggregate value
      expect(deleteMsg?.value).toMatchObject({
        category: `A`,
        total: 10,
        count: 1,
      })

      // The insert should be for the new aggregate value
      expect(insertMsg?.value).toMatchObject({
        category: `A`,
        total: 30,
        count: 2,
      })
    })

    test(`rapid incremental updates should always emit paired delete+insert`, () => {
      // This test simulates rapid sequential updates that might trigger edge cases
      // in the reduce operator's state tracking.

      const graph = new D2()
      const input = graph.newInput<{
        id: string
        language: string
      }>()
      const tracker = createMessageTracker()

      input.pipe(
        groupBy((data) => ({ language: data.language }), {
          count: count(),
        }),
        output((message) => {
          tracker.track(message)
        }),
      )

      graph.finalize()

      // Initial item
      input.sendData(new MultiSet([[{ id: `1`, language: `en` }, 1]]))
      graph.run()

      expect(tracker.getMessages()).toHaveLength(1)
      expect(tracker.getMessages()[0]?.multiplicity).toBe(1)
      expect(tracker.getMessages()[0]?.value).toMatchObject({
        language: `en`,
        count: 1,
      })

      // Perform multiple rapid incremental updates
      for (let i = 2; i <= 5; i++) {
        tracker.clear()

        input.sendData(new MultiSet([[{ id: `${i}`, language: `en` }, 1]]))
        graph.run()

        const messages = tracker.getMessages()

        // Each update should produce exactly 2 messages: delete old, insert new
        expect(messages).toHaveLength(2)

        const deleteMsg = messages.find((m) => m.multiplicity === -1)
        const insertMsg = messages.find((m) => m.multiplicity === 1)

        expect(deleteMsg).toBeDefined()
        expect(insertMsg).toBeDefined()

        // Old count should be i-1, new count should be i
        expect(deleteMsg?.value).toMatchObject({ language: `en`, count: i - 1 })
        expect(insertMsg?.value).toMatchObject({ language: `en`, count: i })
      }
    })

    test(`multiple groups with interleaved updates should emit correct delete+insert pairs`, () => {
      // This test verifies that when multiple groups are updated in the same batch,
      // each group gets the correct delete+insert pair.

      const graph = new D2()
      const input = graph.newInput<{
        id: string
        language: string
      }>()
      const tracker = createMessageTracker()

      input.pipe(
        groupBy((data) => ({ language: data.language }), {
          count: count(),
        }),
        output((message) => {
          tracker.track(message)
        }),
      )

      graph.finalize()

      // Initial data: one item for each language
      input.sendData(
        new MultiSet([
          [{ id: `1`, language: `en` }, 1],
          [{ id: `2`, language: `ru` }, 1],
          [{ id: `3`, language: `fr` }, 1],
        ]),
      )
      graph.run()

      // Should have 3 groups with count 1 each
      expect(tracker.getMessages()).toHaveLength(3)
      const enInsert = tracker
        .getMessages()
        .find((m) => m.key === `{"language":"en"}`)
      const ruInsert = tracker
        .getMessages()
        .find((m) => m.key === `{"language":"ru"}`)
      const frInsert = tracker
        .getMessages()
        .find((m) => m.key === `{"language":"fr"}`)
      expect(enInsert?.multiplicity).toBe(1)
      expect(ruInsert?.multiplicity).toBe(1)
      expect(frInsert?.multiplicity).toBe(1)
      expect(enInsert?.value.count).toBe(1)
      expect(ruInsert?.value.count).toBe(1)
      expect(frInsert?.value.count).toBe(1)

      tracker.clear()

      // Add items to two groups in the same batch
      input.sendData(
        new MultiSet([
          [{ id: `4`, language: `en` }, 1],
          [{ id: `5`, language: `ru` }, 1],
        ]),
      )
      graph.run()

      const updateMessages = tracker.getMessages()

      // Should have 4 messages: delete+insert for en, delete+insert for ru
      expect(updateMessages).toHaveLength(4)

      // Check en group
      const enDelete = updateMessages.find(
        (m) => m.key === `{"language":"en"}` && m.multiplicity === -1,
      )
      const enUpdate = updateMessages.find(
        (m) => m.key === `{"language":"en"}` && m.multiplicity === 1,
      )
      expect(enDelete).toBeDefined()
      expect(enUpdate).toBeDefined()
      expect(enDelete?.value.count).toBe(1)
      expect(enUpdate?.value.count).toBe(2)

      // Check ru group
      const ruDelete = updateMessages.find(
        (m) => m.key === `{"language":"ru"}` && m.multiplicity === -1,
      )
      const ruUpdate = updateMessages.find(
        (m) => m.key === `{"language":"ru"}` && m.multiplicity === 1,
      )
      expect(ruDelete).toBeDefined()
      expect(ruUpdate).toBeDefined()
      expect(ruDelete?.value.count).toBe(1)
      expect(ruUpdate?.value.count).toBe(2)

      // Check that fr group was NOT affected (no messages for it)
      const frMessages = updateMessages.filter(
        (m) => m.key === `{"language":"fr"}`,
      )
      expect(frMessages).toHaveLength(0)
    })

    test(`verify message accumulation - deletes and inserts should pair correctly`, () => {
      // This test verifies that when processing incremental updates,
      // the D2 pipeline emits properly paired delete and insert messages
      // that can be accumulated by key in downstream processing.
      //
      // This is the exact scenario where the bug was reported:
      // "the D2 pipeline might emit an insert for an updated aggregate
      // without a corresponding delete"

      const graph = new D2()
      const input = graph.newInput<{
        id: string
        language: string
      }>()

      // Track all raw messages and their multiplicities
      const allMessages: Array<{
        key: string
        value: Record<string, unknown>
        multiplicity: number
      }> = []

      input.pipe(
        groupBy((data) => ({ language: data.language }), {
          count: count(),
        }),
        output((message) => {
          for (const [item, multiplicity] of message.getInner()) {
            const [key, value] = item
            allMessages.push({ key, value, multiplicity })
          }
        }),
      )

      graph.finalize()

      // Step 1: Initial insert
      input.sendData(new MultiSet([[{ id: `event1`, language: `ru` }, 1]]))
      graph.run()

      // Should have exactly 1 message: insert with count 1
      expect(allMessages).toHaveLength(1)
      expect(allMessages[0]?.multiplicity).toBe(1)
      expect(allMessages[0]?.value.count).toBe(1)

      // Clear for next step
      allMessages.length = 0

      // Step 2: Second insert to same group
      input.sendData(new MultiSet([[{ id: `event2`, language: `ru` }, 1]]))
      graph.run()

      // Simulate how the db package accumulates changes by key
      const changesByKey = new Map<
        string,
        { inserts: number; deletes: number; value: any }
      >()

      for (const msg of allMessages) {
        const existing = changesByKey.get(msg.key) || {
          inserts: 0,
          deletes: 0,
          value: null,
        }
        if (msg.multiplicity > 0) {
          existing.inserts += msg.multiplicity
          existing.value = msg.value
        } else if (msg.multiplicity < 0) {
          existing.deletes += Math.abs(msg.multiplicity)
        }
        changesByKey.set(msg.key, existing)
      }

      // For the "ru" key, we should have 1 delete and 1 insert
      const ruChanges = changesByKey.get(`{"language":"ru"}`)
      expect(ruChanges).toBeDefined()

      // CRITICAL: Both deletes and inserts should be present
      // If only inserts are present (deletes === 0), this would cause
      // the "already exists" error in the live query collection
      expect(ruChanges?.deletes).toBe(1)
      expect(ruChanges?.inserts).toBe(1)
      expect(ruChanges?.value.count).toBe(2)
    })

    test(`group removal and re-addition with multiple aggregates`, () => {
      const graph = new D2()
      const input = graph.newInput<{
        category: string
        region: string
        amount: number
      }>()
      let latestMessage: any = null

      input.pipe(
        groupBy(
          (data) => ({
            category: data.category,
            region: data.region,
          }),
          {
            total: sum((data) => data.amount),
            count: count(),
            average: avg((data) => data.amount),
            minimum: min((data) => data.amount),
            maximum: max((data) => data.amount),
          },
        ),
        output((message) => {
          latestMessage = message
        }),
      )

      graph.finalize()

      // Step 1: Initial data
      input.sendData(
        new MultiSet([
          [{ category: `A`, region: `East`, amount: 10 }, 1],
          [{ category: `A`, region: `East`, amount: 20 }, 1],
          [{ category: `A`, region: `East`, amount: 30 }, 1],
          [{ category: `B`, region: `West`, amount: 100 }, 1],
        ]),
      )
      graph.run()

      // Verify initial state
      expect(latestMessage).not.toBeNull()
      let result = latestMessage.getInner()
      expect(result).toHaveLength(2) // Should have 2 groups

      // Find the group for category A, region East
      const categoryAEastGroup = result.find(
        ([key]: any) => key[0] === `{"category":"A","region":"East"}`,
      )
      expect(categoryAEastGroup).toBeDefined()
      expect(categoryAEastGroup[0][1]).toEqual({
        category: `A`,
        region: `East`,
        total: 60, // 10 + 20 + 30
        count: 3,
        average: 20, // 60 / 3
        minimum: 10,
        maximum: 30,
      })

      // Step 2: Remove ALL records from category A, region East
      input.sendData(
        new MultiSet([
          [{ category: `A`, region: `East`, amount: 10 }, -1],
          [{ category: `A`, region: `East`, amount: 20 }, -1],
          [{ category: `A`, region: `East`, amount: 30 }, -1],
        ]),
      )
      graph.run()

      // Verify group is completely removed
      result = latestMessage.getInner()
      const expectedRemovalResult = [
        [
          [
            `{"category":"A","region":"East"}`,
            {
              category: `A`,
              region: `East`,
              total: 60,
              count: 3,
              average: 20,
              minimum: 10,
              maximum: 30,
            },
          ],
          -1, // Group should be removed
        ],
      ]
      expect(result).toEqual(expectedRemovalResult)

      // Step 3: Re-add records to category A, region East with completely different values
      input.sendData(
        new MultiSet([
          [{ category: `A`, region: `East`, amount: 5 }, 1],
          [{ category: `A`, region: `East`, amount: 15 }, 1],
          [{ category: `A`, region: `East`, amount: 40 }, 1],
          [{ category: `A`, region: `East`, amount: 40 }, 1], // Duplicate to test aggregates properly
        ]),
      )
      graph.run()

      // Verify group is recreated with correct new aggregate values
      result = latestMessage.getInner()
      const expectedReAdditionResult = [
        [
          [
            `{"category":"A","region":"East"}`,
            {
              category: `A`,
              region: `East`,
              total: 100, // 5 + 15 + 40 + 40 (completely new calculation)
              count: 4,
              average: 25, // 100 / 4
              minimum: 5, // New minimum
              maximum: 40, // New maximum
            },
          ],
          1, // New group should be added
        ],
      ]
      expect(result).toEqual(expectedReAdditionResult)

      // Step 4: Remove some records and verify aggregates update correctly
      input.sendData(
        new MultiSet([
          [{ category: `A`, region: `East`, amount: 40 }, -1], // Remove one of the 40s
        ]),
      )
      graph.run()

      // Verify aggregates are updated correctly from the new baseline
      result = latestMessage.getInner()
      const expectedPartialRemovalResult = [
        [
          [
            `{"category":"A","region":"East"}`,
            {
              category: `A`,
              region: `East`,
              total: 100,
              count: 4,
              average: 25,
              minimum: 5,
              maximum: 40,
            },
          ],
          -1, // Remove old state
        ],
        [
          [
            `{"category":"A","region":"East"}`,
            {
              category: `A`,
              region: `East`,
              total: 60, // 5 + 15 + 40 (one 40 removed)
              count: 3,
              average: 20, // 60 / 3
              minimum: 5, // Still 5
              maximum: 40, // Still 40 (one remains)
            },
          ],
          1, // Add new state
        ],
      ]
      expect(result).toEqual(expectedPartialRemovalResult)
    })
  })
})
