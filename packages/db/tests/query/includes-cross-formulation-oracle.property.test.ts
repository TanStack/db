import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, test } from 'vitest'
import { Temporal } from 'temporal-polyfill'
import { Func, PropRef, Value } from '../../src/query/ir.js'
import { createCollection } from '../../src/collection/index.js'
import { createFilterFunctionFromExpression } from '../../src/collection/change-events.js'
import {
  and,
  count,
  createLiveQueryCollection,
  eq,
  isNull,
  lt,
  not,
  queryOnce,
  toArray,
} from '../../src/query/index.js'
import { oraclePropertyOptions } from '../oracle-config.js'
import { flushPromises } from '../utils.js'
import { createControlledCollection as createOracleControlledCollection } from './includes-oracle-helpers.js'
import type { Collection } from '../../src/collection/index.js'
import type { LoadSubsetOptions } from '../../src/types.js'
import type { BasicExpression } from '../../src/query/ir.js'
import type { ControlledCollection } from './includes-oracle-helpers.js'

type ParentRow = {
  id: number
  group: number
  position: number
}

type ChildRow = {
  id: number
  parentGroup: number
  score: number | null
  position: number
}

type CrossFormulationAction =
  | { type: `putParent`; row: ParentRow }
  | { type: `deleteParent`; id: number }
  | { type: `putChild`; row: ChildRow }
  | { type: `deleteChild`; id: number }

type CrossFormulationScenario = {
  parents: Array<ParentRow>
  children: Array<ChildRow>
  pivot: number
  actions: Array<CrossFormulationAction>
}

type NormalizedParent = ParentRow & {
  children: Array<ChildRow>
}

type FlatRow = {
  parentId: number
  parentGroup: number
  parentPosition: number
  child: ChildRow | undefined
}

type ReferenceKey = { code: number }

type ReferenceParent = {
  id: number
  group: ReferenceKey
}

type ReferenceChild = {
  id: number
  parentGroup: ReferenceKey
}

type ReferenceRequest =
  | { readonly type: `ref`; readonly path: ReadonlyArray<string> }
  | { readonly type: `val`; readonly value: unknown }
  | {
      readonly type: `func`
      readonly name: string
      readonly args: ReadonlyArray<ReferenceRequest>
    }

// Copy request structure, but preserve opaque key identities. This finite
// provider accepts only unbounded parentGroup eq/in predicates and conjunctions.
function captureReferenceRequest(
  expression: BasicExpression,
): ReferenceRequest {
  switch (expression.type) {
    case `ref`:
      return Object.freeze({
        type: `ref`,
        path: Object.freeze([...expression.path]),
      })
    case `val`: {
      const value: unknown = expression.value
      return Object.freeze({
        type: `val`,
        value: Array.isArray(value) ? Object.freeze([...value]) : value,
      })
    }
    case `func`:
      return Object.freeze({
        type: `func`,
        name: expression.name,
        args: Object.freeze(expression.args.map(captureReferenceRequest)),
      })
  }
}

function referenceRequestPredicate(
  request: ReferenceRequest | undefined,
): (row: ReferenceChild) => boolean {
  if (!request) return () => true
  if (request.type === `func`) {
    if (request.name === `and` && request.args.length > 0) {
      const predicates = request.args.map(referenceRequestPredicate)
      return (row) => predicates.every((predicate) => predicate(row))
    }
    let [reference, constant] = request.args
    if (request.name === `eq` && reference?.type === `val`) {
      ;[reference, constant] = [constant, reference]
    }
    if (
      request.args.length === 2 &&
      reference?.type === `ref` &&
      reference.path.length === 1 &&
      reference.path[0] === `parentGroup` &&
      constant?.type === `val`
    ) {
      const value = constant.value
      if (request.name === `eq`) return (row) => row.parentGroup === value
      if (request.name === `in` && Array.isArray(value))
        return (row) => value.some((key: unknown) => row.parentGroup === key)
    }
  }
  throw new Error(`Unsupported cold reference fixture predicate`)
}

type ReferenceContextParent = {
  id: number
  group: number
  expected: ReferenceKey
  revision?: number
}

type ReferenceContextChild = {
  id: number
  group: number
  token: ReferenceKey
}

// Public VirtualRowProps and docs/guides/live-queries.md name only these keys.
// Their values/presence are a separate metadata law, not part of this projection.
const virtualKeys = new Set<string>([
  `$synced`,
  `$origin`,
  `$key`,
  `$collectionId`,
])

function assertSelectedKeys(
  value: object,
  keys: ReadonlyArray<string>,
  context: string,
): void {
  expect(value, context).not.toBeNull()
  const actual = Reflect.ownKeys(value).filter(
    (key) => typeof key !== `string` || !virtualKeys.has(key),
  )
  expect(new Set(actual), context).toEqual(new Set(keys))
}

function assertArrayKeys(value: ReadonlyArray<unknown>, context: string): void {
  expect(new Set(Reflect.ownKeys(value)), context).toEqual(
    new Set([
      `length`,
      ...Array.from({ length: value.length }, (_, index) => String(index)),
    ]),
  )
}

async function withCleanup(
  work: () => Promise<void>,
  cleanups: ReadonlyArray<() => Promise<void>>,
): Promise<void> {
  let primary: { error: unknown } | undefined
  try {
    await work()
  } catch (error) {
    primary = { error }
  }
  const results = await Promise.allSettled(
    cleanups.map(async (cleanup) => {
      await cleanup()
    }),
  )
  const errors = results.flatMap((result) =>
    result.status === `rejected` ? [result.reason as unknown] : [],
  )
  if (errors.length > 0) {
    if (primary)
      throw new AggregateError(
        [primary.error, ...errors],
        `Oracle and cleanup failed`,
        { cause: primary.error },
      )
    if (errors.length === 1) throw errors[0]
    throw new AggregateError(errors, `Oracle cleanup failed`)
  }
  if (primary) throw primary.error
}

function captureCounts(
  rows: Array<{ count: number }>,
): Array<{ count: number }> {
  assertArrayKeys(rows, `group counts`)
  return rows.map((row) => {
    assertSelectedKeys(row, [`count`], `group count`)
    return { count: row.count }
  })
}

function captureGroupedRows(
  observed: Array<{ id: number; summaries: Array<{ count: number }> }>,
): Array<{ id: number; summaries: Array<{ count: number }> }> {
  assertArrayKeys(observed, `grouped roots`)
  return observed.map((row) => {
    assertSelectedKeys(row, [`id`, `summaries`], `grouped parent ${row.id}`)
    return { id: row.id, summaries: captureCounts(row.summaries) }
  })
}

function captureReferenceRows(
  rows: Array<{ id: number; children: Array<number> }>,
): Array<{ id: number; children: Array<number> }> {
  assertArrayKeys(rows, `reference roots`)
  return rows.map((row) => {
    assertSelectedKeys(row, [`id`, `children`], `reference parent ${row.id}`)
    assertArrayKeys(row.children, `reference children ${row.id}`)
    return { id: row.id, children: [...row.children] }
  })
}

