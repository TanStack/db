/**
 * A Collection mirrors the complete keyed rows of its latest valid Convex
 * query result, as promised by convexCollectionOptions. An omitted key is a
 * deletion, and an omitted field is absent, rather than retained from an older
 * row. Duplicate keys reject the whole result and leave the last valid result.
 *
 * The reference is simply the last valid input array. It never computes sync
 * operations or uses the adapter's key map. Generated histories contain empty,
 * reordered, changed, removed, reintroduced, and duplicate-key snapshots.
 * The driver invokes the real Collection through a controlled Convex callback.
 * After each synchronous delivery, public rows and the error flag are compared.
 * This owner covers snapshot refinement only. SDK transport, mutation timing,
 * errors, and cleanup have separate focused receiving tests in this package.
 */
import { isDeepStrictEqual } from 'node:util'
import { createCollection } from '@tanstack/db'
import { fc } from '@fast-check/vitest'
import { expect, it } from 'vitest'
import { convexCollectionOptions } from '../src/index'
import { controlledClient, query } from './helpers'
import type { Row } from './helpers'

const row = fc
  .record({
    _id: fc.constantFrom(`a`, `b`, `c`),
    text: fc.string({ maxLength: 12 }),
    optional: fc.option(fc.string({ maxLength: 6 }), { nil: undefined }),
  })
  .map((value): Row =>
    value.optional === undefined ? { _id: value._id, text: value.text } : value,
  )

it(`refines complete snapshots throughout generated histories`, async () => {
  const property = fc.asyncProperty(
    fc.array(fc.array(row, { maxLength: 5 }), {
      minLength: 1,
      maxLength: 30,
    }),
    async (history) => {
      const transport = controlledClient()
      const collection = createCollection(
        convexCollectionOptions({
          client: transport.client,
          query,
          queryArgs: { owner: `alice` },
          getKey: (value) => value._id,
          gcTime: 0,
        }),
      )
      collection.startSyncImmediate()
      let expected: Array<Row> = []
      try {
        for (const snapshot of history) {
          // Independent validity judgment: compare every pair of input keys.
          const valid = snapshot.every((value, index) =>
            snapshot.slice(index + 1).every((other) => other._id !== value._id),
          )
          if (valid) expected = snapshot
          transport.emit(snapshot)
          expect(collection.utils.getSyncError() !== undefined).toBe(!valid)
          const actual = [...collection.values()]
            .map((value): Row => {
              const result: Row = { _id: value._id, text: value.text }
              if (Object.hasOwn(value, `optional`))
                result.optional = value.optional
              return result
            })
            .sort((a, b) => a._id.localeCompare(b._id))
          const wanted = [...expected].sort((a, b) =>
            a._id.localeCompare(b._id),
          )
          expect(isDeepStrictEqual(actual, wanted)).toBe(true)
        }
      } finally {
        await collection.cleanup()
      }
    },
  )
  const seed = process.env.CONVEX_SNAPSHOT_ORACLE_SEED
  if (seed)
    await fc.assert(property, {
      seed: Number(seed),
      path: process.env.CONVEX_SNAPSHOT_ORACLE_PATH,
      numRuns: 150,
    })
  else {
    await fc.assert(property, { numRuns: 150, seed: 20261022 })
    await fc.assert(property, { numRuns: 150 })
  }
})
