import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import {
  add,
  caseWhen,
  coalesce,
  count,
  createLiveQueryCollection,
  eq,
  groupKeys,
  gt,
  inArray,
  include as includeWrap,
  materialize,
  max,
  sum,
  toArray,
  upper,
} from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { BaseQueryBuilder } from '../../src/query/builder/index.js'
import { getQueryIR } from '../../src/query/builder/query-ir.js'
import {
  Aggregate,
  ConditionalSelect,
  Func,
  IncludesSubquery,
  QueryRef,
  UnionAll,
  UnionFrom,
} from '../../src/query/ir.js'
import {
  AggregateFunctionNotInSelectError,
  GroupingOperatorRequiredError,
  IncludeOperatorRequiredError,
  NonAggregateExpressionNotInGroupByError,
} from '../../src/errors.js'
import { mockSyncCollectionOptions, stripVirtualProps } from '../utils.js'
import { oraclePropertyOptions, oracleRuns } from '../oracle-config.js'
import { createOracleReach } from '../oracle-reach.js'

/**
 * # What does an aggregate query publish beside its aggregates?
 *
 * An aggregate query has one row per group. Without `groupBy` there is one
 * group: all source rows at the top level, or one group for each parent route
 * inside an include. With `groupBy(c.k)` there is one group per key, within
 * each route. A select value has a value for its group only when every part
 * of it outside an aggregate is constant within the group:
 *
 * - a literal;
 * - a group key (`c.k` in a grouped query);
 * - inside an include, a field of the parent row, which the route fixes.
 *
 * Any other field of the query's own source outside an aggregate has no single
 * value, so the query throws `NonAggregateExpressionNotInGroupByError` when it
 * compiles. That holds wherever the field appears: directly, inside a
 * function, in a conditional's condition or branch, or in a nested object. A
 * spread throws as well, because a route's parent context holds only the
 * parent fields the query names, and so does a nested include, which has one
 * Collection per row. Authority: maintainer decisions (2026-10-09) that such
 * queries throw rather than drop fields, and that literals and parent fields
 * are accepted with `groupBy` too; `ARCHITECTURE.md` states the law.
 *
 * The model evaluates a select shape over plain rows: each aggregate over the
 * group's source rows, each parent field from the parent's current row, each
 * literal as itself, `add` and `caseWhen(eq(...))` as arithmetic. A group with
 * no source rows publishes no row. The model never reads the compiler.
 *
 * The grammar generates a select object of one to three fields, each a tree of
 * depth at most two over literals, parent fields (include only), source fields,
 * and the aggregates `count`, `sum` and `max`, combined by `add` and
 * `caseWhen`. A field can also be a nested object of such expressions, or a
 * `caseWhen` whose branches are such objects (a conditional select). A shape
 * may spread the source or the parent row. Every shape
 * holds at least one aggregate. Each history runs the shape at the top level
 * and inside an include, then applies parent updates and source inserts,
 * updates and deletes. After each step the driver compares the published rows
 * with the model, or that compilation threw when the model says it must.
 *
 * Each history also chooses whether both queries group, by the ref `c.k`, by
 * the computed `upper(c.k)`, by `inArray(c.k, ['a', 'b'])`, by
 * `coalesce(c.d, new Date(5))` (one Date group) or by `add(c.v, NaN)` (one
 * NaN group). Each use builds its literals again, so a group key matches
 * only by value. The top-level query reads the comments directly or through
 * a unionAll, whose refs name fields of the union's rows rather than a source
 * alias. Every published top-level row keeps the select's field order. A shape may hold a nested include. The
 * raw field `c.k` is a group key only under `groupBy(c.k)`: under
 * `upper(c.k)` the keys `a` and `A` share a group. A shape may add a HAVING
 * condition, which follows the select rule and keeps only the groups for
 * which it holds. A HAVING aggregate reads the same aggregate selected as a
 * top-level field; one that no field selects throws
 * `AggregateFunctionNotInSelectError` (docs: "Having Clauses"). HAVING is
 * legal without `groupBy` whenever the select holds an aggregate, wrapped or
 * not. The include's source sometimes shadows the
 * parent alias; a parent ref captured from the outer scope still names the
 * parent row. A source update can change `k`, which moves the row to another
 * group and another parent's route. A
 * grouped history favours the group key over source fields, and conditions
 * can compare with key values, so a missing key changes the branch taken. Group order is not part of the law, so rows are
 * compared in a fixed order.
 *
 * A query also needs the operator code its select and grouping use. Group
 * keys passed to `groupBy` bare carry no grouping compiler, so a grouped
 * query with no aggregate anywhere, in its select, HAVING, or orderBy, throws
 * `GroupingOperatorRequiredError` unless it wraps its keys in `groupKeys()`;
 * any aggregate brings the compiler, and the query compiles all its
 * aggregates with it. A query builder in
 * a select value is a subquery only inside `include()`, `toArray()`, or
 * `materialize()`: a bare one throws `IncludeOperatorRequiredError` when the
 * select is built, as a field, inside a nested object, or in a conditional
 * branch. A wrapped include inside a nested object throws; a conditional
 * branch may be one, which the includes-collection oracle publishes. Authority: the
 * maintainer's decision in PR #2232 that these operators are opt-in and that
 * a missing operator throws. When several errors apply, the query throws one
 * of them; which one is not part of the law.
 *
 * Query IR built by hand must carry the same operator code: the grouping
 * compiler on each aggregate and on `groupKeys()` keys, and the include
 * runtime on each include. IR without it throws the coded error for the
 * missing operator when it compiles, on every path: a grouped query, one
 * implicit group, HAVING, and an include, unless another aggregate or
 * `groupKeys()` brings the grouping compiler. Authority: the changeset ("Code that
 * builds query IR by hand must supply the operator code") and AGENTS.md, which
 * requires a contract contradiction to fail at the boundary.
 *
 * Each history chooses whether a grouped query passes its keys bare, where a
 * nested include sits and how it is wrapped (`toArray()`, `include()`,
 * `materialize()`, or not at all), and, in three generated histories of six,
 * whether the driver strips one kind of operator code, the grouping compiler, the
 * include runtime, or the orderBy aggregate's compiler, from the IR it built before compiling it through
 * `new BaseQueryBuilder(ir)`. Stripping one kind at a time keeps a missing
 * include runtime from hiding behind a missing grouping compiler. A history
 * that strips the include runtime gives its include a child query that is
 * valid on its own, `count()` alone, so only the missing runtime can fail it.
 * Half the histories that strip the grouping compiler likewise give the
 * top-level query a select of `count()` alone, with an aggregate HAVING when
 * the generated shape has one. One history in four is such a forced
 * history: it strips the grouping compiler everywhere or from orderBy only,
 * with no grouping, one key, or two keys, in turn, so every campaign reaches
 * each path whatever its seed. A model error set of exactly
 * `groupingRequired` then witnesses each path, grouped, one implicit group,
 * and HAVING, where no other error can hide the missing compiler. The
 * property declares the states these laws need with `createOracleReach` and
 * fails when a campaign does not reach each of them.
 *
 * Both the top-level query and the include query may order their groups
 * with one or two `orderBy` calls, the first primary (docs: "Multiple Column
 * Ordering"). A term orders by an aggregate, ascending or descending, or by a
 * select field through `$selected` (docs: "Ordering by SELECT Fields"): a
 * number field, or a string group key with the documented `en-US` locale
 * collation. Published rows, and each parent's `kids`, then fall into blocks
 * whose orderBy values compare equal, in the order the terms give; order
 * within a block is not part of the law. An orderBy aggregate that no
 * top-level field selects throws `AggregateFunctionNotInSelectError`. In one
 * generated history of six, in half the forced ones, and in one ordered
 * history of three, the driver strips the grouping compiler from the
 * top-level orderBy aggregates only; the query then compiles with the
 * compiler that `groupKeys()` or a select or HAVING aggregate brings, and
 * throws `GroupingOperatorRequiredError` when none does. Generated shapes
 * with an orderBy rarely compile, so one history in four takes ordered
 * shapes from a grammar whose shapes compile. The source starts with a row
 * whose key `A` sorts between `a` and `b`, where locale and code-unit order
 * differ.
 *
 * Limits: one parent field (`x`) and one source field (`v`); groups by one,
 * two, or three keys; numbers and string keys only. A boolean, Date, `NaN`,
 * or nested-object select field never orders the rows, and no orderBy term
 * is a raw expression other than an aggregate. A nested include in a
 * unionAll query is rejected before compilation, so the driver checks only
 * that it throws.
 */

