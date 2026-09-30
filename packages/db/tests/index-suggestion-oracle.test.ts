/**
 * A collection-size suggestion should reach the developer who must add an
 * index: a large manually indexed Collection with a queried, unindexed field.
 * Eager indexing already creates that index, and a matching manual index needs
 * no suggestion. `IndexDevModeConfig` documents the size threshold; this model
 * compares query metadata with mode, field-index presence, and Collection size.
 *
 * Grammar: manual/default and eager modes; 1,000 and 1,101 source rows; no
 * index, a matching index, or an unrelated index, with advice enabled or
 * disabled. The production driver builds a
 * public live-query Collection and checks suggestions and indexes after its
 * initial query is ready. This bounded oracle does not judge slow-query timing,
 * repeated query warnings, index benefit, or production-build suppression.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { BasicIndex } from '../src/indexes/basic-index.js'
import {
  
  configureIndexDevMode,
  getIndexDevModeConfig
} from '../src/indexes/index-registry.js'
import { eq } from '../src/query/builder/functions.js'
import { createLiveQueryCollection } from '../src/query/live-query-collection.js'
import { mockSyncCollectionOptions } from './utils.js'
import type {IndexSuggestion} from '../src/indexes/index-registry.js';

type Row = { id: number; url: string }
const originalConfig = getIndexDevModeConfig()

afterEach(() => configureIndexDevMode(originalConfig))

// A size suggestion is useful only when the queried field lacks an index and
// the Collection will not create one automatically.
function expectedSuggestions(
  mode: `off` | `eager` | undefined,
  size: number,
  index: `none` | `url` | `id`,
  enabled: boolean,
): number {
  return enabled && size > 1000 && mode !== `eager` && index !== `url` ? 1 : 0
}

describe(`collection-size index suggestions`, () => {
  for (const scenario of [
    { mode: `off`, size: 1101, index: `none`, enabled: true },
    { mode: undefined, size: 1101, index: `none`, enabled: true },
    { mode: `off`, size: 1000, index: `none`, enabled: true },
    { mode: `off`, size: 1101, index: `url`, enabled: true },
    { mode: `off`, size: 1101, index: `id`, enabled: true },
    { mode: `eager`, size: 1101, index: `none`, enabled: true },
    { mode: `off`, size: 1101, index: `none`, enabled: false },
  ] as const) {
    test(`${scenario.mode}, ${scenario.size} rows, index=${scenario.index}, advice=${scenario.enabled}`, async () => {
      const suggestions: Array<IndexSuggestion> = []
      configureIndexDevMode({
        enabled: scenario.enabled,
        collectionSizeThreshold: 1000,
        slowQueryThresholdMs: Number.MAX_VALUE,
        onSuggestion: (suggestion) => suggestions.push(suggestion),
      })

      const rows = Array.from(
        { length: scenario.size },
        (_, id): Row => ({
          id,
          url: `url-${id}`,
        }),
      )
      const source = createCollection(
        mockSyncCollectionOptions<Row>({
          id: `suggestion-${scenario.mode}-${scenario.size}-${scenario.index}`,
          getKey: (row) => row.id,
          initialData: rows,
          autoIndex: scenario.mode,
          defaultIndexType: BasicIndex,
        }),
      )
      await source.stateWhenReady()
      if (scenario.index === `url`) source.createIndex((row) => row.url)
      if (scenario.index === `id`) source.createIndex((row) => row.id)

      const query = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q.from({ row: source }).where(({ row }) => eq(row.url, `url-7`)),
      })

      let primaryFailure: { error: unknown } | undefined
      try {
        await query.stateWhenReady()
        expect(query.toArray.map((row) => row.id)).toEqual([7])
        const sizeSuggestions = suggestions.filter(
          (suggestion) => suggestion.type === `collection-size`,
        )
        const expected = expectedSuggestions(
          scenario.mode,
          scenario.size,
          scenario.index,
          scenario.enabled,
        )
        expect(sizeSuggestions).toHaveLength(expected)
        if (expected) {
          expect(sizeSuggestions[0]).toMatchObject({
            collectionId: source.id,
            fieldPath: [`url`],
            collectionSize: scenario.size,
          })
        }
        expect(source.indexes.size).toBe(
          scenario.mode === `eager` || scenario.index !== `none` ? 1 : 0,
        )
      } catch (error) {
        primaryFailure = { error }
      }

      const cleanupFailures: Array<unknown> = []
      try {
        await query.cleanup()
      } catch (error) {
        cleanupFailures.push(error)
      }
      try {
        await source.cleanup()
      } catch (error) {
        cleanupFailures.push(error)
      }
      if (primaryFailure && cleanupFailures.length > 0) {
        throw new AggregateError(
          [primaryFailure.error, ...cleanupFailures],
          `Index suggestion check and cleanup failed`,
          { cause: primaryFailure.error },
        )
      }
      if (primaryFailure) throw primaryFailure.error
      if (cleanupFailures.length > 0) {
        throw new AggregateError(
          cleanupFailures,
          `Index suggestion cleanup failed`,
        )
      }
    })
  }
})
