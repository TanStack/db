import { describe, expect, it } from 'vitest'
import { render, renderHook, waitFor } from '@solidjs/testing-library'
import { and, createCollection, gte, lte } from '@tanstack/db'
import { For, createEffect } from 'solid-js'
import { useLiveQuery } from '../src/useLiveQuery'
import { mockSyncCollectionOptions } from '../../db/tests/utils'

type Item = {
  id: string
  index: number
  name: string
}

const createInitialItems = (): Array<Item> => [
  { id: `a`, index: 1, name: `Item A` },
  { id: `b`, index: 2, name: `Item B` },
  { id: `c`, index: 3, name: `Item C` },
  { id: `d`, index: 4, name: `Item D` },
  { id: `e`, index: 5, name: `Item E` },
]

describe(`Multiple useLiveQuery instances with where + orderBy`, () => {
  it(`should maintain consistent data when updating items that move in/out of filter range with limit`, async () => {
    // This test reproduces the scenario from the issue report:
    // - Multiple components using the same query with where + orderBy + limit
    // - Items are updated in ways that cause them to move in/out of the filter range
    // - Each update should result in all query instances showing identical data

    const collection = createCollection(
      mockSyncCollectionOptions<Item>({
        id: `filter-boundary-test`,
        getKey: (item: Item) => item.id,
        initialData: createInitialItems(),
      }),
    )

    // Track state snapshots from multiple hooks
    const stateSnapshots: Array<
      Array<{ id: string; index: number; name: string }>
    > = []

    // Create 4 query hooks with where + orderBy + limit (as in the issue)
    const queries = [1, 2, 3, 4].map(() =>
      renderHook(() => {
        const query = useLiveQuery((q) =>
          q
            .from({ items: collection })
            .where(({ items }) => and(gte(items.index, 1), lte(items.index, 4)))
            .select(({ items }) => ({
              id: items.id,
              index: items.index,
              name: items.name,
            }))
            .orderBy(({ items }) => items.index, `asc`)
            .limit(10),
        )

        // Track each query's effect updates
        createEffect(() => {
          const data = query()
          stateSnapshots.push([...data])
        })

        return query
      }),
    )

    // Wait for initial sync
    await waitFor(() => {
      for (const query of queries) {
        expect(query.result.state.size).toBe(4)
      }
    })

    // Clear snapshots to start fresh
    stateSnapshots.length = 0

    // Simulate the "decrement all" operation from the issue
    // This causes item 'a' (index 1) to move out of range (index 0)
    // and item 'e' (index 5) to move into range (index 4)
    collection.utils.begin()
    for (const id of [`a`, `b`, `c`, `d`, `e`]) {
      const current = collection.get(id)
      if (current) {
        collection.utils.write({
          type: `update`,
          value: { ...current, index: current.index - 1 },
        })
      }
    }
    collection.utils.commit()

    // Wait for all queries to update
    await new Promise((resolve) => setTimeout(resolve, 100))

    // All queries should now show items b, c, d, e (indices 1, 2, 3, 4)
    for (const query of queries) {
      const ids = query
        .result()
        .map((item) => item.id)
        .sort()
      expect(ids).toEqual([`b`, `c`, `d`, `e`])
    }

    // Verify all 4 queries show identical data (the core assertion for this bug)
    const allResults = queries.map((q) =>
      q
        .result()
        .map((item) => `${item.id}:${item.index}`)
        .sort()
        .join(','),
    )
    const uniqueResults = [...new Set(allResults)]
    expect(uniqueResults.length).toBe(1) // All queries should show the same result

    // Now simulate "change name" which doesn't affect filter but does update items
    stateSnapshots.length = 0
    collection.utils.begin()
    for (const id of [`b`, `c`, `d`, `e`]) {
      const current = collection.get(id)
      if (current) {
        collection.utils.write({
          type: `update`,
          value: { ...current, name: current.name + `+` },
        })
      }
    }
    collection.utils.commit()

    // Wait for all queries to update
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Verify all queries show the same updated names
    const allNames = queries.map((q) =>
      q
        .result()
        .map((item) => item.name)
        .sort()
        .join(','),
    )
    const uniqueNames = [...new Set(allNames)]
    expect(uniqueNames.length).toBe(1)

    // Check that names were actually updated
    for (const query of queries) {
      const names = query.result().map((item) => item.name)
      for (const name of names) {
        expect(name).toContain(`+`)
      }
    }
  })

  it(`should maintain consistent data across multiple query instances when items are updated`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Item>({
        id: `multiple-queries-test`,
        getKey: (item: Item) => item.id,
        initialData: createInitialItems(),
      }),
    )

    // Create 4 independent useLiveQuery hooks with the same query
    // (simulating 4 List components as in the bug report)
    const query1 = renderHook(() => {
      return useLiveQuery((q) =>
        q
          .from({ items: collection })
          .where(({ items }) => and(gte(items.index, 1), lte(items.index, 4)))
          .select(({ items }) => ({
            id: items.id,
            index: items.index,
            name: items.name,
          }))
          .orderBy(({ items }) => items.index, `asc`),
      )
    })

    const query2 = renderHook(() => {
      return useLiveQuery((q) =>
        q
          .from({ items: collection })
          .where(({ items }) => and(gte(items.index, 1), lte(items.index, 4)))
          .select(({ items }) => ({
            id: items.id,
            index: items.index,
            name: items.name,
          }))
          .orderBy(({ items }) => items.index, `asc`),
      )
    })

    const query3 = renderHook(() => {
      return useLiveQuery((q) =>
        q
          .from({ items: collection })
          .where(({ items }) => and(gte(items.index, 1), lte(items.index, 4)))
          .select(({ items }) => ({
            id: items.id,
            index: items.index,
            name: items.name,
          }))
          .orderBy(({ items }) => items.index, `asc`),
      )
    })

    const query4 = renderHook(() => {
      return useLiveQuery((q) =>
        q
          .from({ items: collection })
          .where(({ items }) => and(gte(items.index, 1), lte(items.index, 4)))
          .select(({ items }) => ({
            id: items.id,
            index: items.index,
            name: items.name,
          }))
          .orderBy(({ items }) => items.index, `asc`),
      )
    })

    // Wait for all queries to sync
    await waitFor(() => {
      expect(query1.result.state.size).toBe(4)
      expect(query2.result.state.size).toBe(4)
      expect(query3.result.state.size).toBe(4)
      expect(query4.result.state.size).toBe(4)
    })

    // Verify all queries show the same initial data
    const getItemIds = (query: typeof query1) =>
      query
        .result()
        .map((item) => item.id)
        .sort()

    expect(getItemIds(query1)).toEqual([`a`, `b`, `c`, `d`])
    expect(getItemIds(query2)).toEqual([`a`, `b`, `c`, `d`])
    expect(getItemIds(query3)).toEqual([`a`, `b`, `c`, `d`])
    expect(getItemIds(query4)).toEqual([`a`, `b`, `c`, `d`])

    // Decrement all indices (simulating the "decrement all" button)
    collection.utils.begin()
    collection.utils.write({
      type: `update`,
      value: { id: `a`, index: 0, name: `Item A` },
    })
    collection.utils.write({
      type: `update`,
      value: { id: `b`, index: 1, name: `Item B` },
    })
    collection.utils.write({
      type: `update`,
      value: { id: `c`, index: 2, name: `Item C` },
    })
    collection.utils.write({
      type: `update`,
      value: { id: `d`, index: 3, name: `Item D` },
    })
    collection.utils.write({
      type: `update`,
      value: { id: `e`, index: 4, name: `Item E` },
    })
    collection.utils.commit()

    // Wait for updates to propagate
    await waitFor(() => {
      // After decrement, indices are 0,1,2,3,4
      // Where clause filters to indices 1-4, so items b,c,d,e should be visible
      expect(query1.result.state.size).toBe(4)
    })

    // All 4 queries should show the same updated data
    // Items with index 1-4 are: b(1), c(2), d(3), e(4)
    await waitFor(() => {
      expect(getItemIds(query1)).toEqual([`b`, `c`, `d`, `e`])
      expect(getItemIds(query2)).toEqual([`b`, `c`, `d`, `e`])
      expect(getItemIds(query3)).toEqual([`b`, `c`, `d`, `e`])
      expect(getItemIds(query4)).toEqual([`b`, `c`, `d`, `e`])
    })

    // Now update names (simulating the "change name" button)
    collection.utils.begin()
    collection.utils.write({
      type: `update`,
      value: { id: `b`, index: 1, name: `Item B+` },
    })
    collection.utils.write({
      type: `update`,
      value: { id: `c`, index: 2, name: `Item C+` },
    })
    collection.utils.write({
      type: `update`,
      value: { id: `d`, index: 3, name: `Item D+` },
    })
    collection.utils.write({
      type: `update`,
      value: { id: `e`, index: 4, name: `Item E+` },
    })
    collection.utils.commit()

    // Wait for name updates and verify all queries are consistent
    await waitFor(() => {
      const names1 = query1
        .result()
        .map((item) => item.name)
        .sort()
      const names2 = query2
        .result()
        .map((item) => item.name)
        .sort()
      const names3 = query3
        .result()
        .map((item) => item.name)
        .sort()
      const names4 = query4
        .result()
        .map((item) => item.name)
        .sort()

      expect(names1).toEqual([`Item B+`, `Item C+`, `Item D+`, `Item E+`])
      expect(names2).toEqual([`Item B+`, `Item C+`, `Item D+`, `Item E+`])
      expect(names3).toEqual([`Item B+`, `Item C+`, `Item D+`, `Item E+`])
      expect(names4).toEqual([`Item B+`, `Item C+`, `Item D+`, `Item E+`])
    })

    // Verify ordering is correct (by index ascending)
    const getOrderedIndices = (query: typeof query1) =>
      query.result().map((item) => item.index)

    expect(getOrderedIndices(query1)).toEqual([1, 2, 3, 4])
    expect(getOrderedIndices(query2)).toEqual([1, 2, 3, 4])
    expect(getOrderedIndices(query3)).toEqual([1, 2, 3, 4])
    expect(getOrderedIndices(query4)).toEqual([1, 2, 3, 4])
  })

  it(`should correctly update all query instances when items move in and out of filter range`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Item>({
        id: `filter-range-test`,
        getKey: (item: Item) => item.id,
        initialData: createInitialItems(),
      }),
    )

    // Create multiple useLiveQuery hooks
    const queries = [1, 2, 3, 4].map(() =>
      renderHook(() => {
        return useLiveQuery((q) =>
          q
            .from({ items: collection })
            .where(({ items }) => and(gte(items.index, 2), lte(items.index, 4)))
            .select(({ items }) => ({
              id: items.id,
              index: items.index,
              name: items.name,
            }))
            .orderBy(({ items }) => items.index, `asc`),
        )
      }),
    )

    // Wait for initial sync - items b(2), c(3), d(4) should be visible
    await waitFor(() => {
      for (const query of queries) {
        expect(query.result.state.size).toBe(3)
      }
    })

    const getAllIds = () =>
      queries.map((q) =>
        q
          .result()
          .map((item) => item.id)
          .sort(),
      )

    // Verify initial state
    const initialIds = getAllIds()
    for (const ids of initialIds) {
      expect(ids).toEqual([`b`, `c`, `d`])
    }

    // Move item 'a' into range (index 1 -> 3)
    collection.utils.begin()
    collection.utils.write({
      type: `update`,
      value: { id: `a`, index: 3, name: `Item A` },
    })
    // Move item 'b' out of range (index 2 -> 1)
    collection.utils.write({
      type: `update`,
      value: { id: `b`, index: 1, name: `Item B` },
    })
    collection.utils.commit()

    // After update: a(3), c(3), d(4) should be visible (b is now at index 1, out of range)
    // Wait for updates
    await waitFor(() => {
      for (const query of queries) {
        expect(query.result.state.size).toBe(3)
      }
    })

    // Verify all queries show consistent data
    const updatedIds = getAllIds()
    for (const ids of updatedIds) {
      expect(ids).toEqual([`a`, `c`, `d`])
    }
  })

  it(`should handle rapid consecutive updates correctly across all query instances`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Item>({
        id: `rapid-updates-test`,
        getKey: (item: Item) => item.id,
        initialData: createInitialItems(),
      }),
    )

    // Create multiple useLiveQuery hooks
    const queries = [1, 2, 3, 4].map(() =>
      renderHook(() => {
        return useLiveQuery((q) =>
          q
            .from({ items: collection })
            .where(({ items }) => and(gte(items.index, 1), lte(items.index, 4)))
            .select(({ items }) => ({
              id: items.id,
              index: items.index,
              name: items.name,
            }))
            .orderBy(({ items }) => items.index, `asc`),
        )
      }),
    )

    // Wait for initial sync
    await waitFor(() => {
      for (const query of queries) {
        expect(query.result.state.size).toBe(4)
      }
    })

    // Perform rapid consecutive updates (simulating multiple button clicks)
    for (let i = 0; i < 3; i++) {
      collection.utils.begin()
      // Decrement all indices
      for (const id of [`a`, `b`, `c`, `d`, `e`]) {
        const current = collection.get(id)
        if (current) {
          collection.utils.write({
            type: `update`,
            value: { ...current, index: current.index - 1 },
          })
        }
      }
      collection.utils.commit()
    }

    // Wait for all updates to settle
    await new Promise((resolve) => setTimeout(resolve, 100))

    // After 3 decrements: a(-2), b(-1), c(0), d(1), e(2)
    // Only d(1) and e(2) should be in range [1, 4]
    await waitFor(() => {
      for (const query of queries) {
        const ids = query
          .result()
          .map((item) => item.id)
          .sort()
        expect(ids).toEqual([`d`, `e`])
      }
    })

    // Verify all queries have consistent ordering
    for (const query of queries) {
      const indices = query.result().map((item) => item.index)
      expect(indices).toEqual([1, 2])
    }
  })

  it(`should render identical data in multiple List components using the same query with limit`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Item>({
        id: `render-test`,
        getKey: (item: Item) => item.id,
        initialData: createInitialItems(),
      }),
    )

    // Track rendered data from each List component
    const renderedData: Array<Array<string>> = [[], [], [], []]

    function ListComponent(props: { index: number }) {
      const query = useLiveQuery(
        (q) =>
          q
            .from({ items: collection })
            .where(({ items }) => and(gte(items.index, 1), lte(items.index, 4)))
            .select(({ items }) => ({
              id: items.id,
              index: items.index,
              name: items.name,
            }))
            .orderBy(({ items }) => items.index, `asc`)
            .limit(10), // Adding limit to match the user's reproduction case
      )

      // Track what this component renders
      createEffect(() => {
        const data = query()
        renderedData[props.index] = data.map(
          (item) => `${item.id}:${item.index}:${item.name}`,
        )
      })

      return (
        <ul data-testid={`list-${props.index}`}>
          <For each={query()}>
            {(item) => (
              <li data-testid={`item-${props.index}-${item.id}`}>
                {item.name} ({item.index})
              </li>
            )}
          </For>
        </ul>
      )
    }

    const { findByTestId } = render(() => (
      <div>
        <ListComponent index={0} />
        <ListComponent index={1} />
        <ListComponent index={2} />
        <ListComponent index={3} />
      </div>
    ))

    // Wait for initial render
    await waitFor(async () => {
      const list0 = await findByTestId(`list-0`)
      expect(list0.children.length).toBe(4)
    })

    // Verify all lists show the same data
    await waitFor(() => {
      for (let i = 1; i < 4; i++) {
        expect(renderedData[i]).toEqual(renderedData[0])
      }
    })

    // Perform an update (decrement all)
    collection.utils.begin()
    for (const id of [`a`, `b`, `c`, `d`, `e`]) {
      const current = collection.get(id)
      if (current) {
        collection.utils.write({
          type: `update`,
          value: { ...current, index: current.index - 1 },
        })
      }
    }
    collection.utils.commit()

    // Wait for updates to propagate
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Verify all lists still show the same data after update
    await waitFor(() => {
      // All lists should render b,c,d,e (indices 1,2,3,4 after decrement)
      for (let i = 0; i < 4; i++) {
        expect(renderedData[i].length).toBe(4)
      }
    })

    // Verify consistency: all lists should render identical data
    for (let i = 1; i < 4; i++) {
      expect(renderedData[i]).toEqual(renderedData[0])
    }

    // Perform another update (change names)
    collection.utils.begin()
    for (const id of [`a`, `b`, `c`, `d`, `e`]) {
      const current = collection.get(id)
      if (current) {
        collection.utils.write({
          type: `update`,
          value: { ...current, name: current.name + `+` },
        })
      }
    }
    collection.utils.commit()

    // Wait for name updates
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Verify all lists show the same updated names
    await waitFor(() => {
      for (let i = 0; i < 4; i++) {
        expect(renderedData[i].some((s) => s.includes(`+`))).toBe(true)
      }
    })

    // Verify consistency again
    for (let i = 1; i < 4; i++) {
      expect(renderedData[i]).toEqual(renderedData[0])
    }
  })

  it(`should handle interleaved updates correctly without data loss`, async () => {
    // This test checks for potential race conditions where updates might
    // be processed differently by different useLiveQuery instances

    const collection = createCollection(
      mockSyncCollectionOptions<Item>({
        id: `interleaved-updates-test`,
        getKey: (item: Item) => item.id,
        initialData: createInitialItems(),
      }),
    )

    // Create multiple useLiveQuery hooks
    const queries = [1, 2, 3, 4].map(() =>
      renderHook(() => {
        return useLiveQuery((q) =>
          q
            .from({ items: collection })
            .where(({ items }) => and(gte(items.index, 1), lte(items.index, 4)))
            .select(({ items }) => ({
              id: items.id,
              index: items.index,
              name: items.name,
            }))
            .orderBy(({ items }) => items.index, `asc`)
            .limit(10),
        )
      }),
    )

    // Wait for initial sync
    await waitFor(() => {
      for (const query of queries) {
        expect(query.result.state.size).toBe(4)
      }
    })

    // Perform multiple rapid updates
    for (let round = 0; round < 5; round++) {
      // Update all items
      collection.utils.begin()
      for (const id of [`a`, `b`, `c`, `d`, `e`]) {
        const current = collection.get(id)
        if (current) {
          collection.utils.write({
            type: `update`,
            value: { ...current, name: current.name + round },
          })
        }
      }
      collection.utils.commit()

      // Small delay to allow some async processing
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Decrement indices
      collection.utils.begin()
      for (const id of [`a`, `b`, `c`, `d`, `e`]) {
        const current = collection.get(id)
        if (current) {
          collection.utils.write({
            type: `update`,
            value: { ...current, index: current.index - 1 },
          })
        }
      }
      collection.utils.commit()

      // Small delay
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    // Wait for all updates to settle
    await new Promise((resolve) => setTimeout(resolve, 200))

    // All queries should show identical data
    const allResultsData = queries.map((q) =>
      q
        .result()
        .map((item) => JSON.stringify(item))
        .sort()
        .join('|'),
    )
    const uniqueResults = [...new Set(allResultsData)]

    // The critical assertion: all queries must show identical data
    expect(uniqueResults.length).toBe(1)

    // Verify the results are consistent arrays (all items typed correctly)
    // Note: after 5 rounds of decrementing indices, all items may be out of range
    // which is expected behavior
    for (const query of queries) {
      const data = query.result()
      expect(Array.isArray(data)).toBe(true)
    }
  })
})