function assertGroupedRouteCounts(
  observed: Array<{ id: number; summaries: Array<{ count: number }> }>,
  counts: ReadonlyArray<number>,
): void {
  expect(captureGroupedRows(observed)).toEqual(
    counts.map((childCount, index) => ({
      id: index + 1,
      summaries: childCount === 0 ? [] : [{ count: childCount }],
    })),
  )
}

function createControlledCollection<T extends { id: number }>(
  name: string,
  initialData: ReadonlyArray<T>,
): ControlledCollection<T> {
  return createOracleControlledCollection(name, initialData, {
    autoIndex: `eager`,
    rowUpdateMode: `full`,
  })
}

function compareParents(left: ParentRow, right: ParentRow): number {
  return left.position - right.position || left.id - right.id
}

function compareChildren(left: ChildRow, right: ChildRow): number {
  return left.position - right.position || left.id - right.id
}

function normalizeChild(child: ChildRow, context = `child`): ChildRow {
  assertSelectedKeys(child, [`id`, `parentGroup`, `score`, `position`], context)
  return {
    id: child.id,
    parentGroup: child.parentGroup,
    score: child.score,
    position: child.position,
  }
}

function captureOrderedNested(
  rows: ReadonlyArray<NormalizedParent>,
  context = `nested`,
): Array<NormalizedParent> {
  assertArrayKeys(rows, `${context} roots`)
  return rows.map((parent) => {
    assertSelectedKeys(
      parent,
      [`id`, `group`, `position`, `children`],
      `${context} parent ${parent.id}`,
    )
    assertArrayKeys(parent.children, `${context} children ${parent.id}`)
    return {
      id: parent.id,
      group: parent.group,
      position: parent.position,
      children: parent.children.map((child) =>
        normalizeChild(
          child,
          `${context} parent ${parent.id} child ${child.id}`,
        ),
      ),
    }
  })
}

// Canonicalize only model rows and formulations with no common result order.
function normalizeNested(
  rows: ReadonlyArray<NormalizedParent>,
): Array<NormalizedParent> {
  return captureOrderedNested(rows)
    .map((parent) => ({
      ...parent,
      children: parent.children.sort(compareChildren),
    }))
    .sort(compareParents)
}

function normalizeFlat(
  rows: ReadonlyArray<FlatRow>,
  context = `flat`,
): Array<NormalizedParent> {
  assertArrayKeys(rows, `${context} rows`)
  const parents = new Map<number, NormalizedParent>()
  const placeholders = new Set<number>()
  for (const row of rows) {
    assertSelectedKeys(
      row,
      [`parentId`, `parentGroup`, `parentPosition`, `child`],
      context,
    )
    const parent = parents.get(row.parentId) ?? {
      id: row.parentId,
      group: row.parentGroup,
      position: row.parentPosition,
      children: [],
    }
    expect(
      [row.parentGroup, row.parentPosition],
      `${context} parent ${row.parentId}`,
    ).toEqual([parent.group, parent.position])
    expect(
      placeholders.has(row.parentId),
      `${context} duplicate or mixed placeholder ${row.parentId}`,
    ).toBe(false)
    if (row.child === undefined) {
      expect(
        parent.children,
        `${context} mixed placeholder ${row.parentId}`,
      ).toEqual([])
      placeholders.add(row.parentId)
    } else {
      parent.children.push(normalizeChild(row.child, `${context} child`))
    }
    parents.set(row.parentId, parent)
  }
  return normalizeNested([...parents.values()])
}

function recompute(
  parents: Map<number, ParentRow>,
  children: Map<number, ChildRow>,
): Array<NormalizedParent> {
  return normalizeNested(
    [...parents.values()].map((parent) => ({
      ...parent,
      children: [...children.values()].filter(
        (child) => child.parentGroup === parent.group,
      ),
    })),
  )
}

function createNestedQuery(
  parents: Collection<ParentRow>,
  children: Collection<ChildRow>,
) {
  return createLiveQueryCollection({
    getKey: (row) => row.id,
    query: (q) =>
      q
        .from({ parent: parents })
        .orderBy(({ parent }) => parent.position)
        .orderBy(({ parent }) => parent.id)
        .select(({ parent }) => ({
          id: parent.id,
          group: parent.group,
          position: parent.position,
          children: toArray(
            q
              .from({ child: children })
              .where(({ child }) => eq(child.parentGroup, parent.group))
              .orderBy(({ child }) => child.position)
              .orderBy(({ child }) => child.id)
              .select(({ child }) => ({
                id: child.id,
                parentGroup: child.parentGroup,
                score: child.score,
                position: child.position,
              })),
          ),
        })),
  })
}

function createWindowedNestedQuery(
  parents: Collection<ParentRow>,
  children: Collection<ChildRow>,
  offset: number,
  limit: number,
) {
  return createLiveQueryCollection({
    getKey: (row) => row.id,
    query: (q) =>
      q
        .from({ parent: parents })
        .orderBy(({ parent }) => parent.position)
        .orderBy(({ parent }) => parent.id)
        .select(({ parent }) => ({
          id: parent.id,
          group: parent.group,
          position: parent.position,
          children: toArray(
            q
              .from({ child: children })
              .where(({ child }) => eq(child.parentGroup, parent.group))
              .orderBy(({ child }) => child.position)
              .orderBy(({ child }) => child.id)
              .offset(offset)
              .limit(limit)
              .select(({ child }) => ({
                id: child.id,
                parentGroup: child.parentGroup,
                score: child.score,
                position: child.position,
              })),
          ),
        })),
  })
}

function createFlatQuery(
  parents: Collection<ParentRow>,
  children: Collection<ChildRow>,
) {
  return createLiveQueryCollection({
    getKey: (row) => `${row.parentId}:${row.child?.id ?? `empty`}`,
    query: (q) =>
      q
        .from({ parent: parents })
        .leftJoin({ child: children }, ({ parent, child }) =>
          eq(parent.group, child.parentGroup),
        )
        .select(({ parent, child }) => ({
          parentId: parent.id,
          parentGroup: parent.group,
          parentPosition: parent.position,
          child,
        })),
  })
}

type ChildPartition = `all` | `predicate` | `complement` | `unknown`

