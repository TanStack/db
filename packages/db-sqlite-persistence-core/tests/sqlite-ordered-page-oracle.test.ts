// @vitest-environment node
import { fc } from '@fast-check/vitest'
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
 * Model: `owedKeys` filters the stored rows with that equality, and
 * `pageInSql` decides the work law's premise from the request and the stored
 * values alone. Neither calls the evaluator, the comparator or the SQL
 * compiler. The order of rows comes from the request without `limit`, which
 * sorts in JavaScript whatever SQL returns; this oracle does not model the
 * comparator. An absent `stringSort` is lexical, as the in-memory sort reads
 * it.
 *
 * History grammar: up to twelve rows and one request. A row draws each field
 * from a token (`storedValue`), so a history stays JSON data and shrinks. The
 * order fields `rank` and `title` mostly hold integers, booleans, plain text,
 * null or nothing, and sometimes a value that breaks the work law's premise:
 * a Date, BigInt, NaN, fraction, object or text in `rank`; U+E000, an astral
 * character, a lone surrogate, U+FFFD or NUL in `title`. The filter field
 * `status` stores every kind of value that SQLite compares with the number 1:
 * 1, a Date of epoch 1, `1n`, `true`, `'1'` and the epoch's ISO text, and a
 * Date at the latest valid epoch, 8.64e15, which a literal of that epoch and
 * of the next integer test from both sides. A key is `k`, an optional U+E000
 * or astral character, and the row's index, so two high keys differ first at
 * that character.
 *
 * The request draws zero to two leaves over five fields: `eq` in either
 * operand order, `in` with zero to three literals, a range, or the constant
 * `true`. They form the `where` without an `and` (no `where` for no leaf),
 * always under one `and` (`and()` for no leaf), or with the first leaf in a
 * nested `and`; the law reads an empty conjunction as an absent `where`. It
 * draws one or two order terms over `rank`, `title`, the unindexed `due` or
 * the constant 1, each direction, null placement and string sort (default,
 * lexical, locale, or a custom reverse comparator), a limit of 0..8 or one
 * million, and no offset or one of 0..8.
 *
 * Declared states: `page in SQL` when the work law's premise holds, `page in
 * memory` otherwise. Four constructed histories splice the premise into a
 * generated history: they move the order onto `rank` or `title`, replace
 * premise-breaking values and keys with plain ones, and make each leaf exact,
 * keeping the generated rows, ties, nulls, directions, `where` shape, limit
 * and offset; the third also adds an exact leaf, and the fourth sets a zero
 * limit or a zero offset over at least two matching rows. Four constructed
 * histories then break the premise in one way each: one premise-breaking
 * order value, two tied rows with high keys, one inexact leaf (a range, a
 * fraction, the constant `true`, or a membership whose two kinds both match
 * stored values), or an order on `due` or the constant, or under a locale or
 * custom sort. Each builder records the states its history must enter, and
 * the check rejects a history that missed one, so generated and shrunk
 * constructions are judged as well as each campaign's seeded one. Fixed
 * histories keep the datasets that once rejected production mutants.
 * Excluded: cursors, joins, orders on a computed field such as
 * `lower(title)`, and stored values that another library wrote.
 *
 * Driver and checkpoint: the real adapter runs against `node:sqlite` with a
 * counting driver, which records the rows each Collection SELECT returns. It
 * stores the rows, ensures an expression index on `rank`, `title` and
 * `status`, then loads the request without `limit` and the page, and
 * observes each result's keys and raw rows at `loadSubset` return. A legal
 * request owes rows, so a load that rejects is observed as such and breaks
 * the filter law (unpaged) or the page law. The driver then records the
 * declared state the history entered.
 *
 * Calibration: trace mutants drop a Date match, ignore the offset, read every
 * match for a page, and omit the state of each constructed history. A driver
 * mutant pages the unpaged request's SQL read, candidates and SQL order
 * included. The page
 * law rejects it on an order field that mixes numbers and text, and on a
 * `where` whose candidates include BigInt, boolean and ISO-text values that
 * JavaScript removes.
 *
 * Limits: node:sqlite in one process; no native host, OPFS worker or
 * multi-process WAL. Fractions and integers past the signed 64-bit range stay
 * outside the work law's premise because their order would depend on how
 * SQLite rounds JSON reals, which this build cannot show. Raw rows are not
 * elapsed time.
 */

type Field = `rank` | `title` | `status` | `flag` | `n` | `due`
// `constant` orders by the literal 1, an expression that is not a field.
type OrderField = `rank` | `title` | `due` | `constant`
type FilterField = `rank` | `title` | `status` | `flag` | `n`
type KeyKind = `plain` | `private use` | `astral`
// An integer stands for itself; a string names a stored value (`storedValue`).
type Token = number | string

type Row = {
  key: KeyKind
  rank: Token
  title: string
  status: Token
  flag: Token
  n: number
  due: Token
}
// `true` is the constant leaf `true`, which keeps every row.
type Leaf =
  | { op: `eq`; field: FilterField; value: Token; reversed: boolean }
  | { op: `in`; field: FilterField; values: Array<Token> }
  | { op: `gt`; field: `n`; value: number }
  | { op: `true` }
// How the leaves form the `where`: `flat` passes no `where` for no leaf, the
// leaf itself for one, and their `and` for more; `and` always wraps them,
// `and()` included; `nested` wraps the first leaf in an inner `and`.
type WhereShape = `flat` | `and` | `nested`
type Order = {
  field: OrderField
  direction: `asc` | `desc`
  nulls: `first` | `last`
  stringSort: `default` | `lexical` | `locale` | `custom`
}
type History = {
  rows: Array<Row>
  where: Array<Leaf>
  whereShape: WhereShape
  orderBy: Array<Order>
  limit: number
  offset: number | `none`
}

// The stored value a token names. `missing` leaves the field out, and a
// string that names no value below is that text.
function storedValue(token: Token): unknown {
  if (typeof token === `number`) return token
  switch (token) {
    case `null`:
      return null
    case `true`:
      return true
    case `false`:
      return false
    case `date 1`:
      return new Date(1)
    case `date 2`:
      return new Date(2)
    case `date 8`:
      return new Date(8)
    case `bigint 1`:
      return 1n
    case `bigint 8`:
      return 8n
    case `nan`:
      return Number.NaN
    case `fraction`:
      return 1.5
    case `object`:
      return { at: 8 }
    case `text 1`:
      return `1`
    case `text 4`:
      return `4`
    case `date max`:
      return new Date(8.64e15)
    case `max epoch`:
      return 8.64e15
    case `past max epoch`:
      return 8.64e15 + 1
    case `iso 1`:
      return new Date(1).toISOString()
    default:
      return token
  }
}

const plainTitles = [`a`, `ab`, `b`, `B`, `c`, `d`, `e`, `f`]
// Text that SQLite stores or orders differently from JavaScript. SQLite may
// read a stored lone surrogate as U+FFFD, the replacement character itself.
const irregularTitles = [
  `\uE000`,
  `\u{1F600}`,
  `\uD800`,
  `\uFFFD`,
  `b\u0000\uE000`,
]
const irregularRanks = [
  `date 8`,
  `bigint 8`,
  `nan`,
  `fraction`,
  `object`,
  `text 4`,
  `x`,
]
const statusTokens = [
  1,
  2,
  0,
  `date 1`,
  `date 2`,
  `bigint 1`,
  `true`,
  `text 1`,
  `iso 1`,
  `date max`,
  `null`,
  `missing`,
]
const highKeyCharacters: Record<KeyKind, string> = {
  plain: ``,
  'private use': `\uE000`,
  astral: `\u{1F600}`,
}

const rowArbitrary: fc.Arbitrary<Row> = fc.record({
  key: fc.oneof(
    { weight: 5, arbitrary: fc.constant<KeyKind>(`plain`) },
    { weight: 1, arbitrary: fc.constantFrom<KeyKind>(`private use`, `astral`) },
  ),
  rank: fc.oneof(
    { weight: 6, arbitrary: fc.integer({ min: -2, max: 9 }) },
    {
      weight: 2,
      arbitrary: fc.constantFrom<Token>(`null`, `missing`, `true`, `false`),
    },
    { weight: 1, arbitrary: fc.constantFrom<Token>(...irregularRanks) },
  ),
  title: fc.oneof(
    { weight: 6, arbitrary: fc.constantFrom(...plainTitles) },
    { weight: 2, arbitrary: fc.constantFrom(`null`, `missing`) },
    { weight: 1, arbitrary: fc.constantFrom(...irregularTitles) },
  ),
  status: fc.constantFrom<Token>(...statusTokens),
  flag: fc.constantFrom<Token>(`true`, `false`, 1, `missing`),
  n: fc.integer({ min: 0, max: 10 }),
  due: fc.oneof(fc.integer({ min: 0, max: 5 }), fc.constant(`missing`)),
})

const filterFieldArbitrary = fc.constantFrom<FilterField>(
  `status`,
  `title`,
  `rank`,
  `flag`,
  `n`,
)
const literalArbitrary: fc.Arbitrary<Token> = fc.oneof(
  fc.integer({ min: -1, max: 9 }),
  fc.constantFrom<Token>(
    `a`,
    `b`,
    `B`,
    `\uD800`,
    `true`,
    `false`,
    `bigint 1`,
    `fraction`,
    `text 1`,
    `max epoch`,
    `past max epoch`,
  ),
)
const leafArbitrary: fc.Arbitrary<Leaf> = fc.oneof(
  fc.record({
    op: fc.constant(`eq` as const),
    field: filterFieldArbitrary,
    value: literalArbitrary,
    reversed: fc.boolean(),
  }),
  fc.record({
    op: fc.constant(`in` as const),
    field: filterFieldArbitrary,
    values: fc.array(literalArbitrary, { maxLength: 3 }),
  }),
  fc.record({
    op: fc.constant(`gt` as const),
    field: fc.constant(`n` as const),
    value: fc.integer({ min: 0, max: 9 }),
  }),
  fc.record({ op: fc.constant(`true` as const) }),
)
const orderArbitrary: fc.Arbitrary<Order> = fc.record({
  field: fc.constantFrom<OrderField>(`rank`, `title`, `due`, `constant`),
  direction: fc.constantFrom(`asc` as const, `desc` as const),
  nulls: fc.constantFrom(`first` as const, `last` as const),
  stringSort: fc.constantFrom(
    `default` as const,
    `lexical` as const,
    `locale` as const,
    `custom` as const,
  ),
})
const maxRows = 12
const maxLeaves = 2
const historyArbitrary: fc.Arbitrary<History> = fc.record({
  rows: fc.array(rowArbitrary, { maxLength: maxRows }),
  where: fc.array(leafArbitrary, { maxLength: maxLeaves }),
  whereShape: fc.constantFrom<WhereShape>(`flat`, `and`, `nested`),
  orderBy: fc.uniqueArray(orderArbitrary, {
    minLength: 1,
    maxLength: 2,
    selector: (order) => order.field,
  }),
  limit: fc.oneof(fc.integer({ min: 0, max: 8 }), fc.constant(1_000_000)),
  offset: fc.oneof(
    fc.constant(`none` as const),
    fc.integer({ min: 0, max: 8 }),
  ),
})

type StoredRow = { key: string; value: Partial<Record<Field, unknown>> }
type ResolvedLeaf =
  | { op: `eq`; field: FilterField; value: unknown; reversed: boolean }
  | { op: `in`; field: FilterField; values: Array<unknown> }
  | { op: `gt`; field: `n`; value: number }
  | { op: `true` }
type Request = {
  where: Array<ResolvedLeaf>
  whereShape: WhereShape
  orderBy: Array<Order>
  limit: number
  offset?: number
}
const states = [`page in SQL`, `page in memory`] as const
type State = (typeof states)[number]
type Plan = {
  rows: Array<StoredRow>
  request: Request
  // The states a constructed history must enter; none for a generated one.
  requiredStates: ReadonlyArray<State>
}

// Construction obligations, by the identity of each builder's fresh history.
const constructionStates = new WeakMap<History, ReadonlyArray<State>>()

const fields: ReadonlyArray<Field> = [
  `rank`,
  `title`,
  `status`,
  `flag`,
  `n`,
  `due`,
]

function resolveLeaf(leaf: Leaf): ResolvedLeaf {
  switch (leaf.op) {
    case `eq`:
      return { ...leaf, value: storedValue(leaf.value) }
    case `in`:
      return { ...leaf, values: leaf.values.map(storedValue) }
    case `gt`:
    case `true`:
      return leaf
  }
}

function resolve(history: History): Plan {
  return {
    rows: history.rows.map((row, index) => {
      const value: Partial<Record<Field, unknown>> = {}
      for (const field of fields)
        if (row[field] !== `missing`) value[field] = storedValue(row[field])
      return {
        key: `k${highKeyCharacters[row.key]}${String(index).padStart(2, `0`)}`,
        value,
      }
    }),
    request: {
      where: history.where.map(resolveLeaf),
      whereShape: history.whereShape,
      orderBy: history.orderBy,
      limit: history.limit,
      ...(history.offset === `none` ? {} : { offset: history.offset }),
    },
    requiredStates: constructionStates.get(history) ?? [],
  }
}

// The model's equality: a Date equals its epoch milliseconds, anything else
// only an identical value. Null and missing match nothing.
function equalsLiteral(value: unknown, literal: unknown): boolean {
  if (value instanceof Date)
    return typeof literal === `number` && value.getTime() === literal
  return value === literal
}

function keepsRow(row: StoredRow, leaf: ResolvedLeaf): boolean {
  if (leaf.op === `true`) return true
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

function exactLeaf(leaf: ResolvedLeaf): boolean {
  if (leaf.op === `gt` || leaf.op === `true`) return false
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

const indexedFields: ReadonlyArray<Field> = [`rank`, `title`, `status`]

function sortsPlainly(rows: Array<StoredRow>, order: Order): boolean {
  const { field } = order
  if (field === `constant` || !indexedFields.includes(field)) return false
  const values = rows
    .map((row) => row.value[field])
    .filter((value) => value != null)
  const numeric = values.every(
    (value) => Number.isSafeInteger(value) || typeof value === `boolean`,
  )
  const text = values.every(
    (value) => typeof value === `string` && plainText(value),
  )
  const lexical =
    order.stringSort === `default` || order.stringSort === `lexical`
  return numeric || (text && lexical)
}

// The work law's premise, from the request and the stored values alone.
function pageInSql(plan: Plan): boolean {
  return (
    plan.request.where.every(exactLeaf) &&
    plan.request.orderBy.every((order) => sortsPlainly(plan.rows, order)) &&
    plan.rows.every((row) => plainText(`s:${row.key}`))
  )
}

const stateOf = (plan: Plan): State =>
  pageInSql(plan) ? `page in SQL` : `page in memory`

function model(plan: Plan) {
  const keys = owedKeys(plan)
  const offset = plan.request.offset ?? 0
  return {
    keys,
    pageInSql: pageInSql(plan),
    pageRows: Math.max(0, Math.min(plan.request.limit, keys.length - offset)),
    requiredStates: plan.requiredStates,
  }
}
type Owed = ReturnType<typeof model>

// Constructions. Each keeps the generated rows, ties, nulls, directions,
// limit and offset, and returns a fresh history that it records with the
// state that history must enter.

const lexicalSort = (sort: Order[`stringSort`]): Order[`stringSort`] =>
  sort === `locale` || sort === `custom` ? `lexical` : sort

// Replaces every value and key that breaks the work law's premise, moves the
// order onto the indexed fields with `lead` first, and makes each leaf exact.
function withPlainPremise(generated: History, lead: `rank` | `title`): History {
  const [first, second] = generated.orderBy
  const other: OrderField = lead === `rank` ? `title` : `rank`
  return {
    rows: generated.rows.map((row) => ({
      ...row,
      key: `plain` as const,
      rank: irregularRanks.includes(String(row.rank)) ? row.n % 10 : row.rank,
      title: irregularTitles.includes(row.title)
        ? plainTitles[row.n % plainTitles.length]!
        : row.title,
    })),
    where: generated.where.map(exactly),
    whereShape: generated.whereShape,
    orderBy: [
      { ...first!, field: lead, stringSort: lexicalSort(first!.stringSort) },
      ...(second
        ? [
            {
              ...second,
              field: other,
              stringSort: lexicalSort(second.stringSort),
            },
          ]
        : []),
    ],
    limit: generated.limit,
    offset: generated.offset,
  }
}

// An exact leaf on the same field: a range becomes an equality, and a
// literal list of mixed or inexact kinds keeps its integers.
function exactly(leaf: Leaf): Leaf {
  if (exactLeaf(resolveLeaf(leaf))) return leaf
  switch (leaf.op) {
    case `gt`:
      return { op: `eq`, field: leaf.field, value: leaf.value, reversed: false }
    case `true`:
      return { op: `eq`, field: `status`, value: 1, reversed: false }
    case `eq`:
      return { ...leaf, value: 1 }
    case `in`: {
      const integers = leaf.values.filter((value) => typeof value === `number`)
      return { ...leaf, values: integers.length > 0 ? integers : [1] }
    }
  }
}

const leadOf = (generated: History) =>
  generated.orderBy[0]!.field === `title` ? `title` : `rank`

const fallbackRow: Row = {
  key: `plain`,
  rank: 4,
  title: `c`,
  status: 1,
  flag: `true`,
  n: 4,
  due: 1,
}

function withRows(history: History, count: number): History {
  const rows = [...history.rows]
  while (rows.length < count) rows.push({ ...fallbackRow, n: rows.length })
  return { ...history, rows }
}

function constructed(
  name: string,
  state: State,
  build: (generated: History) => History,
) {
  return {
    name,
    enters: [state],
    build: (generated: History) => {
      const history = build(generated)
      constructionStates.set(history, [state])
      return history
    },
  }
}

const constructions = [
  constructed(`page in SQL by rank`, `page in SQL`, (generated) =>
    withPlainPremise(generated, `rank`),
  ),
  constructed(`page in SQL by title`, `page in SQL`, (generated) =>
    withPlainPremise(generated, `title`),
  ),
  constructed(
    `page in SQL under an exact where`,
    `page in SQL`,
    (generated) => {
      const history = withPlainPremise(generated, leadOf(generated))
      const added: Leaf = {
        op: `eq`,
        field: `status`,
        value: 1 + (generated.limit % 2),
        reversed: generated.rows.length % 2 === 1,
      }
      return {
        ...history,
        where: [added, ...history.where].slice(0, maxLeaves),
      }
    },
  ),
  constructed(
    `page in SQL at a zero limit or offset`,
    `page in SQL`,
    (generated) => {
      // At least two rows match, so the page holds fewer rows than a read of
      // every match returns.
      const history = withRows(
        { ...withPlainPremise(generated, leadOf(generated)), where: [] },
        2,
      )
      return generated.limit % 2 === 0
        ? { ...history, limit: 0 }
        : { ...history, limit: 1, offset: 0 }
    },
  ),
  constructed(
    `page in memory for one irregular order value`,
    `page in memory`,
    (generated) => {
      const lead = leadOf(generated)
      const history = withRows(withPlainPremise(generated, lead), 1)
      const at = generated.limit % history.rows.length
      const row = history.rows[at]!
      // Text breaks a numeric field only beside a number, so a field that
      // holds no number gets an object instead.
      const holdsNumber = history.rows.some(
        (other, index) => index !== at && typeof other.rank === `number`,
      )
      const rank = irregularRanks[row.n % irregularRanks.length]!
      const changed: Row =
        lead === `rank`
          ? {
              ...row,
              rank:
                holdsNumber || (rank !== `text 4` && rank !== `x`)
                  ? rank
                  : `object`,
            }
          : { ...row, title: irregularTitles[row.n % irregularTitles.length]! }
      return {
        ...history,
        rows: history.rows.map((other, index) =>
          index === at ? changed : other,
        ),
      }
    },
  ),
  constructed(
    `page in memory for two tied rows with high keys`,
    `page in memory`,
    (generated) => {
      const history = withRows(
        withPlainPremise(generated, leadOf(generated)),
        2,
      )
      const [first, second] = history.rows
      const keys: Array<KeyKind> =
        generated.limit % 2 === 0
          ? [`private use`, `astral`]
          : [`astral`, `private use`]
      return {
        ...history,
        rows: history.rows.map((row, index) =>
          index === 0
            ? { ...first!, key: keys[0]! }
            : index === 1
              ? {
                  ...second!,
                  key: keys[1]!,
                  rank: first!.rank,
                  title: first!.title,
                }
              : row,
        ),
      }
    },
  ),
  constructed(
    `page in memory for one inexact leaf`,
    `page in memory`,
    (generated) => {
      const history = withPlainPremise(generated, leadOf(generated))
      // Each mixed membership matches stored values of both its kinds.
      const inexact: Array<Leaf> = [
        { op: `gt`, field: `n`, value: generated.limit % 9 },
        { op: `in`, field: `status`, values: [1, `text 1`] },
        { op: `in`, field: `flag`, values: [`true`, 1] },
        { op: `eq`, field: `rank`, value: `fraction`, reversed: false },
        { op: `true` },
      ]
      return {
        ...history,
        where: [
          ...history.where.slice(0, maxLeaves - 1),
          inexact[generated.rows.length % inexact.length]!,
        ],
      }
    },
  ),
  constructed(
    `page in memory for an unindexed or non-lexical order`,
    `page in memory`,
    (generated) => {
      const history = withRows(withPlainPremise(generated, `title`), 1)
      const [first, ...rest] = history.orderBy
      const choice = generated.limit % 4
      // A non-lexical sort breaks the premise only on a field with text.
      const rows = history.rows.map((row, index) =>
        index === 0 && (row.title === `null` || row.title === `missing`)
          ? { ...row, title: `a` }
          : row,
      )
      return {
        ...history,
        rows,
        orderBy:
          choice === 0 || choice === 3
            ? [{ ...first!, field: choice === 0 ? `due` : `constant` }, ...rest]
            : [
                {
                  ...first!,
                  stringSort: choice === 1 ? `locale` : `custom`,
                },
                ...rest,
              ],
      }
    },
  ),
]

// Fixed histories: the datasets that rejected the production mutants named in
// the coverage map, as members of the grammar.
const plainRows: Array<Row> = (
  [
    [5, `b`, 1, `true`, 1, 3],
    [3, `a`, `date 1`, `true`, 2, `missing`],
    [9, `c`, `bigint 1`, `false`, 3, 1],
    [9, `b`, `true`, 1, 0, `missing`],
    [`null`, `d`, `text 1`, `missing`, 4, 2],
    [`missing`, `a`, `iso 1`, `missing`, 5, `missing`],
    [1, `null`, 2, `true`, 6, `missing`],
    [7, `missing`, 1, `true`, 7, 5],
    [3, `e`, `date 2`, `false`, 8, `missing`],
    [0, `c`, 1, `true`, 9, 4],
    [7, `f`, 0, `missing`, 10, `missing`],
    [2, `B`, 1, `false`, 0, `missing`],
  ] as const
).map(([rank, title, status, flag, n, due]) => ({
  key: `plain`,
  rank,
  title,
  status,
  flag,
  n,
  due,
}))

function withRow(rows: Array<Row>, index: number, change: Partial<Row>) {
  return rows.map((row, at) => (at === index ? { ...row, ...change } : row))
}

const order = (
  field: OrderField,
  direction: Order[`direction`],
  stringSort: Order[`stringSort`] = `default`,
): Order => ({ field, direction, nulls: `first`, stringSort })

const fixed: Array<{ name: string; history: History }> = [
  {
    name: `plain rows by rank descending, nulls first`,
    history: {
      rows: plainRows,
      where: [],
      whereShape: `flat`,
      orderBy: [order(`rank`, `desc`)],
      limit: 3,
      offset: `none`,
    },
  },
  {
    name: `plain rows by rank descending after an offset`,
    history: {
      rows: plainRows,
      where: [],
      whereShape: `flat`,
      orderBy: [order(`rank`, `desc`)],
      limit: 4,
      offset: 2,
    },
  },
  {
    name: `status equals 1 beside coerced values`,
    history: {
      rows: plainRows,
      where: [{ op: `eq`, field: `status`, value: 1, reversed: false }],
      whereShape: `flat`,
      orderBy: [order(`rank`, `desc`)],
      limit: 2,
      offset: `none`,
    },
  },
  {
    name: `status is 1 or the text 1`,
    history: {
      rows: plainRows,
      where: [{ op: `in`, field: `status`, values: [1, `text 1`] }],
      whereShape: `flat`,
      orderBy: [order(`rank`, `asc`)],
      limit: 1_000_000,
      offset: `none`,
    },
  },
  {
    name: `title is a or a lone surrogate beside the replacement character`,
    history: {
      rows: withRow(withRow(plainRows, 3, { title: `\uD800` }), 5, {
        title: `\uFFFD`,
      }),
      where: [{ op: `in`, field: `title`, values: [`a`, `\uD800`] }],
      whereShape: `flat`,
      orderBy: [order(`rank`, `asc`)],
      limit: 1_000_000,
      offset: `none`,
    },
  },
  {
    name: `status holds a Date at the latest epoch`,
    history: {
      rows: withRow(plainRows, 4, { status: `date max` }),
      where: [{ op: `in`, field: `status`, values: [`max epoch`, 1] }],
      whereShape: `flat`,
      orderBy: [order(`rank`, `desc`)],
      limit: 1_000_000,
      offset: `none`,
    },
  },
  {
    // Locale order puts `a` before `B`; code-unit order puts `B` first.
    name: `titles under a locale sort`,
    history: {
      rows: plainRows,
      where: [],
      whereShape: `flat`,
      orderBy: [{ ...order(`title`, `asc`, `locale`), nulls: `last` }],
      limit: 1,
      offset: `none`,
    },
  },
  {
    name: `titles under a custom reverse sort`,
    history: {
      rows: plainRows,
      where: [],
      whereShape: `flat`,
      orderBy: [{ ...order(`title`, `asc`, `custom`), nulls: `last` }],
      limit: 3,
      offset: `none`,
    },
  },
  {
    name: `plain rows at offset 0`,
    history: {
      rows: plainRows,
      where: [],
      whereShape: `flat`,
      orderBy: [order(`rank`, `asc`)],
      limit: 2,
      offset: 0,
    },
  },
  {
    name: `rank mixes numbers and text`,
    history: {
      rows: withRow(withRow(plainRows, 7, { rank: `text 4` }), 10, {
        rank: `x`,
      }),
      where: [],
      whereShape: `flat`,
      orderBy: [order(`rank`, `desc`)],
      limit: 3,
      offset: `none`,
    },
  },
  {
    name: `rank holds NaN`,
    history: {
      rows: withRow(plainRows, 7, { rank: `nan` }),
      where: [],
      whereShape: `flat`,
      orderBy: [order(`rank`, `asc`)],
      limit: 3,
      offset: `none`,
    },
  },
  {
    name: `title holds private-use and astral text`,
    history: {
      rows: withRow(withRow(plainRows, 2, { title: `\uE000` }), 10, {
        title: `\u{1F600}`,
      }),
      where: [],
      whereShape: `flat`,
      orderBy: [order(`title`, `desc`, `lexical`)],
      limit: 1,
      offset: `none`,
    },
  },
  {
    name: `two rows tied on rank have high keys`,
    history: {
      rows: withRow(withRow(plainRows, 2, { key: `private use` }), 3, {
        key: `astral`,
      }),
      where: [],
      whereShape: `flat`,
      orderBy: [order(`rank`, `desc`)],
      limit: 1,
      offset: `none`,
    },
  },
]

function whereOf(request: Request): IR.BasicExpression<boolean> | undefined {
  const leaves = request.where.map((leaf): IR.BasicExpression<boolean> => {
    if (leaf.op === `true`) return new IR.Value(true)
    const field = new IR.PropRef([leaf.field])
    switch (leaf.op) {
      case `in`:
        return new IR.Func<boolean>(`in`, [field, new IR.Value(leaf.values)])
      case `eq`:
        return new IR.Func<boolean>(
          `eq`,
          leaf.reversed
            ? [new IR.Value(leaf.value), field]
            : [field, new IR.Value(leaf.value)],
        )
      case `gt`:
        return new IR.Func<boolean>(`gt`, [field, new IR.Value(leaf.value)])
    }
  })
  switch (request.whereShape) {
    case `flat`:
      if (leaves.length === 0) return undefined
      return leaves.length === 1 ? leaves[0] : new IR.Func(`and`, leaves)
    case `and`:
      return new IR.Func(`and`, leaves)
    case `nested`:
      return new IR.Func(`and`, [
        new IR.Func(`and`, leaves.slice(0, 1)),
        ...leaves.slice(1),
      ])
  }
}

// A custom comparator that reverses code-unit order, so SQL's text order
// cannot stand in for it.
const reverseCodeUnits = (left: string, right: string) =>
  left < right ? 1 : left > right ? -1 : 0

function orderByOf(request: Request): IR.OrderBy {
  return request.orderBy.map((term) => ({
    expression:
      term.field === `constant`
        ? new IR.Value(1)
        : new IR.PropRef([term.field]),
    compareOptions: {
      direction: term.direction,
      nulls: term.nulls,
      ...(term.stringSort === `custom`
        ? { stringSort: `custom` as const, compare: reverseCodeUnits }
        : term.stringSort === `default`
          ? {}
          : { stringSort: term.stringSort }),
    },
  }))
}

// `rejected` holds the message of a load that rejected instead of returning.
type Read = { keys: Array<string>; rawRows: number; rejected?: string }

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

    // A legal request owes rows, so a rejection is an observation the laws
    // judge, not a setup error.
    const load = async (paged: boolean): Promise<Read> => {
      driver.reads = []
      let rows
      try {
        rows = await adapter.loadSubset(target, {
          where: whereOf(plan.request),
          orderBy: orderByOf(plan.request),
          ...(paged
            ? { limit: plan.request.limit, offset: plan.request.offset }
            : {}),
        })
      } catch (error) {
        return {
          keys: [],
          rawRows: 0,
          rejected: error instanceof Error ? error.message : String(error),
        }
      }
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
    // The declared state is the premise of the history, not a production
    // decision: production's paging is what the work law judges.
    observe(`reach`, stateOf(plan))
  } finally {
    driver.db.close()
  }
}

// Filter first: a wrong filter also moves the page. Then the page against the
// unpaged order, then the raw rows the page read, then the construction's
// states, which only a complete trace can show.
function check(plan: Plan, trace: ReadonlyArray<Observation>, owed: Owed) {
  const unpaged = trace.find(({ checkpoint }) => checkpoint === `unpaged`)
    ?.value as Read | undefined
  const page = trace.find(({ checkpoint }) => checkpoint === `page`)?.value as
    Read | undefined
  if (!unpaged || !page)
    return violation(`page`, `the driver recorded no page`, `trace`)
  if (unpaged.rejected !== undefined)
    return violation(
      `unpaged`,
      `the unpaged request rejected: ${unpaged.rejected}`,
      `filter`,
    )
  if (page.rejected !== undefined)
    return violation(`page`, `the page rejected: ${page.rejected}`, `page`)
  const offset = plan.request.offset ?? 0
  const reached = new Set(
    trace
      .filter(({ checkpoint }) => checkpoint === `reach`)
      .map(({ value }) => value),
  )
  const missing = owed.requiredStates.filter((state) => !reached.has(state))
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
    (missing.length > 0
      ? violation(
          `constructed states`,
          `the constructed history did not enter ${missing.join(`, `)}`,
          `constructed reach`,
        )
      : pass)
  )
}

const withKeys = (entry: Observation, keep: (key: string) => boolean) => ({
  ...entry,
  value: {
    ...(entry.value as Read),
    keys: (entry.value as Read).keys.filter(keep),
  },
})

oracleProperty({
  id: `sqlite-persistence.ordered-page`,
  law: {
    statement: `At loadSubset return, an ordered page holds exactly the unpaged request's rows at its offset, in order; the unpaged request keeps exactly the rows whose fields equal the literals (a Date equals its epoch milliseconds); and when the where is a conjunction of exact equality or membership leaves and every order field is indexed and holds only integers and booleans, or only text below U+D800 sorted lexically, with keys of that text, SQLite returns no more stored rows than the page holds.`,
    authority: `The SQLite adapter's contract that the JavaScript evaluator and in-memory sort decide loadSubset results with SQL as a candidate read (PR #1997); the accepted goal that a paged live query reads its page, not every matching row.`,
    limits: `Up to twelve rows and one request per history on node:sqlite in one process; no cursors, joins, orders on a computed field, native hosts or OPFS. The comparator is not modeled: order comes from the unpaged request.`,
  },
  owns: [`src/sqlite-core-adapter.ts`],
  histories: {
    arbitrary: historyArbitrary,
    runs: 100,
    fixedSeeds: [1116],
    states: [...states],
    constructed: constructions,
    fixed,
  },
  resolve,
  model,
  driver: (plan, observe) => drive(plan, observe),
  check,
  calibrations: [
    {
      name: `a Date match is dropped`,
      law: `filter`,
      history: { fixed: `status equals 1 beside coerced values` },
      corrupt: (trace, plan) => {
        const dates = new Set(
          plan.rows
            .filter((row) => row.value.status instanceof Date)
            .map((row) => row.key),
        )
        return trace.map((entry) =>
          entry.checkpoint === `unpaged`
            ? withKeys(entry, (key) => !dates.has(key))
            : entry,
        )
      },
    },
    {
      name: `the page ignores its offset`,
      law: `page`,
      history: { fixed: `plain rows by rank descending after an offset` },
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
      history: { fixed: `status equals 1 beside coerced values` },
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
      history: { fixed: `rank mixes numbers and text` },
      driver: (plan, observe) => drive(plan, observe, true),
    },
    {
      name: `SQL pages a candidate that admits coerced values`,
      law: `page`,
      history: { fixed: `status equals 1 beside coerced values` },
      driver: (plan, observe) => drive(plan, observe, true),
    },
    // One missing-state control per builder: each construction's check must
    // reject a trace that lost the state it names.
    ...constructions.map(({ name, enters }) => ({
      name: `${name} omits its state`,
      law: `constructed reach`,
      history: { constructed: name },
      corrupt: (trace: ReadonlyArray<Observation>) =>
        trace.filter(
          ({ checkpoint, value }) =>
            checkpoint !== `reach` || !enters.includes(value as State),
        ),
    })),
  ],
})
