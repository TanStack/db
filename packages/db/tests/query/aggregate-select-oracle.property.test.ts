import { describe, expect, it } from 'vitest'
import { fc } from '@fast-check/vitest'
import { createCollection } from '../../src/collection/index.js'
import {
  add,
  caseWhen,
  count,
  createLiveQueryCollection,
  eq,
  max,
  sum,
  toArray,
  upper,
} from '../../src/query/index.js'
import { NonAggregateExpressionNotInGroupByError } from '../../src/errors.js'
import { mockSyncCollectionOptions, stripVirtualProps } from '../utils.js'
import { oraclePropertyOptions, oracleRuns } from '../oracle-config.js'

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
 * Each history also chooses whether both queries group, by the ref `c.k` or
 * by the computed `upper(c.k)`, and a shape may hold a nested include. A
 * grouped history favours the group key over source fields, and conditions
 * can compare with key values, so a missing key changes the branch taken. Group order is not part of the law, so rows are
 * compared in a fixed order.
 *
 * Limits: one parent field (`x`), one source field (`v`) and one group key
 * (`k`); numbers only.
 */

const PROPERTY = `aggregate.select-shapes`

type Part =
  | { k: `lit`; n: number }
  | { k: `parent` }
  | { k: `source` }
  | { k: `key` }
  | { k: `agg`; fn: `count` | `sum` | `max` }
  | { k: `add`; a: Part; b: Part }
  | { k: `case`; cond: Part; lit: number | string; a: Part; b: Part }
  | { k: `nested`; fields: Record<string, Part> }

type Shape = {
  fields: Record<string, Part>
  spread?: `source` | `parent`
  /** A nested include beside the aggregate. */
  include?: boolean
}

/**
 * How a history groups: not at all, by the ref `c.k`, or by the computed
 * expression `upper(c.k)`. The `key` leaf is that group expression.
 */
