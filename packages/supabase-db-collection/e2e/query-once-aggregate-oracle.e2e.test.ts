/**
 * Server-aggregate oracle for `experimental_queryOnce`.
 *
 * Law: for every query it accepts, `experimental_queryOnce(query, supabase)`
 * resolves to the same result as TanStack DB's `queryOnce(query)` over the
 * same table state. Routing a query to PostgREST is an optimization; it must
 * not change the answer. Authority: IFCS-154 and the function's contract.
 * Queries that are not aggregate-only "fall back to TanStack DB's own
 * `queryOnce`", and the server path returns a result "shaped like TanStack's
 * result", so a caller cannot choose a route and must not see one.
 *
 * Why generated histories: an aggregate-only select over one Supabase table is
 * the only query the server path computes. Its answer depends on details that
 * fixed examples rarely combine:
 *
 * - empty and all-null inputs, where SQL aggregates return `null` or `0`;
 * - columns the collection reads through `parse`, which PostgREST never sees;
 * - `min`/`max`, which TanStack DB computes with JavaScript comparisons;
 * - `limit`, `offset`, and `findOne` on the single aggregate row;
 * - a filter PostgREST cannot express, such as `eq(upper(label), 'A')`;
 * - a filter-only subquery source, whose `where` is pushed down too.
 *
 * Limits:
 *
 * - one local Supabase stack (PostgREST with `db_aggregates_enabled`) and one
 *   table;
 * - the aggregates `count`, `sum`, `avg`, `min`, and `max`, with `min` and
 *   `max` only over columns that hold no text (see ORDERABLE_COLUMNS);
 * - small integers and decimals that doubles represent exactly, so the
 *   comparison is exact and does not round averages;
 * - no grouped, joined, or computed queries. Those take TanStack DB's path on
 *   both sides, so this oracle says nothing about them.
 */
import { createClient } from '@supabase/supabase-js'
import {
  and,
  avg,
  count,
  createCollection,
  eq,
  gt,
  inArray,
  isNull,
  max,
  min,
  not,
  or,
  queryOnce,
  sum,
  upper,
} from '@tanstack/db'
import { QueryClient } from '@tanstack/query-core'
import fc from 'fast-check'
import { expect, inject, it } from 'vitest'
import { z } from 'zod'
import { runOracleCampaign } from '../../db/tests/oracle-campaign'
import { oracleRuns } from '../../db/tests/oracle-config'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { experimental_queryOnce, supabaseCollectionOptions } from '../src/index'
import { makeAdminClient } from './setup'
import type { InitialQueryBuilder } from '@tanstack/db'

// ── History grammar ─────────────────────────────────────────────────
//
// A history is one table state, written through the service-role client, and
// one to three aggregate queries run against it. Values come from small
// domains so that ties, nulls, and empty matches are common:
//
// - `score` is a small integer, so sums and averages stay exact in a double;
// - `label` mixes case and the empty string, which text collations order
//   differently;
// - `recorded_at` is a timestamptz, read into a `Date` with `parse`;
// - `big_count` is a bigint stored as text and read with `parse`, so `10`
//   orders after `9` in the collection but before it in Postgres;
// - `amount` is a decimal stored as text and read with `parse`, so the
//   collection can sum it while Postgres cannot sum text.
//
// Only aggregate-only selects over the `query_once_rows` table are generated,
// so every query is one the server path accepts. Illegal histories (a
// duplicate id, `sum` over text) are not generated.

const COLUMNS = [
  `id`,
  `score`,
  `label`,
  `recorded_at`,
  `big_count`,
  `amount`,
] as const
type Column = (typeof COLUMNS)[number]
// TanStack DB orders a null as 0 in `min` and `max`, and JavaScript compares
// text with 0 inconsistently (`'a' < 0` and `0 < 'a'` are both false), so its
// result over a text column with nulls depends on row order. That is a
// @tanstack/db defect recorded in docs/contributing/oracle-coverage.md, so
// `min` and `max` are generated only over columns that hold no text.
const ORDERABLE_COLUMNS = COLUMNS.filter((column) => column !== `label`)
const CONVERTED_COLUMNS: ReadonlyArray<Column> = [
  `recorded_at`,
  `big_count`,
  `amount`,
]