const PROPERTY = `aggregate.select-shapes`

type Part =
  | { k: `lit`; n: number }
  | { k: `parent` }
  | { k: `source` }
  | { k: `key` }
  /** The raw field `c.k`: the group key only when the query groups by it. */
  | { k: `rawKey` }
  | { k: `agg`; fn: `count` | `sum` | `max` }
  | { k: `add`; a: Part; b: Part }
  | { k: `case`; cond: Part; lit: number | string; a: Part; b: Part }
  | { k: `nested`; fields: Record<string, Part> }

type Shape = {
  fields: Record<string, Part>
  /**
   * A HAVING condition `eq(part, lit)` without aggregates. It follows the
   * select rule: its value outside an aggregate must be constant within the
   * group.
   */
  having?: { part: Part; lit: number | string; selected?: string }
  spread?: `source` | `parent`
  /**
   * One or two `orderBy` calls; the first is the primary sort. A term orders
   * by an aggregate, which reads the same aggregate selected as a top-level
   * field, or by a select field through `$selected`.
   */
  orderBy?: Array<OrderTerm>
  /**
   * A nested include beside the aggregate: wrapped in `toArray()` or bare, as
   * a field, inside a nested object, or in both branches of a conditional.
   */
  include?: {
    wrap: `toArray` | `include` | `materialize` | `bare`
    at: `field` | `nested` | `case`
  }
}

type OrderTerm =
  | { by: `agg`; fn: `count` | `sum` | `max`; dir: `asc` | `desc` }
  | {
      by: `selected`
      field: string
      /** A string field sorts with the documented `en-US` locale collation. */
      kind: `number` | `string`
      dir: `asc` | `desc`
    }

/**
 * How a history groups: not at all, by the ref `c.k`, or by the computed
 * expression `upper(c.k)` or `inArray(c.k, ['a', 'b'])`. The `key` leaf is
 * that group expression, built again with a new list literal each time.
 * `pair` groups by two keys, `c.k` and `gt(c.v, 1)`, and `triple` by three,
 * adding `gt(c.v, 2)`; their `key` leaf is `c.k`, and an update of `v` can
 * move a row to another group.
 */
type Grouping =
  `none` | `key` | `upper` | `inList` | `date` | `nan` | `pair` | `triple`

/** Groupings whose keys include the raw field `c.k`. */
function groupsByRawKey(grouping: Grouping): boolean {
  return grouping === `key` || grouping === `pair` || grouping === `triple`
}

type Issue = { id: number; k: string; x: number }
type Comment = { id: number; k: string; v: number }

// --- Model -----------------------------------------------------------------

function hasAggregate(part: Part): boolean {
  switch (part.k) {
    case `agg`:
      return true
    case `add`:
      return hasAggregate(part.a) || hasAggregate(part.b)
    case `case`:
      return [part.cond, part.a, part.b].some(hasAggregate)
    case `nested`:
      return Object.values(part.fields).some(hasAggregate)
    default:
      return false
  }
}

/**
 * A source field outside an aggregate has no value for the group, unless it
 * is the group key of a grouped query.
 */
function readsSourceOutsideAggregate(part: Part, grouping: Grouping): boolean {
  const reads = (child: Part) => readsSourceOutsideAggregate(child, grouping)
  switch (part.k) {
    case `source`:
      return true
    case `key`:
      return grouping === `none`
    // Under `upper(c.k)`, `a` and `A` share a group, so `c.k` is a source
    // field with no single value for it.
    case `rawKey`:
      return !groupsByRawKey(grouping)
    case `add`:
      return [part.a, part.b].some(reads)
    case `case`:
      return [part.cond, part.a, part.b].some(reads)
    case `nested`:
      return Object.values(part.fields).some(reads)
    default:
      return false
  }
}

/** The aggregates a part reads, outside or inside other expressions. */
function aggregatesOf(part: Part): Array<`count` | `sum` | `max`> {
  switch (part.k) {
    case `agg`:
      return [part.fn]
    case `add`:
      return [...aggregatesOf(part.a), ...aggregatesOf(part.b)]
    case `case`:
      return [part.cond, part.a, part.b].flatMap(aggregatesOf)
    case `nested`:
      return Object.values(part.fields).flatMap(aggregatesOf)
    default:
      return []
  }
}

/**
 * The compile error the model predicts. A HAVING aggregate reads the value
 * of the same aggregate selected as a top-level field, so one that no field
 * selects throws `AggregateFunctionNotInSelectError` (docs: "Having
 * Clauses"). The group-value rule is checked first.
 */
function modelError(
  shape: Shape,
  grouping: Grouping,
): `nonAggregate` | `aggregateNotInSelect` | undefined {
  if (modelThrows(shape, grouping)) return `nonAggregate`
  const selected = selectedAggregates(shape)
  if (
    shape.having &&
    shape.having.selected === undefined &&
    aggregatesOf(shape.having.part).some((fn) => !selected.has(fn))
  )
    return `aggregateNotInSelect`
  return undefined
}

/** The aggregates the select holds as top-level fields. */
function selectedAggregates(shape: Shape): Set<`count` | `sum` | `max`> {
  return new Set(
    Object.values(shape.fields).flatMap((part) =>
      part.k === `agg` ? [part.fn] : [],
    ),
  )
}

function modelThrows(shape: Shape, grouping: Grouping): boolean {
  return (
    shape.spread !== undefined ||
    (shape.having?.selected === undefined &&
      shape.having !== undefined &&
      readsSourceOutsideAggregate(shape.having.part, grouping)) ||
    (shape.include !== undefined && shape.include.wrap !== `bare`) ||
    Object.values(shape.fields).some((part) =>
      readsSourceOutsideAggregate(part, grouping),
    )
  )
}

type ModelError =
  | `nonAggregate`
  | `aggregateNotInSelect`
  | `includeRequired`
  | `groupingRequired`
  | `nestedInclude`

/** Whether the select or HAVING holds an aggregate. */
function selectOrHavingAggregate(shape: Shape): boolean {
  return (
    Object.values(shape.fields).some(hasAggregate) ||
    (shape.having !== undefined &&
      shape.having.selected === undefined &&
      hasAggregate(shape.having.part))
  )
}

/** The aggregates the orderBy terms read. */
function orderAggregates(shape: Shape): Array<`count` | `sum` | `max`> {
  return (shape.orderBy ?? []).flatMap((term) =>
    term.by === `agg` ? [term.fn] : [],
  )
}

/** An aggregate in the select, HAVING, or orderBy brings the grouping compiler. */
function shapeHasAggregate(shape: Shape): boolean {
  return selectOrHavingAggregate(shape) || orderAggregates(shape).length > 0
}

/**
 * Which operator code a hand-built history leaves out of its IR: the grouping
 * compiler everywhere, the include runtime, or the grouping compiler on the
 * orderBy aggregate only.
 */