type Grouping = `none` | `key` | `upper`

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
function readsSourceOutsideAggregate(part: Part, grouped: boolean): boolean {
  const reads = (child: Part) => readsSourceOutsideAggregate(child, grouped)
  switch (part.k) {
    case `source`:
      return true
    case `key`:
      return !grouped
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

function modelThrows(shape: Shape, grouped: boolean): boolean {
  return (
    shape.spread !== undefined ||
    shape.include === true ||
    Object.values(shape.fields).some((part) =>
      readsSourceOutsideAggregate(part, grouped),
    )
  )
}

function groupKeyOf(row: Comment, grouping: Grouping): string {
  return grouping === `upper` ? row.k.toUpperCase() : row.k
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

/** One published row per group; a grouped query groups by `k`. */
function modelGroup(
  shape: Shape,
  rows: ReadonlyArray<Comment>,
  parent: Issue | undefined,
  grouping: Grouping,
): Array<Record<string, unknown>> {
  const groups =
    grouping !== `none`
      ? [...new Set(rows.map((row) => groupKeyOf(row, grouping)))].map((k) =>
          rows.filter((row) => groupKeyOf(row, grouping) === k),
        )
      : rows.length === 0
        ? []
        : [rows]
  return sortRows(
    groups.map((group) =>
      Object.fromEntries(
        Object.entries(shape.fields).map(([key, part]) => [
          key,
          evaluate(part, group, parent, grouping),
        ]),
      ),
    ),
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
      include: fc.boolean().map((b) => (b ? true : undefined)),
    })
    .filter(
      (s) => grouping !== `none` || Object.values(s.fields).some(hasAggregate),
    )

type Step =
  | { t: `parent`; id: number; x: number }
  | { t: `insert`; k: string; v: number }
  | { t: `update`; pick: number; v: number }
  | { t: `delete`; pick: number }
const step: fc.Arbitrary<Step> = fc.oneof(
  fc.record({
    t: fc.constant(`parent` as const),
    id: fc.constantFrom(1, 2),
    x: literal,
  }),
  fc.record({
    t: fc.constant(`insert` as const),
    k: fc.constantFrom(`a`, `b`),
    v: literal,
  }),
  fc.record({ t: fc.constant(`update` as const), pick: fc.nat(5), v: literal }),
  fc.record({ t: fc.constant(`delete` as const), pick: fc.nat(5) }),
)

// --- Driver ----------------------------------------------------------------

/** Build the select value of a part from the query's refs. */
/** The group expression of the current history. */
let keyExpression: (c: any) => any = (c) => c.k

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
  if (s.include)
    fields.nestedKids = toArray(
      q
        .from({ i: issueSource })
        .where(({ i }: any) => eq(i.k, c.k))
        .select(({ i }: any) => ({ id: i.id })),
    )
  if (s.spread === `source`) return { ...c, ...fields }
  if (s.spread === `parent`) return { ...issue, ...fields }
  return fields
}

async function runHistory(
  top: Shape,
  nested: Shape,
  grouping: Grouping,
  steps: ReadonlyArray<Step>,
): Promise<void> {
  const grouped = grouping !== `none`
  keyExpression = grouping === `upper` ? (c) => upper(c.k) : (c) => c.k
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
  const group = (query: any) =>
    grouped ? query.groupBy(({ c }: any) => keyExpression(c)) : query
  const topQuery = compile(() =>
    createLiveQueryCollection((q) =>
      group(q.from({ c: commentSource })).select(({ c }: any) =>
        buildSelect(top, c, undefined, q, issueSource),
      ),
    ),
  )
  const includeQuery = compile(() =>
    createLiveQueryCollection((q) =>
      q.from({ issue: issueSource }).select(({ issue }) => ({
        id: issue.id,
        kids: toArray(
          group(
            q.from({ c: commentSource }).where(({ c }) => eq(c.k, issue.k)),
          ).select(({ c }: any) =>
            buildSelect(nested, c, issue, q, issueSource),
          ),
        ),
      })),
    ),
  )
  // Compilation: the query throws exactly when the model says no value exists.
  for (const [label, result, s] of [
    [`top`, topQuery, top],
    [`include`, includeQuery, nested],
  ] as const) {
    if (modelThrows(s, grouped)) {
      expect(result.ok, `${label} compile throws`).toBe(false)
      if (!result.ok)
        expect(result.error, `${label} error class`).toBeInstanceOf(
          NonAggregateExpressionNotInGroupByError,
        )
    } else {
      expect(result.ok, `${label} compiles`).toBe(true)
    }
  }
  const live = [topQuery, includeQuery].flatMap((r) => (r.ok ? [r.value] : []))
  try {
    for (const query of live) await query.preload()
    const check = (label: string) => {
      if (topQuery.ok) {
        expect(
          sortRows(
            topQuery.value.toArray.map((row: any) => stripVirtualProps(row)),
          ),
          `${label}: top-level rows`,
        ).toEqual(modelGroup(top, comments, undefined, grouping))
      }
      if (includeQuery.ok) {
        for (const issue of issues) {
          const row = includeQuery.value.get(issue.id) as any
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
          const row = { ...target, v: s.v }
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

const history = fc
  .constantFrom<Grouping>(`none`, `key`, `upper`)
  .chain((grouping) =>
    fc.tuple(
      shape(false, grouping),
      shape(true, grouping),
      fc.constant(grouping),
      fc.array(step, { maxLength: 6 }),
    ),
  )

describe(`aggregate select shapes`, () => {
  it(`match the model across generated shapes (fixed campaign)`, async () => {
    // A repeatable baseline. Seed 2094 is arbitrary.
    await fc.assert(
      fc.asyncProperty(history, ([top, nested, grouping, steps]) =>
        runHistory(top, nested, grouping, steps),
      ),
      { numRuns: oracleRuns(120), seed: 2094 },
    )
  })

  it(`match the model across generated shapes (random or replayed)`, async () => {
    await fc.assert(
      fc.asyncProperty(history, ([top, nested, grouping, steps]) =>
        runHistory(top, nested, grouping, steps),
      ),
      oraclePropertyOptions(120, PROPERTY),
    )
  })

  // Pinned replay of a review counterexample: a grouped select value that
  // holds the group key inside a function must read the group's key.
  it(`reads the group key inside a function`, async () => {
    await runHistory(
      { fields: { f0: { k: `add`, a: { k: `lit`, n: 0 }, b: { k: `key` } } } },
      { fields: { f0: { k: `agg`, fn: `count` } } },
      `key`,
      [],
    )
  })
})