interface SeedRow {
  id: number
  score: number | null
  label: string | null
  recorded_at: string | null
  big_count: string | null
  amount: string | null
}

type Aggregate =
  | { fn: `count` | `min` | `max`; column: Column }
  | { fn: `sum` | `avg`; column: `id` | `score` | `amount` }

type Filter =
  | { kind: `gt`; value: number }
  | { kind: `eq`; value: string }
  | { kind: `upper`; value: string }
  | { kind: `isNull`; column: Column }
  | { kind: `in`; ids: Array<number> }
  | { kind: `not`; inner: Filter }
  | { kind: `and` | `or`; left: Filter; right: Filter }

interface AggregateQuery {
  aggregates: Array<Aggregate>
  where?: Filter
  /** A filter applied inside a subquery source instead of the outer query */
  sourceWhere?: Filter
  limit?: number
  offset?: number
  findOne: boolean
}

const seedRows = fc
  .uniqueArray(fc.integer({ min: 1, max: 12 }), { maxLength: 8 })
  .chain((ids) =>
    fc.tuple(
      ...ids.map((id) =>
        fc.record({
          id: fc.constant(id),
          score: fc.option(fc.integer({ min: -3, max: 3 }), { freq: 2 }),
          label: fc.option(fc.constantFrom(`a`, `A`, `b`, `B`, ``, `a b`), {
            freq: 2,
          }),
          recorded_at: fc.option(
            fc.constantFrom(
              `2026-01-01T00:00:00+00:00`,
              `2026-01-02T12:00:00+00:00`,
              `2025-12-31T23:59:59+00:00`,
            ),
          ),
          big_count: fc.option(
            fc.constantFrom(`9`, `10`, `-1`, `9007199254740993`),
          ),
          amount: fc.option(fc.constantFrom(`1.5`, `2`, `-0.25`)),
        }),
      ),
    ),
  )

// Weights keep most queries on the server path (count, sum, and avg with
// pushable filters and no paging), while every other branch still appears in
// each campaign. Reach below counts both.
const aggregate: fc.Arbitrary<Aggregate> = fc.oneof(
  {
    weight: 2,
    arbitrary: fc.record({
      fn: fc.constant(`count` as const),
      column: fc.constantFrom(...COLUMNS),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      fn: fc.constantFrom(`sum` as const, `avg` as const),
      // `score` is the nullable plain column, so it carries the null rules.
      column: fc.oneof(
        { weight: 2, arbitrary: fc.constant(`score` as const) },
        {
          weight: 1,
          arbitrary: fc.constantFrom(`id` as const, `amount` as const),
        },
      ),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      fn: fc.constantFrom(`min` as const, `max` as const),
      column: fc.constantFrom(...ORDERABLE_COLUMNS),
    }),
  },
)

const filter: fc.Arbitrary<Filter> = fc.letrec<{ filter: Filter }>((tie) => ({
  filter: fc.oneof(
    { depthSize: `small`, withCrossShrink: true },
    {
      weight: 3,
      arbitrary: fc.record({
        kind: fc.constant(`gt` as const),
        value: fc.integer({ min: -3, max: 3 }),
      }),
    },
    {
      weight: 3,
      arbitrary: fc.record({
        kind: fc.constant(`eq` as const),
        value: fc.constantFrom(`a`, `B`, ``),
      }),
    },
    {
      weight: 3,
      arbitrary: fc.record({
        kind: fc.constant(`isNull` as const),
        column: fc.constantFrom(...COLUMNS),
      }),
    },
    {
      weight: 3,
      arbitrary: fc.record({
        kind: fc.constant(`in` as const),
        ids: fc.uniqueArray(fc.integer({ min: 1, max: 12 }), { maxLength: 3 }),
      }),
    },
    {
      weight: 3,
      arbitrary: fc.record({
        kind: fc.constant(`not` as const),
        inner: tie(`filter`),
      }),
    },
    {
      weight: 3,
      arbitrary: fc.record({
        kind: fc.constantFrom(`and` as const, `or` as const),
        left: tie(`filter`),
        right: tie(`filter`),
      }),
    },
    {
      // Rarer than the pushable leaves: one unpushable leaf anywhere in a
      // query sends it to TanStack DB.
      weight: 1,
      arbitrary: fc.record({
        kind: fc.constant(`upper` as const),
        value: fc.constantFrom(`A`, `B`),
      }),
    },
  ),
})).filter