type Stripped = `none` | `grouping` | `runtime` | `orderBy`

/** Every error the model says applies. The query must throw one of them. */
function modelErrors(
  shape: Shape,
  grouping: Grouping,
  bareKeys: boolean,
  stripped: Stripped,
): Set<ModelError> {
  const errors = new Set<ModelError>()
  // Every shape aggregates or groups, so IR without the grouping compiler
  // cannot compile.
  if (stripped === `grouping`) errors.add(`groupingRequired`)
  // A wrapped include without its runtime cannot compile either.
  if (
    stripped === `runtime` &&
    shape.include !== undefined &&
    shape.include.wrap !== `bare`
  )
    errors.add(`includeRequired`)
  // A bare query builder is no include; the select rejects it when built.
  if (shape.include?.wrap === `bare`) errors.add(`includeRequired`)
  // An include inside a nested object throws (db-core skill, "Includes
  // rules"). A conditional branch may be an include: the includes-collection
  // oracle publishes one through guard transitions.
  if (
    shape.include !== undefined &&
    shape.include.wrap !== `bare` &&
    shape.include.at === `nested`
  )
    errors.add(`nestedInclude`)
  // Bare group keys carry no grouping compiler, and no aggregate brings one.
  if (grouping !== `none` && bareKeys && !shapeHasAggregate(shape))
    errors.add(`groupingRequired`)
  // An orderBy aggregate without its compiler compiles with the one that
  // `groupKeys()` or a select or HAVING aggregate brings, if any.
  if (
    stripped === `orderBy` &&
    orderAggregates(shape).length > 0 &&
    !(grouping !== `none` && !bareKeys) &&
    !selectOrHavingAggregate(shape)
  )
    errors.add(`groupingRequired`)
  // An orderBy aggregate reads the same aggregate selected as a top-level
  // field (docs: "Ordering by SELECT Fields").
  if (orderAggregates(shape).some((fn) => !selectedAggregates(shape).has(fn)))
    errors.add(`aggregateNotInSelect`)
  const error = modelError(shape, grouping)
  if (error) errors.add(error)
  return errors
}

function errorName(error: unknown): ModelError | `other` {
  if (error instanceof IncludeOperatorRequiredError) return `includeRequired`
  if (error instanceof GroupingOperatorRequiredError) return `groupingRequired`
  if (error instanceof NonAggregateExpressionNotInGroupByError)
    return `nonAggregate`
  if (error instanceof AggregateFunctionNotInSelectError)
    return `aggregateNotInSelect`
  // This error site throws a plain coded Error; tests run the development
  // build, whose message names the rule.
  if (
    error instanceof Error &&
    /must be at the top level of select\(\)/.test(error.message)
  )
    return `nestedInclude`
  return `other`
}

function groupKeyOf(
  row: Comment,
  grouping: Grouping,
): string | boolean | number | Date {
  if (grouping === `inList`) return [`a`, `b`].includes(row.k)
  // Comments have no `d`, so `coalesce(c.d, new Date(5))` is one Date group.
  if (grouping === `date`) return new Date(5)
  if (grouping === `nan`) return NaN
  return grouping === `upper` ? row.k.toUpperCase() : row.k
}

/** Group identity by value: equal Dates and NaN each form one group. */
function groupIdOf(row: Comment, grouping: Grouping): string {
  if (grouping === `pair`) return `${row.k}|${String(row.v > 1)}`
  if (grouping === `triple`)
    return `${row.k}|${String(row.v > 1)}|${String(row.v > 2)}`
  const key = groupKeyOf(row, grouping)
  return key instanceof Date
    ? `date:${key.getTime()}`
    : `${typeof key}:${String(key)}`
}

function evaluate(
  part: Part,
  rows: ReadonlyArray<Comment>,
  parent: Issue | undefined,
  grouping: Grouping,
): unknown {
  switch (part.k) {
    case `lit`:
      return part.n
    case `parent`:
      return parent!.x
    case `source`:
      throw new Error(`unreachable: the model throws first`)
    case `key`:
      return groupKeyOf(rows[0]!, grouping)
    case `rawKey`:
      return rows[0]!.k
    case `agg`:
      if (part.fn === `count`) return rows.length
      if (part.fn === `sum`) return rows.reduce((t, r) => t + r.v, 0)
      return Math.max(...rows.map((r) => r.v))
    case `add`:
      return (
        (evaluate(part.a, rows, parent, grouping) as number) +
        (evaluate(part.b, rows, parent, grouping) as number)
      )
    case `case`:
      return evaluate(part.cond, rows, parent, grouping) === part.lit
        ? evaluate(part.a, rows, parent, grouping)
        : evaluate(part.b, rows, parent, grouping)
    case `nested`:
      return Object.fromEntries(
        Object.entries(part.fields).map(([key, child]) => [
          key,
          evaluate(child, rows, parent, grouping),
        ]),
      )
  }
}

/** The groups that HAVING keeps; a grouped query groups by `k`. */
function modelGroups(
  shape: Shape,
  rows: ReadonlyArray<Comment>,
  parent: Issue | undefined,
  grouping: Grouping,
): Array<ReadonlyArray<Comment>> {
  const groups =
    grouping !== `none`
      ? [...new Set(rows.map((row) => groupIdOf(row, grouping)))].map((k) =>
          rows.filter((row) => groupIdOf(row, grouping) === k),
        )
      : rows.length === 0
        ? []
        : [rows]
  // HAVING comes after the select, so it can read `$selected`. A condition
  // on `$selected` reads a select field's group value.
  const havingPart = (having: NonNullable<Shape[`having`]>) =>
    having.selected === undefined ? having.part : shape.fields[having.selected]!
  return shape.having
    ? groups.filter(
        (group) =>
          evaluate(havingPart(shape.having!), group, parent, grouping) ===
          shape.having!.lit,
      )
    : groups
}

function modelRow(
  shape: Shape,
  group: ReadonlyArray<Comment>,
  parent: Issue | undefined,
  grouping: Grouping,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(shape.fields).map(([key, part]) => [
      key,
      evaluate(part, group, parent, grouping),
    ]),
  )
}

/** One published row per kept group. */
function modelGroup(
  shape: Shape,
  rows: ReadonlyArray<Comment>,
  parent: Issue | undefined,
  grouping: Grouping,
): Array<Record<string, unknown>> {
  return sortRows(
    modelGroups(shape, rows, parent, grouping).map((group) =>
      modelRow(shape, group, parent, grouping),
    ),
  )
}

/** The documented `en-US` locale collation for string orderBy terms. */
const collator = new Intl.Collator(`en-US`)

/**
 * The published order under `orderBy`: blocks of rows whose orderBy values
 * compare equal, in the order the terms give, the first term primary. Order
 * within a block is not part of the law.
 */
function modelOrderBlocks(
  shape: Shape,
  rows: ReadonlyArray<Comment>,
  parent: Issue | undefined,
  grouping: Grouping,
): Array<Array<Record<string, unknown>>> {
  const terms = shape.orderBy!
  const keyed = modelGroups(shape, rows, parent, grouping).map((group) => {
    const row = modelRow(shape, group, parent, grouping)
    return {
      row,
      values: terms.map((term) =>
        term.by === `agg`
          ? evaluate({ k: `agg`, fn: term.fn }, group, parent, grouping)
          : row[term.field],
      ),
    }
  })
  const compare = (a: Array<unknown>, b: Array<unknown>): number => {
    for (const [index, term] of terms.entries()) {
      const [x, y] = [a[index], b[index]]
      const result =
        typeof x === `string` && typeof y === `string`
          ? collator.compare(x, y)
          : (x as number) - (y as number)
      if (result !== 0) return term.dir === `asc` ? result : -result
    }
    return 0
  }
  const sorted = [...keyed].sort((a, b) => compare(a.values, b.values))
  const blocks: Array<Array<Record<string, unknown>>> = []
  sorted.forEach((entry, index) => {
    if (index === 0 || compare(sorted[index - 1]!.values, entry.values) !== 0)
      blocks.push([])
    blocks[blocks.length - 1]!.push(entry.row)
  })
  return blocks.map(sortRows)
}

