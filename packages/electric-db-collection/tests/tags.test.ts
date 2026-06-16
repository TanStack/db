import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '@tanstack/db'
import { electricCollectionOptions } from '../src/electric'
import { stripVirtualProps } from '../../db/tests/utils'
import {
  NON_PARTICIPATING,
  deriveDisjunctPositions,
  parseTag,
  rowVisible,
} from '../src/tag-index'
import type { ElectricCollectionUtils } from '../src/electric'
import type { Collection } from '@tanstack/db'
import type { Message, Row } from '@electric-sql/client'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { MovePattern } from '../src/tag-index'

// Mock the ShapeStream module
const mockSubscribe = vi.fn()
const mockRequestSnapshot = vi.fn()
const mockFetchSnapshot = vi.fn()
const mockStream = {
  subscribe: mockSubscribe,
  requestSnapshot: mockRequestSnapshot,
  fetchSnapshot: mockFetchSnapshot,
}

vi.mock(`@electric-sql/client`, async () => {
  const actual = await vi.importActual(`@electric-sql/client`)
  return {
    ...actual,
    ShapeStream: vi.fn(() => mockStream),
  }
})

describe(`Electric Tag Tracking and GC`, () => {
  let collection: Collection<
    Row,
    string | number,
    ElectricCollectionUtils,
    StandardSchemaV1<unknown, unknown>,
    Row
  >
  let subscriber: (messages: Array<Message<Row>>) => void

  beforeEach(() => {
    vi.clearAllMocks()

    // Reset mock subscriber
    mockSubscribe.mockImplementation((callback) => {
      subscriber = callback
      return () => {}
    })

    // Reset mock requestSnapshot
    mockRequestSnapshot.mockResolvedValue(undefined)

    // Create collection with Electric configuration
    const config = {
      id: `test`,
      shapeOptions: {
        url: `http://test-url`,
        params: {
          table: `test_table`,
        },
      },
      startSync: true,
      getKey: (item: Row) => item.id as number,
    }

    // Get the options with utilities
    const options = electricCollectionOptions(config)

    // Create collection with Electric configuration
    collection = createCollection(options) as unknown as Collection<
      Row,
      string | number,
      ElectricCollectionUtils,
      StandardSchemaV1<unknown, unknown>,
      Row
    >

    const stateGetter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(collection),
      `state`,
    )?.get
    if (stateGetter) {
      Object.defineProperty(collection, `state`, {
        get: () => {
          const state = stateGetter.call(collection) as Map<
            string | number,
            Row
          >
          return new Map(
            Array.from(state.entries(), ([key, value]) => [
              key,
              stripVirtualProps(value),
            ]),
          )
        },
      })
    }
  })

  it(`should track tags when rows are inserted with tags`, () => {
    const tag1 = `hash1/hash2/hash3`
    const tag2 = `hash4/hash5/hash6`

    // Insert row with tags
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Test User` },
        headers: {
          operation: `insert`,
          tags: [tag1, tag2],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state).toEqual(
      new Map([[1, { id: 1, name: `Test User` }]]),
    )
    expect(collection.status).toEqual(`ready`)

    // Remove first tag - row should still exist
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Test User` },
        headers: {
          operation: `update`,
          removed_tags: [tag1],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state).toEqual(
      new Map([[1, { id: 1, name: `Test User` }]]),
    )

    // Remove last tag - row should be garbage collected
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Test User` },
        headers: {
          operation: `delete`,
          removed_tags: [tag2],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state).toEqual(new Map())
  })

  it(`should track tags when rows are updated with new tags`, () => {
    const tag1 = `hash1/hash2/hash3`

    // Insert row with tags
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Test User` },
        headers: {
          operation: `insert`,
          tags: [tag1],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state).toEqual(
      new Map([[1, { id: 1, name: `Test User` }]]),
    )

    // Update with additional tags
    const tag2 = `hash4/hash5/hash6`
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Updated User` },
        headers: {
          operation: `update`,
          tags: [tag2],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state).toEqual(
      new Map([[1, { id: 1, name: `Updated User` }]]),
    )

    // Remove first tag - row should still exist
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Updated User` },
        headers: {
          operation: `update`,
          removed_tags: [tag1],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state).toEqual(
      new Map([[1, { id: 1, name: `Updated User` }]]),
    )

    // Remove last tag - row should be garbage collected
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Updated User` },
        headers: {
          operation: `delete`,
          removed_tags: [tag2],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state).toEqual(new Map())
  })

  it(`should track tags that are structurally equal`, () => {
    const tag1 = `hash1/hash2/hash3`
    const tag1Copy = `hash1/hash2/hash3`

    // Insert row with tags
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Test User` },
        headers: {
          operation: `insert`,
          tags: [tag1],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state).toEqual(
      new Map([[1, { id: 1, name: `Test User` }]]),
    )

    // Remove first tag - row should be gone
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Updated User` },
        headers: {
          operation: `delete`,
          removed_tags: [tag1Copy],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state).toEqual(new Map())
  })

  it(`should not interfere between rows with distinct tags`, () => {
    const tag1 = `hash1/hash2/hash3`
    const tag2 = `hash4/hash5/hash6`
    const tag3 = `hash7/hash8/hash9`
    const tag4 = `hash10/hash11/hash12`

    // Insert multiple rows with some shared tags
    // Row 1: tag1, tag2
    // Row 2: tag2 (shared with row 1), tag3
    // Row 3: tag3 (shared with row 2), tag4
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: {
          operation: `insert`,
          tags: [tag1, tag2],
        },
      },
      {
        key: `2`,
        value: { id: 2, name: `User 2` },
        headers: {
          operation: `insert`,
          tags: [tag2, tag3],
        },
      },
      {
        key: `3`,
        value: { id: 3, name: `User 3` },
        headers: {
          operation: `insert`,
          tags: [tag3, tag4],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // All rows should exist
    expect(collection.state.size).toBe(3)
    expect(collection.state.get(1)).toEqual({ id: 1, name: `User 1` })
    expect(collection.state.get(2)).toEqual({ id: 2, name: `User 2` })
    expect(collection.state.get(3)).toEqual({ id: 3, name: `User 3` })

    // Remove tag1 from row 1 - row 1 should still exist (has tag2), others unaffected
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: {
          operation: `update`,
          removed_tags: [tag1],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row 1 should still exist (has tag2), rows 2 and 3 unaffected
    expect(collection.state.size).toBe(3)
    expect(collection.state.get(1)).toEqual({ id: 1, name: `User 1` })
    expect(collection.state.get(2)).toEqual({ id: 2, name: `User 2` })
    expect(collection.state.get(3)).toEqual({ id: 3, name: `User 3` })

    // Remove tag2 from row 1 (shared tag) - row 1 should be deleted
    // Row 2 should still exist because it has tag3 (tag2 removal only affects row 1)
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: {
          operation: `delete`,
          removed_tags: [tag2],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row 1 should be garbage collected, rows 2 and 3 should remain
    // Row 2 still has tag2 and tag3, so removing tag2 from row 1 doesn't affect it
    expect(collection.state.size).toBe(2)
    expect(collection.state.has(1)).toBe(false)
    expect(collection.state.get(2)).toEqual({ id: 2, name: `User 2` })
    expect(collection.state.get(3)).toEqual({ id: 3, name: `User 3` })

    // Remove tag3 from row 2 - row 2 should still exist (has tag2)
    // Row 3 should still exist because it has tag4 (tag3 removal only affects row 2)
    subscriber([
      {
        key: `2`,
        value: { id: 2, name: `User 2` },
        headers: {
          operation: `update`,
          removed_tags: [tag3],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row 2 should still exist (has tag3), row 3 unaffected
    expect(collection.state.size).toBe(2)
    expect(collection.state.has(1)).toBe(false)
    expect(collection.state.get(2)).toEqual({ id: 2, name: `User 2` })
    expect(collection.state.get(3)).toEqual({ id: 3, name: `User 3` })

    // Remove tag2 from row 2 (shared tag) - row 2 should be deleted
    subscriber([
      {
        key: `2`,
        value: { id: 2, name: `User 2` },
        headers: {
          operation: `delete`,
          removed_tags: [tag2],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row 2 should be garbage collected, row 3 should remain
    // Row 3 still has tag3 and tag4
    expect(collection.state.size).toBe(1)
    expect(collection.state.has(1)).toBe(false)
    expect(collection.state.has(2)).toBe(false)
    expect(collection.state.get(3)).toEqual({ id: 3, name: `User 3` })
  })

  it(`should require exact match in removed_tags for tags with nil positions (empty segments)`, () => {
    const tagWithNil = `hash1//hash3`
    const tagWithoutNil = `hash1/hash2/hash3`

    // Insert row with wildcard tag
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: {
          operation: `insert`,
          tags: [tagWithNil],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.get(1)).toEqual({ id: 1, name: `User 1` })

    // Try to remove with non-matching tag (has specific value instead of nil)
    // Should NOT remove because it doesn't match exactly
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: {
          operation: `update`,
          removed_tags: [tagWithoutNil],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row should still exist because the tag didn't match exactly
    expect(collection.state.get(1)).toEqual({ id: 1, name: `User 1` })

    // Remove with exact match (nil-position tag)
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: {
          operation: `delete`,
          removed_tags: [tagWithNil],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row should be garbage collected because exact match was removed
    expect(collection.state.size).toBe(0)
    expect(collection.state.has(1)).toBe(false)

    // Insert row with specific value tag (no wildcard)
    subscriber([
      {
        key: `2`,
        value: { id: 2, name: `User 2` },
        headers: {
          operation: `insert`,
          tags: [tagWithoutNil],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.get(2)).toEqual({ id: 2, name: `User 2` })

    // Try to remove with nil-position tag - should NOT match
    subscriber([
      {
        key: `2`,
        value: { id: 2, name: `User 2` },
        headers: {
          operation: `update`,
          removed_tags: [tagWithNil],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row should still exist because nil-position tag doesn't match specific value tag
    expect(collection.state.get(2)).toEqual({ id: 2, name: `User 2` })

    // Remove with exact match (specific value tag)
    subscriber([
      {
        key: `2`,
        value: { id: 2, name: `User 2` },
        headers: {
          operation: `delete`,
          removed_tags: [tagWithoutNil],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row should be garbage collected
    expect(collection.state.size).toBe(0)
    expect(collection.state.has(2)).toBe(false)

    // Test with multiple tags including nil positions
    const tagNil1 = `hash1//hash3`
    const tagNil2 = `hash4//hash6`
    const tagSpecific = `hash1/hash2/hash3`

    subscriber([
      {
        key: `3`,
        value: { id: 3, name: `User 3` },
        headers: {
          operation: `insert`,
          tags: [tagNil1, tagNil2, tagSpecific],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.get(3)).toEqual({ id: 3, name: `User 3` })

    // Remove one nil-position tag with exact match
    subscriber([
      {
        key: `3`,
        value: { id: 3, name: `User 3` },
        headers: {
          operation: `update`,
          removed_tags: [tagNil1],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row should still exist (has tagNil2 and tagSpecific)
    expect(collection.state.get(3)).toEqual({ id: 3, name: `User 3` })

    // Try to remove nil-position tag with non-matching specific value
    subscriber([
      {
        key: `3`,
        value: { id: 3, name: `User 3` },
        headers: {
          operation: `update`,
          removed_tags: [tagWithoutNil],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row should still exist because tagWithoutNil doesn't match tagNil2 exactly
    expect(collection.state.get(3)).toEqual({ id: 3, name: `User 3` })

    // Remove specific tag with exact match
    subscriber([
      {
        key: `3`,
        value: { id: 3, name: `User 3` },
        headers: {
          operation: `update`,
          removed_tags: [tagSpecific],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row should still exist (has tagNil2)
    expect(collection.state.get(3)).toEqual({ id: 3, name: `User 3` })

    // Remove last nil-position tag with exact match
    subscriber([
      {
        key: `3`,
        value: { id: 3, name: `User 3` },
        headers: {
          operation: `delete`,
          removed_tags: [tagNil2],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row should be garbage collected
    expect(collection.state.size).toBe(0)
    expect(collection.state.has(3)).toBe(false)
  })

  it(`should handle move-out events that remove matching tags`, () => {
    const tag1 = `hash1/hash2/hash3`
    const tag2 = `hash1/hash2/hash4`
    const tag3 = `hash5/hash6/hash1`

    // Insert rows with tags
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: {
          operation: `insert`,
          tags: [tag1],
        },
      },
      {
        key: `2`,
        value: { id: 2, name: `User 2` },
        headers: {
          operation: `insert`,
          tags: [tag2],
        },
      },
      {
        key: `3`,
        value: { id: 3, name: `User 3` },
        headers: {
          operation: `insert`,
          tags: [tag3],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.size).toBe(3)

    // Send move-out event with pattern matching hash1 at position 0
    const pattern: MovePattern = {
      pos: 0,
      value: `hash1`,
    }

    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [pattern],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Rows 1 and 2 should be deleted (they have hash1 at position 0)
    // Row 3 should remain (has hash5 at position 0)
    expect(collection.state.size).toBe(1)
    expect(collection.state.has(3)).toBe(true)
    expect(collection.state.get(3)).toEqual({ id: 3, name: `User 3` })
  })

  it(`should remove shared tags from all rows when move-out pattern matches`, () => {
    // Create tags where some are shared between rows
    const sharedTag1 = `hash1/hash2/hash3` // Shared by rows 1 and 2
    const sharedTag2 = `hash4/hash5/hash6` // Shared by rows 2 and 3
    const uniqueTag1 = `hash7/hash8/hash9` // Only in row 1
    const uniqueTag2 = `hash10/hash11/hash12` // Only in row 3

    // Insert rows with multiple tags, some shared
    // Row 1: sharedTag1, uniqueTag1
    // Row 2: sharedTag1, sharedTag2
    // Row 3: sharedTag2, uniqueTag2
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: {
          operation: `insert`,
          tags: [sharedTag1, uniqueTag1],
        },
      },
      {
        key: `2`,
        value: { id: 2, name: `User 2` },
        headers: {
          operation: `insert`,
          tags: [sharedTag1, sharedTag2],
        },
      },
      {
        key: `3`,
        value: { id: 3, name: `User 3` },
        headers: {
          operation: `insert`,
          tags: [sharedTag2, uniqueTag2],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.size).toBe(3)
    expect(collection.state.get(1)).toEqual({ id: 1, name: `User 1` })
    expect(collection.state.get(2)).toEqual({ id: 2, name: `User 2` })
    expect(collection.state.get(3)).toEqual({ id: 3, name: `User 3` })

    // Send move-out event matching sharedTag1 (hash1 at position 0)
    // This should remove sharedTag1 from both row 1 and row 2
    const pattern: MovePattern = {
      pos: 0,
      value: `hash1`,
    }

    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [pattern],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row 1 should be deleted (only had sharedTag1 and uniqueTag1, sharedTag1 removed, but uniqueTag1 should remain... wait)
    // Actually, if sharedTag1 matches the pattern, it should be removed from row 1
    // Row 1 has [sharedTag1, uniqueTag1], so after removing sharedTag1, it still has uniqueTag1
    // Row 2 has [sharedTag1, sharedTag2], so after removing sharedTag1, it still has sharedTag2
    // So both rows should still exist
    expect(collection.state.size).toBe(3)
    expect(collection.state.get(1)).toEqual({ id: 1, name: `User 1` })
    expect(collection.state.get(2)).toEqual({ id: 2, name: `User 2` })
    expect(collection.state.get(3)).toEqual({ id: 3, name: `User 3` })

    // Send move-out event matching sharedTag2 (hash4 at position 0)
    // This should remove sharedTag2 from both row 2 and row 3
    const pattern2: MovePattern = {
      pos: 0,
      value: `hash4`,
    }

    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [pattern2],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row 2 should be deleted (had sharedTag1 and sharedTag2, both removed)
    // Row 3 should still exist (has uniqueTag2)
    // Row 1 should still exist (has uniqueTag1)
    expect(collection.state.size).toBe(2)
    expect(collection.state.has(2)).toBe(false)
    expect(collection.state.get(1)).toEqual({ id: 1, name: `User 1` })
    expect(collection.state.get(3)).toEqual({ id: 3, name: `User 3` })

    // Send move-out event matching uniqueTag1 (hash7 at position 0)
    // This should remove uniqueTag1 from row 1
    const pattern3: MovePattern = {
      pos: 0,
      value: `hash7`,
    }

    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [pattern3],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row 1 should be deleted (no tags left)
    // Row 3 should still exist (has uniqueTag2)
    expect(collection.state.size).toBe(1)
    expect(collection.state.has(1)).toBe(false)
    expect(collection.state.has(2)).toBe(false)
    expect(collection.state.get(3)).toEqual({ id: 3, name: `User 3` })
  })

  it(`should not remove tags with nil positions when pattern matches non-indexed position`, () => {
    // Tag with nil at position 1: a//c
    // This tag is NOT indexed at position 1 (because of nil/empty segment)
    const tagWithNilPos = `a//c`

    // Insert row with tag containing nil position
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: {
          operation: `insert`,
          tags: [tagWithNilPos],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.size).toBe(1)
    expect(collection.state.get(1)).toEqual({ id: 1, name: `User 1` })

    // Send move-out event with pattern matching position 1 (where nil is)
    // Since the tag is not indexed at position 1, it won't be found in the index
    // and the tag should remain
    const patternNonIndexed: MovePattern = {
      pos: 1,
      value: `b`,
    }

    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [patternNonIndexed],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row should still exist because the tag wasn't found in the index
    expect(collection.state.size).toBe(1)
    expect(collection.state.get(1)).toEqual({ id: 1, name: `User 1` })

    // Send move-out event with pattern matching position 2 (where 'c' is)
    // Position 2 is indexed (has value 'c'), so it will be found in the index
    // The pattern matching position 2 with value 'c' matches the tag a//c, so the tag is removed
    const patternIndexed: MovePattern = {
      pos: 2,
      value: `c`,
    }

    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [patternIndexed],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row should be garbage collected because the tag was removed
    // (tagset becomes empty)
    expect(collection.state.size).toBe(0)
    expect(collection.state.has(1)).toBe(false)
  })

  it(`should handle move-out events with multiple patterns`, () => {
    const tag1 = `hash1/hash2/hash3`
    const tag2 = `hash4/hash5/hash6`
    const tag3 = `hash7/hash8/hash9`

    // Insert rows with tags
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: {
          operation: `insert`,
          tags: [tag1],
        },
      },
      {
        key: `2`,
        value: { id: 2, name: `User 2` },
        headers: {
          operation: `insert`,
          tags: [tag2],
        },
      },
      {
        key: `3`,
        value: { id: 3, name: `User 3` },
        headers: {
          operation: `insert`,
          tags: [tag3],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.size).toBe(3)

    // Send move-out event with multiple patterns
    const pattern1: MovePattern = {
      pos: 0,
      value: `hash1`,
    }
    const pattern2: MovePattern = {
      pos: 0,
      value: `hash4`,
    }

    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [pattern1, pattern2],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Rows 1 and 2 should be deleted, row 3 should remain
    expect(collection.state.size).toBe(1)
    expect(collection.state.has(3)).toBe(true)
  })

  it(`should clear tag state on must-refetch`, () => {
    const tag1 = `hash1/hash2/hash3`
    const tag2 = `hash4/hash5/hash6`

    // Insert row with tag
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Test User` },
        headers: {
          operation: `insert`,
          tags: [tag1],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state).toEqual(
      new Map([[1, { id: 1, name: `Test User` }]]),
    )

    // Send must-refetch
    subscriber([
      {
        headers: { control: `must-refetch` },
      },
    ])

    // The collection should still have old data because truncate is in pending
    // transaction. This is the intended behavior of the collection, you should have
    // the old data until the next up-to-date message.
    expect(collection.state.size).toBe(1)
    expect(collection.state.has(1)).toBe(true)
    expect(collection.state.get(1)).toEqual({ id: 1, name: `Test User` })

    // Send new data after must-refetch
    subscriber([
      {
        key: `2`,
        value: { id: 2, name: `User 2` },
        headers: { operation: `insert` },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Collection should now have the new data
    expect(collection.state).toEqual(new Map([[2, { id: 2, name: `User 2` }]]))

    // Re-insert with new tag
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Test User` },
        headers: {
          operation: `insert`,
          tags: [tag2],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state).toEqual(
      new Map([
        [1, { id: 1, name: `Test User` }],
        [2, { id: 2, name: `User 2` }],
      ]),
    )

    // Remove tag2 and check that the row is gone
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Test User` },
        headers: {
          operation: `delete`,
          removed_tags: [tag2],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row should be garbage collected
    expect(collection.state.size).toBe(1)
    expect(collection.state.has(1)).toBe(false)
    expect(collection.state.has(2)).toBe(true)
    expect(collection.state.get(2)).toEqual({ id: 2, name: `User 2` })
  })

  it(`should handle rows with no tags (not deleted)`, () => {
    // Insert row without tags
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Test User` },
        headers: {
          operation: `insert`,
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row should exist even without tags
    expect(collection.state).toEqual(
      new Map([[1, { id: 1, name: `Test User` }]]),
    )

    // Update the row without tags
    subscriber([
      {
        key: `1`,
        old_value: { id: 1, name: `Test User` },
        value: { id: 1, name: `Updated Test User` },
        headers: {
          operation: `update`,
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row should still exist
    expect(collection.state).toEqual(
      new Map([[1, { id: 1, name: `Updated Test User` }]]),
    )

    // Insert a row with tags
    const tag = `hash1/hash2/hash3`
    subscriber([
      {
        key: `2`,
        value: { id: 2, name: `User 2` },
        headers: {
          operation: `insert`,
          tags: [tag],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row should exist
    expect(collection.state).toEqual(
      new Map([
        [1, { id: 1, name: `Updated Test User` }],
        [2, { id: 2, name: `User 2` }],
      ]),
    )

    // Move out that matches the tag
    const pattern: MovePattern = {
      pos: 1,
      value: `hash2`,
    }

    subscriber([
      {
        headers: { event: `move-out`, patterns: [pattern] },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // User 2 should be gine but user 1 should still exist because it was never tagged
    expect(collection.state.size).toBe(1)
    expect(collection.state.has(1)).toBe(true)
    expect(collection.state.has(2)).toBe(false)
    expect(collection.state.get(1)).toEqual({
      id: 1,
      name: `Updated Test User`,
    })
  })

  it(`should handle adding and removing tags in same update`, () => {
    const tag1 = `hash1/hash2/hash3`
    const tag2 = `hash4/hash5/hash6`

    // Insert row with tag1
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Test User` },
        headers: {
          operation: `insert`,
          tags: [tag1],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state).toEqual(
      new Map([[1, { id: 1, name: `Test User` }]]),
    )

    // Update: remove tag1, add tag2
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Updated User` },
        headers: {
          operation: `update`,
          tags: [tag2],
          removed_tags: [tag1],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row should still exist (has tag2)
    expect(collection.state).toEqual(
      new Map([[1, { id: 1, name: `Updated User` }]]),
    )
  })

  it(`should not recover old tags when row is deleted and re-inserted`, () => {
    const tag1 = `hash1/hash2/hash3`
    const tag2 = `hash4/hash5/hash6`

    // Insert row with tag1
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Test User` },
        headers: {
          operation: `insert`,
          tags: [tag1],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state).toEqual(
      new Map([[1, { id: 1, name: `Test User` }]]),
    )

    // Delete the row (without tags)
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Test User` },
        headers: {
          operation: `delete`,
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row should be deleted
    expect(collection.state.size).toBe(0)
    expect(collection.state.has(1)).toBe(false)

    // Insert the row again with a new tag (tag2)
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Re-inserted User` },
        headers: {
          operation: `insert`,
          tags: [tag2],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row should exist with new tag
    expect(collection.state).toEqual(
      new Map([[1, { id: 1, name: `Re-inserted User` }]]),
    )

    // Update the row with removed_tags including its new tag (tag2)
    // The row should NOT have the old tag1, only tag2
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `Re-inserted User` },
        headers: {
          operation: `delete`,
          removed_tags: [tag2],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row should be gone because tag2 was removed and it doesn't have old tag1
    expect(collection.state.size).toBe(0)
    expect(collection.state.has(1)).toBe(false)
  })

  it(`should store active_conditions from headers and keep row visible`, () => {
    // Insert row with tags and active_conditions
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: {
          operation: `insert`,
          tags: [`hash_a/hash_b`],
          active_conditions: [true, true],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.size).toBe(1)
    expect(collection.state.get(1)).toEqual({ id: 1, name: `User 1` })
  })

  it(`should keep row visible when only one disjunct is deactivated (DNF partial)`, () => {
    // Row with two disjuncts: ["hash_a/", "/hash_b"]
    // Disjunct 0 uses position 0, disjunct 1 uses position 1
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: {
          operation: `insert`,
          tags: [`hash_a/`, `/hash_b`],
          active_conditions: [true, true],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.size).toBe(1)

    // Move-out at position 0 — disjunct 0 fails, but disjunct 1 (position 1) still satisfied
    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 0, value: `hash_a` }],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row should stay (disjunct 1 still satisfied via position 1)
    expect(collection.state.size).toBe(1)
    expect(collection.state.get(1)).toEqual({ id: 1, name: `User 1` })
  })

  it(`should delete row when all disjuncts are deactivated (DNF full)`, () => {
    // Row with two disjuncts: ["hash_a/", "/hash_b"]
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: {
          operation: `insert`,
          tags: [`hash_a/`, `/hash_b`],
          active_conditions: [true, true],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.size).toBe(1)

    // Move-out at position 0 — disjunct 0 fails
    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 0, value: `hash_a` }],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row stays (disjunct 1 still satisfied)
    expect(collection.state.size).toBe(1)

    // Move-out at position 1 — disjunct 1 also fails
    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 1, value: `hash_b` }],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row deleted — no satisfied disjunct
    expect(collection.state.size).toBe(0)
    expect(collection.state.has(1)).toBe(false)
  })

  it(`should keep row alive when one disjunct lost but another keeps it visible (multi-disjunct)`, () => {
    // Row with tags ["hash_a/hash_b/", "//hash_c"]
    // active_conditions: [true, true, true]
    // Disjunct 0 covers positions [0, 1], disjunct 1 covers position [2]
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: {
          operation: `insert`,
          tags: [`hash_a/hash_b/`, `//hash_c`],
          active_conditions: [true, true, true],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.size).toBe(1)

    // Move-out at position 0 → disjunct 0 fails (needs [0,1]), but disjunct 1 (position 2) still satisfied
    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 0, value: `hash_a` }],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row stays (disjunct 1 still satisfied)
    expect(collection.state.size).toBe(1)
    expect(collection.state.get(1)).toEqual({ id: 1, name: `User 1` })

    // Move-out at position 2 → disjunct 1 also fails, no disjunct satisfied
    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 2, value: `hash_c` }],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row deleted — no satisfied disjunct
    expect(collection.state.size).toBe(0)
    expect(collection.state.has(1)).toBe(false)
  })

  it(`should overwrite active_conditions when server re-sends row (move-in overwrite)`, () => {
    // Insert row with active_conditions: [true, false]
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: {
          operation: `insert`,
          tags: [`hash_a/hash_b`],
          active_conditions: [true, false],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.size).toBe(1)

    // Server re-sends the same row with updated active_conditions
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1 updated` },
        headers: {
          operation: `update`,
          tags: [`hash_a/hash_b`],
          active_conditions: [true, true],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row should still exist with updated value
    expect(collection.state.size).toBe(1)
    expect(collection.state.get(1)).toEqual({ id: 1, name: `User 1 updated` })

    // Verify the overwritten active_conditions work correctly:
    // If the old [true, false] was still in effect, move-out at pos 1 would have no effect
    // since pos 1 was already false. With [true, true], move-out at pos 0 should keep row
    // (position 1 still true for the single disjunct [0, 1])... actually with one disjunct [0,1]
    // and active_conditions [false, true], the disjunct is NOT satisfied because pos 0 is false.
    // Let's verify: move-out at pos 0 should delete the row because the single disjunct [0,1]
    // requires both positions to be true.
    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 0, value: `hash_a` }],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row deleted because single disjunct [0,1] requires both pos 0 and 1 to be true
    expect(collection.state.size).toBe(0)
  })

  it(`should delete on empty tag set for simple shapes (no active_conditions)`, () => {
    const tag1 = `hash1/hash2/hash3`

    // Insert row with tags but NO active_conditions
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: {
          operation: `insert`,
          tags: [tag1],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.size).toBe(1)

    // Move-out at position 0 — no active_conditions: tag removed, tag set empty → delete
    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 0, value: `hash1` }],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.size).toBe(0)
    expect(collection.state.has(1)).toBe(false)
  })

  it(`should handle mixed rows: some with active_conditions, some without`, () => {
    // Row 1: DNF shape (with active_conditions)
    // Row 2: simple shape (no active_conditions)
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `DNF User` },
        headers: {
          operation: `insert`,
          tags: [`hash_a/`, `/hash_b`],
          active_conditions: [true, true],
        },
      },
      {
        key: `2`,
        value: { id: 2, name: `Simple User` },
        headers: {
          operation: `insert`,
          tags: [`hash_a/hash_c`],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.size).toBe(2)

    // Move-out at position 0 with value hash_a
    // DNF row: disjunct 0 ([0]) fails, but disjunct 1 ([1]) still satisfied → stays
    // Simple row: tag "hash_a/hash_c" matches (has hash_a at pos 0), removed, tag set empty → deleted
    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 0, value: `hash_a` }],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // DNF row stays, simple row deleted
    expect(collection.state.size).toBe(1)
    expect(collection.state.get(1)).toEqual({ id: 1, name: `DNF User` })
    expect(collection.state.has(2)).toBe(false)
  })

  it(`should activate correct positions on move-in`, () => {
    // Insert row with two disjuncts, position 1 inactive
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: {
          operation: `insert`,
          tags: [`hash_a/`, `/hash_b`],
          active_conditions: [true, false],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.size).toBe(1)

    // Move-in at position 1 — should re-activate it
    subscriber([
      {
        headers: {
          event: `move-in`,
          patterns: [{ pos: 1, value: `hash_b` }],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row should still be there (move-in is silent, no visible change)
    expect(collection.state.size).toBe(1)
    expect(collection.state.get(1)).toEqual({ id: 1, name: `User 1` })

    // Verify position 1 was actually re-activated:
    // Move-out at position 0 should NOT delete because disjunct 1 (pos 1) is now active
    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 0, value: `hash_a` }],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row stays because disjunct 1 is satisfied
    expect(collection.state.size).toBe(1)
    expect(collection.state.get(1)).toEqual({ id: 1, name: `User 1` })
  })

  it(`should support move-out then move-in then move-out cycle`, () => {
    // Row with two disjuncts: pos 0 and pos 1
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: {
          operation: `insert`,
          tags: [`hash_a/`, `/hash_b`],
          active_conditions: [true, true],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.size).toBe(1)

    // Move-out at pos 0 — row stays via disjunct 1
    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 0, value: `hash_a` }],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.size).toBe(1)

    // Move-in at pos 0 — re-activates disjunct 0
    subscriber([
      {
        headers: {
          event: `move-in`,
          patterns: [{ pos: 0, value: `hash_a` }],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.size).toBe(1)

    // Move-out at pos 1 — disjunct 1 fails, but disjunct 0 re-activated so row stays
    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 1, value: `hash_b` }],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row should still be alive because disjunct 0 was re-activated by move-in
    expect(collection.state.size).toBe(1)
    expect(collection.state.get(1)).toEqual({ id: 1, name: `User 1` })
  })

  it(`should not resurrect deleted rows on move-in (tag index cleaned up)`, () => {
    // Row with single disjunct [0, 1]
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: {
          operation: `insert`,
          tags: [`hash_a/hash_b`],
          active_conditions: [true, true],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.size).toBe(1)

    // Move-out at pos 0 — single disjunct [0,1] fails → row deleted
    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 0, value: `hash_a` }],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.size).toBe(0)

    // Move-in at pos 0 — should have no effect because the row was fully deleted
    // and its tag index entries were cleaned up
    subscriber([
      {
        headers: {
          event: `move-in`,
          patterns: [{ pos: 0, value: `hash_a` }],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row should NOT reappear
    expect(collection.state.size).toBe(0)
  })

  it(`should not cause phantom deletes from orphaned tag index entries`, () => {
    // Shape: two disjuncts [[0,1], [2,3]]
    // Row "r" has all 4 positions active with hash "X"
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: {
          operation: `insert`,
          tags: [`X/X//`, `//X/X`],
          active_conditions: [true, true, true, true],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.size).toBe(1)

    // Deactivate positions 1 and 3 — both disjuncts lose their second position → row invisible → deleted
    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [
            { pos: 1, value: `X` },
            { pos: 3, value: `X` },
          ],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.size).toBe(0)

    // Re-insert row with NEW hash "Y" at all positions
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1 v2` },
        headers: {
          operation: `insert`,
          tags: [`Y/Y//`, `//Y/Y`],
          active_conditions: [true, true, true, true],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.size).toBe(1)

    // Move-out with STALE hash "X" at pos 0 — should have NO effect
    // because the row's current hash at pos 0 is "Y", not "X"
    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 0, value: `X` }],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row should still exist with active_conditions unchanged
    expect(collection.state.size).toBe(1)
    expect(collection.state.get(1)).toEqual({ id: 1, name: `User 1 v2` })

    // Now a legitimate deactivation at position 2 with current hash "Y"
    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 2, value: `Y` }],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Disjunct 0 ([0,1]) is still fully active → row should remain visible
    expect(collection.state.size).toBe(1)
    expect(collection.state.get(1)).toEqual({ id: 1, name: `User 1 v2` })
  })

  it(`should clean up ALL tag index entries when row is deleted by move-out`, () => {
    // Row with single disjunct using positions 0 and 1
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: {
          operation: `insert`,
          tags: [`hash_a/hash_b`],
          active_conditions: [true, true],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.size).toBe(1)

    // Move-out at pos 0 — single disjunct [0,1] fails → row deleted
    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 0, value: `hash_a` }],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.size).toBe(0)

    // Insert a NEW row with hash_b at position 1 (same value the deleted row had)
    subscriber([
      {
        key: `2`,
        value: { id: 2, name: `User 2` },
        headers: {
          operation: `insert`,
          tags: [`hash_c/hash_b`],
          active_conditions: [true, true],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.size).toBe(1)

    // Move-out at pos 1 with "hash_b" should only affect the new row (key 2),
    // not ghost-reference the deleted row (key 1)
    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [{ pos: 1, value: `hash_b` }],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Only row 2 should be affected (deleted because single disjunct [0,1] fails)
    expect(collection.state.size).toBe(0)
  })

  it(`should handle multiple patterns deactivating the same row in one call`, () => {
    // Row with single disjunct needing both pos 0 and pos 1
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: {
          operation: `insert`,
          tags: [`hash_a/hash_b`],
          active_conditions: [true, true],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.size).toBe(1)

    // Both positions deactivated in one move-out call
    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [
            { pos: 0, value: `hash_a` },
            { pos: 1, value: `hash_b` },
          ],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.size).toBe(0)
    expect(collection.state.has(1)).toBe(false)
  })
})

describe(`Tag index utilities`, () => {
  it(`parseTag should normalize slash-delimited tags correctly`, () => {
    // Basic tag
    expect(parseTag(`hash_a`)).toEqual([`hash_a`])

    // Multi-position tag
    expect(parseTag(`hash1/hash2/hash3`)).toEqual([`hash1`, `hash2`, `hash3`])

    // Tags with non-participating positions (empty segments)
    expect(parseTag(`hash_a/`)).toEqual([`hash_a`, NON_PARTICIPATING])
    expect(parseTag(`/hash_b`)).toEqual([NON_PARTICIPATING, `hash_b`])
    expect(parseTag(`hash_a//hash_c`)).toEqual([
      `hash_a`,
      NON_PARTICIPATING,
      `hash_c`,
    ])
    expect(parseTag(`//hash_c`)).toEqual([
      NON_PARTICIPATING,
      NON_PARTICIPATING,
      `hash_c`,
    ])
  })

  it(`rowVisible should evaluate DNF correctly`, () => {
    // Disjunct 0 needs positions [0, 1], disjunct 1 needs position [2]
    const disjunctPositions = [[0, 1], [2]]

    // All active
    expect(rowVisible([true, true, true], disjunctPositions)).toBe(true)

    // Only disjunct 0 satisfied
    expect(rowVisible([true, true, false], disjunctPositions)).toBe(true)

    // Only disjunct 1 satisfied
    expect(rowVisible([false, false, true], disjunctPositions)).toBe(true)

    // No disjunct satisfied (pos 0 false breaks disjunct 0, pos 2 false breaks disjunct 1)
    expect(rowVisible([false, true, false], disjunctPositions)).toBe(false)

    // All false
    expect(rowVisible([false, false, false], disjunctPositions)).toBe(false)
  })

  it(`deriveDisjunctPositions should extract participating positions per disjunct`, () => {
    // Two disjuncts: first uses pos 0, second uses pos 1
    const tags = [`hash_a/`, `/hash_b`].map(parseTag)
    expect(deriveDisjunctPositions(tags)).toEqual([[0], [1]])

    // Single disjunct using both positions
    const tags2 = [`hash_a/hash_b`].map(parseTag)
    expect(deriveDisjunctPositions(tags2)).toEqual([[0, 1]])

    // Three positions, two disjuncts
    const tags3 = [`hash_a/hash_b/`, `//hash_c`].map(parseTag)
    expect(deriveDisjunctPositions(tags3)).toEqual([[0, 1], [2]])
  })
})
