/**
 * A collection-size suggestion should reach the developer who must add an
 * index: a large manually indexed Collection with a queried, unindexed field.
 * Eager indexing already creates that index, and a matching manual index needs
 * no suggestion. `IndexDevModeConfig` documents the size threshold; this model
 * compares query metadata with mode, field-index presence, and Collection size.
 *
 * Grammar: manual/default and eager modes; 1,000, 1,001, and 1,101 source
 * rows; no index, a matching index, or an unrelated index; advice enabled or
 * disabled. The production driver builds a public live-query Collection. It
 * checks suggestions and indexes after initial query readiness. This bounded
 * oracle does not judge slow-query timing, repeated query warnings, index
 * benefit, or production-build suppression.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { BasicIndex } from '../src/indexes/basic-index.js'
import {
  configureIndexDevMode,
  getIndexDevModeConfig,
} from '../src/indexes/index-registry.js'
import { eq } from '../src/query/builder/functions.js'
import { createLiveQueryCollection } from '../src/query/live-query-collection.js'
import { mockSyncCollectionOptions, withOracleCleanup } from './utils.js'
import type { IndexSuggestion } from '../src/indexes/index-registry.js'

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
    // The first row above the threshold rejects a misplaced >1,001 cut.
    { mode: `off`, size: 1001, index: `none`, enabled: true },
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

      const rows = Array.from({ length: scenario.size }, (_, id): Row => ({
        id,
        url: `url-${id}`,
      }))
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

/**
 * A bounded ordered query should explain why no installed index can support its
 * ordered source prefix. The diagnostic must distinguish an absent field index,
 * a compare-options mismatch, and a matching index whose ordering is unusable.
 * Any usable candidate suppresses the warning, regardless of registration order.
 *
 * This finite grammar crosses field identity, null placement, ordered-read
 * capability, and multiple candidates. The production driver compiles and
 * preloads a public live-query Collection, then observes its development warning.
 * Lower-level index tests own the other comparison-option dimensions. Query
 * rows and production-build suppression remain with their existing owners.
 */
type OrderedIndexCandidate = {
  field: `id` | `name`
  nulls: `first` | `last`
  ordered: boolean
}

type OrderedIndexDiagnostic =
  `none` | `missing-field` | `compare-options` | `ordered-capability`

// The warning follows the cause that remains after considering every candidate.
function expectedOrderedIndexDiagnostic(
  candidates: ReadonlyArray<OrderedIndexCandidate>,
): OrderedIndexDiagnostic {
  const fieldCandidates = candidates.filter(({ field }) => field === `name`)
  if (fieldCandidates.length === 0) return `missing-field`
  const comparable = fieldCandidates.filter(({ nulls }) => nulls === `last`)
  if (comparable.length === 0) return `compare-options`
  if (comparable.some(({ ordered }) => ordered)) return `none`
  return `ordered-capability`
}