/** Group order is not part of the law. */
function sortRows(
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  // Compare by a canonical form: key order is not part of the law either.
  const canonical = (value: unknown): string =>
    JSON.stringify(value, (_key, inner) =>
      inner !== null && typeof inner === `object` && !Array.isArray(inner)
        ? Object.fromEntries(
            Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : 1)),
          )
        : inner,
    )
  return [...rows].sort((a, b) => (canonical(a) < canonical(b) ? -1 : 1))
}

// --- Grammar ---------------------------------------------------------------

const literal = fc.integer({ min: 0, max: 3 })
// A condition may compare with a group key value, so a missing key changes
// the branch it takes.
const conditionLiteral = fc.oneof(literal, fc.constantFrom(`a`, `b`, `A`, `B`))
// A grouped history favours the group key over source fields, so more of its
// shapes compile and publish values.
const leaf = (include: boolean, grouped: boolean): fc.Arbitrary<Part> =>
  fc.oneof(
    literal.map((n): Part => ({ k: `lit`, n })),
    ...(include ? [fc.constant<Part>({ k: `parent` })] : []),
    { weight: grouped ? 1 : 2, arbitrary: fc.constant<Part>({ k: `source` }) },
    { weight: grouped ? 4 : 1, arbitrary: fc.constant<Part>({ k: `key` }) },
    fc.constant<Part>({ k: `rawKey` }),
    fc
      .constantFrom(`count` as const, `sum` as const, `max` as const)
      .map((fn): Part => ({ k: `agg`, fn })),
  )
// Function arguments and conditions are expressions; a nested object is a
// select value, so it appears only as a field.
const expression = (
  include: boolean,
  grouped: boolean,
  depth: number,
): fc.Arbitrary<Part> =>
  depth === 0
    ? leaf(include, grouped)
    : fc.oneof(
        { weight: 3, arbitrary: leaf(include, grouped) },
        fc
          .record({
            a: expression(include, grouped, depth - 1),
            b: expression(include, grouped, depth - 1),
          })
          .map(({ a, b }): Part => ({ k: `add`, a, b })),
        fc
          .record({
            cond: expression(include, grouped, depth - 1),
            lit: conditionLiteral,
            a: expression(include, grouped, depth - 1),
            b: expression(include, grouped, depth - 1),
          })
          .map((c): Part => ({ k: `case`, ...c })),
      )
const nestedObject = (
  include: boolean,
  grouped: boolean,
  depth: number,
): fc.Arbitrary<Part> =>
  fc
    .dictionary(
      fc.constantFrom(`p`, `q`),
      expression(include, grouped, depth),
      {
        minKeys: 1,
        maxKeys: 2,
      },
    )
    .map((fields): Part => ({ k: `nested`, fields }))
// A conditional whose branches are select objects compiles to a conditional
// select, not to a function call, so it reaches a separate validation path.
const part = (
  include: boolean,
  grouped: boolean,
  depth: number,
): fc.Arbitrary<Part> =>
  fc.oneof(
    { weight: 4, arbitrary: expression(include, grouped, depth) },
    nestedObject(include, grouped, depth - 1),
    fc
      .record({
        cond: expression(include, grouped, depth - 1),
        lit: conditionLiteral,
        a: nestedObject(include, grouped, depth - 1),
        b: nestedObject(include, grouped, depth - 1),
      })
      .map((c): Part => ({ k: `case`, ...c })),
  )
// A grouped query needs no aggregate; an ungrouped one is an aggregate query
// only when it holds one.
const orderSeed: fc.Arbitrary<OrderSeed> = fc.record({
  fn: fc.constantFrom(`count` as const, `sum` as const, `max` as const),
  dir: fc.constantFrom(`asc` as const, `desc` as const),
  selected: fc.option(fc.nat(2), { nil: undefined, freq: 2 }),
})

const shape = (include: boolean, grouping: Grouping): fc.Arbitrary<Shape> =>
  fc
    .record({
      fields: fc.dictionary(
        fc.constantFrom(`f0`, `f1`, `f2`),
        part(include, grouping !== `none`, 2),
        { minKeys: 1, maxKeys: 3 },
      ),
      spread: fc.option(
        fc.constantFrom<`source` | `parent`>(
          ...(include
            ? ([`source`, `parent`] as const)
            : ([`source`] as const)),
        ),
        { nil: undefined, freq: 5 },
      ),
      // Terms are chosen after the fields, so they can name one.
      orderSeeds: fc.option(
        fc.array(orderSeed, { minLength: 1, maxLength: 2 }),
        { nil: undefined, freq: 2 },
      ),
      include: fc.option(
        fc.record({
          wrap: fc.constantFrom(
            `toArray` as const,
            `include` as const,
            `materialize` as const,
            `bare` as const,
          ),
          at: fc.constantFrom(
            `field` as const,
            `nested` as const,
            `case` as const,
          ),
        }),
        { nil: undefined, freq: 2 },
      ),
      having: fc.option(
        fc.record({
          // A condition may read aggregates, selected as fields or not. One
          // in two compares an aggregate directly.
          part: fc.oneof(
            expression(include, grouping !== `none`, 1),
            fc
              .constantFrom(`count` as const, `sum` as const, `max` as const)
              .map((fn): Part => ({ k: `agg`, fn })),
          ),
          lit: conditionLiteral,
          // One in three reads a select field through `$selected` instead.
          selected: fc.option(fc.constant(true), { nil: undefined, freq: 2 }),
        }),
        { nil: undefined, freq: 3 },
      ),
    })
    .map((s) =>
      s.having?.selected
        ? {
            ...s,
            having: { ...s.having, selected: Object.keys(s.fields)[0]! },
          }
        : { ...s, having: s.having && { ...s.having, selected: undefined } },
    )
    .filter(
      (s) => grouping !== `none` || Object.values(s.fields).some(hasAggregate),
    )
    .map(({ orderSeeds, ...s }): Shape =>
      orderSeeds ? { ...s, orderBy: orderTerms(s, orderSeeds, grouping) } : s,
    )

type OrderSeed = {
  fn: `count` | `sum` | `max`
  dir: `asc` | `desc`
  selected: number | undefined
}

/**
 * The orderBy terms for some seeds. A seed with a field index orders by that
 * select field when the field has an order: a number, or a string group key.
 */
function orderTerms(
  s: Shape,
  seeds: ReadonlyArray<OrderSeed>,
  grouping: Grouping,
): Array<OrderTerm> {
  const orderable = Object.entries(s.fields).flatMap(([field, part]) => {
    const kind = orderKind(part, grouping)
    return kind ? [{ field, kind }] : []
  })
  return seeds.map(({ fn, dir, selected }): OrderTerm => {
    const target =
      selected === undefined || orderable.length === 0
        ? undefined
        : orderable[selected % orderable.length]!
    return target ? { by: `selected`, ...target, dir } : { by: `agg`, fn, dir }
  })
}

/**
 * Ordered shapes that compile: fields of aggregates, literals, the group
 * key (always, when it is a string), a parent field, or an aggregate plus a
 * literal, with no HAVING,
 * spread, or include, ordered by one or two terms. An aggregate term orders
 * by an aggregate that a field selects. Generated shapes compile too rarely
 * to reach the ordering laws on their own.
 */
