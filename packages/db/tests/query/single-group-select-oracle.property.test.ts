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
} from '../../src/query/index.js'
import { NonAggregateExpressionNotInGroupByError } from '../../src/errors.js'
import { mockSyncCollectionOptions, stripVirtualProps } from '../utils.js'
import { oraclePropertyOptions, oracleRuns } from '../oracle-config.js'

/**
 * # What does an aggregate without `groupBy` publish beside its aggregates?
 *
 * An aggregate query without `groupBy` has one group: all source rows at the
 * top level, or one group for each parent route inside an include. A select
 * value has a value for that group only when every part of it outside an
 * aggregate is constant within the group:
 *
 * - a literal;
 * - inside an include, a field of the parent row, which the route supplies.
 *
 * A field of the query's own source outside an aggregate has no single value,
 * so the query throws `NonAggregateExpressionNotInGroupByError` when it
 * compiles, as it does with `groupBy`. That holds wherever the field appears:
 * directly, inside a function, in a conditional's condition or branch, or in
 * a nested object. A spread throws as well: the parent context of a route holds
 * only the parent fields the query names, and a source spread has no single
 * value. Authority: maintainer decision (2026-10-09) to reject, not drop,
 * such fields; `ARCHITECTURE.md` states the law.
 *
 * The model evaluates a select shape over plain rows: each aggregate over the
 * group's source rows, each parent field from the parent's current row, each
 * literal as itself, `add` and `caseWhen(eq(...))` as arithmetic. A group with
 * no source rows publishes no row. The model never reads the compiler.
 *
 * The grammar generates a select object of one to three fields, each a tree of
 * depth at most two over literals, parent fields (include only), source fields,
 * and the aggregates `count`, `sum` and `max`, combined by `add` and
 * `caseWhen`. A field can also be a nested object of such expressions. A
 * shape may spread the source or the parent row. Every shape
 * holds at least one aggregate. Each history runs the shape at the top level
 * and inside an include, then applies parent updates and source inserts,
 * updates and deletes. After each step the driver compares the published rows
 * with the model, or that compilation threw when the model says it must.
 *
 * Limits: one parent field (`x`) and one source field (`v`); numbers only; no
 * `groupBy` (the grouped path keeps its own validation); no nested include
 * beside the aggregate (the compiler replaces it before this check).
 */

const PROPERTY = `single-group.select-shapes`

type Part =
  | { k: `lit`; n: number }
  | { k: `parent` }
  | { k: `source` }
  | { k: `agg`; fn: `count` | `sum` | `max` }
  | { k: `add`; a: Part; b: Part }
  | { k: `case`; cond: Part; lit: number; a: Part; b: Part }
  | { k: `nested`; fields: Record<string, Part> }

