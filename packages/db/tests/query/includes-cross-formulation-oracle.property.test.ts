import { fc } from '@fast-check/vitest'
import { describe, expect, test } from 'vitest'
import { Temporal } from 'temporal-polyfill'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../oracle-assertion-adapter.js'
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
import {
  oracleCalibrationTest,
  oracleFixedSeed,
  oracleProperty,
  oraclePropertyOptions,
  oracleReplayRequested,
  oracleRoute,
  oracleRuns,
  readOracleRunConfig,
} from '../oracle-config.js'
import { flushPromises } from '../utils.js'
import { runIncludesCalibration } from './includes-calibration.js'
import { registerIncludesProperty } from './includes-registration-oracle.js'
import {
  assertTlpPartitions,
  partitionAndRouteScenario,
  recomputeNestedModel,
  recomputeWindowedModel,
  sharedRouteDeletionScenario,
} from './includes-cross-formulation-model-oracle.js'
import {
  assertArrayKeys,
  assertGroupedRouteCounts,
  captureCounts,
  captureGroupedRows,
  captureOrderedNested,
  captureReferenceRows,
  compareParents,
  createControlledCollection,
  normalizeChild,
  normalizeFlat,
  normalizeNested,
  withCleanup,
} from './includes-cross-formulation-support.js'
import type {
  CrossFormulationAction,
  CrossFormulationScenario,
} from './includes-cross-formulation-model-oracle.js'
import type { Collection } from '../../src/collection/index.js'
import type { LoadSubsetOptions } from '../../src/types.js'
import type { ControlledCollection } from './includes-oracle-helpers.js'
import type {
  ChildRow,
  NormalizedParent,
  ParentRow,
  ReferenceChild,
  ReferenceKey,
  ReferenceParent,
} from './includes-cross-formulation-support.js'

/**
 * # Why ask the same relationship question five ways?
 *
 * A nested include can be wrong even when its result looks plausible. A model
 * copied from the include pipeline can repeat the same mistake. This oracle
 * therefore compares five independent formulations after every source change:
 *
 * 1. A plain Map-and-array recomputation supplies the expected rows.
 * 2. A correlated nested include exercises materialization routes.
 * 3. A flat left join reconstructs the same parent-child relation.
 * 4. Fresh child queries run once for each current parent.
 * 5. Ternary logic partitioning makes true, false, and unknown partitions. It
 *    then unions the three results.
 *
 * Every formulation must produce the same parent rows and child membership.
 * Formulations with a promised order must also preserve that exact order. Raw
 * capture checks run before normalization so an unexpected field, symbol,
 * placeholder, duplicate, or wrong sequence cannot disappear during cleanup.
 *
 * Generated histories vary parent and child writes, route sharing, route
 * movement, null predicate values, ordering, offsets, and limits. Separate
 * controls cover opaque reference identity, query equality,
 * lazy demand, grouping, and user aliases that resemble compiler metadata.
 *
 * The architecture contract is in
 * `packages/db/src/query/live/ARCHITECTURE.md`. This file supplies executable
 * evidence for cross-formulation equivalence. It does not redefine the wider
 * demand, publication, or facade lifecycle contracts.
 */

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

function assertFormulationResults(
  expected: ReadonlyArray<NormalizedParent>,
  observed: {
    nested: ReadonlyArray<NormalizedParent>
    flat: ReadonlyArray<NormalizedParent>
    standalone: ReadonlyArray<NormalizedParent>
    tlp: ReadonlyArray<NormalizedParent>
  },
  context: string,
): void {
  oracleAssertion(
    'includes cross-formulation-oracle.property comparison 160',
    () =>
      expect(observed, `cross-formulation checkpoint ${context}`).toEqual({
        nested: expected,
        flat: expected,
        standalone: expected,
        tlp: expected,
      }),
  )
}

function assertWindowedResult(
  expected: ReadonlyArray<NormalizedParent>,
  observed: ReadonlyArray<NormalizedParent>,
  context: string,
): void {
  oracleAssertion(
    'includes cross-formulation-oracle.property comparison 173',
    () =>
      expect(observed, `ordered-window checkpoint ${context}`).toEqual(
        expected,
      ),
  )
}

// The next three builders are production formulations. They share source rows
// and public result types, but they use different compiler and runtime paths.
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