/** `undefined` in three of four cases */
const rarely = <T>(arbitrary: fc.Arbitrary<T>) =>
  fc.oneof(
    { weight: 3, arbitrary: fc.constant(undefined) },
    { weight: 1, arbitrary },
  )

const aggregateQuery: fc.Arbitrary<AggregateQuery> = fc
  .record({
    aggregates: fc.array(aggregate, { minLength: 1, maxLength: 3 }),
    where: fc.option(filter, { nil: undefined, freq: 1 }),
    sourceWhere: fc.option(filter, { nil: undefined, freq: 1 }),
    paging: rarely(
      fc.record(
        { limit: fc.constantFrom(0, 1, 5), offset: fc.constantFrom(0, 1) },
        { requiredKeys: [] },
      ),
    ),
    findOne: fc.boolean(),
  })
  .map(({ paging, ...query }) => ({ ...query, ...paging }))

type History = typeof history extends fc.Arbitrary<infer T> ? T : never

const history = fc.record({
  rows: seedRows,
  queries: fc.array(aggregateQuery, { minLength: 1, maxLength: 3 }),
})

// ── Production driver ───────────────────────────────────────────────
//
// Both sides read the same table through a Supabase collection created by
// this package, with the same `parse` conversions:
//
// - The production side runs `experimental_queryOnce` over an on-demand
//   collection (the default). Its Supabase client records every request, so
//   the driver can tell whether PostgREST computed the aggregate.
// - The reference side runs TanStack DB's `queryOnce` over an eager collection,
//   which loads every row and computes the aggregate in TanStack DB. It never
//   asks PostgREST to filter or aggregate, so it shares no translation with
//   the server path.

const rowSchema = z.object({
  id: z.number(),
  score: z.number().nullable(),
  label: z.string().nullable(),
  recorded_at: z.date().nullable(),
  big_count: z.bigint().nullable(),
  amount: z.number().nullable(),
})

const conversions = {
  parse: {
    recorded_at: (value: unknown) => new Date(value as string),
    big_count: (value: unknown) => BigInt(value as string),
    amount: (value: unknown) => Number(value),
  },
  serialize: {
    recorded_at: (value: Date) => value.toISOString(),
    big_count: (value: bigint) => value.toString(),
    amount: (value: number) => value.toString(),
  },
}

function makeRowsCollection(syncMode: `eager` | `on-demand`) {
  const requests: Array<URL> = []
  const supabase = createClient(
    inject(`supabaseUrl`),
    inject(`supabaseAnonKey`),
    {
      global: {
        fetch: (input, init) => {
          requests.push(new URL(input instanceof Request ? input.url : input))
          return fetch(input, init)
        },
      },
    },
  )
  const collection = createCollection(
    supabaseCollectionOptions({
      tableName: `query_once_rows`,
      keys: [`id`],
      schema: rowSchema,
      supabase,
      queryClient: new QueryClient(),
      syncMode,
      ...conversions,
    }),
  )
  return { collection, supabase, requests }
}

type RowsCollection = ReturnType<typeof makeRowsCollection>[`collection`]

// The builders are typed for the collection's row refs; the generated query
// picks columns at run time, so refs are passed as `never`.
type RowRef = Record<Column, never>

/** Renders a generated filter with TanStack DB's expression builders. */
function where(row: RowRef, spec: Filter): ReturnType<typeof eq> {
  switch (spec.kind) {
    case `gt`:
      return gt(row.score, spec.value)
    case `eq`:
      return eq(row.label, spec.value)
    case `upper`:
      return eq(upper(row.label), spec.value)
    case `isNull`:
      return isNull(row[spec.column])
    case `in`:
      return inArray(row.id, spec.ids)
    case `not`:
      return not(where(row, spec.inner))
    case `and`:
      return and(where(row, spec.left), where(row, spec.right))
    case `or`:
      return or(where(row, spec.left), where(row, spec.right))
  }
}

const AGGREGATES: Record<Aggregate[`fn`], (arg: never) => unknown> = {
  count,
  sum,
  avg,
  min,
  max,
}

/**
 * The rows a generated query aggregates: the table, or a subquery that only
 * filters it, then the outer filter.
 */
