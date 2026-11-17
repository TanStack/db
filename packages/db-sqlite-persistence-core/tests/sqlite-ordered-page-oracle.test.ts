// @vitest-environment node
import { fc } from '@fast-check/vitest'
import { IR, makeComparator } from '@tanstack/db'
import { Temporal } from 'temporal-polyfill'
import { vi } from 'vitest'
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
 * read (PR #1997), and TanStack DB's comparator, `makeComparator`, which
 * orders live-query results, so a page that disagrees with it shows other
 * rows. The work law comes from an accepted persistence goal: a paged live
 * query reads its page, not every matching row. A LinearLite benchmark read
 * all 100,000 stored rows to show 50.
 *
 * Page law: at `loadSubset` return, a request with `orderBy`, `limit` and
 * `offset` returns exactly the rows at those positions of the comparator's
 * order of the matching rows, ties broken by key, before and after later
 * writes. Where the comparator decides no single order, the page holds the
 * rows at those positions of the same request without `limit` and `offset`,
 * in the same order.
 *
 * Filter law: the request without `limit` returns exactly the rows that the
 * model's equality keeps, all leaves under a conjunction and some leaf under
 * an `or`. A ref reads the stored row as JavaScript does, so
 * `items.length` is an array's or a string's length and `items.year` a
 * Temporal.PlainDate's year. A Date equals the number of its epoch
 * milliseconds and every other value equals only an identical value, so `1n`,
 * `true`, `'1'` and the epoch's ISO text never equal the number 1.
 *
 * Work law: SQLite returns no more stored rows than the page holds when
 * - the database stores text as UTF-8, whose bytes order text below U+E000
 *   as JavaScript's code units do;
 * - the `where` is absent or a conjunction of `eq` and `in` leaves on one
 *   top-level field each, whose literals are all strings with UTF-16 code
 *   units in 1..0xD7FF, all BigInts, or all safe-integer numbers, or an `eq`
 *   with a boolean;
 * - every `orderBy` term is a top-level field with an ensured expression
 *   index;
 * - every stored value of those fields is null, missing, a safe integer or a
 *   boolean, or else every one is null, missing or a string whose UTF-16 code
 *   units are all in 1..0xD7FF, sorted lexically; and
 * - every key is such a string,
 * all judged on the rows after the writes. Other requests may read every
 * matching row. The page and filter laws hold
 * for every request.
 *
 * Model: `owedRows` filters the stored rows with that equality, reading each
 * ref with `readRef`. `comparatorOrder` sorts them with `makeComparator` per
 * order term, with the request's options, then by key in code-unit order, the
 * adapter's tie-break. The comparator places nulls by `nulls` alone and
 * reverses only non-null comparisons for `desc`; it orders NaN above every
 * other value and compares arrays element by element. It decides no single
 * order when it orders two objects other than Dates or arrays by an identity
 * that each runtime assigns, or when it is not a strict total order over the
 * rows, as when text and numbers mix; the model then owes no page and the page
 * law falls back to the unpaged request. `resolve` applies the writes to the
 * stored rows, and the model owes the warm page from the stored rows and the
 * page from the rows after the writes.
 * `pageInSql` decides the work law's premise from the request and the stored
 * values alone. None of these calls the adapter, its comparator or the SQL
 * compiler. An absent `stringSort` is lexical, as the comparator reads it.
 *
 * History grammar: up to twelve rows and one request. A row draws each field
 * from a token (`storedValue`), so a history stays JSON data and shrinks. The
 * order fields `rank` and `title` mostly hold integers, booleans, plain text
 * (including é and Ā, below U+E000), null or nothing, and sometimes a value
 * that breaks the work law's premise: a Date, BigInt, NaN, fraction, object,
 * array or text in `rank`; U+E000, an astral character, a lone surrogate,
 * U+FFFD or NUL in `title`. The filter field
 * `status` stores every kind of value that SQLite compares with the number 1:
 * 1, a Date of epoch 1, `1n`, `true`, `'1'` and the epoch's ISO text, and a
 * Date at the latest valid epoch, 8.64e15, which a literal of that epoch and
 * of the next integer test from both sides. `items` holds an array, a string,
 * a Temporal.PlainDate, a plain object with `length` and `year` members, null
 * or nothing; the nested refs `items.length` and `items.year` read a property
 * that the stored JSON lacks, except on the plain object. A key is `k`, an
 * optional é, Ā, U+E000 or astral character, and the row's index, so two
 * such keys differ first at that character. The database stores text as UTF-8
 * or as UTF-16le, whose bytes put Ā (00 01) before é (E9 00). After the
 * indexes exist and a first page has run, zero to two writes insert a row,
 * replace the value of a stored row, or delete one.
 *
 * The request draws zero to two leaves over seven fields, the two nested refs
 * included: `eq` in either operand order, `in` with zero to three literals, a
 * range, or a constant leaf that keeps every row (`true` or `eq(1, 1)`). They
 * form the `where` without an `and` (no `where` for no leaf), always under
 * one `and` (`and()` for no leaf), with the first leaf in a nested `and`, or
 * under one `or`; the law reads an empty conjunction as an absent `where`, and
 * an empty `or` keeps no row. It draws one or two
 * order terms over `rank`, `title`, the unindexed `due`, the constant 1 or a
 * nested ref, each direction, null placement and string sort (default,
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
 * fraction, a constant leaf, or a membership whose two kinds both match
 * stored values), or an order on `due` or the constant, or under a locale or
 * custom sort. Two more break it on arrays alone in `rank`, which SQLite
 * compares as JSON text, and keep it with é and Ā in titles and keys. Seven
 * states name the premises of a wrong design: `a null
 * decides a descending page` when placing nulls opposite to `nulls` on `desc`
 * terms changes the page; `a nested leaf keeps a JavaScript property` when an
 * owed row's value at a nested leaf's ref is not its stored JSON member; and
 * `a nested order decides the page` when reading the order terms as stored
 * JSON chooses other rows; `a UTF-16 database orders text differently` when
 * the premise holds but for the encoding and UTF-16le byte order chooses
 * other rows; `a later term breaks the premise` when the first order term
 * alone keeps it; `an or keeps a row through one leaf` when the premise holds
 * but for the `or` and an owed row is null at another leaf's field; and `a
 * later write breaks the premise` that held for the stored rows. Their
 * constructions: a descending null on `rank` or `title` under the premise and
 * on `due` in memory; a nested `eq` and a nested `in` that keep an array, a
 * string or a PlainDate; an order on each nested ref at limit 1; titles é and
 * Ā, and ranks tied over keys `kĀ00` and `ké01`, on a UTF-16le database; ranks
 * tied before a title under a locale or the reverse sort, or with text at
 * U+E000 and above; an `or` of a status and a title leaf over a row without a
 * title and one without a status; and an insert or update of the text `'4'`
 * into integer ranks 5..9. Each builder records the states its
 * history must enter, and the check rejects a history that missed one, so
 * generated and shrunk constructions are judged as well as each campaign's
 * seeded one. The measured state `the comparator orders the page` counts the
 * histories the comparator's order judges. Fixed histories keep the datasets
 * that once rejected production mutants. Excluded: cursors, joins, orders on
 * a computed field such as `lower(title)`, and stored values that another
 * library wrote.
 *
 * Driver and checkpoint: the real adapter runs against `node:sqlite` with a
 * counting driver, which records the rows each Collection SELECT returns. It
 * registers the Temporal polyfill that built the history's values as the
 * global constructor, sets the database encoding, stores the rows, ensures an
 * expression index on `rank`, `title`, `status`, `items.length` and
 * `items.year`, and loads the page once (`warm page`). It then commits each
 * write, loads the request without `limit` and the page again, and observes
 * each result's keys and raw rows at `loadSubset` return. It ensures the indexes best effort, as the
 * persisted wrapper does: a rejected `ensureIndex` is recorded and the loads
 * go on. A legal request owes rows, so a load that rejects is observed as
 * such and breaks the filter law (unpaged) or the page law. The driver then
 * records the declared states the history entered.
 *
 * Calibration: trace mutants drop a Date match, ignore the offset, read every
 * match for a page, place descending nulls opposite to `nulls`, drop the rows
 * that a nested leaf keeps through a JavaScript property, order a nested ref
 * as stored JSON, and omit the states of each constructed history. A driver
 * mutant pages the unpaged request's SQL read, candidates and SQL order
 * included. The page law rejects it on an order field that mixes numbers and
 * text, and on a `where` whose candidates include BigInt, boolean and
 * ISO-text values that JavaScript removes.
 *
 * Limits: node:sqlite in one process; no native host, OPFS worker or
 * multi-process WAL. Where the comparator decides no single order, the page
 * law only relates the page to the unpaged request, and does not judge the
 * warm page. Nested refs read numbers
 * only: a Temporal getter that returns a string, a boolean or a BigInt, such
 * as `monthCode`, is outside the grammar. Fractions and integers past the
 * signed 64-bit range stay outside the work law's premise because their order
 * would depend on how SQLite rounds JSON reals, which this build cannot show.
 * Raw rows are not elapsed time.
 */

type Field = `rank` | `title` | `status` | `flag` | `n` | `due` | `items`
// A nested ref reads a property of `items` as JavaScript does: the length of
// an array or a string, the year of a Temporal.PlainDate, or a plain object's
// member, the only one of these that is also its stored JSON member.
type NestedRef = `items.length` | `items.year`
// `constant` orders by the literal 1, an expression that is not a field.
type OrderField = `rank` | `title` | `due` | `constant` | NestedRef
type FilterField = `rank` | `title` | `status` | `flag` | `n` | NestedRef
type KeyKind = `plain` | `latin é` | `latin Ā` | `private use` | `astral`
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
  items: Token
}
// `true` keeps every row: the literal `true`, or the comparison `eq(1, 1)`,
// which has no field.
type LeafOf<TLiteral> =
  | { op: `eq`; field: FilterField; value: TLiteral; reversed: boolean }
  | { op: `in`; field: FilterField; values: Array<TLiteral> }
  | { op: `gt`; field: `n`; value: number }
  | { op: `true`; form: `value` | `comparison` }
// A history names its literals by token; a request holds their values.
type Leaf = LeafOf<Token>
// How the leaves form the `where`: `flat` passes no `where` for no leaf, the
// leaf itself for one, and their `and` for more; `and` always wraps them,
// `and()` included; `nested` wraps the first leaf in an inner `and`; `or`
// wraps them in one `or`, which keeps no row for no leaf.
type WhereShape = `flat` | `and` | `nested` | `or`
// SQLite's text encoding for the database, which sets the byte order of text.
type Encoding = `UTF-8` | `UTF-16le`
// A write after the indexes exist: a new row, a new value for the row at
// position `at` (modulo the row count), or that row's removal.
type Write =
  | { op: `insert`; row: Row }
  | { op: `update`; at: number; row: Row }
  | { op: `delete`; at: number }
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
  encoding: Encoding
  writes: Array<Write>
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
    case `array 0`:
      return []
    case `array 2`:
      return [0, 1]
    case `array 3`:
      return [0, 1, 2]
    case `year 2`:
      return new Temporal.PlainDate(2, 1, 1)
    case `year 3`:
      return new Temporal.PlainDate(3, 1, 1)
    case `members 2`:
      return { length: 2, year: 2 }
    case `members 3`:
      return { length: 3, year: 3 }
    default:
      return token
  }
}

// `é` (U+00E9) and `Ā` (U+0100) order the same way in JavaScript and in
// UTF-8 bytes, but not in UTF-16le bytes, where `Ā` (00 01) precedes `é`
// (E9 00).
const plainTitles = [`a`, `ab`, `b`, `B`, `c`, `d`, `e`, `f`, `é`, `Ā`]
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
  `array 0`,
  `array 3`,
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
// Strings `x`, `ab` and `abc` have lengths 1, 2 and 3.
const itemsTokens = [
  `array 0`,
  `array 2`,
  `array 3`,
  `x`,
  `ab`,
  `abc`,
  `year 2`,
  `year 3`,
  `members 2`,
  `members 3`,
  `null`,
  `missing`,
]
const highKeyCharacters: Record<KeyKind, string> = {
  plain: ``,
  'latin é': `é`,
  'latin Ā': `Ā`,
  'private use': `\uE000`,
  astral: `\u{1F600}`,
}

const rowArbitrary: fc.Arbitrary<Row> = fc.record({
  key: fc.oneof(
    { weight: 5, arbitrary: fc.constant<KeyKind>(`plain`) },
    { weight: 2, arbitrary: fc.constantFrom<KeyKind>(`latin é`, `latin Ā`) },
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
  items: fc.constantFrom<Token>(...itemsTokens),
})

const nestedRefs: ReadonlyArray<NestedRef> = [`items.length`, `items.year`]
const filterFieldArbitrary = fc.constantFrom<FilterField>(
  `status`,
  `title`,
  `rank`,
  `flag`,
  `n`,
  ...nestedRefs,
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
  fc.record({
    op: fc.constant(`true` as const),
    form: fc.constantFrom(`value` as const, `comparison` as const),
  }),
)
const orderArbitrary: fc.Arbitrary<Order> = fc.record({
  field: fc.constantFrom<OrderField>(
    `rank`,
    `title`,
    `due`,
    `constant`,
    ...nestedRefs,
  ),
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
const writeArbitrary: fc.Arbitrary<Write> = fc.oneof(
  fc.record({ op: fc.constant(`insert` as const), row: rowArbitrary }),
  fc.record({
    op: fc.constant(`update` as const),
    at: fc.nat({ max: maxRows - 1 }),
    row: rowArbitrary,
  }),
  fc.record({
    op: fc.constant(`delete` as const),
    at: fc.nat({ max: maxRows - 1 }),
  }),
)
const historyArbitrary: fc.Arbitrary<History> = fc.record({
  rows: fc.array(rowArbitrary, { maxLength: maxRows }),
  where: fc.array(leafArbitrary, { maxLength: maxLeaves }),
  whereShape: fc.constantFrom<WhereShape>(`flat`, `and`, `nested`, `or`),
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
  encoding: fc.oneof(
    { weight: 4, arbitrary: fc.constant<Encoding>(`UTF-8`) },
    { weight: 1, arbitrary: fc.constant<Encoding>(`UTF-16le`) },
  ),
  writes: fc.array(writeArbitrary, { maxLength: 2 }),
})

type StoredRow = { key: string; value: Partial<Record<Field, unknown>> }
type ResolvedLeaf = LeafOf<unknown>
type Request = {
  where: Array<ResolvedLeaf>
  whereShape: WhereShape
  orderBy: Array<Order>
  limit: number
  offset?: number
}
const states = [
  `page in SQL`,
  `page in memory`,
  `a null decides a descending page`,
  `a nested leaf keeps a JavaScript property`,
  `a nested order decides the page`,
  `a UTF-16 database orders text differently`,
  `a later term breaks the premise`,
  `an or keeps a row through one leaf`,
  `a later write breaks the premise`,
] as const
type State = (typeof states)[number]
// Counted, not required: how many histories the comparator's order judges.
const comparatorOrders = `the comparator orders the page`
// A write as a Collection mutation of the adapter.
type Mutation =
  | { type: `insert` | `update`; key: string; value: StoredRow[`value`] }
  | { type: `delete`; key: string; value: StoredRow[`value`] }
type Plan = {
  // The rows stored before the indexes, and the rows after the writes.
  initialRows: Array<StoredRow>
  rows: Array<StoredRow>
  writes: Array<Mutation>
  request: Request
  encoding: Encoding
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
  `items`,
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

function storedRow(row: Row, index: number): StoredRow {
  const value: Partial<Record<Field, unknown>> = {}
  for (const field of fields)
    if (row[field] !== `missing`) value[field] = storedValue(row[field])
  return {
    key: `k${highKeyCharacters[row.key]}${String(index).padStart(2, `0`)}`,
    value,
  }
}

function resolve(history: History): Plan {
  const initialRows = history.rows.map(storedRow)
  // An insert takes the next index after every stored row, so keys stay
  // unique; an update or delete with no row left does nothing.
  let rows = initialRows
  const writes: Array<Mutation> = []
  history.writes.forEach((write, index) => {
    if (write.op === `insert`) {
      const row = storedRow(write.row, maxRows + index)
      rows = [...rows, row]
      writes.push({ type: `insert`, ...row })
      return
    }
    const target = rows[write.at % Math.max(rows.length, 1)]
    if (!target) return
    if (write.op === `delete`) {
      rows = rows.filter((row) => row !== target)
      writes.push({ type: `delete`, ...target })
      return
    }
    const row = { key: target.key, value: storedRow(write.row, 0).value }
    rows = rows.map((stored) => (stored === target ? row : stored))
    writes.push({ type: `update`, ...row })
  })
  return {
    initialRows,
    rows,
    writes,
    request: {
      where: history.where.map(resolveLeaf),
      whereShape: history.whereShape,
      orderBy: history.orderBy,
      limit: history.limit,
      ...(history.offset === `none` ? {} : { offset: history.offset }),
    },
    encoding: history.encoding,
    requiredStates: constructionStates.get(history) ?? [],
  }
}

// A ref reads JavaScript properties, step by step, and stops at null or
// undefined: `items.length` is an array's or a string's length.
function readRef(value: StoredRow[`value`], ref: string): unknown {
  let current: unknown = value
  for (const segment of ref.split(`.`)) {
    if (current == null) return current
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

// The stored JSON member at a ref: only a plain object has members, so an
// array, a string or a Temporal.PlainDate holds none.
function jsonMember(value: StoredRow[`value`], ref: string): unknown {
  let current: unknown = value
  for (const segment of ref.split(`.`)) {
    if (
      current === null ||
      typeof current !== `object` ||
      Object.getPrototypeOf(current) !== Object.prototype ||
      !Object.hasOwn(current, segment)
    )
      return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
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
  const value = readRef(row.value, leaf.field)
  switch (leaf.op) {
    case `eq`:
      return equalsLiteral(value, leaf.value)
    case `in`:
      return leaf.values.some((literal) => equalsLiteral(value, literal))
    case `gt`:
      return typeof value === `number` && value > leaf.value
  }
}

// An `or` keeps a row that some leaf keeps; every other shape is a
// conjunction.
const owedRows = (plan: Plan, rows = plan.rows) =>
  rows.filter((row) =>
    plan.request.whereShape === `or`
      ? plan.request.where.some((leaf) => keepsRow(row, leaf))
      : plan.request.where.every((leaf) => keepsRow(row, leaf)),
  )

// Code-unit order, which JavaScript and SQLite's UTF-8 bytes share.
const codeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

// The byte order of UTF-16le text, which a UTF-16le SQLite database uses:
// each code unit's low byte comes first.
function utf16leBytes(left: string, right: string): number {
  const bytes = (text: string) =>
    [...Array(text.length).keys()].flatMap((at) => {
      const unit = text.charCodeAt(at)
      return [unit & 0xff, unit >> 8]
    })
  const [a, b] = [bytes(left), bytes(right)]
  const at = a.findIndex((byte, index) => byte !== b[index])
  return at === -1 ? a.length - b.length : at >= b.length ? 1 : a[at]! - b[at]!
}

/**
 * The order that TanStack DB's comparator gives the owed rows: each term's
 * value under `makeComparator` with the request's options, which places
 * nulls by `nulls` alone and reverses only non-null comparisons for `desc`,
 * then the keys in code-unit order, the adapter's tie-break. `read` gives a
 * term's value, and `text`, when given, replaces code-unit order for keys and
 * for the text of terms under lexical sort. Undefined when the comparator
 * decides no single order: it orders two objects other than Dates or arrays
 * by an identity that each runtime assigns, or it is not a strict total
 * order over these rows, as when text and numbers mix.
 */
function comparatorOrder(
  rows: Array<StoredRow>,
  orderBy: ReadonlyArray<Order>,
  read: typeof readRef = readRef,
  text: typeof codeUnits = codeUnits,
): Array<string> | undefined {
  // Set by `compare`, which TypeScript cannot see from here.
  let byIdentity = false as boolean
  const terms = orderBy.map((term) => ({
    compare: makeComparator(
      text !== codeUnits &&
        (term.stringSort === `default` || term.stringSort === `lexical`)
        ? { ...compareOptionsOf(term), stringSort: `custom`, compare: text }
        : compareOptionsOf(term),
    ),
    value: (row: StoredRow) =>
      term.field === `constant` ? 1 : read(row.value, term.field),
  }))
  const compare = (left: StoredRow, right: StoredRow) => {
    for (const term of terms) {
      const [a, b] = [term.value(left), term.value(right)]
      if (
        typeof a === `object` &&
        a !== null &&
        typeof b === `object` &&
        b !== null &&
        !(a instanceof Date && b instanceof Date) &&
        !(Array.isArray(a) && Array.isArray(b))
      )
        byIdentity = true
      const result = term.compare(a, b)
      if (result !== 0) return Math.sign(result)
    }
    return text(left.key, right.key)
  }
  const ordered = [...rows].sort(compare)
  const total = ordered.every((left, at) =>
    ordered
      .slice(at + 1)
      .every((right) => compare(left, right) < 0 && compare(right, left) > 0),
  )
  return total && !byIdentity ? ordered.map((row) => row.key) : undefined
}

const pageOf = (plan: Plan, order: Array<string> | undefined) => {
  const offset = plan.request.offset ?? 0
  return order?.slice(offset, offset + plan.request.limit)
}

// The page under the old design, which negated a whole `desc` comparison and
// so placed nulls opposite to `nulls`.
const nullsNegatedPage = (plan: Plan) =>
  pageOf(
    plan,
    comparatorOrder(
      owedRows(plan),
      plan.request.orderBy.map((term) =>
        term.direction === `desc`
          ? { ...term, nulls: term.nulls === `first` ? `last` : `first` }
          : term,
      ),
    ),
  )

// The rows of the page chosen in another order, in the comparator's order.
function windowIn(plan: Plan, other: Array<string> | undefined) {
  const window = pageOf(plan, other)
  const order = comparatorOrder(owedRows(plan), plan.request.orderBy)
  return window && order?.filter((key) => window.includes(key))
}

// The page that reads each order term as its stored JSON member, as SQLite
// sees it.
const storedJsonPage = (plan: Plan) =>
  windowIn(
    plan,
    comparatorOrder(owedRows(plan), plan.request.orderBy, jsonMember),
  )

const plainText = (text: string) =>
  [...text].every((char) => {
    const unit = char.charCodeAt(0)
    return char.length === 1 && unit > 0 && unit < 0xd800
  })

const topLevel = (field: string) => !field.includes(`.`)

function exactLeaf(leaf: ResolvedLeaf): boolean {
  if (leaf.op === `gt` || leaf.op === `true` || !topLevel(leaf.field))
    return false
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

// The driver ensures an expression index on each of these refs.
const indexedRefs: ReadonlyArray<string> = [
  `rank`,
  `title`,
  `status`,
  ...nestedRefs,
]

function sortsPlainly(rows: Array<StoredRow>, order: Order): boolean {
  const { field } = order
  if (!indexedRefs.includes(field) || !topLevel(field)) return false
  const values = rows
    .map((row) => readRef(row.value, field))
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

/**
 * The work law's premise, from the request and the stored values alone: a
 * UTF-8 database, a `where` that is a conjunction of exact leaves, order
 * terms that sort plainly, and plain keys. `rows` and `orderBy` default to
 * the request's after the writes.
 */
function pageInSql(
  plan: Plan,
  rows = plan.rows,
  orderBy = plan.request.orderBy,
  encoding = plan.encoding,
): boolean {
  return (
    encoding === `UTF-8` &&
    plan.request.whereShape !== `or` &&
    plan.request.where.every(exactLeaf) &&
    orderBy.every((order) => sortsPlainly(rows, order)) &&
    rows.every((row) => plainText(`s:${row.key}`))
  )
}

const sameKeys = (left: Array<string>, right: Array<string>) =>
  left.length === right.length && left.every((key) => right.includes(key))

/**
 * The declared states a history enters, from the plan alone. A null decides
 * a descending page when the old design's page differs; a nested leaf keeps a
 * JavaScript property when an owed row's value at a nested leaf's ref is not
 * its stored JSON member; a nested order decides the page when reading the
 * order terms as stored JSON would choose other rows. A UTF-16 database
 * orders text differently when the premise holds but for the encoding and
 * UTF-16le byte order would choose other rows; a later term breaks the
 * premise when the first order term alone keeps it; an `or` keeps a row
 * through one leaf when the premise holds but for the `or`, and an owed row
 * is null or missing at another leaf's field; and a later write breaks the
 * premise that held for the stored rows.
 */
function statesOf(plan: Plan): Array<string> {
  const page = pageOf(
    plan,
    comparatorOrder(owedRows(plan), plan.request.orderBy),
  )
  const nullsNegated = nullsNegatedPage(plan)
  const storedJson = storedJsonPage(plan)
  const utf16 = windowIn(
    plan,
    comparatorOrder(
      owedRows(plan),
      plan.request.orderBy,
      readRef,
      utf16leBytes,
    ),
  )
  const leaves = plan.request.where.filter(
    (leaf) => leaf.op === `eq` || leaf.op === `in`,
  )
  const entered: Array<string | false> = [
    pageInSql(plan) ? `page in SQL` : `page in memory`,
    !!page && comparatorOrders,
    !!page &&
      !!nullsNegated &&
      page.join() !== nullsNegated.join() &&
      `a null decides a descending page`,
    plan.request.where.some(
      (leaf) =>
        (leaf.op === `eq` || leaf.op === `in`) &&
        !topLevel(leaf.field) &&
        owedRows(plan).some(
          (row) =>
            readRef(row.value, leaf.field) !==
            jsonMember(row.value, leaf.field),
        ),
    ) && `a nested leaf keeps a JavaScript property`,
    !!page &&
      !!storedJson &&
      !sameKeys(page, storedJson) &&
      `a nested order decides the page`,
    plan.encoding === `UTF-16le` &&
      pageInSql(plan, plan.rows, plan.request.orderBy, `UTF-8`) &&
      !!page &&
      !!utf16 &&
      !sameKeys(page, utf16) &&
      `a UTF-16 database orders text differently`,
    !pageInSql(plan) &&
      pageInSql(plan, plan.rows, plan.request.orderBy.slice(0, 1)) &&
      `a later term breaks the premise`,
    plan.request.whereShape === `or` &&
      leaves.length > 1 &&
      pageInSql({ ...plan, request: { ...plan.request, whereShape: `and` } }) &&
      owedRows(plan).some((row) =>
        leaves.some((leaf) => readRef(row.value, leaf.field) == null),
      ) &&
      `an or keeps a row through one leaf`,
    plan.writes.length > 0 &&
      pageInSql(plan, plan.initialRows) &&
      !pageInSql(plan) &&
      `a later write breaks the premise`,
  ]
  return entered.filter((state): state is string => state !== false)
}

function model(plan: Plan) {
  const keys = owedRows(plan)
    .map((row) => row.key)
    .sort()
  const offset = plan.request.offset ?? 0
  return {
    keys,
    // The page owed before the writes, when the driver warms the adapter.
    warmPage: pageOf(
      plan,
      comparatorOrder(owedRows(plan, plan.initialRows), plan.request.orderBy),
    ),
    page: pageOf(plan, comparatorOrder(owedRows(plan), plan.request.orderBy)),
    pageInSql: pageInSql(plan),
    pageRows: Math.max(0, Math.min(plan.request.limit, keys.length - offset)),
    requiredStates: plan.requiredStates,
  }
}
type Owed = ReturnType<typeof model>

// Constructions. Each keeps what of the generated history its states allow,
// and returns a fresh history that it records with the states that history
// must enter.

const lexicalSort = (sort: Order[`stringSort`]): Order[`stringSort`] =>
  sort === `locale` || sort === `custom` ? `lexical` : sort

// The row with every value and key that breaks the work law's premise
// replaced by a plain one.
const plainRow = (row: Row): Row => ({
  ...row,
  key: row.key === `private use` || row.key === `astral` ? `plain` : row.key,
  rank: irregularRanks.includes(String(row.rank)) ? row.n % 10 : row.rank,
  title: irregularTitles.includes(row.title)
    ? plainTitles[row.n % plainTitles.length]!
    : row.title,
})

// Replaces every value and key that breaks the work law's premise, in the
// stored and the written rows, moves the order onto the indexed fields with
// `lead` first, makes each leaf exact under a conjunction, and stores text as
// UTF-8.
function withPlainPremise(generated: History, lead: `rank` | `title`): History {
  const other: OrderField = lead === `rank` ? `title` : `rank`
  return {
    rows: generated.rows.map(plainRow),
    where: generated.where.map(exactly),
    whereShape: generated.whereShape === `or` ? `and` : generated.whereShape,
    orderBy: generated.orderBy.map((term, index) => ({
      ...term,
      field: index === 0 ? lead : other,
      stringSort: lexicalSort(term.stringSort),
    })),
    limit: generated.limit,
    offset: generated.offset,
    encoding: `UTF-8`,
    writes: generated.writes.map((write) =>
      write.op === `delete` ? write : { ...write, row: plainRow(write.row) },
    ),
  }
}

// An exact leaf on the same field: a range becomes an equality, and a
// literal list of mixed or inexact kinds keeps its integers. A leaf on a
// nested ref, which is never exact, moves onto `n`.
function exactly(leaf: Leaf): Leaf {
  if ((leaf.op === `eq` || leaf.op === `in`) && !topLevel(leaf.field))
    return exactly({ ...leaf, field: `n` })
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
  items: `missing`,
}

function withRows(history: History, count: number): History {
  const rows = [...history.rows]
  while (rows.length < count) rows.push({ ...fallbackRow, n: rows.length })
  return { ...history, rows }
}

function withRow(rows: Array<Row>, index: number, change: Partial<Row>) {
  return rows.map((row, at) => (at === index ? { ...row, ...change } : row))
}

function constructed(
  name: string,
  enters: ReadonlyArray<State>,
  build: (generated: History) => History,
) {
  return {
    name,
    enters,
    build: (generated: History) => {
      const history = build(generated)
      constructionStates.set(history, enters)
      return history
    },
  }
}

const constructions = [
  constructed(`page in SQL by rank`, [`page in SQL`], (generated) =>
    withPlainPremise(generated, `rank`),
  ),
  constructed(`page in SQL by title`, [`page in SQL`], (generated) =>
    withPlainPremise(generated, `title`),
  ),
  constructed(
    `page in SQL under an exact where`,
    [`page in SQL`],
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
    [`page in SQL`],
    (generated) => {
      // At least two rows match, so the page holds fewer rows than a read of
      // every match returns.
      const history = withRows(
        {
          ...withPlainPremise(generated, leadOf(generated)),
          where: [],
          writes: [],
        },
        2,
      )
      return generated.limit % 2 === 0
        ? { ...history, limit: 0 }
        : { ...history, limit: 1, offset: 0 }
    },
  ),
  constructed(
    `page in memory for one irregular order value`,
    [`page in memory`],
    (generated) => {
      const lead = leadOf(generated)
      const history = withRows(
        { ...withPlainPremise(generated, lead), writes: [] },
        1,
      )
      const at = generated.limit % history.rows.length
      const row = history.rows[at]!
      // Text breaks a numeric field only beside a number, so a field that
      // holds no number gets an object instead.
      const holdsNumber = history.rows.some(
        (other, index) => index !== at && typeof other.rank === `number`,
      )
      const rank = irregularRanks[row.n % irregularRanks.length]!
      return {
        ...history,
        rows: withRow(
          history.rows,
          at,
          lead === `rank`
            ? {
                rank:
                  holdsNumber || (rank !== `text 4` && rank !== `x`)
                    ? rank
                    : `object`,
              }
            : { title: irregularTitles[row.n % irregularTitles.length]! },
        ),
      }
    },
  ),
  constructed(
    `page in memory for two tied rows with high keys`,
    [`page in memory`],
    (generated) => {
      const history = withRows(
        { ...withPlainPremise(generated, leadOf(generated)), writes: [] },
        2,
      )
      const first = history.rows[0]!
      const keys: Array<KeyKind> =
        generated.limit % 2 === 0
          ? [`private use`, `astral`]
          : [`astral`, `private use`]
      return {
        ...history,
        rows: withRow(withRow(history.rows, 0, { key: keys[0]! }), 1, {
          key: keys[1]!,
          rank: first.rank,
          title: first.title,
        }),
      }
    },
  ),
  constructed(
    `page in memory for one inexact leaf`,
    [`page in memory`],
    (generated) => {
      const history = withPlainPremise(generated, leadOf(generated))
      // Each mixed membership matches stored values of both its kinds.
      const inexact: Array<Leaf> = [
        { op: `gt`, field: `n`, value: generated.limit % 9 },
        { op: `in`, field: `status`, values: [1, `text 1`] },
        { op: `in`, field: `flag`, values: [`true`, 1] },
        { op: `eq`, field: `rank`, value: `fraction`, reversed: false },
        { op: `true`, form: generated.limit % 2 ? `value` : `comparison` },
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
    [`page in memory`],
    (generated) => {
      const history = withRows(
        { ...withPlainPremise(generated, `title`), writes: [] },
        1,
      )
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
  constructed(
    `a null decides a descending page in SQL`,
    [`a null decides a descending page`, `page in SQL`],
    (generated) => nullOnDescendingPage(generated, leadOf(generated)),
  ),
  constructed(
    `a null decides a descending page in memory`,
    [`a null decides a descending page`, `page in memory`],
    (generated) => nullOnDescendingPage(generated, `due`),
  ),
  ...([`eq`, `in`] as const).map((op) =>
    constructed(
      `a nested ${op} keeps a row by a JavaScript property`,
      [`a nested leaf keeps a JavaScript property`],
      (generated) => nestedLeaf(generated, op),
    ),
  ),
  ...nestedRefs.map((ref) =>
    constructed(
      `a nested order on ${ref} decides the page`,
      [`a nested order decides the page`],
      (generated) => nestedOrder(generated, ref),
    ),
  ),
  constructed(
    `a UTF-16 database orders titles differently`,
    [`a UTF-16 database orders text differently`],
    (generated) => {
      const history = onePlainTerm(generated, `title`)
      // Every title is é or Ā, whose order UTF-16le bytes reverse.
      return {
        ...history,
        rows: history.rows.map((row, index) => ({
          ...row,
          title: index % 2 ? `é` : `Ā`,
        })),
        encoding: `UTF-16le`,
      }
    },
  ),
  constructed(
    `a UTF-16 database orders tied keys differently`,
    [`a UTF-16 database orders text differently`],
    (generated) => {
      const history = onePlainTerm(generated, `rank`)
      // Every rank ties, so the keys decide: `kĀ00` comes after `ké01` and
      // every plain key in JavaScript, and before them in UTF-16le bytes.
      const keys: Array<KeyKind> = [`latin Ā`, `latin é`]
      return {
        ...history,
        rows: history.rows.map((row, index) => ({
          ...row,
          rank: 4,
          key: keys[index] ?? `plain`,
        })),
        encoding: `UTF-16le`,
      }
    },
  ),
  constructed(
    `a later term breaks the premise`,
    [`a later term breaks the premise`, `page in memory`],
    (generated) => {
      const history = onePlainTerm(generated, `rank`)
      // Every rank ties, so the title term decides, and each pair orders
      // otherwise in SQLite's bytes: a locale sort, the reverse comparator, or
      // text at U+E000 and above.
      const [pair, stringSort] = (
        [
          [[`a`, `B`], `locale`],
          [[`a`, `b`], `custom`],
          [[`\uE000`, `\u{1F600}`], `lexical`],
        ] as const
      )[generated.limit % 3]!
      const [first] = history.orderBy
      const second = generated.orderBy[1] ?? generated.orderBy[0]!
      return {
        ...history,
        rows: history.rows.map((row, index) => ({
          ...row,
          rank: 4,
          title: pair[index % 2]!,
        })),
        orderBy: [first!, { ...second, field: `title`, stringSort }],
      }
    },
  ),
  constructed(
    `an or keeps a row through one leaf`,
    [`an or keeps a row through one leaf`, `page in memory`],
    (generated) => {
      const history = withRows(
        { ...withPlainPremise(generated, leadOf(generated)), writes: [] },
        2,
      )
      // The first row matches only the status leaf and has no title, the
      // second only the title leaf and has no status.
      return {
        ...history,
        rows: withRow(
          withRow(history.rows, 0, { status: 1, title: `null` }),
          1,
          {
            status: `null`,
            title: `b`,
          },
        ),
        where: [
          { op: `eq`, field: `status`, value: 1, reversed: false },
          {
            op: `eq`,
            field: `title`,
            value: `b`,
            reversed: generated.rows.length % 2 === 1,
          },
        ],
        whereShape: `or`,
        limit: 1_000_000,
        offset: `none`,
      }
    },
  ),
  ...([`insert`, `update`] as const).map((op) =>
    constructed(
      `a later ${op} breaks the premise`,
      [`a later write breaks the premise`],
      (generated) => laterText(generated, op),
    ),
  ),
  constructed(
    `page in memory for an order on arrays`,
    [`page in memory`],
    (generated) => {
      const history = onePlainTerm(generated, `rank`)
      // Arrays compare element by element; SQLite compares their JSON text,
      // which puts `[0,1,2]` before `[]`.
      const arrays = [`array 0`, `array 3`]
      return {
        ...history,
        rows: history.rows.map((row, index) => ({
          ...row,
          rank: arrays[index % arrays.length]!,
        })),
      }
    },
  ),
  constructed(
    `page in SQL over non-ASCII titles and keys`,
    [`page in SQL`],
    (generated) => {
      const history = onePlainTerm(generated, `title`)
      return {
        ...history,
        rows: withRow(
          withRow(history.rows, 0, { key: `latin é`, title: `é` }),
          1,
          { key: `latin Ā`, title: `Ā` },
        ),
      }
    },
  ),
]

// The plain premise on one order term over at least two rows, at limit 1
// with no where and no writes, so the first row decides the page.
function onePlainTerm(generated: History, lead: `rank` | `title`): History {
  const history = withRows(
    { ...withPlainPremise(generated, lead), where: [], writes: [] },
    2,
  )
  return {
    ...history,
    orderBy: history.orderBy.slice(0, 1),
    limit: 1,
    offset: `none`,
  }
}

// Ranks 5..9 under the premise, then a write of the text `'4'`, which the
// comparator reads as 4 and so places first ascending and last descending,
// while SQLite orders text after every number.
function laterText(generated: History, op: `insert` | `update`): History {
  const history = onePlainTerm(generated, `rank`)
  const rows = history.rows.map((row) => ({ ...row, rank: 5 + (row.n % 5) }))
  const row = { ...rows[0]!, rank: `text 4` }
  return {
    ...history,
    rows,
    writes: [
      op === `insert`
        ? { op, row }
        : { op, at: generated.limit % rows.length, row },
    ],
  }
}

// A descending first term on `lead` over a null and a non-null row, at limit
// 1 with no where, so the page holds a null exactly when `nulls` is `first`.
// `rank` and `title` keep the work law's premise; the unindexed `due` pages
// in memory.
function nullOnDescendingPage(
  generated: History,
  lead: `rank` | `title` | `due`,
): History {
  const history = withRows(
    {
      ...withPlainPremise(generated, lead === `due` ? `rank` : lead),
      where: [],
      writes: [],
    },
    2,
  )
  const [first, ...rest] = history.orderBy
  const [empty, filled]: [Partial<Row>, Partial<Row>] =
    lead === `rank`
      ? [{ rank: `null` }, { rank: 4 }]
      : lead === `title`
        ? [{ title: `null` }, { title: `c` }]
        : [{ due: `missing` }, { due: 3 }]
  return {
    ...history,
    rows: withRow(withRow(history.rows, 0, empty), 1, filled),
    orderBy: [
      { ...first!, field: lead, direction: `desc` },
      ...rest.filter((term) => term.field !== lead),
    ],
    limit: 1,
    offset: `none`,
  }
}

// The first row's `items` holds an array, a string or a Temporal.PlainDate
// whose property at a nested ref equals the only leaf's literal, so that row
// is owed through a property its stored JSON lacks.
function nestedLeaf(generated: History, op: `eq` | `in`): History {
  const history = withRows({ ...generated, writes: [] }, 1)
  const literal = 2 + (history.rows.length % 2)
  const ref: NestedRef = generated.limit % 2 ? `items.year` : `items.length`
  const items =
    ref === `items.year`
      ? `year ${literal}`
      : generated.where.length % 2
        ? `array ${literal}`
        : literal === 2
          ? `ab`
          : `abc`
  const leaf: Leaf =
    op === `eq`
      ? { op, field: ref, value: literal, reversed: history.rows.length > 6 }
      : { op, field: ref, values: [literal, history.rows.length % 4] }
  return {
    ...history,
    rows: withRow(history.rows, 0, { items }),
    where: [leaf],
  }
}

// Two rows whose `items` give `ref` a JavaScript property, the first after
// the second in the comparator's order and the second first among all rows
// that are not null there, at limit 1 over plain keys and no where. Their
// stored JSON holds no such member, so a page read as stored JSON starts at
// the first key or at a plain object's member.
function nestedOrder(generated: History, ref: NestedRef): History {
  // An empty `or` keeps no row, so the shape becomes a conjunction.
  const history = withRows(
    {
      ...generated,
      where: [],
      whereShape: generated.whereShape === `or` ? `and` : generated.whereShape,
      writes: [],
    },
    2,
  )
  const [first] = history.orderBy
  const [low, high] =
    ref === `items.year`
      ? [`year 2`, `year 3`]
      : [`array 0`, generated.limit % 2 ? `abc` : `array 3`]
  const [before, after] = first!.direction === `asc` ? [low, high] : [high, low]
  const plain = history.rows.map((row) => ({ ...row, key: `plain` as const }))
  return {
    ...history,
    rows: withRow(withRow(plain, 0, { items: after }), 1, { items: before }),
    orderBy: [{ ...first!, field: ref }],
    limit: 1,
    offset: `none`,
  }
}

// Fixed histories: the datasets that rejected the production mutants named in
// the coverage map, as members of the grammar.
const plainRows: Array<Row> = (
  [
    [5, `b`, 1, `true`, 1, 3, `array 2`],
    [3, `a`, `date 1`, `true`, 2, `missing`, `ab`],
    [9, `c`, `bigint 1`, `false`, 3, 1, `year 2`],
    [9, `b`, `true`, 1, 0, `missing`, `members 2`],
    [`null`, `d`, `text 1`, `missing`, 4, 2, `array 0`],
    [`missing`, `a`, `iso 1`, `missing`, 5, `missing`, `x`],
    [1, `null`, 2, `true`, 6, `missing`, `missing`],
    [7, `missing`, 1, `true`, 7, 5, `abc`],
    [3, `e`, `date 2`, `false`, 8, `missing`, `null`],
    [0, `c`, 1, `true`, 9, 4, `array 3`],
    [7, `f`, 0, `missing`, 10, `missing`, `year 3`],
    [2, `B`, 1, `false`, 0, `missing`, `members 3`],
  ] as const
).map(([rank, title, status, flag, n, due, items]) => ({
  key: `plain`,
  rank,
  title,
  status,
  flag,
  n,
  due,
  items,
}))

const order = (
  field: OrderField,
  direction: Order[`direction`],
  stringSort: Order[`stringSort`] = `default`,
): Order => ({ field, direction, nulls: `first`, stringSort })

// A fixed history: the plain rows under one order term, with no `where` and
// no offset unless `change` gives them.
const fixedHistory = (
  orderBy: Order,
  limit: number,
  change: Partial<History> = {},
): History => ({
  rows: plainRows,
  where: [],
  whereShape: `flat`,
  orderBy: [orderBy],
  limit,
  offset: `none`,
  encoding: `UTF-8`,
  writes: [],
  ...change,
})

const fixed: Array<{ name: string; history: History }> = [
  {
    name: `plain rows by rank descending, nulls first`,
    history: fixedHistory(order(`rank`, `desc`), 3),
  },
  {
    name: `plain rows by rank descending after an offset`,
    history: fixedHistory(order(`rank`, `desc`), 4, { offset: 2 }),
  },
  {
    name: `status equals 1 beside coerced values`,
    history: fixedHistory(order(`rank`, `desc`), 2, {
      where: [{ op: `eq`, field: `status`, value: 1, reversed: false }],
    }),
  },
  {
    name: `status is 1 or the text 1`,
    history: fixedHistory(order(`rank`, `asc`), 1_000_000, {
      where: [{ op: `in`, field: `status`, values: [1, `text 1`] }],
    }),
  },
  {
    name: `title is a or a lone surrogate beside the replacement character`,
    history: fixedHistory(order(`rank`, `asc`), 1_000_000, {
      rows: withRow(withRow(plainRows, 3, { title: `\uD800` }), 5, {
        title: `\uFFFD`,
      }),
      where: [{ op: `in`, field: `title`, values: [`a`, `\uD800`] }],
    }),
  },
  {
    name: `status holds a Date at the latest epoch`,
    history: fixedHistory(order(`rank`, `desc`), 1_000_000, {
      rows: withRow(plainRows, 4, { status: `date max` }),
      where: [{ op: `in`, field: `status`, values: [`max epoch`, 1] }],
    }),
  },
  {
    // Locale order puts `a` before `B`; code-unit order puts `B` first.
    name: `titles under a locale sort`,
    history: fixedHistory(
      { ...order(`title`, `asc`, `locale`), nulls: `last` },
      1,
    ),
  },
  {
    name: `titles under a custom reverse sort`,
    history: fixedHistory(
      { ...order(`title`, `asc`, `custom`), nulls: `last` },
      3,
    ),
  },
  {
    name: `title equals b`,
    history: fixedHistory(order(`rank`, `asc`), 1, {
      where: [{ op: `eq`, field: `title`, value: `b`, reversed: false }],
    }),
  },
  {
    name: `flag equals true`,
    history: fixedHistory(order(`rank`, `desc`), 2, {
      where: [{ op: `eq`, field: `flag`, value: `true`, reversed: true }],
    }),
  },
  {
    name: `status equals 1n`,
    history: fixedHistory(order(`rank`, `desc`), 0, {
      where: [
        { op: `eq`, field: `status`, value: `bigint 1`, reversed: false },
      ],
    }),
  },
  {
    name: `plain rows at offset 0`,
    history: fixedHistory(order(`rank`, `asc`), 2, { offset: 0 }),
  },
  {
    name: `rank mixes numbers and text`,
    history: fixedHistory(order(`rank`, `desc`), 3, {
      rows: withRow(withRow(plainRows, 7, { rank: `text 4` }), 10, {
        rank: `x`,
      }),
    }),
  },
  {
    name: `rank holds NaN`,
    history: fixedHistory(order(`rank`, `asc`), 3, {
      rows: withRow(plainRows, 7, { rank: `nan` }),
    }),
  },
  {
    // SQL returns the NaN row after the numbers, so the sort compares it as
    // the left operand while it places it.
    name: `NaN on the lowest key, nulls last`,
    history: fixedHistory({ ...order(`rank`, `asc`), nulls: `last` }, 1, {
      rows: withRow(plainRows, 0, { rank: `nan` }),
    }),
  },
  {
    // Nulls last, so the highest titles start the page.
    name: `title holds private-use and astral text`,
    history: fixedHistory(
      { ...order(`title`, `desc`, `lexical`), nulls: `last` },
      1,
      {
        rows: withRow(withRow(plainRows, 2, { title: `\uE000` }), 10, {
          title: `\u{1F600}`,
        }),
      },
    ),
  },
  {
    name: `items of each kind by length`,
    history: fixedHistory(order(`items.length`, `asc`), 3),
  },
  {
    name: `items by year descending after an offset`,
    history: fixedHistory(
      { ...order(`items.year`, `desc`), nulls: `last` },
      2,
      {
        offset: 1,
      },
    ),
  },
  {
    name: `items length equals 2`,
    history: fixedHistory(order(`rank`, `asc`), 1_000_000, {
      where: [{ op: `eq`, field: `items.length`, value: 2, reversed: false }],
    }),
  },
  {
    name: `items year is 2 or 3`,
    history: fixedHistory(order(`rank`, `desc`), 1_000_000, {
      where: [{ op: `in`, field: `items.year`, values: [2, 3] }],
    }),
  },
  {
    // UTF-16le bytes put Ā (00 01) before é (E9 00); JavaScript puts é first.
    name: `titles é and Ā on a UTF-16le database`,
    history: fixedHistory(order(`title`, `asc`, `lexical`), 3, {
      rows: plainRows.map((row, index) => ({
        ...row,
        title: index % 2 ? `é` : `Ā`,
      })),
      encoding: `UTF-16le`,
    }),
  },
  {
    name: `titles é and Ā on a UTF-8 database`,
    history: fixedHistory(order(`title`, `asc`, `lexical`), 3, {
      rows: plainRows.map((row, index) => ({
        ...row,
        key: index % 3 ? `plain` : `latin é`,
        title: index % 2 ? `é` : `Ā`,
      })),
    }),
  },
  {
    // Every rank ties, so the title term decides under a locale sort.
    name: `a locale title after a tied rank`,
    history: fixedHistory(order(`rank`, `asc`), 1, {
      rows: plainRows.map((row, index) => ({
        ...row,
        rank: 4,
        title: index % 2 ? `a` : `B`,
      })),
      orderBy: [order(`rank`, `asc`), order(`title`, `asc`, `locale`)],
    }),
  },
  {
    name: `rank holds only arrays`,
    history: fixedHistory(order(`rank`, `asc`), 2, {
      rows: plainRows.map((row, index) => ({
        ...row,
        rank: index % 2 ? `array 0` : `array 3`,
      })),
    }),
  },
  {
    name: `status is 1 or title is b`,
    history: fixedHistory(order(`rank`, `asc`), 1_000_000, {
      where: [
        { op: `eq`, field: `status`, value: 1, reversed: false },
        { op: `eq`, field: `title`, value: `b`, reversed: false },
      ],
      whereShape: `or`,
    }),
  },
  {
    // The page runs once on integer ranks, then a row gains the text '4'.
    name: `a later insert of text into rank`,
    history: fixedHistory(order(`rank`, `asc`), 2, {
      rows: plainRows.map((row) => ({ ...row, rank: 5 + (row.n % 5) })),
      writes: [{ op: `insert`, row: { ...plainRows[0]!, rank: `text 4` } }],
    }),
  },
  {
    // Nulls last, so the two rows tied at the highest rank start the page.
    name: `two rows tied on rank have high keys`,
    history: fixedHistory({ ...order(`rank`, `desc`), nulls: `last` }, 1, {
      rows: withRow(withRow(plainRows, 2, { key: `private use` }), 3, {
        key: `astral`,
      }),
    }),
  },
]

function whereOf(request: Request): IR.BasicExpression<boolean> | undefined {
  const leaves = request.where.map((leaf): IR.BasicExpression<boolean> => {
    if (leaf.op === `true`)
      return leaf.form === `value`
        ? new IR.Value(true)
        : new IR.Func<boolean>(`eq`, [new IR.Value(1), new IR.Value(1)])
    const field = new IR.PropRef(leaf.field.split(`.`))
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
    case `or`:
      return new IR.Func(`or`, leaves)
  }
}

// A custom comparator that reverses code-unit order, so SQL's text order
// cannot stand in for it.
const reverseCodeUnits = (left: string, right: string) =>
  left < right ? 1 : left > right ? -1 : 0

// The request's compare options, which the model also hands the comparator.
function compareOptionsOf(term: Order): IR.OrderByClause[`compareOptions`] {
  return {
    direction: term.direction,
    nulls: term.nulls,
    ...(term.stringSort === `custom`
      ? { stringSort: `custom` as const, compare: reverseCodeUnits }
      : term.stringSort === `default`
        ? {}
        : { stringSort: term.stringSort }),
  }
}

function orderByOf(request: Request): IR.OrderBy {
  return request.orderBy.map((term) => ({
    expression:
      term.field === `constant`
        ? new IR.Value(1)
        : new IR.PropRef(term.field.split(`.`)),
    compareOptions: compareOptionsOf(term),
  }))
}

// `rejected` holds the message of a load that rejected instead of returning.
type Read = { keys: Array<string>; rawRows: number; rejected?: string }

const readAt = (trace: ReadonlyArray<Observation>, checkpoint: string) =>
  trace.find((entry) => entry.checkpoint === checkpoint)?.value as
    Read | undefined

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

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
  // The encoding is set before the adapter creates any table.
  driver.db.exec(`PRAGMA encoding = '${plan.encoding}'`)
  // The adapter stores and revives a Temporal value through the global
  // constructor, which must be the one that built the history's values.
  vi.stubGlobal(`Temporal`, Temporal)
  try {
    const adapter = new SQLiteCorePersistenceAdapter({ driver })
    const target = { kind: `eager` as const, collectionId: `ordered-page` }
    const commit = (seq: number, mutations: Array<Mutation>) =>
      adapter.applyCommittedTx(target, {
        txId: `tx ${seq}`,
        term: 1,
        seq,
        rowVersion: seq,
        mutations,
      })
    await commit(
      1,
      plan.initialRows.map((row) => ({ type: `insert`, ...row })),
    )
    // The persisted wrapper ensures indexes best effort, so a rejection is
    // recorded and the loads go on: the work law then judges a page whose
    // index was lost.
    for (const ref of indexedRefs)
      try {
        await adapter.ensureIndex(target, ref, {
          expressionSql: [
            JSON.stringify({ type: `ref`, path: ref.split(`.`) }),
          ],
        })
      } catch (error) {
        observe(`ensureIndex`, { field: ref, rejected: messageOf(error) })
      }

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
        return { keys: [], rawRows: 0, rejected: messageOf(error) }
      }
      return {
        keys: rows.map((row) => String(row.key)),
        rawRows: driver.reads.reduce((sum, read) => sum + read.rawRows, 0),
      }
    }
    // The page runs once on the stored rows, so an adapter that remembered
    // anything about them meets the writes; each write is its own commit.
    observe(`warm page`, await load(true))
    for (const [index, write] of plan.writes.entries())
      await commit(index + 2, [write])
    observe(`unpaged`, await load(false))
    if (driver instanceof CandidatePagingDriver)
      driver.page = {
        limit: plan.request.limit,
        offset: plan.request.offset ?? 0,
      }
    observe(`page`, await load(true))
    // The declared states are premises of the history, not production
    // decisions: production's paging is what the work law judges.
    for (const state of statesOf(plan)) observe(`reach`, state)
  } finally {
    driver.db.close()
    vi.unstubAllGlobals()
  }
}

// Filter first: a wrong filter also moves the page. Then the warm page and
// the page against the comparator's order, or the page against the unpaged
// order where the comparator decides none, then the raw rows the page read,
// then the construction's states, which only a complete trace can show.
function check(plan: Plan, trace: ReadonlyArray<Observation>, owed: Owed) {
  const warm = readAt(trace, `warm page`)
  const unpaged = readAt(trace, `unpaged`)
  const page = readAt(trace, `page`)
  if (!warm || !unpaged || !page)
    return violation(`page`, `the driver recorded no page`, `trace`)
  if (warm.rejected !== undefined)
    return violation(
      `warm page`,
      `the warm page rejected: ${warm.rejected}`,
      `page`,
    )
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
    (owed.warmPage
      ? differs(
          `warm page`,
          `page`,
          warm.keys,
          owed.warmPage,
          `the page before the writes is not the comparator's rows at its offset`,
        )
      : undefined) ??
    (owed.page
      ? differs(
          `page`,
          `page`,
          page.keys,
          owed.page,
          `the page is not the comparator's rows at its offset`,
        )
      : differs(
          `page`,
          `page`,
          page.keys,
          unpaged.keys.slice(offset, offset + plan.request.limit),
          `the page is not the unpaged order's rows at its offset`,
        )) ??
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