async function queryChildren(
  children: Collection<ChildRow>,
  parentGroup: number,
  pivot: number,
  partition: ChildPartition,
  context: string,
): Promise<Array<ChildRow>> {
  const rows = await queryOnce((q) => {
    const correlated = q
      .from({ child: children })
      .where(({ child }) => eq(child.parentGroup, parentGroup))
    const partitioned = (() => {
      switch (partition) {
        case `all`:
          return correlated
        case `predicate`:
          return correlated.where(({ child }) => lt(child.score, pivot))
        case `complement`:
          return correlated.where(({ child }) => not(lt(child.score, pivot)))
        case `unknown`:
          return correlated.where(({ child }) => isNull(lt(child.score, pivot)))
      }
    })()

    return partitioned
      .orderBy(({ child }) => child.position)
      .orderBy(({ child }) => child.id)
      .select(({ child }) => ({
        id: child.id,
        parentGroup: child.parentGroup,
        score: child.score,
        position: child.position,
      }))
  })
  assertArrayKeys(rows, `${context} ${partition} rows`)
  return rows.map((row) =>
    normalizeChild(row, `${context} ${partition} child ${row.id}`),
  )
}

async function queryPerParent(
  parents: ReadonlyArray<ParentRow>,
  children: Collection<ChildRow>,
  pivot: number,
  useTlp: boolean,
  context: string,
): Promise<Array<NormalizedParent>> {
  const rows = await Promise.all(
    parents.map(async (parent) => {
      const childRows = useTlp
        ? (
            await Promise.all(
              ([`predicate`, `complement`, `unknown`] as const).map(
                (partition) =>
                  queryChildren(
                    children,
                    parent.group,
                    pivot,
                    partition,
                    context,
                  ),
              ),
            )
          ).flat()
        : await queryChildren(children, parent.group, pivot, `all`, context)

      return { ...parent, children: childRows }
    }),
  )
  // TLP concatenates three independently ordered partitions. Its union is
  // unordered; the standalone query's promised child sequence is not.
  return useTlp ? normalizeNested(rows) : captureOrderedNested(rows, context)
}

function applyAction(
  action: CrossFormulationAction,
  parentSource: ControlledCollection<ParentRow>,
  childSource: ControlledCollection<ChildRow>,
  parents: Map<number, ParentRow>,
  children: Map<number, ChildRow>,
): void {
  switch (action.type) {
    case `putParent`: {
      const type = parents.has(action.row.id) ? `update` : `insert`
      parents.set(action.row.id, { ...action.row })
      parentSource.write(type, action.row)
      return
    }
    case `deleteParent`: {
      const previous = parents.get(action.id)
      if (!previous) return
      parents.delete(action.id)
      parentSource.write(`delete`, previous)
      return
    }
    case `putChild`: {
      const type = children.has(action.row.id) ? `update` : `insert`
      children.set(action.row.id, { ...action.row })
      childSource.write(type, action.row)
      return
    }
    case `deleteChild`: {
      const previous = children.get(action.id)
      if (!previous) return
      children.delete(action.id)
      childSource.write(`delete`, previous)
    }
  }
}

async function expectFormulationsEquivalent(
  scenario: CrossFormulationScenario,
): Promise<void> {
  const parentSource = createControlledCollection(
    `cross-form-parents`,
    scenario.parents,
  )
  const childSource = createControlledCollection(
    `cross-form-children`,
    scenario.children,
  )
  const parents = new Map(scenario.parents.map((row) => [row.id, { ...row }]))
  const children = new Map(scenario.children.map((row) => [row.id, { ...row }]))
  const nested = createNestedQuery(
    parentSource.collection,
    childSource.collection,
  )
  const flat = createFlatQuery(parentSource.collection, childSource.collection)

  const assertEquivalent = async (checkpoint: number) => {
    const context = JSON.stringify({
      checkpoint,
      action: scenario.actions[checkpoint - 1],
    })
    const expected = recompute(parents, children)
    const nestedResult = captureOrderedNested(
      nested.toArray,
      `${context} nested`,
    )
    const flatResult = normalizeFlat(flat.toArray, `${context} flat`)
    // Fresh child queries do not determine parent order. The model chooses
    // their invocation order; their returned child order stays untouched.
    const parentRows = [...parents.values()].sort(compareParents)
    const standaloneResult = await queryPerParent(
      parentRows,
      childSource.collection,
      scenario.pivot,
      false,
      `${context} standalone`,
    )
    const tlpResult = await queryPerParent(
      parentRows,
      childSource.collection,
      scenario.pivot,
      true,
      `${context} TLP`,
    )

    expect(
      {
        nested: nestedResult,
        flat: flatResult,
        standalone: standaloneResult,
        tlp: tlpResult,
      },
      context,
    ).toEqual({
      nested: expected,
      flat: expected,
      standalone: expected,
      tlp: expected,
    })
  }

  await withCleanup(async () => {
    await Promise.all([nested.preload(), flat.preload()])
    await assertEquivalent(0)
    for (const [index, action] of scenario.actions.entries()) {
      applyAction(action, parentSource, childSource, parents, children)
      await flushPromises()
      await assertEquivalent(index + 1)
    }
  }, [
    () => nested.cleanup(),
    () => flat.cleanup(),
    () => parentSource.collection.cleanup(),
    () => childSource.collection.cleanup(),
  ])
}

async function expectWindowedIncludeMatches(
  scenario: CrossFormulationScenario,
  offset: number,
  limit: number,
): Promise<void> {
  const parentSource = createControlledCollection(
    `windowed-cross-form-parents`,
    scenario.parents,
  )
  const childSource = createControlledCollection(
    `windowed-cross-form-children`,
    scenario.children,
  )
  const parents = new Map(scenario.parents.map((row) => [row.id, { ...row }]))
  const children = new Map(scenario.children.map((row) => [row.id, { ...row }]))
  const nested = createWindowedNestedQuery(
    parentSource.collection,
    childSource.collection,
    offset,
    limit,
  )

  const assertEquivalent = (checkpoint: number) => {
    const context = JSON.stringify({
      checkpoint,
      action: scenario.actions[checkpoint - 1],
      offset,
      limit,
    })
    const expected = normalizeNested(
      [...parents.values()].map((parent) => ({
        ...parent,
        children: [...children.values()]
          .filter((child) => child.parentGroup === parent.group)
          .sort(compareChildren)
          .slice(offset, offset + limit),
      })),
    )
    expect(captureOrderedNested(nested.toArray, context), context).toEqual(
      expected,
    )
  }

  await withCleanup(async () => {
    await nested.preload()
    assertEquivalent(0)
    for (const [index, action] of scenario.actions.entries()) {
      applyAction(action, parentSource, childSource, parents, children)
      await flushPromises()
      assertEquivalent(index + 1)
    }
  }, [
    () => nested.cleanup(),
    () => parentSource.collection.cleanup(),
    () => childSource.collection.cleanup(),
  ])
}

const parentRowArbitrary = (id: number) =>
  fc.record({
    id: fc.constant(id),
    group: fc.integer({ min: -1, max: 1 }),
    position: fc.integer({ min: -2, max: 2 }),
  })

const childRowArbitrary = (id: number) =>
  fc.record({
    id: fc.constant(id),
    parentGroup: fc.integer({ min: -1, max: 1 }),
    score: fc.option(fc.integer({ min: -2, max: 2 }), { nil: null }),
    position: fc.integer({ min: -2, max: 2 }),
  })

