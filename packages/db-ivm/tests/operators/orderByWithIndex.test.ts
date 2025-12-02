import { describe, expect, test } from "vitest"
import { D2 } from "../../src/d2.js"
import { MultiSet } from "../../src/multiset.js"
import { orderByWithIndex, output } from "../../src/operators/index.js"
import type { KeyValue } from "../../src/types.js"

describe(`Operators`, () => {
  describe(`OrderByWithIndex operation`, () => {
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
        orderByWithIndex((item) => item.value),
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
      const sortedResult = sortByKeyAndIndex(result)

      expect(sortedResult).toEqual([
        [[`key1`, [{ id: 1, value: `a` }, 0]], 1],
        [[`key3`, [{ id: 3, value: `b` }, 1]], 1],
        [[`key5`, [{ id: 5, value: `c` }, 2]], 1],
        [[`key4`, [{ id: 4, value: `y` }, 3]], 1],
        [[`key2`, [{ id: 2, value: `z` }, 4]], 1],
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
        orderByWithIndex((item) => item.value, {
          comparator: (a, b) => b.localeCompare(a), // reverse order
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
      const sortedResult = sortByKeyAndIndex(result)

      expect(sortedResult).toEqual([
        [[`key2`, [{ id: 2, value: `z` }, 0]], 1],
        [[`key4`, [{ id: 4, value: `y` }, 1]], 1],
        [[`key5`, [{ id: 5, value: `c` }, 2]], 1],
        [[`key3`, [{ id: 3, value: `b` }, 3]], 1],
        [[`key1`, [{ id: 1, value: `a` }, 4]], 1],
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
        orderByWithIndex((item) => item.value, { limit: 3 }),
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
      const sortedResult = sortByKeyAndIndex(result)

      expect(sortedResult).toEqual([
        [[`key1`, [{ id: 1, value: `a` }, 0]], 1],
        [[`key3`, [{ id: 3, value: `b` }, 1]], 1],
        [[`key5`, [{ id: 5, value: `c` }, 2]], 1],
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
        orderByWithIndex((item) => item.value, { limit: 2, offset: 2 }),
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
      const sortedResult = sortByKeyAndIndex(result)

      expect(sortedResult).toEqual([
        [[`key5`, [{ id: 5, value: `c` }, 2]], 1],
        [[`key4`, [{ id: 4, value: `y` }, 3]], 1],
      ])
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
        orderByWithIndex((item) => item.id),
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
      const sortedResult = sortByKeyAndIndex(result)

      expect(sortedResult).toEqual([
        [[`key1`, [{ id: 1, value: `a` }, 0]], 1],
        [[`key2`, [{ id: 2, value: `b` }, 1]], 1],
        [[`key3`, [{ id: 3, value: `c` }, 2]], 1],
        [[`key4`, [{ id: 4, value: `d` }, 3]], 1],
        [[`key5`, [{ id: 5, value: `e` }, 4]], 1],
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
        orderByWithIndex((item) => item.value, { limit: 3 }),
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
      const sortedInitialResult = sortByKeyAndIndex(initialResult)

      expect(sortedInitialResult).toEqual([
        [[`key1`, [{ id: 1, value: `a` }, 0]], 1],
        [[`key2`, [{ id: 2, value: `b` }, 1]], 1],
        [[`key3`, [{ id: 3, value: `c` }, 2]], 1],
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
      const sortedResult = sortByKeyAndIndex(result)

      expect(sortedResult).toEqual([
        // We dont get key1 as its not changed or moved
        [[`key2`, [{ id: 2, value: `b` }, 1]], -1], // key2 is moved
        [[`key4`, [{ id: 4, value: `aa` }, 1]], 1], // New row
        [[`key3`, [{ id: 3, value: `c` }, 2]], -1], // key3 is removed as its moved out of top 3
        [[`key2`, [{ id: 2, value: `b` }, 2]], 1], // key2 is moved
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
      let latestMessage: any = null

      input.pipe(
        orderByWithIndex((item) => item.value, { limit: 3 }),
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
          [[`key4`, { id: 4, value: `d` }], 1],
        ])
      )
      graph.run()

      // Remove a row that was in the top 3
      input.sendData(
        new MultiSet([
          [[`key1`, { id: 1, value: `a` }], -1], // Remove the first item
        ])
      )
      graph.run()

      expect(latestMessage).not.toBeNull()

      const result = latestMessage.getInner()
      const sortedResult = sortByKeyAndIndex(result)

      expect(sortedResult).toEqual([
        // key1 is removed
        [[`key1`, [{ id: 1, value: `a` }, 0]], -1],
        // All other move up one
        [[`key2`, [{ id: 2, value: `b` }, 0]], 1],
        [[`key2`, [{ id: 2, value: `b` }, 1]], -1],
        [[`key3`, [{ id: 3, value: `c` }, 1]], 1],
        [[`key3`, [{ id: 3, value: `c` }, 2]], -1],
        [[`key4`, [{ id: 4, value: `d` }, 2]], 1],
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
      let latestMessage: any = null

      input.pipe(
        orderByWithIndex((item) => item.value, { limit: 3 }),
        output((message) => {
          latestMessage = message
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

      expect(latestMessage).not.toBeNull()

      const initialResult = latestMessage.getInner()
      const sortedInitialResult = sortByKeyAndIndex(initialResult)

      expect(sortedInitialResult).toEqual([
        [[`key1`, [{ id: 1, value: `a` }, 0]], 1],
        [[`key3`, [{ id: 3, value: `b` }, 1]], 1],
        [[`key2`, [{ id: 2, value: `c` }, 2]], 1],
      ])

      // Modify an existing row by removing it and adding a new version
      input.sendData(
        new MultiSet([
          [[`key2`, { id: 2, value: `c` }], -1], // Remove old version
          [[`key2`, { id: 2, value: `z` }], 1], // Add new version with different value
        ])
      )
      graph.run()

      expect(latestMessage).not.toBeNull()

      const result = latestMessage.getInner()
      const sortedResult = sortByKeyAndIndex(result)

      expect(sortedResult).toEqual([
        [[`key2`, [{ id: 2, value: `c` }, 2]], -1], // removed as out of top 3
        [[`key4`, [{ id: 4, value: `d` }, 2]], 1], // key4 is moved up
      ])
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
      ) => aKey - bKey
    )
    .sort(
      (
        [[_aKey, [_aValue, _aIndex]], _aMultiplicity],
        [[_bKey, [_bValue, _bIndex]], _bMultiplicity]
      ) => _aIndex - _bIndex
    )
}
