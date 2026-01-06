/**
 * Contract verification tests for the live query system.
 *
 * These tests verify the contracts (preconditions, postconditions, invariants)
 * defined in the live query implementation. Based on the code contracts pattern
 * from Cheng Huang's article on AI-assisted development.
 *
 * Key contracts tested:
 * 1. D2 Multiplicity Invariant - Each key has multiplicity exactly 1 in D2
 * 2. SentToD2Keys Tracking - Accurately tracks keys sent to the D2 pipeline
 * 3. Insert/Delete Consistency - Inserts add to tracking, deletes remove
 */

import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import {
  InvariantViolationError,
  PostconditionViolationError,
} from '../../src/contracts.js'
import { mockSyncCollectionOptions } from '../utils.js'

// Sample types for tests
type Item = {
  id: number
  name: string
  category: string
}

const sampleItems: Array<Item> = [
  { id: 1, name: `Item 1`, category: `A` },
  { id: 2, name: `Item 2`, category: `A` },
  { id: 3, name: `Item 3`, category: `B` },
]

function createItemsCollection(initialData: Array<Item> = sampleItems) {
  return createCollection(
    mockSyncCollectionOptions<Item>({
      id: `test-items`,
      getKey: (item) => item.id,
      initialData,
    }),
  )
}

describe(`Live Query Contracts`, () => {
  describe(`D2 Multiplicity Invariant`, () => {
    /**
     * Contract: D2 multiplicity === 1 for all visible items
     * Each key should appear exactly once in the D2 pipeline output.
     */

    it(`maintains multiplicity of 1 for initial inserts`, async () => {
      const source = createItemsCollection()
      const liveQuery = createLiveQueryCollection((q) =>
        q.from({ item: source }),
      )

      await liveQuery.preload()

      // All items should be present exactly once
      expect(liveQuery.size).toBe(3)
      expect(liveQuery.get(1)).toBeDefined()
      expect(liveQuery.get(2)).toBeDefined()
      expect(liveQuery.get(3)).toBeDefined()
    })

    it(`maintains multiplicity of 1 after update (no duplicates)`, async () => {
      const source = createItemsCollection()
      const liveQuery = createLiveQueryCollection((q) =>
        q.from({ item: source }),
      )

      await liveQuery.preload()

      // Update an item - should not create duplicate
      source.utils.begin()
      source.utils.write({
        type: `update`,
        value: { id: 1, name: `Updated Item 1`, category: `A` },
      })
      source.utils.commit()

      // Should still have exactly 3 items (no duplicate from update)
      expect(liveQuery.size).toBe(3)
      expect(liveQuery.get(1)?.name).toBe(`Updated Item 1`)
    })

    it(`maintains multiplicity of 1 after delete and re-insert`, async () => {
      const source = createItemsCollection()
      const liveQuery = createLiveQueryCollection((q) =>
        q.from({ item: source }),
      )

      await liveQuery.preload()

      // Delete an item
      source.utils.begin()
      source.utils.write({
        type: `delete`,
        value: { id: 1, name: `Item 1`, category: `A` },
      })
      source.utils.commit()

      expect(liveQuery.size).toBe(2)
      expect(liveQuery.get(1)).toBeUndefined()

      // Re-insert the same item
      source.utils.begin()
      source.utils.write({
        type: `insert`,
        value: { id: 1, name: `Item 1 Reinserted`, category: `A` },
      })
      source.utils.commit()

      // Should have 3 items, with the new value
      expect(liveQuery.size).toBe(3)
      expect(liveQuery.get(1)?.name).toBe(`Item 1 Reinserted`)
    })

    it(`filters duplicate inserts to maintain multiplicity via sentToD2Keys`, async () => {
      // This test verifies the sentToD2Keys tracking prevents duplicates
      // at the D2 pipeline level. The source collection also has duplicate
      // protection, so we test the invariant by verifying consistent state
      // after updates (which internally are delete+insert in D2).
      const source = createItemsCollection()
      const liveQuery = createLiveQueryCollection((q) =>
        q.from({ item: source }),
      )

      await liveQuery.preload()

      // Multiple rapid updates to same key - internally these become
      // delete+insert pairs. The sentToD2Keys tracking ensures we don't
      // accidentally send duplicates to D2.
      for (let i = 0; i < 5; i++) {
        source.utils.begin()
        source.utils.write({
          type: `update`,
          value: { id: 1, name: `Update ${i}`, category: `A` },
        })
        source.utils.commit()
      }

      // Size should still be 3 (no duplicates from rapid updates)
      expect(liveQuery.size).toBe(3)
      expect(liveQuery.get(1)?.name).toBe(`Update 4`)
    })
  })

  describe(`SentToD2Keys Tracking Postcondition`, () => {
    /**
     * Contract: sentToD2Keys accurately tracks all keys currently in D2
     * After insert: key is in sentToD2Keys
     * After delete: key is not in sentToD2Keys
     */

    it(`tracks keys after sequential inserts`, async () => {
      const source = createItemsCollection([])
      const liveQuery = createLiveQueryCollection((q) =>
        q.from({ item: source }),
      )

      await liveQuery.preload()

      // Insert items one by one
      for (let i = 1; i <= 3; i++) {
        source.utils.begin()
        source.utils.write({
          type: `insert`,
          value: { id: i, name: `Item ${i}`, category: `A` },
        })
        source.utils.commit()

        // Each insert should be immediately visible
        expect(liveQuery.get(i)).toBeDefined()
      }

      expect(liveQuery.size).toBe(3)
    })

    it(`removes key from tracking after delete`, async () => {
      const source = createItemsCollection()
      const liveQuery = createLiveQueryCollection((q) =>
        q.from({ item: source }),
      )

      await liveQuery.preload()

      // Verify initial state
      expect(liveQuery.get(1)).toBeDefined()

      // Delete
      source.utils.begin()
      source.utils.write({
        type: `delete`,
        value: { id: 1, name: `Item 1`, category: `A` },
      })
      source.utils.commit()

      // Key should be removed from live query (and tracking)
      expect(liveQuery.get(1)).toBeUndefined()
      expect(liveQuery.size).toBe(2)
    })

    it(`allows re-insert after delete (tracking correctly cleared)`, async () => {
      const source = createItemsCollection()
      const liveQuery = createLiveQueryCollection((q) =>
        q.from({ item: source }),
      )

      await liveQuery.preload()

      // Delete then re-insert multiple times
      for (let i = 0; i < 3; i++) {
        source.utils.begin()
        source.utils.write({
          type: `delete`,
          value: { id: 1, name: `Item 1`, category: `A` },
        })
        source.utils.commit()

        expect(liveQuery.get(1)).toBeUndefined()

        source.utils.begin()
        source.utils.write({
          type: `insert`,
          value: { id: 1, name: `Item 1 v${i + 2}`, category: `A` },
        })
        source.utils.commit()

        expect(liveQuery.get(1)).toBeDefined()
        expect(liveQuery.get(1)?.name).toBe(`Item 1 v${i + 2}`)
      }

      expect(liveQuery.size).toBe(3)
    })
  })

  describe(`Filtered Query Contracts`, () => {
    /**
     * When a live query has a WHERE clause, the D2 pipeline should only
     * contain items matching the filter.
     */

    it(`only includes matching items in D2 output`, async () => {
      const source = createItemsCollection()
      const liveQuery = createLiveQueryCollection((q) =>
        q.from({ item: source }).where(({ item }) => eq(item.category, `A`)),
      )

      await liveQuery.preload()

      // Only category A items should be present
      expect(liveQuery.size).toBe(2)
      expect(liveQuery.get(1)).toBeDefined()
      expect(liveQuery.get(2)).toBeDefined()
      expect(liveQuery.get(3)).toBeUndefined() // category B
    })

    it(`removes item from D2 when update moves it out of filter`, async () => {
      const source = createItemsCollection()
      const liveQuery = createLiveQueryCollection((q) =>
        q.from({ item: source }).where(({ item }) => eq(item.category, `A`)),
      )

      await liveQuery.preload()

      expect(liveQuery.size).toBe(2)

      // Update item 1 to category B (out of filter)
      source.utils.begin()
      source.utils.write({
        type: `update`,
        value: { id: 1, name: `Item 1`, category: `B` },
      })
      source.utils.commit()

      // Item 1 should no longer be in the live query
      expect(liveQuery.size).toBe(1)
      expect(liveQuery.get(1)).toBeUndefined()
      expect(liveQuery.get(2)).toBeDefined()
    })

    it(`adds item to D2 when update moves it into filter`, async () => {
      const source = createItemsCollection()
      const liveQuery = createLiveQueryCollection((q) =>
        q.from({ item: source }).where(({ item }) => eq(item.category, `A`)),
      )

      await liveQuery.preload()

      expect(liveQuery.size).toBe(2)
      expect(liveQuery.get(3)).toBeUndefined() // category B initially

      // Update item 3 to category A (into filter)
      source.utils.begin()
      source.utils.write({
        type: `update`,
        value: { id: 3, name: `Item 3`, category: `A` },
      })
      source.utils.commit()

      // Item 3 should now be in the live query
      expect(liveQuery.size).toBe(3)
      expect(liveQuery.get(3)).toBeDefined()
      expect(liveQuery.get(3)?.category).toBe(`A`)
    })
  })

  describe(`Change Sequence Consistency`, () => {
    /**
     * Contract: Live query state should be consistent with source state
     * after any sequence of insert/update/delete operations.
     */

    it(`remains consistent after mixed operation sequence`, async () => {
      const source = createItemsCollection([])
      const liveQuery = createLiveQueryCollection((q) =>
        q.from({ item: source }),
      )

      await liveQuery.preload()

      // Mixed sequence of operations
      const operations = [
        { type: `insert` as const, id: 1, name: `A` },
        { type: `insert` as const, id: 2, name: `B` },
        { type: `update` as const, id: 1, name: `A-updated` },
        { type: `insert` as const, id: 3, name: `C` },
        { type: `delete` as const, id: 2 },
        { type: `insert` as const, id: 4, name: `D` },
        { type: `update` as const, id: 3, name: `C-updated` },
        { type: `delete` as const, id: 1 },
        { type: `insert` as const, id: 1, name: `A-reinserted` },
      ]

      for (const op of operations) {
        source.utils.begin()
        if (op.type === `insert`) {
          source.utils.write({
            type: `insert`,
            value: { id: op.id, name: op.name, category: `X` },
          })
        } else if (op.type === `update`) {
          source.utils.write({
            type: `update`,
            value: { id: op.id, name: op.name, category: `X` },
          })
        } else {
          source.utils.write({
            type: `delete`,
            value: { id: op.id, name: ``, category: `X` },
          })
        }
        source.utils.commit()
      }

      // Final state should have items 1, 3, 4
      expect(liveQuery.size).toBe(3)
      expect(liveQuery.get(1)?.name).toBe(`A-reinserted`)
      expect(liveQuery.get(2)).toBeUndefined()
      expect(liveQuery.get(3)?.name).toBe(`C-updated`)
      expect(liveQuery.get(4)?.name).toBe(`D`)
    })

    it(`handles rapid insert-delete cycles`, async () => {
      const source = createItemsCollection([])
      const liveQuery = createLiveQueryCollection((q) =>
        q.from({ item: source }),
      )

      await liveQuery.preload()

      // Rapid insert-delete cycles for same key
      for (let cycle = 0; cycle < 5; cycle++) {
        source.utils.begin()
        source.utils.write({
          type: `insert`,
          value: { id: 1, name: `Cycle ${cycle}`, category: `X` },
        })
        source.utils.commit()

        expect(liveQuery.get(1)?.name).toBe(`Cycle ${cycle}`)

        source.utils.begin()
        source.utils.write({
          type: `delete`,
          value: { id: 1, name: `Cycle ${cycle}`, category: `X` },
        })
        source.utils.commit()

        expect(liveQuery.get(1)).toBeUndefined()
      }

      expect(liveQuery.size).toBe(0)
    })
  })

  describe(`Batch Operation Contracts`, () => {
    /**
     * Contract: Batch operations (multiple changes in one begin/commit)
     * should maintain all invariants.
     */

    it(`handles batch inserts without duplicate keys in D2`, async () => {
      const source = createItemsCollection([])
      const liveQuery = createLiveQueryCollection((q) =>
        q.from({ item: source }),
      )

      await liveQuery.preload()

      // Batch insert multiple items
      source.utils.begin()
      for (let i = 1; i <= 10; i++) {
        source.utils.write({
          type: `insert`,
          value: { id: i, name: `Batch Item ${i}`, category: `A` },
        })
      }
      source.utils.commit()

      // All 10 items should be present exactly once
      expect(liveQuery.size).toBe(10)
      for (let i = 1; i <= 10; i++) {
        expect(liveQuery.get(i)).toBeDefined()
        expect(liveQuery.get(i)?.name).toBe(`Batch Item ${i}`)
      }
    })

    it(`handles batch with mixed operations`, async () => {
      const source = createItemsCollection()
      const liveQuery = createLiveQueryCollection((q) =>
        q.from({ item: source }),
      )

      await liveQuery.preload()

      expect(liveQuery.size).toBe(3)

      // Batch with mixed operations
      source.utils.begin()
      source.utils.write({
        type: `delete`,
        value: { id: 1, name: `Item 1`, category: `A` },
      })
      source.utils.write({
        type: `update`,
        value: { id: 2, name: `Updated Item 2`, category: `A` },
      })
      source.utils.write({
        type: `insert`,
        value: { id: 4, name: `New Item 4`, category: `C` },
      })
      source.utils.commit()

      expect(liveQuery.size).toBe(3) // -1 delete, +1 insert = same size
      expect(liveQuery.get(1)).toBeUndefined()
      expect(liveQuery.get(2)?.name).toBe(`Updated Item 2`)
      expect(liveQuery.get(3)).toBeDefined()
      expect(liveQuery.get(4)?.name).toBe(`New Item 4`)
    })
  })
})

describe(`Contract Error Types`, () => {
  /**
   * Verify that contract violation errors are properly typed
   * and can be caught/identified.
   */

  it(`InvariantViolationError has correct structure`, () => {
    const error = new InvariantViolationError(`test invariant message`)

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(InvariantViolationError)
    expect(error.name).toBe(`InvariantViolationError`)
    expect(error.violationType).toBe(`invariant`)
    expect(error.message).toContain(`test invariant message`)
    expect(error.message).toContain(`Invariant violation`)
  })

  it(`PostconditionViolationError has correct structure`, () => {
    const error = new PostconditionViolationError(`test postcondition message`)

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(PostconditionViolationError)
    expect(error.name).toBe(`PostconditionViolationError`)
    expect(error.violationType).toBe(`postcondition`)
    expect(error.message).toContain(`test postcondition message`)
    expect(error.message).toContain(`Postcondition violation`)
  })
})