// Ternary logic partitioning is complete only with the unknown partition.
// A null score makes `score < pivot` unknown rather than true or false.
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
  oracleAssertion(
    'includes cross-formulation-oracle.property comparison 305',
    () => assertArrayKeys(rows, `${context} ${partition} rows`),
  )
  return rows.map((row) =>
    normalizeChild(row, `${context} ${partition} child ${row.id}`),
  )
}

async function queryPerParent(
  parents: ReadonlyArray<ParentRow>,
  children: Collection<ChildRow>,
  modelChildren: ReadonlyMap<number, ChildRow>,
  pivot: number,
  useTlp: boolean,
  context: string,
): Promise<Array<NormalizedParent>> {
  const rows = await Promise.all(
    parents.map(async (parent) => {
      const childRows = useTlp
        ? await (async () => {
            const partitions = [`predicate`, `complement`, `unknown`] as const
            const results = await Promise.all(
              partitions.map((partition) =>
                queryChildren(
                  children,
                  parent.group,
                  pivot,
                  partition,
                  context,
                ),
              ),
            )
            const sourceRows = [...modelChildren.values()].filter(
              (child) => child.parentGroup === parent.group,
            )
            assertTlpPartitions(
              results,
              sourceRows,
              pivot,
              `${context} parent ${parent.id}`,
            )
            return results.flat()
          })()
        : await queryChildren(children, parent.group, pivot, `all`, context)

      return { ...parent, children: childRows }
    }),
  )
  // TLP concatenates three independently ordered partitions. Their union has
  // no shared order. The standalone query still promises child order.
  return useTlp
    ? normalizeNested(rows)
    : oracleAssertion(
        'includes cross-formulation-oracle.property comparison 376',
        () => captureOrderedNested(rows, context),
      )
}