// A trace mutant: the read at `checkpoint` takes the fields of `change`.
const withRead = (
  trace: ReadonlyArray<Observation>,
  checkpoint: string,
  change: (read: Read) => Partial<Read>,
) =>
  trace.map((entry) =>
    entry.checkpoint === checkpoint
      ? {
          ...entry,
          value: { ...(entry.value as Read), ...change(entry.value as Read) },
        }
      : entry,
  )

oracleProperty({
  id: `sqlite-persistence.ordered-page`,
  law: {
    statement: `At loadSubset return, before and after later writes, an ordered page holds exactly the rows at its offset of TanStack DB's comparator order of the matching rows, ties broken by key, or of the unpaged request's order where that comparator decides no single order; the unpaged request keeps exactly the rows whose refs, read as JavaScript reads them, equal the literals (a Date equals its epoch milliseconds); and when the database stores text as UTF-8, the where is a conjunction of exact equality or membership leaves on top-level fields, and every order term is an indexed top-level field that holds only integers and booleans, or only text below U+D800 sorted lexically, with keys of that text, SQLite returns no more stored rows than the page holds.`,
    authority: `The SQLite adapter's contract that the JavaScript evaluator and in-memory sort decide loadSubset results with SQL as a candidate read (PR #1997); makeComparator, which orders live-query results; the accepted goal that a paged live query reads its page, not every matching row.`,
    limits: `Up to twelve rows, two later writes and one request per history on node:sqlite in one process, in UTF-8 or UTF-16le; no cursors, joins, orders on a computed field, native hosts or OPFS. Where the comparator decides no single order, the page is only related to the unpaged request. Nested refs read numbers only.`,
  },
  owns: [`src/sqlite-core-adapter.ts`],
  histories: {
    arbitrary: historyArbitrary,
    runs: 100,
    fixedSeeds: [1116],
    states: [...states],
    measured: [comparatorOrders],
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
        return withRead(trace, `unpaged`, (read) => ({
          keys: read.keys.filter((key) => !dates.has(key)),
        }))
      },
    },
    {
      name: `the page ignores its offset`,
      law: `page`,
      history: { fixed: `plain rows by rank descending after an offset` },
      corrupt: (trace, plan) =>
        withRead(trace, `page`, () => ({
          keys: readAt(trace, `unpaged`)!.keys.slice(0, plan.request.limit),
        })),
    },
    {
      name: `the page reads every match`,
      law: `work`,
      history: { fixed: `status equals 1 beside coerced values` },
      corrupt: (trace) =>
        withRead(trace, `page`, () => ({
          rawRows: readAt(trace, `unpaged`)!.rawRows,
        })),
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
    {
      name: `a descending page places nulls opposite to nulls`,
      law: `page`,
      history: { fixed: `plain rows by rank descending, nulls first` },
      corrupt: (trace, plan) =>
        withRead(trace, `page`, () => ({ keys: nullsNegatedPage(plan) })),
    },
    {
      name: `the filter reads a nested ref as its stored JSON`,
      law: `filter`,
      history: { fixed: `items length equals 2` },
      corrupt: (trace, plan) =>
        withRead(trace, `unpaged`, (read) => ({
          keys: read.keys.filter((key) => {
            const row = plan.rows.find((stored) => stored.key === key)!
            return plan.request.where.every(
              (leaf) =>
                leaf.op === `true` ||
                readRef(row.value, leaf.field) ===
                  jsonMember(row.value, leaf.field),
            )
          }),
        })),
    },
    {
      name: `the page orders a nested ref as its stored JSON`,
      law: `page`,
      history: { fixed: `items of each kind by length` },
      corrupt: (trace, plan) =>
        withRead(trace, `page`, () => ({ keys: storedJsonPage(plan) })),
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
