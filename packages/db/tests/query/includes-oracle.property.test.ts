import { fc } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
  rejectAt,
} from '../oracle-assertion-adapter.js'
import {
  concat,
  createLiveQueryCollection,
  eq,
  include,
  materialize,
  queryOnce,
  toArray,
} from '../../src/query/index.js'
import {
  flushPromises,
  withExpectedRejection,
  withOracleCleanup,
} from '../utils.js'
import {
  oracleProperty,
  oraclePropertyOptions,
  oracleReplayRequested,
  oracleRuns,
} from '../oracle-config.js'
import { hash } from '../../../db-ivm/src/hashing/hash.js'
import {
  DISTINCT_REACH_STATES,
  distinctHistory,
  distinctReachStates,
} from '../../../db-ivm/tests/distinct-incrementalization-oracle.js'
import { routeKey } from '../../src/query/live/public-key-reduction.js'
import { createValueIdentity } from '../../src/query/equality-value-identity.js'
import { runTrace } from '../trace-runner.js'
import { registerIncludesProperty } from './includes-registration-oracle.js'
import {
  cleanupPendingWork,
  createControlledCollection,
  createSources,
  plainSubquery,
  refsInclude,
  releasePendingWork,
  stripVirtualProperties,
  trackPendingWork,
  withPendingWorkCleanup,
} from './includes-structural-support.js'
import {
  batchChild,
  batchRoot,
  createConnectedBatchBranches,
  createVisibleRelationshipScenario,
  transitionHistoryBranches,
  updateFullRowBatchModels,
  updateModel,
} from './includes-route-grammar-oracle.js'
import {
  applyScopedWrite,
  canonicalScopedAliases,
  classifyScopedNaming,
  createModelState,
  createScopedQuery,
  createScopedSources,
  normalizeScopedRows,
  recomputeScopedRows,
  scopedScenarioArbitrary,
  sortedRequests,
} from './includes-scope-identity-oracle.js'
import {
  branchDeliveryOrders,
  compareRows,
  createInitiallySharedRouteResubscribeScenario,
  createIntraBatchRekeyRouteReuseScenarios,
  createMergeIntoSharedRouteScenarios,
  createMovedChildReplacementScenarios,
  createRekeyRouteReuseScenarios,
  createRelationshipBatchShapeMatrix,
  createSharedRouteLastSubscriberScenario,
  createSharedRouteLifetimeScenarios,
  createSnapshotOnResubscribeScenarios,
  createTransitionHistoryScenario,
  destinationHistories,
  destinationHistoryScenarioArbitrary,
  expectEveryHistoryStepVisible,
  expectEveryRouteTransitionVisible,
  independentTransitionScenarioArbitrary,
  independentTransitionShapes,
  levelArbitrary,
  movedChildReplacementMirrorsArbitrary,
  recompute,
  recomputeFullRowBatchScenario,
  rekeyRouteReuseScenarioArbitrary,
  relationshipBatchFixtureArbitrary,
  transitionHistoryPlacements,
  transitionHistoryScenariosArbitrary,
  visibleRelationshipScenarioArbitrary,
} from './includes-history-grammar-oracle.js'
import type {
  FullRowBatchScenario,
  FullRowBatchStep,
  IncludeDepth,
  VisibleRelationshipScenario,
} from './includes-route-grammar-oracle.js'
import type {
  ChildRow,
  PendingTransaction,
  PendingWork,
  RootRow,
  Sources,
} from './includes-structural-support.js'
import type {
  TraceCheckpoint,
  TraceDriver,
  TraceProjection,
} from '../trace-runner.js'
import type { OracleSyncChange as SyncChange } from './includes-oracle-helpers.js'
import type {
  ScopedAliases,
  ScopedPart,
  ScopedRef,
  ScopedResultRow,
  ScopedScenario,
  ScopedShape,
} from './includes-scope-identity-oracle.js'

import type {
  HistoryAction,
  HistoryScenarioPair,
  OracleNode,
  VisibleRelationshipTransition,
} from './includes-history-grammar-oracle.js'

type Scenario = {
  depth: IncludeDepth
  history: Array<HistoryAction>
}

type MaterializeRoot = { id: number; middleId: number }
type MaterializeMiddle = { id: number; sharedId: number }
type MaterializeShared = { id: number; leafId: number }
type MaterializeLeaf = { id: number; value: number }

type MaterializeTree = {
  id: number
  middle:
    | {
        id: number
        sharedId: number
        shared:
          | {
              id: number
              leafId: number
              leaf: MaterializeLeaf | undefined
            }
          | undefined
      }
    | undefined
}

type MaterializeInsert =
  | `root-1`
  | `root-2`
  | `middle-1`
  | `middle-2`
  | `shared-1`
  | `shared-2`
  | `leaf-1`
  | `leaf-2`

type MaterializeScenario = {
  sharedIntermediate: boolean
  insertOrder: Array<MaterializeInsert>
}

const depthArbitrary = fc.constantFrom<IncludeDepth>(1, 2, 3, 4)

// Each generated structural matrix keeps its historical seed and also samples
// a fresh seed at the same budget. A seed-and-path replay runs only its named
// property; other matrix cells cannot delay or obscure that reproduction.
function generatedCampaigns(runs: number, property: string, fixedSeed: number) {
  return [{ label: `fixed and random`, options: { runs, property, fixedSeed } }]
}

function actionArbitrary(depth: IncludeDepth): fc.Arbitrary<HistoryAction> {
  return levelArbitrary(depth).chain((level) =>
    fc.record({
      // Root delete/reinsert has a focused history matrix below. Keep this
      // unconstrained corpus small enough to shrink to one clear action.
      type:
        level === 0
          ? fc.constantFrom(
              `put` as const,
              `optimisticConfirm` as const,
              `optimisticRollback` as const,
            )
          : fc.constantFrom(
              `put` as const,
              `delete` as const,
              `optimisticConfirm` as const,
              `optimisticRollback` as const,
            ),
      level: fc.constant(level),
      id: fc.integer({ min: 0, max: 5 }),
      parentGroup: fc.integer({ min: 0, max: 2 }),
      group: fc.integer({ min: 0, max: 2 }),
      value: fc.integer({ min: -3, max: 3 }),
      position: fc.integer({ min: -2, max: 2 }),
    }),
  )
}

function ensureActionsTargetRows(
  history: Array<HistoryAction>,
): Array<HistoryAction> {
  const keysByLevel = Array.from({ length: 5 }, () => new Set<number>())
  const positionsByLevel = Array.from(
    { length: 5 },
    () => new Map<number, number>(),
  )

  return history.map((action) => {
    const keys = keysByLevel[action.level]!
    const positions = positionsByLevel[action.level]!
    const normalizePut = (): HistoryAction => {
      keys.add(action.id)
      const position = positions.get(action.id) ?? action.position
      positions.set(action.id, position)
      return { ...action, type: `put`, position }
    }

    if (action.type === `put`) {
      return normalizePut()
    }
    if (keys.size === 0) {
      return normalizePut()
    }

    const existingKeys = [...keys]
    const id = existingKeys[action.id % existingKeys.length]!
    if (action.type === `delete`) {
      keys.delete(id)
      positions.delete(id)
    }
    return { ...action, id }
  })
}

// This grammar constructs legal row histories. The Map model below, not the
// grammar, decides their expected nested result.
const scenarioArbitrary: fc.Arbitrary<Scenario> = depthArbitrary.chain(
  (depth) =>
    fc
      .array(actionArbitrary(depth), { minLength: 1, maxLength: 18 })
      .map((history) => ({
        depth,
        history: ensureActionsTargetRows(history),
      })),
)

// This is syntax distribution, not delivered transition coverage. Route
// assignments below do not restore rollbacks or skip absent/no-op actions.
function classifyScenarioSyntax({ depth, history }: Scenario): Array<string> {
  const routesByLevel = Array.from(
    { length: depth + 1 },
    () => new Map<number, { parentGroup: number; group: number }>(),
  )
  let relationshipChanges = 0

  for (const action of history) {
    const routes = routesByLevel[action.level]!
    if (action.type === `delete`) {
      routes.delete(action.id)
      continue
    }

    const previous = routes.get(action.id)
    if (
      previous &&
      (previous.group !== action.group ||
        (action.level > 0 && previous.parentGroup !== action.parentGroup))
    ) {
      relationshipChanges += 1
    }
    routes.set(action.id, {
      parentGroup: action.parentGroup,
      group: action.group,
    })
  }

  return [
    `depth=${depth}`,
    `syntactic-route-changes=${
      relationshipChanges === 0
        ? `none`
        : relationshipChanges === 1
          ? `one`
          : `many`
    }`,
    `has-optimistic-syntax=${history.some((action) =>
      action.type.startsWith(`optimistic`),
    )}`,
    `has-delete-syntax=${history.some((action) => action.type === `delete`)}`,
  ]
}

