/**
 * Property-based tests for live query contracts.
 *
 * These tests use fast-check to generate random sequences of operations
 * and verify that invariants hold across all possible inputs. Based on
 * Cheng Huang's approach of using property-based tests to explore edge cases.
 *
 * Key properties tested:
 * 1. D2 never contains duplicate keys (multiplicity invariant)
 * 2. Live query state matches expected state after any change sequence
 * 3. Delete followed by insert always succeeds (tracking cleared correctly)
 * 4. Batch operations maintain consistency
 */

import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { mockSyncCollectionOptions } from '../utils.js'

// Types for property-based testing
type Item = {
  id: number
  name: string
  category: string
}

type Operation =
  | { type: `insert`; id: number; name: string; category: string }
  | { type: `update`; id: number; name: string; category: string }
  | { type: `delete`; id: number }

// Arbitraries for generating random test data
const itemIdArb = fc.integer({ min: 1, max: 20 })
const nameArb = fc.string({ minLength: 1, maxLength: 10 })
const categoryArb = fc.constantFrom(`A`, `B`, `C`)

const insertOpArb: fc.Arbitrary<Operation> = fc.record({
  type: fc.constant(`insert` as const),
  id: itemIdArb,
  name: nameArb,
  category: categoryArb,
})

const updateOpArb: fc.Arbitrary<Operation> = fc.record({
  type: fc.constant(`update` as const),
  id: itemIdArb,
  name: nameArb,
  category: categoryArb,
})

const deleteOpArb: fc.Arbitrary<Operation> = fc.record({
  type: fc.constant(`delete` as const),
  id: itemIdArb,
})

const operationArb: fc.Arbitrary<Operation> = fc.oneof(
  insertOpArb,
  updateOpArb,
  deleteOpArb,
)

// Helper to create a fresh collection for each test
let collectionCounter = 0
function createTestCollection() {
  return createCollection(
    mockSyncCollectionOptions<Item>({
      id: `property-test-${collectionCounter++}`,
      getKey: (item) => item.id,
      initialData: [],
    }),
  )
}

/**
 * Simulates expected state after a sequence of operations.
 * Returns what keys should exist and their values.
 */
function simulateOperations(
  operations: Array<Operation>,
): Map<number, { name: string; category: string }> {
  const state = new Map<number, { name: string; category: string }>()

  for (const op of operations) {
    if (op.type === `insert`) {
      // Insert only succeeds if key doesn't exist
      if (!state.has(op.id)) {
        state.set(op.id, { name: op.name, category: op.category })
      }
    } else if (op.type === `update`) {
      // Update only succeeds if key exists
      if (state.has(op.id)) {
        state.set(op.id, { name: op.name, category: op.category })
      }
    } else {
      // Delete only succeeds if key exists
      state.delete(op.id)
    }
  }

  return state
}

/**
 * Applies operations to a real collection, tracking state.
 */
function applyOperationsToCollection(
  source: ReturnType<typeof createTestCollection>,
  operations: Array<Operation>,
): Set<number> {
  const existingIds = new Set<number>()

  for (const op of operations) {
    source.utils.begin()

    if (op.type === `insert`) {
      if (!existingIds.has(op.id)) {
        source.utils.write({
          type: `insert`,
          value: { id: op.id, name: op.name, category: op.category },
        })
        existingIds.add(op.id)
      }
    } else if (op.type === `update`) {
      if (existingIds.has(op.id)) {
        source.utils.write({
          type: `update`,
          value: { id: op.id, name: op.name, category: op.category },
        })
      }
    } else {
      // op.type === `delete`
      if (existingIds.has(op.id)) {
        source.utils.write({
          type: `delete`,
          value: { id: op.id, name: ``, category: `` },
        })
        existingIds.delete(op.id)
      }
    }

    source.utils.commit()
  }

  return existingIds
}

