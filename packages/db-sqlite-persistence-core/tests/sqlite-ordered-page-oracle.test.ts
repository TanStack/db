// @vitest-environment node
import { IR } from '@tanstack/db'
import { SQLiteCorePersistenceAdapter } from '../src'
import {
  differs,
  oracleProperty,
  pass,
  violation,
} from '../../db/tests/oracle-property.js'
import { CountingDriver } from './sqlite-boolean-arity-support'
import type { Observation } from '../../db/tests/oracle-property.js'

/**
 * # Does an ordered page read only its page from SQLite?
 *
 * Authority: the SQLite adapter's contract that its JavaScript row evaluator
 * and in-memory sort decide `loadSubset` results, with SQL as a candidate
 * read (PR #1997). The work law comes from an accepted persistence goal: a
 * paged live query reads its page, not every matching row. A LinearLite
 * benchmark read all 100,000 stored rows to show 50.
 *
 * Page law: at `loadSubset` return, a request with `orderBy`, `limit` and
 * `offset` returns exactly the rows at those positions of the same request
 * without `limit` and `offset`, in the same order.
 *
 * Filter law: the request without `limit` returns exactly the rows that the
 * model's equality keeps. A Date equals the number of its epoch milliseconds
 * and every other value equals only an identical value, so `1n`, `true`,
 * `'1'` and the epoch's ISO text never equal the number 1.
 *
 * Work law: SQLite returns no more stored rows than the page holds when
 * - the `where` is absent or a conjunction of `eq` and `in` leaves on one
 *   field each, whose literals are all strings with UTF-16 code units in
 *   1..0xD7FF, all BigInts, or all safe-integer numbers, or an `eq` with a
 *   boolean;
 * - every `orderBy` field has an ensured expression index;
 * - every stored value of those fields is null, missing, a safe integer or a
 *   boolean, or else every one is null, missing or a string whose UTF-16 code
 *   units are all in 1..0xD7FF, sorted lexically; and
 * - every key is such a string.
 * Other requests may read every matching row. The page and filter laws hold
 * for every request.
 *
 * Model: `owedKeys` filters the dataset with that equality, and `pageInSql`
 * decides the work law's premise from the stored values alone. Neither calls
 * the evaluator, the comparator or the SQL compiler. The order of rows comes
 * from the request without `limit`, which sorts in JavaScript whatever SQL
 * returns; this oracle does not model the comparator.
 *
 * Histories: every query below runs on every dataset (`enumerated` below).
 * The plain dataset meets the work law's premise for its order fields and
 * stores Date, BigInt, boolean, numeric-text and ISO-text values beside the
 * number 1 in its filter field. Each other dataset breaks the premise once:
 * a Date, BigInt, NaN, fraction, object or numeric text in the order field
 * `rank`; U+E000, an astral character, a lone surrogate or NUL in the text
 * order field `title`; or such characters in two keys tied on `rank`. Queries
 * cover ascending and descending order, both null placements, an offset, two
 * order fields, the last text in lexical order, locale string sort, an
 * unindexed order field, number and string equality, number membership, a
 * conjunction with a boolean, a range filter, and the equality on the order
 * field that follows a page. Excluded: cursors, joins, expression order
 * fields, and stored values written by another library.
 *
 * Driver and checkpoint: the real adapter runs against `node:sqlite` with a
 * counting driver, which records the rows each Collection SELECT returns. It
 * stores the dataset, ensures an expression index on `rank`, `title` and
 * `status`, then loads the request without `limit` and the page, and
 * observes each result's keys and raw rows at `loadSubset` return.
 *
 * Calibration: trace mutants drop a Date match, ignore the offset, and read
 * every match for a page. A driver mutant pages the unpaged request's SQL
 * read, candidates and SQL order included. The page law rejects it on an
 * order field that mixes numbers and text, and on a `where` whose candidates
 * include BigInt, boolean and ISO-text values that JavaScript removes.
 *
 * Limits: node:sqlite in one process; no native host, OPFS worker or
 * multi-process WAL. Fractions and integers past the signed 64-bit range stay
 * outside the work law's premise because their order would depend on how
 * SQLite rounds JSON reals, which this build cannot show. Raw rows are not
 * elapsed time.
 */

type Field = `rank` | `title` | `status` | `flag` | `n` | `due`
type StoredRow = { key: string; value: Partial<Record<Field, unknown>> }