if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`) {
  fc.statistics(
    scenarioArbitrary,
    classifyScenarioSyntax,
    oraclePropertyOptions(1_000, `includes.scenario-statistics`),
  )
}

const materializeScenarioArbitrary: fc.Arbitrary<MaterializeScenario> = fc
  .boolean()
  .chain((sharedIntermediate) => {
    const inserts: Array<MaterializeInsert> = sharedIntermediate
      ? [`root-1`, `root-2`, `middle-1`, `middle-2`, `shared-1`, `leaf-1`]
      : [
          `root-1`,
          `root-2`,
          `middle-1`,
          `middle-2`,
          `shared-1`,
          `shared-2`,
          `leaf-1`,
          `leaf-2`,
        ]

    return fc
      .shuffledSubarray(inserts, {
        minLength: inserts.length,
        maxLength: inserts.length,
      })
      .map((insertOrder) => ({ sharedIntermediate, insertOrder }))
  })

const sharedMaterializeSeed: MaterializeScenario = {
  sharedIntermediate: true,
  insertOrder: [
    `root-2`,
    `middle-2`,
    `root-1`,
    `middle-1`,
    `shared-1`,
    `leaf-1`,
  ],
}

const confirmedChildReorderSeed: Scenario = {
  depth: 2,
  history: [
    {
      type: `put`,
      level: 0,
      id: 0,
      parentGroup: 0,
      group: 0,
      value: 0,
      position: 0,
    },
    {
      type: `put`,
      level: 1,
      id: 1,
      parentGroup: 0,
      group: 0,
      value: 0,
      position: -1,
    },
    {
      type: `put`,
      level: 1,
      id: 2,
      parentGroup: 0,
      group: 0,
      value: 0,
      position: -1,
    },
    {
      type: `put`,
      level: 1,
      id: 1,
      parentGroup: 0,
      group: 0,
      value: 0,
      position: 0,
    },
  ],
}

function createIncrementalQuery(depth: IncludeDepth, sources: Sources) {
  const { roots } = sources
  const [level1, level2, level3, level4] = sources.levels

  switch (depth) {
    case 1:
      return createLiveQueryCollection((q) =>
        q
          .from({ root: roots.collection })
          .orderBy(({ root }) => root.position)
          .orderBy(({ root }) => root.id)
          .select(({ root }) => ({
            id: root.id,
            group: root.group,
            value: root.value,
            position: root.position,
            children: toArray(
              q
                .from({ child: level1.collection })
                .where(({ child }) => eq(child.parentGroup, root.group))
                .orderBy(({ child }) => child.position)
                .orderBy(({ child }) => child.id)
                .select(({ child }) => ({
                  id: child.id,
                  group: child.group,
                  value: child.value,
                  position: child.position,
                })),
            ),
          })),
      )
    case 2:
      return createLiveQueryCollection((q) =>
        q
          .from({ root: roots.collection })
          .orderBy(({ root }) => root.position)
          .orderBy(({ root }) => root.id)
          .select(({ root }) => ({
            id: root.id,
            group: root.group,
            value: root.value,
            position: root.position,
            children: toArray(
              q
                .from({ child: level1.collection })
                .where(({ child }) => eq(child.parentGroup, root.group))
                .orderBy(({ child }) => child.position)
                .orderBy(({ child }) => child.id)
                .select(({ child }) => ({
                  id: child.id,
                  group: child.group,
                  value: child.value,
                  position: child.position,
                  children: toArray(
                    q
                      .from({ grandchild: level2.collection })
                      .where(({ grandchild }) =>
                        eq(grandchild.parentGroup, child.group),
                      )
                      .orderBy(({ grandchild }) => grandchild.position)
                      .orderBy(({ grandchild }) => grandchild.id)
                      .select(({ grandchild }) => ({
                        id: grandchild.id,
                        group: grandchild.group,
                        value: grandchild.value,
                        position: grandchild.position,
                      })),
                  ),
                })),
            ),
          })),
      )
    case 3:
      return createLiveQueryCollection((q) =>
        q
          .from({ root: roots.collection })
          .orderBy(({ root }) => root.position)
          .orderBy(({ root }) => root.id)
          .select(({ root }) => ({
            id: root.id,
            group: root.group,
            value: root.value,
            position: root.position,
            children: toArray(
              q
                .from({ child: level1.collection })
                .where(({ child }) => eq(child.parentGroup, root.group))
                .orderBy(({ child }) => child.position)
                .orderBy(({ child }) => child.id)
                .select(({ child }) => ({
                  id: child.id,
                  group: child.group,
                  value: child.value,
                  position: child.position,
                  children: toArray(
                    q
                      .from({ grandchild: level2.collection })
                      .where(({ grandchild }) =>
                        eq(grandchild.parentGroup, child.group),
                      )
                      .orderBy(({ grandchild }) => grandchild.position)
                      .orderBy(({ grandchild }) => grandchild.id)
                      .select(({ grandchild }) => ({
                        id: grandchild.id,
                        group: grandchild.group,
                        value: grandchild.value,
                        position: grandchild.position,
                        children: toArray(
                          q
                            .from({ greatGrandchild: level3.collection })
                            .where(({ greatGrandchild }) =>
                              eq(greatGrandchild.parentGroup, grandchild.group),
                            )
                            .orderBy(
                              ({ greatGrandchild }) => greatGrandchild.position,
                            )
                            .orderBy(
                              ({ greatGrandchild }) => greatGrandchild.id,
                            )
                            .select(({ greatGrandchild }) => ({
                              id: greatGrandchild.id,
                              group: greatGrandchild.group,
                              value: greatGrandchild.value,
                              position: greatGrandchild.position,
                            })),
                        ),
                      })),
                  ),
                })),
            ),
          })),
      )
    case 4:
      return createLiveQueryCollection((q) =>
        q
          .from({ root: roots.collection })
          .orderBy(({ root }) => root.position)
          .orderBy(({ root }) => root.id)
          .select(({ root }) => ({
            id: root.id,
            group: root.group,
            value: root.value,
            position: root.position,
            children: toArray(
              q
                .from({ child: level1.collection })
                .where(({ child }) => eq(child.parentGroup, root.group))
                .orderBy(({ child }) => child.position)
                .orderBy(({ child }) => child.id)
                .select(({ child }) => ({
                  id: child.id,
                  group: child.group,
                  value: child.value,
                  position: child.position,
                  children: toArray(
                    q
                      .from({ grandchild: level2.collection })
                      .where(({ grandchild }) =>
                        eq(grandchild.parentGroup, child.group),
                      )
                      .orderBy(({ grandchild }) => grandchild.position)
                      .orderBy(({ grandchild }) => grandchild.id)
                      .select(({ grandchild }) => ({
                        id: grandchild.id,
                        group: grandchild.group,
                        value: grandchild.value,
                        position: grandchild.position,
                        children: toArray(
                          q
                            .from({ greatGrandchild: level3.collection })
                            .where(({ greatGrandchild }) =>
                              eq(greatGrandchild.parentGroup, grandchild.group),
                            )
                            .orderBy(
                              ({ greatGrandchild }) => greatGrandchild.position,
                            )
                            .orderBy(
                              ({ greatGrandchild }) => greatGrandchild.id,
                            )
                            .select(({ greatGrandchild }) => ({
                              id: greatGrandchild.id,
                              group: greatGrandchild.group,
                              value: greatGrandchild.value,
                              position: greatGrandchild.position,
                              children: toArray(
                                q
                                  .from({ finalChild: level4.collection })
                                  .where(({ finalChild }) =>
                                    eq(
                                      finalChild.parentGroup,
                                      greatGrandchild.group,
                                    ),
                                  )
                                  .orderBy(
                                    ({ finalChild }) => finalChild.position,
                                  )
                                  .orderBy(({ finalChild }) => finalChild.id)
                                  .select(({ finalChild }) => ({
                                    id: finalChild.id,
                                    group: finalChild.group,
                                    value: finalChild.value,
                                    position: finalChild.position,
                                  })),
                              ),
                            })),
                        ),
                      })),
                  ),
                })),
            ),
          })),
      )
  }
}

function sameRoot(left: RootRow, right: RootRow): boolean {
  return (
    left.group === right.group &&
    left.value === right.value &&
    left.position === right.position
  )
}

function sameChild(left: ChildRow, right: ChildRow): boolean {
  return left.parentGroup === right.parentGroup && sameRoot(left, right)
}

async function settleOptimisticAction(
  action: HistoryAction,
  resolveSync: () => void,
  rejectSync: (error: Error) => void,
  persistedPromise: Promise<unknown>,
  pending: Set<PendingWork>,
  entry: PendingWork,
): Promise<void> {
  if (action.type === `optimisticConfirm`) {
    releasePendingWork(pending, entry, resolveSync)
    await persistedPromise
    return
  }

  const message = `oracle optimistic rollback`
  const persisted = persistedPromise.catch(() => undefined)
  await withExpectedRejection(message, async () => {
    releasePendingWork(pending, entry, () => rejectSync(new Error(message)))
    await persisted
    await flushPromises()
  })
}

async function applyAction(
  action: HistoryAction,
  sources: Sources,
  roots: Map<number, RootRow>,
  levels: Array<Map<number, ChildRow>>,
  assertMatches: TraceCheckpoint,
  pending: Set<PendingWork>,
): Promise<void> {
  if (action.level === 0) {
    const current = roots.get(action.id)
    if (action.type === `delete`) {
      if (current) {
        sources.roots.write(`delete`, current)
        roots.delete(action.id)
        assertMatches()
      }
      return
    }

    const next: RootRow = {
      id: action.id,
      group: action.group,
      value: action.value,
      position:
        action.type === `put` ? action.position : (current?.position ?? 0),
    }

    if (action.type !== `put` && !current) return
    if (action.type !== `put` && current && sameRoot(current, next)) return

    if (
      action.type === `optimisticConfirm` ||
      action.type === `optimisticRollback`
    ) {
      const transaction = sources.roots.collection.update(
        action.id,
        (draft) => {
          draft.group = next.group
          draft.value = next.value
        },
      )
      const entry = trackPendingWork(
        pending,
        transaction,
        sources.roots.resolveSync,
      )
      roots.set(action.id, next)
      assertMatches()

      if (action.type === `optimisticConfirm`) {
        sources.roots.write(`update`, next)
      }
      await settleOptimisticAction(
        action,
        sources.roots.resolveSync,
        sources.roots.rejectSync,
        transaction.when(`settled`),
        pending,
        entry,
      )
      if (action.type === `optimisticRollback`) {
        roots.set(action.id, current!)
        assertMatches()
      }
      return
    }

    sources.roots.write(current ? `update` : `insert`, next)
    roots.set(action.id, next)
    assertMatches()
    return
  }

  const level = action.level - 1
  const model = levels[level]!
  const source = sources.levels[level]!
  const current = model.get(action.id)
  if (action.type === `delete`) {
    if (current) {
      source.write(`delete`, current)
      model.delete(action.id)
      assertMatches()
    }
    return
  }

  const next: ChildRow = {
    id: action.id,
    parentGroup: action.parentGroup,
    group: action.group,
    value: action.value,
    position:
      action.type === `put` ? action.position : (current?.position ?? 0),
  }

  if (action.type !== `put` && !current) return
  if (action.type !== `put` && current && sameChild(current, next)) return

  if (
    action.type === `optimisticConfirm` ||
    action.type === `optimisticRollback`
  ) {
    const transaction = source.collection.update(action.id, (draft) => {
      draft.parentGroup = next.parentGroup
      draft.group = next.group
      draft.value = next.value
    })
    const entry = trackPendingWork(pending, transaction, source.resolveSync)
    model.set(action.id, next)
    assertMatches()

    if (action.type === `optimisticConfirm`) {
      source.write(`update`, next)
    }
    await settleOptimisticAction(
      action,
      source.resolveSync,
      source.rejectSync,
      transaction.when(`settled`),
      pending,
      entry,
    )
    if (action.type === `optimisticRollback`) {
      model.set(action.id, current!)
      assertMatches()
    }
    return
  }

  source.write(current ? `update` : `insert`, next)
  model.set(action.id, next)
  assertMatches()
}

type StructuralTraceContext = {
  depth: IncludeDepth
  sources: Sources
  incremental: ReturnType<typeof createIncrementalQuery>
  roots: Map<number, RootRow>
  levels: Array<Map<number, ChildRow>>
  pendingWork: Set<PendingWork>
}

function createStructuralTraceContext(
  depth: IncludeDepth,
  rowUpdateMode: `partial` | `full` = `partial`,
): StructuralTraceContext {
  const sources = createSources(rowUpdateMode)
  return {
    depth,
    sources,
    incremental: createIncrementalQuery(depth, sources),
    roots: new Map<number, RootRow>(),
    levels: Array.from({ length: 4 }, () => new Map<number, ChildRow>()),
    pendingWork: new Set(),
  }
}

async function cleanupStructuralTrace({
  incremental,
  sources,
  pendingWork,
}: Pick<StructuralTraceContext, `sources` | `pendingWork`> & {
  incremental: { cleanup: () => Promise<void> }
}): Promise<void> {
  await cleanupPendingWork(pendingWork, [
    incremental,
    sources.roots.collection,
    ...sources.levels.map(({ collection }) => collection),
  ])
}

function createStructuralTraceDriver(
  depth: IncludeDepth,
): TraceDriver<HistoryAction, StructuralTraceContext> {
  return {
    setup: () => createStructuralTraceContext(depth),
    start: ({ incremental }) => incremental.preload(),
    apply: (action, context, checkpoint) =>
      applyAction(
        action,
        context.sources,
        context.roots,
        context.levels,
        checkpoint,
        context.pendingWork,
      ),
    cleanup: cleanupStructuralTrace,
  }
}

type FullRowBatchInput = {
  level: 0 | IncludeDepth
  changes: Array<{
    type: `put` | `delete`
    id: number
    parentGroup: number
    group: number
    value: number
    position: number
  }>
}

function createFullRowBatchTraceDriver(
  depth: IncludeDepth,
): TraceDriver<FullRowBatchStep, StructuralTraceContext> {
  return {
    setup: () => createStructuralTraceContext(depth, `full`),
    start: ({ incremental }) => incremental.preload(),
    apply: (step, { sources, roots, levels }) => {
      if (step.level === 0) {
        sources.roots.writeBatch(step.changes)
      } else {
        sources.levels[step.level - 1]!.writeBatch(step.changes)
      }
      updateFullRowBatchModels(step, roots, levels)
    },
    cleanup: cleanupStructuralTrace,
  }
}

const fullRowBatchTrace: Array<FullRowBatchStep> = [
  {
    level: 0,
    changes: [
      { type: `insert`, value: batchRoot(1, 1) },
      { type: `insert`, value: batchRoot(2, 2) },
    ],
  },
  {
    level: 1,
    changes: [
      { type: `insert`, value: batchChild(1, 1, 10, 0) },
      { type: `insert`, value: batchChild(2, 1, 20, 1) },
      { type: `insert`, value: batchChild(3, 2, 30, 0) },
    ],
  },
  {
    level: 1,
    changes: [
      { type: `update`, value: batchChild(1, 2, 11, 0) },
      { type: `update`, value: batchChild(2, 1, 22, 1) },
    ],
  },
  {
    level: 1,
    changes: [
      { type: `delete`, value: batchChild(3, 2, 30, 0) },
      { type: `insert`, value: batchChild(4, 2, 40, 1) },
    ],
  },
]

const fullRowSharedRoutingSeed: FullRowBatchScenario = {
  depth: 1,
  steps: [
    {
      level: 0,
      changes: [
        { type: `insert`, value: batchRoot(0, 2, 0, 0) },
        { type: `insert`, value: batchRoot(1, 2, 0, 0) },
      ],
    },
    {
      level: 0,
      changes: [{ type: `delete`, value: batchRoot(1, 2, 0, 0) }],
    },
    {
      level: 0,
      changes: [{ type: `insert`, value: batchRoot(1, 0, 0, 0) }],
    },
    {
      level: 1,
      changes: [{ type: `insert`, value: batchChild(0, 2, 0, 0) }],
    },
  ],
}

function fullRowBatchInputArbitrary(
  depth: IncludeDepth,
  levels: `all` | `children`,
  maxBatchSize = 3,
): fc.Arbitrary<FullRowBatchInput> {
  const levelsArbitrary =
    levels === `all`
      ? levelArbitrary(depth)
      : fc.integer({ min: 1, max: depth }).map((level) => level as IncludeDepth)

  return levelsArbitrary.chain((level) =>
    fc
      .uniqueArray(
        fc.record({
          // Root delete/reinsert has a known failing seed below. Keep the
          // generated green corpus out of that class while still generating
          // inserts, replacements, and multi-change batches at the root.
          type:
            level === 0
              ? fc.constant(`put` as const)
              : fc.constantFrom(`put` as const, `delete` as const),
          id: fc.integer({ min: 0, max: 5 }),
          parentGroup: fc.integer({ min: 0, max: 4 }),
          group: fc.integer({ min: 0, max: 4 }),
          value: fc.integer({ min: -3, max: 3 }),
          position: fc.integer({ min: -2, max: 2 }),
        }),
        {
          selector: (change) => change.id,
          minLength: 1,
          maxLength: maxBatchSize,
        },
      )
      .map((changes) => ({ level, changes })),
  )
}

function createConnectedBatchPrefix(
  depth: IncludeDepth,
): Array<FullRowBatchStep> {
  // Generated ids stop at 5, so this path survives every later batch and
  // guarantees that the selected depth is observable at every checkpoint.
  const steps: Array<FullRowBatchStep> = [
    {
      level: 0,
      changes: [{ type: `insert`, value: batchRoot(100, 100, 100, 0) }],
    },
  ]

  for (let level = 1; level <= depth; level++) {
    steps.push({
      level: level as IncludeDepth,
      changes: [
        {
          type: `insert`,
          value: {
            ...batchChild(100 + level, 99 + level, 100 + level, 0),
            group: 100 + level,
          },
        },
      ],
    })
  }

  return steps
}

function normalizeFullRowBatchInputs(
  depth: IncludeDepth,
  inputs: Array<FullRowBatchInput>,
): FullRowBatchScenario {
  const roots = new Map<number, RootRow>([[100, batchRoot(100, 100, 100, 0)]])
  const levels = Array.from(
    { length: 4 },
    (_, level) =>
      new Map<number, ChildRow>(
        level < depth
          ? [
              [
                101 + level,
                {
                  ...batchChild(101 + level, 100 + level, 101 + level, 0),
                  group: 101 + level,
                },
              ],
            ]
          : [],
      ),
  )
  const steps = createConnectedBatchPrefix(depth)

  for (const input of inputs) {
    if (input.level === 0) {
      const changes = input.changes.map((change): SyncChange<RootRow> => {
        const current = roots.get(change.id)
        if (change.type === `delete` && current) {
          roots.delete(change.id)
          return { type: `delete`, value: current }
        }

        const value: RootRow = {
          id: change.id,
          group: current ? current.group : change.group,
          value: change.value,
          position: change.position,
        }
        roots.set(value.id, value)
        return { type: current ? `update` : `insert`, value }
      })
      steps.push({ level: 0, changes })
      continue
    }

    const model = levels[input.level - 1]!
    const changes = input.changes.map((change): SyncChange<ChildRow> => {
      const current = model.get(change.id)
      if (change.type === `delete` && current) {
        model.delete(change.id)
        return { type: `delete`, value: current }
      }

      const value: ChildRow = {
        id: change.id,
        parentGroup: current ? current.parentGroup : change.parentGroup,
        group: current ? current.group : change.group,
        value: change.value,
        position: change.position,
      }
      model.set(value.id, value)
      return { type: current ? `update` : `insert`, value }
    })
    steps.push({ level: input.level, changes })
  }

  return { depth, steps }
}

function fullRowBatchScenarioAtDepthArbitrary(
  depth: IncludeDepth,
): fc.Arbitrary<FullRowBatchScenario> {
  return fc
    .array(fullRowBatchInputArbitrary(depth, `all`), {
      minLength: 1,
      maxLength: 10,
    })
    .map((inputs) => {
      const noise = normalizeFullRowBatchInputs(depth, inputs).steps.slice(
        depth + 1,
      )
      const changes: Array<SyncChange<ChildRow>> = [100, 200].map((rootId) => ({
        type: `update`,
        value: {
          ...batchChild(
            rootId + depth,
            rootId + depth - 1,
            rootId + depth + 1,
            0,
          ),
          group: rootId + depth,
        },
      }))

      return {
        depth,
        steps: [
          ...createConnectedBatchBranches(depth),
          ...noise,
          { level: depth, changes },
        ],
      }
    })
}

async function expectFullRowBatchScenarioMatches({
  depth,
  steps,
}: FullRowBatchScenario): Promise<void> {
  await runTrace({
    steps,
    driver: createFullRowBatchTraceDriver(depth),
    projection: structuralProjection,
  })
}

async function expectHistoryScenarioPairMatches({
  control,
  greenVariants = [],
  candidate,
}: HistoryScenarioPair): Promise<void> {
  await expectFullRowBatchScenarioMatches(control)
  for (const greenVariant of greenVariants) {
    await expectFullRowBatchScenarioMatches(greenVariant)
  }
  await expectFullRowBatchScenarioMatches(candidate)
}

type FlatMaterialization = `array` | `concat`

function createFlatMaterializationQuery(
  materialization: FlatMaterialization,
  sources: Sources,
) {
  if (materialization === `array`) {
    return createLiveQueryCollection((q) =>
      q
        .from({ root: sources.roots.collection })
        .orderBy(({ root }) => root.position)
        .orderBy(({ root }) => root.id)
        .select(({ root }) => ({
          id: root.id,
          group: root.group,
          children: materialize(
            q
              .from({ child: sources.levels[0].collection })
              .where(({ child }) => eq(child.parentGroup, root.group))
              .orderBy(({ child }) => child.position)
              .orderBy(({ child }) => child.id)
              .select(({ child }) => ({ id: child.id, value: child.value })),
          ),
        })),
    )
  }

  return createLiveQueryCollection((q) =>
    q
      .from({ root: sources.roots.collection })
      .orderBy(({ root }) => root.position)
      .orderBy(({ root }) => root.id)
      .select(({ root }) => ({
        id: root.id,
        group: root.group,
        content: concat(
          toArray(
            q
              .from({ child: sources.levels[0].collection })
              .where(({ child }) => eq(child.parentGroup, root.group))
              .orderBy(({ child }) => child.position)
              .orderBy(({ child }) => child.id)
              .select(({ child }) => child.value),
          ),
        ),
      })),
  )
}

type FlatMaterializationContext = Omit<
  StructuralTraceContext,
  `incremental`
> & {
  incremental: ReturnType<typeof createFlatMaterializationQuery>
}

function createFlatMaterializationDriver(
  materialization: FlatMaterialization,
): TraceDriver<FullRowBatchStep, FlatMaterializationContext> {
  return {
    setup: () => {
      const sources = createSources(`full`)
      return {
        depth: 1,
        sources,
        incremental: createFlatMaterializationQuery(materialization, sources),
        roots: new Map<number, RootRow>(),
        levels: Array.from({ length: 4 }, () => new Map<number, ChildRow>()),
        pendingWork: new Set(),
      }
    },
    start: ({ incremental }) => incremental.preload(),
    apply: (step, { sources, roots, levels }) => {
      if (step.level === 0) {
        sources.roots.writeBatch(step.changes)
        updateModel(roots, step.changes)
        return
      }

      if (step.level !== 1) {
        throw new Error(`Flat materialization only supports depth 1`)
      }
      sources.levels[0].writeBatch(step.changes)
      updateModel(levels[0]!, step.changes)
    },
    cleanup: cleanupStructuralTrace,
  }
}

type FlatMaterializationResult = Array<
  | {
      id: number
      group: number
      children: Array<{ id: number; value: number }>
    }
  | { id: number; group: number; content: string }
>

function recomputeFlatMaterialization(
  materialization: FlatMaterialization,
  roots: Map<number, RootRow>,
  children: Map<number, ChildRow>,
): FlatMaterializationResult {
  return [...roots.values()].sort(compareRows).map((root) => {
    const matching = [...children.values()]
      .filter((child) => child.parentGroup === root.group)
      .sort(compareRows)
    return materialization === `array`
      ? {
          id: root.id,
          group: root.group,
          children: matching.map(({ id, value }) => ({ id, value })),
        }
      : {
          id: root.id,
          group: root.group,
          content: matching.map(({ value }) => String(value)).join(``),
        }
  })
}

function flatMaterializationProjection(
  materialization: FlatMaterialization,
): TraceProjection<
  FlatMaterializationContext,
  unknown,
  FlatMaterializationResult
> {
  return {
    observe: ({ incremental }) => stripVirtualProperties(incremental.toArray),
    recompute: ({ roots, levels }) =>
      recomputeFlatMaterialization(materialization, roots, levels[0]!),
    assertEqual: (observed, expected) => {
      oracleAssertion('includes oracle.property comparison 2819', () =>
        expect(observed).toEqual(expected),
      )
      return undefined
    },
  }
}

const flatMaterializationScenarioArbitrary = fc
  .array(fullRowBatchInputArbitrary(1, `all`), {
    minLength: 1,
    maxLength: 12,
  })
  .map((inputs) => normalizeFullRowBatchInputs(1, inputs))

async function expectFlatMaterializationScenarioMatches(
  materialization: FlatMaterialization,
  scenario: FullRowBatchScenario,
): Promise<void> {
  await runTrace({
    steps: scenario.steps,
    driver: createFlatMaterializationDriver(materialization),
    projection: flatMaterializationProjection(materialization),
  })
}

const structuralProjection: TraceProjection<
  StructuralTraceContext,
  unknown,
  Array<OracleNode>
> = {
  observe: ({ incremental }) => stripVirtualProperties(incremental.toArray),
  recompute: ({ roots, levels, depth }) => recompute(roots, levels, depth),
  assertEqual: (observed, expected) => {
    oracleAssertion('includes oracle.property comparison 2851', () =>
      expect(observed).toEqual(expected),
    )
  },
}

async function expectScenarioMatches(scenario: Scenario): Promise<void> {
  await runTrace({
    steps: scenario.history,
    driver: createStructuralTraceDriver(scenario.depth),
    projection: structuralProjection,
  })
}

function createMaterializeSources() {
  return {
    roots: createControlledCollection<MaterializeRoot>(`materialize-roots`),
    middles:
      createControlledCollection<MaterializeMiddle>(`materialize-middles`),
    shared: createControlledCollection<MaterializeShared>(`materialize-shared`),
    leaves: createControlledCollection<MaterializeLeaf>(`materialize-leaves`),
  }
}

type MaterializeSources = ReturnType<typeof createMaterializeSources>

type MaterializeModels = {
  roots: Map<number, MaterializeRoot>
  middles: Map<number, MaterializeMiddle>
  shared: Map<number, MaterializeShared>
  leaves: Map<number, MaterializeLeaf>
}

type MaterializeTraceStep =
  | { type: `insert`; insert: MaterializeInsert }
  | { type: `incrementLeaf`; id: number }
  | { type: `redirectMiddle`; id: number; sharedId: number }

type MaterializeTraceContext = {
  sharedIntermediate: boolean
  sources: MaterializeSources
  live: ReturnType<typeof createMaterializeQuery>
  models: MaterializeModels
}

function createMaterializeQuery(sources: MaterializeSources) {
  return createLiveQueryCollection((q) =>
    q
      .from({ root: sources.roots.collection })
      .orderBy(({ root }) => root.id)
      .select(({ root }) => ({
        id: root.id,
        middle: materialize(
          q
            .from({ middle: sources.middles.collection })
            .where(({ middle }) => eq(middle.id, root.middleId))
            .select(({ middle }) => ({
              id: middle.id,
              sharedId: middle.sharedId,
              shared: materialize(
                q
                  .from({ shared: sources.shared.collection })
                  .where(({ shared }) => eq(shared.id, middle.sharedId))
                  .select(({ shared }) => ({
                    id: shared.id,
                    leafId: shared.leafId,
                    leaf: materialize(
                      q
                        .from({ leaf: sources.leaves.collection })
                        .where(({ leaf }) => eq(leaf.id, shared.leafId))
                        .select(({ leaf }) => ({
                          id: leaf.id,
                          value: leaf.value,
                        }))
                        .findOne(),
                    ),
                  }))
                  .findOne(),
              ),
            }))
            .findOne(),
        ),
      })),
  )
}

function recomputeMaterialize(
  roots: Map<number, MaterializeRoot>,
  middles: Map<number, MaterializeMiddle>,
  sharedRows: Map<number, MaterializeShared>,
  leaves: Map<number, MaterializeLeaf>,
): Array<MaterializeTree> {
  return [...roots.values()]
    .sort((left, right) => left.id - right.id)
    .map((root) => {
      const middle = middles.get(root.middleId)
      if (!middle) return { id: root.id, middle: undefined }

      const shared = sharedRows.get(middle.sharedId)
      return {
        id: root.id,
        middle: {
          id: middle.id,
          sharedId: middle.sharedId,
          shared: shared
            ? {
                id: shared.id,
                leafId: shared.leafId,
                leaf: leaves.get(shared.leafId),
              }
            : undefined,
        },
      }
    })
}

function insertMaterializeRow(
  insert: MaterializeInsert,
  sharedIntermediate: boolean,
  sources: MaterializeSources,
  models: MaterializeModels,
): void {
  switch (insert) {
    case `root-1`:
    case `root-2`: {
      const row = { id: insert === `root-1` ? 1 : 2, middleId: 1 }
      if (insert === `root-2`) row.middleId = 2
      sources.roots.write(`insert`, row)
      models.roots.set(row.id, row)
      return
    }
    case `middle-1`:
    case `middle-2`: {
      const id = insert === `middle-1` ? 1 : 2
      const row = { id, sharedId: sharedIntermediate ? 1 : id }
      sources.middles.write(`insert`, row)
      models.middles.set(row.id, row)
      return
    }
    case `shared-1`:
    case `shared-2`: {
      const id = insert === `shared-1` ? 1 : 2
      const row = { id, leafId: id }
      sources.shared.write(`insert`, row)
      models.shared.set(row.id, row)
      return
    }
    case `leaf-1`:
    case `leaf-2`: {
      const id = insert === `leaf-1` ? 1 : 2
      const row = { id, value: id * 10 }
      sources.leaves.write(`insert`, row)
      models.leaves.set(row.id, row)
    }
  }
}

async function cleanupMaterializeSources(sources: MaterializeSources) {
  await Promise.all(
    Object.values(sources).map(({ collection }) => collection.cleanup()),
  )
}

function createMaterializeTraceSteps(
  insertOrder: Array<MaterializeInsert>,
): Array<MaterializeTraceStep> {
  const steps: Array<MaterializeTraceStep> = insertOrder.map((insert) => ({
    type: `insert`,
    insert,
  }))

  for (const insert of insertOrder) {
    if (insert === `leaf-1` || insert === `leaf-2`) {
      steps.push({ type: `incrementLeaf`, id: insert === `leaf-1` ? 1 : 2 })
    }
  }

  return steps
}

function createMaterializeTraceDriver(
  scenarioSharedIntermediate: boolean,
): TraceDriver<MaterializeTraceStep, MaterializeTraceContext> {
  return {
    setup: () => {
      const sources = createMaterializeSources()
      return {
        sharedIntermediate: scenarioSharedIntermediate,
        sources,
        live: createMaterializeQuery(sources),
        models: {
          roots: new Map<number, MaterializeRoot>(),
          middles: new Map<number, MaterializeMiddle>(),
          shared: new Map<number, MaterializeShared>(),
          leaves: new Map<number, MaterializeLeaf>(),
        },
      }
    },
    start: ({ live }) => live.preload(),
    apply: (step, { models, sources, sharedIntermediate }) => {
      if (step.type === `insert`) {
        insertMaterializeRow(step.insert, sharedIntermediate, sources, models)
        return
      }

      if (step.type === `redirectMiddle`) {
        const middle = models.middles.get(step.id)
        if (!middle) throw new Error(`Missing middle ${step.id} in trace model`)
        const updated = { ...middle, sharedId: step.sharedId }
        sources.middles.write(`update`, updated)
        models.middles.set(updated.id, updated)
        return
      }

      const leaf = models.leaves.get(step.id)
      if (!leaf) throw new Error(`Missing leaf ${step.id} in trace model`)
      const updated = { ...leaf, value: leaf.value + 1 }
      sources.leaves.write(`update`, updated)
      models.leaves.set(updated.id, updated)
    },
    cleanup: async ({ live, sources }) => {
      await live.cleanup()
      await cleanupMaterializeSources(sources)
    },
  }
}

const materializeProjection: TraceProjection<
  MaterializeTraceContext,
  unknown,
  Array<MaterializeTree>
> = {
  observe: ({ live }) => stripVirtualProperties(live.toArray),
  recompute: ({ models }) =>
    recomputeMaterialize(
      models.roots,
      models.middles,
      models.shared,
      models.leaves,
    ),
  assertEqual: (observed, expected) => {
    oracleAssertion('includes oracle.property comparison 3090', () =>
      expect(observed).toEqual(expected),
    )
  },
}

async function expectMaterializeScenarioMatches({
  sharedIntermediate,
  insertOrder,
}: MaterializeScenario): Promise<void> {
  await runTrace({
    steps: createMaterializeTraceSteps(insertOrder),
    driver: createMaterializeTraceDriver(sharedIntermediate),
    projection: materializeProjection,
  })
}

const intraBatchChildHandOffScenario: FullRowBatchScenario = {
  depth: 1,
  steps: [
    {
      level: 0,
      changes: [
        { type: `insert`, value: batchRoot(0, 1, 0, 0) },
        { type: `insert`, value: batchRoot(1, 3, 0, 0) },
      ],
    },
    {
      level: 1,
      changes: [
        { type: `insert`, value: batchChild(5, 3, 0, 0) },
        { type: `insert`, value: batchChild(1, 1, 0, 0) },
      ],
    },
    {
      level: 1,
      changes: [
        { type: `update`, value: batchChild(1, 0, 0, 0) },
        { type: `update`, value: batchChild(5, 1, 0, 0) },
      ],
    },
  ],
}

function createReparentedSubtreeUpdateScenario(
  depth: 3 | 4,
  targetLevel: 1 | 2,
): VisibleRelationshipScenario {
  return createVisibleRelationshipScenario({
    depth,
    transition: `reparent`,
    targetLevel,
    sourceBranch: 0,
    branches: [
      { idBase: 100, groupBase: 600 },
      { idBase: 1_100, groupBase: 1_600 },
    ],
    noise: [targetLevel + 1, targetLevel + 2].map((level) => ({
      side: `after`,
      level: level as IncludeDepth,
      branch: 0,
      value: 1,
      position: 0,
    })),
  })
}

const minimalRekeyScenario = createVisibleRelationshipScenario({
  depth: 3,
  transition: `rekey`,
  targetLevel: 1,
  sourceBranch: 0,
  branches: [
    { idBase: 100, groupBase: 600 },
    { idBase: 1_100, groupBase: 1_600 },
  ],
  rekeyGroup: 2_100,
  noise: [],
})

const {
  control: rekeyRouteReuseControl,
  candidate: rekeyRouteResurrectionScenario,
} = createRekeyRouteReuseScenarios({
  depth: 2,
  sourceBranch: 0,
  branches: transitionHistoryBranches,
  rekeyGroup: 2_100,
  insertedId: 3_000,
  insertedValue: 0,
  insertedPosition: 0,
})

const {
  control: childReplacementControl,
  candidate: movedSubtreeChildReplacementScenario,
} = createMovedChildReplacementScenarios({
  depth: 3,
  targetLevel: 1,
  sourceBranch: 0,
  branches: transitionHistoryBranches,
  insertedId: 3_000,
  insertedValue: 0,
  insertedPosition: 0,
})

const optimisticCutsLaw = `An optimistic rollback publishes checkpoints only when it is delivered and changes a route; a rollback of an absent row or a no-op publishes none, and every settled cut restores the synced rows.`
const applyCheckpointsLaw = `The structural trace driver checks every ordinary root and child change at one synchronous checkpoint before apply yields.`
const omittedChildLaw = `After each source change, the live include rows equal the recomputed relationship tree at that public checkpoint.`
const failedOptimisticCleanupLaw = `A failed optimistic checkpoint fails its transaction, leaves no pending work, and cleans up every Collection, keeping the checkpoint failure and suppressing a later cleanup failure.`
const composedTransitionLaw = `Composed rekey and reparent transitions with two descendant levels match recomputation at every visible step.`
const materializeReferenceUpdateLaw = `Nested scalar materialization follows a reference update to the redirected shared row.`
const incrementalLaw = `The live include rows equal a naive recomputation after every incremental change.`
const fullRowBatchLaw = `Visible multi-row source batches publish the recomputed relationship tree at every checkpoint.`
const historyPairLaw = `A shared-route lifecycle history and its controls each publish the recomputed relationship tree at every checkpoint.`
const flatMaterializationLaw = `Flat array and concat materializations follow an intra-batch child hand-off.`
const materializeLaw = `Nested scalar materialization publishes the recomputed deepest row.`

const composedTransitionCells = (
  [
    [3, 1],
    [4, 2],
  ] as const
).flatMap(([depth, targetLevel]) =>
  ([0, 1] as const).flatMap((sourceBranch) =>
    (
      [
        [`rekey`, `rekey`],
        [`rekey`, `reparent`],
        [`reparent`, `rekey`],
      ] as const
    ).map(([firstTransition, secondTransition]) => ({
      depth,
      targetLevel,
      sourceBranch,
      firstTransition,
      secondTransition,
    })),
  ),
)

// The former fixed-history body, unchanged.
async function judgeOptimisticCuts(): Promise<void> {
  const driver = createStructuralTraceDriver(1)
  const row = { id: 1, parentGroup: 1, group: 1, value: 1, position: 0 }
  const history: Array<HistoryAction> = [
    { ...row, type: `put`, level: 0 },
    { ...row, type: `put`, level: 1 },
    { ...row, type: `optimisticRollback`, level: 0, id: 999 },
    { ...row, type: `optimisticRollback`, level: 0 },
    { ...row, type: `optimisticRollback`, level: 0, group: 2 },
    { ...row, type: `optimisticRollback`, level: 0 },
  ]
  expect(classifyScenarioSyntax({ depth: 1, history })).toEqual([
    `depth=1`,
    `syntactic-route-changes=many`,
    `has-optimistic-syntax=true`,
    `has-delete-syntax=false`,
  ])
  const observations: Array<{
    cuts: Array<{ group: number | undefined; childIds: Array<number> }>
    settledGroup: number | undefined
    settledChildIds: Array<number>
    absentRoot: boolean
  }> = []
  await runTrace({
    steps: history,
    driver: {
      ...driver,
      apply: async (action, context, checkpoint) => {
        const observe = () => ({
          group: context.sources.roots.collection.get(1)?.group,
          childIds:
            [...context.incremental.values()][0]?.children.map(
              (child) => child.id,
            ) ?? [],
        })
        const cuts: Array<ReturnType<typeof observe>> = []
        await driver.apply(action, context, () => {
          checkpoint()
          cuts.push(observe())
        })
        const settled = observe()
        observations.push({
          cuts,
          settledGroup: settled.group,
          settledChildIds: settled.childIds,
          absentRoot: !context.sources.roots.collection.has(999),
        })
      },
    },
    projection: structuralProjection,
  })
  const restored = {
    settledGroup: 1,
    settledChildIds: [1],
    absentRoot: true,
  }
  expect(observations.slice(2)).toEqual([
    { ...restored, cuts: [] },
    { ...restored, cuts: [] },
    {
      ...restored,
      cuts: [
        { group: 2, childIds: [] },
        { group: 1, childIds: [1] },
      ],
    },
    { ...restored, cuts: [] },
  ])
}

// The former fixed-history body, unchanged.
async function judgeApplyCheckpoints(): Promise<void> {
  const driver = createStructuralTraceDriver(1)
  const row = { id: 1, parentGroup: 1, group: 1, value: 1, position: 0 }
  const history: Array<HistoryAction> = [
    { ...row, type: `put`, level: 0 },
    { ...row, type: `put`, level: 1 },
    { ...row, type: `delete`, level: 1 },
    { ...row, type: `delete`, level: 0 },
  ]
  const beforeAwait: Array<number> = []
  await runTrace({
    steps: history,
    driver: {
      ...driver,
      apply: (action, context, checkpoint) => {
        let checkpoints = 0
        const result = driver.apply(action, context, () => {
          checkpoints++
          return checkpoint()
        })
        beforeAwait.push(checkpoints)
        return result
      },
    },
    projection: structuralProjection,
  })
  expect(beforeAwait).toEqual([1, 1, 1, 1])
}

// The history that the omitted-child calibration corrupts.
const omittedChildRow = {
  id: 1,
  parentGroup: 1,
  group: 1,
  value: 1,
  position: 0,
}
const omittedChildHistories = [
  {
    row: omittedChildRow,
    steps: [
      { ...omittedChildRow, type: `put`, level: 0 },
      { ...omittedChildRow, type: `put`, level: 1 },
    ] as Array<HistoryAction>,
  },
]

// The former case body, unchanged, for one level and cleanup-failure cell.
async function judgeFailedOptimisticCleanup(
  level: 0 | 1,
  cleanupFails: boolean,
): Promise<void> {
  const driver = createStructuralTraceDriver(1)
  const failure = new Error(`Core checkpoint failed`)
  const cleanupFailure = new Error(`Core live cleanup failed after disposal`)
  let context: StructuralTraceContext | undefined
  let transaction: PendingTransaction | undefined
  const put = (target: 0 | 1): HistoryAction => ({
    type: `put`,
    level: target,
    id: 1,
    parentGroup: 1,
    group: 1,
    value: 1,
    position: 0,
  })
  await expect(
    runTrace({
      steps: [
        put(0),
        put(1),
        { ...put(level), type: `optimisticConfirm`, value: 2 },
      ],
      driver: {
        ...driver,
        setup: () => {
          const current = createStructuralTraceContext(1)
          context = current
          if (cleanupFails) {
            const cleanup = current.incremental.cleanup.bind(
              current.incremental,
            )
            current.incremental.cleanup = async () => {
              await cleanup()
              throw cleanupFailure
            }
          }
          return current
        },
      },
      projection: {
        ...structuralProjection,
        assertEqual: (actual, expected) => {
          structuralProjection.assertEqual(actual, expected)
          const entry = [...context!.pendingWork][0]
          if (entry) {
            transaction = entry.transaction
            throw failure
          }
        },
      },
    }),
  ).rejects.toBe(failure)
  expect(
    (failure as Error & { suppressed?: Array<unknown> }).suppressed,
  ).toEqual(cleanupFails ? [cleanupFailure] : undefined)
  if (!context) throw new Error(`Expected core trace context`)
  expect(transaction?.state).toBe(`failed`)
  expect(context.pendingWork.size).toBe(0)
  for (const collection of [
    context.incremental,
    context.sources.roots.collection,
    ...context.sources.levels.map((source) => source.collection),
  ])
    expect(collection.status).toBe(`cleaned-up`)
}

// The former fixed history's scenario, built unchanged; the shared full-row
// batch check replays it.
function createRootEnteringLiveRouteScenario(): FullRowBatchScenario {
  const branches = transitionHistoryBranches
  const prefix = createConnectedBatchBranches(1, branches)
  const childStep = prefix.find((step) => step.level === 1)
  if (!childStep || childStep.level !== 1) throw new Error(`Missing children`)
  const scenario: FullRowBatchScenario = {
    depth: 1,
    steps: [
      prefix[0]!,
      {
        level: 1,
        changes: [
          ...childStep.changes,
          {
            type: `insert`,
            value: {
              ...batchChild(3_000, branches[0].groupBase, 3_000, -1),
              group: 2_500,
            },
          },
        ],
      },
      {
        level: 0,
        changes: [
          {
            type: `update`,
            value: batchRoot(
              branches[1].idBase,
              branches[0].groupBase,
              branches[1].idBase,
              0,
            ),
          },
        ],
      },
    ],
  }
  return scenario
}

// The former case body, unchanged, for one composed-transition cell.
async function judgeComposedTransition({
  depth,
  targetLevel,
  sourceBranch,
  firstTransition,
  secondTransition,
}: (typeof composedTransitionCells)[number]): Promise<void> {
  const childLevel = (targetLevel + 1) as IncludeDepth
  const scenario = createTransitionHistoryScenario({
    depth,
    targetLevel,
    firstTransition,
    secondTransition,
    sourceBranch,
    branches: transitionHistoryBranches,
    rekeyGroups: [2_100, 2_400],
    insertedLevels: [childLevel, childLevel],
    insertedValues: [31, 47],
    insertedPositions: [1, -1],
  })
  expectEveryHistoryStepVisible(scenario)
  await expectFullRowBatchScenarioMatches(scenario)
}

const materializeReferenceUpdateHistories = [
  {
    name: `nested scalar materialization follows a reference update`,
    steps: [
      { type: `insert`, insert: `root-1` },
      { type: `insert`, insert: `middle-1` },
      { type: `insert`, insert: `shared-1` },
      { type: `insert`, insert: `leaf-1` },
      { type: `redirectMiddle`, id: 1, sharedId: 2 },
    ] as Array<MaterializeTraceStep>,
  },
]

// Named regressions of the incremental-history grammar, replayed through its
// shared recomputation check.
const incrementalFixedHistories: Array<{ name: string; scenario: Scenario }> = [
  {
    name: `supports repeated optimistic rollbacks in one history`,
    scenario: {
      depth: 1,
      history: [
        {
          type: `put`,
          level: 0,
          id: 0,
          parentGroup: 0,
          group: 0,
          value: 0,
          position: 0,
        },
        {
          type: `put`,
          level: 1,
          id: 0,
          parentGroup: 0,
          group: 0,
          value: 0,
          position: 0,
        },
        {
          type: `optimisticRollback`,
          level: 1,
          id: 0,
          parentGroup: 0,
          group: 0,
          value: 1,
          position: 0,
        },
        {
          type: `optimisticRollback`,
          level: 1,
          id: 0,
          parentGroup: 0,
          group: 0,
          value: 2,
          position: 0,
        },
      ],
    },
  },
  {
    name: `confirmed child reorder matches recomputation`,
    scenario: confirmedChildReorderSeed,
  },
]

// Named full-row batch histories, replayed through the shared full-row batch
// check.
const fullRowFixedHistories: Array<{
  name: string
  scenario: FullRowBatchScenario
}> = [
  {
    name: `a root entering a live route receives its ordered snapshot`,
    scenario: createRootEnteringLiveRouteScenario(),
  },
  ...([0, 1, 2] as const).map((parentLevel) => ({
    name: `matches recomputation when the last level-${parentLevel} shared-route subscriber leaves`,
    scenario: createSharedRouteLastSubscriberScenario(parentLevel),
  })),
  ...(
    [
      [3, 1],
      [4, 1],
      [4, 2],
    ] as const
  ).map(([depth, targetLevel]) => ({
    name: `later updates propagate through a reparented subtree at depth ${depth}, level ${targetLevel}`,
    scenario: createReparentedSubtreeUpdateScenario(depth, targetLevel),
  })),
  {
    name: `rekeying a row detaches two descendant levels`,
    scenario: minimalRekeyScenario,
  },
  {
    name: `reusing a rekeyed row's old route does not resurrect its child`,
    scenario: rekeyRouteResurrectionScenario,
  },
  {
    name: `matches recomputation when sharing a route without rekeying its existing row`,
    scenario: rekeyRouteReuseControl,
  },
  {
    name: `replacing a moved subtree child retains its grandchild`,
    scenario: movedSubtreeChildReplacementScenario,
  },
  {
    name: `matches recomputation when replacing a child without reparenting its ancestor`,
    scenario: childReplacementControl,
  },
  {
    name: `matches recomputation for full-row sync batches`,
    scenario: { depth: 1, steps: fullRowBatchTrace },
  },
  {
    name: `a reinserted parent drops its old shared route`,
    scenario: fullRowSharedRoutingSeed,
  },
]

