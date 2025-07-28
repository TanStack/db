import { describe, expect, test } from "vitest"
import { D2 } from "../../src/d2.js"
import { MultiSet } from "../../src/multiset.js"
import { topK } from "../../src/operators/topK.js"
import { output } from "../../src/operators/output.js"

describe(`Operators`, () => {
  describe(`TopK operation`, () => {
    test(`initial results with limit - no key`, () => {
      const graph = new D2()
      const input = graph.newInput<
        [
          null,
          {
            id: number // 1, 2, 3, 4, 5
            value: string // a, z, b, y, c
          },
        ]
      >()
      let latestMessage: any = null

      input.pipe(
        topK((a, b) => a.value.localeCompare(b.value), { limit: 3 }),
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

      expect(sortResults(result)).toEqual([
        [[null, { id: 1, value: `a` }], 1],
        [[null, { id: 3, value: `b` }], 1],
        [[null, { id: 5, value: `c` }], 1],
      ])
    })

    test(`initial results with limit and offset - no key`, () => {
      const graph = new D2()
      const input = graph.newInput<
        [
          null,
          {
            id: number // 1, 2, 3, 4, 5
            value: string // a, z, b, y, c
          },
        ]
      >()
      let latestMessage: any = null
      input.pipe(
        topK((a, b) => a.value.localeCompare(b.value), {
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

      expect(sortResults(result)).toEqual([
        [[null, { id: 2, value: `z` }], 1],
        [[null, { id: 4, value: `y` }], 1],
        [[null, { id: 5, value: `c` }], 1],
      ])
    })

    test(`initial results with limit - with key`, () => {
      const graph = new D2()
      const input = graph.newInput<
        [
          string,
          {
            id: number // 1, 2, 3, 4, 5
            value: string // a, z, b, y, c
          },
        ]
      >()
      let latestMessage: any = null

      input.pipe(
        topK((a, b) => a.value.localeCompare(b.value), { limit: 3 }),
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

      expect(sortResults(result)).toEqual([
        [[`one`, { id: 3, value: `7` }], 1],
        [[`one`, { id: 4, value: `6` }], 1],
        [[`one`, { id: 5, value: `5` }], 1],
        [[`two`, { id: 8, value: `2` }], 1],
        [[`two`, { id: 9, value: `1` }], 1],
        [[`two`, { id: 10, value: `0` }], 1],
      ])
    })

    test(`initial results with limit and offset - with key`, () => {
      const graph = new D2()
      const input = graph.newInput<
        [
          string,
          {
            id: number // 1, 2, 3, 4, 5
            value: string // a, z, b, y, c
          },
        ]
      >()
      let latestMessage: any = null

      input.pipe(
        topK((a, b) => a.value.localeCompare(b.value), {
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

      expect(sortResults(result)).toEqual([
        [[`one`, { id: 1, value: `9` }], 1],
        [[`one`, { id: 2, value: `8` }], 1],
        [[`one`, { id: 3, value: `7` }], 1],
        [[`two`, { id: 6, value: `4` }], 1],
        [[`two`, { id: 7, value: `3` }], 1],
        [[`two`, { id: 8, value: `2` }], 1],
      ])
    })

    // Incremental update tests
    test(`incremental update - adding rows that should appear in result set`, () => {
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
        topK((a, b) => a.value.localeCompare(b.value), { limit: 3 }),
        output((message) => {
          latestMessage = message
        })
      )

      graph.finalize()

      // Initial data
      input.sendData(
        new MultiSet([
          [[null, { id: 1, value: `d` }], 1],
          [[null, { id: 2, value: `e` }], 1],
          [[null, { id: 3, value: `f` }], 1],
        ])
      )
      graph.run()

      // Initial result should be all three items
      let result = latestMessage.getInner()
      expect(sortResults(result)).toEqual([
        [[null, { id: 1, value: `d` }], 1],
        [[null, { id: 2, value: `e` }], 1],
        [[null, { id: 3, value: `f` }], 1],
      ])

      // Add a new row that should appear in the result (before 'd')
      input.sendData(new MultiSet([[[null, { id: 4, value: `a` }], 1]]))
      graph.run()

      // Result should now include 'a' and drop 'f' due to limit
      result = latestMessage.getInner()
      expect(sortResults(result)).toEqual([
        [[null, { id: 3, value: `f` }], -1], // Moved out of the limit so it's removed
        [[null, { id: 4, value: `a` }], 1], // New row at the beginning
      ])
    })

    test(`incremental update - removing rows from result set`, () => {
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
        topK((a, b) => a.value.localeCompare(b.value), { limit: 3 }),
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
          [[null, { id: 4, value: `d` }], 1],
        ])
      )
      graph.run()

      // Initial result should be first three items
      let result = latestMessage.getInner()
      expect(sortResults(result)).toEqual([
        [[null, { id: 1, value: `a` }], 1],
        [[null, { id: 2, value: `b` }], 1],
        [[null, { id: 3, value: `c` }], 1],
      ])

      // Remove 'b' from the result set
      input.sendData(new MultiSet([[[null, { id: 2, value: `b` }], -1]]))
      graph.run()

      // Result should show 'b' being removed and 'd' being added
      result = latestMessage.getInner()
      expect(sortResults(result)).toEqual([
        [[null, { id: 2, value: `b` }], -1], // Removed row
        [[null, { id: 4, value: `d` }], 1], // New row added to results
      ])
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
        topK((a, b) => a.value.localeCompare(b.value), { limit: 3 }),
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

      // Initial result should be all three items
      let result = latestMessage.getInner()
      expect(sortResults(result)).toEqual([
        [[null, { id: 1, value: `c` }], 1],
        [[null, { id: 2, value: `d` }], 1],
        [[null, { id: 3, value: `e` }], 1],
      ])

      // Add two new rows that should appear before existing rows
      input.sendData(
        new MultiSet([
          [[null, { id: 4, value: `a` }], 1],
          [[null, { id: 5, value: `b` }], 1],
        ])
      )
      graph.run()

      // Result should show the new rows being added and the row that got pushed out
      result = latestMessage.getInner()
      expect(sortResults(result)).toEqual([
        [[null, { id: 2, value: `d` }], -1], // Row pushed out due to limit
        [[null, { id: 3, value: `e` }], -1], // Row pushed out due to limit
        [[null, { id: 4, value: `a` }], 1], // New row
        [[null, { id: 5, value: `b` }], 1], // New row
      ])
    })

    test(`incremental update - with offset`, () => {
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
        topK((a, b) => a.value.localeCompare(b.value), {
          limit: 2,
          offset: 1,
        }),
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
          [[null, { id: 4, value: `d` }], 1],
        ])
      )
      graph.run()

      // Initial result should be items at positions 1 and 2 (b and c)
      let result = latestMessage.getInner()
      expect(sortResults(result)).toEqual([
        [[null, { id: 2, value: `b` }], 1],
        [[null, { id: 3, value: `c` }], 1],
      ])

      // Add a new row that should appear at the beginning
      input.sendData(
        new MultiSet([
          [[null, { id: 5, value: `0` }], 1], // Should be first alphabetically
        ])
      )
      graph.run()

      // Result should show the changes in the window due to offset shift
      result = latestMessage.getInner()
      expect(sortResults(result)).toEqual([
        [[null, { id: 1, value: `a` }], 1], // Now in window due to offset shift
        [[null, { id: 3, value: `c` }], -1], // Pushed out of window
      ])
    })

    test(`incremental update - with key groups`, () => {
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
        topK((a, b) => a.value.localeCompare(b.value), { limit: 2 }),
        output((message) => {
          latestMessage = message
        })
      )

      graph.finalize()

      // Initial data
      input.sendData(
        new MultiSet([
          [[`group1`, { id: 1, value: `c` }], 1],
          [[`group1`, { id: 2, value: `d` }], 1],
          [[`group1`, { id: 3, value: `e` }], 1],
          [[`group2`, { id: 4, value: `a` }], 1],
          [[`group2`, { id: 5, value: `b` }], 1],
          [[`group2`, { id: 6, value: `f` }], 1],
        ])
      )
      graph.run()

      // Initial result should be top 2 from each group
      let result = latestMessage.getInner()
      expect(sortResults(result)).toEqual([
        [[`group1`, { id: 1, value: `c` }], 1],
        [[`group1`, { id: 2, value: `d` }], 1],
        [[`group2`, { id: 4, value: `a` }], 1],
        [[`group2`, { id: 5, value: `b` }], 1],
      ])

      // Add a new row to group1 that should appear in results
      // Remove a row from group2 that was in results
      input.sendData(
        new MultiSet([
          [[`group1`, { id: 7, value: `a` }], 1], // Should be first in group1
          [[`group2`, { id: 4, value: `a` }], -1], // Remove from group2
        ])
      )
      graph.run()

      // Result should show the changes in each key group
      result = latestMessage.getInner()
      expect(sortResults(result)).toEqual([
        [[`group1`, { id: 2, value: `d` }], -1], // Pushed out of limit in group1
        [[`group2`, { id: 4, value: `a` }], -1], // Removed from group2
        [[`group2`, { id: 6, value: `f` }], 1], // Now in window for group2
        [[`group1`, { id: 7, value: `a` }], 1], // New row in group1
      ])
    })

    test(`incremental update - complex scenario with multiple changes`, () => {
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
        topK((a, b) => a.value.localeCompare(b.value), {
          limit: 3,
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

      // Initial result should be b, c, d (offset 1, limit 3)
      let result = latestMessage.getInner()
      expect(sortResults(result)).toEqual([
        [[null, { id: 2, value: `b` }], 1],
        [[null, { id: 3, value: `c` }], 1],
        [[null, { id: 4, value: `d` }], 1],
      ])

      // Multiple changes:
      // 1. Remove 'c'
      // 2. Add '_' (before 'a')
      // 3. Add 'aa' (between 'a' and 'b')
      input.sendData(
        new MultiSet([
          [[null, { id: 3, value: `c` }], -1],
          [[null, { id: 6, value: `_` }], 1],
          [[null, { id: 7, value: `aa` }], 1],
        ])
      )
      graph.run()

      // New order: _, a, aa, b, d, e
      // With offset 1, limit 3, result should show changes
      result = latestMessage.getInner()
      expect(sortResults(result)).toEqual([
        [[null, { id: 1, value: `a` }], 1], // Now in window due to offset shift
        [[null, { id: 3, value: `c` }], -1], // Removed row
        [[null, { id: 4, value: `d` }], -1], // Pushed out of window
        [[null, { id: 7, value: `aa` }], 1], // New row in window
      ])

      // More changes:
      // 1. Remove 'a'
      // 2. Add 'z' (at the end)
      input.sendData(
        new MultiSet([
          [[null, { id: 1, value: `a` }], -1],
          [[null, { id: 8, value: `z` }], 1],
        ])
      )
      graph.run()

      // New order: _, aa, b, d, e, z
      // With offset 1, limit 3, result should show changes
      result = latestMessage.getInner()
      expect(sortResults(result)).toEqual([
        [[null, { id: 1, value: `a` }], -1], // Removed row
        [[null, { id: 4, value: `d` }], 1], // Now back in window
      ])
    })
  })
})

/**
 * Helper function to sort results by multiplicity and then id
 * This is necessary as the implementation does not guarantee order of the messages
 * only that the materialization is correct
 */
function sortResults(results: Array<any>) {
  return [...results]
    .sort(
      ([_a, aMultiplicity], [_b, bMultiplicity]) =>
        aMultiplicity - bMultiplicity
    )
    .sort(
      ([[_aKey, aValue], _aMultiplicity], [[_bKey, bValue], _bMultiplicity]) =>
        aValue.id - bValue.id
    )
}