const actionArbitrary: fc.Arbitrary<CrossFormulationAction> = fc.oneof(
  fc.record({
    type: fc.constant(`putParent` as const),
    row: fc.integer({ min: 0, max: 2 }).chain(parentRowArbitrary),
  }),
  fc.record({
    type: fc.constant(`deleteParent` as const),
    id: fc.integer({ min: 0, max: 2 }),
  }),
  fc.record({
    type: fc.constant(`putChild` as const),
    row: fc.integer({ min: 10, max: 14 }).chain(childRowArbitrary),
  }),
  fc.record({
    type: fc.constant(`deleteChild` as const),
    id: fc.integer({ min: 10, max: 14 }),
  }),
)

const scenarioArbitrary: fc.Arbitrary<CrossFormulationScenario> = fc.record({
  parents: fc.tuple(parentRowArbitrary(0), parentRowArbitrary(1)),
  children: fc.tuple(
    childRowArbitrary(10),
    childRowArbitrary(11),
    childRowArbitrary(12),
  ),
  pivot: fc.integer({ min: -2, max: 2 }),
  actions: fc.array(actionArbitrary, { minLength: 1, maxLength: 5 }),
})

const windowedScenarioArbitrary = fc.record({
  scenario: scenarioArbitrary,
  offset: fc.integer({ min: 0, max: 2 }),
  limit: fc.integer({ min: 0, max: 3 }),
})