function applyAction(
  action: CrossFormulationAction,
  parentSource: ControlledCollection<ParentRow>,
  childSource: ControlledCollection<ChildRow>,
  parents: Map<number, ParentRow>,
  children: Map<number, ChildRow>,
): void {
  // The Map state advances the reference model. The controlled sources deliver
  // the same external action to each live production formulation.
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
  alterNestedObservation?: (
    rows: Array<NormalizedParent>,
  ) => Array<NormalizedParent>,
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
    const expected = recomputeNestedModel(parents, children)
    const nestedResult = oracleAssertion(
      'includes cross-formulation-oracle.property comparison 445',
      () => captureOrderedNested(nested.toArray, `${context} nested`),
    )
    const flatResult = normalizeFlat(flat.toArray, `${context} flat`)
    // Fresh child queries do not determine parent order. The model chooses
    // their invocation order. It does not change their returned child order.
    const parentRows = [...parents.values()].sort(compareParents)
    const standaloneResult = await queryPerParent(
      parentRows,
      childSource.collection,
      children,
      scenario.pivot,
      false,
      `${context} standalone`,
    )
    const tlpResult = await queryPerParent(
      parentRows,
      childSource.collection,
      children,
      scenario.pivot,
      true,
      `${context} TLP`,
    )

    assertFormulationResults(
      expected,
      {
        nested: alterNestedObservation?.(nestedResult) ?? nestedResult,
        flat: flatResult,
        standalone: standaloneResult,
        tlp: tlpResult,
      },
      context,
    )
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
  alterNestedObservation?: (
    rows: Array<NormalizedParent>,
  ) => Array<NormalizedParent>,
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
    const expected = recomputeWindowedModel(parents, children, offset, limit)
    const nestedResult = oracleAssertion(
      'includes cross-formulation-oracle.property comparison 531',
      () => captureOrderedNested(nested.toArray, context),
    )
    assertWindowedResult(
      expected,
      alterNestedObservation?.(nestedResult) ?? nestedResult,
      context,
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

// The nested include's group counts for a route must equal the counts of the
// standalone grouped query over the same route. The standalone query is a
// second formulation, so this compares query equality for the route with an
// independent answer.
function expectNestedCountsMatchStandalone(
  nested: Array<{ id: number; summaries: Array<{ count: number }> }>,
  standalone: Array<{ count: number }>,
): Array<{ count: number }> | undefined {
  const nestedCounts = oracleAssertion(
    'includes cross-formulation-oracle.property comparison 562',
    () => captureGroupedRows(nested),
  )[0]?.summaries
  oracleAssertion(
    'includes cross-formulation-oracle.property comparison 563',
    () => expect(nestedCounts).toEqual(captureCounts(standalone)),
  )
  return nestedCounts
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

// The three fixed histories below reconstruct the named in-range witnesses
// in both generated campaigns. Each coordinate has positive probability in
// the finite record grammar; examples keep them stable if sampling changes.
// Group controls shared vs split/moved/unmatched routes; position controls
// ties vs reorder; nullable score and pivot control true/false/unknown TLP
// partitions; action kind and id control overwrite and delete transitions.
// Absent-id delete changes only model/driver dispatch, with no Collection write.
// Ablating one loses its named distinction at a post-action
// checkpoint. The fixed seven-action split/merge trace and offset-3 empty tail
// lie outside the sampled 1..5-action and 0..2-offset bounds, so they remain
// separate controls. Parent ids initially 0/1 and child ids 10/11/12 exclude
// an invalid duplicate-key initial state. A put for an existing id is a legal
// update; a delete of an absent id issues no source change message.
// Other bounds: groups -1..1, positions -2..2, non-null scores and pivot
// -2..2, action parent ids 0..2, child ids 10..14, and limit 0..3. Zero
// limit, tied positions, nullable score, the last occupied offset, and the
// maximum sampled offset are marginal cases. Longer histories, deeper include
// trees, arbitrary row shapes, asynchronous failures, and provider races are
// outside this grammar and belong to the named adjacent owners.
const overwriteAndNoopScenario: CrossFormulationScenario = {
  parents: [
    { id: 0, group: -1, position: 0 },
    { id: 1, group: 1, position: 0 },
  ],
  children: [
    { id: 10, parentGroup: -1, score: -1, position: 0 },
    { id: 11, parentGroup: 1, score: 1, position: 0 },
    { id: 12, parentGroup: 0, score: null, position: 0 },
  ],
  pivot: 0,
  actions: [
    { type: `deleteChild`, id: 14 },
    {
      type: `putChild`,
      row: { id: 10, parentGroup: 1, score: 0, position: 1 },
    },
    { type: `putParent`, row: { id: 2, group: 0, position: -1 } },
    { type: `deleteParent`, id: 2 },
  ],
}

const scenarioExamples: Array<[CrossFormulationScenario]> = [
  [sharedRouteDeletionScenario],
  [partitionAndRouteScenario],
  [overwriteAndNoopScenario],
]

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

const windowedExamples: Array<
  [{ scenario: CrossFormulationScenario; offset: number; limit: number }]
> = [
  [{ scenario: partitionAndRouteScenario, offset: 0, limit: 0 }],
  [{ scenario: partitionAndRouteScenario, offset: 1, limit: 2 }],
  [{ scenario: partitionAndRouteScenario, offset: 2, limit: 3 }],
]

// The query-equality route values. Each row builds fresh values, so the
// enumerated history is the row's name and resolution finds its builder.
const groupedEqualityRoutes = [
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
] as const
const groupedEqualityRouteValues = new Map(
  groupedEqualityRoutes.map(([name, createValues]) => [name, createValues]),
)

// The former case body, unchanged: a nested grouped include and the
// standalone grouped query must agree through deletes and reinserts.
async function judgeGroupedEqualityRoute(
  createValues: (typeof groupedEqualityRoutes)[number][1],
): Promise<void> {
  const [parentGroup, equivalentChildGroup, unequalChildGroup] = createValues()
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
    const nestedCounts = expectNestedCountsMatchStandalone(
      nested.toArray,
      standalone.toArray,
    )
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
}

const groupedEqualityLaw = `A grouped include routes children by query equality, so its counts match the standalone grouped query for equal and unequal Date, binary, and Temporal route values.`

// Named regressions that the bounded scenario grammar cannot produce, or that
// the file keeps by name. Each replays the equivalence check unchanged.
const equivalenceFixedHistories: Array<{
  name: string
  scenario: CrossFormulationScenario
}> = [
  {
    name: `shared-route child deletion agrees across formulations`,
    scenario: sharedRouteDeletionScenario,
  },
  {
    name: `split, merge and reactivated routes preserve all predicate partitions`,
    scenario: {
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
    },
  },
]

const equivalenceLaw = `The nested, flat, per-parent, and TLP formulations publish the recomputed relationship model after every source change.`

// The bounded ordered-window cases, including the offset-3 empty tail that the
// sampled 0..2-offset grammar cannot produce.
const orderedWindowCases = [
  { name: `zero limit`, offset: 0, limit: 0 },
  { name: `first tied page`, offset: 0, limit: 2 },
  { name: `offset through tie`, offset: 1, limit: 2 },
  // One child remains at this boundary. Treating the final occupied offset
  // as an empty tail would violate the ordered-window contract.
  { name: `last occupied offset`, offset: 2, limit: 2 },
  { name: `empty tail`, offset: 3, limit: 2 },
]

// The former case body, unchanged.
function judgeOrderedWindowCase({
  offset,
  limit,
}: (typeof orderedWindowCases)[number]): Promise<void> {
  return expectWindowedIncludeMatches(
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
  )
}

const orderedWindowLaw = `A nested include's ordered child window matches the recomputed windowed model through root and child moves.`

describe(`includes cross-formulation oracle`, () => {
  const replay = readOracleRunConfig()

  // The next three properties have fixed route-transition histories. Their
  // generated integer is only a user token label: values span FastCheck's
  // default integer domain, while zero is reconstructed by the cold fixed
  // controls above. Ablating the label variation would leave the identity law
  // intact but lose evidence that token text does not affect it. Equal-shaped
  // distinct references and same-description distinct symbols are mandatory
  // premises; identical reference identity is outside these three controls.
  // The literal wrong-result and captured replay controls above distinguish
  // merged reference routes and symbol groups at their public checkpoints.

  registerIncludesProperty(
    [fc.integer()],
    {
      property: `includes-cross-formulation.reference-context`,
      runs: 4,
      fixedSeed: 1658001,
      owns: [
        `src/collection/change-events.ts#createFilterFunctionFromExpression`,
        `src/collection/index.ts#createCollection`,
        `src/query/live-query-collection.ts#createLiveQueryCollection`,
        `src/query/query-once.ts#queryOnce`,
      ],
    },
    `parent-context routing preserves reference-sensitive predicate values across transitions for a fixed seed`,
    async (code) => {
      await checkReferenceContextRouting(code)
    },
  )

  async function checkReferenceContextRouting(code: number): Promise<void> {
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
      oracleAssertion(
        'includes cross-formulation-oracle.property comparison 950',
        () =>
          expect(captureReferenceRows(lazy.toArray)).toEqual([
            { id: 1, children: [10] },
            { id: 2, children: [20] },
          ]),
      )
      oracleAssertion(
        'includes cross-formulation-oracle.property comparison 954',
        () =>
          expect(captureReferenceRows(lazy.toArray)).toEqual(
            captureReferenceRows(fullyLoaded.toArray),
          ),
      )

      parents.write(`delete`, parentRows[0]!)
      await flushPromises()
      oracleAssertion(
        'includes cross-formulation-oracle.property comparison 960',
        () =>
          expect(captureReferenceRows(lazy.toArray)).toEqual([
            { id: 2, children: [20] },
          ]),
      )
      oracleAssertion(
        'includes cross-formulation-oracle.property comparison 963',
        () =>
          expect(captureReferenceRows(lazy.toArray)).toEqual(
            captureReferenceRows(fullyLoaded.toArray),
          ),
      )

      parents.write(`insert`, parentRows[0]!)
      await flushPromises()
      oracleAssertion(
        'includes cross-formulation-oracle.property comparison 969',
        () =>
          expect(captureReferenceRows(lazy.toArray)).toEqual([
            { id: 1, children: [10] },
            { id: 2, children: [20] },
          ]),
      )
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
          oracleAssertion(
            'includes cross-formulation-oracle.property comparison 994',
            () =>
              expect(publications.length).toBeGreaterThan(priorPublications),
          )
          oracleAssertion(
            'includes cross-formulation-oracle.property comparison 995',
            () => expect(publications.at(-1)?.expected).toBe(row.expected),
          )
          oracleAssertion(
            'includes cross-formulation-oracle.property comparison 996',
            () => expect(publications.at(-1)?.revision).toBe(row.revision),
          )
          await flushPromises()
          const expectedRows = [
            { id: 1, children: [childIds[0]] },
            { id: 2, children: [childIds[1]] },
          ]
          oracleAssertion(
            'includes cross-formulation-oracle.property comparison 1002',
            () =>
              expect(captureReferenceRows(lazy.toArray)).toEqual(expectedRows),
          )
          oracleAssertion(
            'includes cross-formulation-oracle.property comparison 1003',
            () =>
              expect(captureReferenceRows(fullyLoaded.toArray)).toEqual(
                expectedRows,
              ),
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
  }

  oracleProperty({
    id: `includes-cross-formulation.grouped-equality`,
    law: {
      statement: groupedEqualityLaw,
      authority: `The cross-formulation equivalence contract stated at the start of this owner and packages/db/src/query/live/ARCHITECTURE.md.`,
      limits: `The three enumerated route-value families over controlled source Collections.`,
    },
    owns: [
      `src/collection/change-events.ts#createFilterFunctionFromExpression`,
      `src/collection/index.ts#createCollection`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
      `src/query/query-once.ts#queryOnce`,
    ],
    histories: groupedEqualityRoutes.map(([name]) => name),
    label: (name) => `grouped includes use query equality for ${name} routes`,
    resolve: (name) => ({
      createValues: groupedEqualityRouteValues.get(name)!,
    }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(groupedEqualityLaw, plan, observe, () =>
        judgeGroupedEqualityRoute(plan.createValues),
      ),
    check: forwardAssertionJudgment,
  })

  registerIncludesProperty(
    [fc.integer()],
    {
      property: `includes-cross-formulation.reference-key`,
      runs: 4,
      fixedSeed: 1658002,
      owns: [
        `src/collection/change-events.ts#createFilterFunctionFromExpression`,
        `src/collection/index.ts#createCollection`,
        `src/query/live-query-collection.ts#createLiveQueryCollection`,
        `src/query/query-once.ts#queryOnce`,
      ],
    },
    `lazy materialization matches fully loaded materialization for reference-sensitive correlation keys for a fixed seed`,
    (...args: Parameters<typeof checkReferenceKeyRouting>) => {
      return checkReferenceKeyRouting(...args)
    },
  )

  async function checkReferenceKeyRouting(code: number): Promise<void> {
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
      oracleAssertion(
        'includes cross-formulation-oracle.property comparison 1214',
        () => captureGroupedRows(query.toArray),
      )

    await withCleanup(async () => {
      await Promise.all([
        fullyLoaded.preload(),
        lazy.preload(),
        fullyLoadedGrouped.preload(),
        lazyGrouped.preload(),
      ])
      const fullyLoadedRows = oracleAssertion(
        'includes cross-formulation-oracle.property comparison 1223',
        () => captureReferenceRows(fullyLoaded.toArray),
      )
      const lazyRows = oracleAssertion(
        'includes cross-formulation-oracle.property comparison 1224',
        () => captureReferenceRows(lazy.toArray),
      )
      oracleAssertion(
        'includes cross-formulation-oracle.property comparison 1225',
        () => expect(lazyRows).toEqual(fullyLoadedRows),
      )
      oracleAssertion(
        'includes cross-formulation-oracle.property comparison 1226',
        () =>
          expect(lazyRows).toEqual([
            { id: 1, children: [10] },
            { id: 2, children: [20] },
          ]),
      )
      oracleAssertion(
        'includes cross-formulation-oracle.property comparison 1230',
        () =>
          expect(groupedRows(lazyGrouped)).toEqual(
            groupedRows(fullyLoadedGrouped),
          ),
      )
      oracleAssertion(
        'includes cross-formulation-oracle.property comparison 1231',
        () =>
          expect(groupedRows(lazyGrouped)).toEqual([
            { id: 1, summaries: [{ count: 1 }] },
            { id: 2, summaries: [{ count: 1 }] },
          ]),
      )

      parents.write(`delete`, parentRows[0]!)
      await flushPromises()
      oracleAssertion(
        'includes cross-formulation-oracle.property comparison 1238',
        () =>
          expect(captureReferenceRows(lazy.toArray)).toEqual([
            { id: 2, children: [20] },
          ]),
      )
      oracleAssertion(
        'includes cross-formulation-oracle.property comparison 1241',
        () =>
          expect(captureReferenceRows(lazy.toArray)).toEqual(
            captureReferenceRows(fullyLoaded.toArray),
          ),
      )
      oracleAssertion(
        'includes cross-formulation-oracle.property comparison 1244',
        () =>
          expect(groupedRows(lazyGrouped)).toEqual([
            { id: 2, summaries: [{ count: 1 }] },
          ]),
      )
      oracleAssertion(
        'includes cross-formulation-oracle.property comparison 1247',
        () =>
          expect(groupedRows(lazyGrouped)).toEqual(
            groupedRows(fullyLoadedGrouped),
          ),
      )

      parents.write(`insert`, parentRows[0]!)
      await flushPromises()
      oracleAssertion(
        'includes cross-formulation-oracle.property comparison 1251',
        () =>
          expect(captureReferenceRows(lazy.toArray)).toEqual([
            { id: 1, children: [10] },
            { id: 2, children: [20] },
          ]),
      )
      oracleAssertion(
        'includes cross-formulation-oracle.property comparison 1255',
        () =>
          expect(groupedRows(lazyGrouped)).toEqual([
            { id: 1, summaries: [{ count: 1 }] },
            { id: 2, summaries: [{ count: 1 }] },
          ]),
      )
    }, [
      () => fullyLoaded.cleanup(),
      () => lazy.cleanup(),
      () => fullyLoadedGrouped.cleanup(),
      () => lazyGrouped.cleanup(),
      () => parents.collection.cleanup(),
      () => fullyLoadedChildren.collection.cleanup(),
      () => lazyChildren.cleanup(),
    ])
  }

  registerIncludesProperty(
    [fc.integer()],
    {
      property: `includes-cross-formulation.symbol-group-route`,
      runs: 4,
      fixedSeed: 1658003,
      owns: [
        `src/collection/change-events.ts#createFilterFunctionFromExpression`,
        `src/collection/index.ts#createCollection`,
        `src/query/live-query-collection.ts#createLiveQueryCollection`,
        `src/query/query-once.ts#queryOnce`,
      ],
    },
    `grouped includes agree with standalone groups for symbol routes for a fixed seed`,
    (...args: Parameters<typeof checkSymbolGroupRouting>) => {
      return checkSymbolGroupRouting(...args)
    },
  )

  async function checkSymbolGroupRouting(code: number): Promise<void> {
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
        const nestedRows = oracleAssertion(
          'includes cross-formulation-oracle.property comparison 1325',
          () => captureGroupedRows(nested.toArray),
        )
        oracleAssertion(
          'includes cross-formulation-oracle.property comparison 1326',
          () =>
            expect(nestedRows).toEqual(
              standalone.map((query, index) => ({
                id: index + 1,
                summaries: captureCounts(query.toArray),
              })),
            ),
        )
        oracleAssertion(
          'includes cross-formulation-oracle.property comparison 1332',
          () => assertGroupedRouteCounts(nestedRows, counts),
        )
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
  }

  oracleProperty({
    id: `includes-cross-formulation.equivalence-fixed`,
    law: {
      statement: equivalenceLaw,
      authority: `The cross-formulation equivalence contract stated at the start of this owner and packages/db/src/query/live/ARCHITECTURE.md.`,
      limits: `Two named fixed scenarios, replayed through the same equivalence check as the generated campaign.`,
    },
    owns: [
      `src/collection/change-events.ts#createFilterFunctionFromExpression`,
      `src/collection/index.ts#createCollection`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
      `src/query/query-once.ts#queryOnce`,
    ],
    histories: equivalenceFixedHistories,
    label: ({ name }) => name,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(equivalenceLaw, plan, observe, () =>
        expectFormulationsEquivalent(plan.history.scenario),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `includes-cross-formulation.ordered-window-cases`,
    law: {
      statement: orderedWindowLaw,
      authority: `The cross-formulation equivalence contract stated at the start of this owner and packages/db/src/query/live/ARCHITECTURE.md.`,
      limits: `The five enumerated offset and limit cases over one fixed scenario.`,
    },
    owns: [
      `src/collection/change-events.ts#createFilterFunctionFromExpression`,
      `src/collection/index.ts#createCollection`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
      `src/query/query-once.ts#queryOnce`,
    ],
    histories: orderedWindowCases,
    label: ({ name }) =>
      `preserves ordered window ${name} through root and child moves`,
    resolve: (windowCase) => ({ ...windowCase }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(orderedWindowLaw, plan, observe, () =>
        judgeOrderedWindowCase(plan),
      ),
    check: forwardAssertionJudgment,
  })

  // Checked direct replay witness:
  // TANSTACK_DB_ORACLE_SEED=1658004
  // TANSTACK_DB_ORACLE_PATH=0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0
  // TANSTACK_DB_ORACLE_PROPERTY=includes-cross-formulation.equivalence
  // TANSTACK_DB_ORACLE_CALIBRATION=missing-parent
  // pnpm --filter @tanstack/db exec vitest --run --coverage.enabled=false
  // tests/query/includes-cross-formulation-oracle.property.test.ts
  // -t 'includes-cross-formulation\\.equivalence > random seed'
  // Expected: one main-property failure at cross-formulation checkpoint 0.
  oracleCalibrationTest(
    test,
    `includes-cross-formulation.equivalence`,
    `missing-parent`,
  )(
    `generated equivalence rejects a missing production parent and replays its checkpoint`,
    async () => {
      oracleRoute(`calibration`)
      // The hostile observation is injected after the real nested query is
      // captured. The same generated driver and refinement comparison execute
      // during shrinking and direct seed/path replay.
      const property = fc.asyncProperty(scenarioArbitrary, async (scenario) => {
        await expectFormulationsEquivalent(scenario, (rows) => rows.slice(1))
      })
      const propertyId = `includes-cross-formulation.equivalence`
      const directReplay = oracleReplayRequested()
      const failure = await runIncludesCalibration(
        property,
        directReplay
          ? { ...oraclePropertyOptions(8, propertyId), endOnFailure: true }
          : oracleFixedSeed(1_658_004, { numRuns: oracleRuns(8) }),
      )
      expect(failure.failed).toBe(true)
      expect(String(failure.errorInstance)).toContain(
        `cross-formulation checkpoint`,
      )
      expect(String(failure.errorInstance)).toContain(`checkpoint":0`)
      if (directReplay) {
        expect(failure.seed).toBe(replay.campaignSeed)
        expect(replay.replayPath).toBe(
          `0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0`,
        )
        return
      }
      expect(failure.numShrinks).toBeGreaterThan(0)
      if (failure.counterexamplePath === null)
        throw new Error(`missing-parent mutant did not produce a replay path`)
      expect(failure.counterexamplePath).toBe(
        `0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0`,
      )
      const replayResult = await runIncludesCalibration(property, {
        seed: failure.seed,
        path: failure.counterexamplePath,
        numRuns: 1,
        endOnFailure: true,
      })
      expect(replayResult.failed).toBe(true)
      expect(String(replayResult.errorInstance)).toContain(
        `cross-formulation checkpoint`,
      )
      expect(String(replayResult.errorInstance)).toContain(`checkpoint":0`)
      expect(replayResult.counterexample).toEqual(failure.counterexample)
    },
  )

  // Checked direct replay witness:
  // TANSTACK_DB_ORACLE_SEED=1658005
  // TANSTACK_DB_ORACLE_PATH=0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0
  // TANSTACK_DB_ORACLE_PROPERTY=includes-cross-formulation.ordered-window
  // TANSTACK_DB_ORACLE_CALIBRATION=extra-child
  // pnpm --filter @tanstack/db exec vitest --run --coverage.enabled=false
  // tests/query/includes-cross-formulation-oracle.property.test.ts
  // -t 'includes-cross-formulation\\.ordered-window > random seed'
  // Expected: one main-property failure at ordered-window checkpoint 0.
  oracleCalibrationTest(
    test,
    `includes-cross-formulation.ordered-window`,
    `extra-child`,
  )(
    `generated window rejects an extra production child and replays its checkpoint`,
    async () => {
      oracleRoute(`calibration`)
      const property = fc.asyncProperty(
        windowedScenarioArbitrary,
        async (sample) => {
          const { scenario, offset, limit } = sample
          await expectWindowedIncludeMatches(scenario, offset, limit, (rows) =>
            rows.map((parent, index) =>
              index === 0
                ? {
                    ...parent,
                    children: [...parent.children, scenario.children[0]!],
                  }
                : parent,
            ),
          )
        },
      )
      const propertyId = `includes-cross-formulation.ordered-window`
      const directReplay = oracleReplayRequested()
      const failure = await runIncludesCalibration(
        property,
        directReplay
          ? { ...oraclePropertyOptions(12, propertyId), endOnFailure: true }
          : oracleFixedSeed(1_658_005, { numRuns: oracleRuns(12) }),
      )
      expect(failure.failed).toBe(true)
      expect(String(failure.errorInstance)).toContain(
        `ordered-window checkpoint`,
      )
      expect(String(failure.errorInstance)).toContain(`checkpoint":0`)
      if (directReplay) {
        expect(failure.seed).toBe(replay.campaignSeed)
        expect(replay.replayPath).toBe(`0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0`)
        return
      }
      expect(failure.numShrinks).toBeGreaterThan(0)
      if (failure.counterexamplePath === null)
        throw new Error(`extra-child mutant did not produce a replay path`)
      expect(failure.counterexamplePath).toBe(
        `0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0`,
      )
      const replayResult = await runIncludesCalibration(property, {
        seed: failure.seed,
        path: failure.counterexamplePath,
        numRuns: 1,
        endOnFailure: true,
      })
      expect(replayResult.failed).toBe(true)
      expect(String(replayResult.errorInstance)).toContain(
        `ordered-window checkpoint`,
      )
      expect(String(replayResult.errorInstance)).toContain(`checkpoint":0`)
      expect(replayResult.counterexample).toEqual(failure.counterexample)
    },
  )

  const checkEquivalenceScenario = (scenario: CrossFormulationScenario) =>
    expectFormulationsEquivalent(
      scenario,
      replay.replayPath !== undefined &&
        replay.replayProperty === `includes-cross-formulation.equivalence` &&
        process.env.TANSTACK_DB_ORACLE_CALIBRATION === `missing-parent`
        ? (rows) => rows.slice(1)
        : undefined,
    )

  registerIncludesProperty(
    [scenarioArbitrary],
    {
      property: `includes-cross-formulation.equivalence`,
      runs: 8,
      fixedSeed: 1658004,
      examples: scenarioExamples,
      owns: [
        `src/collection/change-events.ts#createFilterFunctionFromExpression`,
        `src/collection/index.ts#createCollection`,
        `src/query/live-query-collection.ts#createLiveQueryCollection`,
        `src/query/query-once.ts#queryOnce`,
      ],
    },
    `agrees across nested includes, flat joins, per-parent queries, and TLP partitions for a fixed seed`,
    (...args: Parameters<typeof checkEquivalenceScenario>) => {
      return checkEquivalenceScenario(...args)
    },
  )

  const checkWindowedScenario = ({
    scenario,
    offset,
    limit,
  }: {
    scenario: CrossFormulationScenario
    offset: number
    limit: number
  }) =>
    expectWindowedIncludeMatches(
      scenario,
      offset,
      limit,
      replay.replayPath !== undefined &&
        replay.replayProperty === `includes-cross-formulation.ordered-window` &&
        process.env.TANSTACK_DB_ORACLE_CALIBRATION === `extra-child`
        ? (rows) =>
            rows.map((parent, index) =>
              index === 0
                ? {
                    ...parent,
                    children: [...parent.children, scenario.children[0]!],
                  }
                : parent,
            )
        : undefined,
    )

  registerIncludesProperty(
    [windowedScenarioArbitrary],
    {
      property: `includes-cross-formulation.ordered-window`,
      runs: 12,
      fixedSeed: 1658005,
      examples: windowedExamples,
      owns: [
        `src/collection/change-events.ts#createFilterFunctionFromExpression`,
        `src/collection/index.ts#createCollection`,
        `src/query/live-query-collection.ts#createLiveQueryCollection`,
        `src/query/query-once.ts#queryOnce`,
      ],
    },
    `matches recomputation for ordered offset and limit child windows for a fixed seed`,
    (...args: Parameters<typeof checkWindowedScenario>) => {
      return checkWindowedScenario(...args)
    },
  )
})