function filteredRows(
  q: InitialQueryBuilder,
  collection: RowsCollection,
  spec: AggregateQuery,
) {
  const { sourceWhere, where: outerWhere } = spec
  const source =
    sourceWhere === undefined
      ? collection
      : q
          .from({ inner: collection })
          .where(({ inner }) => where(inner as unknown as RowRef, sourceWhere))
  const query = q.from({ row: source as RowsCollection })
  return outerWhere === undefined
    ? query
    : query.where(({ row }) => where(row as unknown as RowRef, outerWhere))
}

const aliasOf = (agg: Aggregate, index: number) =>
  `${agg.fn}_${agg.column}_${index}`

/**
 * Builds the generated query. Its select holds only aggregates, so both sides
 * receive a query the server path accepts.
 */
function buildQuery(collection: RowsCollection, spec: AggregateQuery) {
  return (q: InitialQueryBuilder) => {
    let selected = filteredRows(q, collection, spec).select(
      ({ row }) =>
        Object.fromEntries(
          spec.aggregates.map((agg, index) => [
            aliasOf(agg, index),
            AGGREGATES[agg.fn]((row as unknown as RowRef)[agg.column]),
          ]),
        ) as Record<string, ReturnType<typeof count>>,
    )
    if (spec.limit !== undefined) selected = selected.limit(spec.limit)
    if (spec.offset !== undefined) selected = selected.offset(spec.offset)
    return spec.findOne ? selected.findOne() : selected
  }
}

// ── Refinement check ────────────────────────────────────────────────
//
// Checkpoint: the settled promise of each query. Both results must be equal
// as values: the same number of rows, or `undefined` for `findOne` with no
// row, and in each row the same value of every selected alias. A `Date`
// equals only a `Date` at the same instant, a `bigint` only a `bigint`, and
// `null` only `null`. An error must match too: if the reference rejects,
// production must reject.
//
// The comparison projects each row to the select's aliases. TanStack DB's rows
// also carry the virtual fields `$key`, `$origin`, `$hasPendingWrites`, and
// `$collectionId`, which describe the temporary live-query Collection that
// `queryOnce` creates; `$collectionId` differs on every call. Rows that
// PostgREST computes have no such Collection. Authority: maintainer decision
// (Ivan Vasilov, 2026-11-11), recorded in docs/contributing/oracle-coverage.md.

type Outcome = { ok: true; value: unknown } | { ok: false; error: string }

async function settle(run: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

function projectToAliases(value: unknown, aliases: Array<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((row) => projectToAliases(row, aliases))
  }
  if (value === undefined) return value
  const row = value as Record<string, unknown>
  return Object.fromEntries(aliases.map((alias) => [alias, row[alias]]))
}

function expectSameOutcome(
  production: Outcome,
  reference: Outcome,
  aliases: Array<string>,
  label: string,
): void {
  if (!reference.ok) {
    expect(production.ok, `${label}: reference rejected`).toBe(false)
    return
  }
  expect(production.ok, `${label}: production rejected`).toBe(true)
  if (!production.ok) return
  expect(projectToAliases(production.value, aliases), label).toStrictEqual(
    projectToAliases(reference.value, aliases),
  )
}

declareOracle({ check: [expectSameOutcome], grammar: [history] })

// ── Reach ───────────────────────────────────────────────────────────
//
// Each state is credited after the comparison passed, from an observation
// rather than from the generated intent. The server-route states are the
// ones where SQL and TanStack DB aggregates differ, so the server path must
// translate:
//
// - `server-route`: production sent an aggregate select to PostgREST;
// - `server-empty-match`: that query matched no rows, where SQL still
//   returns one aggregate row;
// - `server-null-value`: an aggregated column held a null in a matched row,
//   which SQL skips and TanStack DB counts as 0;
// - `server-find-one`: that query used `findOne`;
// - `server-subquery-source`: that query read a filter-only subquery, whose
//   filter PostgREST applies too.
//
// The other states witness queries the server path must leave to TanStack DB:
//
// - `client-route`: production sent no aggregate select;
// - `converted-column`: an aggregate reads a parsed column with values;
// - `limit-or-offset`: the query set `limit` or `offset`;
// - `unpushable-filter`: a filter used `upper`, which PostgREST cannot apply.