// The default rows: ranks with ties and nulls, plain titles, and every kind
// of value that SQLite compares with the number 1 in `status`.
function plainRows(): Array<StoredRow> {
  const rows: Array<[string, Partial<Record<Field, unknown>>]> = [
    [`k01`, { rank: 5, title: `b`, status: 1, flag: true, n: 1, due: 3 }],
    [`k02`, { rank: 3, title: `a`, status: new Date(1), flag: true, n: 2 }],
    [`k03`, { rank: 9, title: `c`, status: 1n, flag: false, n: 3, due: 1 }],
    [`k04`, { rank: 9, title: `b`, status: true, flag: 1, n: 0 }],
    [`k05`, { rank: null, title: `d`, status: `1`, n: 4, due: 2 }],
    [`k06`, { title: `a`, status: new Date(1).toISOString(), n: 5 }],
    [`k07`, { rank: 1, title: null, status: 2, flag: true, n: 6 }],
    [`k08`, { rank: 7, status: 1, flag: true, n: 7, due: 5 }],
    [`k09`, { rank: 3, title: `e`, status: new Date(2), flag: false, n: 8 }],
    [`k10`, { rank: 0, title: `c`, status: 1, flag: true, n: 9, due: 4 }],
    [`k11`, { rank: 7, title: `f`, status: 0, n: 10 }],
    [`k12`, { rank: 2, title: `B`, status: 1, flag: false, n: 0 }],
  ]
  return rows.map(([key, value]) => ({ key, value }))
}

function withValue(
  rows: Array<StoredRow>,
  key: string,
  field: Field,
  value: unknown,
): Array<StoredRow> {
  return rows.map((row) =>
    row.key === key ? { key, value: { ...row.value, [field]: value } } : row,
  )
}

function withKey(
  rows: Array<StoredRow>,
  key: string,
  replacement: string,
): Array<StoredRow> {
  return rows.map((row) =>
    row.key === key ? { key: replacement, value: row.value } : row,
  )
}

const datasets = {
  plain: () => plainRows(),
  'rank-booleans': () =>
    withValue(
      withValue(plainRows(), `k07`, `rank`, true),
      `k10`,
      `rank`,
      false,
    ),
  'rank-date': () => withValue(plainRows(), `k08`, `rank`, new Date(8)),
  'rank-bigint': () => withValue(plainRows(), `k08`, `rank`, 8n),
  'rank-nan': () => withValue(plainRows(), `k08`, `rank`, Number.NaN),
  'rank-fraction': () => withValue(plainRows(), `k08`, `rank`, 7.5),
  'rank-object': () => withValue(plainRows(), `k08`, `rank`, { at: 8 }),
  'rank-text': () =>
    withValue(withValue(plainRows(), `k08`, `rank`, `4`), `k11`, `rank`, `x`),
  'title-private-use': () =>
    withValue(
      withValue(plainRows(), `k03`, `title`, `\uE000`),
      `k11`,
      `title`,
      `\u{1F600}`,
    ),
  'title-lone-surrogate': () =>
    withValue(plainRows(), `k03`, `title`, `\uD800`),
  'title-nul': () => withValue(plainRows(), `k03`, `title`, `b\u0000\uE000`),
  // Both keys hold rank 9, so the key tie-break orders them.
  'key-high': () =>
    withKey(withKey(plainRows(), `k03`, `k\uE000`), `k04`, `k\u{1F600}`),
} satisfies Record<string, () => Array<StoredRow>>
type DatasetName = keyof typeof datasets

type Leaf =
  | { op: `eq`; field: Field; value: unknown }
  | { op: `in`; field: Field; values: Array<unknown> }
  | { op: `gt`; field: Field; value: number }
type Order = {
  field: Field
  direction: `asc` | `desc`
  nulls: `first` | `last`
  stringSort?: `lexical` | `locale`
}
type Query = {
  where: Array<Leaf>
  orderBy: Array<Order>
  limit: number
  offset?: number
}

const asc = (field: Field, nulls: `first` | `last` = `first`): Order => ({
  field,
  direction: `asc`,
  nulls,
})
const desc = (field: Field, nulls: `first` | `last` = `first`): Order => ({
  field,
  direction: `desc`,
  nulls,
})