describe(`includes cross-formulation oracle`, () => {
  test(`cold provider predicates preserve opaque reference membership`, () => {
    const first = { code: 0 }
    const second = { code: 0 }
    const rows = [
      { id: 10, parentGroup: first },
      { id: 20, parentGroup: second },
      { id: 30, parentGroup: { code: 0 } },
    ]
    const ref = new PropRef([`parentGroup`])
    const cases: Array<[BasicExpression | undefined, Array<number>]> = [
      [undefined, [10, 20, 30]],
      [new Func(`eq`, [ref, new Value(first)]), [10]],
      [new Func(`eq`, [new Value(second), ref]), [20]],
      [new Func(`eq`, [ref, new Value({ code: 0 })]), []],
      [new Func(`in`, [ref, new Value([first, second])]), [10, 20]],
      [new Func(`in`, [ref, new Value([])]), []],
      [
        new Func(`and`, [
          new Func(`in`, [ref, new Value([first, second])]),
          new Func(`eq`, [ref, new Value(second)]),
        ]),
        [20],
      ],
    ]
    for (const [expression, ids] of cases) {
      const predicate = referenceRequestPredicate(
        expression && captureReferenceRequest(expression),
      )
      expect(rows.filter(predicate).map((row) => row.id)).toEqual(ids)
    }
    // These are fixture-domain failures, not claims about runtime support.
    for (const expression of [
      new Func(`lt`, [ref, new Value(first)]),
      new Func(`eq`, [new PropRef([`id`]), new Value(first)]),
      new Func(`eq`, [ref]),
      new Func(`in`, [ref, new Value(first)]),
    ]) {
      expect(() =>
        referenceRequestPredicate(captureReferenceRequest(expression)),
      ).toThrow(`Unsupported cold reference fixture predicate`)
    }
  })

  test(`request snapshots copy paths and membership arrays without cloning keys`, () => {
    const first = { code: 0 }
    const second = { code: 0 }
    const path = [`parentGroup`]
    const keys = [first, second]
    const snapshot = captureReferenceRequest(
      new Func(`in`, [new PropRef(path), new Value(keys)]),
    )
    // Mutate only test-owned input, never a submitted runtime request.
    path[0] = `changed`
    keys.splice(0, 2, { code: 0 })
    expect(snapshot.type).toBe(`func`)
    if (snapshot.type !== `func`) throw new Error(`Expected function snapshot`)
    expect(Object.isFrozen(snapshot.args)).toBe(true)
    expect(snapshot.args[0]).toEqual({ type: `ref`, path: [`parentGroup`] })
    const membership = snapshot.args[1]
    if (membership?.type !== `val` || !Array.isArray(membership.value))
      throw new Error(`Expected membership snapshot`)
    expect(Object.isFrozen(membership.value)).toBe(true)
    expect(membership.value[0]).toBe(first)
    expect(membership.value[1]).toBe(second)
    expect(membership.value).toHaveLength(2)
  })

  test(`cold grouped-only loading keeps equal-shaped reference routes distinct`, async () => {
    const first = Object.freeze({ code: 0 })
    const second = Object.freeze({ code: 0 })
    const unmatched = Object.freeze({ code: 0 })
    const rows: Array<ReferenceChild> = [
      { id: 10, parentGroup: first },
      { id: 11, parentGroup: first },
      { id: 20, parentGroup: second },
      { id: 30, parentGroup: unmatched },
    ]
    const parents = createControlledCollection<ReferenceParent>(
      `cold-grouped-parents`,
      [
        { id: 1, group: first },
        { id: 2, group: second },
      ],
    )
    const requests: Array<ReferenceRequest | undefined> = []
    const loaded = new Set<number>()
    const children = createCollection<ReferenceChild>({
      id: `cold-grouped-children`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => ({
          loadSubset: (options: LoadSubsetOptions) => {
            const request =
              options.where && captureReferenceRequest(options.where)
            requests.push(request)
            if (
              options.orderBy?.length ||
              options.cursor !== undefined ||
              options.limit !== undefined ||
              (options.offset ?? 0) !== 0
            )
              throw new Error(
                `Unsupported bounded cold reference fixture request`,
              )
            const matches = referenceRequestPredicate(request)
            begin()
            for (const row of rows) {
              if (!loaded.has(row.id) && matches(row)) {
                write({ type: `insert`, value: { ...row } })
                loaded.add(row.id)
              }
            }
            const receipt = commit()
            if (receipt !== true) return receipt.then(() => markReady())
            markReady()
            return true
          },
        }),
      },
    })
    const grouped = createLiveQueryCollection({
      getKey: (row) => row.id,
      query: (q) =>
        q
          .from({ parent: parents.collection })
          .orderBy(({ parent }) => parent.id, `asc`)
          .select(({ parent }) => ({
            id: parent.id,
            summaries: toArray(
              q
                .from({ child: children })
                .where(({ child }) => eq(child.parentGroup, parent.group))
                .groupBy(({ child }) => child.parentGroup)
                .select(({ child }) => ({ count: count(child.id) })),
            ),
          })),
    })
    await withCleanup(async () => {
      expect(loaded.size).toBe(0)
      await grouped.preload()
      expect(requests.length).toBeGreaterThan(0)
      expect(loaded.size).toBeGreaterThan(0)
      // Full-source or broader requests are legal; counts alone decide routing.
      assertGroupedRouteCounts(grouped.toArray, [2, 1])
    }, [
      () => grouped.cleanup(),
      () => parents.collection.cleanup(),
      () => children.cleanup(),
    ])
  })

  test.each([
    { name: `success`, failWork: false, cleanupFailures: 0 },
    { name: `primary only`, failWork: true, cleanupFailures: 0 },
    { name: `cleanup only`, failWork: false, cleanupFailures: 1 },
    { name: `multiple cleanups`, failWork: false, cleanupFailures: 2 },
    { name: `primary and cleanups`, failWork: true, cleanupFailures: 2 },
  ])(
    `retains $name outcomes while attempting every cleanup`,
    async ({ failWork, cleanupFailures }) => {
      const primary = new Error(`primary`)
      const first = new Error(`synchronous cleanup`)
      const second = new Error(`asynchronous cleanup`)
      const calls: Array<number> = []
      const run = withCleanup(() => {
        if (failWork) throw primary
        return Promise.resolve()
      }, [
        () => {
          calls.push(1)
          if (cleanupFailures > 0) throw first
          return Promise.resolve()
        },
        () => {
          calls.push(2)
          return cleanupFailures > 1
            ? Promise.reject(second)
            : Promise.resolve()
        },
        () => {
          calls.push(3)
          return Promise.resolve()
        },
      ])
      if (failWork && cleanupFailures > 0) {
        await expect(run).rejects.toMatchObject({
          cause: primary,
          errors: [primary, first, second],
        })
      } else if (failWork) {
        await expect(run).rejects.toBe(primary)
      } else if (cleanupFailures === 1) {
        await expect(run).rejects.toBe(first)
      } else if (cleanupFailures === 2) {
        await expect(run).rejects.toMatchObject({ errors: [first, second] })
      } else {
        await run
      }
      expect(calls).toEqual([1, 2, 3])
    },
  )

  test.each([
    `field`,
    `dollar`,
    `symbol`,
    `child symbol`,
    `array symbol`,
    `missing field`,
  ] as const)(
    `raw capture rejects %s before selected-field projection`,
    (fault) => {
      const expected: Array<NormalizedParent> = [
        {
          id: 0,
          group: 0,
          position: 0,
          children: [{ id: 10, parentGroup: 0, score: null, position: 0 }],
        },
      ]
      const rows = captureOrderedNested(expected)
      Object.assign(rows[0]!, {
        $synced: true,
        $origin: `remote`,
        $key: 0,
        $collectionId: `source`,
      })
      expect(captureOrderedNested(rows)).toEqual(expected)
      if (fault === `missing field`)
        Reflect.deleteProperty(rows[0]!, `position`)
      else {
        const target =
          fault === `child symbol`
            ? rows[0]!.children[0]!
            : fault === `array symbol`
              ? rows[0]!.children
              : rows[0]!
        const key =
          fault === `field`
            ? `unexpected`
            : fault === `dollar`
              ? `$unexpected`
              : Symbol(`private`)
        Object.defineProperty(target, key, { value: undefined })
      }
      expect(() => captureOrderedNested(rows)).toThrowError(
        expect.objectContaining({ name: `AssertionError` }),
      )
    },
  )

  test.each([
    `metadata`,
    `placeholder after child`,
    `placeholder before child`,
    `duplicate placeholder`,
    `null child`,
  ] as const)(`raw flat capture rejects %s`, (fault) => {
    const row: FlatRow = {
      parentId: 0,
      parentGroup: 0,
      parentPosition: 0,
      child: { id: 10, parentGroup: 0, score: null, position: 0 },
    }
    const second: FlatRow = { ...row, child: { ...row.child!, id: 11 } }
    const empty: FlatRow = { ...row, child: undefined }
    expect(
      normalizeFlat([row, second])[0]?.children.map((child) => child.id),
    ).toEqual([10, 11])
    expect(normalizeFlat([empty])[0]?.children).toEqual([])
    const wrong =
      fault === `metadata`
        ? [row, { ...second, parentPosition: 1 }]
        : fault === `placeholder after child`
          ? [row, empty]
          : fault === `placeholder before child`
            ? [empty, row]
            : fault === `duplicate placeholder`
              ? [empty, empty]
              : [row]
    if (fault === `null child`) Reflect.set(row, `child`, null)
    expect(() => normalizeFlat(wrong)).toThrowError(
      expect.objectContaining({ name: `AssertionError` }),
    )
  })

  test(`literal group counts reject common-mode missing, merged and stale groups`, () => {
    const initial = [
      { id: 1, summaries: [{ count: 2 }] },
      { id: 2, summaries: [{ count: 1 }] },
    ]
    assertGroupedRouteCounts(initial, [2, 1])
    for (const wrong of [
      [],
      [
        { id: 1, summaries: [{ count: 3 }] },
        { id: 2, summaries: [{ count: 3 }] },
      ],
      initial,
    ]) {
      expect(() => assertGroupedRouteCounts(wrong, [1, 2])).toThrowError(
        expect.objectContaining({ name: `AssertionError` }),
      )
    }
    assertGroupedRouteCounts(
      [
        { id: 1, summaries: [{ count: 1 }] },
        { id: 2, summaries: [{ count: 2 }] },
      ],
      [1, 2],
    )
  })
  test.each([`root`, `child`] as const)(
    `retains wrong %s order that unordered normalization would erase`,
    (level) => {
      const expected: Array<NormalizedParent> = [
        {
          id: 1,
          group: 0,
          position: 0,
          children: [
            { id: 11, parentGroup: 0, score: null, position: 0 },
            { id: 10, parentGroup: 0, score: 1, position: 1 },
          ],
        },
        { id: 0, group: 1, position: 1, children: [] },
      ]
      const wrong = captureOrderedNested(expected)
      if (level === `root`) wrong.reverse()
      else wrong[0]!.children.reverse()

      // Old checker false green; the new observation retains the violation.
      expect(normalizeNested(wrong)).toEqual(expected)
      expect(captureOrderedNested(expected)).toEqual(expected)
      expect(() =>
        expect(captureOrderedNested(wrong)).toEqual(expected),
      ).toThrowError(expect.objectContaining({ name: `AssertionError` }))
    },
  )

  fcTest.prop(
    [fc.integer()],
    oraclePropertyOptions(4, `includes-cross-formulation.reference-context`),
  )(
    `parent-context routing preserves reference-sensitive predicate values across transitions`,
    async (code) => {
      const firstToken = { code }
      const secondToken = { code }
      const parentRows: Array<ReferenceContextParent> = [
        { id: 1, group: 1, expected: firstToken },
        { id: 2, group: 1, expected: secondToken },
      ]
      const childRows: Array<ReferenceContextChild> = [
        { id: 10, group: 1, token: firstToken },
        { id: 20, group: 1, token: secondToken },
      ]
      const parents = createControlledCollection(
        `reference-context-parents`,
        parentRows,
      )
      const fullyLoadedChildren = createControlledCollection(
        `reference-context-full-children`,
        childRows,
      )
      const loadedChildIds = new Set<number>()
      const lazyChildren = createCollection<ReferenceContextChild>({
        id: `reference-context-lazy-children`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ begin, write, commit, markReady }) => ({
            loadSubset: (options: LoadSubsetOptions) => {
              const matches = options.where
                ? createFilterFunctionFromExpression<ReferenceContextChild>(
                    options.where,
                  )
                : () => true
              begin()
              for (const row of childRows) {
                if (!loadedChildIds.has(row.id) && matches(row)) {
                  loadedChildIds.add(row.id)
                  write({ type: `insert`, value: row })
                }
              }
              commit()
              markReady()
              return Promise.resolve()
            },
          }),
        },
      })
      const createReferenceContextQuery = (
        children: Collection<ReferenceContextChild>,
      ) =>
        createLiveQueryCollection({
          getKey: (row) => row.id,
          query: (q) =>
            q.from({ parent: parents.collection }).select(({ parent }) => ({
              id: parent.id,
              children: toArray(
                q
                  .from({ child: children })
                  .where(({ child }) =>
                    and(
                      eq(child.group, parent.group),
                      eq(child.token, parent.expected),
                    ),
                  )
                  .select(({ child }) => child.id),
              ),
            })),
        })
      const fullyLoaded = createReferenceContextQuery(
        fullyLoadedChildren.collection,
      )
      const lazy = createReferenceContextQuery(lazyChildren)

      await withCleanup(async () => {
        await Promise.all([fullyLoaded.preload(), lazy.preload()])
        expect(captureReferenceRows(lazy.toArray)).toEqual([
          { id: 1, children: [10] },
          { id: 2, children: [20] },
        ])
        expect(captureReferenceRows(lazy.toArray)).toEqual(
          captureReferenceRows(fullyLoaded.toArray),
        )

        parents.write(`delete`, parentRows[0]!)
        await flushPromises()
        expect(captureReferenceRows(lazy.toArray)).toEqual([
          { id: 2, children: [20] },
        ])
        expect(captureReferenceRows(lazy.toArray)).toEqual(
          captureReferenceRows(fullyLoaded.toArray),
        )

        parents.write(`insert`, parentRows[0]!)
        await flushPromises()
        expect(captureReferenceRows(lazy.toArray)).toEqual([
          { id: 1, children: [10] },
          { id: 2, children: [20] },
        ])
        // A changed scalar establishes source publication. Pure equal-shaped
        // reference replacement is a source no-op and need not reach the graph.
        const publications: Array<ReferenceContextParent> = []
        const subscription = parents.collection.subscribeChanges((events) => {
          publications.push(...events.map((event) => ({ ...event.value })))
        })
        try {
          for (const { row, childIds } of [
            {
              row: { ...parentRows[0]!, expected: secondToken, revision: 1 },
              childIds: [20, 20],
            },
            {
              row: { ...parentRows[1]!, expected: firstToken, revision: 1 },
              childIds: [20, 10],
            },
            { row: { ...parentRows[0]!, revision: 2 }, childIds: [10, 10] },
            { row: { ...parentRows[1]!, revision: 2 }, childIds: [10, 20] },
          ]) {
            const priorPublications = publications.length
            parents.write(`update`, row)
            expect(publications.length).toBeGreaterThan(priorPublications)
            expect(publications.at(-1)?.expected).toBe(row.expected)
            expect(publications.at(-1)?.revision).toBe(row.revision)
            await flushPromises()
            const expectedRows = [
              { id: 1, children: [childIds[0]] },
              { id: 2, children: [childIds[1]] },
            ]
            expect(captureReferenceRows(lazy.toArray)).toEqual(expectedRows)
            expect(captureReferenceRows(fullyLoaded.toArray)).toEqual(
              expectedRows,
            )
          }
        } finally {
          subscription.unsubscribe()
        }
      }, [
        () => fullyLoaded.cleanup(),
        () => lazy.cleanup(),
        () => parents.collection.cleanup(),
        () => fullyLoadedChildren.collection.cleanup(),
        () => lazyChildren.cleanup(),
      ])
    },
  )

  test.each([
    [`Date and number`, () => [new Date(0), 0, new Date(1)] as const],
    [
      `Buffer and Uint8Array`,
      () =>
        [
          Buffer.from([1, 2, 3]),
          new Uint8Array([1, 2, 3]),
          new Uint8Array([1, 2, 4]),
        ] as const,
    ],
    [
      `equivalent Temporal values`,
      () =>
        [
          Temporal.PlainDate.from(`2024-04-05`),
          Temporal.PlainDate.from(`2024-04-05`),
          Temporal.PlainDate.from(`2024-04-06`),
        ] as const,
    ],
  ])(
    `grouped includes use query equality for %s routes`,
    async (_name, createValues) => {
      const [parentGroup, equivalentChildGroup, unequalChildGroup] =
        createValues()
      const parents = createControlledCollection(`equality-route-parents`, [
        { id: 1, group: parentGroup as unknown },
      ])
      const childRows = [
        { id: 10, parentGroup: parentGroup as unknown },
        { id: 11, parentGroup: equivalentChildGroup as unknown },
        { id: 12, parentGroup: unequalChildGroup as unknown },
      ]
      const children = createControlledCollection(
        `equality-route-children`,
        childRows,
      )
      const nested = createLiveQueryCollection({
        query: (q) =>
          q.from({ parent: parents.collection }).select(({ parent }) => ({
            id: parent.id,
            summaries: toArray(
              q
                .from({ child: children.collection })
                .where(({ child }) => eq(child.parentGroup, parent.group))
                .groupBy(({ child }) => child.parentGroup)
                .select(({ child }) => ({ count: count(child.id) })),
            ),
          })),
      })
      const standalone = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ child: children.collection })
            .where(({ child }) => eq(child.parentGroup, parentGroup))
            .groupBy(({ child }) => child.parentGroup)
            .select(({ child }) => ({ count: count(child.id) })),
      })

      const assertCounts = (expectedCount: number) => {
        assertGroupedRouteCounts(nested.toArray, [expectedCount])
        const nestedCounts = captureGroupedRows(nested.toArray)[0]?.summaries
        const standaloneCounts = captureCounts(standalone.toArray)
        expect(nestedCounts).toEqual(standaloneCounts)
        expect(nestedCounts).toEqual(
          expectedCount === 0 ? [] : [{ count: expectedCount }],
        )
      }

      await withCleanup(async () => {
        await Promise.all([nested.preload(), standalone.preload()])
        assertCounts(2)
        for (const [type, rowIndex, expectedCount] of [
          [`delete`, 0, 1],
          [`delete`, 1, 0],
          [`insert`, 0, 1],
          [`insert`, 1, 2],
        ] as const) {
          children.write(type, childRows[rowIndex]!)
          await flushPromises()
          assertCounts(expectedCount)
        }
      }, [
        () => nested.cleanup(),
        () => standalone.cleanup(),
        () => parents.collection.cleanup(),
        () => children.collection.cleanup(),
      ])
    },
  )

  test.each([`__correlationKey`, `__tanstack_group_correlation_key`])(
    `grouped includes preserve internal-looking aggregate alias %s`,
    async (alias) => {
      const parents = createControlledCollection(`aggregate-alias-parents`, [
        { id: 1, group: 1 },
      ])
      const children = createControlledCollection(`aggregate-alias-children`, [
        { id: 10, parentGroup: 1 },
        { id: 11, parentGroup: 1 },
      ])
      const nested = createLiveQueryCollection({
        query: (q) =>
          q.from({ parent: parents.collection }).select(({ parent }) => ({
            id: parent.id,
            summaries: toArray(
              q
                .from({ child: children.collection })
                .where(({ child }) => eq(child.parentGroup, parent.group))
                .groupBy(({ child }) => child.parentGroup)
                .select(({ child }) => ({ [alias]: count(child.id) })),
            ),
          })),
      })

      await withCleanup(async () => {
        await nested.preload()
        assertArrayKeys(nested.toArray, `aggregate alias roots`)
        expect(
          nested.toArray.map((row) => {
            assertSelectedKeys(
              row,
              [`id`, `summaries`],
              `aggregate alias parent`,
            )
            assertArrayKeys(row.summaries, `aggregate alias summaries`)
            return {
              id: row.id,
              summaries: row.summaries.map((summary) => {
                assertSelectedKeys(summary, [alias], `aggregate alias summary`)
                return { [alias]: summary[alias] }
              }),
            }
          }),
        ).toEqual([{ id: 1, summaries: [{ [alias]: 2 }] }])
        expect(nested.get(1)?.summaries.map((row) => row[alias])).toEqual([2])
      }, [
        () => nested.cleanup(),
        () => parents.collection.cleanup(),
        () => children.collection.cleanup(),
      ])
    },
  )

  fcTest.prop(
    [fc.integer()],
    oraclePropertyOptions(4, `includes-cross-formulation.reference-key`),
  )(
    `lazy materialization matches fully loaded materialization for reference-sensitive correlation keys`,
    async (code) => {
      const firstKey = { code }
      const secondKey = { code }
      const parentRows: Array<ReferenceParent> = [
        { id: 1, group: firstKey },
        { id: 2, group: secondKey },
      ]
      const childRows: Array<ReferenceChild> = [
        { id: 10, parentGroup: firstKey },
        { id: 20, parentGroup: secondKey },
      ]
      const parents = createControlledCollection(
        `reference-key-parents`,
        parentRows,
      )
      const fullyLoadedChildren = createControlledCollection(
        `reference-key-full-children`,
        childRows,
      )
      const loadedChildIds = new Set<number>()
      const lazyChildren = createCollection<ReferenceChild>({
        id: `reference-key-lazy-children`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ begin, write, commit, markReady }) => ({
            loadSubset: (options: LoadSubsetOptions) => {
              const matches = options.where
                ? createFilterFunctionFromExpression<ReferenceChild>(
                    options.where,
                  )
                : () => true
              begin()
              for (const row of childRows) {
                if (!loadedChildIds.has(row.id) && matches(row)) {
                  loadedChildIds.add(row.id)
                  write({ type: `insert`, value: row })
                }
              }
              commit()
              markReady()
              return Promise.resolve()
            },
          }),
        },
      })

      const createReferenceQuery = (children: Collection<ReferenceChild>) =>
        createLiveQueryCollection({
          getKey: (row) => row.id,
          query: (q) =>
            q.from({ parent: parents.collection }).select(({ parent }) => ({
              id: parent.id,
              children: toArray(
                q
                  .from({ child: children })
                  .where(({ child }) => eq(child.parentGroup, parent.group))
                  .select(({ child }) => child.id),
              ),
            })),
        })

      const createGroupedReferenceQuery = (
        children: Collection<ReferenceChild>,
      ) =>
        createLiveQueryCollection({
          getKey: (row) => row.id,
          query: (q) =>
            q.from({ parent: parents.collection }).select(({ parent }) => ({
              id: parent.id,
              summaries: toArray(
                q
                  .from({ child: children })
                  .where(({ child }) => eq(child.parentGroup, parent.group))
                  .groupBy(({ child }) => child.parentGroup)
                  .select(({ child }) => ({ count: count(child.id) })),
              ),
            })),
        })

      const fullyLoaded = createReferenceQuery(fullyLoadedChildren.collection)
      const lazy = createReferenceQuery(lazyChildren)
      const fullyLoadedGrouped = createGroupedReferenceQuery(
        fullyLoadedChildren.collection,
      )
      const lazyGrouped = createGroupedReferenceQuery(lazyChildren)
      const groupedRows = (
        query: typeof fullyLoadedGrouped,
      ): Array<{ id: number; summaries: Array<{ count: number }> }> =>
        captureGroupedRows(query.toArray)

      await withCleanup(async () => {
        await Promise.all([
          fullyLoaded.preload(),
          lazy.preload(),
          fullyLoadedGrouped.preload(),
          lazyGrouped.preload(),
        ])
        const fullyLoadedRows = captureReferenceRows(fullyLoaded.toArray)
        const lazyRows = captureReferenceRows(lazy.toArray)
        expect(lazyRows).toEqual(fullyLoadedRows)
        expect(lazyRows).toEqual([
          { id: 1, children: [10] },
          { id: 2, children: [20] },
        ])
        expect(groupedRows(lazyGrouped)).toEqual(
          groupedRows(fullyLoadedGrouped),
        )
        expect(groupedRows(lazyGrouped)).toEqual([
          { id: 1, summaries: [{ count: 1 }] },
          { id: 2, summaries: [{ count: 1 }] },
        ])

        parents.write(`delete`, parentRows[0]!)
        await flushPromises()
        expect(captureReferenceRows(lazy.toArray)).toEqual([
          { id: 2, children: [20] },
        ])
        expect(captureReferenceRows(lazy.toArray)).toEqual(
          captureReferenceRows(fullyLoaded.toArray),
        )
        expect(groupedRows(lazyGrouped)).toEqual([
          { id: 2, summaries: [{ count: 1 }] },
        ])
        expect(groupedRows(lazyGrouped)).toEqual(
          groupedRows(fullyLoadedGrouped),
        )

        parents.write(`insert`, parentRows[0]!)
        await flushPromises()
        expect(captureReferenceRows(lazy.toArray)).toEqual([
          { id: 1, children: [10] },
          { id: 2, children: [20] },
        ])
        expect(groupedRows(lazyGrouped)).toEqual([
          { id: 1, summaries: [{ count: 1 }] },
          { id: 2, summaries: [{ count: 1 }] },
        ])
      }, [
        () => fullyLoaded.cleanup(),
        () => lazy.cleanup(),
        () => fullyLoadedGrouped.cleanup(),
        () => lazyGrouped.cleanup(),
        () => parents.collection.cleanup(),
        () => fullyLoadedChildren.collection.cleanup(),
        () => lazyChildren.cleanup(),
      ])
    },
  )

  fcTest.prop(
    [fc.integer()],
    oraclePropertyOptions(4, `includes-cross-formulation.symbol-group-route`),
  )(
    `grouped includes agree with standalone groups for symbol routes`,
    async (code) => {
      for (const sameDescription of [false, true]) {
        const firstGroup = Symbol(`first-${code}`)
        const secondGroup = Symbol(
          sameDescription ? `first-${code}` : `second-${code}`,
        )
        const parents = createControlledCollection(`symbol-route-parents`, [
          { id: 1, group: firstGroup },
          { id: 2, group: secondGroup },
        ])
        const children = createControlledCollection(`symbol-route-children`, [
          { id: 10, parentGroup: firstGroup },
          { id: 11, parentGroup: firstGroup },
          { id: 20, parentGroup: secondGroup },
        ])

        const nested = createLiveQueryCollection({
          getKey: (row) => row.id,
          query: (q) =>
            q.from({ parent: parents.collection }).select(({ parent }) => ({
              id: parent.id,
              summaries: toArray(
                q
                  .from({ child: children.collection })
                  .where(({ child }) => eq(child.parentGroup, parent.group))
                  .groupBy(({ child }) => child.parentGroup)
                  .select(({ child }) => ({ count: count(child.id) })),
              ),
            })),
        })
        const standalone = [firstGroup, secondGroup].map((group) =>
          createLiveQueryCollection({
            query: (q) =>
              q
                .from({ child: children.collection })
                .where(({ child }) => eq(child.parentGroup, group))
                .groupBy(({ child }) => child.parentGroup)
                .select(({ child }) => ({ count: count(child.id) })),
          }),
        )

        const assertCounts = (counts: ReadonlyArray<number>) => {
          const nestedRows = captureGroupedRows(nested.toArray)
          expect(nestedRows).toEqual(
            standalone.map((query, index) => ({
              id: index + 1,
              summaries: captureCounts(query.toArray),
            })),
          )
          assertGroupedRouteCounts(nestedRows, counts)
        }
        await withCleanup(async () => {
          await Promise.all([
            nested.preload(),
            ...standalone.map((query) => query.preload()),
          ])
          assertCounts([2, 1])
          children.write(`update`, { id: 11, parentGroup: secondGroup })
          await flushPromises()
          assertCounts([1, 2])
          children.write(`delete`, { id: 10, parentGroup: firstGroup })
          await flushPromises()
          assertCounts([0, 2])
          children.write(`insert`, { id: 10, parentGroup: firstGroup })
          await flushPromises()
          assertCounts([1, 2])
          children.write(`update`, { id: 11, parentGroup: firstGroup })
          await flushPromises()
          assertCounts([2, 1])
        }, [
          () => nested.cleanup(),
          ...standalone.map((query) => () => query.cleanup()),
          () => parents.collection.cleanup(),
          () => children.collection.cleanup(),
        ])
      }
    },
  )

  fcTest(`shared-route child deletion agrees across formulations`, () =>
    expectFormulationsEquivalent({
      parents: [
        { id: 0, group: 0, position: 0 },
        { id: 1, group: 0, position: 0 },
      ],
      children: [
        { id: 10, parentGroup: 0, score: null, position: 0 },
        { id: 11, parentGroup: 0, score: null, position: 0 },
        { id: 12, parentGroup: 0, score: null, position: 0 },
      ],
      pivot: 0,
      actions: [{ type: `deleteChild`, id: 10 }],
    }),
  )

  test(`split, merge and reactivated routes preserve all predicate partitions`, () =>
    expectFormulationsEquivalent({
      parents: [
        { id: 0, group: 0, position: 1 },
        { id: 1, group: 0, position: 0 },
      ],
      children: [
        { id: 10, parentGroup: 0, score: null, position: 2 },
        { id: 11, parentGroup: 0, score: -1, position: 1 },
        { id: 12, parentGroup: 0, score: 1, position: 0 },
        { id: 13, parentGroup: 1, score: 0, position: 0 },
      ],
      pivot: 0,
      actions: [
        { type: `putParent`, row: { id: 0, group: 1, position: 1 } },
        { type: `putParent`, row: { id: 1, group: 1, position: 0 } },
        {
          type: `putChild`,
          row: { id: 11, parentGroup: 0, score: -1, position: -1 },
        },
        { type: `putParent`, row: { id: 0, group: 0, position: -1 } },
        { type: `deleteParent`, id: 1 },
        { type: `putParent`, row: { id: 1, group: 0, position: 0 } },
        {
          type: `putChild`,
          row: { id: 12, parentGroup: 1, score: 1, position: 0 },
        },
      ],
    }))

  test.each([
    { name: `zero limit`, offset: 0, limit: 0 },
    { name: `first tied page`, offset: 0, limit: 2 },
    { name: `offset through tie`, offset: 1, limit: 2 },
    { name: `empty tail`, offset: 3, limit: 2 },
  ])(
    `preserves ordered window $name through root and child moves`,
    ({ offset, limit }) =>
      expectWindowedIncludeMatches(
        {
          parents: [
            { id: 0, group: 0, position: 1 },
            { id: 1, group: 1, position: 0 },
          ],
          children: [
            { id: 10, parentGroup: 0, score: null, position: 1 },
            { id: 11, parentGroup: 0, score: -1, position: 0 },
            { id: 12, parentGroup: 0, score: 1, position: 0 },
            { id: 13, parentGroup: 1, score: 0, position: 0 },
          ],
          pivot: 0,
          actions: [
            {
              type: `putChild`,
              row: { id: 10, parentGroup: 0, score: null, position: -1 },
            },
            { type: `putParent`, row: { id: 0, group: 0, position: -1 } },
            {
              type: `putChild`,
              row: { id: 11, parentGroup: 0, score: -1, position: 2 },
            },
            {
              type: `putChild`,
              row: { id: 12, parentGroup: 1, score: 1, position: 0 },
            },
          ],
        },
        offset,
        limit,
      ),
  )

  fcTest.prop(
    [scenarioArbitrary],
    oraclePropertyOptions(8, `includes-cross-formulation.equivalence`),
  )(
    `agrees across nested includes, flat joins, per-parent queries, and TLP partitions`,
    expectFormulationsEquivalent,
  )

  fcTest.prop(
    [windowedScenarioArbitrary],
    oraclePropertyOptions(12, `includes-cross-formulation.ordered-window`),
  )(
    `matches recomputation for ordered offset and limit child windows`,
    ({ scenario, offset, limit }) =>
      expectWindowedIncludeMatches(scenario, offset, limit),
  )
})