const REACH_STATES = [
  `server-route`,
  `server-empty-match`,
  `server-null-value`,
  `server-find-one`,
  `server-subquery-source`,
  `client-route`,
  `converted-column`,
  `limit-or-offset`,
  `unpushable-filter`,
] as const
type ReachState = (typeof REACH_STATES)[number]

const usesUpper = (spec: Filter | undefined): boolean => {
  switch (spec?.kind) {
    case `upper`:
      return true
    case `not`:
      return usesUpper(spec.inner)
    case `and`:
    case `or`:
      return usesUpper(spec.left) || usesUpper(spec.right)
    default:
      return false
  }
}

const isAggregateSelect = (url: URL) =>
  /\.(count|sum|avg|min|max)\(\)/.test(url.searchParams.get(`select`) ?? ``)

async function withCleanup(
  body: () => Promise<void>,
  ...cleanups: Array<() => Promise<unknown>>
): Promise<void> {
  let primary: { error: unknown } | undefined
  try {
    await body()
  } catch (error) {
    primary = { error }
  }
  const errors: Array<unknown> = []
  for (const cleanup of cleanups) {
    try {
      await cleanup()
    } catch (error) {
      errors.push(error)
    }
  }
  if (primary && errors.length > 0) {
    throw new AggregateError(
      [primary.error, ...errors],
      `Comparison and cleanup failed`,
      { cause: primary.error },
    )
  }
  if (primary) throw primary.error
  if (errors.length > 0) {
    throw new AggregateError(errors, `Cleanup failed`, { cause: errors[0] })
  }
}

async function runHistory(
  { rows, queries }: History,
  reached: (state: ReachState) => void,
): Promise<void> {
  const { error } = await makeAdminClient().rpc(`reset_query_once_rows`, {
    rows: rows satisfies Array<SeedRow>,
  })
  if (error) throw new Error(`seeding failed: ${error.message}`)

  const production = makeRowsCollection(`on-demand`)
  const reference = makeRowsCollection(`eager`)
  await withCleanup(
    async () => {
      for (const [index, spec] of queries.entries()) {
        const label = `query ${index}: ${JSON.stringify(spec)}`
        production.requests.length = 0
        const actual = await settle(() =>
          experimental_queryOnce(
            buildQuery(production.collection, spec),
            production.supabase,
          ),
        )
        const expected = await settle(() =>
          queryOnce(buildQuery(reference.collection, spec)),
        )
        expectSameOutcome(actual, expected, spec.aggregates.map(aliasOf), label)

        const matched: Array<Record<Column, unknown>> = await queryOnce((q) =>
          filteredRows(q, reference.collection, spec),
        )
        const aggregated = spec.aggregates.map(({ column }) =>
          matched.map((row) => row[column]),
        )
        if (production.requests.some(isAggregateSelect)) {
          reached(`server-route`)
          if (matched.length === 0) reached(`server-empty-match`)
          if (aggregated.some((values) => values.includes(null)))
            reached(`server-null-value`)
          if (spec.findOne) reached(`server-find-one`)
          if (spec.sourceWhere !== undefined) reached(`server-subquery-source`)
        } else {
          reached(`client-route`)
        }
        if (
          spec.aggregates.some(
            ({ column }, position) =>
              CONVERTED_COLUMNS.includes(column) &&
              aggregated[position]!.some((value) => value !== null),
          )
        )
          reached(`converted-column`)
        if (spec.limit !== undefined || spec.offset !== undefined)
          reached(`limit-or-offset`)
        if ([spec.where, spec.sourceWhere].some(usesUpper))
          reached(`unpushable-filter`)
      }
    },
    () => production.collection.cleanup(),
    () => reference.collection.cleanup(),
  )
}

it(`experimental_queryOnce matches TanStack DB's queryOnce for generated aggregate queries`, async () => {
  await runOracleCampaign(
    `SUPABASE_QUERY_ONCE_AGGREGATE_ORACLE`,
    REACH_STATES,
    async (reach, parameters) => {
      await fc.assert(
        fc.asyncProperty(history, async (generated) => {
          reach.beginHistory()
          await runHistory(generated, (state) => reach.reach(state))
        }),
        { numRuns: oracleRuns(40), ...parameters },
      )
    },
  )
}, 300_000)