const queries = {
  'rank-asc': { where: [], orderBy: [asc(`rank`)], limit: 3 },
  'rank-asc-nulls-last': {
    where: [],
    orderBy: [asc(`rank`, `last`)],
    limit: 3,
  },
  'rank-desc': { where: [], orderBy: [desc(`rank`)], limit: 3 },
  'rank-desc-nulls-last': {
    where: [],
    orderBy: [desc(`rank`, `last`)],
    limit: 3,
  },
  'rank-desc-offset': {
    where: [],
    orderBy: [desc(`rank`)],
    limit: 4,
    offset: 2,
  },
  'rank-then-title': {
    where: [],
    orderBy: [desc(`rank`), asc(`title`)],
    limit: 5,
  },
  'title-lexical': {
    where: [],
    orderBy: [{ ...asc(`title`), stringSort: `lexical` }],
    limit: 4,
  },
  'title-last': {
    where: [],
    orderBy: [{ ...desc(`title`), stringSort: `lexical` }],
    limit: 1,
  },
  'title-locale': {
    where: [],
    orderBy: [{ ...asc(`title`), stringSort: `locale` }],
    limit: 4,
  },
  'due-unindexed': { where: [], orderBy: [asc(`due`)], limit: 2 },
  'status-eq': {
    where: [{ op: `eq`, field: `status`, value: 1 }],
    orderBy: [desc(`rank`)],
    limit: 2,
  },
  'status-in-offset': {
    where: [{ op: `in`, field: `status`, values: [1, 2] }],
    orderBy: [asc(`rank`)],
    limit: 3,
    offset: 1,
  },
  'status-and-flag': {
    where: [
      { op: `eq`, field: `status`, value: 1 },
      { op: `eq`, field: `flag`, value: true },
    ],
    orderBy: [desc(`rank`, `last`)],
    limit: 2,
  },
  'title-eq': {
    where: [{ op: `eq`, field: `title`, value: `b` }],
    orderBy: [asc(`rank`)],
    limit: 1,
  },
  'n-range': {
    where: [{ op: `gt`, field: `n`, value: 2 }],
    orderBy: [asc(`rank`)],
    limit: 3,
  },
  'rank-boundary': {
    where: [{ op: `eq`, field: `rank`, value: 9 }],
    orderBy: [desc(`rank`)],
    limit: 1,
  },
} satisfies Record<string, Query>
type QueryName = keyof typeof queries

type History = { dataset: DatasetName; query: QueryName }
type Plan = History & { rows: Array<StoredRow>; request: Query }

const indexedFields: ReadonlyArray<Field> = [`rank`, `title`, `status`]

const enumerated: Array<History> = (
  Object.keys(datasets) as Array<DatasetName>
).flatMap((dataset) =>
  (Object.keys(queries) as Array<QueryName>).map((query) => ({
    dataset,
    query,
  })),
)

function resolve(history: History): Plan {
  return {
    ...history,
    rows: datasets[history.dataset](),
    request: queries[history.query],
  }
}

// The model's equality: a Date equals its epoch milliseconds, anything else
// only an identical value. Null and missing match nothing.
function equalsLiteral(value: unknown, literal: unknown): boolean {
  if (value instanceof Date)
    return typeof literal === `number` && value.getTime() === literal
  return value === literal
}

function keepsRow(row: StoredRow, leaf: Leaf): boolean {
  const value = row.value[leaf.field]
  switch (leaf.op) {
    case `eq`:
      return equalsLiteral(value, leaf.value)
    case `in`:
      return leaf.values.some((literal) => equalsLiteral(value, literal))
    case `gt`:
      return typeof value === `number` && value > leaf.value
  }
}

function owedKeys(plan: Plan): Array<string> {
  return plan.rows
    .filter((row) => plan.request.where.every((leaf) => keepsRow(row, leaf)))
    .map((row) => row.key)
    .sort()
}

const plainText = (text: string) =>
  [...text].every((char) => {
    const unit = char.charCodeAt(0)
    return char.length === 1 && unit > 0 && unit < 0xd800
  })

function exactLeaf(leaf: Leaf): boolean {
  if (leaf.op === `gt`) return false
  const literals = leaf.op === `eq` ? [leaf.value] : leaf.values
  const kinds = new Set(
    literals.map((literal) =>
      typeof literal === `string` && plainText(literal)
        ? `string`
        : typeof literal === `bigint`
          ? `bigint`
          : Number.isSafeInteger(literal)
            ? `number`
            : typeof literal === `boolean` && leaf.op === `eq`
              ? `boolean`
              : `other`,
    ),
  )
  return kinds.size === 1 && !kinds.has(`other`)
}

