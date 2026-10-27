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
import { declareOracle } from './oracle-declaration.js'
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

// The check: a size suggestion appears exactly when the model predicts one, and
// names the Collection, the queried field, and its size.
function expectSizeSuggestionOutcome(
  sizeSuggestions: ReadonlyArray<IndexSuggestion>,
  expected: number,
  collectionId: string,
  size: number,
): void {
  expect(sizeSuggestions).toHaveLength(expected)
  if (expected) {
    expect(sizeSuggestions[0]).toMatchObject({
      collectionId,
      fieldPath: [`url`],
      collectionSize: size,
    })
  }
}

// The model: an eager or indexed field leaves one index; otherwise none.
function expectedIndexCount(
  mode: `off` | `eager` | undefined,
  index: `none` | `url` | `id`,
): number {
  return mode === `eager` || index !== `none` ? 1 : 0
}

declareOracle({
  check: [expectSizeSuggestionOutcome, expectOrderedIndexMessages],
  model: [
    expectedSuggestions,
    expectedIndexCount,
    expectedOrderedIndexDiagnostic,
  ],
})

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
        expectSizeSuggestionOutcome(
          sizeSuggestions,
          expected,
          source.id,
          scenario.size,
        )
        expect(source.indexes.size).toBe(
          expectedIndexCount(scenario.mode, scenario.index),
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
 * A bounded ordered query should explain why its ordered source prefix cannot
 * use an index. The diagnostic distinguishes an absent field index, a
 * compare-options mismatch, an order-ineligible index, a virtual field, and
 * a custom local comparator whose provider order cannot be paginated. Any
 * usable candidate suppresses the index warning, not the custom-sort warning.
 *
 * This finite grammar crosses field identity, null placement, ordered-read
 * capability, and multiple candidates. Separate custom and unindexed on-demand
 * cells observe provider request shape after preload, so the message's work
 * claim is checked against a public source acquisition. Lower-level index tests
 * own other comparison-option dimensions; production-build suppression remains
 * outside this owner.
 */
type OrderedIndexCandidate = {
  field: `id` | `name`
  nulls: `first` | `last`
  ordered: boolean
  direction?: `asc` | `desc`
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

// The check: the warnings match the diagnostic the model predicts, and name
// the cause that remains after every candidate is considered.
function expectOrderedIndexMessages(
  messages: ReadonlyArray<string>,
  expected: OrderedIndexDiagnostic,
): void {
  expect(messages).toHaveLength(expected === `none` ? 0 : 1)
  if (expected === `missing-field`) {
    expect(messages[0]).toContain(`requires an index on "name"`)
  }
  if (expected === `compare-options`) {
    expect(messages[0]).toContain(
      `found an index on "name", but none uses the query's compareOptions`,
    )
    // Direction completes the copyable options object, but an index in
    // the other direction can be read in reverse.
    expect(messages[0]).toContain(`direction: "asc"`)
    expect(messages[0]).toContain(`nulls: "last"`)
    expect(messages[0]).toContain(`stringSort: "locale"`)
    expect(messages[0]).toContain(`importing BasicIndex`)
    expect(messages[0]).toContain(`The index direction may differ.`)
    expect(messages[0]).toContain(`options: { compareOptions:`)
  }
  if (expected === `ordered-capability`) {
    expect(messages[0]).toContain(
      `found an index on "name" with matching compareOptions, but none supports ordered lazy loading`,
    )
  }
}

describe(`bounded orderBy index diagnostics`, () => {
  const scenarios: ReadonlyArray<{
    name: string
    candidates: ReadonlyArray<OrderedIndexCandidate>
  }> = [
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
      name: `usable index in reverse direction`,
      candidates: [
        { field: `name`, nulls: `last`, ordered: true, direction: `desc` },
      ],
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
  ]
  for (const scenario of scenarios) {
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
                direction: candidate.direction ?? `asc`,
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
        expectOrderedIndexMessages(messages, expected)
      }, [
        () => warning.mockRestore(),
        () => query?.cleanup(),
        () => source.cleanup(),
      ])
    })
  }

  // A local index cannot confer a provider collation identity. Even a
  // comparator-compatible index must leave the full-source cost visible.
})