const orderedShape = (
  include: boolean,
  grouping: Grouping,
): fc.Arbitrary<Shape> => {
  const agg = fc
    .constantFrom(`count` as const, `sum` as const, `max` as const)
    .map((fn): Part => ({ k: `agg`, fn }))
  const field = fc.oneof(
    { weight: 3, arbitrary: agg },
    literal.map((n): Part => ({ k: `lit`, n })),
    ...(grouping === `none` ? [] : [fc.constant<Part>({ k: `key` })]),
    ...(include ? [fc.constant<Part>({ k: `parent` })] : []),
    fc
      .tuple(agg, literal)
      .map(([a, n]): Part => ({ k: `add`, a, b: { k: `lit`, n } })),
  )
  return fc
    .tuple(
      fc.dictionary(fc.constantFrom(`f0`, `f1`, `f2`), field, {
        minKeys: 1,
        maxKeys: 3,
      }),
      fc.array(orderSeed, { minLength: 1, maxLength: 2 }),
    )
    .filter(
      ([fields]) =>
        grouping !== `none` || Object.values(fields).some(hasAggregate),
    )
    .map(([generated, seeds]): Shape => {
      // A grouping with a string key always selects it, so string terms occur.
      const fields =
        orderKind({ k: `key` }, grouping) === `string`
          ? { ...generated, fk: { k: `key` } as Part }
          : generated
      const s: Shape = { fields }
      const selected = [...selectedAggregates(s)]
      // An aggregate term names an aggregate the select holds, if any.
      const usable = seeds.map((seed) =>
        selected.length === 0 || selected.includes(seed.fn)
          ? seed
          : { ...seed, fn: selected[0]! },
      )
      return { ...s, orderBy: orderTerms(s, usable, grouping) }
    })
}

/**
 * Whether a select field has an order the model can state: numbers, or the
 * string group key under the documented locale collation. Booleans, Dates,
 * `NaN`, nested objects, and values that mix types do not.
 */
function orderKind(
  part: Part,
  grouping: Grouping,
): `number` | `string` | undefined {
  switch (part.k) {
    case `lit`:
    case `parent`:
    case `agg`:
      return `number`
    case `add`:
      return orderKind(part.a, grouping) === `number` &&
        orderKind(part.b, grouping) === `number`
        ? `number`
        : undefined
    case `case`: {
      const a = orderKind(part.a, grouping)
      return a !== undefined && a === orderKind(part.b, grouping)
        ? a
        : undefined
    }
    case `key`:
      return groupsByRawKey(grouping) || grouping === `upper`
        ? `string`
        : undefined
    case `rawKey`:
      return groupsByRawKey(grouping) ? `string` : undefined
    default:
      return undefined
  }
}

type Step =
  | { t: `parent`; id: number; x: number }
  | { t: `insert`; k: string; v: number }
  | { t: `update`; pick: number; v: number; k?: string }
  | { t: `delete`; pick: number }
// `A` matches no parent, and shares a group with `a` under `upper(c.k)`.
const sourceKey = fc.constantFrom(`a`, `b`, `A`)
const step: fc.Arbitrary<Step> = fc.oneof(
  fc.record({
    t: fc.constant(`parent` as const),
    id: fc.constantFrom(1, 2),
    x: literal,
  }),
  fc.record({
    t: fc.constant(`insert` as const),
    k: sourceKey,
    v: literal,
  }),
  // An update can move a source row to another group and parent route.
  fc.record({
    t: fc.constant(`update` as const),
    pick: fc.nat(5),
    v: literal,
    k: fc.option(sourceKey, { nil: undefined }),
  }),
  fc.record({ t: fc.constant(`delete` as const), pick: fc.nat(5) }),
)

// --- Driver ----------------------------------------------------------------

/** Build the select value of a part from the query's refs. */
/** The group expression of the current history. */
let keyExpression: (c: any) => any = (c) => c.k
/** What the history passes to `groupBy`: its key, or for `pair` two keys. */
let groupExpressions: (c: any) => any = (c) => c.k

function build(p: Part, c: any, issue: any): any {
  switch (p.k) {
    case `lit`:
      return p.n
    case `parent`:
      return issue.x
    case `source`:
      return c.v
    case `key`:
      return keyExpression(c)
    case `rawKey`:
      return c.k
    case `agg`:
      return p.fn === `count`
        ? count(c.id)
        : p.fn === `sum`
          ? sum(c.v)
          : max(c.v)
    case `add`:
      return add(build(p.a, c, issue), build(p.b, c, issue))
    case `case`:
      return caseWhen(
        eq(build(p.cond, c, issue), p.lit),
        build(p.a, c, issue),
        build(p.b, c, issue),
      )
    case `nested`:
      return Object.fromEntries(
        Object.entries(p.fields).map(([key, child]) => [
          key,
          build(child, c, issue),
        ]),
      )
  }
}

function buildSelect(
  s: Shape,
  c: any,
  issue: any,
  q: any,
  issueSource: any,
): Record<string, any> {
  const fields: Record<string, any> = Object.fromEntries(
    Object.entries(s.fields).map(([key, p]) => [key, build(p, c, issue)]),
  )
  if (s.include) {
    const { wrap, at } = s.include
    // Each use builds its own child query, as separate select values do.
    const kids = () => {
      const child = q
        .from({ i: issueSource })
        .where(({ i }: any) => eq(i.k, c.k))
        .select(({ i }: any) => ({ id: i.id }))
      return wrap === `toArray`
        ? toArray(child)
        : wrap === `include`
          ? includeWrap(child)
          : wrap === `materialize`
            ? materialize(child)
            : child
    }
    // A constant condition, so the conditional reads no source field.
    fields.nestedKids =
      at === `field`
        ? kids()
        : at === `nested`
          ? { inner: kids() }
          : caseWhen(eq(1, 1), { inner: kids() }, { inner: kids() })
  }
  if (s.spread === `source`) return { ...c, ...fields }
  if (s.spread === `parent`) return { ...issue, ...fields }
  return fields
}

/**
 * A copy of query IR without its operator code, as hand-built IR that forgets
 * it would be: no grouping on the query or its aggregates, no runtime on its
 * includes. Source refs are kept as they are, because their identity is the
 * compiled input identity.
 */
function withoutOperatorCode<T>(value: T, stripped: Stripped): T {
  const grouping = stripped === `grouping`
  const runtime = stripped === `runtime`
  const copied = (node: any, fields: Record<string, unknown>) =>
    Object.assign(Object.create(Object.getPrototypeOf(node)), node, fields)
  const strip = (node: any): any => {
    if (Array.isArray(node)) return node.map(strip)
    if (node instanceof Aggregate)
      return copied(node, {
        args: strip(node.args),
        ...(grouping ? { grouping: undefined } : {}),
      })
    if (node instanceof IncludesSubquery)
      return copied(node, {
        query: strip(node.query),
        ...(runtime ? { runtime: undefined } : {}),
      })
    if (node instanceof QueryRef)
      return copied(node, { query: strip(node.query) })
    if (node instanceof UnionFrom || node instanceof UnionAll)
      return copied(
        node,
        Object.fromEntries(
          Object.entries(node).map(([key, field]) => [key, strip(field)]),
        ),
      )
    if (node instanceof Func) return copied(node, { args: strip(node.args) })
    if (node instanceof ConditionalSelect)
      return copied(node, {
        branches: node.branches.map((branch: any) => ({
          ...branch,
          condition: strip(branch.condition),
          value: strip(branch.value),
        })),
        defaultValue: strip(node.defaultValue),
      })
    if (node && Object.getPrototypeOf(node) === Object.prototype) {
      const fields = Object.fromEntries(
        Object.entries(node).map(([key, field]) => [key, strip(field)]),
      )
      if (grouping && `from` in node) fields.grouping = undefined
      return fields
    }
    return node
  }
  return strip(value)
}

