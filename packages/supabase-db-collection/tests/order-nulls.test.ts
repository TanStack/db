import { createClient } from '@supabase/supabase-js'
import { createCollection, localOnlyCollectionOptions } from '@tanstack/db'
import { describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { supabaseCollectionOptions } from '../src/index'
import { SUPABASE_KEY, SUPABASE_URL, queryResult } from './test.utils'

// A limited, ordered live query over an on-demand collection only sees the
// rows the server sends for that window. The server must therefore cut the
// window from the same order the client applies, including where nulls sort.
// TanStack DB places nulls first unless told otherwise, while Postgres places
// them last for ascending order, so the adapter has to say where they go.
//
// The reference is the same live query over a local-only collection holding
// every row: TanStack DB's own in-memory ordering, with no server involved.

type Row = { id: number; rank: number | null }

const rows: Array<Row> = [
  { id: 1, rank: 2 },
  { id: 2, rank: null },
  { id: 3, rank: 1 },
  { id: 4, rank: null },
  { id: 5, rank: 3 },
]

const schema = z.object({ id: z.number(), rank: z.number().nullable() })

/**
 * Orders rows the way PostgREST does for an `order` param of
 * `col.dir[.nullsfirst|.nullslast]` sorts: Postgres puts nulls last for `asc`
 * and first for `desc` unless the sort names a placement.
 */
function postgresOrder(order: string) {
  const sorts = order.split(`,`).map((sort) => {
    const [column = ``, direction = `asc`, nulls] = sort.split(`.`)
    const nullsFirst =
      nulls === undefined ? direction === `desc` : nulls === `nullsfirst`
    return {
      column: column as keyof Row,
      descending: direction === `desc`,
      nullsFirst,
    }
  })
  return (a: Row, b: Row): number => {
    for (const { column, descending, nullsFirst } of sorts) {
      const left = a[column]
      const right = b[column]
      if (left === right) continue
      if (left === null) return nullsFirst ? -1 : 1
      if (right === null) return nullsFirst ? 1 : -1
      return (left < right ? -1 : 1) * (descending ? -1 : 1)
    }
    return 0
  }
}

const comparisons: Record<string, (value: number, target: number) => boolean> =
  {
    eq: (value, target) => value === target,
    gt: (value, target) => value > target,
    gte: (value, target) => value >= target,
    lt: (value, target) => value < target,
    lte: (value, target) => value <= target,
  }

/**
 * Keeps the rows a `col=op.value` filter matches, with SQL semantics: a null
 * column matches only `is.null`. A filter the mock does not know throws, so a
 * request it cannot serve fails the test instead of returning every row.
 */
function matches(row: Row, column: string, filter: string): boolean {
  const [op = ``, operand = ``] = filter.split(/\.(.*)/s)
  const value = row[column as keyof Row]
  if (op === `is` && operand === `null`) return value === null
  const compare = comparisons[op]
  if (!compare) throw new Error(`mock cannot serve filter ${column}=${filter}`)
  return value !== null && compare(value, Number(operand))
}

/** Serves `rows` for `order`, `limit` and simple column filters. */
const postgrestFetch = () =>
  vi.fn<typeof fetch>().mockImplementation((input) => {
    const params = new URL(String(input)).searchParams
    let selected = [...rows]
    for (const [name, filter] of params) {
      if ([`select`, `order`, `limit`, `offset`].includes(name)) continue
      selected = selected.filter((row) => matches(row, name, filter))
    }
    const order = params.get(`order`)
    if (order) selected.sort(postgresOrder(order))
    const total = selected.length
    const limit = params.get(`limit`)
    const body = limit === null ? selected : selected.slice(0, Number(limit))
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: {
          'content-type': `application/json`,
          'content-range': body.length
            ? `0-${body.length - 1}/${total}`
            : `*/${total}`,
        },
      }),
    )
  })

const cases = [
  { direction: `asc`, nulls: undefined },
  { direction: `asc`, nulls: `first` },
  { direction: `asc`, nulls: `last` },
  { direction: `desc`, nulls: undefined },
  { direction: `desc`, nulls: `first` },
  { direction: `desc`, nulls: `last` },
] as const

describe(`ordering with nulls`, () => {
  test.each(cases)(
    `a limited window ordered $direction with nulls $nulls matches in-memory ordering`,
    async ({ direction, nulls }) => {
      const supabaseRows = createCollection(
        supabaseCollectionOptions({
          tableName: `items`,
          keys: [`id`],
          schema,
          supabase: createClient(SUPABASE_URL, SUPABASE_KEY, {
            global: { fetch: postgrestFetch() },
          }),
        }),
      )
      const localRows = createCollection(
        localOnlyCollectionOptions<Row>({
          id: `local-items-${direction}-${nulls}`,
          getKey: (row) => String(row.id),
          initialData: rows,
        }),
      )
      const window = async (collection: typeof localRows) =>
        (
          await queryResult((q) =>
            q
              .from({ item: collection })
              .orderBy(({ item }) => item.rank, { direction, nulls })
              .limit(2)
              .select(({ item }) => ({ id: item.id })),
          )
        ).map((row) => row.id)

      const expected = await window(localRows)
      const actual = await window(supabaseRows as unknown as typeof localRows)

      expect(actual).toEqual(expected)
      await supabaseRows.cleanup()
      await localRows.cleanup()
    },
  )
})