describe(`bounded orderBy index diagnostics`, () => {
  for (const scenario of [
    { name: `no indexes`, candidates: [] },
    {
      name: `only another field`,
      candidates: [{ field: `id`, nulls: `last`, ordered: true }],
    },
    {
      name: `same field with other compare options`,
      candidates: [{ field: `name`, nulls: `first`, ordered: true }],
    },
    {
      name: `same field and options with unusable ordering`,
      candidates: [{ field: `name`, nulls: `last`, ordered: false }],
    },
    {
      name: `usable index`,
      candidates: [{ field: `name`, nulls: `last`, ordered: true }],
    },
    {
      name: `mismatch before usable index`,
      candidates: [
        { field: `name`, nulls: `first`, ordered: true },
        { field: `name`, nulls: `last`, ordered: true },
      ],
    },
    {
      name: `unusable before usable index`,
      candidates: [
        { field: `name`, nulls: `last`, ordered: false },
        { field: `name`, nulls: `last`, ordered: true },
      ],
    },
    {
      name: `usable before unusable index`,
      candidates: [
        { field: `name`, nulls: `last`, ordered: true },
        { field: `name`, nulls: `last`, ordered: false },
      ],
    },
    {
      name: `usable before mismatched index`,
      candidates: [
        { field: `name`, nulls: `last`, ordered: true },
        { field: `name`, nulls: `first`, ordered: true },
      ],
    },
    {
      name: `mismatch and unusable matching index`,
      candidates: [
        { field: `name`, nulls: `first`, ordered: true },
        { field: `name`, nulls: `last`, ordered: false },
      ],
    },
    {
      name: `unusable matching index before mismatch`,
      candidates: [
        { field: `name`, nulls: `last`, ordered: false },
        { field: `name`, nulls: `first`, ordered: true },
      ],
    },
  ] as const) {
    test(scenario.name, async () => {
      const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
      const source = createCollection(
        mockSyncCollectionOptions<{ id: number; name: string }>({
          id: `ordered-index-diagnostic-${scenario.name}`,
          getKey: (row) => row.id,
          initialData: [
            { id: 1, name: `Charlie` },
            { id: 2, name: `Alice` },
            { id: 3, name: `Bob` },
          ],
          autoIndex: `off`,
        }),
      )
      let query: ReturnType<typeof createLiveQueryCollection> | undefined
      await withOracleCleanup(async () => {
        await source.stateWhenReady()
        for (const candidate of scenario.candidates) {
          source.createIndex((row) => row[candidate.field], {
            indexType: BasicIndex,
            options: {
              compareOptions: {
                direction: `asc`,
                nulls: candidate.nulls,
                stringSort: `locale`,
              },
              ...(candidate.ordered
                ? {}
                : { compareFn: (a: string, b: string) => b.localeCompare(a) }),
            },
          })
        }

        query = createLiveQueryCollection((q) =>
          q
            .from({ row: source })
            .orderBy(({ row }) => row.name, {
              direction: `asc`,
              nulls: `last`,
            })
            .limit(2),
        )

        await query.preload()
        expect(query.toArray.map((row) => row.name)).toEqual([`Alice`, `Bob`])
        const messages = warning.mock.calls
          .flat()
          .filter(
            (message): message is string =>
              typeof message === `string` &&
              message.includes(`orderBy with limit`),
          )
        const expected = expectedOrderedIndexDiagnostic(scenario.candidates)
        expect(messages).toHaveLength(expected === `none` ? 0 : 1)
        if (expected === `missing-field`) {
          expect(messages[0]).toContain(`requires an index on "name"`)
        }
        if (expected === `compare-options`) {
          expect(messages[0]).toContain(
            `found an index on "name", but none uses the query's compareOptions`,
          )
          expect(messages[0]).toContain(`direction: "asc"`)
          expect(messages[0]).toContain(`nulls: "last"`)
          expect(messages[0]).toContain(`stringSort: "locale"`)
          expect(messages[0]).toContain(`importing BasicIndex`)
          expect(messages[0]).toContain(`same compareOptions`)
        }
        if (expected === `ordered-capability`) {
          expect(messages[0]).toContain(
            `found an index on "name" with matching compareOptions, but none supports ordered lazy loading`,
          )
        }
      }, [
        () => warning.mockRestore(),
        () => query?.cleanup(),
        () => source.cleanup(),
      ])
    })
  }

  test.each([false, true])(
    `does not inspect cyclic locale options when field index presence is %s`,
    async (hasFieldIndex) => {
      const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
      const localeOptions: Record<string, unknown> = {}
      localeOptions.self = localeOptions
      const source = createCollection(
        mockSyncCollectionOptions<{ id: number; name: string }>({
          id: `cyclic-index-diagnostic-${hasFieldIndex}`,
          getKey: (row) => row.id,
          initialData: [{ id: 1, name: `Alice` }],
          autoIndex: `off`,
        }),
      )
      let query: ReturnType<typeof createLiveQueryCollection> | undefined
      await withOracleCleanup(async () => {
        await source.stateWhenReady()
        if (hasFieldIndex) {
          source.createIndex((row) => row.name, { indexType: BasicIndex })
        }

        expect(() => {
          query = createLiveQueryCollection((q) =>
            q
              .from({ row: source })
              .orderBy(({ row }) => row.name, {
                direction: `asc`,
                nulls: `last`,
                stringSort: `locale`,
                localeOptions,
              })
              .limit(1),
          )
        }).not.toThrow()
        await query!.preload()
        expect(query!.toArray.map((row) => row.name)).toEqual([`Alice`])
      }, [
        () => warning.mockRestore(),
        () => query?.cleanup(),
        () => source.cleanup(),
      ])
    },
  )

  test(`explains that a custom index must reuse the comparator reference`, async () => {
    const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const compare = (a: string, b: string) => a.length - b.length
    const source = createCollection(
      mockSyncCollectionOptions<{ id: number; name: string }>({
        id: `custom-compare-index-diagnostic`,
        getKey: (row) => row.id,
        initialData: [{ id: 1, name: `Alice` }],
        autoIndex: `off`,
      }),
    )
    let query: ReturnType<typeof createLiveQueryCollection> | undefined
    await withOracleCleanup(async () => {
      await source.stateWhenReady()
      source.createIndex((row) => row.name, { indexType: BasicIndex })
      query = createLiveQueryCollection((q) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.name, {
            stringSort: `custom`,
            compare,
          })
          .limit(1),
      )

      await query.preload()
      const message = warning.mock.calls
        .flat()
        .find(
          (value): value is string =>
            typeof value === `string` && value.includes(`orderBy with limit`),
        )
      expect(message).toContain(`same compare function reference`)
      expect(message).not.toContain(`"compare":"[function]"`)
    }, [
      () => warning.mockRestore(),
      () => query?.cleanup(),
      () => source.cleanup(),
    ])
  })
})