type Shape = {
  fields: Record<string, Part>
  spread?: `source` | `parent`
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

/** A source field outside an aggregate has no value for the group. */
function readsSourceOutsideAggregate(part: Part): boolean {
  switch (part.k) {
    case `source`:
      return true
    case `add`:
      return [part.a, part.b].some(readsSourceOutsideAggregate)
    case `case`:
      return [part.cond, part.a, part.b].some(readsSourceOutsideAggregate)
    case `nested`:
      return Object.values(part.fields).some(readsSourceOutsideAggregate)
    default:
      return false
  }
}

function modelThrows(shape: Shape): boolean {
  return (
    shape.spread !== undefined ||
    Object.values(shape.fields).some(readsSourceOutsideAggregate)
  )
}

function evaluate(
  part: Part,
  rows: ReadonlyArray<Comment>,
  parent: Issue | undefined,
): unknown {
  switch (part.k) {
    case `lit`:
      return part.n
    case `parent`:
      return parent!.x
    case `source`:
      throw new Error(`unreachable: the model throws first`)
    case `agg`:
      if (part.fn === `count`) return rows.length
      if (part.fn === `sum`) return rows.reduce((t, r) => t + r.v, 0)
      return Math.max(...rows.map((r) => r.v))
    case `add`:
      return (
        (evaluate(part.a, rows, parent) as number) +
        (evaluate(part.b, rows, parent) as number)
      )
    case `case`:
      return evaluate(part.cond, rows, parent) === part.lit
        ? evaluate(part.a, rows, parent)
        : evaluate(part.b, rows, parent)
    case `nested`:
      return Object.fromEntries(
        Object.entries(part.fields).map(([key, child]) => [
          key,
          evaluate(child, rows, parent),
        ]),
      )
  }
}

function modelGroup(
  shape: Shape,
  rows: ReadonlyArray<Comment>,
  parent: Issue | undefined,
): Array<Record<string, unknown>> {
  if (rows.length === 0) return []
  return [
    Object.fromEntries(
      Object.entries(shape.fields).map(([key, part]) => [
        key,
        evaluate(part, rows, parent),
      ]),
    ),
  ]
}

// --- Grammar ---------------------------------------------------------------

const literal = fc.integer({ min: 0, max: 3 })
const leaf = (include: boolean): fc.Arbitrary<Part> =>
  fc.oneof(
    literal.map((n): Part => ({ k: `lit`, n })),
    ...(include ? [fc.constant<Part>({ k: `parent` })] : []),
    fc.constant<Part>({ k: `source` }),
    fc
      .constantFrom(`count` as const, `sum` as const, `max` as const)
      .map((fn): Part => ({ k: `agg`, fn })),
  )
// Function arguments and conditions are expressions; a nested object is a
// select value, so it appears only as a field.
const expression = (include: boolean, depth: number): fc.Arbitrary<Part> =>
  depth === 0
    ? leaf(include)
    : fc.oneof(
        { weight: 3, arbitrary: leaf(include) },
        fc
          .record({
            a: expression(include, depth - 1),
            b: expression(include, depth - 1),
          })
          .map(({ a, b }): Part => ({ k: `add`, a, b })),
        fc
          .record({
            cond: expression(include, depth - 1),
            lit: literal,
            a: expression(include, depth - 1),
            b: expression(include, depth - 1),
          })
          .map((c): Part => ({ k: `case`, ...c })),
      )
const part = (include: boolean, depth: number): fc.Arbitrary<Part> =>
  fc.oneof(
    { weight: 4, arbitrary: expression(include, depth) },
    fc
      .dictionary(fc.constantFrom(`p`, `q`), expression(include, depth - 1), {
        minKeys: 1,
        maxKeys: 2,
      })
      .map((fields): Part => ({ k: `nested`, fields })),
  )
const shape = (include: boolean): fc.Arbitrary<Shape> =>
  fc
    .record({
      fields: fc.dictionary(
        fc.constantFrom(`f0`, `f1`, `f2`),
        part(include, 2),
        {
          minKeys: 1,
          maxKeys: 3,
        },
      ),
      spread: fc.option(
        fc.constantFrom<`source` | `parent`>(
          ...(include
            ? ([`source`, `parent`] as const)
            : ([`source`] as const)),
        ),
        { nil: undefined, freq: 5 },
      ),
    })
    .filter((s) => Object.values(s.fields).some(hasAggregate))

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
function build(p: Part, c: any, issue: any): any {
  switch (p.k) {
    case `lit`:
      return p.n
    case `parent`:
      return issue.x
    case `source`:
      return c.v
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

function buildSelect(s: Shape, c: any, issue: any): Record<string, any> {
  const fields = Object.fromEntries(
    Object.entries(s.fields).map(([key, p]) => [key, build(p, c, issue)]),
  )
  if (s.spread === `source`) return { ...c, ...fields }
  if (s.spread === `parent`) return { ...issue, ...fields }
  return fields
}

async function runHistory(
  top: Shape,
  nested: Shape,
  steps: ReadonlyArray<Step>,
): Promise<void> {
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
  const topQuery = compile(() =>
    createLiveQueryCollection((q) =>
      q
        .from({ c: commentSource })
        .select(({ c }) => buildSelect(top, c, undefined)),
    ),
  )
  const includeQuery = compile(() =>
    createLiveQueryCollection((q) =>
      q.from({ issue: issueSource }).select(({ issue }) => ({
        id: issue.id,
        kids: toArray(
          q
            .from({ c: commentSource })
            .where(({ c }) => eq(c.k, issue.k))
            .select(({ c }) => buildSelect(nested, c, issue)),
        ),
      })),
    ),
  )
  // Compilation: the query throws exactly when the model says no value exists.
  for (const [label, result, s] of [
    [`top`, topQuery, top],
    [`include`, includeQuery, nested],
  ] as const) {
    if (modelThrows(s)) {
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
          topQuery.value.toArray.map((row: any) => stripVirtualProps(row)),
          `${label}: top-level rows`,
        ).toEqual(modelGroup(top, comments, undefined))
      }
      if (includeQuery.ok) {
        for (const issue of issues) {
          const row = includeQuery.value.get(issue.id) as any
          expect(
            (row?.kids ?? []).map((kid: any) => stripVirtualProps(kid)),
            `${label}: kids of issue ${issue.id}`,
          ).toEqual(
            modelGroup(
              nested,
              comments.filter((comment) => comment.k === issue.k),
              issue,
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

const history = fc.tuple(
  shape(false),
  shape(true),
  fc.array(step, { maxLength: 6 }),
)

describe(`single-group select shapes`, () => {
  it(`match the model across generated shapes (fixed campaign)`, async () => {
    // A repeatable baseline. Seed 2094 is arbitrary.
    await fc.assert(
      fc.asyncProperty(history, ([top, nested, steps]) =>
        runHistory(top, nested, steps),
      ),
      { numRuns: oracleRuns(120), seed: 2094 },
    )
  })

  it(`match the model across generated shapes (random or replayed)`, async () => {
    await fc.assert(
      fc.asyncProperty(history, ([top, nested, steps]) =>
        runHistory(top, nested, steps),
      ),
      oraclePropertyOptions(120, PROPERTY),
    )
  })
})
