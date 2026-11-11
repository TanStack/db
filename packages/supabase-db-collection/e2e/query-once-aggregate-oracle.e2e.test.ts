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
 * - text ordering for `min`/`max`, which Postgres decides by collation;
 * - `limit`, `offset`, and `findOne` on the single aggregate row;
 * - a filter-only subquery source, whose `where` is pushed down too.
 *
 * Limits: one local Supabase stack (PostgREST with `db_aggregates_enabled`),
 * one table, and the aggregates `count`, `sum`, `avg`, `min`, and `max`.
 * Grouped, joined, and computed queries take TanStack DB's path on both sides;
 * this oracle generates none of them, so it says nothing about them. The
 * comparison is exact: it does not round averages.
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
//   orders after `9` in the collection but before it in Postgres.
//
// Only aggregate-only selects over the `query_once_rows` table are generated,
// so every query is one the server path accepts. Illegal histories (a
// duplicate id, `sum` over text) are not generated.

const COLUMNS = [`id`, `score`, `label`, `recorded_at`, `big_count`] as const
type Column = (typeof COLUMNS)[number]
const NUMERIC_COLUMNS = [`id`, `score`] as const
const CONVERTED_COLUMNS: ReadonlyArray<Column> = [`recorded_at`, `big_count`]

interface SeedRow {
  id: number
  score: number | null
  label: string | null
  recorded_at: string | null
  big_count: string | null
}

type Aggregate =
  | { fn: `count` | `min` | `max`; column: Column }
  | { fn: `sum` | `avg`; column: (typeof NUMERIC_COLUMNS)[number] }

type Filter =
  | { kind: `gt`; value: number }
  | { kind: `eq`; value: string }
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
  .uniqueArray(fc.integer({ min: 1, max: 12 }), { maxLength: 6 })
  .chain((ids) =>
    fc.tuple(
      ...ids.map((id) =>
        fc.record({
          id: fc.constant(id),
          score: fc.option(fc.integer({ min: -3, max: 3 })),
          label: fc.option(fc.constantFrom(`a`, `A`, `b`, `B`, ``, `a b`)),
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
        }),
      ),
    ),
  )

const aggregate: fc.Arbitrary<Aggregate> = fc.oneof(
  fc.record({
    fn: fc.constantFrom(`count` as const, `min` as const, `max` as const),
    column: fc.constantFrom(...COLUMNS),
  }),
  fc.record({
    fn: fc.constantFrom(`sum` as const, `avg` as const),
    column: fc.constantFrom(...NUMERIC_COLUMNS),
  }),
)

const filter: fc.Arbitrary<Filter> = fc.letrec<{ filter: Filter }>((tie) => ({
  filter: fc.oneof(
    { depthSize: `small`, withCrossShrink: true },
    fc.record({
      kind: fc.constant(`gt` as const),
      value: fc.integer({ min: -3, max: 3 }),
    }),
    fc.record({
      kind: fc.constant(`eq` as const),
      value: fc.constantFrom(`a`, `B`, ``),
    }),
    fc.record({
      kind: fc.constant(`isNull` as const),
      column: fc.constantFrom(...COLUMNS),
    }),
    fc.record({
      kind: fc.constant(`in` as const),
      ids: fc.uniqueArray(fc.integer({ min: 1, max: 12 }), { maxLength: 3 }),
    }),
    fc.record({ kind: fc.constant(`not` as const), inner: tie(`filter`) }),
    fc.record({
      kind: fc.constantFrom(`and` as const, `or` as const),
      left: tie(`filter`),
      right: tie(`filter`),
    }),
  ),
})).filter

const aggregateQuery: fc.Arbitrary<AggregateQuery> = fc.record(
  {
    aggregates: fc.array(aggregate, { minLength: 1, maxLength: 3 }),
    where: filter,
    sourceWhere: filter,
    limit: fc.constantFrom(0, 1, 5),
    offset: fc.constantFrom(0, 1),
    findOne: fc.boolean(),
  },
  { requiredKeys: [`aggregates`, `findOne`] },
)

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
})

const conversions = {
  parse: {
    recorded_at: (value: unknown) => new Date(value as string),
    big_count: (value: unknown) => BigInt(value as string),
  },
  serialize: {
    recorded_at: (value: Date) => value.toISOString(),
    big_count: (value: bigint) => value.toString(),
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
// Each state is credited from an observation, not from the generated intent:
//
// - `server-route`: production sent an aggregate select to PostgREST;
// - `empty-match`: the reference matched no rows;
// - `null-only-column`: an aggregated column is null in every matched row;
// - `converted-column`: an aggregate reads a parsed column with values;
// - `limit-or-offset`: the query set `limit` or `offset`;
// - `find-one`: the query used `findOne`;
// - `subquery-source`: the query read a filter-only subquery.

const REACH_STATES = [
  `server-route`,
  `empty-match`,
  `null-only-column`,
  `converted-column`,
  `limit-or-offset`,
  `find-one`,
  `subquery-source`,
] as const
type ReachState = (typeof REACH_STATES)[number]

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

        if (production.requests.some(isAggregateSelect)) reached(`server-route`)
        const matched: Array<Record<Column, unknown>> = await queryOnce((q) =>
          filteredRows(q, reference.collection, spec),
        )
        if (matched.length === 0) reached(`empty-match`)
        for (const { column } of spec.aggregates) {
          const values = matched.map((row) => row[column])
          if (values.length > 0 && values.every((value) => value === null))
            reached(`null-only-column`)
          if (
            CONVERTED_COLUMNS.includes(column) &&
            values.some((value) => value !== null)
          )
            reached(`converted-column`)
        }
        if (spec.limit !== undefined || spec.offset !== undefined)
          reached(`limit-or-offset`)
        if (spec.findOne) reached(`find-one`)
        if (spec.sourceWhere !== undefined) reached(`subquery-source`)
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
        { numRuns: oracleRuns(25), ...parameters },
      )
    },
  )
}, 300_000)
