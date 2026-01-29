/**
 * Test for GitHub issue #1186: Infinite Loop in BTreeIndex.takeInternal
 *
 * This test reproduces the bug where using orderBy() and limit() on a collection
 * containing items with undefined indexed values causes an infinite loop.
 *
 * Root cause: When `nextHigherPair(undefined)` is called, it returns the minimum
 * pair from the B-tree. If that minimum key is itself `undefined`, the method
 * returns `[undefined, undefined]`. After processing, the code sets `key = pair[0]`
 * which is `undefined`, and calls `nextHigherPair(undefined)` again, returning
 * the same pair - creating an infinite loop.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryCollection } from '../src/query/live-query-collection.js'
import { eq } from '../src/query/builder/functions.js'
import type { Collection } from '../src/collection/index.js'

interface TaskItem {
  id: string
  taskDate?: Date
  assignedTo?: number | undefined
}

describe(`BTreeIndex - Issue #1186: Infinite loop with undefined indexed values`, () => {
  let collection: Collection<TaskItem, string>
  let beginFn: () => void
  let writeFn: (mutation: { type: string; value: TaskItem }) => void
  let commitFn: () => void

  beforeEach(async () => {
    collection = createCollection<TaskItem, string>({
      id: `test-collection`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          beginFn = begin
          writeFn = write as (mutation: {
            type: string
            value: TaskItem
          }) => void
          commitFn = commit

          // Initialize with empty state
          begin()
          commit()
          markReady()
        },
      },
    })

    await collection.stateWhenReady()
  })

  // Helper function to insert items via sync
  function insertItem(item: TaskItem) {
    beginFn()
    writeFn({ type: `insert`, value: item })
    commitFn()
  }

  it(
    `should handle live query with where, orderBy and limit with undefined values`,
    { timeout: 5000 },
    async () => {
      // Create index on taskDate field
      collection.createIndex((row) => row.taskDate)
      collection.createIndex((row) => row.assignedTo)

      // Insert item with undefined assignedTo
      insertItem({ id: `1`, assignedTo: undefined, taskDate: undefined })

      // Create a live query similar to the issue report
      const liveQuery = createLiveQueryCollection({
        query: (q: any) =>
          q
            .from({ item: collection })
            .where(({ item }: any) => eq(item.assignedTo, 35))
            .orderBy(({ item }: any) => item.taskDate, `desc`)
            .limit(1)
            .select(({ item }: any) => ({
              id: item.id,
              taskDate: item.taskDate,
            })),
        startSync: true,
      })

      await liveQuery.stateWhenReady()

      // Should have 0 results (no matching assignedTo)
      expect(liveQuery.size).toBe(0)

      // Insert matching item - this should trigger the query without infinite loop
      insertItem({
        id: `2`,
        assignedTo: 35,
        taskDate: new Date(`2024-01-15`),
      })

      // Should now have 1 result
      expect(liveQuery.size).toBe(1)
      expect(liveQuery.toArray[0]?.id).toBe(`2`)
    },
  )
})