describe(`Live Query Property-Based Tests`, () => {
  describe(`D2 Multiplicity Invariant`, () => {
    it(`live query never contains duplicate keys after any operation sequence`, async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(operationArb, { minLength: 1, maxLength: 50 }),
          async (operations) => {
            const source = createTestCollection()
            const liveQuery = createLiveQueryCollection((q) =>
              q.from({ item: source }),
            )

            await liveQuery.preload()

            applyOperationsToCollection(source, operations)

            // Verify no duplicate keys (each key appears exactly once)
            const items = liveQuery.toArray
            const keys = items.map((item) => item.id)
            const uniqueKeys = new Set(keys)

            expect(keys.length).toBe(uniqueKeys.size)
          },
        ),
        { numRuns: 100 },
      )
    })

    it(`live query size matches expected state`, async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(operationArb, { minLength: 0, maxLength: 30 }),
          async (operations) => {
            const source = createTestCollection()
            const liveQuery = createLiveQueryCollection((q) =>
              q.from({ item: source }),
            )

            await liveQuery.preload()

            const expectedState = simulateOperations(operations)
            applyOperationsToCollection(source, operations)

            expect(liveQuery.size).toBe(expectedState.size)
          },
        ),
        { numRuns: 100 },
      )
    })
  })

  describe(`State Consistency`, () => {
    it(`live query contains exactly the expected items after any sequence`, async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(operationArb, { minLength: 0, maxLength: 30 }),
          async (operations) => {
            const source = createTestCollection()
            const liveQuery = createLiveQueryCollection((q) =>
              q.from({ item: source }),
            )

            await liveQuery.preload()

            const expectedState = simulateOperations(operations)
            applyOperationsToCollection(source, operations)

            // Check size matches
            expect(liveQuery.size).toBe(expectedState.size)

            // Check each expected item is present with correct values
            for (const [id, expected] of expectedState) {
              const actual = liveQuery.get(id)
              expect(actual).toBeDefined()
              expect(actual?.name).toBe(expected.name)
              expect(actual?.category).toBe(expected.category)
            }

            // Check no unexpected items
            for (const item of liveQuery.toArray) {
              expect(expectedState.has(item.id)).toBe(true)
            }
          },
        ),
        { numRuns: 100 },
      )
    })
  })

  describe(`Delete-Insert Cycles`, () => {
    it(`can always re-insert after delete for any key`, async () => {
      await fc.assert(
        fc.asyncProperty(
          itemIdArb,
          fc.integer({ min: 1, max: 10 }),
          async (id, cycles) => {
            const source = createTestCollection()
            const liveQuery = createLiveQueryCollection((q) =>
              q.from({ item: source }),
            )

            await liveQuery.preload()

            for (let i = 0; i < cycles; i++) {
              // Insert
              source.utils.begin()
              source.utils.write({
                type: `insert`,
                value: { id, name: `Cycle ${i}`, category: `A` },
              })
              source.utils.commit()

              expect(liveQuery.get(id)).toBeDefined()
              expect(liveQuery.get(id)?.name).toBe(`Cycle ${i}`)

              // Delete
              source.utils.begin()
              source.utils.write({
                type: `delete`,
                value: { id, name: ``, category: `` },
              })
              source.utils.commit()

              expect(liveQuery.get(id)).toBeUndefined()
            }

            expect(liveQuery.size).toBe(0)
          },
        ),
        { numRuns: 50 },
      )
    })
  })

  describe(`Filtered Query Properties`, () => {
    it(`filtered query only contains items matching the filter`, async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(operationArb, { minLength: 1, maxLength: 20 }),
          categoryArb,
          async (operations, filterCategory) => {
            const source = createTestCollection()
            const liveQuery = createLiveQueryCollection((q) =>
              q
                .from({ item: source })
                .where(({ item }) => eq(item.category, filterCategory)),
            )

            await liveQuery.preload()

            const expectedState = simulateOperations(operations)
            applyOperationsToCollection(source, operations)

            // All items in live query must match filter
            for (const item of liveQuery.toArray) {
              expect(item.category).toBe(filterCategory)
            }

            // Count matching items from expected state
            let expectedMatchCount = 0
            for (const [, value] of expectedState) {
              if (value.category === filterCategory) {
                expectedMatchCount++
              }
            }

            expect(liveQuery.size).toBe(expectedMatchCount)
          },
        ),
        { numRuns: 100 },
      )
    })

    it(`item moves in/out of filter correctly on update`, async () => {
      await fc.assert(
        fc.asyncProperty(
          itemIdArb,
          fc.array(categoryArb, { minLength: 2, maxLength: 10 }),
          async (id, categorySequence) => {
            const source = createTestCollection()
            const filterCategory = `A`
            const liveQuery = createLiveQueryCollection((q) =>
              q
                .from({ item: source })
                .where(({ item }) => eq(item.category, filterCategory)),
            )

            await liveQuery.preload()

            // Initial insert
            source.utils.begin()
            source.utils.write({
              type: `insert`,
              value: { id, name: `Test`, category: categorySequence[0]! },
            })
            source.utils.commit()

            // Update through category sequence
            for (let i = 1; i < categorySequence.length; i++) {
              const newCategory = categorySequence[i]!

              source.utils.begin()
              source.utils.write({
                type: `update`,
                value: { id, name: `Test`, category: newCategory },
              })
              source.utils.commit()

              if (newCategory === filterCategory) {
                expect(liveQuery.get(id)).toBeDefined()
              } else {
                expect(liveQuery.get(id)).toBeUndefined()
              }
            }
          },
        ),
        { numRuns: 50 },
      )
    })
  })

  describe(`Batch Operation Properties`, () => {
    it(`batch insert maintains no-duplicate invariant`, async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(insertOpArb, { minLength: 1, maxLength: 20 }),
          async (inserts) => {
            const source = createTestCollection()
            const liveQuery = createLiveQueryCollection((q) =>
              q.from({ item: source }),
            )

            await liveQuery.preload()

            // Batch insert, tracking which IDs we've added
            const insertedIds = new Set<number>()

            source.utils.begin()
            for (const op of inserts) {
              if (!insertedIds.has(op.id)) {
                source.utils.write({
                  type: `insert`,
                  value: { id: op.id, name: op.name, category: op.category },
                })
                insertedIds.add(op.id)
              }
            }
            source.utils.commit()

            // Verify no duplicates
            const keys = liveQuery.toArray.map((item) => item.id)
            const uniqueKeys = new Set(keys)

            expect(keys.length).toBe(uniqueKeys.size)
            expect(liveQuery.size).toBe(insertedIds.size)
          },
        ),
        { numRuns: 100 },
      )
    })

    it(`sequential and batch produce same result`, async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(operationArb, { minLength: 1, maxLength: 20 }),
          async (operations) => {
            // Run sequential
            const source1 = createTestCollection()
            const liveQuery1 = createLiveQueryCollection((q) =>
              q.from({ item: source1 }),
            )
            await liveQuery1.preload()
            applyOperationsToCollection(source1, operations)

            // Run batched (all ops in one transaction)
            const source2 = createTestCollection()
            const liveQuery2 = createLiveQueryCollection((q) =>
              q.from({ item: source2 }),
            )
            await liveQuery2.preload()

            const existingIds = new Set<number>()
            source2.utils.begin()
            for (const op of operations) {
              if (op.type === `insert` && !existingIds.has(op.id)) {
                source2.utils.write({
                  type: `insert`,
                  value: { id: op.id, name: op.name, category: op.category },
                })
                existingIds.add(op.id)
              } else if (op.type === `update` && existingIds.has(op.id)) {
                source2.utils.write({
                  type: `update`,
                  value: { id: op.id, name: op.name, category: op.category },
                })
              } else if (op.type === `delete` && existingIds.has(op.id)) {
                source2.utils.write({
                  type: `delete`,
                  value: { id: op.id, name: ``, category: `` },
                })
                existingIds.delete(op.id)
              }
            }
            source2.utils.commit()

            // Both should have same size
            expect(liveQuery1.size).toBe(liveQuery2.size)

            // Both should have same items
            for (const item of liveQuery1.toArray) {
              const item2 = liveQuery2.get(item.id)
              expect(item2).toBeDefined()
              expect(item2?.name).toBe(item.name)
              expect(item2?.category).toBe(item.category)
            }
          },
        ),
        { numRuns: 100 },
      )
    })
  })

  describe(`Stress Tests`, () => {
    it(`handles large operation sequences without invariant violations`, async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(operationArb, { minLength: 100, maxLength: 200 }),
          async (operations) => {
            const source = createTestCollection()
            const liveQuery = createLiveQueryCollection((q) =>
              q.from({ item: source }),
            )

            await liveQuery.preload()

            const expectedState = simulateOperations(operations)
            applyOperationsToCollection(source, operations)

            // Core invariants hold
            expect(liveQuery.size).toBe(expectedState.size)

            const keys = liveQuery.toArray.map((item) => item.id)
            const uniqueKeys = new Set(keys)
            expect(keys.length).toBe(uniqueKeys.size)

            // All expected items present
            for (const [id] of expectedState) {
              expect(liveQuery.get(id)).toBeDefined()
            }
          },
        ),
        { numRuns: 20 },
      )
    })
  })
})