/**
 * The published sequence splits into the model's blocks, in order. A
 * sequence with several blocks witnesses each kind of term it orders by.
 */
function expectOrder(
  label: string,
  shape: Shape,
  published: ReadonlyArray<unknown>,
  blocks: Array<Array<Record<string, unknown>>>,
): void {
  const rows = published.map((row: any) => stripVirtualProps(row))
  let at = 0
  for (const block of blocks) {
    expect(
      sortRows(rows.slice(at, at + block.length)),
      `${label} rows in orderBy position ${at}`,
    ).toEqual(block)
    at += block.length
  }
  expect(rows.length, `${label} row count`).toBe(at)
  if (blocks.length < 2) return
  const terms = shape.orderBy!
  if (terms.some((term) => term.by === `agg`))
    reach?.reach(`an aggregate orders the published rows`)
  if (terms.some((term) => term.by === `selected` && term.kind === `number`))
    reach?.reach(`a number select field orders the published rows`)
  const strings = terms.flatMap((term) =>
    term.by === `selected` && term.kind === `string` ? [term.field] : [],
  )
  if (strings.length > 0)
    reach?.reach(`a string select field orders the published rows`)
  // Locale and code-unit order differ only between `A` and a lowercase key.
  const keys = new Set(
    rows.flatMap((row: any) => strings.map((field) => row[field])),
  )
  if (keys.has(`A`) && (keys.has(`a`) || keys.has(`b`)))
    reach?.reach(`a string field orders A against a lowercase key`)
  if (terms.length > 1) reach?.reach(`two orderBy terms order the rows`)
}

/** A copy of query IR whose orderBy aggregates lack the grouping compiler. */
function withoutOrderByGrouping(ir: any): any {
  return {
    ...ir,
    orderBy: ir.orderBy?.map((clause: any) => ({
      ...clause,
      expression: Object.assign(
        Object.create(Object.getPrototypeOf(clause.expression)),
        clause.expression,
        { grouping: undefined },
      ),
    })),
  }
}

