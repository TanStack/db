import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '@tanstack/db'
import { electricCollectionOptions } from '../src/electric'
import type { ElectricCollectionUtils } from '../src/electric'
import type { Collection } from '@tanstack/db'
import type { Message, Row } from '@electric-sql/client'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { MoveOutPattern, MoveTag } from '../src/tagIndex'

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
  })

  it(`should track tags when rows are inserted with tags`, () => {
    const tag1: MoveTag = [`hash1`, `hash2`, `hash3`]
    const tag2: MoveTag = [`hash4`, `hash5`, `hash6`]

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
          operation: `update`,
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
    const tag1: MoveTag = [`hash1`, `hash2`, `hash3`]

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
    const tag2: MoveTag = [`hash4`, `hash5`, `hash6`]
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
          operation: `update`,
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
    const tag1: MoveTag = [`hash1`, `hash2`, `hash3`]
    const tag1Copy: MoveTag = [`hash1`, `hash2`, `hash3`]

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
          operation: `update`,
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
    const tag1: MoveTag = [`hash1`, `hash2`, `hash3`]
    const tag2: MoveTag = [`hash4`, `hash5`, `hash6`]
    const tag3: MoveTag = [`hash7`, `hash8`, `hash9`]
    const tag4: MoveTag = [`hash10`, `hash11`, `hash12`]

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
          operation: `update`,
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
          operation: `update`,
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

  it(`should require exact match in removed_tags for tags with wildcards (underscore)`, () => {
    const tagWithWildcard: MoveTag = [`hash1`, `_`, `hash3`]
    const tagWithoutWildcard: MoveTag = [`hash1`, `hash2`, `hash3`]

    // Insert row with wildcard tag
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: {
          operation: `insert`,
          tags: [tagWithWildcard],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.get(1)).toEqual({ id: 1, name: `User 1` })

    // Try to remove with non-matching tag (has specific value instead of wildcard)
    // Should NOT remove because it doesn't match exactly
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: {
          operation: `update`,
          removed_tags: [tagWithoutWildcard],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row should still exist because the tag didn't match exactly
    expect(collection.state.get(1)).toEqual({ id: 1, name: `User 1` })

    // Remove with exact match (wildcard tag)
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: {
          operation: `update`,
          removed_tags: [tagWithWildcard],
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
          tags: [tagWithoutWildcard],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.get(2)).toEqual({ id: 2, name: `User 2` })

    // Try to remove with wildcard tag - should NOT match
    subscriber([
      {
        key: `2`,
        value: { id: 2, name: `User 2` },
        headers: {
          operation: `update`,
          removed_tags: [tagWithWildcard],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row should still exist because wildcard doesn't match specific value
    expect(collection.state.get(2)).toEqual({ id: 2, name: `User 2` })

    // Remove with exact match (specific value tag)
    subscriber([
      {
        key: `2`,
        value: { id: 2, name: `User 2` },
        headers: {
          operation: `update`,
          removed_tags: [tagWithoutWildcard],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row should be garbage collected
    expect(collection.state.size).toBe(0)
    expect(collection.state.has(2)).toBe(false)

    // Test with multiple tags including wildcards
    const tagWildcard1: MoveTag = [`hash1`, `_`, `hash3`]
    const tagWildcard2: MoveTag = [`hash4`, `_`, `hash6`]
    const tagSpecific: MoveTag = [`hash1`, `hash2`, `hash3`]

    subscriber([
      {
        key: `3`,
        value: { id: 3, name: `User 3` },
        headers: {
          operation: `insert`,
          tags: [tagWildcard1, tagWildcard2, tagSpecific],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.get(3)).toEqual({ id: 3, name: `User 3` })

    // Remove one wildcard tag with exact match
    subscriber([
      {
        key: `3`,
        value: { id: 3, name: `User 3` },
        headers: {
          operation: `update`,
          removed_tags: [tagWildcard1],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row should still exist (has tagWildcard2 and tagSpecific)
    expect(collection.state.get(3)).toEqual({ id: 3, name: `User 3` })

    // Try to remove wildcard tag with non-matching specific value
    subscriber([
      {
        key: `3`,
        value: { id: 3, name: `User 3` },
        headers: {
          operation: `update`,
          removed_tags: [tagWithoutWildcard],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Row should still exist because tagWithoutWildcard doesn't match tagWildcard2
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

    // Row should still exist (has tagWildcard2)
    expect(collection.state.get(3)).toEqual({ id: 3, name: `User 3` })

    // Remove last wildcard tag with exact match
    subscriber([
      {
        key: `3`,
        value: { id: 3, name: `User 3` },
        headers: {
          operation: `update`,
          removed_tags: [tagWildcard2],
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
    const tag1: MoveTag = [`hash1`, `hash2`, `hash3`]
    const tag2: MoveTag = [`hash1`, `hash2`, `hash4`]
    const tag3: MoveTag = [`hash5`, `hash6`, `hash1`]

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
    const pattern: MoveOutPattern = {
      position: 0,
      value: `hash1`,
    }

    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [pattern],
        } as any, // TODO: remove this when pushing to CI
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
    const sharedTag1: MoveTag = [`hash1`, `hash2`, `hash3`] // Shared by rows 1 and 2
    const sharedTag2: MoveTag = [`hash4`, `hash5`, `hash6`] // Shared by rows 2 and 3
    const uniqueTag1: MoveTag = [`hash7`, `hash8`, `hash9`] // Only in row 1
    const uniqueTag2: MoveTag = [`hash10`, `hash11`, `hash12`] // Only in row 3

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
    const pattern: MoveOutPattern = {
      position: 0,
      value: `hash1`,
    }

    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [pattern],
        } as any, // TODO: remove this when pushing to CI
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
    const pattern2: MoveOutPattern = {
      position: 0,
      value: `hash4`,
    }

    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [pattern2],
        } as any, // TODO: remove this when pushing to CI
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
    const pattern3: MoveOutPattern = {
      position: 0,
      value: `hash7`,
    }

    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [pattern3],
        } as any, // TODO: remove this when pushing to CI
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

  it(`should not remove tags with underscores when pattern matches non-indexed position`, () => {
    // Tag with underscore at position 1: [a, _, c]
    // This tag is NOT indexed at position 1 (because of underscore)
    const tagWithUnderscore: MoveTag = [`a`, `_`, `c`]

    // Insert row with tag containing underscore
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: {
          operation: `insert`,
          tags: [tagWithUnderscore],
        },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(collection.state.size).toBe(1)
    expect(collection.state.get(1)).toEqual({ id: 1, name: `User 1` })

    // Send move-out event with pattern matching position 1 (where underscore is)
    // Since the tag is not indexed at position 1, it won't be found in the index
    // and the tag should remain
    const patternNonIndexed: MoveOutPattern = {
      position: 1,
      value: `b`,
    }

    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [patternNonIndexed],
        } as any, // TODO: remove this when pushing to CI
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
    // The pattern [*, *, c] matches the tag [a, _, c], so the tag is removed
    const patternIndexed: MoveOutPattern = {
      position: 2,
      value: `c`,
    }

    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [patternIndexed],
        } as any, // TODO: remove this when pushing to CI
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
    const tag1: MoveTag = [`hash1`, `hash2`, `hash3`]
    const tag2: MoveTag = [`hash4`, `hash5`, `hash6`]
    const tag3: MoveTag = [`hash7`, `hash8`, `hash9`]

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
    const pattern1: MoveOutPattern = {
      position: 0,
      value: `hash1`,
    }
    const pattern2: MoveOutPattern = {
      position: 0,
      value: `hash4`,
    }

    subscriber([
      {
        headers: {
          event: `move-out`,
          patterns: [pattern1, pattern2],
        } as any, // TODO: remove this when pushing to CI
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
    const tag1: MoveTag = [`hash1`, `hash2`, `hash3`]
    const tag2: MoveTag = [`hash4`, `hash5`, `hash6`]

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
        } as any, // TODO: remove this when pushing to CI
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
          operation: `update`,
          removed_tags: [tag2],
        } as any, // TODO: remove this when pushing to CI
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
    const tag: MoveTag = [`hash1`, `hash2`, `hash3`]
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
    const pattern: MoveOutPattern = {
      position: 1,
      value: `hash2`,
    }

    subscriber([
      {
        headers: { event: `move-out`, patterns: [pattern] } as any, // TODO: remove this when pushing to CI
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
    const tag1: MoveTag = [`hash1`, `hash2`, `hash3`]
    const tag2: MoveTag = [`hash4`, `hash5`, `hash6`]

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
})
