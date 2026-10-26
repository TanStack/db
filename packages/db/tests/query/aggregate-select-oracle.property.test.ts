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
 * the generated shape has one. One history in three is such a forced
 * history: it strips the grouping compiler everywhere or from orderBy only,
 * with no grouping, one key, or two keys, in turn, so every campaign reaches
 * each path whatever its seed. A model error set of exactly
 * `groupingRequired` then witnesses each path, grouped, one implicit group,
 * and HAVING, where no other error can hide the missing compiler. The
 * property declares the states these laws need with `createOracleReach` and
 * fails when a campaign does not reach each of them.
 *
 * The top-level query may order its groups by one aggregate, ascending or
 * descending. Published rows then fall into blocks of equal orderBy value in
 * that order; order within a block is not part of the law. In one generated
 * history of six, and in half the forced ones, the driver strips the grouping compiler from the orderBy aggregate
 * only; the query then compiles with the compiler that `groupKeys()` or a
 * select or HAVING aggregate brings, and throws `GroupingOperatorRequiredError`
 * when none does. Half the generated ones and all forced ones select the
 * aggregate they order by, so only that path can fail them.
 *
 * Limits: one parent field (`x`) and one source field (`v`); groups by one
 * key or by the pair `c.k`, `gt(c.v, 1)`; numbers only. orderBy appears only
 * on the top-level query and on one aggregate. A nested include in a unionAll query is rejected
 * before compilation, so the driver checks only that it throws.
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
   * A top-level `orderBy` on one aggregate. Like a HAVING aggregate, it reads
   * the same aggregate selected as a top-level field.
   */
  orderBy?: { fn: `count` | `sum` | `max`; dir: `asc` | `desc` }
  /**
   * A nested include beside the aggregate: wrapped in `toArray()` or bare, as
   * a field, inside a nested object, or in both branches of a conditional.
   */
  include?: {
    wrap: `toArray` | `include` | `materialize` | `bare`
    at: `field` | `nested` | `case`
  }
}

/**
 * How a history groups: not at all, by the ref `c.k`, or by the computed
 * expression `upper(c.k)` or `inArray(c.k, ['a', 'b'])`. The `key` leaf is
 * that group expression, built again with a new list literal each time.
 * `pair` groups by two keys, `c.k` and `gt(c.v, 1)`; its `key` leaf is `c.k`,
 * and an update of `v` can move a row to another group.
 */
type Grouping = `none` | `key` | `upper` | `inList` | `date` | `nan` | `pair`

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
      return grouping !== `key` && grouping !== `pair`
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

/** An aggregate in the select, HAVING, or orderBy brings the grouping compiler. */
function shapeHasAggregate(shape: Shape): boolean {
  return selectOrHavingAggregate(shape) || shape.orderBy !== undefined
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
    shape.orderBy !== undefined &&
    !(grouping !== `none` && !bareKeys) &&
    !selectOrHavingAggregate(shape)
  )
    errors.add(`groupingRequired`)
  // An orderBy aggregate reads the same aggregate selected as a top-level
  // field. The docs state this rule for HAVING only (error 72); `main`
  // applies it to orderBy too, and this model keeps that behavior.
  if (
    shape.orderBy !== undefined &&
    !selectedAggregates(shape).has(shape.orderBy.fn)
  )
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

/**
 * The published order under `orderBy`: blocks of rows with equal orderBy
 * values, in ascending or descending value order. Order within a block is
 * not part of the law.
 */
function modelOrderBlocks(
  shape: Shape,
  rows: ReadonlyArray<Comment>,
  grouping: Grouping,
): Array<Array<Record<string, unknown>>> {
  const { fn, dir } = shape.orderBy!
  const keyed = modelGroups(shape, rows, undefined, grouping).map((group) => ({
    value: evaluate({ k: `agg`, fn }, group, undefined, grouping) as number,
    row: modelRow(shape, group, undefined, grouping),
  }))
  const values = [...new Set(keyed.map(({ value }) => value))].sort((a, b) =>
    dir === `asc` ? a - b : b - a,
  )
  return values.map((value) =>
    sortRows(keyed.filter((k) => k.value === value).map(({ row }) => row)),
  )
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
      // Only the top-level query, which has no parent, orders its groups.
      orderBy: include
        ? fc.constant(undefined)
        : fc.option(
            fc.record({
              fn: fc.constantFrom(
                `count` as const,
                `sum` as const,
                `max` as const,
              ),
              dir: fc.constantFrom(`asc` as const, `desc` as const),
            }),
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
    const order = top.orderBy ?? { fn: `sum`, dir: `asc` }
    top = { fields: { f0: { k: `agg`, fn: order.fn } }, orderBy: order }
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
    grouping === `pair` ? (c) => [c.k, gt(c.v, 1)] : keyExpression
  const suffix = Math.random().toString(36).slice(2)
  let issues: Array<Issue> = [
    { id: 1, k: `a`, x: 1 },
    { id: 2, k: `b`, x: 2 },
  ]
  let comments: Array<Comment> = [
    { id: 10, k: `a`, v: 1 },
    { id: 11, k: `a`, v: 2 },
    { id: 12, k: `b`, v: 3 },
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
  const order = (s: Shape, query: any, alias: string | undefined) =>
    s.orderBy
      ? query.orderBy(
          (refs: any) =>
            build(
              { k: `agg`, fn: s.orderBy!.fn },
              rowOf(refs, alias),
              undefined,
            ),
          s.orderBy.dir,
        )
      : query
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
    const errors = modelErrors(s, grouping, bareKeys, stripped)
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
      s.orderBy !== undefined &&
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
        if (top.orderBy) {
          // The published sequence splits into the model's blocks in order.
          const published = topQuery.value.toArray.map((row: any) =>
            stripVirtualProps(row),
          )
          const blocks = modelOrderBlocks(top, comments, grouping)
          let at = 0
          for (const block of blocks) {
            expect(
              sortRows(published.slice(at, at + block.length)),
              `${label}: rows in orderBy position ${at}`,
            ).toEqual(block)
            at += block.length
          }
          if (blocks.length > 1)
            reach?.reach(`orderBy aggregate orders the published rows`)
        }
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
] as const satisfies ReadonlyArray<Grouping>

const historyFor = (
  grouping: Grouping,
  stripped: fc.Arbitrary<Stripped>,
  alone: fc.Arbitrary<boolean>,
) =>
  fc.tuple(
    shape(false, grouping),
    shape(true, grouping),
    fc.constant(grouping),
    fc.boolean(),
    fc.array(step, { maxLength: 6 }),
    fc.boolean(),
    fc.boolean(),
    stripped,
    alone,
  )

// Three generated histories in six build their IR by hand without one kind
// of operator code. One history in three instead strips the grouping
// compiler, everywhere or from orderBy only, and takes the forced shape,
// for one or several groups chosen in turn. About 40 forced histories per
// campaign make each path's reach state certain in practice: a campaign
// misses the rarest one about once in 1,500 seeds.
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
  `orderBy aggregate orders the published rows`,
  `two group keys publish several groups`,
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
      { numRuns: oracleRuns(120), seed: 2094 },
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
      oraclePropertyOptions(120, PROPERTY),
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