// Named shared-route lifecycle pairs, replayed through the shared pair check.
const historyPairFixedHistories: Array<{
  name: string
  pair: HistoryScenarioPair
}> = [
  ...([0, 1, 2] as const).flatMap((parentLevel) => [
    ...([0, 1] as const).map((enteringRow) => ({
      name: `matches recomputation when level-${parentLevel} row ${enteringRow} enters a live shared route`,
      pair: createMergeIntoSharedRouteScenarios(parentLevel, enteringRow),
    })),
    {
      name: `matches recomputation after a level-${parentLevel} route resubscribes`,
      pair: createSnapshotOnResubscribeScenarios(parentLevel),
    },
    {
      name: `matches recomputation when an initially shared level-${parentLevel} route retires, changes, and resubscribes`,
      pair: createInitiallySharedRouteResubscribeScenario(parentLevel),
    },
  ]),
  ...([0, 1] as const).map((parentLevel) => ({
    name: `a departed level-${parentLevel} shared-route subscriber ignores later child updates`,
    pair: createSharedRouteLifetimeScenarios(parentLevel),
  })),
]

describe(`includes recompute oracle`, () => {
  oracleProperty({
    id: `includes.optimistic-cuts`,
    law: {
      statement: optimisticCutsLaw,
      authority: `The state-equivalence, route-lifecycle, transition-history, and batch-partition laws (normative laws 2–5 and 8) in packages/db/src/query/live/ARCHITECTURE.md, stated at the start of this owner.`,
      limits: `One fixed depth-1 history of optimistic rollbacks.`,
    },
    owns: [
      `src/collection/change-events.ts#createFilterFunctionFromExpression`,
      `src/collection/index.ts#createCollection`,
      `src/query/equality-value-identity.ts#createValueIdentity`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
      `src/query/live/public-key-reduction.ts#routeKey`,
      `src/query/query-once.ts#queryOnce`,
    ],
    histories: [
      `distinguishes optimistic syntax from delivered rollback and no-op cuts`,
    ],
    label: (name) => name,
    resolve: (name) => ({ name }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(optimisticCutsLaw, plan, observe, () =>
        judgeOptimisticCuts(),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `includes.apply-checkpoints`,
    law: {
      statement: applyCheckpointsLaw,
      authority: `The state-equivalence, route-lifecycle, transition-history, and batch-partition laws (normative laws 2–5 and 8) in packages/db/src/query/live/ARCHITECTURE.md, stated at the start of this owner.`,
      limits: `One fixed depth-1 put and delete history.`,
    },
    owns: [
      `src/collection/change-events.ts#createFilterFunctionFromExpression`,
      `src/collection/index.ts#createCollection`,
      `src/query/equality-value-identity.ts#createValueIdentity`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
      `src/query/live/public-key-reduction.ts#routeKey`,
      `src/query/query-once.ts#queryOnce`,
    ],
    histories: [
      `checks ordinary root and child changes before yielding from apply`,
    ],
    label: (name) => name,
    resolve: (name) => ({ name }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(applyCheckpointsLaw, plan, observe, () =>
        judgeApplyCheckpoints(),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `includes.omitted-child`,
    law: {
      statement: omittedChildLaw,
      authority: `The state-equivalence, route-lifecycle, transition-history, and batch-partition laws (normative laws 2–5 and 8) in packages/db/src/query/live/ARCHITECTURE.md, stated at the start of this owner.`,
      limits: `One fixed depth-1 root and child put history, replayed through the structural driver and recomputation, and its omitted-child calibration.`,
    },
    owns: [
      `src/collection/change-events.ts#createFilterFunctionFromExpression`,
      `src/collection/index.ts#createCollection`,
      `src/query/equality-value-identity.ts#createValueIdentity`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
      `src/query/live/public-key-reduction.ts#routeKey`,
      `src/query/query-once.ts#queryOnce`,
    ],
    histories: omittedChildHistories,
    label: () => `matches recomputation after a root and its child are put`,
    resolve: (history) => ({ ...history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(omittedChildLaw, plan, observe, () =>
        runTrace({
          steps: plan.steps,
          driver: createStructuralTraceDriver(1),
          projection: structuralProjection,
        }),
      ),
    check: forwardAssertionJudgment,
    calibrations: [
      {
        name: `rejects an omitted child at its first public checkpoint`,
        law: omittedChildLaw,
        // The former calibration body. After verifying the real query result,
        // the projection injects one plausible wrong public result. Exactly the
        // old matcher: only a failure at checkpoint 3 counts as the check
        // rejecting it. The shared structural check marks its own comparison
        // failures, so any other failure is rethrown without that marking and
        // fails this calibration, as it failed the old test.
        driver: (plan, observe) =>
          recordAssertionJudgment(omittedChildLaw, plan, observe, async () => {
            const row = plan.row
            try {
              await runTrace({
                steps: plan.steps,
                driver: createStructuralTraceDriver(1),
                projection: {
                  ...structuralProjection,
                  observe: (context) => {
                    const actual = structuralProjection.observe(context)
                    if (!context.levels[0]!.has(row.id)) return actual
                    structuralProjection.assertEqual(
                      actual,
                      structuralProjection.recompute(context),
                    )
                    return [
                      { id: 1, group: 1, value: 1, position: 0, children: [] },
                    ]
                  },
                },
              })
            } catch (error) {
              if (
                error instanceof Error &&
                (error as Error & { checkpoint?: unknown }).checkpoint === 3
              )
                rejectAt(`omitted child calibration`, error)
              throw new Error(
                `the omitted-child corruption failed outside the expected rejection: ${String(error)}`,
              )
            }
          }),
      },
    ],
  })

  oracleProperty({
    id: `includes.failed-optimistic-cleanup`,
    law: {
      statement: failedOptimisticCleanupLaw,
      authority: `The state-equivalence, route-lifecycle, transition-history, and batch-partition laws (normative laws 2–5 and 8) in packages/db/src/query/live/ARCHITECTURE.md, stated at the start of this owner.`,
      limits: `The four enumerated level and cleanup-failure cells over one depth-1 history.`,
    },
    owns: [
      `src/collection/change-events.ts#createFilterFunctionFromExpression`,
      `src/collection/index.ts#createCollection`,
      `src/query/equality-value-identity.ts#createValueIdentity`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
      `src/query/live/public-key-reduction.ts#routeKey`,
      `src/query/query-once.ts#queryOnce`,
    ],
    histories: ([0, 1] as const).flatMap((level) =>
      [false, true].map((cleanupFails) => ({ level, cleanupFails })),
    ),
    label: ({ level, cleanupFails }) =>
      `cleans failed optimistic checkpoint at level ${level} with cleanup failure=${cleanupFails}`,
    resolve: (cell) => ({ ...cell }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(failedOptimisticCleanupLaw, plan, observe, () =>
        judgeFailedOptimisticCleanup(plan.level, plan.cleanupFails),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `includes.composed-transitions`,
    law: {
      statement: composedTransitionLaw,
      authority: `The state-equivalence, route-lifecycle, transition-history, and batch-partition laws (normative laws 2–5 and 8) in packages/db/src/query/live/ARCHITECTURE.md, stated at the start of this owner.`,
      limits: `The twelve enumerated depth, level, source-branch, and transition-pair cells with two descendant levels.`,
    },
    owns: [
      `src/collection/change-events.ts#createFilterFunctionFromExpression`,
      `src/collection/index.ts#createCollection`,
      `src/query/equality-value-identity.ts#createValueIdentity`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
      `src/query/live/public-key-reduction.ts#routeKey`,
      `src/query/query-once.ts#queryOnce`,
    ],
    histories: composedTransitionCells,
    label: ({ depth, sourceBranch, firstTransition, secondTransition }) =>
      `matches composed ${firstTransition} → ${secondTransition} with two descendant levels at depth ${depth}, branch ${sourceBranch}`,
    resolve: (cell) => ({ ...cell }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(composedTransitionLaw, plan, observe, () =>
        judgeComposedTransition(plan),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `includes.materialize-reference-update`,
    law: {
      statement: materializeReferenceUpdateLaw,
      authority: `The state-equivalence, route-lifecycle, transition-history, and batch-partition laws (normative laws 2–5 and 8) in packages/db/src/query/live/ARCHITECTURE.md, stated at the start of this owner.`,
      limits: `One fixed insert-and-redirect history over distinct intermediates.`,
    },
    owns: [
      `src/collection/change-events.ts#createFilterFunctionFromExpression`,
      `src/collection/index.ts#createCollection`,
      `src/query/equality-value-identity.ts#createValueIdentity`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
      `src/query/live/public-key-reduction.ts#routeKey`,
      `src/query/query-once.ts#queryOnce`,
    ],
    histories: materializeReferenceUpdateHistories,
    label: ({ name }) => name,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(
        materializeReferenceUpdateLaw,
        plan,
        observe,
        () =>
          runTrace({
            steps: plan.history.steps,
            driver: createMaterializeTraceDriver(false),
            projection: materializeProjection,
          }),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `includes.full-row-fixed`,
    law: {
      statement: fullRowBatchLaw,
      authority: `The state-equivalence, route-lifecycle, transition-history, and batch-partition laws (normative laws 2–5 and 8) in packages/db/src/query/live/ARCHITECTURE.md, stated at the start of this owner.`,
      limits: `Named full-row batch histories that the generated matrices do not take back, replayed through the shared full-row batch check.`,
    },
    owns: [
      `src/collection/change-events.ts#createFilterFunctionFromExpression`,
      `src/collection/index.ts#createCollection`,
      `src/query/equality-value-identity.ts#createValueIdentity`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
      `src/query/live/public-key-reduction.ts#routeKey`,
      `src/query/query-once.ts#queryOnce`,
    ],
    histories: fullRowFixedHistories,
    label: ({ name }) => name,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(fullRowBatchLaw, plan, observe, () =>
        expectFullRowBatchScenarioMatches(plan.history.scenario),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `includes.history-pair-fixed`,
    law: {
      statement: historyPairLaw,
      authority: `The state-equivalence, route-lifecycle, transition-history, and batch-partition laws (normative laws 2–5 and 8) in packages/db/src/query/live/ARCHITECTURE.md, stated at the start of this owner.`,
      limits: `Named shared-route merge, resubscribe, retirement, and departure pairs, replayed through the shared pair check.`,
    },
    owns: [
      `src/collection/change-events.ts#createFilterFunctionFromExpression`,
      `src/collection/index.ts#createCollection`,
      `src/query/equality-value-identity.ts#createValueIdentity`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
      `src/query/live/public-key-reduction.ts#routeKey`,
      `src/query/query-once.ts#queryOnce`,
    ],
    histories: historyPairFixedHistories,
    label: ({ name }) => name,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(historyPairLaw, plan, observe, () =>
        expectHistoryScenarioPairMatches(plan.history.pair),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `includes.flat-materialization-cases`,
    law: {
      statement: flatMaterializationLaw,
      authority: `The state-equivalence, route-lifecycle, transition-history, and batch-partition laws (normative laws 2–5 and 8) in packages/db/src/query/live/ARCHITECTURE.md, stated at the start of this owner.`,
      limits: `The two enumerated flat materializations over one intra-batch hand-off scenario.`,
    },
    owns: [
      `src/collection/change-events.ts#createFilterFunctionFromExpression`,
      `src/collection/index.ts#createCollection`,
      `src/query/equality-value-identity.ts#createValueIdentity`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
      `src/query/live/public-key-reduction.ts#routeKey`,
      `src/query/query-once.ts#queryOnce`,
    ],
    histories: [`array`, `concat`] as Array<FlatMaterialization>,
    label: (materialization) =>
      `${materialization} follows an intra-batch child hand-off`,
    resolve: (materialization) => ({ materialization }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(flatMaterializationLaw, plan, observe, () =>
        expectFlatMaterializationScenarioMatches(
          plan.materialization,
          intraBatchChildHandOffScenario,
        ),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `includes.incremental-fixed`,
    law: {
      statement: incrementalLaw,
      authority: `The state-equivalence, route-lifecycle, transition-history, and batch-partition laws (normative laws 2–5 and 8) in packages/db/src/query/live/ARCHITECTURE.md, stated at the start of this owner.`,
      limits: `Two named regressions of the incremental-history grammar.`,
    },
    owns: [
      `src/collection/change-events.ts#createFilterFunctionFromExpression`,
      `src/collection/index.ts#createCollection`,
      `src/query/equality-value-identity.ts#createValueIdentity`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
      `src/query/live/public-key-reduction.ts#routeKey`,
      `src/query/query-once.ts#queryOnce`,
    ],
    histories: incrementalFixedHistories,
    label: ({ name }) => name,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(incrementalLaw, plan, observe, () =>
        expectScenarioMatches(plan.history.scenario),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `includes.materialize-fixed`,
    law: {
      statement: materializeLaw,
      authority: `The state-equivalence, route-lifecycle, transition-history, and batch-partition laws (normative laws 2–5 and 8) in packages/db/src/query/live/ARCHITECTURE.md, stated at the start of this owner.`,
      limits: `The named shared-intermediate materialization seed.`,
    },
    owns: [
      `src/collection/change-events.ts#createFilterFunctionFromExpression`,
      `src/collection/index.ts#createCollection`,
      `src/query/equality-value-identity.ts#createValueIdentity`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
      `src/query/live/public-key-reduction.ts#routeKey`,
      `src/query/query-once.ts#queryOnce`,
    ],
    histories: [
      {
        name: `shared scalar materialization preserves the deepest row`,
        scenario: sharedMaterializeSeed,
      },
    ],
    label: ({ name }) => name,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(materializeLaw, plan, observe, () =>
        expectMaterializeScenarioMatches(plan.history.scenario),
      ),
    check: forwardAssertionJudgment,
  })

  for (const [shapeIndex, shape] of independentTransitionShapes.entries()) {
    const property = `includes.matrix.independent-${shape}`
    const arbitrary = independentTransitionScenarioArbitrary(shape)
    for (const { label, options } of generatedCampaigns(
      4,
      property,
      1734 + shapeIndex,
    )) {
      registerIncludesProperty(
        [arbitrary],
        {
          ...options,
          owns: [
            `src/collection/change-events.ts#createFilterFunctionFromExpression`,
            `src/collection/index.ts#createCollection`,
            `src/query/equality-value-identity.ts#createValueIdentity`,
            `src/query/live-query-collection.ts#createLiveQueryCollection`,
            `src/query/live/public-key-reduction.ts#routeKey`,
            `src/query/query-once.ts#queryOnce`,
          ],
        },
        `matches recomputation for independent ${shape} relationship targets [${property}, ${label}]`,
        async (scenario) => {
          expectEveryRouteTransitionVisible(scenario)
          await expectFullRowBatchScenarioMatches(scenario)
        },
      )
    }
  }

  for (const [historyIndex, history] of destinationHistories.entries()) {
    const property = `includes.matrix.destination-${history}`
    const arbitrary = destinationHistoryScenarioArbitrary(history)
    for (const { label, options } of generatedCampaigns(
      4,
      property,
      1740 + historyIndex,
    )) {
      registerIncludesProperty(
        [arbitrary],
        {
          ...options,
          owns: [
            `src/collection/change-events.ts#createFilterFunctionFromExpression`,
            `src/collection/index.ts#createCollection`,
            `src/query/equality-value-identity.ts#createValueIdentity`,
            `src/query/live-query-collection.ts#createLiveQueryCollection`,
            `src/query/live/public-key-reduction.ts#routeKey`,
            `src/query/query-once.ts#queryOnce`,
          ],
        },
        `matches recomputation for the ${history} route destination history [${property}, ${label}]`,
        async (scenario) => {
          expectEveryRouteTransitionVisible(scenario)
          await expectFullRowBatchScenarioMatches(scenario)
        },
      )
    }
  }

  for (const depth of [2, 3, 4] as const) {
    for (const sourceBranch of [0, 1] as const) {
      const retiredProperty = `includes.matrix.retired-route-${depth}-${sourceBranch}`
      const retiredArbitrary = rekeyRouteReuseScenarioArbitrary(
        depth,
        sourceBranch,
      )
      for (const { label, options } of generatedCampaigns(
        4,
        retiredProperty,
        1726 + depth * 10 + sourceBranch,
      )) {
        registerIncludesProperty(
          [retiredArbitrary],
          {
            ...options,
            owns: [
              `src/collection/change-events.ts#createFilterFunctionFromExpression`,
              `src/collection/index.ts#createCollection`,
              `src/query/equality-value-identity.ts#createValueIdentity`,
              `src/query/live-query-collection.ts#createLiveQueryCollection`,
              `src/query/live/public-key-reduction.ts#routeKey`,
              `src/query/query-once.ts#queryOnce`,
            ],
          },
          `reuses a retired route at depth ${depth}, branch ${sourceBranch} [${retiredProperty}, ${label}]`,
          (...args: Parameters<typeof expectHistoryScenarioPairMatches>) => {
            return expectHistoryScenarioPairMatches(...args)
          },
        )
      }

      const intraBatchProperty = `includes.matrix.intra-batch-route-${depth}-${sourceBranch}`
      const intraBatchArbitrary = rekeyRouteReuseScenarioArbitrary(
        depth,
        sourceBranch,
        createIntraBatchRekeyRouteReuseScenarios,
      )
      for (const { label, options } of generatedCampaigns(
        4,
        intraBatchProperty,
        1733 + depth * 10 + sourceBranch,
      )) {
        registerIncludesProperty(
          [intraBatchArbitrary],
          {
            ...options,
            owns: [
              `src/collection/change-events.ts#createFilterFunctionFromExpression`,
              `src/collection/index.ts#createCollection`,
              `src/query/equality-value-identity.ts#createValueIdentity`,
              `src/query/live-query-collection.ts#createLiveQueryCollection`,
              `src/query/live/public-key-reduction.ts#routeKey`,
              `src/query/query-once.ts#queryOnce`,
            ],
          },
          `handles intra-batch rekey then retired-route reuse at depth ${depth}, branch ${sourceBranch} [${intraBatchProperty}, ${label}]`,
          (...args: Parameters<typeof expectHistoryScenarioPairMatches>) => {
            return expectHistoryScenarioPairMatches(...args)
          },
        )
      }
    }
  }

  for (const depth of [3, 4] as const) {
    for (let targetLevel = 1; targetLevel <= depth - 2; targetLevel++) {
      for (const sourceBranch of [0, 1] as const) {
        const property = `includes.matrix.moved-child-${depth}-${targetLevel}-${sourceBranch}`
        const arbitrary = movedChildReplacementMirrorsArbitrary(
          depth,
          targetLevel as IncludeDepth,
          sourceBranch,
        )
        for (const { label, options } of generatedCampaigns(
          4,
          property,
          1727 + depth * 100 + targetLevel * 10 + sourceBranch,
        )) {
          registerIncludesProperty(
            [arbitrary],
            {
              ...options,
              owns: [
                `src/collection/change-events.ts#createFilterFunctionFromExpression`,
                `src/collection/index.ts#createCollection`,
                `src/query/equality-value-identity.ts#createValueIdentity`,
                `src/query/live-query-collection.ts#createLiveQueryCollection`,
                `src/query/live/public-key-reduction.ts#routeKey`,
                `src/query/query-once.ts#queryOnce`,
              ],
            },
            `matches forward/reverse delivery mirrors when replacing a moved child at depth ${depth}, level ${targetLevel}, source ${sourceBranch} [${property}, ${label}]`,
            async (scenarios) => {
              for (const deliveryOrder of branchDeliveryOrders) {
                await expectHistoryScenarioPairMatches(scenarios[deliveryOrder])
              }
            },
          )
        }
      }
    }
  }

  for (const [publicIdIndex, publicId] of (
    [`same`, `new`] as const
  ).entries()) {
    for (const [routeIndex, route] of (
      [`handoff`, `fresh`] as const
    ).entries()) {
      for (const [updateIndex, ancestorUpdate] of (
        [`route-only`, `route-and-position`] as const
      ).entries()) {
        const property = `includes.matrix.batch-${publicId}-${route}-${ancestorUpdate}`
        for (const { label, options } of generatedCampaigns(
          4,
          property,
          1738 + publicIdIndex * 100 + routeIndex * 10 + updateIndex,
        )) {
          registerIncludesProperty(
            [relationshipBatchFixtureArbitrary],
            {
              ...options,
              owns: [
                `src/collection/change-events.ts#createFilterFunctionFromExpression`,
                `src/collection/index.ts#createCollection`,
                `src/query/equality-value-identity.ts#createValueIdentity`,
                `src/query/live-query-collection.ts#createLiveQueryCollection`,
                `src/query/live/public-key-reduction.ts#routeKey`,
                `src/query/query-once.ts#queryOnce`,
              ],
            },
            `matches the split/atomic replacement matrix for ${publicId} public id, ${route} route, ${ancestorUpdate} [${property}, ${label}]`,
            async (fixture) => {
              const cells = createRelationshipBatchShapeMatrix(
                fixture,
                publicId,
                route,
                ancestorUpdate,
              )
              const finalStates = cells.map(({ scenarios: { candidate } }) =>
                recomputeFullRowBatchScenario(
                  candidate,
                  candidate.steps.length,
                ),
              )

              // Delivery boundaries and change order must not affect the final
              // recompute semantics for one generated fixture.
              oracleAssertion('includes oracle.property comparison 4109', () =>
                expect(finalStates.length).toBeGreaterThan(1),
              )
              for (const finalState of finalStates.slice(1)) {
                oracleAssertion(
                  'includes oracle.property comparison 4111',
                  () => expect(finalState).toEqual(finalStates[0]),
                )
              }

              for (const {
                scenarios: { control, candidate },
              } of cells) {
                await expectFullRowBatchScenarioMatches(control)
                await expectFullRowBatchScenarioMatches(candidate)
              }
            },
          )
        }
      }
    }
  }

  const flatMaterializationProperty = `includes.matrix.flat-materialization`
  const flatMaterializationArbitraries: [
    fc.Arbitrary<FlatMaterialization>,
    fc.Arbitrary<FullRowBatchScenario>,
  ] = [
    fc.constantFrom<FlatMaterialization>(`array`, `concat`),
    flatMaterializationScenarioArbitrary,
  ]
  for (const { label, options } of generatedCampaigns(
    30,
    flatMaterializationProperty,
    1721,
  )) {
    registerIncludesProperty(
      flatMaterializationArbitraries,
      {
        ...options,
        owns: [
          `src/collection/change-events.ts#createFilterFunctionFromExpression`,
          `src/collection/index.ts#createCollection`,
          `src/query/equality-value-identity.ts#createValueIdentity`,
          `src/query/live-query-collection.ts#createLiveQueryCollection`,
          `src/query/live/public-key-reduction.ts#routeKey`,
          `src/query/query-once.ts#queryOnce`,
        ],
      },
      `matches recomputation for flat materializations [${flatMaterializationProperty}, ${label}]`,
      (kind, scenario) => {
        return expectFlatMaterializationScenarioMatches(kind, scenario)
      },
    )
  }

  for (const depth of [1, 2, 3, 4] as const) {
    const property = `includes.matrix.full-row-${depth}`
    const arbitrary = fullRowBatchScenarioAtDepthArbitrary(depth)
    for (const { label, options } of generatedCampaigns(
      10,
      property,
      1719 + depth,
    )) {
      registerIncludesProperty(
        [arbitrary],
        {
          ...options,
          owns: [
            `src/collection/change-events.ts#createFilterFunctionFromExpression`,
            `src/collection/index.ts#createCollection`,
            `src/query/equality-value-identity.ts#createValueIdentity`,
            `src/query/live-query-collection.ts#createLiveQueryCollection`,
            `src/query/live/public-key-reduction.ts#routeKey`,
            `src/query/query-once.ts#queryOnce`,
          ],
        },
        `matches recomputation for visible multi-row batches at depth ${depth} [${property}, ${label}]`,
        (...args: Parameters<typeof expectFullRowBatchScenarioMatches>) => {
          return expectFullRowBatchScenarioMatches(...args)
        },
      )
    }

    const transitions: Array<VisibleRelationshipTransition> = [
      `reparent`,
      `rekey`,
    ]
    for (const transition of transitions) {
      for (let targetLevel = 1; targetLevel <= depth; targetLevel++) {
        const visibleProperty = `includes.matrix.visible-${depth}-${transition}-${targetLevel}`
        const visibleArbitrary = visibleRelationshipScenarioArbitrary(
          depth,
          transition,
          targetLevel as IncludeDepth,
        )
        for (const { label, options } of generatedCampaigns(
          4,
          visibleProperty,
          1721 + depth + targetLevel,
        )) {
          registerIncludesProperty(
            [visibleArbitrary],
            {
              ...options,
              owns: [
                `src/collection/change-events.ts#createFilterFunctionFromExpression`,
                `src/collection/index.ts#createCollection`,
                `src/query/equality-value-identity.ts#createValueIdentity`,
                `src/query/live-query-collection.ts#createLiveQueryCollection`,
                `src/query/live/public-key-reduction.ts#routeKey`,
                `src/query/query-once.ts#queryOnce`,
              ],
            },
            `matches recomputation for a visible ${transition} at depth ${depth}, level ${targetLevel} [${visibleProperty}, ${label}]`,
            async (scenarios) => {
              for (const scenario of [
                scenarios.transitionOnly,
                scenarios.stateful,
              ]) {
                const beforeTransition = recomputeFullRowBatchScenario(
                  scenario,
                  scenario.transitionStepIndex,
                )
                const result = recomputeFullRowBatchScenario(
                  scenario,
                  scenario.transitionStepIndex + 1,
                )

                oracleAssertion(
                  'includes oracle.property comparison 4203',
                  () => expect(result).not.toEqual(beforeTransition),
                )
                await expectFullRowBatchScenarioMatches(scenario)
              }
            },
          )
        }
      }
    }
  }

  for (const depth of [1, 2, 3, 4] as const) {
    const transitions: Array<VisibleRelationshipTransition> = [
      `reparent`,
      `rekey`,
    ]
    for (const [firstIndex, firstTransition] of transitions.entries()) {
      for (const [secondIndex, secondTransition] of transitions.entries()) {
        if (
          transitionHistoryPlacements(depth, firstTransition, secondTransition)
            .length === 0
        ) {
          continue
        }
        for (const sourceBranch of [0, 1] as const) {
          const property = `includes.matrix.transition-${depth}-${firstTransition}-${secondTransition}-${sourceBranch}`
          const arbitrary = transitionHistoryScenariosArbitrary(
            depth,
            firstTransition,
            secondTransition,
            sourceBranch,
          )
          for (const { label, options } of generatedCampaigns(
            3,
            property,
            1725 +
              depth * 100 +
              firstIndex * 10 +
              secondIndex * 2 +
              sourceBranch,
          )) {
            registerIncludesProperty(
              [arbitrary],
              {
                ...options,
                owns: [
                  `src/collection/change-events.ts#createFilterFunctionFromExpression`,
                  `src/collection/index.ts#createCollection`,
                  `src/query/equality-value-identity.ts#createValueIdentity`,
                  `src/query/live-query-collection.ts#createLiveQueryCollection`,
                  `src/query/live/public-key-reduction.ts#routeKey`,
                  `src/query/query-once.ts#queryOnce`,
                ],
              },
              `matches recomputation for ${firstTransition} → ${secondTransition} histories at depth ${depth}, branch ${sourceBranch} [${property}, ${label}]`,
              async (scenarios) => {
                for (const scenario of scenarios) {
                  expectEveryHistoryStepVisible(scenario)
                  await expectFullRowBatchScenarioMatches(scenario)
                }
              },
            )
          }
        }
      }
    }
  }

  for (const { label, options } of generatedCampaigns(
    40,
    `includes.incremental-history`,
    1711,
  )) {
    registerIncludesProperty(
      [scenarioArbitrary],
      {
        ...options,
        owns: [
          `src/collection/change-events.ts#createFilterFunctionFromExpression`,
          `src/collection/index.ts#createCollection`,
          `src/query/equality-value-identity.ts#createValueIdentity`,
          `src/query/live-query-collection.ts#createLiveQueryCollection`,
          `src/query/live/public-key-reduction.ts#routeKey`,
          `src/query/query-once.ts#queryOnce`,
        ],
      },
      `matches naive recomputation after every incremental change [${label}]`,
      (...args: Parameters<typeof expectScenarioMatches>) => {
        return expectScenarioMatches(...args)
      },
    )
  }

  const distinctMaterializationArbitrary = materializeScenarioArbitrary.filter(
    ({ sharedIntermediate }) => !sharedIntermediate,
  )
  for (const { label, options } of generatedCampaigns(
    30,
    `includes.nested-scalar-materialization`,
    1712,
  )) {
    registerIncludesProperty(
      [distinctMaterializationArbitrary],
      {
        ...options,
        owns: [
          `src/collection/change-events.ts#createFilterFunctionFromExpression`,
          `src/collection/index.ts#createCollection`,
          `src/query/equality-value-identity.ts#createValueIdentity`,
          `src/query/live-query-collection.ts#createLiveQueryCollection`,
          `src/query/live/public-key-reduction.ts#routeKey`,
          `src/query/query-once.ts#queryOnce`,
        ],
      },
      `matches recomputation for nested scalar materialization [${label}]`,
      (...args: Parameters<typeof expectMaterializeScenarioMatches>) => {
        return expectMaterializeScenarioMatches(...args)
      },
    )
  }

  const alphaArbitraries: [
    fc.Arbitrary<Array<RootRow>>,
    fc.Arbitrary<Array<ChildRow>>,
  ] = [
    fc.uniqueArray(
      fc.record({
        id: fc.integer({ min: 0, max: 5 }),
        group: fc.integer({ min: 0, max: 2 }),
        value: fc.integer({ min: -3, max: 3 }),
        position: fc.integer({ min: -2, max: 2 }),
      }),
      { selector: (row) => row.id, minLength: 1, maxLength: 5 },
    ),
    fc.uniqueArray(
      fc.record({
        id: fc.integer({ min: 0, max: 7 }),
        parentGroup: fc.integer({ min: 0, max: 2 }),
        group: fc.integer({ min: 0, max: 2 }),
        value: fc.integer({ min: -3, max: 3 }),
        position: fc.integer({ min: -2, max: 2 }),
      }),
      { selector: (row) => row.id, maxLength: 7 },
    ),
  ]
  for (const { label, options } of generatedCampaigns(
    25,
    `includes.alpha-renaming`,
    1713,
  )) {
    registerIncludesProperty(
      alphaArbitraries,
      {
        ...options,
        owns: [
          `src/collection/change-events.ts#createFilterFunctionFromExpression`,
          `src/collection/index.ts#createCollection`,
          `src/query/equality-value-identity.ts#createValueIdentity`,
          `src/query/live-query-collection.ts#createLiveQueryCollection`,
          `src/query/live/public-key-reduction.ts#routeKey`,
          `src/query/query-once.ts#queryOnce`,
        ],
      },
      `is unchanged by alpha-renaming, sibling declaration order, or an unrelated sibling [${label}]`,
      async (rootRows, childRows) => {
        const roots = createControlledCollection<RootRow>(
          `metamorphic-roots`,
          rootRows,
        )
        const children = createControlledCollection<ChildRow>(
          `metamorphic-children`,
          childRows,
        )
        const unrelated = createControlledCollection<ChildRow>(
          `metamorphic-unrelated`,
          childRows.map((row) => ({ ...row, id: row.id + 100 })),
        )

        try {
          const baseline = await queryOnce((q) =>
            q.from({ parent: roots.collection }).select(({ parent }) => ({
              id: parent.id,
              group: parent.group,
              children: toArray(
                q
                  .from({ child: children.collection })
                  .where(({ child }) => eq(child.parentGroup, parent.group))
                  .orderBy(({ child }) => child.position)
                  .orderBy(({ child }) => child.id)
                  .select(({ child }) => ({
                    id: child.id,
                    value: child.value,
                  })),
              ),
            })),
          )
          const renamed = await queryOnce((q) =>
            q.from({ r: roots.collection }).select(({ r }) => ({
              id: r.id,
              group: r.group,
              children: toArray(
                q
                  .from({ c: children.collection })
                  .where(({ c }) => eq(c.parentGroup, r.group))
                  .orderBy(({ c }) => c.position)
                  .orderBy(({ c }) => c.id)
                  .select(({ c }) => ({ id: c.id, value: c.value })),
              ),
            })),
          )
          const withUnrelatedSibling = await queryOnce((q) =>
            q.from({ r: roots.collection }).select(({ r }) => ({
              unrelated: toArray(
                q
                  .from({ u: unrelated.collection })
                  .where(({ u }) => eq(u.parentGroup, r.group))
                  .select(({ u }) => ({ id: u.id })),
              ),
              id: r.id,
              group: r.group,
              children: toArray(
                q
                  .from({ c: children.collection })
                  .where(({ c }) => eq(c.parentGroup, r.group))
                  .orderBy(({ c }) => c.position)
                  .orderBy(({ c }) => c.id)
                  .select(({ c }) => ({ id: c.id, value: c.value })),
              ),
            })),
          )
          const withReorderedSiblings = await queryOnce((q) =>
            q.from({ r: roots.collection }).select(({ r }) => ({
              id: r.id,
              group: r.group,
              children: toArray(
                q
                  .from({ c: children.collection })
                  .where(({ c }) => eq(c.parentGroup, r.group))
                  .orderBy(({ c }) => c.position)
                  .orderBy(({ c }) => c.id)
                  .select(({ c }) => ({ id: c.id, value: c.value })),
              ),
              unrelated: toArray(
                q
                  .from({ u: unrelated.collection })
                  .where(({ u }) => eq(u.parentGroup, r.group))
                  .select(({ u }) => ({ id: u.id })),
              ),
            })),
          )

          // The outer queries have no orderBy: this retains their traversal
          // equivalence witness, not a general root-order contract. Child order
          // remains explicit and must not be normalized away.
          oracleAssertion('includes oracle.property comparison 4525', () =>
            expect(stripVirtualProperties(renamed)).toEqual(
              stripVirtualProperties(baseline),
            ),
          )
          oracleAssertion('includes oracle.property comparison 4528', () =>
            expect(
              stripVirtualProperties(
                withUnrelatedSibling.map(
                  ({ unrelated: _unrelated, ...row }) => row,
                ),
              ),
            ).toEqual(stripVirtualProperties(baseline)),
          )
          oracleAssertion('includes oracle.property comparison 4535', () =>
            expect(stripVirtualProperties(withReorderedSiblings)).toEqual(
              stripVirtualProperties(withUnrelatedSibling),
            ),
          )
        } finally {
          await Promise.all([
            roots.collection.cleanup(),
            children.collection.cleanup(),
            unrelated.collection.cleanup(),
          ])
        }
      },
    )
  }

  const confirmedValueArbitrary = fc
    .integer({ min: -5, max: 5 })
    .filter((value) => value !== 0)
  for (const { label, options } of generatedCampaigns(
    15,
    `includes.optimistic-convergence`,
    1714,
  )) {
    registerIncludesProperty(
      [confirmedValueArbitrary],
      {
        ...options,
        owns: [
          `src/collection/change-events.ts#createFilterFunctionFromExpression`,
          `src/collection/index.ts#createCollection`,
          `src/query/equality-value-identity.ts#createValueIdentity`,
          `src/query/live-query-collection.ts#createLiveQueryCollection`,
          `src/query/live/public-key-reduction.ts#routeKey`,
          `src/query/query-once.ts#queryOnce`,
        ],
      },
      `optimistic updates converge to confirmed-only state [${label}]`,
      async (confirmedValue) => {
        const roots = createControlledCollection<RootRow>(`convergence-roots`, [
          { id: 1, group: 1, value: 0, position: 0 },
        ])
        const children = createControlledCollection<ChildRow>(
          `convergence-children`,
          [
            {
              id: 1,
              parentGroup: 1,
              group: 1,
              value: 0,
              position: 0,
            },
          ],
        )
        const live = createLiveQueryCollection((q) =>
          q.from({ root: roots.collection }).select(({ root }) => ({
            id: root.id,
            children: toArray(
              q
                .from({ child: children.collection })
                .where(({ child }) => eq(child.parentGroup, root.group))
                .select(({ child }) => ({
                  id: child.id,
                  value: child.value,
                })),
            ),
          })),
        )

        const pending = new Set<PendingWork>()
        await withPendingWorkCleanup(
          pending,
          [live, roots.collection, children.collection],
          async () => {
            await live.preload()
            const transaction = children.collection.update(1, (draft) => {
              draft.value = confirmedValue
            })
            const entry = trackPendingWork(
              pending,
              transaction,
              children.resolveSync,
            )
            oracleAssertion('includes oracle.property comparison 4606', () =>
              expect(stripVirtualProperties(live.toArray)).toEqual([
                { id: 1, children: [{ id: 1, value: confirmedValue }] },
              ]),
            )

            children.write(`update`, {
              id: 1,
              parentGroup: 1,
              group: 1,
              value: confirmedValue,
              position: 0,
            })
            releasePendingWork(pending, entry, children.resolveSync)
            await transaction.when(`settled`)

            oracleAssertion('includes oracle.property comparison 4620', () =>
              expect(stripVirtualProperties(live.toArray)).toEqual([
                { id: 1, children: [{ id: 1, value: confirmedValue }] },
              ]),
            )
          },
        )
      },
    )
  }
})

/**
 * # Does an alias name in one scope leak into another?
 *
 * Law: ARCHITECTURE.md normative law 1. Changing an accepted alias in a
 * structured plan to another legal name cannot change an explicitly projected
 * result when its references are renamed with it. Alias-observing functional
 * callbacks are outside this equivalence. Aliases are lexical names; a
 * `SourceId` is the plan's identity for one Collection reference
 * (§Identity). Sibling scopes may reuse names, and a nested scope may shadow
 * an ancestor while captured references retain their original binding.
 *
 * Bug class: a plan rewrite loses a `SourceId`, or alias text otherwise
 * decides which source's input, request, or remap is used. A sibling source
 * with the same name then supplies the wrong rows. Issue #1975 reached it
 * through optimizer predicate pushdown into a joined `from()` subquery.
 *
 * Grammar, model, driver, and observation live in
 * `includes-scope-identity-oracle.ts`. The grammar crosses three topologies
 * that place a rewritable source beside a same-named sibling source:
 * `fromSubquery`, `unionBranch`, and a top-level pure `wrapper` beside a join
 * subquery. The subquery varies joins (none, refs, refs then notes), LEFT or
 * INNER refs joins, zero to two predicates in separate or combined form, a
 * plain, ordered-and-limited, or DISTINCT body, and whole-row or field
 * selection. The include varies its body (direct, joined, a `unionAll()`
 * with an anchor join, or a `from()` subquery that reads the parent row),
 * `toArray()` or `materialize()`, its source, an extra child predicate, and
 * outer spread or field selection. Sources are
 * eager or on-demand finite providers. Alias slots draw from a three-name
 * pool, so cross-scope reuse is frequent.
 *
 * Legality follows the documented lexical rules: one scope and the branches
 * of one `unionAll()` keep their names distinct; ancestor shadowing is legal.
 * One in four scenarios draws any naming. A same-scope or union-branch repeat
 * must be rejected when the query is created. The exact-key companion
 * `includes-alias-shadowing-oracle.test.ts` checks public aliases that this
 * model intentionally removes from explicitly projected rows.
 *
 * Checks at each checkpoint (after preload and after every source write):
 *
 * 1. The canonical all-distinct naming equals a plain recomputation of the
 *    current source rows. This judges the shape independently of aliases.
 * 2. The generated naming equals the canonical naming. This is the law.
 * 3. For on-demand sources, each Collection receives the same `loadSubset`
 *    WHERE clauses under both namings. Requests name Collection fields, not
 *    aliases, so they must match exactly as bags.
 *
 * Limits: the model covers this grammar only. Rows and members are compared
 * as bags because no query here promises an order. Public key shape,
 * publication events, observer timing, unload, and nested includes are outside
 * this owner; the exact-key, publication, and recomputation owners cover their
 * stated shapes.
 * The review record is
 * `docs/contributing/oracle-reviews/issue-1975-scope-identity.md`.
 */
async function expectScopedNamingRejected(
  scenario: ScopedScenario,
  naming: `sameScope`,
) {
  const sources = createScopedSources(scenario)
  let created: ReturnType<typeof createScopedQuery> | undefined
  try {
    oracleAssertion('includes oracle.property comparison 4701', () =>
      expect(
        () => {
          created = createScopedQuery(scenario.shape, scenario.aliases, sources)
        },
        `${naming} naming ${JSON.stringify(scenario.aliases)} must be rejected`,
      ).toThrow(),
    )
  } finally {
    await created?.cleanup()
    await Promise.all(
      Object.values(sources).map((source) => source.collection.cleanup()),
    )
  }
}

async function expectScopedAlphaRenamingHolds(
  scenario: ScopedScenario,
  expectedAfterPreload?: Array<ScopedResultRow>,
) {
  const naming = classifyScopedNaming(scenario.shape, scenario.aliases)
  if (naming === `sameScope`) {
    await expectScopedNamingRejected(scenario, naming)
    return
  }
  const canonicalNames = canonicalScopedAliases(scenario.shape)
  const canonicalSources = createScopedSources(scenario)
  const renamedSources = createScopedSources(scenario)
  const state = createModelState(scenario)
  const canonical = createScopedQuery(
    scenario.shape,
    canonicalNames,
    canonicalSources,
  )
  const renamed = createScopedQuery(
    scenario.shape,
    scenario.aliases,
    renamedSources,
  )

  const check = (checkpoint: string) => {
    const label = `${checkpoint}, naming ${JSON.stringify(scenario.aliases)}`
    oracleAssertion('includes oracle.property comparison 4741', () =>
      expect(
        normalizeScopedRows(canonical.toArray),
        `${label}: canonical naming against recomputation`,
      ).toEqual(
        normalizeScopedRows(recomputeScopedRows(scenario.shape, state)),
      ),
    )
    oracleAssertion('includes oracle.property comparison 4745', () =>
      expect(
        normalizeScopedRows(renamed.toArray),
        `${label}: generated naming against canonical naming`,
      ).toEqual(normalizeScopedRows(canonical.toArray)),
    )
    if (scenario.mode === `onDemand`) {
      oracleAssertion('includes oracle.property comparison 4750', () =>
        expect(
          sortedRequests(renamedSources),
          `${label}: loadSubset requests per Collection`,
        ).toEqual(sortedRequests(canonicalSources)),
      )
    }
  }

  let primary: unknown
  try {
    await Promise.all([canonical.preload(), renamed.preload()])
    await flushPromises()
    if (expectedAfterPreload) {
      oracleAssertion('includes oracle.property comparison 4762', () =>
        expect(normalizeScopedRows(canonical.toArray)).toEqual(
          normalizeScopedRows(expectedAfterPreload),
        ),
      )
    }
    check(`after preload`)
    for (const [index, write] of scenario.writes.entries()) {
      applyScopedWrite([canonicalSources, renamedSources], state, write)
      await flushPromises()
      check(`after write ${index} (${JSON.stringify(write)})`)
    }
  } catch (error) {
    primary = error
  }

  // Cleanup failures must not replace the violated law.
  const cleanup = await Promise.allSettled([
    canonical.cleanup(),
    renamed.cleanup(),
    ...[canonicalSources, renamedSources].flatMap((sources) =>
      Object.values(sources).map((source) => source.collection.cleanup()),
    ),
  ])
  const cleanupErrors = cleanup.flatMap((result) =>
    result.status === `rejected` ? [result.reason] : [],
  )
  if (primary !== undefined && cleanupErrors.length > 0) {
    throw new AggregateError(
      [primary, ...cleanupErrors],
      `scoped alpha-renaming failed, and cleanup also failed`,
      { cause: primary },
    )
  }
  if (primary !== undefined) throw primary
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, `scoped oracle cleanup failed`)
  }
}

const scopedPartRows: Array<ScopedPart> = [
  { id: 1, active: true },
  { id: 2, active: true },
  { id: 3, active: false },
]
const scopedRefRows: Array<ScopedRef> = [
  { id: 10, partId: 1, clientId: 1 },
  { id: 11, partId: 1, clientId: 2 },
  { id: 20, partId: 2, clientId: 2 },
  { id: 30, partId: 3, clientId: 1 },
]
const scopedNoteRows: Array<ScopedRef> = [
  { id: 100, partId: 1, clientId: 1 },
  { id: 200, partId: 2, clientId: 1 },
]

function fixedScenario(
  shape: ScopedShape,
  aliases: ScopedAliases,
): ScopedScenario {
  return {
    shape,
    mode: `eager`,
    aliases,
    parts: scopedPartRows,
    refs: scopedRefRows,
    notes: scopedNoteRows,
    writes: [],
  }
}

/**
 * Each optimizer witness failed on the unrepaired optimizer and passes with
 * the repair. The joined-union witness guards a legal naming that an
 * overbroad shadowing check once rejected. Together they reach every optimizer site that once re-minted a
 * SourceId; the review record maps each site to its killing witness.
 */
const fixedScopeWitnesses: Array<[string, ScopedScenario]> = [
  [
    `an include reuses the join alias of a joined subquery`,
    fixedScenario(
      {
        topology: `fromSubquery`,
        subquery: {
          ...plainSubquery,
          predicates: [`joinedClient`, `subActive`],
        },
        include: { ...refsInclude, form: `materialize` },
      },
      { outer: `part`, sub: `part`, joined: `ref`, noted: `n`, include: `ref` },
    ),
  ],
  [
    `an include reuses the second join alias`,
    fixedScenario(
      {
        topology: `fromSubquery`,
        subquery: { ...plainSubquery, joins: `refsThenNotes` },
        include: refsInclude,
      },
      { outer: `o`, sub: `s`, joined: `j`, noted: `k`, include: `k` },
    ),
  ],
  [
    `an include reuses the source alias of an ordered, limited subquery`,
    fixedScenario(
      {
        topology: `fromSubquery`,
        subquery: { ...plainSubquery, body: `orderedLimit` },
        include: refsInclude,
      },
      { outer: `o`, sub: `p`, joined: `j`, noted: `n`, include: `p` },
    ),
  ],
  [
    `an include reuses the source alias of a DISTINCT subquery`,
    fixedScenario(
      {
        topology: `fromSubquery`,
        subquery: { ...plainSubquery, body: `distinct`, subSelect: `fields` },
        include: refsInclude,
      },
      { outer: `o`, sub: `p`, joined: `j`, noted: `n`, include: `p` },
    ),
  ],
  [
    `an include reuses the source alias of a joined union branch`,
    fixedScenario(
      {
        topology: `unionBranch`,
        subquery: { ...plainSubquery, subSelect: `fields` },
        include: refsInclude,
      },
      {
        outer: `o`,
        sub: `x`,
        joined: `j`,
        noted: `n`,
        include: `x`,
        inactive: `y`,
      },
    ),
  ],
  [
    `an include on a joined union reuses a branch alias`,
    fixedScenario(
      { topology: `unionParent`, includeSource: `refs` },
      { activeBranch: `x`, inactiveBranch: `y`, anchor: `a`, include: `x` },
    ),
  ],
  [
    `an include shadows its parent source alias`,
    {
      ...fixedScenario(
        {
          topology: `fromSubquery`,
          subquery: plainSubquery,
          include: refsInclude,
        },
        { outer: `x`, sub: `p`, joined: `j`, noted: `n`, include: `x` },
      ),
      writes: [
        {
          source: `refs`,
          type: `put`,
          row: { id: 40, partId: 2, clientId: 1 },
        },
        { source: `parts`, type: `put`, row: { id: 4, active: true } },
      ],
    },
  ],
  [
    `a nested include source shadows its outer include source`,
    fixedScenario(
      {
        topology: `fromSubquery`,
        subquery: plainSubquery,
        include: { ...refsInclude, body: `nestedFrom` },
      },
      {
        outer: `o`,
        sub: `p`,
        joined: `j`,
        noted: `n`,
        includeOuter: `x`,
        include: `x`,
      },
    ),
  ],
  [
    `a join subquery reuses the alias of a collapsed pure wrapper`,
    fixedScenario(
      { topology: `wrapper`, wrapperJoin: `inner` },
      { wrapped: `x`, joinSub: `k`, joinSource: `x` },
    ),
  ],
]

const scopedAlphaFixedHistories: Array<{
  name: string
  scenario: ScopedScenario
  expected?: Array<ScopedResultRow>
}> = [
  {
    name: `an include that reuses a joined subquery alias keeps the reported rows`,
    // Issue #1975: only part 1 has a ref for client 1; parts 1 and 2 are
    // active.
    scenario: {
      ...fixedScopeWitnesses[0]![1],
      parts: [
        { id: 1, active: true },
        { id: 2, active: true },
      ],
      refs: [
        { id: 10, partId: 1, clientId: 1 },
        { id: 20, partId: 2, clientId: 2 },
      ],
      notes: [],
    },
    expected: [{ id: 1, active: true, members: [{ id: 10, clientId: 1 }] }],
  },
  ...fixedScopeWitnesses.flatMap(([name, scenario]) =>
    ([`eager`, `onDemand`] as const).map((mode) => ({
      name: `${name} [${mode}]`,
      scenario: { ...scenario, mode },
    })),
  ),
]

const scopedAlphaLaw = `Changing accepted aliases to other legal names in a structured plan does not change an explicitly projected result, its source requests, or its rows when lexical scopes reuse names.`

describe(`includes alpha-renaming across lexical scopes`, () => {
  oracleProperty({
    id: `includes.scoped-alpha-fixed`,
    law: {
      statement: scopedAlphaLaw,
      authority: `ARCHITECTURE.md normative law 1 (alpha-renaming) and the Identity section, stated above.`,
      limits: `The reported regression and each fixed optimizer witness in eager and on-demand modes.`,
    },
    owns: [
      `src/collection/change-events.ts#createFilterFunctionFromExpression`,
      `src/collection/index.ts#createCollection`,
      `src/query/equality-value-identity.ts#createValueIdentity`,
      `src/query/live-query-collection.ts#createLiveQueryCollection`,
      `src/query/live/public-key-reduction.ts#routeKey`,
      `src/query/query-once.ts#queryOnce`,
    ],
    histories: scopedAlphaFixedHistories,
    label: ({ name }) => name,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(scopedAlphaLaw, plan, observe, () =>
        expectScopedAlphaRenamingHolds(
          plan.history.scenario,
          plan.history.expected,
        ),
      ),
    check: forwardAssertionJudgment,
  })

  for (const { label, options } of generatedCampaigns(
    80,
    `includes.scoped-alpha-renaming`,
    1715,
  )) {
    registerIncludesProperty(
      [scopedScenarioArbitrary],
      {
        ...options,
        owns: [
          `src/collection/change-events.ts#createFilterFunctionFromExpression`,
          `src/collection/index.ts#createCollection`,
          `src/query/equality-value-identity.ts#createValueIdentity`,
          `src/query/live-query-collection.ts#createLiveQueryCollection`,
          `src/query/live/public-key-reduction.ts#routeKey`,
          `src/query/query-once.ts#queryOnce`,
        ],
      },
      `is unchanged when lexical scopes reuse alias names [${label}]`,
      (scenario) => {
        return expectScopedAlphaRenamingHolds(scenario)
      },
      Math.max(5_000, oracleRuns(80) * 50),
    )
  }
})

// A real active-bucket receiving path extends this owner's numeric route
// domain with native route-string collisions. The same full-tree recompute
// judges inline arrays and Collection facades after each source transaction.
// The fixture proves only the collision premise; it computes no expected rows.
function collidingRouteGroups(): Array<number> {
  const identity = createValueIdentity()
  const seen = new Map<number, number>()
  for (let group = 0; group < 500_000; group++) {
    const digest = hash(routeKey(group, null, identity))
    const previous = seen.get(digest)
    if (previous !== undefined) {
      for (let anchor = -1; anchor > -100; anchor--)
        if (hash(routeKey(anchor, null, identity)) !== digest)
          return [previous, group, anchor]
    }
    seen.set(digest, group)
  }
  throw new Error(`Include route collision search exhausted`)
}

for (const campaign of generatedCampaigns(
  100,
  `includes.bucket-collisions`,
  2309,
))
  for (const form of [`inline`, `collection`] as const)
    (() => {
      let groups: Array<number> | undefined
      const counts = new Map<string, number>(
        DISTINCT_REACH_STATES.map((state) => [state, 0]),
      )
      registerIncludesProperty(
        [distinctHistory],
        {
          ...campaign.options,
          owns: [
            `src/collection/change-events.ts#createFilterFunctionFromExpression`,
            `src/collection/index.ts#createCollection`,
            `src/query/equality-value-identity.ts#createValueIdentity`,
            `src/query/live-query-collection.ts#createLiveQueryCollection`,
            `src/query/live/public-key-reduction.ts#routeKey`,
            `src/query/query-once.ts#queryOnce`,
          ],
          beforeCampaign: () => {
            groups = collidingRouteGroups()
            for (const state of counts.keys()) counts.set(state, 0)
          },
          afterCampaign: () => {
            if (!oracleReplayRequested()) {
              const missed = [...counts]
                .filter(([, count]) => count < 1)
                .map(([state, count]) => `${state} (${count})`)
              if (missed.length)
                throw new Error(
                  `includes.bucket-collisions: generated histories reached these states fewer than 1 times, so their laws were not enforced there: ${missed.join(', ')}`,
                )
            }
            process.stdout.write(
              `includes bucket ${form} reach ${JSON.stringify(Object.fromEntries(counts))}\n`,
            )
          },
        },
        `preserves colliding active buckets ${form} (${campaign.label})`,
        async (worlds) => {
          const resolvedGroups = (groups ??= collidingRouteGroups())

          const sources = createSources()
          const children = new Map(
            resolvedGroups.map((group, id) => [id, batchChild(id, group)]),
          )
          const roots = new Map<number, RootRow>()
          const live =
            form === `inline`
              ? createIncrementalQuery(1, sources)
              : createLiveQueryCollection((q) =>
                  q
                    .from({ root: sources.roots.collection })
                    .orderBy(({ root }) => root.position)
                    .orderBy(({ root }) => root.id)
                    .select(({ root }) => ({
                      id: root.id,
                      group: root.group,
                      value: root.value,
                      position: root.position,
                      children: include(
                        q
                          .from({ child: sources.levels[0].collection })
                          .where(({ child }) =>
                            eq(child.parentGroup, root.group),
                          )
                          .orderBy(({ child }) => child.position)
                          .orderBy(({ child }) => child.id)
                          .select(({ child }) => ({
                            id: child.id,
                            group: child.group,
                            value: child.value,
                            position: child.position,
                          })),
                      ),
                    })),
                )
          await withOracleCleanup(async () => {
            await live.preload()
            sources.levels[0].writeBatch(
              [...children.values()].map((value) => ({
                type: `insert`,
                value,
              })),
            )
            for (const [checkpoint, world] of worlds.entries()) {
              const next = new Map(
                world.map((label, id) => [
                  id,
                  batchRoot(id, resolvedGroups[label]!),
                ]),
              )
              const changes: Array<{
                type: `delete` | `insert` | `update`
                value: RootRow
              }> = []
              for (const [id, value] of roots)
                if (!next.has(id)) changes.push({ type: `delete`, value })
              for (const [id, value] of next)
                changes.push({
                  type: roots.has(id) ? `update` : `insert`,
                  value,
                })
              sources.roots.writeBatch(changes)
              roots.clear()
              for (const [id, value] of next) roots.set(id, value)
              const observed = live.toArray.map((row) => ({
                ...row,
                children: Array.isArray(row.children)
                  ? row.children
                  : row.children.toArray,
              }))
              oracleAssertion('includes oracle.property comparison 5137', () =>
                expect(
                  stripVirtualProperties(observed),
                  `${form} checkpoint ${checkpoint}`,
                ).toEqual(recompute(roots, [children], 1)),
              )
            }
            for (const state of distinctReachStates(worlds))
              counts.set(state, counts.get(state)! + 1)
          }, [
            () => live.cleanup(),
            () => sources.roots.collection.cleanup(),
            ...sources.levels.map(
              ({ collection }) =>
                () =>
                  collection.cleanup(),
            ),
          ])
        },
      )
    })()