function sortsPlainly(rows: Array<StoredRow>, order: Order): boolean {
  if (!indexedFields.includes(order.field)) return false
  const values = rows
    .map((row) => row.value[order.field])
    .filter((value) => value != null)
  const numeric = values.every(
    (value) => Number.isSafeInteger(value) || typeof value === `boolean`,
  )
  const text = values.every(
    (value) => typeof value === `string` && plainText(value),
  )
  return numeric || (text && order.stringSort !== `locale`)
}

// The work law's premise, from the request and the stored values alone.
function pageInSql(plan: Plan): boolean {
  return (
    plan.request.where.every(exactLeaf) &&
    plan.request.orderBy.every((order) => sortsPlainly(plan.rows, order)) &&
    plan.rows.every((row) => plainText(`s:${row.key}`))
  )
}

function model(plan: Plan) {
  const keys = owedKeys(plan)
  const offset = plan.request.offset ?? 0
  return {
    keys,
    pageInSql: pageInSql(plan),
    pageRows: Math.max(0, Math.min(plan.request.limit, keys.length - offset)),
  }
}
type Owed = ReturnType<typeof model>

function whereOf(request: Query): IR.BasicExpression<boolean> | undefined {
  const leaves = request.where.map((leaf) => {
    const field = new IR.PropRef([leaf.field])
    return leaf.op === `in`
      ? new IR.Func<boolean>(`in`, [field, new IR.Value(leaf.values)])
      : new IR.Func<boolean>(leaf.op, [field, new IR.Value(leaf.value)])
  })
  if (leaves.length === 0) return undefined
  return leaves.length === 1 ? leaves[0] : new IR.Func(`and`, leaves)
}

function orderByOf(request: Query): IR.OrderBy {
  return request.orderBy.map((order) => ({
    expression: new IR.PropRef([order.field]),
    compareOptions: {
      direction: order.direction,
      nulls: order.nulls,
      ...(order.stringSort ? { stringSort: order.stringSort } : {}),
    },
  }))
}

type Read = { keys: Array<string>; rawRows: number }

// A wrong design for calibration: the page reruns the unpaged request's SQL
// read with LIMIT and OFFSET, so SQL pages its candidates and its own order.
class CandidatePagingDriver extends CountingDriver {
  page: { limit: number; offset: number } | undefined
  private unpaged: { sql: string; params: ReadonlyArray<unknown> } | undefined

  override query<T>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<ReadonlyArray<T>> {
    if (sql.startsWith(`SELECT key, value, metadata, row_version FROM`)) {
      if (!this.page) this.unpaged = { sql, params }
      else if (this.unpaged)
        return super.query<T>(`${this.unpaged.sql} LIMIT ? OFFSET ?`, [
          ...this.unpaged.params,
          this.page.limit,
          this.page.offset,
        ])
    }
    return super.query<T>(sql, params)
  }
}

async function drive(
  plan: Plan,
  observe: (checkpoint: string, value: unknown) => void,
  pageCandidates = false,
) {
  const driver = pageCandidates
    ? new CandidatePagingDriver()
    : new CountingDriver()
  try {
    const adapter = new SQLiteCorePersistenceAdapter({ driver })
    const target = { kind: `eager` as const, collectionId: `ordered-page` }
    await adapter.applyCommittedTx(target, {
      txId: `seed`,
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: plan.rows.map((row) => ({
        type: `insert` as const,
        key: row.key,
        value: row.value,
      })),
    })
    for (const field of indexedFields)
      await adapter.ensureIndex(target, field, {
        expressionSql: [JSON.stringify({ type: `ref`, path: [field] })],
      })

    const load = async (paged: boolean): Promise<Read> => {
      driver.reads = []
      const rows = await adapter.loadSubset(target, {
        where: whereOf(plan.request),
        orderBy: orderByOf(plan.request),
        ...(paged
          ? { limit: plan.request.limit, offset: plan.request.offset }
          : {}),
      })
      return {
        keys: rows.map((row) => String(row.key)),
        rawRows: driver.reads.reduce((sum, read) => sum + read.rawRows, 0),
      }
    }
    observe(`unpaged`, await load(false))
    if (driver instanceof CandidatePagingDriver)
      driver.page = {
        limit: plan.request.limit,
        offset: plan.request.offset ?? 0,
      }
    observe(`page`, await load(true))
  } finally {
    driver.db.close()
  }
}