async function runHistory(
  top: Shape,
  nested: Shape,
  grouping: Grouping,
  shadow: boolean,
  steps: ReadonlyArray<Step>,
  union = false,
  bareKeys = false,
  stripped: Stripped = `none`,
  alone = false,
): Promise<void> {
  const grouped = grouping !== `none`
  // Most generated shapes throw on their own; a runtime-stripped history
  // needs an include that only the missing runtime can fail.
  if (stripped === `runtime`)
    nested = { fields: { f0: { k: `agg`, fn: `count` } } }
  // Half the grouping-stripped histories give the top-level query a select
  // that is valid on its own, with an aggregate HAVING when the generated
  // shape has one, so only the missing grouping compiler can fail it.
  if (stripped === `grouping` && alone)
    top = {
      fields: { f0: { k: `agg`, fn: `count` } },
      having: top.having && { part: { k: `agg`, fn: `count` }, lit: 2 },
    }
  // Likewise half the orderBy-stripped histories select the aggregate they
  // order by, so the select aggregate's compiler must order the rows.
  if (stripped === `orderBy` && alone) {
    const first = top.orderBy?.[0]
    const term: OrderTerm =
      first?.by === `agg` ? first : { by: `agg`, fn: `sum`, dir: `asc` }
    top = { fields: { f0: { k: `agg`, fn: term.fn } }, orderBy: [term] }
  }
  reach?.beginHistory()
  if (stripped === `runtime`) reach?.reach(`include runtime stripped`)
  for (const s of [top, nested]) {
    if (s.include?.wrap === `bare`)
      reach?.reach(`bare include: ${s.include.at}`)
    if (s.include?.wrap === `toArray` && s.include.at === `case`)
      reach?.reach(`toArray include in a conditional branch`)
    if (s.include?.wrap === `include` || s.include?.wrap === `materialize`)
      reach?.reach(`${s.include.wrap}() wrap`)
    if (grouped && bareKeys)
      reach?.reach(
        shapeHasAggregate(s)
          ? `bare group keys beside an aggregate`
          : `bare group keys without an aggregate`,
      )
  }
  // Each use builds a new list literal, as separate query callbacks do.
  keyExpression =
    grouping === `upper`
      ? (c) => upper(c.k)
      : grouping === `inList`
        ? (c) => inArray(c.k, [`a`, `b`])
        : grouping === `date`
          ? (c) => coalesce(c.d, new Date(5))
          : grouping === `nan`
            ? (c) => add(c.v, NaN)
            : (c) => c.k
  groupExpressions =
    grouping === `pair`
      ? (c) => [c.k, gt(c.v, 1)]
      : grouping === `triple`
        ? (c) => [c.k, gt(c.v, 1), gt(c.v, 2)]
        : keyExpression
  const suffix = Math.random().toString(36).slice(2)
  let issues: Array<Issue> = [
    { id: 1, k: `a`, x: 1 },
    { id: 2, k: `b`, x: 2 },
  ]
  // `A` matches no parent; under `upper(c.k)` it shares a group with `a`,
  // and a string term orders it between `a` and `b` in `en-US` collation.
  let comments: Array<Comment> = [
    { id: 10, k: `a`, v: 1 },
    { id: 11, k: `a`, v: 2 },
    { id: 12, k: `b`, v: 3 },
    { id: 13, k: `A`, v: 2 },
  ]
  let nextId = 20
  const issueSource = createCollection(
    mockSyncCollectionOptions<Issue>({
      id: `sg-issues-${suffix}`,
      getKey: (r) => r.id,
      initialData: issues,
    }),
  )
  const commentSource = createCollection(
    mockSyncCollectionOptions<Comment>({
      id: `sg-comments-${suffix}`,
      getKey: (r) => r.id,
      initialData: comments,
    }),
  )

  const compile = <T>(
    make: () => T,
  ): { ok: true; value: T } | { ok: false; error: unknown } => {
    try {
      return { ok: true, value: make() }
    } catch (error) {
      return { ok: false, error }
    }
  }
  // A grouped query groups by `c.k`; its select may read that group key.
  // After a unionAll, refs name fields of the union's rows, not a source
  // alias.
  const rowOf = (refs: any, alias: string | undefined) =>
    alias === undefined ? refs : refs[alias]
  const group = (query: any, alias: string | undefined) => {
    if (!grouped) return query
    const keys = (refs: any) => groupExpressions(rowOf(refs, alias))
    return query.groupBy(bareKeys ? keys : groupKeys(keys))
  }
  const having = (
    s: Shape,
    query: any,
    alias: string | undefined,
    issue?: any,
  ) =>
    s.having
      ? query.having((refs: any) =>
          eq(
            s.having!.selected === undefined
              ? build(s.having!.part, rowOf(refs, alias), issue)
              : refs.$selected[s.having!.selected],
            s.having!.lit,
          ),
        )
      : query
  // The include's source may shadow the parent alias. A parent ref captured
  // from the outer scope still names the parent row.
  const childAlias = shadow ? `issue` : `c`
  // The top-level query reads the comments directly, or through a unionAll
  // whose second branch is empty.
  const topSource = (q: any) =>
    union
      ? q.unionAll(
          q
            .from({ c: commentSource })
            .select(({ c }: any) => ({ id: c.id, k: c.k, v: c.v })),
          q
            .from({ e: commentSource })
            .where(({ e }: any) => eq(e.id, -1))
            .select(({ e }: any) => ({ id: e.id, k: e.k, v: e.v })),
        )
      : q.from({ c: commentSource })
  const topAlias = union ? undefined : `c`
  // The hand-built path compiles a copy of the built IR without its operator
  // code.
  const finish = (built: any) =>
    stripped === `none`
      ? built
      : new BaseQueryBuilder(
          stripped === `orderBy`
            ? withoutOrderByGrouping(getQueryIR(built))
            : withoutOperatorCode(getQueryIR(built), stripped),
        )
  // Each term is one `orderBy` call, in order; a string term passes the
  // documented locale collation.
  const order = (s: Shape, query: any, alias: string | undefined) =>
    (s.orderBy ?? []).reduce(
      (ordered: any, term: OrderTerm) =>
        ordered.orderBy(
          (refs: any) =>
            term.by === `agg`
              ? build({ k: `agg`, fn: term.fn }, rowOf(refs, alias), undefined)
              : refs.$selected[term.field],
          term.by === `selected` && term.kind === `string`
            ? { direction: term.dir, stringSort: `locale`, locale: `en-US` }
            : term.dir,
        ),
      query,
    )
  const topQuery = compile(() =>
    createLiveQueryCollection((q) =>
      finish(
        order(
          top,
          having(
            top,
            group(topSource(q), topAlias).select((refs: any) =>
              buildSelect(
                top,
                rowOf(refs, topAlias),
                undefined,
                q,
                issueSource,
              ),
            ),
            topAlias,
          ),
          topAlias,
        ),
      ),
    ),
  )
  const includeQuery = compile(() =>
    createLiveQueryCollection((q) =>
      finish(
        q.from({ issue: issueSource }).select(({ issue }) => ({
          id: issue.id,
          kids: toArray(
            order(
              nested,
              having(
                nested,
                group(
                  q
                    .from({ [childAlias]: commentSource })
                    .where((refs: any) => eq(refs[childAlias].k, issue.k)),
                  childAlias,
                ).select((refs: any) =>
                  buildSelect(nested, refs[childAlias], issue, q, issueSource),
                ),
                childAlias,
                issue,
              ),
              childAlias,
            ),
          ),
        })),
      ),
    ),
  )
  // Compilation: the query throws exactly when the model says no value exists.
  for (const [label, result, s] of [
    [`top`, topQuery, top],
    [`include`, includeQuery, nested],
  ] as const) {
    // The orderBy strip reaches the top-level query only.
    const errors = modelErrors(
      s,
      grouping,
      bareKeys,
      label === `include` && stripped === `orderBy` ? `none` : stripped,
    )
    // The include query's `kids` include loses its runtime too.
    if (stripped === `runtime` && label === `include`)
      errors.add(`includeRequired`)
    // A stripped grouping compiler is witnessed on a path only where no
    // other error could hide it.
    if (stripped === `grouping` && errors.size === 1 && shapeHasAggregate(s)) {
      reach?.reach(
        grouped
          ? `grouping stripped alone: grouped`
          : `grouping stripped alone: one group`,
      )
      if (
        s.having !== undefined &&
        s.having.selected === undefined &&
        hasAggregate(s.having.part)
      )
        reach?.reach(`grouping stripped alone: HAVING aggregate`)
    }
    if (
      stripped === `orderBy` &&
      label === `top` &&
      orderAggregates(s).length > 0 &&
      errors.size === 0
    )
      reach?.reach(`orderBy aggregate stripped beside a select aggregate`)
    // A nested include cannot correlate with a unionAll row, which has no
    // source alias, so the builder rejects it first.
    const unionInclude = label === `top` && union && s.include !== undefined
    if (errors.size > 0) {
      expect(result.ok, `${label} compile throws`).toBe(false)
      if (!result.ok && !unionInclude)
        expect(
          [...errors],
          `${label} error class (${String(result.error)})`,
        ).toContain(errorName(result.error))
    } else {
      expect(result.ok, `${label} compiles`).toBe(true)
    }
  }
  const live = [topQuery, includeQuery].flatMap((r) => (r.ok ? [r.value] : []))
  try {
    for (const query of live) await query.preload()
    const check = (label: string) => {
      if (topQuery.ok) {
        // A published row keeps the select's field order.
        for (const row of topQuery.value.toArray)
          expect(
            Object.keys(stripVirtualProps(row)),
            `${label}: top-level field order`,
          ).toEqual(Object.keys(top.fields))
        expect(
          sortRows(
            topQuery.value.toArray.map((row: any) => stripVirtualProps(row)),
          ),
          `${label}: top-level rows`,
        ).toEqual(modelGroup(top, comments, undefined, grouping))
        if (grouping === `pair` && topQuery.value.toArray.length > 1)
          reach?.reach(`two group keys publish several groups`)
        if (grouping === `triple` && topQuery.value.toArray.length > 1)
          reach?.reach(`three group keys publish several groups`)
        if (top.orderBy)
          expectOrder(
            `${label}: top-level`,
            top,
            topQuery.value.toArray,
            modelOrderBlocks(top, comments, undefined, grouping),
          )
      }
      if (includeQuery.ok) {
        for (const issue of issues) {
          const row = includeQuery.value.get(issue.id)
          expect(
            sortRows(
              (row?.kids ?? []).map((kid: any) => stripVirtualProps(kid)),
            ),
            `${label}: kids of issue ${issue.id}`,
          ).toEqual(
            modelGroup(
              nested,
              comments.filter((comment) => comment.k === issue.k),
              issue,
              grouping,
            ),
          )
          if (nested.orderBy && row) {
            expectOrder(
              `${label}: kids of issue ${issue.id}`,
              nested,
              row.kids,
              modelOrderBlocks(
                nested,
                comments.filter((comment) => comment.k === issue.k),
                issue,
                grouping,
              ),
            )
            reach?.reach(`an include query orders its rows`)
          }
        }
      }
    }
    check(`initial`)
    for (const [index, s] of steps.entries()) {
      if (s.t === `parent`) {
        const next = { ...issues.find((i) => i.id === s.id)!, x: s.x }
        issues = issues.map((i) => (i.id === s.id ? next : i))
        issueSource.utils.begin()
        issueSource.utils.write({ type: `update`, value: next })
        issueSource.utils.commit()
      } else if (s.t === `insert`) {
        const row = { id: nextId++, k: s.k, v: s.v }
        comments = [...comments, row]
        commentSource.utils.begin()
        commentSource.utils.write({ type: `insert`, value: row })
        commentSource.utils.commit()
      } else {
        if (comments.length === 0) continue
        const target = comments[s.pick % comments.length]!
        if (s.t === `update`) {
          const row = { ...target, v: s.v, k: s.k ?? target.k }
          comments = comments.map((c) => (c.id === target.id ? row : c))
          commentSource.utils.begin()
          commentSource.utils.write({ type: `update`, value: row })
          commentSource.utils.commit()
        } else {
          comments = comments.filter((c) => c.id !== target.id)
          commentSource.utils.begin()
          commentSource.utils.write({ type: `delete`, value: target })
          commentSource.utils.commit()
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
      check(`step ${index} ${JSON.stringify(s)}`)
    }
  } finally {
    for (const query of live) await query.cleanup()
    await issueSource.cleanup()
    await commentSource.cleanup()
  }
}

const groupings = [
  `none`,
  `key`,
  `upper`,
  `inList`,
  `date`,
  `nan`,
  `pair`,
  `triple`,
] as const satisfies ReadonlyArray<Grouping>

const historyFor = (
  grouping: Grouping,
  stripped: fc.Arbitrary<Stripped>,
  alone: fc.Arbitrary<boolean>,
  shapes: typeof shape = shape,
) =>
  fc.tuple(
    shapes(false, grouping),
    shapes(true, grouping),
    fc.constant(grouping),
    fc.boolean(),
    fc.array(step, { maxLength: 6 }),
    fc.boolean(),
    fc.boolean(),
    stripped,
    alone,
  )

// Half the histories are generated; three in six of those build their IR by
// hand without one kind of operator code. One history in four instead strips
// the grouping compiler, everywhere or from orderBy only, and takes the
// forced shape, for one or several groups chosen in turn. One in four takes
// ordered shapes that compile, at the top level and in the include query,
// and in one of three strips the orderBy aggregates' compiler. About 40
// histories of each kind per campaign of 160 make each reach state certain
// in practice: a campaign misses the rarest one about once in 1,500 seeds.
const history = fc.oneof(
  {
    weight: 2,
    arbitrary: fc
      .constantFrom(...groupings)
      .chain((grouping) =>
        historyFor(
          grouping,
          fc.oneof(
            { weight: 3, arbitrary: fc.constant<Stripped>(`none`) },
            fc.constant<Stripped>(`grouping`),
            fc.constant<Stripped>(`runtime`),
            fc.constant<Stripped>(`orderBy`),
          ),
          fc.boolean(),
        ),
      ),
  },
  {
    weight: 1,
    arbitrary: fc
      .constantFrom(
        ...([`none`, `key`, `pair`] as const).flatMap((grouping) =>
          ([`grouping`, `orderBy`] as const).map(
            (stripped) => [grouping, stripped] as const,
          ),
        ),
      )
      .chain(([grouping, stripped]) =>
        historyFor(grouping, fc.constant(stripped), fc.constant(true)),
      ),
  },
  {
    weight: 1,
    arbitrary: fc
      .constantFrom(...groupings)
      .chain((grouping) =>
        historyFor(
          grouping,
          fc.oneof(
            { weight: 2, arbitrary: fc.constant<Stripped>(`none`) },
            fc.constant<Stripped>(`orderBy`),
          ),
          fc.constant(false),
          orderedShape,
        ),
      ),
  },
)

/** The states the operator laws need; each campaign must reach all of them. */
const reachStates = [
  `bare include: field`,
  `bare include: nested`,
  `bare include: case`,
  `toArray include in a conditional branch`,
  `bare group keys without an aggregate`,
  `bare group keys beside an aggregate`,
  `include() wrap`,
  `materialize() wrap`,
  `grouping stripped alone: grouped`,
  `grouping stripped alone: one group`,
  `grouping stripped alone: HAVING aggregate`,
  `include runtime stripped`,
  `orderBy aggregate stripped beside a select aggregate`,
  `an aggregate orders the published rows`,
  `a number select field orders the published rows`,
  `a string select field orders the published rows`,
  `a string field orders A against a lowercase key`,
  `two orderBy terms order the rows`,
  `an include query orders its rows`,
  `two group keys publish several groups`,
  `three group keys publish several groups`,
] as const
let reach:
  ReturnType<typeof createOracleReach<(typeof reachStates)[number]>> | undefined

describe(`aggregate select shapes`, () => {
  it(`match the model across generated shapes (fixed campaign)`, async () => {
    // A repeatable baseline. Seed 2094 is arbitrary.
    reach = createOracleReach(`${PROPERTY} (fixed)`, reachStates)
    await fc.assert(
      fc.asyncProperty(
        history,
        ([
          top,
          nested,
          grouping,
          shadow,
          steps,
          union,
          bareKeys,
          stripped,
          alone,
        ]) =>
          runHistory(
            top,
            nested,
            grouping,
            shadow,
            steps,
            union,
            bareKeys,
            stripped,
            alone,
          ),
      ),
      { numRuns: oracleRuns(160), seed: 2094 },
    )
    reach.assertReached()
    reach = undefined
  })

  it(`match the model across generated shapes (random or replayed)`, async () => {
    reach = createOracleReach(`${PROPERTY} (random)`, reachStates)
    await fc.assert(
      fc.asyncProperty(
        history,
        ([
          top,
          nested,
          grouping,
          shadow,
          steps,
          union,
          bareKeys,
          stripped,
          alone,
        ]) =>
          runHistory(
            top,
            nested,
            grouping,
            shadow,
            steps,
            union,
            bareKeys,
            stripped,
            alone,
          ),
      ),
      oraclePropertyOptions(160, PROPERTY),
    )
    reach.assertReached()
    reach = undefined
  })

  // Pinned replay of a review counterexample: a grouped select value that
  // holds the group key inside a function must read the group's key.
  it(`reads the group key inside a function`, async () => {
    await runHistory(
      { fields: { f0: { k: `add`, a: { k: `lit`, n: 0 }, b: { k: `key` } } } },
      { fields: { f0: { k: `agg`, fn: `count` } } },
      `key`,
      false,
      [],
    )
  })

  // Pinned replay: a published row keeps the select's field order, also
  // when a group key comes before a plain aggregate.
  it(`keeps the select's field order`, async () => {
    await runHistory(
      {
        fields: {
          f0: { k: `key` },
          f1: { k: `agg`, fn: `count` },
        },
      },
      { fields: { f0: { k: `agg`, fn: `count` } } },
      `key`,
      false,
      [],
    )
  })

  // Pinned replay of a generated counterexample: an aggregate query without
  // groupBy whose select wraps its only aggregate still accepts HAVING.
  it(`accepts HAVING beside a wrapped aggregate without groupBy`, async () => {
    await runHistory(
      {
        fields: {
          f0: { k: `add`, a: { k: `agg`, fn: `count` }, b: { k: `lit`, n: 1 } },
        },
        having: { part: { k: `lit`, n: 0 }, lit: 0 },
      },
      {
        fields: {
          f0: { k: `add`, a: { k: `agg`, fn: `count` }, b: { k: `parent` } },
        },
        having: { part: { k: `parent` }, lit: 1 },
      },
      `none`,
      false,
      [],
    )
  })

  // Pinned replay: a parent field stays legal when the include's source
  // shadows the parent alias.
  it(`reads a parent field under a shadowing child alias`, async () => {
    await runHistory(
      { fields: { f0: { k: `agg`, fn: `count` } } },
      {
        fields: {
          f0: { k: `parent` },
          f1: { k: `agg`, fn: `count` },
        },
      },
      `none`,
      true,
      [],
    )
  })

  // Pinned witness: a group key that holds a literal object or NaN matches a
  // select value that builds the same literal again.
  it(`matches group keys holding array, Date and NaN literals`, async () => {
    const source = createCollection(
      mockSyncCollectionOptions<{ id: number; v: number; d: Date | null }>({
        id: `sg-literals-${Math.random().toString(36).slice(2)}`,
        getKey: (r) => r.id,
        initialData: [{ id: 1, v: 1, d: null }],
      }),
    )
    const keys: Record<string, (c: any) => any> = {
      array: (c) => inArray(c.v, [1, 2]),
      date: (c) => coalesce(c.d, new Date(5)),
      nan: (c) => add(c.v, NaN),
    }
    for (const [name, key] of Object.entries(keys)) {
      const query = createLiveQueryCollection((q) =>
        q
          .from({ c: source })
          .groupBy(groupKeys(({ c }) => key(c)))
          .select(({ c }) => ({ g: key(c), n: count(c.id) })),
      )
      await query.preload()
      expect(
        query.toArray.map((row: any) => [row.g, row.n]),
        name,
      ).toEqual([
        [name === `array` ? true : name === `date` ? new Date(5) : NaN, 1],
      ])
      await query.cleanup()
    }
    await source.cleanup()
  })
})