// Filter first: a wrong filter also moves the page. Then the page against the
// unpaged order, then the raw rows the page read.
function check(plan: Plan, trace: ReadonlyArray<Observation>, owed: Owed) {
  const unpaged = trace.find(({ checkpoint }) => checkpoint === `unpaged`)
    ?.value as Read | undefined
  const page = trace.find(({ checkpoint }) => checkpoint === `page`)?.value as
    Read | undefined
  if (!unpaged || !page)
    return violation(`page`, `the driver recorded no page`, `trace`)
  const offset = plan.request.offset ?? 0
  return (
    differs(
      `unpaged`,
      `filter`,
      [...unpaged.keys].sort(),
      owed.keys,
      `the unpaged request kept other rows than the model's equality`,
    ) ??
    differs(
      `page`,
      `page`,
      page.keys,
      unpaged.keys.slice(offset, offset + plan.request.limit),
      `the page is not the unpaged order's rows at its offset`,
    ) ??
    (owed.pageInSql
      ? differs(
          `page`,
          `work`,
          page.rawRows,
          owed.pageRows,
          `SQLite returned more stored rows than the page holds`,
        )
      : undefined) ??
    pass
  )
}

const label = (history: History) => `${history.dataset}/${history.query}`

oracleProperty({
  id: `sqlite-persistence.ordered-page`,
  law: {
    statement: `At loadSubset return, an ordered page holds exactly the unpaged request's rows at its offset, in order; the unpaged request keeps exactly the rows whose fields equal the literals (a Date equals its epoch milliseconds); and when the where is a conjunction of exact equality or membership leaves and every order field is indexed and holds only integers and booleans, or only text below U+D800 sorted lexically, with keys of that text, SQLite returns no more stored rows than the page holds.`,
    authority: `The SQLite adapter's contract that the JavaScript evaluator and in-memory sort decide loadSubset results with SQL as a candidate read (PR #1997); the accepted goal that a paged live query reads its page, not every matching row.`,
    limits: `Twelve datasets of twelve rows and sixteen requests on node:sqlite in one process; no cursors, joins, expression order fields, native hosts or OPFS. The comparator is not modeled: order comes from the unpaged request.`,
  },
  owns: [`src/sqlite-core-adapter.ts`],
  histories: {
    enumerated,
    states: [`page in SQL`, `page in memory`],
  },
  label,
  resolve,
  model,
  reached: (_plan, _trace, owed) => [
    owed.pageInSql ? `page in SQL` : `page in memory`,
  ],
  driver: (plan, observe) => drive(plan, observe),
  check,
  calibrations: [
    {
      name: `a Date match is dropped`,
      law: `filter`,
      history: { enumerated: `plain/status-eq` },
      corrupt: (trace) =>
        trace.map((entry) =>
          entry.checkpoint === `unpaged`
            ? {
                ...entry,
                value: {
                  ...(entry.value as Read),
                  keys: (entry.value as Read).keys.filter(
                    (key) => key !== `k02`,
                  ),
                },
              }
            : entry,
        ),
    },
    {
      name: `the page ignores its offset`,
      law: `page`,
      history: { enumerated: `plain/rank-desc-offset` },
      corrupt: (trace, plan) =>
        trace.map((entry) =>
          entry.checkpoint === `page`
            ? {
                ...entry,
                value: {
                  ...(entry.value as Read),
                  keys: (
                    trace.find(({ checkpoint }) => checkpoint === `unpaged`)
                      ?.value as Read
                  ).keys.slice(0, plan.request.limit),
                },
              }
            : entry,
        ),
    },
    {
      name: `the page reads every match`,
      law: `work`,
      history: { enumerated: `plain/status-eq` },
      corrupt: (trace) =>
        trace.map((entry) =>
          entry.checkpoint === `page`
            ? {
                ...entry,
                value: {
                  ...(entry.value as Read),
                  rawRows: (
                    trace.find(({ checkpoint }) => checkpoint === `unpaged`)
                      ?.value as Read
                  ).rawRows,
                },
              }
            : entry,
        ),
    },
    {
      name: `SQL pages an order field that mixes numbers and text`,
      law: `page`,
      history: { enumerated: `rank-text/rank-desc` },
      driver: (plan, observe) => drive(plan, observe, true),
    },
    {
      name: `SQL pages a candidate that admits coerced values`,
      law: `page`,
      history: { enumerated: `plain/status-eq` },
      driver: (plan, observe) => drive(plan, observe, true),
    },
  ],
})
